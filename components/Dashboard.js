'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Battery, RefreshCw, Zap, Thermometer, Activity, AlertCircle, TrendingUp, CheckCircle } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

/**
 * Robust timestamp parser
 */
function parseTimestamp(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && /^[0-9]+$/.test(raw)) {
    return raw.length >= 13 ? parseInt(raw, 10) : parseInt(raw, 10) * 1000;
  }
  return null;
}

/**
 * Format timestamp untuk display
 */
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
  // Latest realtime data
  const [latestTemp, setLatestTemp] = useState(null);
  const [latestCharger, setLatestCharger] = useState(null);
  
  // History data for charts
  const [tempHistory, setTempHistory] = useState([]);
  const [chargerHistory, setChargerHistory] = useState([]);
  
  // Logging state
  const [isLogging, setIsLogging] = useState(false);
  const [loggingStartTime, setLoggingStartTime] = useState(null);
  const previousStateRef = useRef('idle');
  const currentChargerStateRef = useRef('idle'); // Track current charger state
  
  // UI states
  const [loading, setLoading] = useState(true);
  const [doneLoading, setDoneLoading] = useState(false);
  const [stats, setStats] = useState({ total: 0 });

  useEffect(() => {
    initFirebase();
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

      console.log('📝 Firebase config:', {
        projectId: firebaseConfig.projectId,
        databaseURL: firebaseConfig.databaseURL
      });

      const app = initializeApp(firebaseConfig);
      const rtdb = getDatabase(app);

      console.log('✅ Firebase app initialized');
      console.log('🔗 RTDB instance:', rtdb ? 'OK' : 'FAILED');

      window.firebaseInstances = {
        rtdb,
        ref,
        onValue,
        push,
        set,
        remove
      };

      console.log('✅ Firebase instances stored in window');
      setupRealtimeListeners();
      loadHistoryData();
    } catch (error) {
      console.error('❌ Firebase init error:', error);
      console.error('Error name:', error.name);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
      setLoading(false);
    }
  };

  const setupRealtimeListeners = () => {
    if (!window.firebaseInstances) {
      console.error('❌ Firebase instances not initialized');
      return;
    }

    const { rtdb, ref, onValue } = window.firebaseInstances;
    console.log('📡 Setting up realtime listeners...');

    // Listen to temperature realtime
    const tempRef = ref(rtdb, 'sensorData/temperature');
    console.log('🔗 Subscribing to: sensorData/temperature');
    
    onValue(tempRef, 
      (snapshot) => {
        console.log('📥 Temperature snapshot received');
        const data = snapshot.val();
        console.log('🌡️ Temperature raw data:', data);
        
        if (!data) {
          console.warn('⚠️ No temperature data found');
          return;
        }

        const tempData = {
          celsius: Number(data.celsius) || 0,
          fahrenheit: Number(data.fahrenheit) || 0,
          timestamp: parseTimestamp(data.timestamp) || Date.now()
        };
        
        setLatestTemp(tempData);
        console.log('✅ Temperature updated:', tempData);

        // LOG ONLY IF CHARGER STATE IS NOT IDLE
        const chargerState = currentChargerStateRef.current;
        const isCharging = chargerState !== 'idle' && chargerState !== 'Unknown';
        
        if (isCharging) {
          console.log('📝 LOGGING temperature - Charger state:', chargerState, '(charging active)');
          logTemperatureData(tempData);
        } else {
          console.log('⏸️ NOT LOGGING temperature - Charger state:', chargerState, '(idle/unknown)');
        }
      },
      (error) => {
        console.error('❌ Temperature listener error:', error);
        console.error('Error code:', error.code);
        console.error('Error message:', error.message);
      }
    );

    // Listen to charger realtime - TRY BOTH latest AND realtime
    const chargerRefLatest = ref(rtdb, 'chargerData/latest');
    console.log('🔗 Subscribing to: chargerData/latest');
    
    onValue(chargerRefLatest, 
      (snapshot) => {
        console.log('📥 Charger snapshot received (latest path)');
        const data = snapshot.val();
        console.log('⚡ Charger raw data:', data);
        
        if (!data) {
          console.warn('⚠️ No charger data found at chargerData/latest');
          
          // Try alternative path
          const chargerRefRealtime = ref(rtdb, 'chargerData/realtime');
          console.log('🔗 Trying alternative path: chargerData/realtime');
          
          onValue(chargerRefRealtime, (snap) => {
            const altData = snap.val();
            console.log('⚡ Charger data from realtime path:', altData);
            if (altData) {
              processChargerData(altData);
            }
          }, (err) => {
            console.error('❌ Alternative path also failed:', err);
          });
          
          return;
        }

        processChargerData(data);
      },
      (error) => {
        console.error('❌ Charger listener error:', error);
        console.error('Error code:', error.code);
        console.error('Error message:', error.message);
        
        if (error.code === 'PERMISSION_DENIED') {
          console.error('🚫 PERMISSION DENIED - Check Firebase rules!');
        }
      }
    );

    setLoading(false);
  };

  const processChargerData = (data) => {
    const chargerData = {
      voltage: Number(data.voltage) || 0,
      current: Number(data.current) || 0,
      state: data.state || 'Unknown',
      timestamp: parseTimestamp(data.timestamp) || Date.now()
    };
    
    // Update ref for temperature logging to access
    currentChargerStateRef.current = chargerData.state;
    
    setLatestCharger(chargerData);
    console.log('✅ Charger updated:', chargerData);

    // Check state and auto-manage logging
    handleStateChange(chargerData.state);

    // LOG ONLY IF STATE IS NOT IDLE (charging in progress)
    const isCharging = chargerData.state !== 'idle' && chargerData.state !== 'Unknown';
    
    if (isCharging) {
      console.log('📝 LOGGING charger data - State:', chargerData.state, '(charging active)');
      logChargerData(chargerData);
    } else {
      console.log('⏸️ NOT LOGGING charger - State:', chargerData.state, '(idle/unknown)');
    }
  };

  const handleStateChange = (currentState) => {
    const previousState = previousStateRef.current;
    
    console.log('🔄 State change detected:');
    console.log('   Previous:', previousState);
    console.log('   Current:', currentState);
    console.log('   isLogging:', isLogging);
    
    // SIMPLIFIED LOGIC: Log whenever state is NOT idle or Unknown
    const shouldLog = currentState !== 'idle' && currentState !== 'Unknown';
    
    console.log('   Should log?', shouldLog ? '✅ YES' : '❌ NO');
    
    if (shouldLog && !isLogging) {
      console.log('🟢 ============================================');
      console.log('   STARTING LOGGING SESSION');
      console.log('   State:', currentState);
      console.log('============================================');
      setIsLogging(true);
      if (!loggingStartTime) {
        setLoggingStartTime(Date.now());
      }
    }
    
    if (!shouldLog && isLogging) {
      console.log('🔴 ============================================');
      console.log('   STOPPING LOGGING SESSION');
      console.log('   State returned to:', currentState);
      console.log('============================================');
      setIsLogging(false);
    }

    previousStateRef.current = currentState;
  };

  const logTemperatureData = async (tempData) => {
    if (!window.firebaseInstances) {
      console.error('❌ Cannot log temperature - Firebase not initialized');
      return;
    }

    try {
      const { rtdb, ref, push, set } = window.firebaseInstances;
      const historyRef = ref(rtdb, 'sensorData/history');
      const newRef = push(historyRef);
      
      const logData = {
        celsius: tempData.celsius,
        fahrenheit: tempData.fahrenheit,
        timestamp: tempData.timestamp,
        formattedTime: formatTime(tempData.timestamp)
      };
      
      await set(newRef, logData);
      console.log('✅ Temperature logged:', logData.celsius, '°C at', logData.formattedTime);
    } catch (error) {
      console.error('❌ Error logging temperature:', error);
      console.error('Error details:', error.message);
    }
  };

  const logChargerData = async (chargerData) => {
    if (!window.firebaseInstances) {
      console.error('❌ Cannot log charger data - Firebase not initialized');
      return;
    }

    try {
      const { rtdb, ref, push, set } = window.firebaseInstances;
      const historyRef = ref(rtdb, 'chargerData/history');
      const newRef = push(historyRef);
      
      const logData = {
        voltage: chargerData.voltage,
        current: chargerData.current,
        state: chargerData.state,
        timestamp: chargerData.timestamp,
        formattedTime: formatTime(chargerData.timestamp)
      };
      
      await set(newRef, logData);
      console.log('✅ Charger logged:', logData.voltage, 'V', logData.current, 'A at', logData.formattedTime);
    } catch (error) {
      console.error('❌ Error logging charger data:', error);
      console.error('Error details:', error.message);
      
      if (error.code === 'PERMISSION_DENIED') {
        console.error('🚫 PERMISSION DENIED - Cannot write to chargerData/history');
        console.error('Check Firebase Rules - .write permission needed');
      }
    }
  };

  const loadHistoryData = useCallback(() => {
    if (!window.firebaseInstances) {
      console.error('❌ Cannot load history - Firebase not initialized');
      return;
    }

    const { rtdb, ref, onValue } = window.firebaseInstances;
    console.log('📊 Loading history data...');

    // Load temperature history
    const tempHistoryRef = ref(rtdb, 'sensorData/history');
    console.log('🔗 Subscribing to: sensorData/history');
    
    onValue(tempHistoryRef, 
      (snapshot) => {
        console.log('📥 Temperature history snapshot received');
        const data = snapshot.val();
        console.log('🌡️ Temperature history raw data:', data);
        
        if (!data) {
          console.warn('⚠️ No temperature history data');
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

        // Sort by timestamp ascending
        history.sort((a, b) => a.timestamp - b.timestamp);
        setTempHistory(history);
        console.log('✅ Temperature history loaded:', history.length, 'records');
      },
      (error) => {
        console.error('❌ Temperature history listener error:', error);
      }
    );

    // Load charger history
    const chargerHistoryRef = ref(rtdb, 'chargerData/history');
    console.log('🔗 Subscribing to: chargerData/history');
    
    onValue(chargerHistoryRef, 
      (snapshot) => {
        console.log('📥 Charger history snapshot received');
        const data = snapshot.val();
        console.log('⚡ Charger history raw data:', data);
        
        if (!data) {
          console.warn('⚠️ No charger history data');
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

        // Sort by timestamp ascending
        history.sort((a, b) => a.timestamp - b.timestamp);
        setChargerHistory(history);
        setStats({ total: history.length });
        console.log('✅ Charger history loaded:', history.length, 'records');
      },
      (error) => {
        console.error('❌ Charger history listener error:', error);
      }
    );
  }, []);

  const handleDoneButton = async () => {
    if (!latestCharger || latestCharger.state !== 'DONE') {
      alert('⚠️ Tombol DONE hanya bisa ditekan saat status charging adalah DONE');
      return;
    }

    if (!confirm('Hapus semua data history dan reset untuk siklus charging baru?')) {
      return;
    }

    setDoneLoading(true);

    try {
      const { rtdb, ref, remove } = window.firebaseInstances;

      // Clear temperature history
      const tempHistoryRef = ref(rtdb, 'sensorData/history');
      await remove(tempHistoryRef);
      console.log('✅ Temperature history cleared');

      // Clear charger history
      const chargerHistoryRef = ref(rtdb, 'chargerData/history');
      await remove(chargerHistoryRef);
      console.log('✅ Charger history cleared');

      // Reset logging state
      setIsLogging(false);
      setLoggingStartTime(null);
      previousStateRef.current = 'idle';
      
      alert('✅ Semua data history berhasil dihapus. Siap untuk siklus charging baru.');
    } catch (error) {
      console.error('❌ Error clearing history:', error);
      alert('❌ Gagal menghapus data: ' + error.message);
    } finally {
      setDoneLoading(false);
    }
  };

  // Prepare chart data
  const tempChartData = tempHistory.map((item) => ({
    time: item.formattedTime,
    celsius: item.celsius,
    fahrenheit: item.fahrenheit,
    timestamp: item.timestamp
  }));

  const chargerChartData = chargerHistory.map((item) => ({
    time: item.formattedTime,
    voltage: item.voltage,
    current: item.current,
    timestamp: item.timestamp
  }));

  // Custom Tooltips
  const TempTooltip = ({ active, payload }) => {
    if (!active || !payload || !payload.length) return null;
    const point = payload[0]?.payload;
    if (!point) return null;

    return (
      <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3">
        <p className="text-sm font-semibold text-gray-800 mb-2">
          {point.time}
        </p>
        <p className="text-sm text-orange-600">
          <span className="font-medium">Celsius:</span> {point.celsius?.toFixed(2)}°C
        </p>
        <p className="text-sm text-blue-600">
          <span className="font-medium">Fahrenheit:</span> {point.fahrenheit?.toFixed(2)}°F
        </p>
      </div>
    );
  };

  const ChargerTooltip = ({ active, payload }) => {
    if (!active || !payload || !payload.length) return null;
    const point = payload[0]?.payload;
    if (!point) return null;

    return (
      <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3">
        <p className="text-sm font-semibold text-gray-800 mb-2">
          {point.time}
        </p>
        <p className="text-sm text-green-600">
          <span className="font-medium">Voltage:</span> {point.voltage?.toFixed(2)}V
        </p>
        <p className="text-sm text-purple-600">
          <span className="font-medium">Current:</span> {point.current?.toFixed(2)}A
        </p>
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
            
            {/* Logging Status Indicator */}
            <div className="flex items-center gap-4">
              {/* Logging status badge */}
              <div className={`px-4 py-2 rounded-xl flex items-center gap-2 ${
                isLogging ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
              }`}>
                <div className={`w-3 h-3 rounded-full ${isLogging ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
                <span className="font-medium text-sm">
                  {isLogging ? 'Logging Active' : 'Standby'}
                </span>
              </div>
              
              <button 
                onClick={loadHistoryData}
                className="p-3 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors"
                title="Refresh Data"
              >
                <RefreshCw className="w-6 h-6 text-blue-500" />
              </button>
            </div>
          </div>
        </div>

        {/* Latest Values Cards - WITHOUT DATES */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
          
          {/* Temperature Celsius */}
          <div className="bg-gradient-to-br from-orange-500 to-red-500 rounded-2xl shadow-xl p-6 text-white">
            <div className="flex items-center justify-between mb-4">
              <div className="bg-white/20 p-3 rounded-xl">
                <Thermometer className="w-6 h-6" />
              </div>
              <span className="text-sm font-medium bg-white/20 px-3 py-1 rounded-full">
                Temperature
              </span>
            </div>
            <div className="text-5xl font-bold mb-2">
              {latestTemp?.celsius != null ? latestTemp.celsius.toFixed(1) : '--'}
            </div>
            <p className="text-white/90 text-lg font-medium">°Celsius</p>
          </div>

          {/* Voltage */}
          <div className="bg-gradient-to-br from-green-500 to-emerald-500 rounded-2xl shadow-xl p-6 text-white">
            <div className="flex items-center justify-between mb-4">
              <div className="bg-white/20 p-3 rounded-xl">
                <Zap className="w-6 h-6" />
              </div>
              <span className="text-sm font-medium bg-white/20 px-3 py-1 rounded-full">
                Voltage
              </span>
            </div>
            <div className="text-5xl font-bold mb-2">
              {latestCharger?.voltage != null ? latestCharger.voltage.toFixed(2) : '--'}
            </div>
            <p className="text-white/90 text-lg font-medium">Volts</p>
          </div>

          {/* Current */}
          <div className="bg-gradient-to-br from-purple-500 to-indigo-500 rounded-2xl shadow-xl p-6 text-white">
            <div className="flex items-center justify-between mb-4">
              <div className="bg-white/20 p-3 rounded-xl">
                <Activity className="w-6 h-6" />
              </div>
              <span className="text-sm font-medium bg-white/20 px-3 py-1 rounded-full">
                Current
              </span>
            </div>
            <div className="text-5xl font-bold mb-2">
              {latestCharger?.current != null ? latestCharger.current.toFixed(2) : '--'}
            </div>
            <p className="text-white/90 text-lg font-medium">Amperes</p>
          </div>

          {/* Charger Status */}
          <div className={`rounded-2xl shadow-xl p-6 text-white ${
            latestCharger?.state === 'DONE' 
              ? 'bg-gradient-to-br from-green-500 to-emerald-600'
              : latestCharger?.state === 'idle'
              ? 'bg-gradient-to-br from-gray-400 to-gray-500'
              : 'bg-gradient-to-br from-blue-500 to-cyan-500'
          }`}>
            <div className="flex items-center justify-between mb-4">
              <div className="bg-white/20 p-3 rounded-xl">
                <Battery className="w-6 h-6" />
              </div>
              <span className="text-sm font-medium bg-white/20 px-3 py-1 rounded-full">
                Status
              </span>
            </div>
            <div className="text-4xl font-bold mb-2">
              {latestCharger?.state || 'Unknown'}
            </div>
            <p className="text-white/90 text-sm font-medium">
              Charger State
            </p>
          </div>
        </div>

        {/* Statistics & Done Button */}
        <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-green-100 p-3 rounded-xl">
                <TrendingUp className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-800">
                  Current Charging Cycle Statistics
                </h3>
                <p className="text-sm text-gray-500">
                  {stats.total} data points logged
                  {loggingStartTime && isLogging && (
                    <span className="ml-2 text-blue-600">
                      • Started {new Date(loggingStartTime).toLocaleTimeString('id-ID')}
                    </span>
                  )}
                </p>
              </div>
            </div>

            {/* DONE Button - Only enabled when state is DONE */}
            <button
              onClick={handleDoneButton}
              disabled={doneLoading || !latestCharger || latestCharger.state !== 'DONE'}
              className={`px-6 py-3 rounded-xl font-semibold flex items-center gap-2 transition-all ${
                latestCharger?.state === 'DONE'
                  ? 'bg-green-500 hover:bg-green-600 text-white shadow-lg hover:shadow-xl'
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
                  DONE & Clear Data
                </>
              )}
            </button>
          </div>

          {latestCharger?.state !== 'DONE' && (
            <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-blue-800">
                  Tombol DONE hanya aktif saat status charging adalah <strong>DONE</strong>. 
                  Saat ditekan, semua data history akan dihapus untuk memulai siklus charging baru.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Temperature History Chart */}
        <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
          <div className="flex items-center gap-2 mb-6">
            <Thermometer className="w-6 h-6 text-orange-500" />
            <h3 className="text-xl font-bold text-gray-800">
              Temperature History - Current Cycle ({tempHistory.length} readings)
            </h3>
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
                  interval={Math.floor(tempChartData.length / 15)}
                />
                <YAxis 
                  yAxisId="left"
                  stroke="#f97316"
                  style={{ fontSize: '12px' }}
                  label={{ value: 'Celsius (°C)', angle: -90, position: 'insideLeft' }}
                />
                <YAxis 
                  yAxisId="right"
                  orientation="right"
                  stroke="#3b82f6"
                  style={{ fontSize: '12px' }}
                  label={{ value: 'Fahrenheit (°F)', angle: 90, position: 'insideRight' }}
                />
                <Tooltip content={<TempTooltip />} />
                <Legend wrapperStyle={{ paddingTop: '20px' }} />
                <Line 
                  yAxisId="left"
                  type="monotone" 
                  dataKey="celsius" 
                  stroke="#f97316" 
                  strokeWidth={2}
                  dot={false}
                  name="Temperature (°C)"
                  activeDot={{ r: 6 }}
                />
                <Line 
                  yAxisId="right"
                  type="monotone" 
                  dataKey="fahrenheit" 
                  stroke="#3b82f6" 
                  strokeWidth={2}
                  dot={false}
                  name="Temperature (°F)"
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-96 flex items-center justify-center text-gray-400">
              <div className="text-center">
                <Activity className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p>No data logged yet. Waiting for charging cycle to start...</p>
                <p className="text-sm mt-2">Logging will start automatically when state changes from idle.</p>
              </div>
            </div>
          )}
        </div>

        {/* Voltage & Current History Chart */}
        <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
          <div className="flex items-center gap-2 mb-6">
            <Zap className="w-6 h-6 text-green-500" />
            <h3 className="text-xl font-bold text-gray-800">
              Voltage & Current History - Current Cycle ({chargerHistory.length} readings)
            </h3>
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
                  interval={Math.floor(chargerChartData.length / 15)}
                />
                <YAxis 
                  yAxisId="left"
                  stroke="#10b981"
                  style={{ fontSize: '12px' }}
                  label={{ value: 'Voltage (V)', angle: -90, position: 'insideLeft' }}
                />
                <YAxis 
                  yAxisId="right"
                  orientation="right"
                  stroke="#8b5cf6"
                  style={{ fontSize: '12px' }}
                  label={{ value: 'Current (A)', angle: 90, position: 'insideRight' }}
                />
                <Tooltip content={<ChargerTooltip />} />
                <Legend wrapperStyle={{ paddingTop: '20px' }} />
                <Line 
                  yAxisId="left"
                  type="monotone" 
                  dataKey="voltage" 
                  stroke="#10b981" 
                  strokeWidth={2}
                  dot={false}
                  name="Voltage (V)"
                  activeDot={{ r: 6 }}
                />
                <Line 
                  yAxisId="right"
                  type="monotone" 
                  dataKey="current" 
                  stroke="#8b5cf6" 
                  strokeWidth={2}
                  dot={false}
                  name="Current (A)"
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-96 flex items-center justify-center text-gray-400">
              <div className="text-center">
                <Activity className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p>No data logged yet. Waiting for charging cycle to start...</p>
                <p className="text-sm mt-2">Logging will start automatically when state changes from idle.</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="text-center mt-8 text-gray-500 text-sm">
          <p>Battery Charger Monitor - Real-time Data Logging per Charging Cycle</p>
          <p className="mt-1">Auto-logging active during CC-TRANS-CV charging states • Data clears on DONE</p>
        </div>
      </div>
    </div>
  );
};

export default BatteryChargerDashboard;
