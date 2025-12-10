// app/api/cleanup/route.js
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';

if (!getApps().length) {
  try {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY;

    if (!projectId || !clientEmail || !privateKey) {
      console.error('❌ Missing Firebase environment variables!');
      throw new Error('Missing Firebase credentials');
    }

    console.log('🔑 Initializing Firebase Admin...');
    initializeApp({
      credential: cert({
        projectId: projectId,
        clientEmail: clientEmail,
        privateKey: privateKey.replace(/\\n/g, '\n'),
      }),
    });
    
    console.log('✅ Firebase Admin initialized');
  } catch (error) {
    console.error('❌ Firebase Admin init error:', error);
  }
}

export async function POST(request) {
  try {
    if (getApps().length === 0) {
      return NextResponse.json(
        { 
          success: false,
          error: 'Firebase Admin tidak terinisialisasi'
        },
        { status: 500 }
      );
    }

    const { deleteCount } = await request.json();
    
    if (!deleteCount || deleteCount < 1) {
      return NextResponse.json(
        { 
          success: false,
          error: 'Parameter deleteCount harus lebih dari 0' 
        },
        { status: 400 }
      );
    }

    const db = getFirestore();
    
    console.log('🔍 Attempting cleanup with deleteCount:', deleteCount);

    // ✅ TRY BOTH PATHS (prioritas path dengan subcollection)
    let snapshot;
    let queryPath = '';

    // Try path 1: sensorData/data/history (subcollection)
    try {
      console.log('📍 Trying path: sensorData/data/history');
      const historyRef = db.collection('sensorData').doc('data').collection('history');
      snapshot = await historyRef.orderBy('timestamp', 'asc').limit(deleteCount).get();
      queryPath = 'sensorData/data/history';
      console.log(`📊 Found ${snapshot.size} documents in ${queryPath}`);
    } catch (error) {
      console.log('⚠️ Path 1 failed:', error.message);
      
      // Try path 2: collection group 'history'
      try {
        console.log('📍 Trying collection group: history');
        snapshot = await db.collectionGroup('history').orderBy('timestamp', 'asc').limit(deleteCount).get();
        queryPath = 'collection group: history';
        console.log(`📊 Found ${snapshot.size} documents in ${queryPath}`);
      } catch (error2) {
        console.error('❌ Both paths failed');
        return NextResponse.json(
          { 
            success: false,
            error: 'Query failed',
            details: error2.message,
            hint: 'Periksa Firestore Index dan struktur data'
          },
          { status: 500 }
        );
      }
    }

    if (snapshot.empty) {
      console.log('ℹ️ No documents found to delete');
      return NextResponse.json({ 
        success: true, 
        deleted: 0,
        message: 'Tidak ada data yang ditemukan'
      });
    }

    // Delete documents
    const batch = db.batch();
    let deletedCount = 0;

    snapshot.docs.forEach((doc) => {
      console.log(`🗑️ Deleting doc: ${doc.id}, timestamp: ${doc.data().timestamp}`);
      batch.delete(doc.ref);
      deletedCount++;
    });

    await batch.commit();
    console.log('✅ Successfully deleted', deletedCount, 'documents from', queryPath);

    return NextResponse.json({ 
      success: true, 
      deleted: deletedCount,
      message: `Berhasil menghapus ${deletedCount} data tertua`,
      queryPath: queryPath
    });

  } catch (error) {
    console.error('❌ Cleanup error:', error);
    
    return NextResponse.json(
      { 
        success: false,
        error: 'Cleanup gagal',
        details: error.message,
        code: error.code || 'UNKNOWN',
        hint: error.code === 'permission-denied' 
          ? 'Periksa Firebase Security Rules' 
          : error.message.includes('index')
          ? 'Buat Firestore Index untuk query orderBy timestamp'
          : 'Periksa struktur data Firestore'
      },
      { status: 500 }
    );
  }
}
