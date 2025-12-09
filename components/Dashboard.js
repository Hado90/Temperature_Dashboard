'use client';

import React, { useState, useEffect } from 'react';
import { Thermometer, Trash2, RefreshCw, Database, Clock, TrendingUp, AlertCircle, Activity } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Area, AreaChart } from 'recharts';

const TemperatureDashboard = () => {
  const [latestData, setLatestData] = useState(null);
  const [historyData, setHistoryData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupDays, setCleanupDays] = useState(7);
  const [stats, setStats] = useState({ total: 0, oldestDate: null, newestDate: null });
  const [cleanupResult, setCleanupResult] = useState(null);

  useEffect(() => {
    initFirebase();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, []);

  const initFirebase = async () => {
    try {
      // Import Firebase SDK dari npm
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

      // Store di window untuk akses global
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

      // initial load
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

      // Load latest from RTDB
      try {
        const rtdbRef = ref(rtdb, 'sensorData/temperature');
        // onValue will keep listening; we only set the latestData
        onValue(rtdbRef, (snapshot) => {
          const data = snapshot.val();
          // data structure may vary; ensure it has celsius/fahrenheit/timestamp
          if (data) {
            // jika data adalah object child list, attempt ambil last entry
            if (typeof data === 'object' && !Array.isArray(data)) {
              // cari properti terakhir (by key ordering) — fallback sederhana
              const keys = Object.keys(data);
              const lastKey = keys[keys.length - 1];
              const last = data[lastKey];
              if (last && (last.celsius !== undefined || last.fahrenheit !== undefined)) {
                setLatestData({
                  celsius: Number(last.celsius),
                  fahrenheit: Number(last.fahrenheit),
                  timestamp: Number(last.timestamp) || Date.now()
                });
              } else {
                // default assign if data itself punya fields
                setLatestData({
                  celsius: Number(data.celsius),
                  fahrenheit: Number(data.fahrenheit),
                  timestamp: Number(data.timestamp) || Date.now()
                });
              }
            } else {
              setLatestData({
                celsius: Number(data.celsius),
                fahrenheit: Number(data.fahrenheit),
                timestamp: Number(data.timestamp) || Date.now()
              });
            }
          }
        });
      } catch (err) {
        console.warn('RTDB read error:', err);
      }

      // Load history from Firestore
      try {
        const historyRef = collection(firestore, 'sensorData', 'data', 'history');
        const q = query(historyRef, orderBy('timestamp', 'desc'), limit(100));
        
        const snapshot = await getDocs(q);
        const history = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          // Validate fields, convert to numbers when possible
          const ts = Number(data?.timestamp);
          const c = Number(data?.celsius);
          const f = Number(data?.fahrenheit);
          // only push entries that have at least one numeric temperature or valid timestamp
          if ((!Number.isNaN(ts) && ts > 0) && (Number.isFinite(c) || Number.isFinite(f))) {
            history.push({
              id: doc.id,
              timestamp: ts,
              celsius: Number.isFinite(c) ? c : null,
              fahrenheit: Number.isFinite(f) ? f : null
            });
          }
        });

        // snapshot was ordered desc, we reverse to ascending for plotting left-to-right time
        const sortedHistory = history.reverse();
        setHistoryData(sortedHistory);

        if (sortedHistory.length > 0) {
          setStats({
            total: sortedHistory.length,
            oldestDate: new Date(sortedHistory[0].timestamp),
            newestDate: new Date(sortedHistory[sortedHistory.length - 1].timestamp)
          });
        } else {
          setStats({ total: 0, oldestDate: null, newestDate: null });
        }
      } catch (err) {
        console.warn('Firestore history read error:', err);
      }

      setLoading(false);
    } catch (error) {
      console.error('Error loading data:', error);
      setLoading(false);
    }
  };

  const handleCleanup = async () => {
    if (!confirm(`Hapus data lebih dari ${cleanupDays} hari yang lalu?`)) return;

    setCleanupLoading(true);
    setCleanupResult(null);

    try {
      const olderThan = cleanupDays * 24 * 60 * 60 * 1000;

      const response = await fetch('/api/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ olderThan })
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
        throw new Error(result.error);
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
    return new Date(timestamp).toLocaleString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatChartDate = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Normalize chart data and filter invalid entries
  const chartData = historyData
    .map((item) => {
      const c = Number(item.celsius);
      const f = Number(item.fahrenheit);
      // jika keduanya NaN/undefined, skip
      if (!Number.isFinite(c) && !Number.isFinite(f)) return null;
      return {
        time: formatChartDate(item.timestamp),
        celsius: Number.isFinite(c) ? c : null,
        fahrenheit: Number.isFinite(f) ? f : null,
        timestamp: item.timestamp
      };
    })
    .filter(Boolean);

  // Safe tooltip component
  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload || !payload.length) return null;

    // prefer payload[0].payload which is the original data point
    const point = payload[0] && payload[0].payload ? payload[0].payload : null;
    if (!point) return null;

    const cVal = (payload[0] && typeof payload[0].value !== 'undefined')
      ? Number(payload[0].value)
      : (typeof point.celsius !== 'undefined' ? Number(point.celsius) : NaN);

    const fVal = (payload[1] && typeof payload[1].value !== 'undefined')
      ? Number(payload[1].value)
      : (typeof point.fahrenheit !== 'undefined' ? Number(point.fahrenheit) : NaN);

    const cText = Number.isFinite(cVal) ? cVal.toFixed(2) + '°C' : '--';
    const fText = Number.isFinite(fVal) ? fVal.toFixed(2) + '°F' : '--';

    return (
      <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3">
        <p className="text-sm font-semibold text-gray-800 mb-2">
          {point.timestamp ? formatDate(point.timestamp) : '—'}
        </p>
        <p className="text-sm text-orange-600">
          <span className="font-medium">Celsius:</span> {cText}
        </p>
        <p className="text-sm text-blue-600">
          <span className="font-medium">Fahrenheit:</span> {fText}
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
        <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-blue-500 p-3 rounded-xl">
                <Thermometer className="w-8 h-8 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-800">Temperature Monitor</h1>
                <p className="text-gray-500">Real-time DS18B20 Sensor Dashboard</p>
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <div className="bg-gradient-to-br from-orange-500 to-red-500 rounded-2xl shadow-xl p-6 text-white">
            <div className="flex items-center justify-between mb-4">
              <div className="bg-white/20 p-3 rounded-xl">
                <Thermometer className="w-6 h-6" />
              </div>
              <span className="text-sm font-medium bg-white/20 px-3 py-1 rounded-full">
                Celsius
              </span>
            </div>
            <div className="text-5xl font-bold mb-2">
              {latestData?.celsius != null && Number.isFinite(Number(latestData.celsius)) ? Number(latestData.celsius).toFixed(2) : '--'}°C
            </div>
            <p className="text-white/80 text-sm">
              {latestData?.timestamp ? formatDate(latestData.timestamp) : 'Waiting...'}
            </p>
          </div>

          <div className="bg-gradient-to-br from-blue-500 to-indigo-500 rounded-2xl shadow-xl p-6 text-white">
            <div className="flex items-center justify-between mb-4">
              <div className="bg-white/20 p-3 rounded-xl">
                <Thermometer className="w-6 h-6" />
              </div>
              <span className="text-sm font-medium bg-white/20 px-3 py-1 rounded-full">
                Fahrenheit
              </span>
            </div>
            <div className="text-5xl font-bold mb-2">
              {latestData?.fahrenheit != null && Number.isFinite(Number(latestData.fahrenheit)) ? Number(latestData.fahrenheit).toFixed(2) : '--'}°F
            </div>
            <p className="text-white/80 text-sm">
              {latestData?.timestamp ? formatDate(latestData.timestamp) : 'Waiting...'}
            </p>
          </div>

          <div className="bg-white rounded-2xl shadow-xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="bg-green-100 p-3 rounded-xl">
                <TrendingUp className="w-6 h-6 text-green-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-800">Statistics</h3>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-gray-600">Total Records</span>
                <span className="font-bold text-gray-800">{stats.total}</span>
              </div>
              {historyData.length > 0 && (
                <>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Min Temp</span>
                    <span className="font-bold text-blue-600">
                      {Math.min(...historyData.map(d => d.celsius)).toFixed(1)}°C
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Max Temp</span>
                    <span className="font-bold text-red-600">
                      {Math.max(...historyData.map(d => d.celsius)).toFixed(1)}°C
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Average</span>
                    <span className="font-bold text-gray-800">
                      {(historyData.reduce((a, b) => a + b.celsius, 0) / historyData.length).toFixed(1)}°C
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
          <div className="flex items-center gap-2 mb-6">
            <Activity className="w-6 h-6 text-blue-500" />
            <h3 className="text-xl font-bold text-gray-800">
              Temperature History Chart - Last {historyData.length} Readings
            </h3>
          </div>
          
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={400}>
              <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                <XAxis 
                  dataKey="time" 
                  stroke="#666"
                  style={{ fontSize: '12px' }}
                  angle={-45}
                  textAnchor="end"
                  height={80}
                  interval={Math.floor(chartData.length / 10)}
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
                <Tooltip content={<CustomTooltip />} />
                <Legend 
                  wrapperStyle={{ paddingTop: '20px' }}
                  iconType="line"
                />
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
                <p>Waiting for historical data...</p>
              </div>
            </div>
          )}
        </div>

        {/* rest of UI unchanged... (kept same as original) */}

        <div className="text-center mt-8 text-gray-500 text-sm">
          <p>Dashboard monitoring suhu real-time dengan DS18B20 sensor</p>
          <p className="mt-1">Data disimpan di Firebase RTDB & Firestore</p>
        </div>
      </div>
    </div>
  );
};

export default TemperatureDashboard;
