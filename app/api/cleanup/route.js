// app/api/cleanup/route.js
import { NextResponse } from "next/server";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

console.info("🟦 /api/cleanup route loaded");

// Firebase Admin Initialization
if (!getApps().length) {
  try {
    console.info("🟢 Firebase Admin initializing...");
    
    // Decode Base64 Firebase private key
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
    
    console.info("🟢 Firebase Admin initialized");
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
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  console.info("🟨 Cleanup request body:", body);

  const deleteCount = body.deleteCount || 0;

  if (deleteCount < 1) {
    console.warn("⚠ deleteCount harus > 0");
    return NextResponse.json(
      { success: false, error: "deleteCount harus lebih dari 0" },
      { status: 400 }
    );
  }

  console.info(`🔍 Cleanup requested: deleteCount=${deleteCount}`);

  try {
    const db = getFirestore();
    console.info("🟦 Firestore connected");

    // ✅ QUERY COLLECTION: Temperature_History
    // Path: /Temperature_History/{documentId}
    const snapshot = await db
      .collection("Temperature_History")
      .orderBy("timestamp", "asc")
      .limit(deleteCount)
      .get();

    console.info(`📘 Found ${snapshot.size} documents to delete`);

    if (snapshot.empty) {
      console.info("ℹ️ No documents found");
      return NextResponse.json({
        success: true,
        deleted: 0,
        message: "Tidak ada data yang ditemukan",
      });
    }

    // Delete in batch
    const batch = db.batch();
    snapshot.forEach((doc) => {
      console.info(`🗑️ Deleting doc ID: ${doc.id}, timestamp: ${doc.data().timestamp}`);
      batch.delete(doc.ref);
    });

    await batch.commit();
    console.info(`🟢 Cleanup success: deleted ${snapshot.size} documents`);

    return NextResponse.json({
      success: true,
      deleted: snapshot.size,
      message: `Berhasil menghapus ${snapshot.size} data tertua`,
    });

  } catch (err) {
    console.error("❌ Cleanup error:", err);
    
    // Detailed error response
    let errorHint = "Periksa koneksi Firebase";
    if (err.message.includes("index")) {
      errorHint = "Buat Firestore Index untuk orderBy timestamp";
    } else if (err.code === "permission-denied") {
      errorHint = "Periksa Firebase Security Rules";
    }

    return NextResponse.json(
      {
        success: false,
        error: err.message,
        code: err.code || "UNKNOWN",
        hint: errorHint,
      },
      { status: 500 }
    );
  }
}
