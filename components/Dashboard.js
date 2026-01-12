'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Battery, RefreshCw, Zap, Thermometer, Activity, AlertCircle, TrendingUp, CheckCircle, Settings, ArrowRight, Download, Camera } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

function parseTimestamp(raw) {
  if (raw == null) return null;
  // ✅ PERBAIKAN: Handle both seconds (10 digits) and milliseconds (13 digits)
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // If 10 digits (seconds), convert to milliseconds
    return raw < 10000000000 ? raw * 1000 : raw;
  if (typeof raw === 'string' && /^[0-9]+$/.test(raw)) {
    const parsed = parseInt(raw, 10);
    // If 10 digits (seconds), convert to milliseconds
    return parsed < 10000000000 ? parsed * 1000 : parsed;
  }
  return null;
}

function formatTime(timestamp) {
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleTimeString('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false // Format 24 jam
  });
}

// Tambahkan fungsi baru untuk label grafik (lebih ringkas)
function formatChartTime(timestamp) {
  if (!timestamp) return '—';
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}
const BatteryChargerDashboard = () => {
  // Configuration state
  const [showConfig, setShowConfig] = useState(true);
  const [voltageChoice, setVoltageChoice] = useState('3.7');
  const [capacityChoice, setCapacityChoice] = useState('1200');
  const [customCapacity, setCustomCapacity] = useState('');
  const [configSending, setConfigSending] = useState(false);
  const [targetVoltage, setTargetVoltage] = useState(4.2); // Default 4.2V
  const [manualMode, setManualMode] = useState(false);
  const [manualVref, setManualVref] = useState('');
  const [manualIref, setManualIref] = useState('');
  // Tambahkan state ini setelah state yang sudah ada
  const [refreshLogs, setRefreshLogs] = useState([]);
  const MAX_LOGS = 10; // Simpan 10 log terakhir saja
  // Monitoring states
  const [latestTemp, setLatestTemp] = useState(null);
  const [latestCharger, setLatestCharger] = useState(null);
  const [tempHistory, setTempHistory] = useState([]);
  const [chargerHistory, setChargerHistory] = useState([]);
  const [currentState, setCurrentState] = useState('idle');
  const [previousState, setPreviousState] = useState('idle');
  const [isLoggingActive, setIsLoggingActive] = useState(false);
  const [loggingStartTime, setLoggingStartTime] = useState(null);
  const prevStateRef = useRef('idle');
  const loggingActiveRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [doneLoading, setDoneLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [stats, setStats] = useState({ total: 0 });
  const firebaseInitialized = useRef(false);

  useEffect(() => {
    if (!firebaseInitialized.current) {
      initFirebase();
      firebaseInitialized.current = true;
    }
  }, []);

  const initFirebase = async () => {
    try {
      console.log('🔥 Initializing Firebase...');
      
      const { initializeApp } = await import('firebase/app');
      const { getDatabase, ref, onValue, push, set, remove } = await import('firebase/database');

      const firebaseConfig = {
        apiKey: "AIzaSyDAMbhoIi8YsG5btxVzw7K4aaIGPlH85EY",
        authDomain: "battery-monitor-29168.firebaseapp.com",
        databaseURL: "https://battery-monitor-29168-default-rtdb.firebaseio.com",
        projectId: "battery-monitor-29168",
      };

      const app = initializeApp(firebaseConfig);
      const rtdb = getDatabase(app);

      window.firebaseInstances = { rtdb, ref, onValue, push, set, remove };
      console.log('✅ Firebase initialized');
      
      checkConfiguration();
      setupRealtimeListeners();
      loadHistoryData();
    } catch (error) {
      console.error('❌ Firebase init error:', error.message);
      setLoading(false);
    }
  };

  const checkConfiguration = () => {
    if (!window.firebaseInstances) return;
    
    const { rtdb, ref, onValue } = window.firebaseInstances;
    
    // Listen to configuration status
    onValue(ref(rtdb, 'config/status'), (snapshot) => {
      const status = snapshot.val();
      console.log('📋 Config status:', status);
      
      // ✅ PERBAIKAN: Tambah pengecekan status 'charging'
      // If status is 'charging', 'configured', or 'running', show monitoring
      // If status is 'idle' or null, show config screen
      if (status === 'charging' || status === 'configured' || status === 'running') {
        setShowConfig(false);
      } else {
        setShowConfig(true);
      }
    });
    onValue(ref(rtdb, 'config/targetVoltage'), (snapshot) => {
    const voltage = snapshot.val();
    if (voltage) {
      setTargetVoltage(parseFloat(voltage));
      console.log('🔋 Target Voltage loaded:', voltage);
    }
  });
  };

  const handleSendConfiguration = async () => {
  if (!window.firebaseInstances) {
    alert('❌ Firebase not initialized');
    return;
  }

  // Validate custom capacity if selected
  let finalCapacity = parseInt(capacityChoice);
  
  if (capacityChoice === 'custom') {
    if (!customCapacity || customCapacity.trim() === '') {
      alert('⚠️ Masukkan nilai kapasitas custom!');
      return;
    }
    finalCapacity = parseInt(customCapacity);
    if (isNaN(finalCapacity) || finalCapacity < 100 || finalCapacity > 5000) {
      alert('⚠️ Kapasitas harus antara 100-5000 mAh!');
      return;
    }
  }

  // ✅ VALIDASI MANUAL MODE
  let vref, iref;
  
  if (manualMode) {
    // Mode Manual: validasi input user
    if (!validateManualInputs()) {
      return;
    }
    vref = parseFloat(manualVref);
    iref = parseFloat(manualIref);
  } else {
    // Mode Auto: hitung otomatis
    const voltage = parseFloat(voltageChoice);
    vref = voltage - 0.2;
    iref = finalCapacity * 0.5 / 1000; // 0.5C
    
    // Max limit check
    if (finalCapacity > 2200) {
      iref = 1.1;
    }
  }

  setConfigSending(true);
  
  try {
    const { rtdb, ref, set } = window.firebaseInstances;
    
    const voltage = parseFloat(voltageChoice);
    
    const configData = {
      targetVoltage: voltage,
      batteryCapacity: finalCapacity,
      vref: vref,
      iref: iref,
      status: 'charging',
      timestamp: Date.now()
    };
    
    console.log('📤 Sending config to RTDB:', configData);
    
    await set(ref(rtdb, 'config'), configData);
    
    console.log('✅ Configuration sent successfully');
    alert(`✅ Konfigurasi berhasil dikirim!\n\n` +
          `Target: ${voltage}V\n` +
          `Kapasitas: ${finalCapacity}mAh\n` +
          `Vref: ${vref.toFixed(2)}V\n` +
          `Iref: ${iref.toFixed(2)}A (${(iref * 1000).toFixed(0)}mA)\n` +
          `Mode: ${manualMode ? 'Manual' : 'Auto'}\n\n` +
          `🚀 ESP32 akan mulai charging...`);
    
    setTimeout(() => {
      setShowConfig(false);
      setConfigSending(false);
    }, 1000);
    
  } catch (error) {
    console.error('❌ Error sending config:', error);
    alert('❌ Gagal mengirim konfigurasi: ' + error.message);
    setConfigSending(false);
  }
};

  const setupRealtimeListeners = () => {
    if (!window.firebaseInstances) {
      console.error('❌ Firebase instances not available');
      return;
    }
    
    const { rtdb, ref, onValue, push, set } = window.firebaseInstances;

    console.log('📡 Setting up RTDB listeners...');

    // Charger state listener
    // Charger state listener
    const chargerRef = ref(rtdb, 'chargerData/latest');
    
    onValue(chargerRef, (snapshot) => {
      const data = snapshot.val();
      
      if (!data) return;
    
      // ✅ TRACKING REFRESH RATE (MENGGUNAKAN setRefreshLogs)
      const webReceiveTime = Date.now(); // UTC timestamp
      const firebaseTimestamp = parseTimestamp(data.timestamp); // ESP32 timestamp (UTC)
      
      if (firebaseTimestamp) {
        const delay = webReceiveTime - firebaseTimestamp; // Delay dalam ms
        
        // ✅ GUNAKAN setRefreshLogs (BUKAN setRefreshMetrics)
        setRefreshLogs(prev => {
          const newLog = {
            id: Date.now(),
            esp32Time: firebaseTimestamp,
            webTime: webReceiveTime,
            delay: delay,
            timestamp: new Date().toLocaleTimeString('id-ID', { 
              timeZone: 'Asia/Jakarta',
              hour12: false 
            })
          };
          
          // Simpan hanya 10 log terakhir
          const updated = [newLog, ...prev].slice(0, 10);
          
          // Console log untuk debugging (dengan UTC)
          console.log('📊 Refresh Delay:', {
            delay: `${delay}ms`,
            esp32UTC: new Date(firebaseTimestamp).toISOString(),
            webUTC: new Date(webReceiveTime).toISOString()
          });
          
          return updated;
        });
      }
    
      const stateFromRTDB = String(data.state || 'Unknown');
    
      const chargerData = {
        voltage: Number(data.voltage) || 0,
        current: Number(data.current) || 0,
        state: stateFromRTDB,
        timestamp: firebaseTimestamp || Date.now()
      };
      
      // ... SISA CODE YANG SUDAH ADA (state machine logic) ...
      const incomingState = String(data.state || 'Unknown');
      const prevState = prevStateRef.current;
      
      const prevUpper = prevState.toUpperCase();
      const currUpper = incomingState.toUpperCase();
      
      if (currUpper === 'IDLE' && loggingActiveRef.current) {
        console.log('🔴 STOP LOGGING: Returned to IDLE');
        loggingActiveRef.current = false;
        setIsLoggingActive(false);
      }
      
      if (
        prevUpper === 'DETECT' &&
        currUpper !== 'DETECT' &&
        !loggingActiveRef.current
      ) {
        console.log('🟢 LOGGING START (DETECT EXIT):', prevState, '→', incomingState);
        loggingActiveRef.current = true;
        setIsLoggingActive(true);
        setLoggingStartTime(Date.now());
      }
      
      if (
        !loggingActiveRef.current &&
        currUpper !== 'IDLE' &&
        currUpper !== 'DETECT' &&
        currUpper !== 'WAIT_CFG'
      ) {
        console.warn('⚠️ FALLBACK LOGGING START:', prevState, '→', incomingState);
        loggingActiveRef.current = true;
        setIsLoggingActive(true);
        setLoggingStartTime(Date.now());
      }
    
      prevStateRef.current = incomingState;
      setPreviousState(prevState);
      setCurrentState(incomingState);
      setLatestCharger(chargerData);
      
      if (loggingActiveRef.current) {
        logChargerData(chargerData, push, set, ref, rtdb);
      }
    });

    // Temperature listener
    const tempRef = ref(rtdb, 'sensorData/temperature');
    
    onValue(tempRef, (snapshot) => {
      const data = snapshot.val();
      
      if (!data) return;

      const tempData = {
        celsius: Number(data.celsius) || 0,
        fahrenheit: Number(data.fahrenheit) || 0,
        timestamp: parseTimestamp(data.timestamp) || Date.now()
      };
      
      setLatestTemp(tempData);

      if (loggingActiveRef.current) {
        logTemperatureData(tempData, push, set, ref, rtdb);
      }
    });

    console.log('✅ All listeners set up');
    setLoading(false);
  };

  const logChargerData = async (chargerData, push, set, ref, rtdb) => {
    try {
      const historyRef = ref(rtdb, 'chargerData/history');
      const newRef = push(historyRef);
      
      const dataToLog = {
        voltage: chargerData.voltage,
        current: chargerData.current,
        state: chargerData.state,
        timestamp: chargerData.timestamp,
        formattedTime: formatTime(chargerData.timestamp)
      };
      
      await set(newRef, dataToLog);
      console.log('✅ Charger data logged');
    } catch (error) {
      console.error('❌ Error logging charger:', error.message);
    }
  };

  const logTemperatureData = async (tempData, push, set, ref, rtdb) => {
    try {
      const historyRef = ref(rtdb, 'sensorData/history');
      const newRef = push(historyRef);
      
      const dataToLog = {
        celsius: tempData.celsius,
        fahrenheit: tempData.fahrenheit,
        timestamp: tempData.timestamp,
        formattedTime: formatTime(tempData.timestamp)
      };
      
      await set(newRef, dataToLog);
      console.log('✅ Temperature logged');
    } catch (error) {
      console.error('❌ Error logging temp:', error.message);
    }
  };

  const loadHistoryData = useCallback(() => {
    if (!window.firebaseInstances) return;
    const { rtdb, ref, onValue } = window.firebaseInstances;

    onValue(ref(rtdb, 'sensorData/history'), (snapshot) => {
      const data = snapshot.val();
      if (!data) {
        setTempHistory([]);
        return;
      }
      const history = Object.entries(data).map(([key, value]) => ({
        id: key,
        celsius: Number(value.celsius) || 0,
        fahrenheit: Number(value.fahrenheit) || 0,
        timestamp: parseTimestamp(value.timestamp) || 0,
        formattedTime: value.formattedTime || formatTime(value.timestamp)
      }));
      history.sort((a, b) => a.timestamp - b.timestamp);
      setTempHistory(history);
    });

    onValue(ref(rtdb, 'chargerData/history'), (snapshot) => {
      const data = snapshot.val();
      if (!data) {
        setChargerHistory([]);
        setStats({ total: 0 });
        return;
      }
      const history = Object.entries(data).map(([key, value]) => ({
        id: key,
        voltage: Number(value.voltage) || 0,
        current: Number(value.current) || 0,
        state: value.state || '',
        timestamp: parseTimestamp(value.timestamp) || 0,
        formattedTime: value.formattedTime || formatTime(value.timestamp)
      }));
      history.sort((a, b) => a.timestamp - b.timestamp);
      setChargerHistory(history);
      setStats({ total: history.length });
    });
  }, []);

  // ✅ FUNGSI VALIDASI MANUAL MODE
  const getMaxVref = () => {
    const targetV = parseFloat(voltageChoice);
    return targetV - 0.1; // 3.7V -> max 3.6V, 4.2V -> max 4.1V
  };
  
  const getMaxIref = () => {
    let cap = capacityChoice === 'custom' ? parseInt(customCapacity || '0') : parseInt(capacityChoice);
    if (isNaN(cap)) cap = 0;
    
    const iref08C = (cap * 0.8) / 1000; // 0.8C dalam Ampere
    const maxAbsolute = 1.5; // 1.5A max absolute
    
    return Math.min(iref08C, maxAbsolute);
  };
  
  const validateManualInputs = () => {
    const vref = parseFloat(manualVref);
    const iref = parseFloat(manualIref);
    const maxVref = getMaxVref();
    const maxIref = getMaxIref();
    
    // Validasi Vref
    if (isNaN(vref) || vref <= 0) {
      alert('⚠️ Vref harus berupa angka positif!');
      return false;
    }
    if (vref > maxVref) {
      alert(`⚠️ Vref maksimal ${maxVref.toFixed(2)}V untuk target ${voltageChoice}V!`);
      return false;
    }
    
    // Validasi Iref
    if (isNaN(iref) || iref < 0.1) {
      alert('⚠️ Iref harus minimal 0.1A (100mA)!');
      return false;
    }
    if (iref > maxIref) {
      alert(`⚠️ Iref maksimal ${maxIref.toFixed(2)}A (${(maxIref * 1000).toFixed(0)}mA)!`);
      return false;
    }
    
    return true;
  };
  const handleDoneButton = async () => {
    const currStateUpper = currentState.toUpperCase();
    
    if (currStateUpper !== 'DONE') {
      alert('⚠️ Tombol DONE hanya bisa ditekan saat status DONE');
      return;
    }
    
    if (!confirm('Hapus semua data history, reset ke IDLE, dan kembali ke halaman konfigurasi?')) return;

    setDoneLoading(true);
    
    try {
      const { rtdb, ref, remove, set } = window.firebaseInstances;
      
      // Clear histories
      await remove(ref(rtdb, 'sensorData/history'));
      console.log('✅ Temperature history cleared');
      
      await remove(ref(rtdb, 'chargerData/history'));
      console.log('✅ Charger history cleared');
      
      // Reset config status to idle
      await set(ref(rtdb, 'config/status'), 'done');
      console.log('✅ Config status reset to DONE');
      
      // Reset state machine
      setCurrentState('idle');
      setPreviousState('idle');
      setIsLoggingActive(false);
      setLoggingStartTime(null);
      prevStateRef.current = 'idle';
      loggingActiveRef.current = false;
      
      console.log('✅ State machine reset');
      
      alert('✅ Data berhasil dihapus. Kembali ke halaman konfigurasi...');
      
      // Return to config screen
      setTimeout(() => {
        setShowConfig(true);
        setDoneLoading(false);
      }, 500);
      
    } catch (error) {
      console.error('❌ Clear error:', error);
      alert('❌ Gagal: ' + error.message);
      setDoneLoading(false);
    }
  };
    const handleResetCharging = async () => {
    // 1. Tampilkan konfirmasi dialog
    if (!confirm('⚠️ RESET CHARGING\n\nIni akan:\n• Menghapus semua data history\n• Menghentikan proses charging\n• Reset status ke DONE\n• Kembali ke halaman konfigurasi\n\nLanjutkan?')) {
      return;
    }
  
    // 2. Set loading state jadi true
    setResetLoading(true);
    
    try {
      // 3. Ambil Firebase instances
      const { rtdb, ref, remove, set } = window.firebaseInstances;
      
      // 4. Hapus temperature history dari Firebase
      await remove(ref(rtdb, 'sensorData/history'));
      console.log('✅ Temperature history cleared');
      
      // 5. Hapus charger history dari Firebase
      await remove(ref(rtdb, 'chargerData/history'));
      console.log('✅ Charger history cleared');
      
      // 6. Reset config status ke "done" (sama seperti tombol DONE)
      await set(ref(rtdb, 'config/status'), 'done');
      console.log('✅ Config status reset to DONE');
      
      // 7. Reset semua state machine di frontend
      setCurrentState('idle');
      setPreviousState('idle');
      setIsLoggingActive(false);
      setLoggingStartTime(null);
      prevStateRef.current = 'idle';
      loggingActiveRef.current = false;
      
      console.log('✅ State machine reset via manual reset');
      
      // 8. Tampilkan alert sukses
      alert('✅ Charging berhasil direset!\n\nKembali ke halaman konfigurasi...');
      
      // 9. Kembali ke halaman konfigurasi setelah 500ms
      setTimeout(() => {
        setShowConfig(true);
        setResetLoading(false);
      }, 500);
      
    } catch (error) {
      // 10. Error handling
      console.error('❌ Reset error:', error);
      alert('❌ Gagal reset: ' + error.message);
      setResetLoading(false);
    }
  };
  const tempChartData = tempHistory.map(item => ({
    time: item.formattedTime,
    celsius: item.celsius,
    fahrenheit: item.fahrenheit,
    timestamp: item.timestamp
  }));

  const chargerChartData = chargerHistory.map(item => ({
    time: item.formattedTime,
    voltage: item.voltage,
    current: item.current,
    timestamp: item.timestamp
  }));

  const TempTooltip = ({ active, payload }) => {
    if (!active || !payload || !payload.length) return null;
    const point = payload[0]?.payload;
    if (!point) return null;
    return (
      <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3">
        <p className="text-sm font-semibold text-gray-800 mb-2">{point.time}</p>
        <p className="text-sm text-orange-600">Celsius: {point.celsius?.toFixed(2)}°C</p>
        <p className="text-sm text-blue-600">Fahrenheit: {point.fahrenheit?.toFixed(2)}°F</p>
      </div>
    );
  };
  const ChargerTooltip = ({ active, payload }) => {
    if (!active || !payload || !payload.length) return null;
    const point = payload[0]?.payload;
    if (!point) return null;
    return (
      <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3">
        <p className="text-sm font-semibold text-gray-800 mb-2">{point.time}</p>
        <p className="text-sm text-green-600">Voltage: {point.voltage?.toFixed(2)}V</p>
        <p className="text-sm text-purple-600">Current: {point.current?.toFixed(2)}A</p>
      </div>
    );
  };

  // ✅ TAMBAHKAN CODE INI DI SINI ✅
  // Fungsi menghitung SOC berdasarkan voltage saat ini vs target
  const calculateSOC = () => {
    if (!latestCharger?.voltage || !targetVoltage) return 0;
    
    const currentVoltage = latestCharger.voltage;
    const minVoltage = 2.5; // Voltage minimum battery (kosong)
    const maxVoltage = targetVoltage; // Target voltage sebagai 100%
    
    // Hitung persentase
    const soc = ((currentVoltage - minVoltage) / (maxVoltage - minVoltage)) * 100;
    
    // Batasi antara 0-100%
    return Math.max(0, Math.min(100, soc));
  };

  const socPercentage = calculateSOC();
  // ✅ SAMPAI SINI ✅
  // ========================================
  // DOWNLOAD FUNCTIONS
  // ========================================
  
  const openChartInNewTab = (chartId, filename) => {
    const chartElement = document.getElementById(chartId);
    if (!chartElement) {
      alert('❌ Chart tidak ditemukan');
      return;
    }

    try {
      // Cari SVG element dari Recharts
      const svgElement = chartElement.querySelector('svg');
      if (!svgElement) {
        alert('❌ Chart belum ter-render. Coba lagi.');
        return;
      }

      // Clone SVG untuk preservasi styling
      const clonedSvg = svgElement.cloneNode(true);
      
      // Set explicit dimensions
      const width = svgElement.width.baseVal.value || 800;
      const height = svgElement.height.baseVal.value || 400;
      
      clonedSvg.setAttribute('width', width);
      clonedSvg.setAttribute('height', height);
      clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    
      // Add white background
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('width', '100%');
      rect.setAttribute('height', '100%');
      rect.setAttribute('fill', '#ffffff');
      clonedSvg.insertBefore(rect, clonedSvg.firstChild);
  
      // Convert SVG to string
      const svgData = new XMLSerializer().serializeToString(clonedSvg);
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const svgUrl = URL.createObjectURL(svgBlob);
  
      // Create canvas
      const canvas = document.createElement('canvas');
      canvas.width = width * 2; // 2x for better quality
      canvas.height = height * 2;
      const ctx = canvas.getContext('2d');
      
      // Scale for high DPI
      ctx.scale(2, 2);

      // Load SVG into image
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(svgUrl);
        
        // Convert canvas to PNG data URL
        const pngUrl = canvas.toDataURL('image/png');
        
        // Open in new tab
        const newWindow = window.open();
        if (newWindow) {
          newWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
              <title>${filename}</title>
              <style>
                body {
                  margin: 0;
                  display: flex;
                  justify-content: center;
                  align-items: center;
                  min-height: 100vh;
                  background: #f3f4f6;
                  font-family: system-ui, -apple-system, sans-serif;
                }
                .container {
                  text-align: center;
                  padding: 2rem;
                }
                img {
                  max-width: 100%;
                  height: auto;
                  box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                  border-radius: 8px;
                  background: white;
                }
                .instructions {
                  margin-top: 1rem;
                  color: #6b7280;
                  font-size: 0.875rem;
                }
                .download-btn {
                  margin-top: 1rem;
                  padding: 0.5rem 1rem;
                  background: #3b82f6;
                  color: white;
                  border: none;
                  border-radius: 0.5rem;
                  cursor: pointer;
                  font-size: 0.875rem;
                  font-weight: 600;
                }
                .download-btn:hover {
                  background: #2563eb;
                }
              </style>
            </head>
            <body>
              <div class="container">
                <img src="${pngUrl}" alt="${filename}" />
                <p class="instructions">
                  💡 <strong>Klik kanan pada gambar</strong> → <strong>Save Image As...</strong> untuk download
                </p>
                <button class="download-btn" onclick="downloadImage()">
                  📥 Download Langsung
                </button>
              </div>
              <script>
                function downloadImage() {
                  const link = document.createElement('a');
                  link.download = '${filename}_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.png';
                  link.href = '${pngUrl}';
                  link.click();
                }
              </script>
            </body>
            </html>
          `);
          newWindow.document.close();
        } else {
          alert('⚠️ Pop-up diblokir. Izinkan pop-up untuk membuka gambar di tab baru.');
        }
      };
    
      img.onerror = () => {
        URL.revokeObjectURL(svgUrl);
        alert('❌ Gagal memuat chart. Coba lagi.');
      };
      
      img.src = svgUrl;
      
    } catch (error) {
      console.error('Error opening chart:', error);
      alert('❌ Gagal membuka chart. Coba lagi.');
    }
  };

  const downloadChargerCSV = () => {
    if (chargerHistory.length === 0) {
      alert('⚠️ Tidak ada data untuk didownload');
      return;
    }

    // Header CSV
    const headers = ['Timestamp', 'Waktu', 'Voltage (V)', 'Current (A)', 'State'];
    
    // Data rows
    const rows = chargerHistory.map(item => [
      item.timestamp,
      formatTime(item.timestamp),
      item.voltage.toFixed(4),
      item.current.toFixed(4),
      item.state
    ]);

    // Combine
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    // Download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `charger_data_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadTemperatureCSV = () => {
    if (tempHistory.length === 0) {
      alert('⚠️ Tidak ada data untuk didownload');
      return;
    }

    const headers = ['Timestamp', 'Waktu', 'Celsius (°C)', 'Fahrenheit (°F)'];
    
    const rows = tempHistory.map(item => [
      item.timestamp,
      formatTime(item.timestamp),
      item.celsius.toFixed(4),
      item.fahrenheit.toFixed(4)
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `temperature_data_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="w-12 h-12 text-blue-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  // ========================================
  // CONFIGURATION SCREEN
  // ========================================
  if (showConfig) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full">
          <div className="flex items-center justify-center mb-6">
            <div className="bg-blue-500 p-4 rounded-xl">
              <Settings className="w-10 h-10 text-white" />
            </div>
          </div>
          
          <h1 className="text-3xl font-bold text-gray-800 text-center mb-2">
            Battery Charger
          </h1>
          <p className="text-gray-500 text-center mb-8">
            Konfigurasi Parameter Charging
          </p>

          {/* Voltage Selection */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 mb-3">
              Target Voltage
            </label>
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => setVoltageChoice('3.7')}
                className={`p-4 rounded-xl border-2 transition-all ${
                  voltageChoice === '3.7'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-blue-300'
                }`}
              >
                <div className="text-2xl font-bold mb-1">3.7V</div>
                <div className="text-xs">LiFePO4 / Storage</div>
              </button>
              <button
                onClick={() => setVoltageChoice('4.2')}
                className={`p-4 rounded-xl border-2 transition-all ${
                  voltageChoice === '4.2'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-blue-300'
                }`}
              >
                <div className="text-2xl font-bold mb-1">4.2V</div>
                <div className="text-xs">Li-ion / Full Charge</div>
              </button>
            </div>
          </div>

          {/* Capacity Selection */}
          <div className="mb-8">
            <label className="block text-sm font-semibold text-gray-700 mb-3">
              Battery Capacity
            </label>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <button
                onClick={() => setCapacityChoice('1200')}
                className={`p-4 rounded-xl border-2 transition-all ${
                  capacityChoice === '1200'
                    ? 'border-green-500 bg-green-50 text-green-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-green-300'
                }`}
              >
                <div className="text-2xl font-bold mb-1">1200</div>
                <div className="text-xs">mAh</div>
              </button>
              <button
                onClick={() => setCapacityChoice('2200')}
                className={`p-4 rounded-xl border-2 transition-all ${
                  capacityChoice === '2200'
                    ? 'border-green-500 bg-green-50 text-green-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-green-300'
                }`}
              >
                <div className="text-2xl font-bold mb-1">2200</div>
                <div className="text-xs">mAh</div>
              </button>
              <button
                onClick={() => setCapacityChoice('custom')}
                className={`p-4 rounded-xl border-2 transition-all ${
                  capacityChoice === 'custom'
                    ? 'border-green-500 bg-green-50 text-green-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-green-300'
                }`}
              >
                <div className="text-xl font-bold mb-1">Custom</div>
                <div className="text-xs">Enter value</div>
              </button>
            </div>
            
            {capacityChoice === 'custom' && (
              <div className="mt-3">
                <input
                  type="number"
                  value={customCapacity}
                  onChange={(e) => setCustomCapacity(e.target.value)}
                  placeholder="Enter capacity (100-5000 mAh)"
                  min="100"
                  max="5000"
                  className="w-full px-4 py-3 border-2 border-green-300 rounded-xl focus:border-green-500 focus:outline-none text-lg font-semibold text-gray-800"
                />
                <p className="text-xs text-gray-500 mt-2">
                  Untuk kapasitas &gt; 2200mAh, Iref tetap 1.1A (max limit)
                </p>
              </div>
            )}
          </div>

          {/* Calculated Parameters Display */}
          <div className="bg-gray-50 rounded-xl p-4 mb-6">
            {/* Toggle Manual/Auto Mode */}
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-700">Calculated Parameters:</h3>
              <button
                onClick={() => {
                  setManualMode(!manualMode);
                  setManualVref('');
                  setManualIref('');
                }}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  manualMode 
                    ? 'bg-orange-500 text-white' 
                    : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                }`}
              >
                {manualMode ? '🔧 Manual Mode' : '🤖 Auto Mode'}
              </button>
            </div>
          
            {!manualMode ? (
              // AUTO MODE
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Vref:</span>
                  <span className="font-semibold text-gray-800">
                    {(parseFloat(voltageChoice) - 0.2).toFixed(2)}V
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Iref (0.5C):</span>
                  <span className="font-semibold text-gray-800">
                    {(() => {
                      let cap = capacityChoice === 'custom' ? parseInt(customCapacity || '0') : parseInt(capacityChoice);
                      if (isNaN(cap)) cap = 0;
                      const iref = cap > 2200 ? 1.1 : (cap * 0.5 / 1000);
                      return iref.toFixed(2);
                    })()}A ({(() => {
                      let cap = capacityChoice === 'custom' ? parseInt(customCapacity || '0') : parseInt(capacityChoice);
                      if (isNaN(cap)) cap = 0;
                      const iref = cap > 2200 ? 1100 : (cap * 0.5);
                      return iref.toFixed(0);
                    })()}mA)
                  </span>
                </div>
                {capacityChoice === 'custom' && parseInt(customCapacity || '0') > 2200 && (
                  <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800">
                    ⚠️ Kapasitas &gt; 2200mAh, Iref dibatasi ke 1.1A (safety limit)
                  </div>
                )}
              </div>
            ) : (
              // ✅ MANUAL MODE
              <div className="space-y-4">
                {/* Manual Vref Input */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-2">
                    Vref (Voltage Reference)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={manualVref}
                    onChange={(e) => setManualVref(e.target.value)}
                    placeholder={`Max: ${getMaxVref().toFixed(2)}V`}
                    className="w-full px-3 py-2 border-2 border-orange-300 rounded-lg focus:border-orange-500 focus:outline-none text-sm font-semibold"
                  />
                  <p className="text-xs text-red-500 mt-1">
                    ⚠️ Maksimal: {getMaxVref().toFixed(2)}V (Target {voltageChoice}V - 0.1V)
                  </p>
                </div>
          
                {/* Manual Iref Input */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-2">
                    Iref (Current Reference)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={manualIref}
                    onChange={(e) => setManualIref(e.target.value)}
                    placeholder={`Max: ${getMaxIref().toFixed(2)}A`}
                    className="w-full px-3 py-2 border-2 border-orange-300 rounded-lg focus:border-orange-500 focus:outline-none text-sm font-semibold"
                  />
                  <p className="text-xs text-red-500 mt-1">
                    ⚠️ Min: 0.1A (100mA) | Max: {getMaxIref().toFixed(2)}A ({(getMaxIref() * 1000).toFixed(0)}mA)
                    {capacityChoice === 'custom' && getMaxIref() >= 1.5 && (
                      <span className="block mt-1">📌 Dibatasi 1.5A (max absolute)</span>
                    )}
                  </p>
                </div>
          
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-2 text-xs text-orange-800">
                  ℹ️ Manual mode: Anda mengatur Vref dan Iref sendiri sesuai kebutuhan
                </div>
              </div>
            )}
          </div>

          {/* Submit Button */}
          <button
            onClick={handleSendConfiguration}
            disabled={configSending}
            className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-3 transition-all ${
              configSending
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white hover:from-blue-600 hover:to-indigo-600 shadow-lg hover:shadow-xl'
            }`}
          >
            {configSending ? (
              <>
                <RefreshCw className="w-6 h-6 animate-spin" />
                Mengirim...
              </>
            ) : (
              <>
                <CheckCircle className="w-6 h-6" />
                Selesai & Mulai Charging
                <ArrowRight className="w-5 h-5" />
              </>
            )}
          </button>

          <p className="text-xs text-gray-400 text-center mt-4">
            Konfigurasi akan dikirim ke ESP32 via Firebase RTDB
          </p>
        </div>
      </div>
    );
  }

  // ========================================
  // MONITORING SCREEN (Original Dashboard)
  // ========================================
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        
        {/* Header */}
        <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-blue-500 p-3 rounded-xl">
                <Battery className="w-8 h-8 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-800">Battery Charger Monitor</h1>
                <p className="text-gray-500">Real-time Monitoring Dashboard</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className={`px-4 py-2 rounded-xl flex items-center gap-2 ${
                isLoggingActive ? 'bg-green-100 text-green-700' : 
                currentState.toUpperCase() === 'DETECT' ? 'bg-yellow-100 text-yellow-700' :
                'bg-gray-100 text-gray-500'
              }`}>
                <div className={`w-3 h-3 rounded-full ${
                  isLoggingActive ? 'bg-green-500 animate-pulse' : 
                  currentState.toUpperCase() === 'DETECT' ? 'bg-yellow-500 animate-pulse' :
                  'bg-gray-400'
                }`} />
                <span className="font-medium text-sm">
                  {isLoggingActive ? `Logging: ${currentState}` : 
                   currentState.toUpperCase() === 'DETECT' ? 'Waiting for state change...' :
                   `Standby (${currentState})`}
                </span>
              </div>
              <button onClick={loadHistoryData} className="p-3 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors">
                <RefreshCw className="w-6 h-6 text-blue-500" />
              </button>
            </div>
          </div>
        </div>

        {/* Value Cards */}
        {/* ✅ REFRESH RATE LOG (HISTORIS SEDERHANA) */}
        {refreshLogs.length > 0 && (
          <div className="bg-white rounded-2xl shadow-xl p-6 mb-6 border-2 border-blue-200">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="bg-blue-100 p-3 rounded-xl">
                  <Activity className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-800">
                    🔍 Refresh Rate Log (Testing)
                  </h3>
                  <p className="text-sm text-gray-500">
                    Last {refreshLogs.length} updates • ESP32 → Firebase → Web
                  </p>
                </div>
              </div>
              
              {/* Latest Delay Badge */}
              <div className={`px-4 py-2 rounded-xl font-bold text-lg ${
                refreshLogs[0].delay < 500 ? 'bg-green-100 text-green-700' :
                refreshLogs[0].delay < 1000 ? 'bg-yellow-100 text-yellow-700' :
                'bg-red-100 text-red-700'
              }`}>
                {refreshLogs[0].delay}ms
              </div>
            </div>
        
            {/* Log Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-gray-200">
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">No</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">Time</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">ESP32 Send</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">Web Receive</th>
                    <th className="text-right py-3 px-4 font-semibold text-gray-700">Delay</th>
                    <th className="text-center py-3 px-4 font-semibold text-gray-700">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {refreshLogs.map((log, index) => (
                    <tr 
                      key={log.id} 
                      className={`border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                        index === 0 ? 'bg-blue-50' : ''
                      }`}
                    >
                      <td className="py-3 px-4 text-gray-600">
                        {index + 1}
                      </td>
                      <td className="py-3 px-4 font-mono text-gray-800">
                        {log.timestamp}
                      </td>
                      <td className="py-3 px-4 font-mono text-gray-600 text-xs">
                        {new Date(log.esp32Time).toLocaleTimeString('id-ID', { 
                          hour12: false,
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit'
                        })}.{String(log.esp32Time % 1000).padStart(3, '0')}
                      </td>
                      <td className="py-3 px-4 font-mono text-gray-600 text-xs">
                        {new Date(log.webTime).toLocaleTimeString('id-ID', { 
                          hour12: false,
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit'
                        })}.{String(log.webTime % 1000).padStart(3, '0')}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span className={`font-bold ${
                          log.delay < 500 ? 'text-green-600' :
                          log.delay < 1000 ? 'text-yellow-600' :
                          'text-red-600'
                        }`}>
                          {log.delay}ms
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold ${
                          log.delay < 500 ? 'bg-green-100 text-green-700' :
                          log.delay < 1000 ? 'bg-yellow-100 text-yellow-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          <div className={`w-2 h-2 rounded-full ${
                            log.delay < 500 ? 'bg-green-500' :
                            log.delay < 1000 ? 'bg-yellow-500' :
                            'bg-red-500'
                          }`} />
                          {log.delay < 500 ? 'Fast' :
                           log.delay < 1000 ? 'Good' :
                           'Slow'}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
        
            {/* Statistics Summary */}
            <div className="mt-4 grid grid-cols-3 gap-4 p-4 bg-gray-50 rounded-xl">
              <div className="text-center">
                <p className="text-xs text-gray-500 mb-1">Average</p>
                <p className="text-lg font-bold text-blue-600">
                  {Math.round(refreshLogs.reduce((sum, log) => sum + log.delay, 0) / refreshLogs.length)}ms
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500 mb-1">Fastest</p>
                <p className="text-lg font-bold text-green-600">
                  {Math.min(...refreshLogs.map(log => log.delay))}ms
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500 mb-1">Slowest</p>
                <p className="text-lg font-bold text-red-600">
                  {Math.max(...refreshLogs.map(log => log.delay))}ms
                </p>
              </div>
            </div>
        
            {/* Legend */}
            <div className="mt-4 flex items-center justify-center gap-6 text-xs text-gray-600">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-500"></div>
                <span>&lt; 500ms (Fast)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                <span>500-1000ms (Good)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500"></div>
                <span>&gt; 1000ms (Slow)</span>
              </div>
            </div>
          </div>
        )}
        {/* Statistics */}
        <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
          <div className="flex items-center justify-between">
            
            {/* BAGIAN KIRI: Info (TIDAK BERUBAH) */}
            <div className="flex items-center gap-3">
              <div className="bg-green-100 p-3 rounded-xl">
                <TrendingUp className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-800">Current Charging Cycle</h3>
                <p className="text-sm text-gray-500">
                  {stats.total} data points logged
                  {loggingStartTime && isLoggingActive && (
                    <span className="ml-2 text-blue-600">
                      • Started {new Date(loggingStartTime).toLocaleTimeString('id-ID')}
                    </span>
                  )}
                </p>
              </div>
            </div>
            
            {/* ✅ BAGIAN KANAN: CONTAINER 2 TOMBOL (BARU) ✅ */}
            <div className="flex items-center gap-3">
              
              {/* ✅ TOMBOL 1: Reset Charging (BARU DITAMBAHKAN) */}
              <button 
                onClick={handleResetCharging}     
                disabled={resetLoading}           
                className={`px-6 py-3 rounded-xl font-semibold flex items-center gap-2 transition-all ${
                  resetLoading 
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-orange-500 hover:bg-orange-600 text-white shadow-lg hover:shadow-xl'
                }`}
              >
                {resetLoading ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    Resetting...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-5 h-5" />
                    Reset Charging
                  </>
                )}
              </button>

              {/* ✅ TOMBOL 2: DONE & Clear (DIPINDAH KE DALAM CONTAINER) */}
              <button 
                onClick={handleDoneButton} 
                disabled={doneLoading || currentState.toUpperCase() !== 'DONE'}
                className={`px-6 py-3 rounded-xl font-semibold flex items-center gap-2 transition-all ${
                  currentState.toUpperCase() === 'DONE' 
                    ? 'bg-green-500 hover:bg-green-600 text-white shadow-lg' 
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                {doneLoading ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    Clearing...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-5 h-5" />
                    DONE & Clear
                  </>
                )}
              </button>
              
            </div> 
            
          </div> 
          {/* SOC Battery Bar */}
          <div className="mt-4 bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Battery className="w-5 h-5 text-green-600" />
                <span className="text-sm font-semibold text-gray-700">State of Charge (SOC)</span>
              </div>
              <div className="text-right">
                <span className="text-2xl font-bold text-green-600">
                  {socPercentage.toFixed(1)}%
                </span>
                <p className="text-xs text-gray-500">
                  Target: {targetVoltage}V = 100%
                </p>
              </div>
            </div>
            
            {/* Progress Bar */}
            <div className="relative w-full h-8 bg-gray-200 rounded-full overflow-hidden shadow-inner">
              <div 
                className={`h-full rounded-full transition-all duration-500 flex items-center justify-end px-3 ${
                  socPercentage >= 80 ? 'bg-gradient-to-r from-green-400 to-green-500' :
                  socPercentage >= 50 ? 'bg-gradient-to-r from-yellow-400 to-yellow-500' :
                  socPercentage >= 20 ? 'bg-gradient-to-r from-orange-400 to-orange-500' :
                  'bg-gradient-to-r from-red-400 to-red-500'
                }`}
                style={{ width: `${socPercentage}%` }}
              >
                {socPercentage > 10 && (
                  <span className="text-white text-xs font-bold drop-shadow">
                    {socPercentage.toFixed(0)}%
                  </span>
                )}
              </div>
            </div>
            
            {/* Voltage Info */}
            <div className="mt-3 flex justify-between text-xs text-gray-600">
              <span>Current: {latestCharger?.voltage?.toFixed(2) || '--'}V</span>
              <span>Target: {targetVoltage}V</span>
            </div>
          </div>
        </div>

        {/* CHART 1: VOLTAGE & CURRENT */}
        <div className="bg-white rounded-2xl shadow-xl p-6 mb-6" id="charger-chart">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Zap className="w-6 h-6 text-green-500" />
              <h3 className="text-xl font-bold text-gray-800">
                Voltage & Current History ({chargerHistory.length} readings)
              </h3>
            </div>
            
            {/* Download Buttons */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => openChartInNewTab('charger-chart', 'voltage_current_chart')}
                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg flex items-center gap-2 transition-all text-sm font-semibold"
                title="Open chart in new tab for download"
              >
                <Camera className="w-4 h-4" />
                Open Image
              </button>
              <button
                onClick={downloadChargerCSV}
                className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg flex items-center gap-2 transition-all text-sm font-semibold"
                title="Download Data as CSV"
              >
                <Download className="w-4 h-4" />
                CSV
              </button>
            </div>
          </div>
          
          {chargerChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={400}>
              <LineChart data={chargerChartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                <XAxis 
                  dataKey="time" 
                  stroke="#666" 
                  style={{ fontSize: '12px' }} 
                  angle={-45} 
                  textAnchor="end" 
                  height={80} 
                  interval={Math.floor(chargerChartData.length / 20)} 
                />
                <YAxis yAxisId="left" stroke="#10b981" style={{ fontSize: '12px' }} label={{ value: 'Voltage (V)', angle: -90, position: 'insideLeft' }} />
                <YAxis yAxisId="right" orientation="right" stroke="#8b5cf6" style={{ fontSize: '12px' }} label={{ value: 'Current (A)', angle: 90, position: 'insideRight' }} />
                <Tooltip content={<ChargerTooltip />} />
                <Legend wrapperStyle={{ paddingTop: '20px' }} />
                <Line yAxisId="left" type="monotone" dataKey="voltage" stroke="#10b981" strokeWidth={2} dot={false} name="Voltage (V)" activeDot={{ r: 6 }} />
                <Line yAxisId="right" type="monotone" dataKey="current" stroke="#8b5cf6" strokeWidth={2} dot={false} name="Current (A)" activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-96 flex items-center justify-center text-gray-400">
              <div className="text-center">
                <Activity className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p>Waiting for charging cycle...</p>
                <p className="text-sm mt-2">Logging starts when <strong>DETECT</strong> changes to any other state</p>
              </div>
            </div>
          )}
        </div>

        {/* CHART 2: TEMPERATURE */}
        <div className="bg-white rounded-2xl shadow-xl p-6 mb-6" id="temperature-chart">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Thermometer className="w-6 h-6 text-orange-500" />
              <h3 className="text-xl font-bold text-gray-800">
                Temperature History ({tempHistory.length} readings)
              </h3>
            </div>
            {/* Download Buttons */}
            <div className="flex items-center gap-2">
            <button
              onClick={() => openChartInNewTab('temperature-chart', 'temperature_chart')}
              className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg flex items-center gap-2 transition-all text-sm font-semibold"
              title="Open chart in new tab for download"
            >
              <Camera className="w-4 h-4" />
              Open Image
            </button>
              <button
                onClick={downloadTemperatureCSV}
                className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg flex items-center gap-2 transition-all text-sm font-semibold"
                title="Download Data as CSV"
              >
                <Download className="w-4 h-4" />
                CSV
              </button>
            </div>
          </div>
          
          {tempChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={400}>
              <LineChart data={tempChartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                <XAxis 
                  dataKey="time" 
                  stroke="#666" 
                  style={{ fontSize: '12px' }} 
                  angle={-45} 
                  textAnchor="end" 
                  height={80} 
                  interval={Math.floor(tempChartData.length / 20)} 
                />
                <YAxis yAxisId="left" stroke="#f97316" style={{ fontSize: '12px' }} label={{ value: 'Celsius (°C)', angle: -90, position: 'insideLeft' }} />
                <YAxis yAxisId="right" orientation="right" stroke="#3b82f6" style={{ fontSize: '12px' }} label={{ value: 'Fahrenheit (°F)', angle: 90, position: 'insideRight' }} />
                <Tooltip content={<TempTooltip />} />
                <Legend wrapperStyle={{ paddingTop: '20px' }} />
                <Line yAxisId="left" type="monotone" dataKey="celsius" stroke="#f97316" strokeWidth={2} dot={false} name="Temperature (°C)" activeDot={{ r: 6 }} />
                <Line yAxisId="right" type="monotone" dataKey="fahrenheit" stroke="#3b82f6" strokeWidth={2} dot={false} name="Temperature (°F)" activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-96 flex items-center justify-center text-gray-400">
              <div className="text-center">
                <Activity className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p>Waiting for charging cycle...</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="text-center mt-8 text-gray-500 text-sm">
          <p>Battery Charger Monitor - State Machine Controlled Logging</p>
          <p className="mt-1">Web → Firebase RTDB → ESP32 Configuration System</p>
        </div>
      </div>
    </div>
  );
};

export default BatteryChargerDashboard;
