// app/api/cleanup/route.js
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';

if (!getApps().length) {
  try {
    if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
      console.error('❌ Missing Firebase environment variables!');
    }

    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
    console.log('✅ Firebase Admin initialized');
  } catch (error) {
    console.error('❌ Firebase Admin init error:', error);
  }
}

export async function POST(request) {
  try {
    const { deleteCount } = await request.json(); // ✅ CHANGED: accept deleteCount
    
    if (!deleteCount || deleteCount < 1) {
      return NextResponse.json(
        { 
          success: false,
          error: 'Parameter deleteCount harus lebih dari 0' 
        },
        { status: 400 }
      );
    }

    if (getApps().length === 0) {
      return NextResponse.json(
        { 
          success: false,
          error: 'Firebase Admin tidak terinisialisasi' 
        },
        { status: 500 }
      );
    }

    const db = getFirestore();
    
    console.log('🔍 Fetching oldest', deleteCount, 'documents...');

    // ✅ Query oldest documents by timestamp, limit to deleteCount
    const historyRef = db.collection('sensorData').doc('data').collection('history');
    const snapshot = await historyRef.orderBy('timestamp', 'asc').limit(deleteCount).get();

    console.log('📊 Found documents:', snapshot.size);

    if (snapshot.empty) {
      return NextResponse.json({ 
        success: true, 
        deleted: 0,
        message: 'Tidak ada data yang ditemukan'
      });
    }

    // Delete in batch
    const batch = db.batch();
    let deletedCount = 0;

    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
      deletedCount++;
    });

    await batch.commit();
    console.log('✅ Successfully deleted', deletedCount, 'documents');

    return NextResponse.json({ 
      success: true, 
      deleted: deletedCount,
      message: `Berhasil menghapus ${deletedCount} data tertua`
    });

  } catch (error) {
    console.error('❌ Cleanup error:', error);
    
    return NextResponse.json(
      { 
        success: false,
        error: 'Cleanup gagal',
        details: error.message,
        code: error.code || 'UNKNOWN'
      },
      { status: 500 }
    );
  }
}
