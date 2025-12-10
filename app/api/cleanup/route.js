import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { NextResponse } from "next/server";

console.log("🟦 /api/cleanup route loaded");

// Init Firebase Admin
if (!getApps().length) {
  try {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
    });
    console.log("🟢 Firebase Admin initialized");
  } catch (error) {
    console.error("❌ Firebase Admin init error:", error);
  }
}

export async function POST(request: Request) {
  console.log("🟧 /api/cleanup POST hit");

  let body: any = null;
  try {
    body = await request.json();
    console.log("🟨 Cleanup request body:", body);
  } catch (e) {
    console.error("❌ JSON parse error:", e);
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const { deleteCount } = body;

    if (!deleteCount || deleteCount <= 0) {
      console.log("⚠️ deleteCount tidak valid:", deleteCount);
      return NextResponse.json(
        { success: false, error: "deleteCount tidak valid" },
        { status: 400 }
      );
    }

    const db = getFirestore();
    console.log("🟦 Firestore initialized");

    console.log("🔍 Querying history...");
    const historyRef = db
      .collection("sensorData")
      .doc("data")
      .collection("history");

    const snapshot = await historyRef.orderBy("timestamp").limit(deleteCount).get();

    console.log("📄 Documents found:", snapshot.size);

    if (snapshot.empty) {
      return NextResponse.json({
        success: true,
        deleted: 0,
      });
    }

    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));

    await batch.commit();

    console.log("🟢 Deleted:", snapshot.size);

    return NextResponse.json({
      success: true,
      deleted: snapshot.size,
    });
  } catch (error: any) {
    console.error("❌ Cleanup error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
