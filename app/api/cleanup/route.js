// app/api/cleanup/route.js
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';

// Initialize Firebase Admin (hanya sekali)
if (!getApps().length) {
  try {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
  } catch (error) {
    console.error('Firebase Admin init error:', error);
  }
}

export async function POST(request) {
  try {
    const { olderThan } = await request.json();

    if (!olderThan) {
      return NextResponse.json(
        { error: 'olderThan parameter required' },
        { status: 400 }
      );
    }

    const db = getFirestore();
    const cutoffTime = Date.now() - olderThan;

    // Query documents older than cutoff
    const historyRef = db
      .collection('sensorData')
      .doc('data')
      .collection('history');
    const snapshot = await historyRef.where('timestamp', '<', cutoffTime).get();

    if (snapshot.empty) {
      return NextResponse.json({
        success: true,
        deleted: 0,
        message: 'No old data found',
      });
    }

    // Delete in batches (Firestore limit: 500 per batch)
    const batch = db.batch();
    let deleteCount = 0;

    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
      deleteCount++;
    });

    await batch.commit();

    return NextResponse.json({
      success: true,
      deleted: deleteCount,
      cutoffTime: new Date(cutoffTime).toISOString(),
    });
  } catch (error) {
    console.error('Cleanup error:', error);
    return NextResponse.json(
      { error: 'Cleanup failed', details: error.message },
      { status: 500 }
    );
  }
}
