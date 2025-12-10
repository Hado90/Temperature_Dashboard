// app/api/cleanup/route.js
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { Timestamp } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';

// Init Firebase Admin once
if (!getApps().length) {
  try {
    if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
      console.error('❌ Missing Firebase env vars (PROJECT_ID / CLIENT_EMAIL / PRIVATE_KEY)');
    }
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
      }),
    });
    console.log('✅ Firebase Admin initialized');
  } catch (err) {
    console.error('❌ Firebase Admin init error:', err);
  }
}

// Helper: delete docs in chunks of maxBatch (500)
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
  try {
    // Optional: protect endpoint with secret header (recommended in prod)
    // const secret = request.headers.get('x-cleanup-secret');
    // if (secret !== process.env.CLEANUP_SECRET) return NextResponse.json({ success:false, error:'Unauthorized' }, { status:401 });

    // parse body
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
    }

    const db = getFirestore();

    // Ensure Admin initialized
    if (getApps().length === 0) {
      console.error('Firebase Admin not initialized');
      return NextResponse.json({ success: false, error: 'Firebase Admin not initialized' }, { status: 500 });
    }

    // Two modes supported:
    // 1) deleteCount (number) -> delete N oldest documents
    // 2) olderThan (ms) -> delete docs older than now - olderThan milliseconds
    const { deleteCount, olderThan } = body || {};

    const historyRef = db.collection('sensorData').doc('data').collection('history');

    // MODE A: deleteCount
    if (deleteCount && typeof deleteCount === 'number' && deleteCount > 0) {
      console.log(`Cleanup requested: deleteCount=${deleteCount}`);
      // query oldest `deleteCount` docs (ascending timestamp)
      const snapshot = await historyRef.orderBy('timestamp', 'asc').limit(deleteCount).get();
      if (snapshot.empty) {
        return NextResponse.json({ success: true, deleted: 0, message: 'No documents to delete' });
      }
      const docs = snapshot.docs;
      const deleted = await deleteDocsInBatches(docs, db, 500);
      return NextResponse.json({ success: true, deleted, message: `Deleted ${deleted} docs` });
    }

    // MODE B: olderThan (milliseconds)
    if (olderThan && typeof olderThan === 'number' && olderThan > 0) {
      const cutoffMs = Date.now() - olderThan;
      console.log('Cleanup requested: olderThan(ms)=', olderThan, 'cutoff=', new Date(cutoffMs).toISOString());

      // first try numeric timestamp (epoch ms)
      let snapshot = await historyRef.where('timestamp', '<', cutoffMs).get();

      // if none found, try Firestore Timestamp type
      if (snapshot.empty) {
        try {
          const tsCutoff = Timestamp.fromMillis(cutoffMs);
          snapshot = await historyRef.where('timestamp', '<', tsCutoff).get();
        } catch (err) {
          console.warn('Timestamp query attempt failed:', err.message || err);
        }
      }

      if (snapshot.empty) {
        return NextResponse.json({ success: true, deleted: 0, message: 'No documents older than cutoff' });
      }

      const docs = snapshot.docs;
      const deleted = await deleteDocsInBatches(docs, db, 500);
      return NextResponse.json({ success: true, deleted, message: `Deleted ${deleted} docs` });
    }

    // If neither param provided, return helpful error
    return NextResponse.json({ success: false, error: 'Provide deleteCount (number) or olderThan (ms)' }, { status: 400 });

  } catch (error) {
    console.error('Cleanup error:', error);
    return NextResponse.json({
      success: false,
      error: 'Cleanup failed',
      details: error?.message || String(error)
    }, { status: 500 });
  }
}
