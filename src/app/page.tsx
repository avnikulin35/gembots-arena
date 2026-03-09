'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { useContractStats } from '@/hooks/useNFAContract';

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface StatsData {
  totalBattles: number;
  totalBots: number;
  avgBattlesPerDay: number;
  tradingLeagueBattles?: number;
  tradingLeague?: { stats: { bestTrade: number; avgPnl: number } };
}

interface TradingLeagueBattle {
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

interface LeaderboardBot {
  name: string;
  elo: number;
  wins: number;
  losses: number;
  draws: number;
  total_pnl: number;
}

interface TradingLeagueData {
  leaderboard: LeaderboardBot[];
  recentBattles: TradingLeagueBattle[];
  activeBattles: TradingLeagueBattle[];
  stats: { totalBattles: number; bestTrade: number; avgPnl: number };
}

// ─── ANIMATED BACKGROUND ──────────────────────────────────────────────────────

function ArenaBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <div className="absolute inset-0 bg-gradient-to-b from-gray-950 via-gray-950 to-gray-950" />
      <div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-[#F0B90B]/8 rounded-full blur-[120px] animate-pulse" />
      <div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] bg-[#F0B90B]/5 rounded-full blur-[120px] animate-pulse" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-[#F0B90B]/3 rounded-full blur-[100px]" />
      <div className="absolute inset-0 opacity-[0.03]" style={{
        backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
        backgroundSize: '60px 60px',
      }} />
    </div>
  );
}

// ─── ANIMATED COUNTER ─────────────────────────────────────────────────────────

function AnimatedCounter({ target, duration = 2000 }: { target: number; duration?: number }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (target === 0) return;
    const start = Date.now();
    const step = () => {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.round(target * eased));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [target, duration]);
  return <>{count.toLocaleString()}</>;
}

// ─── GITHUB ICON ──────────────────────────────────────────────────────────────

function GitHubIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const NFA_CONTRACT = '0x9bC5f392cE8C7aA13BD5bC7D5A1A12A4DD58b3D5';

const HOW_IT_WORKS = [
  { icon: '🧠', title: 'Build a Strategy', desc: 'Define your AI trading logic — indicators, risk rules, entry/exit conditions. Each strategy is unique.' },
  { icon: '⚡', title: 'Mint Your NFA', desc: 'Turn your strategy into a Non-Fungible Agent (BAP-578) on BNB Chain. Your strategyHash is verified on-chain.' },
  { icon: '⚔️', title: 'Battle & Evolve', desc: 'Pit your NFA against others in the Arena. Win battles to earn XP, climb tiers from Bronze to Legendary.' },
  { icon: '🏆', title: 'Climb the Leaderboard', desc: 'Top-performing agents rise to the top. Prove your strategy is the best in the Arena.' },
];

const WHY_OPEN_SOURCE = [
  { icon: '🔗', title: 'On-Chain Verification', desc: 'All battle results are recorded and verifiable on BNB Chain. No hidden logic, no black boxes.' },
  { icon: '🔐', title: 'Strategy Hash Integrity', desc: 'Every NFA strategy is hashed with keccak256 and stored on-chain. Tampering is impossible.' },
  { icon: '📂', title: 'Full Source on GitHub', desc: 'Every line of code is public. Audit the battle engine, verify the smart contracts, read the algorithms.' },
  { icon: '🤝', title: 'Community-Driven', desc: 'Fork it, improve it, contribute. Open PRs, report issues, propose features. The arena belongs to everyone.' },
];

const SYMBOL_COLORS: Record<string, string> = {
  BTCUSDT: 'text-orange-400',
  ETHUSDT: 'text-blue-400',
  SOLUSDT: 'text-purple-400',
};

// ─── LIVE TRADING LEAGUE SECTION ──────────────────────────────────────────────

function LiveTradingLeague() {
  const [data, setData] = useState<TradingLeagueData | null>(null);

  useEffect(() => {
    const load = () => {
      fetch('/api/arena/trading-league')
        .then(r => r.json())
        .then(setData)
        .catch(() => {});
    };
    load();
    const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, []);

  const formatPnl = (pnl: number | null | undefined) => {
    if (pnl == null) return <span className="text-gray-500">—</span>;
    const sign = pnl >= 0 ? '+' : '';
    return <span className={pnl >= 0 ? 'text-green-400' : 'text-red-400'}>{sign}{pnl.toFixed(2)}%</span>;
  };

  const timeAgo = (d: string) => {
    const sec = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
    if (sec < 60) return `${sec}s ago`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    return `${Math.floor(sec / 3600)}h ago`;
  };

  const active = data?.activeBattles || [];
  const recent = (data?.recentBattles || []).slice(0, 5);
  const top5 = (data?.leaderboard || []).slice(0, 5);

  return (
    <section className="w-full max-w-6xl mx-auto px-6 py-20">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className="rounded-2xl border border-green-500/20 bg-gradient-to-br from-green-900/10 via-gray-900/80 to-gray-950 p-8 sm:p-12 relative overflow-hidden"
      >
        <div className="absolute -top-20 -right-20 w-60 h-60 bg-green-500/10 rounded-full blur-[80px]" />

        <div className="relative z-10">
          <div className="flex flex-col items-center gap-3 mb-10">
            <span className="text-5xl">🏆</span>
            <h2 className="text-3xl sm:text-4xl font-black text-white">Live Trading League</h2>
            <p className="text-sm text-green-400/70 font-medium">
              AI bots compete with real market data • 15-min battles • BTC / ETH / SOL
            </p>
          </div>

          {/* Active Battles */}
          {active.length > 0 && (
            <div className="mb-10">
              <h3 className="text-lg font-bold text-green-400 mb-4 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                {active.length} Active Battle{active.length !== 1 ? 's' : ''}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {active.map((b) => (
                  <div key={b.id} className="rounded-xl border border-green-500/20 bg-gray-900/60 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full bg-gray-800 ${SYMBOL_COLORS[b.symbol] || 'text-gray-400'}`}>
                        {b.symbol}
                      </span>
                      <span className="flex items-center gap-1 text-[10px] text-green-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" /> LIVE
                      </span>
                    </div>
                    <div className="text-center">
                      <span className="text-sm font-bold text-white">{b.bot1_name}</span>
                      <span className="text-xs text-gray-500 mx-2">vs</span>
                      <span className="text-sm font-bold text-white">{b.bot2_name}</span>
                    </div>
                    <div className="text-center text-xs text-gray-500 mt-2">
                      Entry: ${b.entry_price?.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top 5 + Recent Results side by side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
            {/* Top 5 Leaderboard */}
            <div>
              <h3 className="text-lg font-bold text-[#F0B90B] mb-4">🏅 Top 5 Bots</h3>
              <div className="space-y-2">
                {top5.length > 0 ? top5.map((bot, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-900/60 border border-gray-800 px-4 py-3">
                    <span className="text-lg">{['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][i]}</span>
                    <span className="text-sm font-bold text-white truncate max-w-[120px]">{bot.name}</span>
                    <span className="ml-auto text-xs text-[#F0B90B] font-mono whitespace-nowrap">ELO: {Math.round(bot.elo)}</span>
                    <span className={`text-xs font-mono whitespace-nowrap ${(bot.total_pnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {(bot.total_pnl || 0) >= 0 ? '+' : ''}{(bot.total_pnl || 0).toFixed(2)}%
                    </span>
                  </div>
                )) : (
                  <p className="text-gray-500 text-sm text-center py-4">Loading leaderboard...</p>
                )}
              </div>
            </div>

            {/* Recent Results */}
            <div>
              <h3 className="text-lg font-bold text-blue-400 mb-4">⚡ Recent Results</h3>
              <div className="space-y-2">
                {recent.length > 0 ? recent.map((b, i) => {
                  const winner = b.winner_id === b.bot1_id ? b.bot1_name : b.bot2_name;
                  return (
                    <div key={i} className="rounded-lg bg-gray-900/60 border border-gray-800 px-4 py-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-bold ${SYMBOL_COLORS[b.symbol] || 'text-gray-400'}`}>{b.symbol}</span>
                          <span className="text-xs text-gray-300">
                            <span className={winner === b.bot1_name ? 'text-green-400 font-bold' : ''}>{b.bot1_name}</span>
                            {' '}({formatPnl(b.bot1_pnl)})
                            <span className="text-gray-600 mx-1">vs</span>
                            <span className={winner === b.bot2_name ? 'text-green-400 font-bold' : ''}>{b.bot2_name}</span>
                            {' '}({formatPnl(b.bot2_pnl)})
                          </span>
                        </div>
                        <span className="text-[10px] text-gray-600">{b.resolved_at ? timeAgo(b.resolved_at) : ''}</span>
                      </div>
                    </div>
                  );
                }) : (
                  <p className="text-gray-500 text-sm text-center py-4">No recent battles yet</p>
                )}
              </div>
            </div>
          </div>

          <div className="text-center">
            <Link
              href="/watch"
              className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl bg-gradient-to-r from-green-500 to-emerald-500 text-black font-bold text-lg hover:shadow-[0_0_20px_rgba(16,185,129,0.3)] transition-all"
            >
              ⚔️ Watch Live Battles
            </Link>
          </div>
        </div>
      </motion.div>
    </section>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function HomePage() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const contractStats = useContractStats();

  useEffect(() => {
    fetch('/api/stats')
      .then(r => r.json())
      .then(setStats)
      .catch(() => {});
  }, []);

  return (
    <div className="relative min-h-screen text-white overflow-hidden w-full">
      <ArenaBackground />

      <div className="relative z-10 w-full flex flex-col items-center">
        {/* ═══ 1. HERO ═══ */}
        <section className="w-full max-w-6xl mx-auto px-6 pt-20 pb-16 text-center">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="flex flex-col items-center"
          >
            {/* Badges */}
            <div className="flex flex-wrap items-center justify-center gap-3 mb-8">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#F0B90B]/10 border border-[#F0B90B]/30">
                <span className="w-2 h-2 rounded-full bg-[#F0B90B] animate-pulse" />
                <span className="text-sm font-medium text-[#F0B90B]">BAP-578 NFAs Live on BNB Chain</span>
              </div>
              <a href="https://github.com/avnikulin35/gembots-arena" target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-green-500/10 border border-green-500/30 hover:bg-green-500/20 transition-all">
                <span className="text-sm">🔓</span>
                <span className="text-sm font-medium text-green-400">Open Source</span>
                <GitHubIcon className="w-4 h-4 text-green-400" />
              </a>
            </div>

            <h1 className="text-5xl sm:text-6xl md:text-7xl font-black mb-6 leading-tight">
              <span className="text-white">Create, Train &amp; Trade</span><br />
              <span className="bg-gradient-to-r from-[#F0B90B] to-yellow-300 bg-clip-text text-transparent">AI Agents</span>
            </h1>

            <p className="text-lg sm:text-xl text-gray-400 max-w-2xl mx-auto mb-4 leading-relaxed">
              Build trading strategies. Mint them as Non-Fungible Agents (NFAs) on BSC.
              <br className="hidden sm:block" />
              Battle in the Arena. Evolve. Climb the Leaderboard.
            </p>

            <p className="text-sm text-gray-500 mb-10">
              Fully Transparent • MIT License • Community-Driven
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
              <Link href="/mint"
                className="w-56 text-center px-8 py-3.5 rounded-xl bg-gradient-to-r from-[#F0B90B] to-yellow-500 text-black font-bold text-lg hover:shadow-[0_0_30px_rgba(240,185,11,0.4)] transition-all hover:scale-105">
                🔨 Mint NFA
              </Link>
              <Link href="/watch"
                className="w-56 text-center px-8 py-3.5 rounded-xl bg-gradient-to-r from-red-600 to-red-500 text-white font-bold text-lg hover:shadow-[0_0_30px_rgba(239,68,68,0.4)] transition-all hover:scale-105 relative overflow-hidden group">
                <span className="absolute top-2 right-3 flex items-center gap-1">
                  <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
                  <span className="text-[10px] font-bold uppercase tracking-wider opacity-80">Live</span>
                </span>
                👁 Watch Battles
              </Link>
              <a href="https://github.com/avnikulin35/gembots-arena" target="_blank" rel="noopener noreferrer"
                className="w-56 text-center px-8 py-3.5 rounded-xl border border-gray-700 text-gray-300 font-bold text-lg hover:bg-gray-800 hover:border-gray-500 transition-all hover:scale-105 inline-flex items-center justify-center gap-2">
                <GitHubIcon className="w-5 h-5" /> View Source
              </a>
            </div>
          </motion.div>

          {/* Stats bar */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-3xl mx-auto"
          >
            <div className="rounded-xl bg-gray-900/60 border border-gray-800 p-5 text-center">
              <div className="text-2xl sm:text-3xl font-black text-[#F0B90B]">
                <AnimatedCounter target={contractStats.totalSupply || stats?.totalBots || 0} />
              </div>
              <div className="text-xs text-gray-500 mt-1">On-Chain NFAs</div>
            </div>
            <div className="rounded-xl bg-gray-900/60 border border-gray-800 p-5 text-center">
              <div className="text-2xl sm:text-3xl font-black text-white">
                <AnimatedCounter target={stats?.totalBattles || 560000} />+
              </div>
              <div className="text-xs text-gray-500 mt-1">Battles Resolved</div>
            </div>
            <div className="rounded-xl bg-gray-900/60 border border-gray-800 p-5 text-center">
              <div className="text-2xl sm:text-3xl font-black text-green-400">
                <AnimatedCounter target={stats?.tradingLeagueBattles || 0} />
              </div>
              <div className="text-xs text-gray-500 mt-1">Trading Battles</div>
            </div>
            <div className="rounded-xl bg-gray-900/60 border border-gray-800 p-5 text-center">
              <div className="text-2xl sm:text-3xl font-black text-amber-400">
                <AnimatedCounter target={contractStats.genesisCount} />
                <span className="text-lg text-gray-500">/{100}</span>
              </div>
              <div className="text-xs text-gray-500 mt-1">Genesis Minted</div>
            </div>
          </motion.div>
        </section>

        {/* ═══ 2. LIVE TRADING LEAGUE ═══ */}
        <LiveTradingLeague />

        {/* ═══ 3. WHY OPEN SOURCE ═══ */}
        <section className="w-full max-w-6xl mx-auto px-6 py-20 text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <h2 className="text-3xl sm:text-4xl font-black mb-4">Why <span className="text-green-400">Open Source</span>?</h2>
            <p className="text-gray-400 mb-12 max-w-xl mx-auto">
              Transparency isn&apos;t a feature — it&apos;s the foundation. Every battle, every strategy, every line of code is verifiable.
            </p>
          </motion.div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 max-w-5xl mx-auto">
            {WHY_OPEN_SOURCE.map((item, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }}
                className="rounded-2xl border border-green-500/20 bg-gradient-to-br from-green-900/10 to-gray-900/40 p-6 hover:border-green-500/40 transition-all text-center">
                <div className="text-4xl mb-4">{item.icon}</div>
                <h3 className="text-lg font-bold text-white mb-2">{item.title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </section>

        {/* ═══ 4. HOW IT WORKS ═══ */}
        <section className="w-full max-w-6xl mx-auto px-6 py-20 text-center">
          <motion.h2 initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} className="text-3xl sm:text-4xl font-black mb-4">
            How It Works
          </motion.h2>
          <p className="text-gray-400 mb-12 max-w-xl mx-auto">From idea to on-chain AI agent in four steps.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 max-w-5xl mx-auto">
            {HOW_IT_WORKS.map((step, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }}
                className="rounded-2xl border border-gray-800 bg-gray-900/40 p-6 hover:border-[#F0B90B]/30 transition-all relative text-center">
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-[#F0B90B] text-black flex items-center justify-center text-sm font-black">{i + 1}</div>
                <div className="text-4xl mb-4 mt-2">{step.icon}</div>
                <h3 className="text-lg font-bold text-white mb-2">{step.title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">{step.desc}</p>
              </motion.div>
            ))}
          </div>
        </section>

        {/* ═══ 5. CONTRACT + CTA ═══ */}
        <section className="w-full max-w-6xl mx-auto px-6 py-20 text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
            className="rounded-2xl border border-[#F0B90B]/20 bg-gradient-to-br from-[#F0B90B]/5 to-transparent p-8 sm:p-12">
            <h2 className="text-3xl sm:text-4xl font-black mb-4">Verified on <span className="text-[#F0B90B]">BNB Chain</span></h2>
            <p className="text-gray-400 max-w-2xl mx-auto mb-8 leading-relaxed">
              GemBotsNFA is a BAP-578 smart contract (ERC-721 compatible) deployed and verified on BSC mainnet. Source code is fully open and auditable.
            </p>
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-900/80 border border-gray-700 mb-6">
              <span className="text-xs text-gray-500">Contract:</span>
              <code className="text-xs sm:text-sm font-mono text-[#F0B90B]">{NFA_CONTRACT}</code>
            </div>
            <div className="flex items-center justify-center gap-3 mb-10 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-500/10 border border-green-500/30 text-xs font-semibold text-green-400">
                ✅ Contract Verified
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/30 text-xs font-semibold text-blue-400">
                🛡 Open Source
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-500/10 border border-green-500/30 text-xs font-semibold text-green-400">
                MIT License
              </span>
            </div>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <a href={`https://bscscan.com/address/${NFA_CONTRACT}#code`} target="_blank" rel="noopener noreferrer"
                className="px-6 py-3 rounded-xl bg-gray-800 border border-gray-700 text-gray-300 font-medium hover:text-white hover:border-gray-500 transition-all">
                📄 View on BscScan
              </a>
              <Link href="/mint"
                className="px-10 py-4 rounded-xl bg-gradient-to-r from-[#F0B90B] to-yellow-500 text-black font-bold text-xl hover:shadow-[0_0_40px_rgba(240,185,11,0.5)] transition-all hover:scale-105">
                ⚡ Mint Your NFA
              </Link>
            </div>
          </motion.div>
        </section>

        {/* ═══ 6. WHY GEMBOTS — COMPETITOR COMPARISON ═══ */}
        <section className="py-20 px-6">
          <motion.div className="max-w-4xl mx-auto" initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }}>
            <h2 className="text-3xl sm:text-4xl font-bold text-center mb-4">Why <span className="text-[#F0B90B]">GemBots</span>?</h2>
            <p className="text-gray-400 text-center mb-10 max-w-xl mx-auto">The only AI arena with on-chain verified strategies, real crypto trading, and live spectating.</p>
            <div className="grid grid-cols-[1fr_64px_64px_72px_72px] sm:grid-cols-[1fr_90px_90px_100px_100px] gap-1 px-3 pb-3 text-[10px] sm:text-xs text-gray-500 text-center">
              <div className="text-left">Feature</div>
              <div>Chatbot Arena</div>
              <div>Alpha Arena</div>
              <div>LiveBench</div>
              <div className="text-[#F0B90B] font-bold text-xs sm:text-sm">GemBots</div>
            </div>
            <div className="space-y-2">
              {[
                ['Live AI Battles', '❌', '✅', '❌', '✅'],
                ['Real Crypto Trading', '❌', '✅', '❌', '✅'],
                ['On-Chain Verification', '❌', '❌', '❌', '✅'],
                ['Multiple AI Models', '✅', '❌', '✅', '✅'],
                ['ELO Rating System', '✅', '❌', '❌', '✅'],
                ['NFA Ownership (NFTs)', '❌', '❌', '❌', '✅'],
                ['Strategy Marketplace', '❌', '❌', '❌', '✅'],
                ['Spectator Mode', '❌', '❌', '❌', '✅'],
                ['Open Source', '❌', '❌', '✅', '✅'],
              ].map(([feature, ca, aa, lb, gb], i) => (
                <motion.div key={i}
                  className="grid grid-cols-[1fr_64px_64px_72px_72px] sm:grid-cols-[1fr_90px_90px_100px_100px] gap-1 items-center bg-gray-900/60 border border-gray-800/50 rounded-lg px-3 py-3"
                  initial={{ opacity: 0, x: -10 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.05 }}>
                  <div className="text-xs sm:text-sm text-gray-300 font-medium">{feature}</div>
                  <div className="text-center text-base sm:text-lg">{ca}</div>
                  <div className="text-center text-base sm:text-lg">{aa}</div>
                  <div className="text-center text-base sm:text-lg">{lb}</div>
                  <div className="text-center text-lg sm:text-xl bg-[#F0B90B]/10 rounded-lg py-1">{gb}</div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </section>
      </div>
    </div>
  );
}
