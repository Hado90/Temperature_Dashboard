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
      const rtdbRef = ref(rtdb, 'sensorData/temperature');
      onValue(rtdbRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          setLatestData(data);
        }
      });

      // Load history from Firestore
      const historyRef = collection(firestore, 'sensorData', 'data', 'history');
      const q = query(historyRef, orderBy('timestamp', 'desc'), limit(100));
      
      const snapshot = await getDocs(q);
      const history = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        history.push({
          id: doc.id,
          timestamp: parseInt(data.timestamp),
          celsius: parseFloat(data.celsius),
          fahrenheit: parseFloat(data.fahrenheit)
        });
      });

      const sortedHistory = history.reverse();
      setHistoryData(sortedHistory);

      if (sortedHistory.length > 0) {
        setStats({
          total: sortedHistory.length,
          oldestDate: new Date(sortedHistory[0].timestamp),
          newestDate: new Date(sortedHistory[sortedHistory.length - 1].timestamp)
        });
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

  const chartData = historyData.map((item) => ({
    time: formatChartDate(item.timestamp),
    celsius: item.celsius,
    fahrenheit: item.fahrenheit,
    timestamp: item.timestamp
  }));

  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3">
          <p className="text-sm font-semibold text-gray-800 mb-2">
            {formatDate(payload[0].payload.timestamp)}
          </p>
          <p className="text-sm text-orange-600">
            <span className="font-medium">Celsius:</span> {payload[0].value.toFixed(2)}°C
          </p>
          <p className="text-sm text-blue-600">
            <span className="font-medium">Fahrenheit:</span> {payload[1].value.toFixed(2)}°F
          </p>
        </div>
      );
    }
    return null;
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
              {latestData?.celsius ? latestData.celsius.toFixed(2) : '--'}°C
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
              {latestData?.fahrenheit ? latestData.fahrenheit.toFixed(2) : '--'}°F
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
          
          {historyData.length > 0 ? (
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
                  interval={Math.floor(historyData.length / 10)}
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

        <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
          <div className="flex items-center gap-2 mb-6">
            <TrendingUp className="w-6 h-6 text-purple-500" />
            <h3 className="text-xl font-bold text-gray-800">
              Temperature Trend (Area Chart)
            </h3>
          </div>
          
          {historyData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorCelsius" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f97316" stopOpacity={0.8}/>
                    <stop offset="95%" stopColor="#f97316" stopOpacity={0.1}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                <XAxis 
                  dataKey="time" 
                  stroke="#666"
                  style={{ fontSize: '12px' }}
                  interval={Math.floor(historyData.length / 10)}
                />
                <YAxis 
                  stroke="#666"
                  style={{ fontSize: '12px' }}
                  label={{ value: 'Temperature (°C)', angle: -90, position: 'insideLeft' }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Area 
                  type="monotone" 
                  dataKey="celsius" 
                  stroke="#f97316" 
                  fillOpacity={1} 
                  fill="url(#colorCelsius)"
                  name="Temperature (°C)"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-72 flex items-center justify-center text-gray-400">
              <p>No data available</p>
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
          <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-blue-500" />
            Recent Temperature Readings (Last 30)
          </h3>
          {historyData.length > 0 ? (
            <>
              <div className="h-64 flex items-end justify-between gap-1">
                {historyData.slice(-30).map((data, index) => {
                  const minTemp = Math.min(...historyData.map(d => d.celsius));
                  const maxTemp = Math.max(...historyData.map(d => d.celsius));
                  const range = maxTemp - minTemp || 10;
                  const height = ((data.celsius - minTemp) / range) * 80 + 10;
                  
                  return (
                    <div
                      key={data.id || index}
                      className="flex-1 bg-gradient-to-t from-blue-500 to-indigo-500 rounded-t-lg hover:from-blue-600 hover:to-indigo-600 transition-all cursor-pointer group relative"
                      style={{ height: `${height}%` }}
                    >
                      <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                        {data.celsius.toFixed(1)}°C
                        <div className="text-gray-300 text-[10px] mt-0.5">
                          {formatChartDate(data.timestamp)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between text-xs text-gray-500 mt-2">
                <span>Oldest</span>
                <span>Latest</span>
              </div>
            </>
          ) : (
            <div className="h-64 flex items-center justify-center text-gray-400">
              <p>Waiting for data...</p>
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-red-100 p-3 rounded-xl">
              <Database className="w-6 h-6 text-red-600" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-gray-800">Data Cleanup</h3>
              <p className="text-sm text-gray-500">Hapus data historis lama secara manual</p>
            </div>
          </div>

          {stats.oldestDate && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <p className="text-gray-700">
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
                Hapus data lebih dari (hari):
              </label>
              <input
                type="number"
                value={cleanupDays}
                onChange={(e) => setCleanupDays(parseInt(e.target.value) || 1)}
                min="1"
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-transparent"
                placeholder="7"
              />
              <p className="text-xs text-gray-500 mt-2">
                Data sebelum {new Date(Date.now() - cleanupDays * 24 * 60 * 60 * 1000).toLocaleDateString('id-ID')} akan dihapus
              </p>
            </div>

            <div className="flex items-end">
              <button
                onClick={handleCleanup}
                disabled={cleanupLoading}
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
                    Hapus Data Lama
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

        <div className="text-center mt-8 text-gray-500 text-sm">
          <p>Dashboard monitoring suhu real-time dengan DS18B20 sensor</p>
          <p className="mt-1">Data disimpan di Firebase RTDB & Firestore</p>
        </div>
      </div>
    </div>
  );
};

export default TemperatureDashboard;
