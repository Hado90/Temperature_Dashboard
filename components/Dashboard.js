'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Battery, RefreshCw, Zap, Thermometer, Activity, AlertCircle, TrendingUp, CheckCircle } from 'lucide-react';
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
  const [latestTemp, setLatestTemp] = useState(null);
  const [latestCharger, setLatestCharger] = useState(null);
  const [tempHistory, setTempHistory] = useState([]);
  const [chargerHistory, setChargerHistory] = useState([]);
  const [currentChargerState, setCurrentChargerState] = useState('idle');
  const [loggingStartTime, setLoggingStartTime] = useState(null);
  const [loading, setLoading] = useState(true);
  const [doneLoading, setDoneLoading] = useState(false);
  const [stats, setStats] = useState({ total: 0 });
  const firebaseInitialized = useRef(false);

  const isLogging = currentChargerState !== 'idle' && currentChargerState !== 'Unknown' && currentChargerState !== '';

  useEffect(() => {
    console.log('📊 STATE:', currentChargerState, '| Logging:', isLogging ? 'YES' : 'NO');
    
    if (isLogging && !loggingStartTime) {
      const startTime = Date.now();
      setLoggingStartTime(startTime);
      console.log('🟢 LOGGING STARTED - State:', currentChargerState);
    }
    
    if (!isLogging && loggingStartTime) {
      console.log('🔴 LOGGING STOPPED - State:', currentChargerState);
      setLoggingStartTime(null);
    }
  }, [currentChargerState, isLogging, loggingStartTime]);

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
      
      setupRealtimeListeners();
      loadHistoryData();
    } catch (error) {
      console.error('❌ Firebase init error:', error);
      setLoading(false);
    }
  };

  const setupRealtimeListeners = () => {
    if (!window.firebaseInstances) return;
    const { rtdb, ref, onValue, push, set } = window.firebaseInstances;

    const chargerRef = ref(rtdb, 'chargerData/latest');
    onValue(chargerRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) return;

      const chargerData = {
        voltage: Number(data.voltage) || 0,
        current: Number(data.current) || 0,
        state: data.state || 'Unknown',
        timestamp: parseTimestamp(data.timestamp) || Date.now()
      };
      
      setCurrentChargerState(chargerData.state);
      setLatestCharger(chargerData);
      console.log('⚡ Charger:', chargerData.state, chargerData.voltage + 'V', chargerData.current + 'A');

      if (chargerData.state !== 'idle' && chargerData.state !== 'Unknown') {
        console.log('📝 Logging charger...');
        logChargerData(chargerData, push, set, ref, rtdb);
      } else {
        console.log('⏸️ Skip charger log (state: ' + chargerData.state + ')');
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
      console.log('🌡️ Temp:', tempData.celsius + '°C');

      setCurrentChargerState(prevState => {
        if (prevState !== 'idle' && prevState !== 'Unknown') {
          console.log('📝 Logging temp...');
          logTemperatureData(tempData, push, set, ref, rtdb);
        } else {
          console.log('⏸️ Skip temp log (charger: ' + prevState + ')');
        }
        return prevState;
      });
    });

    setLoading(false);
  };

  const logChargerData = async (chargerData, push, set, ref, rtdb) => {
    try {
      const historyRef = ref(rtdb, 'chargerData/history');
      const newRef = push(historyRef);
      await set(newRef, {
        voltage: chargerData.voltage,
        current: chargerData.current,
        state: chargerData.state,
        timestamp: chargerData.timestamp,
        formattedTime: formatTime(chargerData.timestamp)
      });
      console.log('✅ Charger logged');
    } catch (error) {
      console.error('❌ Log charger error:', error);
    }
  };

  const logTemperatureData = async (tempData, push, set, ref, rtdb) => {
    try {
      const historyRef = ref(rtdb, 'sensorData/history');
      const newRef = push(historyRef);
      await set(newRef, {
        celsius: tempData.celsius,
        fahrenheit: tempData.fahrenheit,
        timestamp: tempData.timestamp,
        formattedTime: formatTime(tempData.timestamp)
      });
      console.log('✅ Temp logged');
    } catch (error) {
      console.error('❌ Log temp error:', error);
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
    if (currentChargerState !== 'DONE') {
      alert('⚠️ Tombol DONE hanya bisa ditekan saat status DONE');
      return;
    }
    if (!confirm('Hapus semua data history?')) return;

    setDoneLoading(true);
    try {
      const { rtdb, ref, remove } = window.firebaseInstances;
      await remove(ref(rtdb, 'sensorData/history'));
      await remove(ref(rtdb, 'chargerData/history'));
      setCurrentChargerState('idle');
      setLoggingStartTime(null);
      alert('✅ Data berhasil dihapus');
    } catch (error) {
      console.error('❌ Clear error:', error);
      alert('❌ Gagal: ' + error.message);
    } finally {
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        
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
                isLogging ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
              }`}>
                <div className={`w-3 h-3 rounded-full ${isLogging ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
                <span className="font-medium text-sm">
                  {isLogging ? `Logging: ${currentChargerState}` : 'Standby (idle)'}
                </span>
              </div>
              <button onClick={loadHistoryData} className="p-3 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors">
                <RefreshCw className="w-6 h-6 text-blue-500" />
              </button>
            </div>
          </div>
        </div>

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
            currentChargerState === 'DONE' ? 'bg-gradient-to-br from-green-500 to-emerald-600' :
            currentChargerState === 'idle' ? 'bg-gradient-to-br from-gray-400 to-gray-500' :
            'bg-gradient-to-br from-blue-500 to-cyan-500'
          }`}>
            <div className="flex items-center justify-between mb-4">
              <div className="bg-white/20 p-3 rounded-xl"><Battery className="w-6 h-6" /></div>
              <span className="text-sm font-medium bg-white/20 px-3 py-1 rounded-full">Status</span>
            </div>
            <div className="text-4xl font-bold mb-2">{currentChargerState || 'Unknown'}</div>
            <p className="text-white/90 text-sm font-medium">Charger State</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-green-100 p-3 rounded-xl"><TrendingUp className="w-6 h-6 text-green-600" /></div>
              <div>
                <h3 className="text-lg font-semibold text-gray-800">Current Charging Cycle Statistics</h3>
                <p className="text-sm text-gray-500">
                  {stats.total} data points logged
                  {loggingStartTime && isLogging && (
                    <span className="ml-2 text-blue-600">• Started {new Date(loggingStartTime).toLocaleTimeString('id-ID')}</span>
                  )}
                </p>
              </div>
            </div>
            <button onClick={handleDoneButton} disabled={doneLoading || currentChargerState !== 'DONE'}
              className={`px-6 py-3 rounded-xl font-semibold flex items-center gap-2 transition-all ${
                currentChargerState === 'DONE' ? 'bg-green-500 hover:bg-green-600 text-white shadow-lg' :
                'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}>
              {doneLoading ? <><RefreshCw className="w-5 h-5 animate-spin" />Clearing...</> : 
                <><CheckCircle className="w-5 h-5" />DONE & Clear Data</>}
            </button>
          </div>
          {currentChargerState !== 'DONE' && (
            <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-blue-800">
                  Tombol DONE hanya aktif saat status <strong>DONE</strong>. Logging otomatis berjalan saat state bukan <strong>idle</strong>.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
          <div className="flex items-center gap-2 mb-6">
            <Thermometer className="w-6 h-6 text-orange-500" />
            <h3 className="text-xl font-bold text-gray-800">Temperature History - Current Cycle ({tempHistory.length} readings)</h3>
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
                <p>No data logged yet. Waiting for charging cycle to start...</p>
                <p className="text-sm mt-2">Logging will start when state changes from <strong>idle</strong>.</p>
              </div>
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
          <div className="flex items-center gap-2 mb-6">
            <Zap className="w-6 h-6 text-green-500" />
            <h3 className="text-xl font-bold text-gray-800">Voltage & Current History - Current Cycle ({chargerHistory.length} readings)</h3>
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
                <p>No data logged yet. Waiting for charging cycle to start...</p>
                <p className="text-sm mt-2">Logging will start when state changes from <strong>idle</strong>.</p>
              </div>
            </div>
          )}
        </div>

        <div className="text-center mt-8 text-gray-500 text-sm">
          <p>Battery Charger Monitor - Real-time Data Logging per Charging Cycle</p>
          <p className="mt-1">Auto-logging active when charger state is not idle • Data clears on DONE</p>
        </div>
      </div>
    </div>
  );
};

export default BatteryChargerDashboard;
