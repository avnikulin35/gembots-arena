'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getModelDisplayName } from '@/lib/model-display';
import dynamic from 'next/dynamic';

const BattleChart = dynamic(() => import('@/components/BattleChart'), { ssr: false });

// ─── TYPES ────────────────────────────────────────────────────────────────────

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

interface TradingPortfolioData {
  bot_id: number;
  name: string;
  balance: number;
  peak_balance: number;
  total_trades: number;
  total_pnl_usd: number;
  drawdown_pct: number;
}

interface ModelStats {
  model: string;
  battles: number;
  wins: number;
  losses: number;
  draws: number;
  win_rate: number;
  avg_pnl: number;
  total_pnl: number;
  best_trade: number;
  worst_trade: number;
}

interface Battle {
  id: number;
  symbol: string;
  bot1_name: string;
  bot2_name: string;
  bot1_action: string;
  bot2_action: string;
  bot1_leverage: number;
  bot2_leverage: number;
  bot1_pnl: number | null;
  bot2_pnl: number | null;
  entry_price: number;
  started_at: string;
  resolved_at: string | null;
  winner_id: number | null;
  bot1_id: number;
  bot2_id: number;
  status: string;
}

interface TradingLeagueData {
  leaderboard: TradingEloData[];
  modelLeaderboard: ModelStats[];
  recentBattles: Battle[];
  activeBattles: Battle[];
  stats: {
    totalBattles: number;
    avgPnl: number;
    bestTrade: number;
    worstTrade: number;
    modelsCount: number;
  };
}

// ─── UTILS ────────────────────────────────────────────────────────────────────

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function actionColor(action: string): string {
  if (!action) return 'text-gray-500';
  const a = action.toUpperCase();
  if (a === 'BUY' || a === 'LONG') return 'text-emerald-400';
  if (a === 'SELL' || a === 'SHORT') return 'text-red-400';
  return 'text-cyan-400';
}

function actionBg(action: string): string {
  if (!action) return 'bg-gray-800';
  const a = action.toUpperCase();
  if (a === 'BUY' || a === 'LONG') return 'bg-emerald-500/15 border-emerald-500/30';
  if (a === 'SELL' || a === 'SHORT') return 'bg-red-500/15 border-red-500/30';
  return 'bg-cyan-500/15 border-cyan-500/30';
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function TradingDashboard() {
  const [tradingData, setTradingData] = useState<TradingLeagueData | null>(null);
  const [portfolios, setPortfolios] = useState<TradingPortfolioData[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  const fetchData = useCallback(async () => {
    try {
      const [tlRes, pRes] = await Promise.all([
        fetch('/api/arena/trading-league'),
        fetch('/api/arena/portfolio'),
      ]);
      if (tlRes.ok) setTradingData(await tlRes.json());
      if (pRes.ok) {
        const pJson = await pRes.json();
        setPortfolios(Array.isArray(pJson?.portfolios) ? pJson.portfolios : []);
      }
      setLastUpdate(new Date());
    } catch (e) {
      console.error('Error loading trading data:', e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const initialLoad = setTimeout(() => {
      void fetchData();
    }, 0);

    const interval = setInterval(() => {
      void fetchData();
    }, 10000);

    return () => {
      clearTimeout(initialLoad);
      clearInterval(interval);
    };
  }, [fetchData]);

  return (
    <div className="min-h-screen bg-gray-950 text-white relative overflow-hidden w-full">
      {/* Animated background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-gray-950 via-gray-950 to-gray-950" />
        <div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-cyan-400/5 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] bg-emerald-400/5 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-cyan-400/3 rounded-full blur-[150px]" />
        <div className="absolute inset-0 opacity-[0.02]" style={{
          backgroundImage: 'linear-gradient(rgba(0,240,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(0,240,255,0.1) 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }} />
      </div>

      <div className="relative z-10 w-full flex flex-col items-center">
        {/* Header */}
        <motion.section
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-7xl mx-auto px-4 sm:px-6 pt-20 pb-6"
        >
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-4xl sm:text-5xl font-black leading-tight">
                <span className="bg-gradient-to-r from-cyan-400 via-emerald-400 to-cyan-300 bg-clip-text text-transparent">
                  Trading Dashboard
                </span>
              </h1>
              <p className="text-sm text-gray-500 mt-2">
                Real-time AI trading arena — live battles, portfolio rankings, model performance
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              Live — updated {lastUpdate.toLocaleTimeString()}
            </div>
          </div>
        </motion.section>

        {loading ? (
          <div className="flex items-center gap-3 text-gray-500 py-32">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Loading trading data...
          </div>
        ) : (
          <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 space-y-6 pb-16">
            {/* 24h Stats Bar */}
            <StatsBar stats={tradingData?.stats ?? null} />

            {/* Live Battles */}
            <LiveBattles
              active={tradingData?.activeBattles ?? []}
              recent={tradingData?.recentBattles ?? []}
            />

            {/* Trading League Boards */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              <TradingEloLeaderboard leaderboard={tradingData?.leaderboard ?? []} />
              <PortfolioLeaderboard portfolios={portfolios} />
              <ModelPerformanceCards models={tradingData?.modelLeaderboard ?? []} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── 24h STATS BAR ────────────────────────────────────────────────────────────

function StatsBar({ stats }: { stats: TradingLeagueData['stats'] | null }) {
  if (!stats) return null;

  const items = [
    { label: 'Total Battles', value: stats.totalBattles.toLocaleString(), icon: '&#x2694;&#xFE0F;', color: 'text-cyan-400' },
    { label: 'Best Trade', value: `+${stats.bestTrade.toFixed(2)}%`, icon: '&#x1F4C8;', color: 'text-emerald-400' },
    { label: 'Worst Trade', value: `${stats.worstTrade.toFixed(2)}%`, icon: '&#x1F4C9;', color: 'text-red-400' },
    { label: 'Avg P&L', value: `${stats.avgPnl >= 0 ? '+' : ''}${stats.avgPnl.toFixed(3)}%`, icon: '&#x1F4CA;', color: stats.avgPnl >= 0 ? 'text-emerald-400' : 'text-red-400' },
    { label: 'AI Models', value: stats.modelsCount.toString(), icon: '&#x1F916;', color: 'text-cyan-400' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 }}
      className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3"
    >
      {items.map((item, i) => (
        <motion.div
          key={item.label}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3, delay: 0.1 + i * 0.05 }}
          className="bg-gray-900/60 backdrop-blur-sm rounded-xl p-4 border border-gray-800/80 hover:border-cyan-500/30 transition-all group"
        >
          <p className="text-xs text-gray-500 mb-1 flex items-center gap-1.5">
            <span dangerouslySetInnerHTML={{ __html: item.icon }} />
            {item.label}
          </p>
          <p className={`text-xl font-bold font-mono ${item.color} group-hover:drop-shadow-[0_0_8px_rgba(0,240,255,0.3)] transition-all`}>
            {item.value}
          </p>
        </motion.div>
      ))}
    </motion.div>
  );
}

// ─── LIVE BATTLES ─────────────────────────────────────────────────────────────

function LiveBattles({ active, recent }: { active: Battle[]; recent: Battle[] }) {
  const [selectedBattle, setSelectedBattle] = useState<string | null>(null);
  const allBattles = [...active, ...recent];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.2 }}
      className="bg-gray-900/50 backdrop-blur-sm rounded-xl border border-gray-800/80 overflow-hidden"
    >
      <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-cyan-500" />
          </span>
          Live Battles
          {active.length > 0 && (
            <span className="text-xs font-normal bg-cyan-500/20 text-cyan-400 px-2 py-0.5 rounded-full border border-cyan-500/30">
              {active.length} active
            </span>
          )}
        </h2>
        <span className="text-xs text-gray-600">Auto-refreshes every 10s</span>
      </div>

      {/* Battle Chart Modal */}
      {selectedBattle && (
        <BattleChart battleId={selectedBattle} onClose={() => setSelectedBattle(null)} />
      )}

      {allBattles.length === 0 ? (
        <div className="p-8 text-center text-gray-600">No battles found yet.</div>
      ) : (
        <div className="divide-y divide-gray-800/50">
          <AnimatePresence mode="popLayout">
            {allBattles.slice(0, 10).map((b, i) => {
              const isActive = !b.resolved_at;
              return (
                <motion.div
                  key={b.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.3, delay: i * 0.03 }}
                  onClick={() => setSelectedBattle(b.id.toString())}
                  className={`px-5 py-4 flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-0 justify-between hover:bg-gray-800/20 transition-colors cursor-pointer ${
                    isActive ? 'bg-cyan-500/[0.02]' : ''
                  }`}
                >
                  {/* Left: status + symbol + bots */}
                  <div className="flex items-center gap-3 flex-wrap">
                    {isActive ? (
                      <span className="text-[10px] font-bold uppercase tracking-wider bg-cyan-500/20 text-cyan-400 px-2 py-0.5 rounded border border-cyan-500/30">
                        Live
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold uppercase tracking-wider bg-gray-800 text-gray-500 px-2 py-0.5 rounded border border-gray-700">
                        Done
                      </span>
                    )}
                    <span className="text-xs font-mono text-gray-400 bg-gray-800/80 px-2 py-1 rounded">
                      {b.symbol}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white text-sm">{b.bot1_name}</span>
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded border ${actionBg(b.bot1_action)} ${actionColor(b.bot1_action)}`}>
                        {(b.bot1_action || '?').toUpperCase()}
                        {b.bot1_leverage > 1 && <span className="ml-0.5 text-[10px] opacity-70">{b.bot1_leverage}x</span>}
                      </span>
                      <span className="text-gray-600 text-xs">vs</span>
                      <span className="font-bold text-white text-sm">{b.bot2_name}</span>
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded border ${actionBg(b.bot2_action)} ${actionColor(b.bot2_action)}`}>
                        {(b.bot2_action || '?').toUpperCase()}
                        {b.bot2_leverage > 1 && <span className="ml-0.5 text-[10px] opacity-70">{b.bot2_leverage}x</span>}
                      </span>
                    </div>
                  </div>

                  {/* Right: price, pnl, time */}
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-xs text-gray-600 font-mono">
                      ${b.entry_price?.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </span>
                    {b.bot1_pnl !== null && (
                      <span className={`font-mono font-bold ${(b.bot1_pnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {(b.bot1_pnl ?? 0) >= 0 ? '+' : ''}{(b.bot1_pnl ?? 0).toFixed(3)}%
                      </span>
                    )}
                    {b.bot2_pnl !== null && (
                      <>
                        <span className="text-gray-700">vs</span>
                        <span className={`font-mono font-bold ${(b.bot2_pnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {(b.bot2_pnl ?? 0) >= 0 ? '+' : ''}{(b.bot2_pnl ?? 0).toFixed(3)}%
                        </span>
                      </>
                    )}
                    <span className="text-xs text-gray-600">
                      {b.started_at ? timeAgo(b.started_at) : ''}
                    </span>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  );
}

// ─── TRADING ELO LEADERBOARD ─────────────────────────────────────────────────

function TradingEloLeaderboard({ leaderboard }: { leaderboard: TradingEloData[] }) {
  const rankBadge = (i: number) =>
    i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.25 }}
      className="bg-gray-900/50 backdrop-blur-sm rounded-xl border border-gray-800/80 overflow-hidden"
    >
      <div className="px-5 py-4 border-b border-gray-800">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <span>⚔️</span> Trading ELO
        </h2>
      </div>

      {leaderboard.length === 0 ? (
        <div className="p-8 text-center text-gray-600">No ELO data yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-[11px] text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-3 text-left">#</th>
                <th className="px-4 py-3 text-left">Bot</th>
                <th className="px-4 py-3 text-right">ELO</th>
                <th className="px-4 py-3 text-right">W/L/D</th>
                <th className="px-4 py-3 text-right">Total P&L</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.slice(0, 15).map((bot, i) => {
                const pnlColor = bot.total_pnl >= 0 ? 'text-emerald-400' : 'text-red-400';
                return (
                  <motion.tr
                    key={bot.bot_id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.25 + i * 0.03 }}
                    className="border-b border-gray-800/40 hover:bg-gray-800/20 transition-colors"
                  >
                    <td className="px-4 py-3 text-base">{rankBadge(i)}</td>
                    <td className="px-4 py-3 font-bold text-white truncate max-w-[140px]">{bot.name}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-cyan-400">{bot.elo.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-mono text-gray-400">
                      <span className="text-emerald-400">{bot.wins}</span>
                      <span className="text-gray-600">/</span>
                      <span className="text-red-400">{bot.losses}</span>
                      <span className="text-gray-600">/</span>
                      <span className="text-gray-500">{bot.draws}</span>
                    </td>
                    <td className={`px-4 py-3 text-right font-mono ${pnlColor}`}>
                      {bot.total_pnl >= 0 ? '+' : ''}{bot.total_pnl.toFixed(2)}%
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </motion.div>
  );
}

// ─── PORTFOLIO LEADERBOARD ────────────────────────────────────────────────────

function PortfolioLeaderboard({ portfolios }: { portfolios: TradingPortfolioData[] }) {
  const rankBadge = (i: number) =>
    i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.3 }}
      className="bg-gray-900/50 backdrop-blur-sm rounded-xl border border-gray-800/80 overflow-hidden"
    >
      <div className="px-5 py-4 border-b border-gray-800">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <span>🏆</span> Portfolio Leaderboard
        </h2>
      </div>

      {portfolios.length === 0 ? (
        <div className="p-8 text-center text-gray-600">No portfolio data yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-[11px] text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-3 text-left">#</th>
                <th className="px-4 py-3 text-left">Bot</th>
                <th className="px-4 py-3 text-right">Balance</th>
                <th className="px-4 py-3 text-right">P&L</th>
                <th className="px-4 py-3 text-right">Trades</th>
                <th className="px-4 py-3 text-right">DD%</th>
              </tr>
            </thead>
            <tbody>
              {portfolios.slice(0, 15).map((p, i) => {
                const balColor = p.balance > 10000 ? 'text-emerald-400' : p.balance < 10000 ? 'text-red-400' : 'text-white';
                const pnlColor = p.total_pnl_usd >= 0 ? 'text-emerald-400' : 'text-red-400';
                return (
                  <motion.tr
                    key={p.bot_id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.3 + i * 0.03 }}
                    className="border-b border-gray-800/40 hover:bg-gray-800/20 transition-colors"
                  >
                    <td className="px-4 py-3 text-base">{rankBadge(i)}</td>
                    <td className="px-4 py-3 font-bold text-white truncate max-w-[140px]">{p.name}</td>
                    <td className={`px-4 py-3 text-right font-mono font-bold ${balColor}`}>
                      {currencyFormatter.format(p.balance)}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono ${pnlColor}`}>
                      {p.total_pnl_usd >= 0 ? '+' : ''}{currencyFormatter.format(p.total_pnl_usd)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-400">{p.total_trades}</td>
                    <td className={`px-4 py-3 text-right font-mono ${p.drawdown_pct > 5 ? 'text-red-400' : 'text-gray-500'}`}>
                      {p.drawdown_pct.toFixed(1)}%
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </motion.div>
  );
}

// ─── MODEL PERFORMANCE CARDS ──────────────────────────────────────────────────

function ModelPerformanceCards({ models }: { models: ModelStats[] }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.35 }}
      className="space-y-3"
    >
      <h2 className="text-lg font-bold text-white flex items-center gap-2 px-1">
        <span>🤖</span> Model Performance
      </h2>

      {models.length === 0 ? (
        <div className="bg-gray-900/50 rounded-xl border border-gray-800/80 p-8 text-center text-gray-600">
          No model data yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {models.slice(0, 8).map((m, i) => {
            const displayName = getModelDisplayName(m.model);
            const winColor = m.win_rate >= 55 ? 'text-emerald-400' : m.win_rate >= 45 ? 'text-cyan-400' : 'text-red-400';
            const pnlColor = m.avg_pnl >= 0 ? 'text-emerald-400' : 'text-red-400';
            const borderHover = m.win_rate >= 55
              ? 'hover:border-emerald-500/40 hover:shadow-[0_0_20px_rgba(16,185,129,0.1)]'
              : 'hover:border-cyan-500/30 hover:shadow-[0_0_20px_rgba(0,240,255,0.08)]';

            return (
              <motion.div
                key={m.model}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3, delay: 0.35 + i * 0.05 }}
                className={`bg-gray-900/60 backdrop-blur-sm rounded-xl border border-gray-800/80 p-4 transition-all ${borderHover}`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-bold text-white text-sm">{displayName}</p>
                    <p className="text-[10px] text-gray-600">{m.model.split('/')[0]}</p>
                  </div>
                  <span className={`text-lg font-black font-mono ${winColor}`}>
                    {m.win_rate.toFixed(0)}%
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase">Avg PnL</p>
                    <p className={`text-sm font-mono font-bold ${pnlColor}`}>
                      {m.avg_pnl >= 0 ? '+' : ''}{m.avg_pnl.toFixed(3)}%
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase">Battles</p>
                    <p className="text-sm font-mono font-bold text-gray-300">{m.battles}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase">W/L</p>
                    <p className="text-sm font-mono">
                      <span className="text-emerald-400">{m.wins}</span>
                      <span className="text-gray-600">/</span>
                      <span className="text-red-400">{m.losses}</span>
                    </p>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
