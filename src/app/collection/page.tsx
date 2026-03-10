'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';

function AuditBadge() {
  const [score, setScore] = useState<number | null>(null);
  useEffect(() => {
    fetch('/api/ai/audit')
      .then(r => r.json())
      .then(d => { if (d.score) setScore(d.score); })
      .catch(() => {});
  }, []);
  if (score === null) return null;
  return (
    <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-green-900/20 border border-green-700/50">
      <span className="text-lg">🛡️</span>
      <span className="text-green-400 font-semibold">Audited by AI</span>
      <span className="text-white font-bold">{score}%</span>
    </div>
  );
}
import Link from 'next/link';
import Image from 'next/image';
import { getRobotImage, getArenaId } from '@/lib/robot-images';
import {
  TIER_NAMES,
  TIER_COLORS,
  TIER_GRADIENTS,
  TIER_GLOW,
  GENESIS_MAX,
  AgentStatus,
} from '@/lib/nfa';

// ─── Types ──────────────────────────────────────────────────────────────────

interface NFAFromAPI {
  nfaId: number;
  tier: number;
  isGenesis: boolean;
  owner: string;
  stats: { wins: number; losses: number; totalBattles: number; currentStreak: number; bestStreak: number };
  strategy: { modelId: string; strategyHash: string; strategyURI: string };
  state: { balance: string; status: number; owner: string };
  metadata: { persona: string; experience: string } | null;
  listing: { price: string; seller: string; active: boolean } | null;
}

interface ArenaBot {
  id: number;
  nfa_id?: number | null;
  name: string;
  wins: number;
  losses: number;
  draws?: number;
  total_battles: number;
  total_pnl?: number;
  best_trade?: number;
  worst_trade?: number;
  elo: number;
  league: string;
  special: string | null;
  hp: number;
  strategy: string;
  ai_model: string;
  trading_style: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const LEAGUE_COLORS: Record<string, string> = {
  diamond: 'text-cyan-400',
  gold: 'text-yellow-400',
  silver: 'text-gray-300',
  bronze: 'text-orange-400',
};

const LEAGUE_EMOJI: Record<string, string> = {
  diamond: '💎',
  gold: '🥇',
  silver: '🥈',
  bronze: '🥉',
};

type SortOption = 'id' | 'elo' | 'wins' | 'winrate';

// ─── Page ───────────────────────────────────────────────────────────────────

export default function CollectionPage() {
  const [nfas, setNfas] = useState<NFAFromAPI[]>([]);
  const [totalSupply, setTotalSupply] = useState(0);
  const [genesisCount, setGenesisCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [arenaStats, setArenaStats] = useState<Record<number, ArenaBot>>({});
  const [sortBy, setSortBy] = useState<SortOption>('elo');
  const [filterLeague, setFilterLeague] = useState<string>('all');

  // Fetch NFAs from server API (cached, fast)
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nfaRes = await fetch('/api/nfas');
      const nfaData = await nfaRes.json();
      setNfas(nfaData.nfas || []);
      setTotalSupply(nfaData.totalSupply || 0);
      setGenesisCount(nfaData.genesisCount || 0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
    // Arena stats separately — don't block main load
    try {
      const arenaRes = await fetch('/api/arena-stats');
      const arenaData = await arenaRes.json();
      if (arenaData.bots) {
        const map: Record<number, ArenaBot> = {};
        arenaData.bots.forEach((b: ArenaBot) => {
          const key = b.nfa_id ?? b.id;
          map[key] = b;
        });
        setArenaStats(map);
      }
    } catch { /* arena stats optional */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const enrichedNfas = useMemo(() => {
    return nfas.map(nfa => {
      const arenaId = getArenaId(nfa.nfaId);
      const arena = arenaId ? arenaStats[arenaId] : null;
      return { nfa, arena, arenaId };
    });
  }, [nfas, arenaStats]);

  const filtered = useMemo(() => {
    let result = [...enrichedNfas];
    if (filterLeague !== 'all') {
      result = result.filter(e => e.arena?.league === filterLeague);
    }
    switch (sortBy) {
      case 'elo': result.sort((a, b) => (b.arena?.elo ?? 0) - (a.arena?.elo ?? 0)); break;
      case 'wins': result.sort((a, b) => (b.arena?.wins ?? 0) - (a.arena?.wins ?? 0)); break;
      case 'winrate': result.sort((a, b) => {
        const wrA = a.arena && a.arena.total_battles > 0 ? a.arena.wins / a.arena.total_battles : 0;
        const wrB = b.arena && b.arena.total_battles > 0 ? b.arena.wins / b.arena.total_battles : 0;
        return wrB - wrA;
      }); break;
      default: result.sort((a, b) => a.nfa.nfaId - b.nfa.nfaId);
    }
    return result;
  }, [enrichedNfas, sortBy, filterLeague]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <div className="text-center">
          <div className="animate-spin h-12 w-12 border-4 border-[#F0B90B] border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-400 text-lg">Loading NFAs from blockchain...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-gray-800">
        <div className="absolute inset-0 bg-gradient-to-b from-[#F0B90B]/5 via-transparent to-transparent" />
        <div className="relative max-w-7xl mx-auto px-6 py-16 md:py-20 text-center">
          <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            className="text-4xl md:text-6xl font-bold mb-4">
            <span className="bg-gradient-to-r from-[#F0B90B] via-yellow-400 to-amber-500 bg-clip-text text-transparent">
              NFA Collection
            </span>
          </motion.h1>
          <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="text-gray-400 text-lg md:text-xl mb-2">
            On-chain AI agents battling in the Arena
          </motion.p>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
            className="flex flex-wrap items-center justify-center gap-6 mt-6 text-sm">
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-800/60 border border-gray-700">
              <span className="text-2xl font-bold text-[#F0B90B]">{totalSupply}</span>
              <span className="text-gray-400">Total NFAs</span>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-800/60 border border-gray-700">
              <span className="text-2xl font-bold text-amber-400">{genesisCount}</span>
              <span className="text-gray-400">/ {GENESIS_MAX} Genesis</span>
            </div>
            <AuditBadge />
          </motion.div>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}
            className="flex flex-wrap items-center justify-center gap-4 mt-6">
            <Link href="/mint"
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-[#F0B90B] to-amber-600 text-black font-semibold hover:shadow-[0_0_20px_rgba(240,185,11,0.3)] transition-all text-sm">
              ⚡ Mint NFA
            </Link>
            <Link href="/marketplace"
              className="px-4 py-2 rounded-lg bg-gray-800/60 border border-gray-700 hover:border-[#F0B90B]/50 text-gray-300 hover:text-[#F0B90B] transition-all text-sm">
              🏪 Marketplace
            </Link>
            <button onClick={refresh}
              className="px-4 py-2 rounded-lg bg-gray-800/60 border border-gray-700 hover:border-gray-500 text-gray-400 hover:text-white transition-all text-sm">
              🔄 Refresh
            </button>
          </motion.div>
        </div>
      </section>

      {/* Filters */}
      <section className="max-w-7xl mx-auto px-6 py-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-gray-500 text-sm">Sort:</span>
            {([
              { key: 'elo', label: '🏆 ELO' },
              { key: 'wins', label: '⚔️ Wins' },
              { key: 'winrate', label: '📊 Win Rate' },
              { key: 'id', label: '#ID' },
            ] as { key: SortOption; label: string }[]).map(opt => (
              <button key={opt.key} onClick={() => setSortBy(opt.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  sortBy === opt.key
                    ? 'bg-[#F0B90B]/20 text-[#F0B90B] border border-[#F0B90B]/40'
                    : 'bg-gray-800/50 text-gray-400 border border-gray-700 hover:border-gray-600'
                }`}>
                {opt.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <select value={filterLeague}
              onChange={e => setFilterLeague(e.target.value)}
              className="px-3 py-1.5 rounded-lg text-xs bg-gray-800/50 text-gray-300 border border-gray-700 outline-none">
              <option value="all">All Leagues</option>
              <option value="diamond">💎 Diamond</option>
              <option value="gold">🥇 Gold</option>
              <option value="silver">🥈 Silver</option>
              <option value="bronze">🥉 Bronze</option>
            </select>
          </div>
        </div>
        <div className="mt-3 text-sm text-gray-500">
          Showing {filtered.length} of {totalSupply} NFAs
        </div>
      </section>

      {/* NFA Grid */}
      <section className="max-w-7xl mx-auto px-6 pb-16">
        {error && (
          <div className="mb-6 p-4 rounded-lg bg-red-900/20 border border-red-500/30 text-red-400 text-sm">
            ⚠️ Error: {error}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {filtered.map((item, i) => (
            <NFACard key={item.nfa.nfaId} nfa={item.nfa} arena={item.arena} index={i} />
          ))}
        </div>

        {filtered.length === 0 && !error && (
          <div className="text-center py-20 text-gray-500">
            <p className="text-5xl mb-4">🤖</p>
            <p className="text-xl font-semibold text-gray-400 mb-2">No NFAs found</p>
            <Link href="/mint"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-[#F0B90B] to-amber-600 text-black font-bold transition-all mt-4">
              ⚡ Mint Your NFA
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}

// ─── NFA Card with Robot Image + Arena Stats ────────────────────────────────

function NFACard({ nfa, arena, index }: { nfa: NFAFromAPI; arena: ArenaBot | null; index: number }) {
  const tierGradient = TIER_GRADIENTS[nfa.tier] || 'from-orange-500/20 via-orange-600/10 to-amber-500/20';
  const tierGlow = TIER_GLOW[nfa.tier] || 'hover:shadow-[0_0_25px_rgba(245,158,11,0.2)]';
  const isActive = nfa.state?.status === AgentStatus.Active;
  const isPaused = nfa.state?.status === AgentStatus.Paused;

  // Name from arena or persona
  let displayName = arena?.name || `NFA #${nfa.nfaId}`;
  if (!arena) {
    try {
      if (nfa.metadata?.persona) {
        const p = JSON.parse(nfa.metadata.persona);
        if (p.name) displayName = p.name;
      }
    } catch { /* ignore */ }
  }

  // Arena stats
  const wins = arena?.wins ?? 0;
  const losses = arena?.losses ?? 0;
  const totalBattles = arena?.total_battles ?? 0;
  const winRate = totalBattles > 0 ? ((wins / totalBattles) * 100).toFixed(1) : '—';
  const elo = arena?.elo ?? 0;
  const league = arena?.league || 'bronze';
  const leagueColor = LEAGUE_COLORS[league] || 'text-gray-400';
  const leagueEmoji = LEAGUE_EMOJI[league] || '🥉';

  const robotImage = getRobotImage(nfa.nfaId);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.03, 0.8) }}
      className="group"
    >
      <Link href={`/bot/${nfa.nfaId}`}>
        <div className={`relative rounded-xl border border-gray-700/50 bg-gradient-to-br ${tierGradient} backdrop-blur-sm hover:scale-[1.02] ${tierGlow} transition-all duration-300 overflow-hidden cursor-pointer`}>
          
          {/* Robot Image */}
          <div className="relative aspect-square bg-gray-900/40 p-3">
            <Image
              src={robotImage}
              alt={displayName}
              fill
              className="object-contain p-4 group-hover:scale-105 transition-transform duration-300"
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
            />
            {/* Badges */}
            <div className="absolute top-3 left-3 flex items-center gap-1.5">
              {nfa.isGenesis && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/40">
                  🌟 GENESIS
                </span>
              )}
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                isActive ? 'bg-green-500/20 text-green-400 border border-green-500/40' :
                isPaused ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/40' :
                'bg-red-500/20 text-red-400 border border-red-500/40'
              }`}>
                {isActive ? '●' : isPaused ? '⏸' : '☠'}
              </span>
            </div>
            {/* NFA ID + League */}
            <div className="absolute top-3 right-3 flex flex-col items-end gap-1">
              <span className="px-2 py-0.5 rounded-full bg-gray-900/80 border border-gray-700 text-[10px] font-mono text-gray-400">
                #{nfa.nfaId}
              </span>
              {arena && (
                <span className={`px-2 py-0.5 rounded-full bg-gray-900/80 border border-gray-700 text-[10px] font-bold ${leagueColor}`}>
                  {leagueEmoji} {league}
                </span>
              )}
            </div>
            {/* ELO overlay */}
            {elo > 0 && (
              <div className="absolute bottom-3 right-3 px-2.5 py-1 rounded-lg bg-gray-900/90 border border-gray-700">
                <span className="text-xs font-bold text-[#F0B90B]">{elo.toLocaleString()}</span>
                <span className="text-[10px] text-gray-500 ml-1">ELO</span>
              </div>
            )}
          </div>

          {/* Info */}
          <div className="p-4">
            {/* Name + Model */}
            <h3 className="font-bold text-white text-sm truncate group-hover:text-[#F0B90B] transition-colors mb-1">
              {displayName}
            </h3>
            <div className="text-[10px] text-gray-500 mb-3">
              {arena?.ai_model || (nfa.strategy?.modelId !== 'gembots-arena-ai' ? nfa.strategy?.modelId : null) || '—'}
              {arena?.trading_style && <span className="ml-2">• {arena.trading_style}</span>}
            </div>

            {/* Battle Stats */}
            {totalBattles > 0 ? (
              <div className="grid grid-cols-3 gap-2 text-center bg-gray-900/40 rounded-lg p-2.5 border border-gray-800/50">
                <div>
                  <div className="text-green-400 font-bold text-sm">{wins.toLocaleString()}</div>
                  <div className="text-gray-500 text-[9px] uppercase">Wins</div>
                </div>
                <div>
                  <div className="text-red-400 font-bold text-sm">{losses.toLocaleString()}</div>
                  <div className="text-gray-500 text-[9px] uppercase">Losses</div>
                </div>
                <div>
                  <div className={`font-bold text-sm ${
                    parseFloat(winRate) >= 60 ? 'text-green-400' :
                    parseFloat(winRate) >= 45 ? 'text-yellow-400' : 'text-red-400'
                  }`}>{winRate}%</div>
                  <div className="text-gray-500 text-[9px] uppercase">WR</div>
                </div>
              </div>
            ) : (
              <div className="text-center py-2 text-gray-600 text-xs italic bg-gray-900/40 rounded-lg border border-gray-800/50">
                Awaiting first battle
              </div>
            )}
          </div>

          {/* Bottom accent */}
          <div className={`h-0.5 w-full bg-gradient-to-r from-transparent via-[#F0B90B]/30 to-transparent`} />
        </div>
      </Link>
    </motion.div>
  );
}
