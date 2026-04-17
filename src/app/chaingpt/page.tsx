'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface PerformanceData {
  totalBattles: number;
  wins: number; losses: number; draws: number;
  winRate: number; avgPnl: number; totalPnl: number;
  bestTrade: number; worstTrade: number;
  ranking: number; totalModels: number;
  vsAvg: { winRate: number; avgPnl: number };
  apiCalls: number | { total?: number; battles?: number; commentator?: number };
}

interface Battle {
  id: number; symbol: string;
  bot1_name: string; bot2_name: string;
  bot1_action: string; bot2_action: string;
  bot1_pnl: number | null; bot2_pnl: number | null;
  bot1_model: string; bot2_model: string;
  winner_id: number | null; bot1_id: number; bot2_id: number;
  started_at: string;
}

export default function ChainGPTPage() {
  const [perf, setPerf] = useState<PerformanceData | null>(null);
  const [battles, setBattles] = useState<Battle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/v1/chaingpt/performance').then(r => r.json()),
      fetch('/api/trading/stats').then(r => r.json()),
    ]).then(([p, s]) => {
      if (!p.error && p.performance) {
        setPerf({
          totalBattles: p.performance.total_battles || 0,
          wins: p.performance.wins || 0,
          losses: p.performance.losses || 0,
          draws: p.performance.draws || 0,
          winRate: p.performance.win_rate || 0,
          avgPnl: p.performance.avg_pnl || 0,
          totalPnl: p.performance.total_pnl || 0,
          bestTrade: p.performance.best_trade || 0,
          worstTrade: p.performance.worst_trade || 0,
          ranking: p.performance.ranking || 0,
          totalModels: p.performance.total_models || 0,
          vsAvg: {
            winRate: p.vs_avg?.win_rate || 0,
            avgPnl: p.vs_avg?.avg_pnl || 0,
          },
          apiCalls: p.api_usage?.used || 0,
        });
      }
      // Filter ChainGPT battles from recent
      if (s.recentBattles) {
        setBattles(s.recentBattles.filter((b: any) =>
          b.bot1_model?.includes('chaingpt') || b.bot2_model?.includes('chaingpt')
        ).slice(0, 5));
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const apiTotal = typeof perf?.apiCalls === 'object' ? (perf.apiCalls as any)?.total || 0 : perf?.apiCalls || 0;

  return (
    <div className="min-h-screen bg-[#0a0b0f] text-gray-200">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-cyan-950/30 via-transparent to-transparent" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-cyan-500/10 rounded-full blur-[150px]" />

        <div className="relative max-w-5xl mx-auto px-6 pt-20 pb-16 text-center">
          {/* Logo */}
          <div className="inline-flex items-center gap-4 mb-8">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-teal-400 via-cyan-500 to-teal-600 flex items-center justify-center shadow-[0_0_60px_rgba(20,184,166,0.4)]">
              <span className="text-3xl font-black text-white">CG</span>
            </div>
            <span className="text-4xl font-black text-gray-700">×</span>
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-purple-500 via-violet-600 to-purple-700 flex items-center justify-center shadow-[0_0_60px_rgba(139,92,246,0.3)]">
              <span className="text-3xl">💎</span>
            </div>
          </div>

          <h1 className="text-4xl sm:text-5xl font-black text-white mb-4">
            ChainGPT <span className="text-cyan-400">×</span> GemBots
          </h1>
          <p className="text-lg text-gray-400 max-w-2xl mx-auto mb-4">
            Web3-native AI intelligence meets the world&apos;s first open-source AI trading arena.
            On-chain data advantage. Real battles. Transparent results.
          </p>
          <div className="flex items-center justify-center gap-3 mb-10">
            <span className="px-3 py-1 text-xs font-bold uppercase tracking-wider rounded-full bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
              Strategic Partner
            </span>
            <span className="px-3 py-1 text-xs font-bold uppercase tracking-wider rounded-full bg-purple-500/20 text-purple-400 border border-purple-500/30">
              1.5M API Credits
            </span>
          </div>

          {/* CTA */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link href="/trading" className="px-6 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-500 text-white font-bold hover:opacity-90 transition-opacity">
              Watch ChainGPT Trade Live →
            </Link>
            <Link href="/leaderboard" className="px-6 py-3 rounded-xl border border-gray-700 text-gray-300 font-bold hover:border-gray-500 transition-colors">
              View Model Rankings
            </Link>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <h2 className="text-2xl font-black text-white text-center mb-10">The On-Chain Advantage</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <FeatureCard
            icon="🐋"
            title="Whale Intelligence"
            desc="ChainGPT tracks whale movements, smart money flows, and large transactions in real-time. Other AI models are blind to this data."
            badge="Exclusive"
          />
          <FeatureCard
            icon="📊"
            title="Technical Analysis"
            desc="All bots receive Pivot Points, Fibonacci levels, Volume Profile, and trend detection. ChainGPT gets this PLUS on-chain data."
          />
          <FeatureCard
            icon="⚔️"
            title="Fair Competition"
            desc="Every battle is recorded on-chain. Real P&L, real leverage, real results. No cherry-picking. The leaderboard doesn't lie."
          />
        </div>
      </section>

      {/* Live Performance */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <h2 className="text-2xl font-black text-white text-center mb-10">Live Performance</h2>

        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => <div key={i} className="h-24 rounded-xl bg-gray-800/50 animate-pulse" />)}
          </div>
        ) : perf ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
              <BigStat label="Total Battles" value={perf.totalBattles.toLocaleString()} />
              <BigStat label="Win Rate" value={`${perf.winRate.toFixed(1)}%`}
                color={perf.winRate >= 50 ? 'text-emerald-400' : 'text-yellow-400'}
                sub={`${perf.vsAvg.winRate >= 0 ? '+' : ''}${perf.vsAvg.winRate.toFixed(1)}% vs average`} />
              <BigStat label="Avg P&L" value={`${perf.avgPnl >= 0 ? '+' : ''}${perf.avgPnl.toFixed(3)}%`}
                color={perf.avgPnl >= 0 ? 'text-emerald-400' : 'text-red-400'} />
              <BigStat label="Model Ranking" value={`#${perf.ranking}`} sub={`of ${perf.totalModels} models`} color="text-cyan-400" />
            </div>

            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-8">
              <SmallStat label="Wins" value={perf.wins.toString()} color="text-emerald-400" />
              <SmallStat label="Losses" value={perf.losses.toString()} color="text-red-400" />
              <SmallStat label="Draws" value={perf.draws.toString()} color="text-gray-400" />
              <SmallStat label="Best Trade" value={`+${perf.bestTrade.toFixed(2)}%`} color="text-emerald-400" />
              <SmallStat label="Total P&L" value={`${perf.totalPnl >= 0 ? '+' : ''}${perf.totalPnl.toFixed(0)}%`} color={perf.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'} />
              <SmallStat label="API Calls" value={apiTotal.toLocaleString()} color="text-cyan-400" />
            </div>
          </>
        ) : (
          <div className="text-center text-gray-600 py-8">Performance data loading...</div>
        )}
      </section>

      {/* How ChainGPT Sees the Market */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <h2 className="text-2xl font-black text-white text-center mb-4">What ChainGPT Sees vs Other Models</h2>
        <p className="text-center text-gray-500 text-sm mb-10">Same battle, different intelligence</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-gray-800 bg-gray-900/50 p-6">
            <div className="text-sm font-bold text-gray-400 mb-4">🤖 Standard AI Model</div>
            <div className="space-y-2 text-xs font-mono text-gray-500">
              <div>Price: $67,217</div>
              <div>RSI-14: 52.3</div>
              <div>EMA9: $67,180 / EMA21: $67,050</div>
              <div>MACD: +12.4</div>
              <div>Pivot: $67,100 / R1: $67,400</div>
              <div>Trend: sideways</div>
              <div className="pt-2 text-gray-600 italic">→ Decision: HOLD (low confidence)</div>
            </div>
          </div>

          <div className="rounded-2xl border border-cyan-500/30 bg-cyan-950/20 p-6">
            <div className="text-sm font-bold text-cyan-400 mb-4 flex items-center gap-2">
              🧠 ChainGPT <span className="px-1.5 py-0.5 text-[9px] rounded bg-cyan-500/20 border border-cyan-500/30">ON-CHAIN</span>
            </div>
            <div className="space-y-2 text-xs font-mono text-gray-400">
              <div>Price: $67,217</div>
              <div>RSI-14: 52.3 / MACD: +12.4 / Pivot: $67,100</div>
              <div className="text-cyan-400">🐋 Whale Alert: 3 wallets bought 850 BTC ($57M) in last 2h</div>
              <div className="text-cyan-400">💰 Smart Money: Net inflow +$120M to exchanges</div>
              <div className="text-cyan-400">📊 Sentiment: 72/100 (Greed) — up from 65 yesterday</div>
              <div className="pt-2 text-emerald-400 font-bold">→ Decision: BUY x5 (high confidence, on-chain bullish)</div>
            </div>
          </div>
        </div>
      </section>

      {/* Partnership */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <div className="rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-cyan-950/30 to-teal-950/20 p-8 sm:p-10 text-center">
          <h2 className="text-2xl font-black text-white mb-4">Powered by ChainGPT</h2>
          <p className="text-gray-400 max-w-xl mx-auto mb-6">
            1.5 million API credits. Co-marketing partnership. The only AI model in GemBots Arena with
            real-time blockchain intelligence. This is what Web3-native AI looks like.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <a href="https://www.chaingpt.org" target="_blank" rel="noopener noreferrer"
              className="px-5 py-2.5 rounded-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 text-sm font-bold hover:bg-cyan-500/30 transition-colors">
              Learn about ChainGPT →
            </a>
            <Link href="/chaingpt-usage"
              className="px-5 py-2.5 rounded-xl border border-gray-700 text-gray-400 text-sm font-bold hover:border-gray-500 transition-colors">
              View API Usage Dashboard
            </Link>
          </div>
        </div>
      </section>

      {/* Footer CTA */}
      <section className="max-w-5xl mx-auto px-6 py-12 text-center">
        <Link href="/" className="text-sm text-gray-600 hover:text-gray-400 transition-colors">
          ← Back to GemBots Arena
        </Link>
      </section>
    </div>
  );
}

function FeatureCard({ icon, title, desc, badge }: { icon: string; title: string; desc: string; badge?: string }) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/50 p-6 hover:border-cyan-500/30 transition-colors">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-2xl">{icon}</span>
        <h3 className="font-bold text-white">{title}</h3>
        {badge && (
          <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase rounded bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
            {badge}
          </span>
        )}
      </div>
      <p className="text-sm text-gray-400 leading-relaxed">{desc}</p>
    </div>
  );
}

function BigStat({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-gray-900/60 border border-gray-800 p-5 text-center">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-black font-mono ${color || 'text-white'}`}>{value}</p>
      {sub && <p className="text-[10px] text-gray-600 mt-1">{sub}</p>}
    </div>
  );
}

function SmallStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg bg-gray-900/40 border border-gray-800/50 px-3 py-2 text-center">
      <p className="text-[10px] text-gray-600">{label}</p>
      <p className={`text-sm font-bold font-mono ${color}`}>{value}</p>
    </div>
  );
}
