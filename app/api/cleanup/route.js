// app/api/cleanup/route.js
import { NextResponse } from "next/server";
import crypto from "crypto";

const OAUTH_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const FIRESTORE_RUNQUERY = (projectId) =>
  `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;

/**
 * Helper: build JWT (RS256) for service account OAuth2 (assertion -> token)
 */
function base64UrlEncode(buff) {
  return buff
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function signJwt(privateKeyPem, header, payload) {
  const encodedHeader = base64UrlEncode(Buffer.from(JSON.stringify(header)));
  const encodedPayload = base64UrlEncode(Buffer.from(JSON.stringify(payload)));
  const data = `${encodedHeader}.${encodedPayload}`;

  const sign = crypto.createSign("RSA-SHA256");
  sign.update(data);
  sign.end();
  const signature = sign.sign(privateKeyPem);
  const encodedSig = base64UrlEncode(signature);

  return `${data}.${encodedSig}`;
}

/**
 * Get service account private key (prefer base64 env)
 */
function getPrivateKeyFromEnv() {
  if (process.env.FIREBASE_PRIVATE_KEY_BASE64) {
    // decode base64 -> utf8 PEM
    const b = Buffer.from(process.env.FIREBASE_PRIVATE_KEY_BASE64, "base64");
    return b.toString("utf8");
  }
  if (process.env.FIREBASE_PRIVATE_KEY) {
    // FIREBASE_PRIVATE_KEY is expected to be single-line with literal \n
    // Convert literal "\n" -> actual newline for signing library
    return process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n");
  }
  return null;
}

/**
 * Exchange JWT assertion for access token
 */
async function getAccessToken(projectId, clientEmail, privateKeyPem) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const scope = [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/datastore",
  ].join(" ");

  const payload = {
    iss: clientEmail,
    scope: scope,
    aud: OAUTH_TOKEN_ENDPOINT,
    exp: now + 60 * 60, // 1 hour
    iat: now,
  };

  const assertion = signJwt(privateKeyPem, header, payload);

  const body = new URLSearchParams();
  body.append("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
  body.append("assertion", assertion);

  const res = await fetch(OAUTH_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${txt}`);
  }

  const json = await res.json();
  if (!json.access_token) throw new Error("No access_token in response");
  return json.access_token;
}

/**
 * Run structuredQuery via Firestore REST (collection group 'history')
 */
async function runQueryAccessToken(projectId, accessToken, cutoffTimestamp, limit) {
  const url = FIRESTORE_RUNQUERY(projectId);
  const q = {
    structuredQuery: {
      from: [{ collectionId: "history", allDescendants: true }],
      where: {
        fieldFilter: {
          field: { fieldPath: "timestamp" },
          op: "LESS_THAN",
          value: { integerValue: String(cutoffTimestamp) },
        },
      },
      orderBy: [{ field: { fieldPath: "timestamp" }, direction: "ASCENDING" }],
      limit: limit,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(q),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`runQuery failed: ${res.status} ${text}`);
  }

  // runQuery returns newline-delimited JSON objects (each line a proto response)
  // but typically it's JSON array when called this endpoint. Try parse robustly.
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    // fallback: if NDJSON, split lines and parse those with document
    parsed = text
      .split("\n")
      .map((r) => {
        try {
          return JSON.parse(r);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }
  return parsed;
}

/**
 * Delete a Firestore document by its full resource name
 * docName example: "projects/{projectId}/databases/(default)/documents/sensorData/data/history/12345"
 */
async function deleteDocByName(docName, accessToken) {
  const url = `https://firestore.googleapis.com/v1/${docName}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return { ok: res.ok, status: res.status, text: await res.text() };
}

/**
 * Next.js POST handler
 */
export async function POST(request) {
  console.info("🟦 /api/cleanup route loaded");
  try {
    const body = await request.json().catch(() => ({}));
    const deleteCount = Number(body.deleteCount || body.delete || 50);
    console.info("🔍 Attempting cleanup with deleteCount:", deleteCount);

    // Validate env
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKeyPem = getPrivateKeyFromEnv();

    if (!projectId || !clientEmail || !privateKeyPem) {
      console.error("❌ Missing Firebase env vars. Provide FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and private key.");
      return NextResponse.json(
        { success: false, error: "Missing Firebase credentials in environment" },
        { status: 500 }
      );
    }

    console.info("🔑 Initializing Firebase Admin...");

    // Get access token via JWT assertion
    let accessToken;
    try {
      accessToken = await getAccessToken(projectId, clientEmail, privateKeyPem);
      console.info("✅ Obtained access token (len):", accessToken.length);
    } catch (err) {
      console.error("❌ Token exchange error:", err.message || err);
      return NextResponse.json({ success: false, error: "Token exchange failed", details: String(err) }, { status: 500 });
    }

    // Choose cutoff - here we delete oldest 'deleteCount' regardless or you can pass timestamp
    // If user supplies 'olderThan' in ms, we can use that. Otherwise delete oldest deleteCount.
    const now = Date.now();
    let cutoffTime = body.olderThan || null; // expected ms epoch
    if (cutoffTime) {
      cutoffTime = Number(cutoffTime);
      console.info("🕒 Using cutoffTime (ms):", cutoffTime);
    } else {
      // If no cutoff provided, we'll query earliest documents ascending and delete first `deleteCount`
      // For runQuery we still need a where clause; we will not filter by timestamp if not provided,
      // but to avoid retrieving too many documents, we will use a large upper bound.
      // Simpler: set cutoff to now so "timestamp < now" (all past docs).
      cutoffTime = now;
      console.info("🕒 No cutoff provided, using now() as upper bound");
    }

    console.info("📍 Trying collection group: history");
    let results;
    try {
      results = await runQueryAccessToken(projectId, accessToken, cutoffTime, deleteCount);
      console.info("📘 runQuery returned items:", results.length || 0);
    } catch (err) {
      console.error("⚠️ runQuery error:", err.message || err);
      return NextResponse.json({ success: false, error: "runQuery failed", details: String(err) }, { status: 500 });
    }

    // Parse results: each item may have "document"
    const docs = [];
    for (const r of results) {
      if (!r) continue;
      if (r.document && r.document.name) {
        docs.push(r.document.name);
      } else if (r.document) {
        // sometimes nested
        const doc = r.document;
        if (doc.name) docs.push(doc.name);
      } else if (r.result && r.result.document && r.result.document.name) {
        docs.push(r.result.document.name);
      }
    }

    console.info("📍 Documents to delete:", docs.length);

    if (docs.length === 0) {
      return NextResponse.json({ success: true, deleted: 0, message: "No matching documents found" });
    }

    // Delete one-by-one (could parallelize but careful with rate limits)
    let deleted = 0;
    const errors = [];
    for (const name of docs) {
      try {
        const res = await deleteDocByName(name, accessToken);
        if (res.ok) {
          deleted++;
          console.info("🗑 Deleted:", name);
        } else {
          console.warn("⚠ Failed to delete", name, "status:", res.status, "text:", res.text);
          errors.push({ name, status: res.status, text: res.text });
        }
      } catch (err) {
        console.error("❌ delete error for", name, err.message || err);
        errors.push({ name, error: String(err) });
      }
    }

    console.info("🟢 Cleanup finished. Deleted:", deleted);
    return NextResponse.json({ success: true, deleted, errors });

  } catch (err) {
    console.error("❌ Unexpected error in /api/cleanup:", err);
    return NextResponse.json({ success: false, error: "Unexpected server error", details: String(err) }, { status: 500 });
  }
}
