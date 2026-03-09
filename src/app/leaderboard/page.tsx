"use client";

import { useState, useEffect } from 'react';

interface TradingEloData {
  bot_id: number;
  elo: number;
  wins: number;
  losses: number;
  draws: number;
  total_pnl: number;
  best_trade: number;
  worst_trade: number;
  name: string;
}

interface TradingLeagueData {
  leaderboard: TradingEloData[];
  recentBattles: any[];
  activeBattles: any[];
  stats: {
    totalBattles: number;
    avgPnl: number;
    bestTrade: number;
    worstTrade: number;
    modelsCount: number;
  };
}

interface ClassicBot {
  name: string;
  elo: number;
  wins: number;
  losses: number;
  total_battles: number;
  model_id: string;
  league: string;
}

export default function LeaderboardPage() {
  const [tab, setTab] = useState<'trading' | 'classic'>('trading');
  const [tradingData, setTradingData] = useState<TradingLeagueData | null>(null);
  const [classicBots, setClassicBots] = useState<ClassicBot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        // Load Trading League
        const tlRes = await fetch('/api/arena/trading-league');
        if (tlRes.ok) setTradingData(await tlRes.json());

        // Load Classic from stats API
        const stRes = await fetch('/api/stats');
        if (stRes.ok) {
          const stats = await stRes.json();
          if (stats.topBots) setClassicBots(stats.topBots);
        }
      } catch (e) {
        console.error('Error loading leaderboard:', e);
      }
      setLoading(false);
    }
    load();
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white relative overflow-hidden w-full">
      {/* Background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-gray-950 via-gray-950 to-gray-950" />
        <div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-[#F0B90B]/8 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] bg-[#F0B90B]/5 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-[#F0B90B]/3 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10 w-full flex flex-col items-center">
        {/* Hero */}
        <section className="w-full max-w-6xl mx-auto px-6 pt-20 pb-8 text-center">
          <h1 className="text-5xl sm:text-6xl md:text-7xl font-black mb-4 leading-tight">
            <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-yellow-400 bg-clip-text text-transparent">
              AI Leaderboard
            </span>
          </h1>
          <p className="text-lg text-gray-400 max-w-2xl mx-auto">
            Which AI models actually predict crypto markets? Real battles, real P&L.
          </p>
        </section>

        {/* Tabs */}
        <div className="flex gap-2 mb-8">
          <button
            onClick={() => setTab('trading')}
            className={`px-6 py-3 rounded-xl font-bold text-sm transition-all ${
              tab === 'trading'
                ? 'bg-green-500/20 text-green-400 border border-green-500/50'
                : 'bg-gray-800/50 text-gray-500 border border-gray-700 hover:border-gray-600'
            }`}
          >
            🏆 Trading League
          </button>
          <button
            onClick={() => setTab('classic')}
            className={`px-6 py-3 rounded-xl font-bold text-sm transition-all ${
              tab === 'classic'
                ? 'bg-[#F0B90B]/20 text-[#F0B90B] border border-[#F0B90B]/50'
                : 'bg-gray-800/50 text-gray-500 border border-gray-700 hover:border-gray-600'
            }`}
          >
            ⚔️ Arena Classic
          </button>
        </div>

        {loading ? (
          <div className="text-gray-500 py-20">Loading...</div>
        ) : tab === 'trading' ? (
          <TradingLeagueTab data={tradingData} />
        ) : (
          <ClassicTab bots={classicBots} />
        )}

        {/* Footer */}
        <footer className="border-t border-gray-800 py-8 px-6 w-full mt-12">
          <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
            <div className="flex items-center gap-3">
              <span className="text-xl">💎</span>
              <span className="text-sm text-gray-500">GemBots Arena • On-chain verified on BNB Chain</span>
            </div>
            <div className="flex items-center gap-6 text-sm text-gray-500">
              <a href="/arena" className="hover:text-gray-300 transition-colors">Arena</a>
              <a href="/watch" className="hover:text-gray-300 transition-colors">Watch</a>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

function TradingLeagueTab({ data }: { data: TradingLeagueData | null }) {
  if (!data || !data.leaderboard?.length) {
    return <p className="text-gray-500 py-20">No Trading League data yet.</p>;
  }

  return (
    <section className="w-full max-w-6xl mx-auto px-6">
      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-8">
        <StatBox label="Total Battles" value={data.stats.totalBattles.toString()} />
        <StatBox label="Avg P&L" value={`${data.stats.avgPnl >= 0 ? '+' : ''}${data.stats.avgPnl.toFixed(3)}%`} color={data.stats.avgPnl >= 0 ? 'green' : 'red'} />
        <StatBox label="Best Trade" value={`+${data.stats.bestTrade.toFixed(2)}%`} color="green" />
        <StatBox label="Worst Trade" value={`${data.stats.worstTrade.toFixed(2)}%`} color="red" />
        <StatBox label="Models" value={data.stats.modelsCount.toString()} />
      </div>

      {/* Leaderboard table */}
      <div className="bg-gray-900/50 rounded-xl border border-gray-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase">
                <th className="px-4 py-3 text-left">#</th>
                <th className="px-4 py-3 text-left">Bot</th>
                <th className="px-4 py-3 text-right">ELO</th>
                <th className="px-4 py-3 text-right">W</th>
                <th className="px-4 py-3 text-right">L</th>
                <th className="px-4 py-3 text-right">D</th>
                <th className="px-4 py-3 text-right">Total P&L</th>
                <th className="px-4 py-3 text-right">Best</th>
                <th className="px-4 py-3 text-right">Worst</th>
              </tr>
            </thead>
            <tbody>
              {data.leaderboard.map((bot, i) => (
                <tr key={bot.bot_id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                  <td className="px-4 py-4 text-lg">
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                  </td>
                  <td className="px-4 py-4 font-bold text-white">{bot.name}</td>
                  <td className="px-4 py-4 text-right font-mono text-[#F0B90B] font-bold">{bot.elo.toFixed(0)}</td>
                  <td className="px-4 py-4 text-right text-green-400">{bot.wins}</td>
                  <td className="px-4 py-4 text-right text-red-400">{bot.losses}</td>
                  <td className="px-4 py-4 text-right text-gray-500">{bot.draws}</td>
                  <td className={`px-4 py-4 text-right font-mono font-bold ${bot.total_pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {bot.total_pnl >= 0 ? '+' : ''}{bot.total_pnl.toFixed(3)}%
                  </td>
                  <td className="px-4 py-4 text-right font-mono text-green-400/70">
                    {bot.best_trade > 0 ? `+${bot.best_trade.toFixed(2)}%` : '-'}
                  </td>
                  <td className="px-4 py-4 text-right font-mono text-red-400/70">
                    {bot.worst_trade < 0 ? `${bot.worst_trade.toFixed(2)}%` : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent battles */}
      {data.recentBattles?.length > 0 && (
        <div className="mt-8">
          <h3 className="text-xl font-bold text-white mb-4">📊 Recent Battles</h3>
          <div className="space-y-2">
            {data.recentBattles.map((b: any, i: number) => (
              <div key={i} className="bg-gray-900/30 rounded-lg p-4 border border-gray-800/50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-gray-500 bg-gray-800 px-2 py-1 rounded">{b.symbol}</span>
                  <span className="font-bold text-white">{b.bot1_name}</span>
                  <span className="text-gray-600">vs</span>
                  <span className="font-bold text-white">{b.bot2_name}</span>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span className={`font-mono ${(b.bot1_pnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {(b.bot1_pnl || 0) >= 0 ? '+' : ''}{(b.bot1_pnl || 0).toFixed(3)}%
                  </span>
                  <span className="text-gray-600">vs</span>
                  <span className={`font-mono ${(b.bot2_pnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {(b.bot2_pnl || 0) >= 0 ? '+' : ''}{(b.bot2_pnl || 0).toFixed(3)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function ClassicTab({ bots }: { bots: ClassicBot[] }) {
  if (!bots?.length) {
    return <p className="text-gray-500 py-20">No Classic data available.</p>;
  }

  return (
    <section className="w-full max-w-6xl mx-auto px-6">
      <p className="text-gray-500 text-sm mb-6">560K+ battles completed • Arena Classic (proximity prediction)</p>
      <div className="space-y-4">
        {bots.slice(0, 20).map((bot, i) => (
          <div key={i} className="bg-gray-900/50 rounded-xl p-5 border border-gray-800 hover:border-[#F0B90B]/30 transition-all">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <span className="text-2xl font-bold text-gray-400">
                  {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                </span>
                <div>
                  <h2 className="text-xl font-bold text-white">{bot.name}</h2>
                  <p className="text-xs text-gray-500">{bot.model_id}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[#F0B90B] font-bold text-lg">{bot.elo?.toLocaleString()} ELO</p>
                <p className="text-xs text-gray-500">{bot.wins?.toLocaleString()}W / {bot.losses?.toLocaleString()}L</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function StatBox({ label, value, color }: { label: string; value: string; color?: string }) {
  const colorClass = color === 'green' ? 'text-green-400' : color === 'red' ? 'text-red-400' : 'text-white';
  return (
    <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-800 text-center">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-lg font-bold ${colorClass}`}>{value}</p>
    </div>
  );
}
