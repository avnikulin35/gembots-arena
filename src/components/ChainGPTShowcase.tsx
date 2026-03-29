'use client';

import { useEffect, useState } from 'react';

interface ChainGPTPerformance {
  totalBattles: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  avgPnl: number;
  totalPnl: number;
  bestTrade: number;
  worstTrade: number;
  ranking: number;
  totalModels: number;
  vsAvg: { winRate: number; avgPnl: number };
  apiCalls: number;
}

export default function ChainGPTShowcase() {
  const [data, setData] = useState<ChainGPTPerformance | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/chaingpt/performance')
      .then((r) => r.json())
      .then((d) => { if (!d.error) setData(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="w-full max-w-6xl mx-auto px-6 py-16">
      <div className="relative rounded-2xl border border-cyan-500/30 overflow-hidden">
        {/* Animated gradient border effect */}
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-teal-500/20 via-cyan-500/20 to-teal-500/20 animate-pulse" />
        <div className="absolute -top-32 -right-32 w-64 h-64 bg-cyan-500/10 rounded-full blur-[100px]" />
        <div className="absolute -bottom-32 -left-32 w-64 h-64 bg-teal-500/10 rounded-full blur-[100px]" />

        <div className="relative bg-gray-950/90 backdrop-blur-md rounded-2xl p-8 sm:p-10">
          {/* Header */}
          <div className="flex flex-col sm:flex-row items-center gap-5 mb-8">
            {/* ChainGPT Logo Badge */}
            <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-teal-400 via-cyan-500 to-teal-600 flex items-center justify-center shadow-[0_0_30px_rgba(20,184,166,0.3)]">
              <span className="text-2xl font-black text-white tracking-tighter">CG</span>
            </div>
            <div className="text-center sm:text-left">
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-2xl sm:text-3xl font-black text-white">ChainGPT</h2>
                <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                  Partner
                </span>
              </div>
              <p className="text-sm text-gray-400">
                Powered by <span className="text-cyan-400 font-semibold">ChainGPT AI</span> — Web3 native intelligence for trading & commentary
              </p>
            </div>
          </div>

          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-20 rounded-xl bg-gray-800/50 animate-pulse" />
              ))}
            </div>
          ) : data ? (
            <>
              {/* Stats Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                <StatCard label="Battles" value={data.totalBattles.toString()} />
                <StatCard
                  label="Win Rate"
                  value={`${data.winRate.toFixed(1)}%`}
                  color={data.winRate >= 50 ? 'green' : 'yellow'}
                  sub={`${data.vsAvg.winRate >= 0 ? '+' : ''}${data.vsAvg.winRate.toFixed(1)}% vs avg`}
                />
                <StatCard
                  label="Avg P&L"
                  value={`${data.avgPnl >= 0 ? '+' : ''}${data.avgPnl.toFixed(3)}%`}
                  color={data.avgPnl >= 0 ? 'green' : 'red'}
                  sub={`${data.vsAvg.avgPnl >= 0 ? '+' : ''}${data.vsAvg.avgPnl.toFixed(3)}% vs avg`}
                />
                <StatCard
                  label="Ranking"
                  value={`#${data.ranking}`}
                  sub={`of ${data.totalModels} models`}
                  color="cyan"
                />
              </div>

              {/* Secondary Stats */}
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 mb-6">
                <MiniStat label="Wins" value={data.wins.toString()} color="text-green-400" />
                <MiniStat label="Losses" value={data.losses.toString()} color="text-red-400" />
                <MiniStat label="Draws" value={data.draws.toString()} color="text-gray-400" />
                <MiniStat label="Best Trade" value={`+${data.bestTrade.toFixed(2)}%`} color="text-green-400" />
                <MiniStat label="Worst Trade" value={`${data.worstTrade.toFixed(2)}%`} color="text-red-400" />
              </div>

              {/* API Calls Counter */}
              <div className="flex items-center justify-between rounded-xl bg-gray-900/60 border border-gray-800 px-5 py-3">
                <div className="flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                  <span className="text-sm text-gray-400">ChainGPT API Calls</span>
                </div>
                <span className="text-lg font-bold font-mono text-cyan-400">
                  {data.apiCalls.toLocaleString()}
                </span>
              </div>
            </>
          ) : (
            <div className="text-center py-8 text-gray-500 text-sm">
              ChainGPT performance data unavailable
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function StatCard({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  const colorClass =
    color === 'green' ? 'text-green-400' :
    color === 'red' ? 'text-red-400' :
    color === 'yellow' ? 'text-yellow-400' :
    color === 'cyan' ? 'text-cyan-400' :
    'text-white';

  return (
    <div className="rounded-xl bg-gray-900/60 border border-gray-800 p-4 text-center">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-xl sm:text-2xl font-black font-mono ${colorClass}`}>{value}</p>
      {sub && <p className="text-[10px] text-gray-600 mt-1">{sub}</p>}
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg bg-gray-900/40 border border-gray-800/50 px-3 py-2 text-center">
      <p className="text-[10px] text-gray-600">{label}</p>
      <p className={`text-sm font-bold font-mono ${color}`}>{value}</p>
    </div>
  );
}
