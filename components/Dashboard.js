'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Battery, RefreshCw, Zap, Thermometer, Activity, AlertCircle, TrendingUp, CheckCircle, Settings, ArrowRight, Download } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

function parseTimestamp(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && /^[0-9]+$/.test(raw)) {
    return raw.length >= 13 ? parseInt(raw, 10) : parseInt(raw, 10) * 1000;
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
    hour12: false
  });
}

function formatChartTime(timestamp) {
  if (!timestamp) return '—';
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}
const BatteryChargerDashboard = () => {
  const [showConfig, setShowConfig] = useState(true);
  const [voltageChoice, setVoltageChoice] = useState('3.7');
  const [capacityChoice, setCapacityChoice] = useState('1200');
  const [customCapacity, setCustomCapacity] = useState('');
  const [configSending, setConfigSending] = useState(false);
  const [targetVoltage, setTargetVoltage] = useState(4.2);
  const [manualMode, setManualMode] = useState(false);
  const [manualVref, setManualVref] = useState('');
  const [manualIref, setManualIref] = useState('');
  
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
  // State untuk tracking fase charging
  const [phaseStats, setPhaseStats] = useState({
    cc: {
      energyWh: 0,
      duration: 0,
      startTime: null,
      endTime: null,
      tempSum: 0,
      tempCount: 0,
      voltageReadings: [],
      currentReadings: []
    },
    cv: {
      energyWh: 0,
      duration: 0,
      startTime: null,
      endTime: null,
      tempSum: 0,
      tempCount: 0,
      voltageReadings: [],
      currentReadings: []
    }
  });
  const [currentPhase, setCurrentPhase] = useState(null); // 'cc', 'transisi', 'cv', null
  const prevPhaseRef = useRef(null);
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
    
    onValue(ref(rtdb, 'config/status'), (snapshot) => {
      const status = snapshot.val();
      console.log('📋 Config status:', status);
      
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

    let vref, iref;
    
    if (manualMode) {
      if (!validateManualInputs()) {
        return;
      }
      vref = parseFloat(manualVref);
      iref = parseFloat(manualIref);
    } else {
      const voltage = parseFloat(voltageChoice);
      vref = voltage - 0.2;
      iref = finalCapacity * 0.5 / 1000;
      
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

    const chargerRef = ref(rtdb, 'chargerData/latest');
    
    onValue(chargerRef, (snapshot) => {
      const data = snapshot.val();
      
      if (!data) return;

      const stateFromRTDB = String(data.state || 'Unknown');

      const chargerData = {
        voltage: Number(data.voltage) || 0,
        current: Number(data.current) || 0,
        state: stateFromRTDB,
        timestamp: parseTimestamp(data.timestamp) || Date.now()
      };
      
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
      // ✅ TRACKING FASE DAN KALKULASI ENERGY
      const currState = incomingState.toUpperCase();
      
      // Deteksi fase saat ini
      let detectedPhase = null;
      if (currState === 'CC' || currState === 'TRANSISI') {
        detectedPhase = 'cc'; // CC + Transisi digabung
      } else if (currState === 'CV') {
        detectedPhase = 'cv';
      }
      
      // Update current phase
      setCurrentPhase(detectedPhase);
      
      // Jika fase berubah
      if (detectedPhase !== prevPhaseRef.current && detectedPhase !== null) {
        console.log(`🔄 Phase changed: ${prevPhaseRef.current} → ${detectedPhase}`);
        
        setPhaseStats(prev => {
          const newStats = { ...prev };
          
          // Start new phase
          if (!newStats[detectedPhase].startTime) {
            newStats[detectedPhase].startTime = Date.now();
            console.log(`▶️ ${detectedPhase.toUpperCase()} phase started`);
          }
          
          // End previous phase
          if (prevPhaseRef.current && prevPhaseRef.current !== detectedPhase) {
            const prevPhase = prevPhaseRef.current;
            if (!newStats[prevPhase].endTime) {
              newStats[prevPhase].endTime = Date.now();
              newStats[prevPhase].duration = 
                (newStats[prevPhase].endTime - newStats[prevPhase].startTime) / 1000; // detik
              console.log(`⏹️ ${prevPhase.toUpperCase()} phase ended: ${newStats[prevPhase].duration}s`);
            }
          }
          
          return newStats;
        });
      }
      
      prevPhaseRef.current = detectedPhase;
      
      // Akumulasi data jika sedang dalam fase
      if (detectedPhase && loggingActiveRef.current) {
        setPhaseStats(prev => {
          const newStats = { ...prev };
          const phase = newStats[detectedPhase];
          
          // Tambah voltage & current readings
          phase.voltageReadings.push(chargerData.voltage);
          phase.currentReadings.push(chargerData.current);
          
          // Hitung energy increment (Wh)
          // Energy = V * I * time_interval (dalam hours)
          // Asumsi data datang setiap 1 detik
          const timeIntervalHours = 1 / 3600; // 1 detik = 1/3600 jam
          const energyIncrement = chargerData.voltage * chargerData.current * timeIntervalHours;
          phase.energyWh += energyIncrement;
          
          // Tambah temperature data
          if (latestTemp?.celsius) {
            phase.tempSum += latestTemp.celsius;
            phase.tempCount += 1;
          }
          
          return newStats;
        });
      }
      if (loggingActiveRef.current) {
        logChargerData(chargerData, push, set, ref, rtdb);
      }
    });

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
        timestamp: webTimestamp, // ✅ Pakai timestamp web
        formattedTime: formatTime(webTimestamp) // ✅ Format dari web
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
        timestamp: webTimestamp, // ✅ Pakai timestamp web
        formattedTime: formatTime(webTimestamp) // ✅ Format dari web
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

  const getMaxVref = () => {
    const targetV = parseFloat(voltageChoice);
    return 4.2;
  };
  
  const getMaxIref = () => {
    let cap;
    
    if (capacityChoice === 'custom') {
      // Jika custom dipilih tapi belum diisi, return max absolute
      if (!customCapacity || customCapacity.trim() === '') {
        return 2.2; // Return 2.2A (max absolute)
      }
      cap = parseInt(customCapacity);
    } else {
      cap = parseInt(capacityChoice);
    }
    
    if (isNaN(cap)) cap = 0;
    
    const irefMax = cap / 1000; // Kapasitas dalam Ampere (1200mAh → 1.2A)
    const maxAbsolute = 2.2;
    
    return Math.min(irefMax, maxAbsolute);
  };
  
  const validateManualInputs = () => {
    const vref = parseFloat(manualVref);
    const iref = parseFloat(manualIref);
    const maxVref = getMaxVref();
    const maxIref = getMaxIref();
    
    if (isNaN(vref) || vref <= 0) {
      alert('⚠️ Vref harus berupa angka positif!');
      return false;
    }
    if (vref > maxVref) {
      alert(`⚠️ Vref maksimal ${maxVref.toFixed(2)}V untuk target ${voltageChoice}V!`);
      return false;
    }
    
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
      
      await remove(ref(rtdb, 'sensorData/history'));
      console.log('✅ Temperature history cleared');
      
      await remove(ref(rtdb, 'chargerData/history'));
      console.log('✅ Charger history cleared');
      
      await set(ref(rtdb, 'config/status'), 'done');
      console.log('✅ Config status reset to DONE');
      
      setCurrentState('idle');
      setPreviousState('idle');
      setIsLoggingActive(false);
      setLoggingStartTime(null);
      prevStateRef.current = 'idle';
      loggingActiveRef.current = false;
      
      console.log('✅ State machine reset');
      
      alert('✅ Data berhasil dihapus. Kembali ke halaman konfigurasi...');
      
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
    if (!confirm('⚠️ RESET CHARGING\n\nIni akan:\n• Menghapus semua data history\n• Menghentikan proses charging\n• Reset status ke DONE\n• Kembali ke halaman konfigurasi\n\nLanjutkan?')) {
      return;
    }
  
    setResetLoading(true);
    
    try {
      const { rtdb, ref, remove, set } = window.firebaseInstances;
      
      await remove(ref(rtdb, 'sensorData/history'));
      console.log('✅ Temperature history cleared');
      
      await remove(ref(rtdb, 'chargerData/history'));
      console.log('✅ Charger history cleared');
      
      await set(ref(rtdb, 'config/status'), 'done');
      console.log('✅ Config status reset to DONE');
      
      setCurrentState('idle');
      setPreviousState('idle');
      setIsLoggingActive(false);
      setLoggingStartTime(null);
      prevStateRef.current = 'idle';
      loggingActiveRef.current = false;
      // Reset phase stats
      setPhaseStats({
        cc: {
          energyWh: 0,
          duration: 0,
          startTime: null,
          endTime: null,
          tempSum: 0,
          tempCount: 0,
          voltageReadings: [],
          currentReadings: []
        },
        cv: {
          energyWh: 0,
          duration: 0,
          startTime: null,
          endTime: null,
          tempSum: 0,
          tempCount: 0,
          voltageReadings: [],
          currentReadings: []
        }
      });
      setCurrentPhase(null);
      prevPhaseRef.current = null;
      console.log('✅ State machine reset via manual reset');
      
      alert('✅ Charging berhasil direset!\n\nKembali ke halaman konfigurasi...');
      
      setTimeout(() => {
        setShowConfig(true);
        setResetLoading(false);
      }, 500);
      
    } catch (error) {
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

  const calculateSOC = () => {
    if (!latestCharger?.voltage || !targetVoltage) return 0;
    
    const currentVoltage = latestCharger.voltage;
    const minVoltage = 2.75;
    const maxVoltage = 4.2;
    
    const soc = ((currentVoltage - minVoltage) / (maxVoltage - minVoltage)) * 100;
    
    return Math.max(0, Math.min(100, soc));
  };

  const socPercentage = calculateSOC();
  const downloadChargerCSV = () => {
    if (chargerHistory.length === 0) {
      alert('⚠️ Tidak ada data untuk didownload');
      return;
    }

    const headers = ['Timestamp', 'Waktu', 'Voltage (V)', 'Current (A)', 'State'];
    
    const rows = chargerHistory.map(item => [
      item.timestamp,
      formatTime(item.timestamp),
      item.voltage.toFixed(4),
      item.current.toFixed(4),
      item.state
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

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

  if (showConfig) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-3 sm:p-4">
        <div className="bg-white rounded-xl sm:rounded-2xl shadow-2xl p-4 sm:p-6 md:p-8 max-w-md w-full">
          <div className="flex items-center justify-center mb-4 sm:mb-6">
            <div className="bg-blue-500 p-3 sm:p-4 rounded-xl">
              <Settings className="w-8 h-8 sm:w-10 sm:h-10 text-white" />
            </div>
          </div>
          
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 text-center mb-2">
            Battery Charger
          </h1>
          <p className="text-sm text-gray-500 text-center mb-6 sm:mb-8">
            Konfigurasi Parameter Charging
          </p>

          <div className="mb-4 sm:mb-6">
            <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-2 sm:mb-3">
              Target Voltage
            </label>
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <button
                onClick={() => setVoltageChoice('3.7')}
                className={`p-3 sm:p-4 rounded-xl border-2 transition-all ${
                  voltageChoice === '3.7'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-blue-300'
                }`}
              >
                <div className="text-xl sm:text-2xl font-bold mb-1">3.7V</div>
              </button>
              <button
                onClick={() => setVoltageChoice('4.2')}
                className={`p-3 sm:p-4 rounded-xl border-2 transition-all ${
                  voltageChoice === '4.2'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-blue-300'
                }`}
              >
                <div className="text-xl sm:text-2xl font-bold mb-1">4.2V</div>
              </button>
            </div>
          </div>

          <div className="mb-6 sm:mb-8">
            <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-2 sm:mb-3">
              Battery Capacity
            </label>
            <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-3">
              <button
                onClick={() => setCapacityChoice('1200')}
                className={`p-3 sm:p-4 rounded-xl border-2 transition-all ${
                  capacityChoice === '1200'
                    ? 'border-green-500 bg-green-50 text-green-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-green-300'
                }`}
              >
                <div className="text-xl sm:text-2xl font-bold mb-1">1200</div>
                <div className="text-xs">mAh</div>
              </button>
              <button
                onClick={() => setCapacityChoice('2200')}
                className={`p-3 sm:p-4 rounded-xl border-2 transition-all ${
                  capacityChoice === '2200'
                    ? 'border-green-500 bg-green-50 text-green-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-green-300'
                }`}
              >
                <div className="text-xl sm:text-2xl font-bold mb-1">2200</div>
                <div className="text-xs">mAh</div>
              </button>
              <button
                onClick={() => setCapacityChoice('custom')}
                className={`p-3 sm:p-4 rounded-xl border-2 transition-all ${
                  capacityChoice === 'custom'
                    ? 'border-green-500 bg-green-50 text-green-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-green-300'
                }`}
              >
                <div className="text-lg sm:text-xl font-bold mb-1">Custom</div>
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
                  className="w-full px-3 sm:px-4 py-2 sm:py-3 border-2 border-green-300 rounded-xl focus:border-green-500 focus:outline-none text-base sm:text-lg font-semibold text-gray-800"
                />
                <p className="text-xs text-gray-500 mt-2">
                  Untuk kapasitas &gt; 2200mAh, Iref tetap 1.1A (max limit)
                </p>
              </div>
            )}
          </div>

          <div className="bg-gray-50 rounded-xl p-3 sm:p-4 mb-4 sm:mb-6">
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <h3 className="text-xs sm:text-sm font-semibold text-gray-700">Calculated Parameters:</h3>
              <button
                onClick={() => {
                  setManualMode(!manualMode);
                  setManualVref('');
                  setManualIref('');
                }}
                className={`px-2 sm:px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  manualMode 
                    ? 'bg-orange-500 text-white' 
                    : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                }`}
              >
                {manualMode ? '🔧 Manual' : '🤖 Auto'}
              </button>
            </div>
          
            {!manualMode ? (
              <div className="space-y-2 text-xs sm:text-sm">
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
                    ⚠️ Kapasitas &gt; 2200mAh, Iref dibatasi ke 1.1A
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3 sm:space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1 sm:mb-2">
                    Vref (Voltage Reference)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={manualVref}
                    onChange={(e) => setManualVref(e.target.value)}
                    placeholder={`Max: ${getMaxVref().toFixed(2)}V`}
                    className="w-full px-2 sm:px-3 py-1.5 sm:py-2 border-2 border-orange-300 rounded-lg focus:border-orange-500 focus:outline-none text-sm font-semibold"
                  />
                  <p className="text-xs text-red-500 mt-1">
                    ⚠️ Max: {getMaxVref().toFixed(2)}V
                  </p>
                </div>
          
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1 sm:mb-2">
                    Iref (Current Reference)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={manualIref}
                    onChange={(e) => setManualIref(e.target.value)}
                    placeholder={`Max: ${getMaxIref().toFixed(2)}A`}
                    className="w-full px-2 sm:px-3 py-1.5 sm:py-2 border-2 border-orange-300 rounded-lg focus:border-orange-500 focus:outline-none text-sm font-semibold"
                  />
                  <p className="text-xs text-red-500 mt-1">
                    ⚠️ Min: 0.1A | Max: {getMaxIref().toFixed(2)}A
                  </p>
                </div>
          
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-2 text-xs text-orange-800">
                  ℹ️ Manual mode: Atur Vref dan Iref sendiri
                </div>
              </div>
            )}
          </div>

          <button
            onClick={handleSendConfiguration}
            disabled={configSending}
            className={`w-full py-3 sm:py-4 rounded-xl font-bold text-base sm:text-lg flex items-center justify-center gap-2 sm:gap-3 transition-all ${
              configSending
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white hover:from-blue-600 hover:to-indigo-600 shadow-lg hover:shadow-xl'
            }`}
          >
            {configSending ? (
              <>
                <RefreshCw className="w-5 h-5 sm:w-6 sm:h-6 animate-spin" />
                Mengirim...
              </>
            ) : (
              <>
                <CheckCircle className="w-5 h-5 sm:w-6 sm:h-6" />
                Selesai & Mulai Charging
                <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5" />
              </>
            )}
          </button>

          <p className="text-xs text-gray-400 text-center mt-3 sm:mt-4">
            Konfigurasi akan dikirim ke ESP32 via Firebase RTDB
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-2 sm:p-4 lg:p-6 xl:p-8 overflow-x-hidden">
      <div className="max-w-7xl mx-auto w-full">
        
        <div className="bg-white rounded-xl sm:rounded-2xl shadow-xl p-3 sm:p-4 lg:p-6 mb-3 sm:mb-4 lg:mb-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="bg-blue-500 p-2 sm:p-3 rounded-xl">
                <Battery className="w-6 h-6 sm:w-8 sm:h-8 text-white" />
              </div>
              <div>
                <h1 className="text-lg sm:text-2xl lg:text-3xl font-bold text-gray-800">Battery Charger Monitor</h1>
                <p className="text-xs sm:text-sm text-gray-500">Real-time Monitoring Dashboard</p>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-4 w-full sm:w-auto">
              <div className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl flex items-center gap-1 sm:gap-2 text-xs sm:text-sm flex-1 sm:flex-none ${
                isLoggingActive ? 'bg-green-100 text-green-700' : 
                currentState.toUpperCase() === 'DETECT' ? 'bg-yellow-100 text-yellow-700' :
                'bg-gray-100 text-gray-500'
              }`}>
                <div className={`w-2 h-2 sm:w-3 sm:h-3 rounded-full ${
                  isLoggingActive ? 'bg-green-500 animate-pulse' : 
                  currentState.toUpperCase() === 'DETECT' ? 'bg-yellow-500 animate-pulse' :
                  'bg-gray-400'
                }`} />
                <span className="font-medium truncate">
                  {isLoggingActive ? `Log: ${currentState}` : 
                   currentState.toUpperCase() === 'DETECT' ? 'Waiting...' :
                   `Standby`}
                </span>
              </div>
              <button onClick={loadHistoryData} className="p-2 sm:p-3 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors flex-shrink-0">
                <RefreshCw className="w-5 h-5 sm:w-6 sm:h-6 text-blue-500" />
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 lg:gap-4 xl:gap-6 mb-3 sm:mb-4 lg:mb-6">
          <div className="bg-gradient-to-br from-orange-500 to-red-500 rounded-xl sm:rounded-2xl shadow-xl p-3 sm:p-4 lg:p-6 text-white">
            <div className="flex items-center justify-between mb-2 sm:mb-4">
              <div className="bg-white/20 p-2 sm:p-3 rounded-xl"><Thermometer className="w-4 h-4 sm:w-6 sm:h-6" /></div>
              <span className="text-xs font-medium bg-white/20 px-2 py-0.5 sm:px-3 sm:py-1 rounded-full">Temp</span>
            </div>
            <div className="text-2xl sm:text-3xl lg:text-4xl xl:text-5xl font-bold mb-1 sm:mb-2">{latestTemp?.celsius != null ? latestTemp.celsius.toFixed(1) : '--'}</div>
            <p className="text-white/90 text-xs sm:text-sm lg:text-base xl:text-lg font-medium">°Celsius</p>
          </div>

          <div className="bg-gradient-to-br from-green-500 to-emerald-500 rounded-xl sm:rounded-2xl shadow-xl p-3 sm:p-4 lg:p-6 text-white">
            <div className="flex items-center justify-between mb-2 sm:mb-4">
              <div className="bg-white/20 p-2 sm:p-3 rounded-xl"><Zap className="w-4 h-4 sm:w-6 sm:h-6" /></div>
              <span className="text-xs font-medium bg-white/20 px-2 py-0.5 sm:px-3 sm:py-1 rounded-full">Volt</span>
            </div>
            <div className="text-2xl sm:text-3xl lg:text-4xl xl:text-5xl font-bold mb-1 sm:mb-2">{latestCharger?.voltage != null ? latestCharger.voltage.toFixed(2) : '--'}</div>
            <p className="text-white/90 text-xs sm:text-sm lg:text-base xl:text-lg font-medium">Volts</p>
          </div>

          <div className="bg-gradient-to-br from-purple-500 to-indigo-500 rounded-xl sm:rounded-2xl shadow-xl p-3 sm:p-4 lg:p-6 text-white">
            <div className="flex items-center justify-between mb-2 sm:mb-4">
              <div className="bg-white/20 p-2 sm:p-3 rounded-xl"><Activity className="w-4 h-4 sm:w-6 sm:h-6" /></div>
              <span className="text-xs font-medium bg-white/20 px-2 py-0.5 sm:px-3 sm:py-1 rounded-full">Curr</span>
            </div>
            <div className="text-2xl sm:text-3xl lg:text-4xl xl:text-5xl font-bold mb-1 sm:mb-2">{latestCharger?.current != null ? latestCharger.current.toFixed(2) : '--'}</div>
            <p className="text-white/90 text-xs sm:text-sm lg:text-base xl:text-lg font-medium">Amperes</p>
          </div>

          <div className={`rounded-xl sm:rounded-2xl shadow-xl p-3 sm:p-4 lg:p-6 text-white ${
            currentState.toUpperCase() === 'DONE' ? 'bg-gradient-to-br from-green-500 to-emerald-600' :
            currentState.toUpperCase() === 'IDLE' || currentState.toUpperCase() === 'WAIT_CFG' ? 'bg-gradient-to-br from-gray-400 to-gray-500' :
            currentState.toUpperCase() === 'DETECT' ? 'bg-gradient-to-br from-yellow-500 to-orange-500' :
            'bg-gradient-to-br from-blue-500 to-cyan-500'
          }`}>
            <div className="flex items-center justify-between mb-2 sm:mb-4">
              <div className="bg-white/20 p-2 sm:p-3 rounded-xl"><Battery className="w-4 h-4 sm:w-6 sm:h-6" /></div>
              <span className="text-xs font-medium bg-white/20 px-2 py-0.5 sm:px-3 sm:py-1 rounded-full">Status</span>
            </div>
            <div className="text-xl sm:text-2xl lg:text-3xl xl:text-4xl font-bold mb-1 sm:mb-2">{currentState || 'Unknown'}</div>
            <p className="text-white/90 text-xs sm:text-sm font-medium">Charger State</p>
          </div>
        </div>

        <div className="bg-white rounded-xl sm:rounded-2xl shadow-xl p-3 sm:p-4 lg:p-6 mb-3 sm:mb-4 lg:mb-6">
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3 sm:gap-4">
            
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="bg-green-100 p-2 sm:p-3 rounded-xl flex-shrink-0">
                <TrendingUp className="w-4 h-4 sm:w-6 sm:h-6 text-green-600" />
              </div>
              <div>
                <h3 className="text-sm sm:text-base lg:text-lg font-semibold text-gray-800">Current Charging Cycle</h3>
                <p className="text-xs sm:text-sm text-gray-500">
                  {stats.total} data points
                  {loggingStartTime && isLoggingActive && (
                    <span className="ml-2 text-blue-600">
                      • {new Date(loggingStartTime).toLocaleTimeString('id-ID')}
                    </span>
                  )}
                </p>
              </div>
            </div>
            
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full lg:w-auto">
              
              <button 
                onClick={handleResetCharging}     
                disabled={resetLoading}           
                className={`px-3 sm:px-4 lg:px-6 py-2 sm:py-2.5 lg:py-3 rounded-xl font-semibold flex items-center justify-center gap-1 sm:gap-2 transition-all text-xs sm:text-sm ${
                  resetLoading 
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-orange-500 hover:bg-orange-600 text-white shadow-lg hover:shadow-xl'
                }`}
              >
                {resetLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
                    <span className="hidden sm:inline">Resetting...</span>
                    <span className="sm:hidden">...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4 sm:w-5 sm:h-5" />
                    <span className="hidden sm:inline">Reset Charging</span>
                    <span className="sm:hidden">Reset</span>
                  </>
                )}
              </button>

              <button 
                onClick={handleDoneButton} 
                disabled={doneLoading || currentState.toUpperCase() !== 'DONE'}
                className={`px-3 sm:px-4 lg:px-6 py-2 sm:py-2.5 lg:py-3 rounded-xl font-semibold flex items-center justify-center gap-1 sm:gap-2 transition-all text-xs sm:text-sm ${
                  currentState.toUpperCase() === 'DONE' 
                    ? 'bg-green-500 hover:bg-green-600 text-white shadow-lg' 
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                {doneLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
                    <span className="hidden sm:inline">Clearing...</span>
                    <span className="sm:hidden">...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5" />
                    <span className="hidden sm:inline">DONE & Clear</span>
                    <span className="sm:hidden">Clear</span>
                  </>
                )}
              </button>
              
            </div> 
            
          </div>

          <div className="mt-3 sm:mt-4 bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-xl p-3 sm:p-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-2 sm:mb-3">
              <div className="flex items-center gap-1 sm:gap-2">
                <Battery className="w-4 h-4 sm:w-5 sm:h-5 text-green-600" />
                <span className="text-xs sm:text-sm font-semibold text-gray-700">State of Charge (SOC)</span>
              </div>
              <div className="text-left sm:text-right w-full sm:w-auto">
                <span className="text-xl sm:text-2xl font-bold text-green-600">
                  {socPercentage.toFixed(1)}%
                </span>
                <p className="text-xs text-gray-500">
                  Target: {targetVoltage}V = 100%
                </p>
              </div>
            </div>
            
            <div className="relative w-full h-6 sm:h-8 bg-gray-200 rounded-full overflow-hidden shadow-inner">
              <div 
                className={`h-full rounded-full transition-all duration-500 flex items-center justify-end px-2 sm:px-3 ${
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
            <div className="mt-2 sm:mt-3 flex justify-between text-xs text-gray-600">
              <span>Current: {latestCharger?.voltage?.toFixed(2) || '--'}V</span>
              <span>Target: {targetVoltage}V</span>
            </div>
            {/* ✅ BATTERY HEALTH SECTION */}
            <div className="mt-3 sm:mt-4 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-3 sm:p-4">
              <div className="flex items-center gap-2 mb-3">
                <Activity className="w-5 h-5 text-blue-600" />
                <h3 className="text-sm sm:text-base font-semibold text-gray-800">Battery Health - Charging Analysis</h3>
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                
                {/* CC + Transisi Phase */}
                <div className="bg-white rounded-lg p-3 border border-blue-100">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-bold text-blue-700">CC + Transisi Phase</h4>
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                      currentPhase === 'cc' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-500'
                    }`}>
                      {currentPhase === 'cc' ? 'Active' : 'Idle'}
                    </span>
                  </div>
                  
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Energy:</span>
                      <span className="font-semibold text-blue-600">
                        {phaseStats.cc.energyWh.toFixed(3)} Wh
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Duration:</span>
                      <span className="font-semibold text-gray-800">
                        {phaseStats.cc.duration > 0 
                          ? `${Math.floor(phaseStats.cc.duration / 60)}m ${Math.floor(phaseStats.cc.duration % 60)}s`
                          : currentPhase === 'cc' && phaseStats.cc.startTime
                            ? `${Math.floor((Date.now() - phaseStats.cc.startTime) / 60000)}m ${Math.floor(((Date.now() - phaseStats.cc.startTime) % 60000) / 1000)}s`
                            : '0s'
                        }
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Avg Temp:</span>
                      <span className="font-semibold text-orange-600">
                        {phaseStats.cc.tempCount > 0 
                          ? `${(phaseStats.cc.tempSum / phaseStats.cc.tempCount).toFixed(1)}°C`
                          : '--'
                        }
                      </span>
                    </div>
                  </div>
                </div>
                
                {/* CV Phase */}
                <div className="bg-white rounded-lg p-3 border border-green-100">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-bold text-green-700">CV Phase</h4>
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                      currentPhase === 'cv' ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-500'
                    }`}>
                      {currentPhase === 'cv' ? 'Active' : 'Idle'}
                    </span>
                  </div>
                  
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Energy:</span>
                      <span className="font-semibold text-green-600">
                        {phaseStats.cv.energyWh.toFixed(3)} Wh
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Duration:</span>
                      <span className="font-semibold text-gray-800">
                        {phaseStats.cv.duration > 0 
                          ? `${Math.floor(phaseStats.cv.duration / 60)}m ${Math.floor(phaseStats.cv.duration % 60)}s`
                          : currentPhase === 'cv' && phaseStats.cv.startTime
                            ? `${Math.floor((Date.now() - phaseStats.cv.startTime) / 60000)}m ${Math.floor(((Date.now() - phaseStats.cv.startTime) % 60000) / 1000)}s`
                            : '0s'
                        }
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Avg Temp:</span>
                      <span className="font-semibold text-orange-600">
                        {phaseStats.cv.tempCount > 0 
                          ? `${(phaseStats.cv.tempSum / phaseStats.cv.tempCount).toFixed(1)}°C`
                          : '--'
                        }
                      </span>
                    </div>
                  </div>
                </div>
                
              </div>
              
              {/* Total Summary */}
              <div className="mt-3 pt-3 border-t border-blue-200">
                <div className="flex justify-between items-center text-xs sm:text-sm">
                  <span className="font-semibold text-gray-700">Total Energy:</span>
                  <span className="text-lg font-bold text-indigo-600">
                    {(phaseStats.cc.energyWh + phaseStats.cv.energyWh).toFixed(3)} Wh
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl sm:rounded-2xl shadow-xl p-3 sm:p-4 lg:p-6 mb-3 sm:mb-4 lg:mb-6 overflow-hidden" id="charger-chart">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-3 mb-3 sm:mb-4 lg:mb-6">
            <div className="flex items-center gap-1 sm:gap-2">
              <Zap className="w-4 h-4 sm:w-5 sm:h-5 lg:w-6 lg:h-6 text-green-500" />
              <h3 className="text-sm sm:text-base lg:text-xl font-bold text-gray-800">
                Voltage & Current ({chargerHistory.length})
              </h3>
            </div>
            
            <div className="flex items-center gap-1 sm:gap-2 flex-wrap">
              <button
                onClick={downloadChargerCSV}
                className="px-2 sm:px-3 lg:px-4 py-1.5 sm:py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg flex items-center gap-1 sm:gap-2 transition-all text-xs sm:text-sm font-semibold"
              >
                <Download className="w-3 h-3 sm:w-4 sm:h-4" />
                <span className="hidden sm:inline">CSV</span>
                <span className="sm:hidden">💾</span>
              </button>
            </div>
          </div>
          
          {chargerChartData.length > 0 ? (
            <div className="w-full overflow-x-auto -mx-3 sm:-mx-4 lg:-mx-6 px-3 sm:px-4 lg:px-6">
              <div className="min-w-[500px]">
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={chargerChartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                    <XAxis 
                      dataKey="time" 
                      stroke="#666" 
                      style={{ fontSize: '10px' }} 
                      angle={-45} 
                      textAnchor="end" 
                      height={70} 
                      interval={Math.floor(chargerChartData.length / 12)} 
                      tick={{ fontSize: 10 }}
                    />
                    <YAxis yAxisId="left" stroke="#10b981" style={{ fontSize: '10px' }} label={{ value: 'Voltage (V)', angle: -90, position: 'insideLeft', style: { fontSize: '10px' } }} />
                    <YAxis yAxisId="right" orientation="right" stroke="#8b5cf6" style={{ fontSize: '10px' }} label={{ value: 'Current (A)', angle: 90, position: 'insideRight', style: { fontSize: '10px' } }} />
                    <Tooltip content={<ChargerTooltip />} />
                    <Legend wrapperStyle={{ paddingTop: '10px', fontSize: '11px' }} />
                    <Line yAxisId="left" type="monotone" dataKey="voltage" stroke="#10b981" strokeWidth={2} dot={false} name="Voltage (V)" activeDot={{ r: 6 }} />
                    <Line yAxisId="right" type="monotone" dataKey="current" stroke="#8b5cf6" strokeWidth={2} dot={false} name="Current (A)" activeDot={{ r: 6 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <div className="h-64 sm:h-80 lg:h-96 flex items-center justify-center text-gray-400">
              <div className="text-center">
                <Activity className="w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-3 sm:mb-4 opacity-50" />
                <p className="text-sm sm:text-base">Waiting for charging cycle...</p>
                <p className="text-xs sm:text-sm mt-2">Logging starts when <strong>DETECT</strong> changes</p>
              </div>
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl sm:rounded-2xl shadow-xl p-3 sm:p-4 lg:p-6 mb-3 sm:mb-4 lg:mb-6 overflow-hidden" id="temperature-chart">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-3 mb-3 sm:mb-4 lg:mb-6">
            <div className="flex items-center gap-1 sm:gap-2">
              <Thermometer className="w-4 h-4 sm:w-5 sm:h-5 lg:w-6 lg:h-6 text-orange-500" />
              <h3 className="text-sm sm:text-base lg:text-xl font-bold text-gray-800">
                Temperature History ({tempHistory.length})
              </h3>
            </div>
            <div className="flex items-center gap-1 sm:gap-2 flex-wrap">
              <button
                onClick={downloadTemperatureCSV}
                className="px-2 sm:px-3 lg:px-4 py-1.5 sm:py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg flex items-center gap-1 sm:gap-2 transition-all text-xs sm:text-sm font-semibold"
              >
                <Download className="w-3 h-3 sm:w-4 sm:h-4" />
                <span className="hidden sm:inline">CSV</span>
                <span className="sm:hidden">💾</span>
              </button>
            </div>
          </div>
          
          {tempChartData.length > 0 ? (
            <div className="w-full overflow-x-auto -mx-3 sm:-mx-4 lg:-mx-6 px-3 sm:px-4 lg:px-6">
              <div className="min-w-[500px]">
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={tempChartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                    <XAxis 
                      dataKey="time" 
                      stroke="#666" 
                      style={{ fontSize: '10px' }} 
                      angle={-45} 
                      textAnchor="end" 
                      height={70} 
                      interval={Math.floor(tempChartData.length / 12)} 
                      tick={{ fontSize: 10 }}
                    />
                    <YAxis yAxisId="left" stroke="#f97316" style={{ fontSize: '10px' }} label={{ value: 'Celsius (°C)', angle: -90, position: 'insideLeft', style: { fontSize: '10px' } }} />
                    <YAxis yAxisId="right" orientation="right" stroke="#3b82f6" style={{ fontSize: '10px' }} label={{ value: 'Fahrenheit (°F)', angle: 90, position: 'insideRight', style: { fontSize: '10px' } }} />
                    <Tooltip content={<TempTooltip />} />
                    <Legend wrapperStyle={{ paddingTop: '10px', fontSize: '11px' }} />
                    <Line yAxisId="left" type="monotone" dataKey="celsius" stroke="#f97316" strokeWidth={2} dot={false} name="Temperature (°C)" activeDot={{ r: 6 }} />
                    <Line yAxisId="right" type="monotone" dataKey="fahrenheit" stroke="#3b82f6" strokeWidth={2} dot={false} name="Temperature (°F)" activeDot={{ r: 6 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <div className="h-64 sm:h-80 lg:h-96 flex items-center justify-center text-gray-400">
              <div className="text-center">
                <Activity className="w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-3 sm:mb-4 opacity-50" />
                <p className="text-sm sm:text-base">Waiting for charging cycle...</p>
              </div>
            </div>
          )}
        </div>

        <div className="text-center mt-4 sm:mt-6 lg:mt-8 text-gray-500 text-xs sm:text-sm">
          <p>Battery Charger Monitor - State Machine Controlled Logging</p>
          <p className="mt-1">Web → Firebase RTDB → ESP32 Configuration System</p>
        </div>
      </div>
    </div>
  );
};

export default BatteryChargerDashboard;





