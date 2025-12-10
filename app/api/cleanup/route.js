import { NextResponse } from "next/server";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Log saat file ini pertama kali dimuat
console.info("🟦 /api/cleanup route loaded");

// Firebase Admin Initialization
if (!getApps().length) {
  try {
    console.info("🟢 Firebase Admin initializing...");

    // Decode Base64 Firebase private key dari Environment Variables Vercel
    const decodedKey = Buffer.from(
      process.env.FIREBASE_PRIVATE_KEY_BASE64 || "",
      "base64"
    ).toString("utf8");

    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: decodedKey,
      }),
    });

    console.info("🟢 Firebase Admin initialized using BASE64 key");

  } catch (err) {
    console.error("❌ Firebase Admin init error:", err);
  }
}

export async function POST(request) {
  console.info("🟧 /api/cleanup POST hit");

  let body = {};
  try {
    body = await request.json();
  } catch (err) {
    console.warn("⚠ Tidak ada JSON body");
  }

  console.info("🟨 Cleanup request body:", body);

  const deleteCount = body.deleteCount || 0;
  console.info(`Cleanup requested: deleteCount=${deleteCount}`);

  try {
    const db = getFirestore();
    console.info("🟦 Firestore connected");

    const snapshot = await db
      .collection("Temperature_History")
      .orderBy("timestamp", "asc")
      .limit(deleteCount)
      .get();

    console.info(`📘 Found ${snapshot.size} documents to delete`);

    const batch = db.batch();
    snapshot.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();

    console.info("🟢 Cleanup success");

    return NextResponse.json({ success: true, deleted: snapshot.size });
  } catch (err) {
    console.error("❌ Cleanup error:", err);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
