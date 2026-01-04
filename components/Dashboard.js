'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Battery, RefreshCw, Zap, Thermometer, Activity, AlertCircle, TrendingUp, CheckCircle, Settings, ArrowRight } from 'lucide-react';
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
    second: '2-digit'
  });
}

const BatteryChargerDashboard = () => {
  // Configuration state
  const [showConfig, setShowConfig] = useState(true);
  const [voltageChoice, setVoltageChoice] = useState('3.7');
  const [capacityChoice, setCapacityChoice] = useState('1200');
  const [customCapacity, setCustomCapacity] = useState('');
  const [configSending, setConfigSending] = useState(false);
  
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
      
      // Check if configuration exists
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
      
      // If status is 'configured' or 'running', show monitoring
      // If status is 'idle' or null, show config screen
      if (status === 'configured' || status === 'running') {
        setShowConfig(false);
      } else {
        setShowConfig(true);
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

    setConfigSending(true);
    
    try {
      const { rtdb, ref, set } = window.firebaseInstances;
      
      const voltage = parseFloat(voltageChoice);
      
      // Calculate derived values
      const vref = voltage - 0.2;
      let iref = finalCapacity * 0.5 / 1000; // Convert mA to A
      
      // Max limit check (following Arduino code logic)
      if (finalCapacity > 2200) {
        iref = 1.1;
      }
      
      const configData = {
        targetVoltage: voltage,
        batteryCapacity: finalCapacity,
        vref: vref,
        iref: iref,
        status: 'configured',
        timestamp: Date.now()
      };
      
      console.log('📤 Sending config to RTDB:', configData);
      
      await set(ref(rtdb, 'config'), configData);
      
      console.log('✅ Configuration sent successfully');
      alert(`✅ Konfigurasi berhasil dikirim!\n\nTarget: ${voltage}V\nKapasitas: ${finalCapacity}mAh\nVref: ${vref.toFixed(2)}V\nIref: ${iref.toFixed(2)}A`);
      
      // Wait a moment then switch to monitoring view
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
      
      // State machine logic
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
        currUpper !== 'DETECT'
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

  const handleDoneButton = async () => {
    if (currentState.toUpperCase() !== 'DONE') {
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
      await set(ref(rtdb, 'config/status'), 'idle');
      console.log('✅ Config status reset to IDLE');
      
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
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Calculated Parameters:</h3>
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
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
          <div className="bg-gradient-to-br from-orange-500 to-red-500 rounded-2xl shadow-xl p-6 text-white">
            <div className="flex items-center justify-between mb-4">
              <div className="bg-white/20 p-3 rounded-xl"><Thermometer className="w-6 h-6" /></div>
              <span className="text-sm font-medium bg-white/20 px-3 py-1 rounded-full">Temperature</span>
            </div>
            <div className="text-5xl font-bold mb-2">{latestTemp?.celsius != null ? latestTemp.celsius.toFixed(1) : '--'}</div>
            <p className="text-white/90 text-lg font-medium">°Celsius</p>
          </div>

          <div className="bg-gradient-to-br from-green-500 to-emerald-500 rounded-2xl shadow-xl p-6 text-white">
            <div className="flex items-center justify-between mb-4">
              <div className="bg-white/20 p-3 rounded-xl"><Zap className="w-6 h-6" /></div>
              <span className="text-sm font-medium bg-white/20 px-3 py-1 rounded-full">Voltage</span>
            </div>
            <div className="text-5xl font-bold mb-2">{latestCharger?.voltage != null ? latestCharger.voltage.toFixed(2) : '--'}</div>
            <p className="text-white/90 text-lg font-medium">Volts</p>
          </div>

          <div className="bg-gradient-to-br from-purple-500 to-indigo-500 rounded-2xl shadow-xl p-6 text-white">
            <div className="flex items-center justify-between mb-4">
              <div className="bg-white/20 p-3 rounded-xl"><Activity className="w-6 h-6" /></div>
              <span className="text-sm font-medium bg-white/20 px-3 py-1 rounded-full">Current</span>
            </div>
            <div className="text-5xl font-bold mb-2">{latestCharger?.current != null ? latestCharger.current.toFixed(2) : '--'}</div>
            <p className="text-white/90 text-lg font-medium">Amperes</p>
          </div>

          <div className={`rounded-2xl shadow-xl p-6 text-white ${
            currentState.toUpperCase() === 'DONE' ? 'bg-gradient-to-br from-green-500 to-emerald-600' :
            currentState.toUpperCase() === 'IDLE' ? 'bg-gradient-to-br from-gray-400 to-gray-500' :
            currentState.toUpperCase() === 'DETECT' ? 'bg-gradient-to-br from-yellow-500 to-orange-500' :
            'bg-gradient-to-br from-blue-500 to-cyan-500'
          }`}>
            <div className="flex items-center justify-between mb-4">
              <div className="bg-white/20 p-3 rounded-xl"><Battery className="w-6 h-6" /></div>
              <span className="text-sm font-medium bg-white/20 px-3 py-1 rounded-full">Status</span>
            </div>
            <div className="text-4xl font-bold mb-2">{currentState || 'Unknown'}</div>
            <p className="text-white/90 text-sm font-medium">Charger State</p>
          </div>
        </div>

        {/* Statistics */}
        <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-green-100 p-3 rounded-xl"><TrendingUp className="w-6 h-6 text-green-600" /></div>
              <div>
                <h3 className="text-lg font-semibold text-gray-800">Current Charging Cycle</h3>
                <p className="text-sm text-gray-500">
                  {stats.total} data points logged
                  {loggingStartTime && isLoggingActive && (
                    <span className="ml-2 text-blue-600">• Started {new Date(loggingStartTime).toLocaleTimeString('id-ID')}</span>
                  )}
                </p>
              </div>
            </div>
            <button onClick={handleDoneButton} disabled={doneLoading || currentState.toUpperCase() !== 'DONE'}
              className={`px-6 py-3 rounded-xl font-semibold flex items-center gap-2 transition-all ${
                currentState.toUpperCase() === 'DONE' ? 'bg-green-500 hover:bg-green-600 text-white shadow-lg' :
                'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}>
              {doneLoading ? <><RefreshCw className="w-5 h-5 animate-spin" />Clearing...</> : 
                <><CheckCircle className="w-5 h-5" />DONE & Clear</>}
            </button>
          </div>
          <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-blue-800">
                <p className="font-medium mb-1">Logging Rules:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li><strong>IDLE</strong> → No logging ⏸️</li>
                  <li><strong>DETECT</strong> → Waiting 🟡</li>
                  <li><strong>DETECT → (any change)</strong> → Logging starts ✅</li>
                  <li><strong>CC/CV/TRANS/DONE</strong> → Continue logging</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* CHART 1: VOLTAGE & CURRENT */}
        <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
          <div className="flex items-center gap-2 mb-6">
            <Zap className="w-6 h-6 text-green-500" />
            <h3 className="text-xl font-bold text-gray-800">
              Voltage & Current History ({chargerHistory.length} readings)
            </h3>
          </div>
          {chargerChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={400}>
              <LineChart data={chargerChartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                <XAxis dataKey="time" stroke="#666" style={{ fontSize: '12px' }} angle={-45} textAnchor="end" height={80} interval={Math.floor(chargerChartData.length / 15)} />
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
        <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
          <div className="flex items-center gap-2 mb-6">
            <Thermometer className="w-6 h-6 text-orange-500" />
            <h3 className="text-xl font-bold text-gray-800">
              Temperature History ({tempHistory.length} readings)
            </h3>
          </div>
          {tempChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={400}>
              <LineChart data={tempChartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                <XAxis dataKey="time" stroke="#666" style={{ fontSize: '12px' }} angle={-45} textAnchor="end" height={80} interval={Math.floor(tempChartData.length / 15)} />
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
