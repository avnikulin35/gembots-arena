
'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine
} from 'recharts';
import { FaBattleNet, FaRobot, FaBrain, FaClock, FaGithub, FaCopy } from 'react-icons/fa';
import CountUp from 'react-countup';

// --- Interfaces ---

interface HeroStats {
  total_battles: number;
  total_bots: number;
  models_count: number;
  uptime_days: number;
  last_battle_at: string;
}

interface LeaderboardBot {
  bot_name: string;
  strategy: string;
  elo: number;
  wins: number;
  losses: number;
  win_rate: number;
  total_battles: number;
}

interface ModelPerformance {
  model_name: string;
  bots_count: number;
  avg_elo: number;
  avg_win_rate: number;
  total_battles: number;
}

// --- Helper Functions ---

const formatNumber = (num: number): string => {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M+';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(0) + 'K+';
  }
  return num.toLocaleString();
};

const getStrategyBadgeColor = (strategy: string): string => {
  switch (strategy.toLowerCase()) {
    case 'momentum': return 'bg-blue-500';
    case 'mean_reversion': return 'bg-purple-500';
    case 'trend_follower': return 'bg-green-500';
    case 'contrarian': return 'bg-orange-500';
    case 'scalper': return 'bg-red-500';
    case 'whale_watcher': return 'bg-cyan-500';
    default: return 'bg-gray-500';
  }
};

const stripModelPrefix = (modelName: string): string => {
  const parts = modelName.split('/');
  return parts.length > 1 ? parts.slice(1).join('/') : modelName;
};

// --- Components ---

const StatCard: React.FC<{ icon: React.ElementType; title: string; value: number; unit?: string }> = ({ icon: Icon, title, value, unit }) => (
  <div className="relative p-6 bg-gray-900 rounded-lg shadow-lg overflow-hidden border border-transparent hover:border-blue-500 transition-all duration-300">
    <div className="absolute inset-0 bg-gradient-to-br from-gray-800 to-gray-950 opacity-50 z-0"></div>
    <div className="relative z-10 flex flex-col items-center text-center">
      <Icon className="text-4xl text-blue-400 mb-3" />
      <h3 className="text-lg font-semibold text-gray-300 mb-2">{title}</h3>
      <p className="text-5xl font-bold text-white">
        <CountUp end={value} duration={2.5} separator="," formattingFn={formatNumber} />
        {unit && <span className="text-2xl ml-1">{unit}</span>}
      </p>
    </div>
  </div>
);

const LoadingSkeleton: React.FC = () => (
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 animate-pulse">
    {Array(4).fill(0).map((_, i) => (
      <div key={i} className="relative p-6 bg-gray-900 rounded-lg shadow-lg overflow-hidden border border-gray-700 h-40">
        <div className="absolute inset-0 bg-gradient-to-br from-gray-800 to-gray-950 opacity-50 z-0"></div>
        <div className="relative z-10 flex flex-col items-center justify-center h-full">
          <div className="h-8 w-8 bg-gray-700 rounded-full mb-3"></div>
          <div className="h-4 w-3/4 bg-gray-700 rounded mb-2"></div>
          <div className="h-10 w-1/2 bg-gray-700 rounded"></div>
        </div>
      </div>
    ))}
  </div>
);

const APIEndpointCode: React.FC<{ title: string; endpoint: string; response: string }> = ({ title, endpoint, response }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  const codeString = `fetch('${endpoint}')
  .then(response => response.json())
  .then(data => console.log(data));`;

  return (
    <div className="bg-gray-800 p-4 rounded-lg font-mono text-sm text-gray-200">
      <div className="flex justify-between items-center mb-2">
        <h4 className="font-semibold text-white">{title}</h4>
        <button
          onClick={() => handleCopy(codeString)}
          className="px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded text-white text-xs flex items-center transition-colors duration-200"
        >
          <FaCopy className="mr-1" /> {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre className="whitespace-pre-wrap bg-gray-900 p-3 rounded-md overflow-x-auto">
        <code>{codeString}</code>
      </pre>
      <div className="mt-2 text-gray-400">Expected Response:</div>
      <pre className="whitespace-pre-wrap bg-gray-900 p-3 rounded-md overflow-x-auto max-h-40">
        <code>{response}</code>
      </pre>
    </div>
  );
};


// --- Main Page Component ---

const BenchmarkPage: React.FC = () => {
  const [heroStats, setHeroStats] = useState<HeroStats | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardBot[]>([]);
  const [modelPerformance, setModelPerformance] = useState<ModelPerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [heroRes, leaderboardRes, modelsRes] = await Promise.all([
          fetch('/api/benchmark'),
          fetch('/api/benchmark/leaderboard?limit=20'),
          fetch('/api/benchmark/models'),
        ]);

        if (!heroRes.ok || !leaderboardRes.ok || !modelsRes.ok) {
          throw new Error('Failed to fetch data');
        }

        const heroData = await heroRes.json();
        const leaderboardData = await leaderboardRes.json();
        const modelsData = await modelsRes.json();

        setHeroStats(heroData.data);
        setLeaderboard(leaderboardData.data);
        setModelPerformance(modelsData.data.sort((a: ModelPerformance, b: ModelPerformance) => b.avg_win_rate - a.avg_win_rate));
      } catch (err) {
        setError('Failed to load benchmark data.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  if (error) {
    return (
      <div className="min-h-screen bg-gray-950 text-white p-8 flex items-center justify-center">
        <div className="text-red-500 text-xl">{error}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-5xl font-extrabold text-center mb-12 text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-600">
          GemBots Arena Benchmark
        </h1>

        {/* Section 1: Hero Stats */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-gray-200 mb-8 text-center">Arena Overview</h2>
          {loading ? (
            <LoadingSkeleton />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <StatCard icon={FaBattleNet} title="Total Battles" value={heroStats?.total_battles || 0} />
              <StatCard icon={FaRobot} title="Active Bots" value={heroStats?.total_bots || 0} />
              <StatCard icon={FaBrain} title="AI Models" value={heroStats?.models_count || 0} />
              <StatCard icon={FaClock} title="Uptime" value={heroStats?.uptime_days || 0} unit="days" />
            </div>
          )}
        </section>

        {/* Section 2: Model Performance Chart */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-gray-200 mb-8 text-center">Model Performance</h2>
          {loading ? (
            <div className="bg-gray-900 rounded-lg shadow-lg p-6 h-96 flex items-center justify-center animate-pulse">
              <div className="h-4/5 w-11/12 bg-gray-800 rounded"></div>
            </div>
          ) : (
            <div className="bg-gray-900 rounded-lg shadow-lg p-6 h-[500px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={modelPerformance} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                  <XAxis
                    dataKey="model_name"
                    tickFormatter={stripModelPrefix}
                    angle={-45}
                    textAnchor="end"
                    height={80}
                    stroke="#a0aec0" // gray-400
                    tick={{ fill: '#cbd5e0', fontSize: 12 }} // gray-300
                  />
                  <YAxis
                    tickFormatter={(value) => `${Number(value).toFixed(0)}%`}
                    stroke="#a0aec0" // gray-400
                    tick={{ fill: '#cbd5e0', fontSize: 12 }} // gray-300
                    domain={[0, 1]}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(255,255,255,0.1)' }}
                    formatter={(value: number | undefined) => [`${(value || 0).toFixed(1)}%`, 'Win Rate']}
                    labelFormatter={(label) => stripModelPrefix(label)}
                    contentStyle={{ backgroundColor: '#2d3748', border: 'none', borderRadius: '4px', color: '#fff' }} // gray-700
                    labelStyle={{ color: '#fff', fontWeight: 'bold' }}
                  />
                  <ReferenceLine y={50} stroke="#cbd5e0" strokeDasharray="3 3" label={{ position: 'insideTopRight', value: '50% Baseline', fill: '#cbd5e0', fontSize: 12 }} />
                  <Bar dataKey="avg_win_rate" radius={[4, 4, 0, 0]}>
                    {modelPerformance.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.avg_win_rate >= 50 ? '#10b981' : '#ef4444'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        {/* Section 3: Bot Leaderboard Table */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-gray-200 mb-8 text-center">Top 20 Bot Leaderboard</h2>
          {loading ? (
            <div className="bg-gray-900 rounded-lg shadow-lg p-6 animate-pulse">
              <div className="h-10 bg-gray-800 rounded mb-4"></div>
              {Array(10).fill(0).map((_, i) => (
                <div key={i} className="h-12 bg-gray-800 rounded mb-2"></div>
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto bg-gray-900 rounded-lg shadow-lg">
              <table className="min-w-full divide-y divide-gray-700">
                <thead className="bg-gray-800">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                      Rank
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                      Bot Name
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                      Strategy
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                      ELO
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                      Win Rate
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                      Total Battles
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-gray-900 divide-y divide-gray-800">
                  {leaderboard.map((bot, index) => (
                    <tr key={bot.bot_name} className="hover:bg-gray-800 transition-colors duration-200">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-300">
                        #{index + 1}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-200">
                        {bot.bot_name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStrategyBadgeColor(bot.strategy)} text-white`}>
                          {bot.strategy}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                        {bot.elo.toFixed(0)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                        {bot.win_rate.toFixed(1)}%
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                        {formatNumber(bot.total_battles)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Section 4: API Access CTA */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-gray-200 mb-8 text-center">Access Data Programmatically</h2>
          <div className="bg-gray-900 p-8 rounded-lg shadow-lg">
            <p className="text-gray-300 mb-6 text-center text-lg">
              Integrate GemBots Arena data directly into your applications using our powerful API.
            </p>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
              <APIEndpointCode
                title="Arena Overview"
                endpoint="/api/benchmark"
                response="{ data: { total_battles: 419743, total_bots: 53, models_count: 16, uptime_days: 30, last_battle_at: '2023-10-27T10:00:00Z' } }"
              />
              <APIEndpointCode
                title="Bot Leaderboard"
                endpoint="/api/benchmark/leaderboard?limit=20"
                response="{ data: [{ bot_name: 'AlphaBot', strategy: 'momentum', elo: 192750, wins: 56760, losses: 56712, win_rate: 50.0, total_battles: 113472 }], meta: { total: 53, limit: 20, offset: 0, has_more: true } }"
              />
              <APIEndpointCode
                title="Model Performance"
                endpoint="/api/benchmark/models"
                response="{ data: [{ model_name: 'mistralai/mistral-nemo', bots_count: 3, avg_elo: 65613, avg_win_rate: 52.5, total_battles: 107073 }], meta: { total: 16 } }"
              />
            </div>
            <div className="text-center">
              <a
                href="https://github.com/gembots" // Placeholder, replace with actual GitHub link if available
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 transition-colors duration-200"
              >
                <FaGithub className="mr-3 text-xl" />
                View on GitHub
              </a>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default BenchmarkPage;
