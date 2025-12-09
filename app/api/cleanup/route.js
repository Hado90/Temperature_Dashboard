// app/api/cleanup/route.js
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';

// Initialize Firebase Admin
if (!getApps().length) {
  try {
    // Validasi environment variables
    if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
      console.error('❌ Missing Firebase environment variables!');
      console.error('Required: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY');
    }

    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
    console.log('✅ Firebase Admin initialized successfully');
  } catch (error) {
    console.error('❌ Firebase Admin init error:', error);
  }
}

export async function POST(request) {
  try {
    const { olderThan } = await request.json();
    
    if (!olderThan) {
      return NextResponse.json(
        { 
          success: false,
          error: 'Parameter olderThan diperlukan' 
        },
        { status: 400 }
      );
    }

    // Validasi Firebase Admin
    if (getApps().length === 0) {
      return NextResponse.json(
        { 
          success: false,
          error: 'Firebase Admin tidak terinisialisasi. Cek environment variables.' 
        },
        { status: 500 }
      );
    }

    const db = getFirestore();
    const cutoffTime = Date.now() - olderThan;
    
    console.log('🔍 Searching for data older than:', new Date(cutoffTime).toISOString());

    // Query documents older than cutoff
    const historyRef = db.collection('sensorData').doc('data').collection('history');
    const snapshot = await historyRef.where('timestamp', '<', cutoffTime).get();

    console.log('📊 Found documents:', snapshot.size);

    if (snapshot.empty) {
      return NextResponse.json({ 
        success: true, 
        deleted: 0,
        message: 'Tidak ada data lama yang ditemukan'
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
    console.log('✅ Successfully deleted', deleteCount, 'documents');

    return NextResponse.json({ 
      success: true, 
      deleted: deleteCount,
      cutoffTime: new Date(cutoffTime).toISOString(),
      message: `Berhasil menghapus ${deleteCount} data`
    });

  } catch (error) {
    console.error('❌ Cleanup error:', error);
    
    // Detailed error response
    return NextResponse.json(
      { 
        success: false,
        error: 'Cleanup gagal',
        details: error.message,
        code: error.code || 'UNKNOWN',
        hint: error.code === 'permission-denied' 
          ? 'Periksa Firebase Security Rules' 
          : 'Periksa environment variables dan koneksi Firebase'
      },
      { status: 500 }
    );
  }
}
