// app/api/cleanup/route.js
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';

console.log("🟦 /api/cleanup route loaded");

// Initialize Firebase Admin once
if (!getApps().length) {
  try {
    if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
      console.error('❌ Missing Firebase env vars (PROJECT_ID / CLIENT_EMAIL / PRIVATE_KEY)');
    }

    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        // handle escaped newlines
        privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
      }),
    });
    console.log("🟢 Firebase Admin initialized");
  } catch (err) {
    console.error("❌ Firebase Admin init error:", err);
  }
}

// helper - delete docs in chunks of maxBatch
async function deleteDocsInBatches(docs, db, maxBatch = 500) {
  let deleted = 0;
  for (let i = 0; i < docs.length; i += maxBatch) {
    const chunk = docs.slice(i, i + maxBatch);
    const batch = db.batch();
    chunk.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += chunk.length;
    console.log(`Committed batch of ${chunk.length} deletes (total ${deleted})`);
  }
  return deleted;
}

export async function POST(request) {
  console.log("🟧 /api/cleanup POST hit");

  let body = null;
  try {
    body = await request.json();
    console.log("🟨 Cleanup request body:", body);
  } catch (e) {
    console.error("❌ JSON parse error:", e);
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    // ensure admin initialized
    if (getApps().length === 0) {
      console.error('❌ Firebase Admin not initialized');
      return NextResponse.json({ success: false, error: 'Firebase Admin not initialized' }, { status: 500 });
    }

    const db = getFirestore();
    console.log("🟦 Firestore initialized");

    const { deleteCount, olderThan } = body || {};

    // Mode A: delete by count (dashboard sends deleteCount)
    if (deleteCount && typeof deleteCount === 'number' && deleteCount > 0) {
      console.log(`Cleanup requested: deleteCount=${deleteCount}`);
      const historyRef = db.collection('sensorData').doc('data').collection('history');
      // order ascending (oldest first)
      const snapshot = await historyRef.orderBy('timestamp', 'asc').limit(deleteCount).get();
      console.log('📄 Documents found:', snapshot.size);

      if (snapshot.empty) {
        return NextResponse.json({ success: true, deleted: 0, message: 'No documents to delete' });
      }

      const docs = snapshot.docs;
      const deleted = await deleteDocsInBatches(docs, db, 500);
      console.log('🟢 Deleted', deleted, 'documents');
      return NextResponse.json({ success: true, deleted, message: `Deleted ${deleted} docs` });
    }

    // Mode B: delete by olderThan (milliseconds)
    if (olderThan && typeof olderThan === 'number' && olderThan > 0) {
      const cutoffMs = Date.now() - olderThan;
      console.log('Cleanup requested: olderThan(ms)=', olderThan, 'cutoff=', new Date(cutoffMs).toISOString());
      const historyRef = db.collection('sensorData').doc('data').collection('history');

      // first try numeric timestamp
      let snapshot = await historyRef.where('timestamp', '<', cutoffMs).get();

      // if none found, try Firestore Timestamp
      if (snapshot.empty) {
        try {
          const tsCutoff = Timestamp.fromMillis(cutoffMs);
          console.log('Trying Timestamp.fromMillis query');
          snapshot = await historyRef.where('timestamp', '<', tsCutoff).get();
        } catch (err) {
          console.warn('Timestamp.fromMillis query failed:', err.message || err);
        }
      }

      console.log('📄 Documents found:', snapshot.size);
      if (snapshot.empty) {
        return NextResponse.json({ success: true, deleted: 0, message: 'No documents older than cutoff' });
      }

      const docs = snapshot.docs;
      const deleted = await deleteDocsInBatches(docs, db, 500);
      console.log('🟢 Deleted', deleted, 'documents');
      return NextResponse.json({ success: true, deleted, message: `Deleted ${deleted} docs` });
    }

    // neither param present
    console.log('⚠️ Neither deleteCount nor olderThan provided in body');
    return NextResponse.json({ success: false, error: 'Provide deleteCount (number) or olderThan (ms)' }, { status: 400 });
  } catch (error) {
    console.error('❌ Cleanup error:', error);
    return NextResponse.json({ success: false, error: 'Cleanup failed', details: String(error) }, { status: 500 });
  }
}
