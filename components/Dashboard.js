'use client';

import React, { useState, useEffect } from 'react';
import { Battery, Trash2, RefreshCw, Database, Zap, Thermometer, Activity, AlertCircle, TrendingUp } from 'lucide-react';
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
  if (typeof raw === 'object') {
    if (raw.integerValue !== undefined) {
      const s = String(raw.integerValue);
      const n = parseInt(s, 10);
      return s.length >= 13 ? n : n * 1000;
    }
    if (raw.doubleValue !== undefined) {
      const n = Number(raw.doubleValue);
      return Number.isFinite(n) ? n : null;
    }
    if (raw.seconds !== undefined) {
      const sec = Number(raw.seconds);
      const ns = Number(raw.nanoseconds) || 0;
      return sec * 1000 + Math.floor(ns / 1e6);
    }
  }
  return null;
}

const BatteryChargerDashboard = () => {
  // Latest data states
  const [latestTemp, setLatestTemp] = useState(null);
  const [latestCharger, setLatestCharger] = useState(null);
  
  // History data states
  const [tempHistory, setTempHistory] = useState([]);
  const [chargerHistory, setChargerHistory] = useState([]);
  
  // UI states
  const [loading, setLoading] = useState(true);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupCount, setCleanupCount] = useState(50);
  const [stats, setStats] = useState({ total: 0, oldestDate: null, newestDate: null });
  const [cleanupResult, setCleanupResult] = useState(null);

  useEffect(() => {
    initFirebase();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, []);

  const initFirebase = async () => {
    try {
      const { initializeApp } = await import('firebase/app');
      const { getDatabase, ref, onValue } = await import('firebase/database');
      const { getFirestore, collection, query, orderBy, limit, getDocs } = await import('firebase/firestore');

      const firebaseConfig = {
        apiKey: "AIzaSyDAMbhoIi8YsG5btxVzw7K4aaIGPlH85EY",
        authDomain: "battery-monitor-29168.firebaseapp.com",
        databaseURL: "https://battery-monitor-29168-default-rtdb.firebaseio.com",
        projectId: "battery-monitor-29168",
      };

      const app = initializeApp(firebaseConfig);
      const rtdb = getDatabase(app);
      const firestore = getFirestore(app);

      window.firebaseInstances = {
        rtdb,
        firestore,
        ref,
        onValue,
        collection,
        query,
        orderBy,
        limit,
        getDocs
      };

      loadData();
    } catch (error) {
      console.error('Firebase init error:', error);
      setLoading(false);
    }
  };

  const loadData = async () => {
    if (!window.firebaseInstances) return;

    try {
      const { rtdb, firestore, ref, onValue, collection, query, orderBy, limit, getDocs } = window.firebaseInstances;

      // ========== READ LATEST DATA FROM RTDB ==========
      
      // Temperature data
      try {
        const tempRef = ref(rtdb, 'sensorData/temperature');
        onValue(tempRef, (snapshot) => {
          const data = snapshot.val();
          if (!data) return;

          setLatestTemp({
            celsius: Number(data.celsius) || 0,
            fahrenheit: Number(data.fahrenheit) || 0,
            timestamp: parseTimestamp(data.timestamp) || Date.now()
          });
        });
      } catch (err) {
        console.warn('RTDB temperature read error:', err);
      }

      // Charger data
      try {
        const chargerRef = ref(rtdb, 'chargerData/latest');
        onValue(chargerRef, (snapshot) => {
          const data = snapshot.val();
          if (!data) return;

          setLatestCharger({
            voltage: Number(data.voltage) || 0,
            current: Number(data.current) || 0,
            state: data.state || 'Unknown',
            timestamp: parseTimestamp(data.timestamp) || Date.now()
          });
        });
      } catch (err) {
        console.warn('RTDB charger read error:', err);
      }

      // ========== READ HISTORY FROM FIRESTORE ==========
      
      // Temperature history
      try {
        const tempHistoryRef = collection(firestore, 'sensorData', 'data', 'history');
        const tempQuery = query(tempHistoryRef, orderBy('timestamp', 'desc'), limit(50));
        
        const tempSnapshot = await getDocs(tempQuery);
        const tempHist = [];
        tempSnapshot.forEach((doc) => {
          const data = doc.data();
          const ts = parseTimestamp(data?.timestamp);
          const c = Number(data?.celsius);
          const f = Number(data?.fahrenheit);

          if (ts && (Number.isFinite(c) || Number.isFinite(f))) {
            tempHist.push({
              id: doc.id,
              timestamp: ts,
              celsius: Number.isFinite(c) ? c : null,
              fahrenheit: Number.isFinite(f) ? f : null
            });
          }
        });

        setTempHistory(tempHist.reverse());
      } catch (err) {
        console.warn('Firestore temperature history error:', err);
      }

      // Charger history (assuming similar structure)
      try {
        const chargerHistoryRef = collection(firestore, 'chargerData', 'data', 'history');
        const chargerQuery = query(chargerHistoryRef, orderBy('timestamp', 'desc'), limit(50));
        
        const chargerSnapshot = await getDocs(chargerQuery);
        const chargerHist = [];
        chargerSnapshot.forEach((doc) => {
          const data = doc.data();
          const ts = parseTimestamp(data?.timestamp);
          const v = Number(data?.voltage);
          const i = Number(data?.current);

          if (ts && (Number.isFinite(v) || Number.isFinite(i))) {
            chargerHist.push({
              id: doc.id,
              timestamp: ts,
              voltage: Number.isFinite(v) ? v : null,
              current: Number.isFinite(i) ? i : null,
              state: data?.state || null
            });
          }
        });

        setChargerHistory(chargerHist.reverse());
      } catch (err) {
        console.warn('Firestore charger history error:', err);
      }

      // Calculate stats based on temperature history
      if (tempHistory.length > 0) {
        setStats({
          total: tempHistory.length,
          oldestDate: new Date(tempHistory[0].timestamp),
          newestDate: new Date(tempHistory[tempHistory.length - 1].timestamp)
        });
      }

      setLoading(false);
    } catch (error) {
      console.error('Error loading data:', error);
      setLoading(false);
    }
  };

  const handleCleanup = async () => {
    if (!confirm(`Hapus ${cleanupCount} data tertua?`)) return;

    setCleanupLoading(true);
    setCleanupResult(null);

    try {
      const response = await fetch('/api/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteCount: cleanupCount })
      });

      const result = await response.json();

      if (result.success) {
        setCleanupResult({
          success: true,
          message: `✅ Berhasil menghapus ${result.deleted} data`,
          deleted: result.deleted
        });
        setTimeout(() => loadData(), 1000);
      } else {
        throw new Error(result.error || 'Unknown');
      }
    } catch (error) {
      setCleanupResult({
        success: false,
        message: `❌ Gagal: ${error.message}`
      });
    } finally {
      setCleanupLoading(false);
    }
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return '—';
    return new Date(timestamp).toLocaleString('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatChartDate = (timestamp) => {
    if (!timestamp) return '—';
    return new Date(timestamp).toLocaleTimeString('id-ID', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Prepare chart data
  const tempChartData = tempHistory.map((item) => ({
    time: formatChartDate(item.timestamp),
    celsius: item.celsius,
    fahrenheit: item.fahrenheit,
    timestamp: item.timestamp
  }));

  const chargerChartData = chargerHistory.map((item) => ({
    time: formatChartDate(item.timestamp),
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
          {formatDate(point.timestamp)}
        </p>
        <p className="text-sm text-orange-600">
          <span className="font-medium">Celsius:</span> {point.celsius?.toFixed(2) || '--'}°C
        </p>
        <p className="text-sm text-blue-600">
          <span className="font-medium">Fahrenheit:</span> {point.fahrenheit?.toFixed(2) || '--'}°F
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
          {formatDate(point.timestamp)}
        </p>
        <p className="text-sm text-green-600">
          <span className="font-medium">Voltage:</span> {point.voltage?.toFixed(2) || '--'}V
        </p>
        <p className="text-sm text-purple-600">
          <span className="font-medium">Current:</span> {point.current?.toFixed(2) || '--'}A
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
            <button 
              onClick={loadData}
              className="p-3 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors"
            >
              <RefreshCw className="w-6 h-6 text-blue-500" />
            </button>
          </div>
        </div>

        {/* Latest Values Cards */}
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
            <div className="text-4xl font-bold mb-2">
              {latestTemp?.celsius != null ? latestTemp.celsius.toFixed(2) : '--'}°C
            </div>
            <p className="text-white/80 text-sm">
              {latestTemp?.timestamp ? formatDate(latestTemp.timestamp) : 'Waiting...'}
            </p>
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
            <div className="text-4xl font-bold mb-2">
              {latestCharger?.voltage != null ? latestCharger.voltage.toFixed(2) : '--'}V
            </div>
            <p className="text-white/80 text-sm">
              {latestCharger?.timestamp ? formatDate(latestCharger.timestamp) : 'Waiting...'}
            </p>
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
            <div className="text-4xl font-bold mb-2">
              {latestCharger?.current != null ? latestCharger.current.toFixed(2) : '--'}A
            </div>
            <p className="text-white/80 text-sm">
              {latestCharger?.timestamp ? formatDate(latestCharger.timestamp) : 'Waiting...'}
            </p>
          </div>

          {/* Charger Status */}
          <div className="bg-gradient-to-br from-blue-500 to-cyan-500 rounded-2xl shadow-xl p-6 text-white">
            <div className="flex items-center justify-between mb-4">
              <div className="bg-white/20 p-3 rounded-xl">
                <Battery className="w-6 h-6" />
              </div>
              <span className="text-sm font-medium bg-white/20 px-3 py-1 rounded-full">
                Status
              </span>
            </div>
            <div className="text-3xl font-bold mb-2">
              {latestCharger?.state || 'Unknown'}
            </div>
            <p className="text-white/80 text-sm">
              Charger State
            </p>
          </div>
        </div>

        {/* Statistics Card */}
        <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="bg-green-100 p-3 rounded-xl">
              <TrendingUp className="w-6 h-6 text-green-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-800">Temperature Statistics (Last 50 Readings)</h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-4 bg-gray-50 rounded-xl">
              <span className="text-gray-600 text-sm">Total Records</span>
              <p className="font-bold text-gray-800 text-2xl mt-1">{tempHistory.length}</p>
            </div>
            {tempHistory.length > 0 && (
              <>
                <div className="text-center p-4 bg-blue-50 rounded-xl">
                  <span className="text-gray-600 text-sm">Min Temp</span>
                  <p className="font-bold text-blue-600 text-2xl mt-1">
                    {Math.min(...tempHistory.map(d => d.celsius)).toFixed(1)}°C
                  </p>
                </div>
                <div className="text-center p-4 bg-red-50 rounded-xl">
                  <span className="text-gray-600 text-sm">Max Temp</span>
                  <p className="font-bold text-red-600 text-2xl mt-1">
                    {Math.max(...tempHistory.map(d => d.celsius)).toFixed(1)}°C
                  </p>
                </div>
                <div className="text-center p-4 bg-green-50 rounded-xl">
                  <span className="text-gray-600 text-sm">Average</span>
                  <p className="font-bold text-green-600 text-2xl mt-1">
                    {(tempHistory.reduce((a, b) => a + b.celsius, 0) / tempHistory.length).toFixed(1)}°C
                  </p>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Temperature History Chart */}
        <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
          <div className="flex items-center gap-2 mb-6">
            <Thermometer className="w-6 h-6 text-orange-500" />
            <h3 className="text-xl font-bold text-gray-800">
              Temperature History Chart - Last 50 Readings
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
                  interval={Math.floor(tempChartData.length / 10)}
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
              <p>Waiting for temperature data...</p>
            </div>
          )}
        </div>

        {/* Voltage & Current History Chart */}
        <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
          <div className="flex items-center gap-2 mb-6">
            <Zap className="w-6 h-6 text-green-500" />
            <h3 className="text-xl font-bold text-gray-800">
              Voltage & Current History Chart - Last 50 Readings
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
                  interval={Math.floor(chargerChartData.length / 10)}
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
              <p>Waiting for charger data...</p>
            </div>
          )}
        </div>

        {/* Data Cleanup Section */}
        <div className="bg-white rounded-2xl shadow-xl p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-red-100 p-3 rounded-xl">
              <Database className="w-6 h-6 text-red-600" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-gray-800">Data Cleanup</h3>
              <p className="text-sm text-gray-500">Hapus data tertua berdasarkan jumlah</p>
            </div>
          </div>

          {stats.oldestDate && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <p className="text-gray-700">
                    <strong>Total data:</strong> {stats.total} records
                  </p>
                  <p className="text-gray-700 mt-1">
                    <strong>Data tertua:</strong> {formatDate(stats.oldestDate.getTime())}
                  </p>
                  <p className="text-gray-700 mt-1">
                    <strong>Data terbaru:</strong> {formatDate(stats.newestDate.getTime())}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Jumlah data tertua yang akan dihapus:
              </label>
              <input
                type="number"
                value={cleanupCount}
                onChange={(e) => setCleanupCount(parseInt(e.target.value) || 1)}
                min="1"
                max={stats.total}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-transparent"
                placeholder="50"
              />
              <p className="text-xs text-gray-500 mt-2">
                Akan menghapus {cleanupCount} data tertua dari total {stats.total} data
              </p>
            </div>

            <div className="flex items-end">
              <button
                onClick={handleCleanup}
                disabled={cleanupLoading || stats.total === 0}
                className="w-full bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white font-semibold py-3 px-6 rounded-xl shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {cleanupLoading ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-5 h-5" />
                    Hapus {cleanupCount} Data Tertua
                  </>
                )}
              </button>
            </div>
          </div>

          {cleanupResult && (
            <div className={`mt-6 p-4 rounded-xl ${
              cleanupResult.success 
                ? 'bg-green-50 border border-green-200' 
                : 'bg-red-50 border border-red-200'
            }`}>
              <p className={`text-sm font-medium ${
                cleanupResult.success ? 'text-green-800' : 'text-red-800'
              }`}>
                {cleanupResult.message}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="text-center mt-8 text-gray-500 text-sm">
          <p>Dashboard monitoring battery charger real-time</p>
          <p className="mt-1">Data disimpan di Firebase RTDB & Firestore</p>
        </div>
      </div>
    </div>
  );
};

export default BatteryChargerDashboard;
