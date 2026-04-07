'use client';

import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { BarChart3, Filter, Flame, Layers3, RefreshCcw, ShieldCheck, Trophy } from 'lucide-react';
import { getRobotImage } from '@/lib/robot-images';
import { TIER_COLORS, TIER_GRADIENTS, TIER_GLOW, TIER_NAMES } from '@/lib/nfa';

interface CollectionNFA {
  id: number;
  name: string;
  nfaId: number;
  strategy: string;
  tradingStyle: string;
  aiModel: string;
  evmAddress: string;
  wins: number;
  losses: number;
  totalBattles: number;
  winRate: number;
  elo: number;
  league: string;
  special: string | null;
  isGenesis?: boolean;
  totalPnlUsd: number | null;
  totalTrades: number;
  tradingWinRate: number | null;
  currentBalanceUsd: number | null;
  tournamentPnlUsd: number | null;
  tournamentRank: number | null;
  tournamentName: string | null;
}

type SortOption = 'elo' | 'battles' | 'winRate' | 'pnl' | 'id';
type TierFilter = 'all' | 'Bronze' | 'Silver' | 'Gold' | 'Diamond' | 'Legendary';

const TIER_ORDER: TierFilter[] = ['Bronze', 'Silver', 'Gold', 'Diamond', 'Legendary'];
const TIER_INDEX: Record<string, number> = {
  Bronze: 0,
  Silver: 1,
  Gold: 2,
  Diamond: 3,
  Legendary: 4,
};

const TIER_BADGE: Record<string, string> = {
  Bronze: '🥉',
  Silver: '🥈',
  Gold: '🥇',
  Diamond: '💎',
  Legendary: '🏆',
};

function inferTierLabel(nfa: CollectionNFA): TierFilter {
  const special = (nfa.special || '').toLowerCase();
  if (special.includes('genesis') || special.includes('founder')) return 'Legendary';
  if (typeof nfa.elo === 'number' && nfa.elo >= 1800) return 'Legendary';
  if (typeof nfa.elo === 'number' && nfa.elo >= 1550) return 'Diamond';

  const normalizedLeague = (nfa.league || '').toLowerCase();
  if (normalizedLeague === 'legendary') return 'Legendary';
  if (normalizedLeague === 'diamond') return 'Diamond';
  if (normalizedLeague === 'gold') return 'Gold';
  if (normalizedLeague === 'silver') return 'Silver';
  return 'Bronze';
}

function formatSignedUsd(value: number | null) {
  if (value === null || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}$${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function formatUsd(value: number | null) {
  if (value === null || Number.isNaN(value)) return '—';
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function getWinRateTone(winRate: number) {
  if (winRate >= 60) return 'text-emerald-400';
  if (winRate >= 50) return 'text-amber-300';
  return 'text-rose-400';
}

export default function CollectionPage() {
  const [nfas, setNfas] = useState<CollectionNFA[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>('elo');
  const [tierFilter, setTierFilter] = useState<TierFilter | 'all'>('all');
  const [modelFilter, setModelFilter] = useState<string>('all');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/collection');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load collection');
      setNfas(data.nfas || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const modelOptions = useMemo(() => {
    return [...new Set(nfas.map((nfa) => nfa.aiModel).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }, [nfas]);

  const totals = useMemo(() => {
    const totalBattles = nfas.reduce((sum, nfa) => sum + (nfa.totalBattles || 0), 0);
    const avgWinRate = nfas.length
      ? nfas.reduce((sum, nfa) => sum + (nfa.winRate || 0), 0) / nfas.length
      : 0;
    const activeModels = new Set(nfas.map((nfa) => nfa.aiModel)).size;
    const positivePnl = nfas.filter((nfa) => (nfa.totalPnlUsd ?? 0) > 0).length;
    return { totalBattles, avgWinRate, activeModels, positivePnl };
  }, [nfas]);

  const filtered = useMemo(() => {
    let result = [...nfas].map((nfa) => ({ ...nfa, tierLabel: inferTierLabel(nfa) }));

    if (tierFilter !== 'all') {
      result = result.filter((nfa) => nfa.tierLabel === tierFilter);
    }
    if (modelFilter !== 'all') {
      result = result.filter((nfa) => nfa.aiModel === modelFilter);
    }

    switch (sortBy) {
      case 'battles':
        result.sort((a, b) => (b.totalBattles || 0) - (a.totalBattles || 0));
        break;
      case 'winRate':
        result.sort((a, b) => (b.winRate || 0) - (a.winRate || 0));
        break;
      case 'pnl':
        result.sort((a, b) => (b.totalPnlUsd ?? Number.NEGATIVE_INFINITY) - (a.totalPnlUsd ?? Number.NEGATIVE_INFINITY));
        break;
      case 'id':
        result.sort((a, b) => a.nfaId - b.nfaId);
        break;
      case 'elo':
      default:
        result.sort((a, b) => (b.elo || 0) - (a.elo || 0));
        break;
    }

    return result;
  }, [nfas, sortBy, tierFilter, modelFilter]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#07070b]">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-[#F0B90B] border-t-transparent" />
          <p className="text-lg text-gray-400">Loading Agentomics collection…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#07070b] text-white">
      <section className="relative overflow-hidden border-b border-white/8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(240,185,11,0.12),transparent_35%),linear-gradient(to_bottom,#090b14,#07070b)]" />
        <div className="relative mx-auto max-w-7xl px-6 py-16 md:py-20">
          <div className="max-w-4xl">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#F0B90B]/25 bg-[#F0B90B]/10 px-4 py-1.5 text-sm text-[#F0B90B]">
              <ShieldCheck className="h-4 w-4" /> Agentomics Collection
            </div>
            <h1 className="text-4xl font-black tracking-tight sm:text-6xl">
              <span className="bg-gradient-to-r from-[#F0B90B] via-yellow-300 to-white bg-clip-text text-transparent">
                Track Record is the New Floor Price
              </span>
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-gray-300">
              Every NFA is now presented like an on-chain performance asset: visible tier, provable battle history, ELO, and trading track record in one collection view.
            </p>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Total NFAs" value={nfas.length.toLocaleString()} hint="on this collection view" icon={<Layers3 className="h-5 w-5" />} />
            <StatCard label="Total Battles" value={totals.totalBattles.toLocaleString()} hint="combined track record" icon={<Trophy className="h-5 w-5" />} />
            <StatCard label="Avg Win Rate" value={`${totals.avgWinRate.toFixed(1)}%`} hint="across visible NFAs" icon={<BarChart3 className="h-5 w-5" />} />
            <StatCard label="Models Active" value={totals.activeModels.toString()} hint={`${totals.positivePnl} with positive PnL`} icon={<Flame className="h-5 w-5" />} />
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              href="/mint"
              className="rounded-xl bg-gradient-to-r from-[#F0B90B] to-amber-500 px-5 py-3 font-semibold text-black transition-all hover:shadow-[0_0_30px_rgba(240,185,11,0.30)]"
            >
              Mint Your AI Agent
            </Link>
            <Link
              href="/agentomics"
              className="rounded-xl border border-white/10 bg-white/5 px-5 py-3 font-semibold text-white transition-all hover:border-[#F0B90B]/35 hover:bg-white/10"
            >
              Read Agentomics
            </Link>
            <button
              onClick={refresh}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-5 py-3 font-semibold text-gray-200 transition-all hover:border-white/20 hover:bg-white/10"
            >
              <RefreshCcw className="h-4 w-4" /> Refresh
            </button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-8">
        <div className="flex flex-col gap-4 rounded-3xl border border-white/8 bg-white/[0.03] p-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#F0B90B]">
              <Filter className="h-4 w-4" /> Filters & sorting
            </div>
            <p className="text-sm text-gray-400">Filter by earned tier and AI model, then sort by the metrics that matter for Agentomics.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <select
              value={tierFilter}
              onChange={(e) => setTierFilter(e.target.value as TierFilter | 'all')}
              className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-gray-200 outline-none"
            >
              <option value="all">All tiers</option>
              {TIER_ORDER.map((tier) => (
                <option key={tier} value={tier}>{tier}</option>
              ))}
            </select>

            <select
              value={modelFilter}
              onChange={(e) => setModelFilter(e.target.value)}
              className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-gray-200 outline-none"
            >
              <option value="all">All models</option>
              {modelOptions.map((model) => (
                <option key={model} value={model}>{model}</option>
              ))}
            </select>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-gray-200 outline-none"
            >
              <option value="elo">Sort by ELO</option>
              <option value="battles">Sort by battles</option>
              <option value="winRate">Sort by WR</option>
              <option value="pnl">Sort by PnL</option>
              <option value="id">Sort by ID</option>
            </select>
          </div>
        </div>

        <div className="mt-4 text-sm text-gray-500">
          Showing {filtered.length} of {nfas.length} NFAs
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-16">
        {error && (
          <div className="mb-6 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
            ⚠️ {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((nfa, index) => (
            <NFACard key={nfa.nfaId} nfa={nfa} index={index} />
          ))}
        </div>

        {!error && filtered.length === 0 && (
          <div className="rounded-3xl border border-white/8 bg-white/[0.03] px-6 py-16 text-center text-gray-400">
            <div className="text-5xl">🤖</div>
            <h3 className="mt-4 text-2xl font-bold text-white">No NFAs match these filters</h3>
            <p className="mt-2">Try a different tier/model combination or refresh the collection.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({ label, value, hint, icon }: { label: string; value: string; hint: string; icon: ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-5">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-2xl bg-[#F0B90B]/10 text-[#F0B90B]">{icon}</div>
      <div className="text-xs uppercase tracking-[0.16em] text-gray-500">{label}</div>
      <div className="mt-2 text-3xl font-black text-white">{value}</div>
      <div className="mt-1 text-sm text-gray-400">{hint}</div>
    </div>
  );
}

function NFACard({ nfa, index }: { nfa: CollectionNFA; index: number }) {
  const tierLabel = inferTierLabel(nfa);
  const tierIndex = TIER_INDEX[tierLabel] ?? 0;
  const tierGradient = TIER_GRADIENTS[tierIndex] || 'from-[#CD7F32]/20 to-[#8B5E3C]/20 border-[#CD7F32]/40';
  const tierGlow = TIER_GLOW[tierIndex] || 'shadow-[0_0_20px_rgba(240,185,11,0.15)]';
  const tierColor = TIER_COLORS[tierIndex] || '#F0B90B';
  const robotImage = getRobotImage(nfa.nfaId);
  const losses = nfa.losses || Math.max((nfa.totalBattles || 0) - (nfa.wins || 0), 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.03, 0.6) }}
    >
      <Link href={`/bot/${nfa.nfaId}`}>
        <div className={`group overflow-hidden rounded-3xl border border-white/8 bg-gradient-to-br ${tierGradient} ${tierGlow} transition-all duration-300 hover:-translate-y-1`}>
          <div className="relative aspect-[1.08] bg-black/25 p-4">
            <Image
              src={robotImage}
              alt={nfa.name}
              fill
              className="object-contain p-6 transition-transform duration-300 group-hover:scale-105"
              sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
            />

            <div className="absolute left-4 top-4 flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-white/10 bg-black/60 px-2.5 py-1 text-[10px] font-bold text-white">
                #{nfa.nfaId}
              </span>
              {(nfa.isGenesis || nfa.special) && (
                <span className="rounded-full border border-amber-400/35 bg-amber-400/10 px-2.5 py-1 text-[10px] font-bold text-amber-200">
                  🌟 {nfa.special || 'Genesis'}
                </span>
              )}
            </div>

            <div className="absolute right-4 top-4">
              <span className="rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em]" style={{ borderColor: `${tierColor}66`, color: tierColor, background: 'rgba(0,0,0,0.55)' }}>
                {TIER_BADGE[tierLabel]} {tierLabel}
              </span>
            </div>

            <div className="absolute bottom-4 right-4 rounded-xl border border-white/10 bg-black/70 px-3 py-2 text-right">
              <div className="text-xl font-black text-[#F0B90B]">{nfa.elo.toLocaleString()}</div>
              <div className="text-[10px] uppercase tracking-[0.14em] text-gray-500">ELO</div>
            </div>
          </div>

          <div className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-black text-white transition-colors group-hover:text-[#F0B90B]">{nfa.name}</h3>
                <p className="mt-1 text-sm text-gray-400">{nfa.aiModel} · {nfa.tradingStyle || nfa.strategy || 'unknown strategy'}</p>
              </div>
              <div className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-xs font-semibold text-gray-300">
                {nfa.league || 'bronze'}
              </div>
            </div>

            <div className="mt-5 grid grid-cols-4 gap-2 rounded-2xl border border-white/8 bg-black/20 p-3 text-center">
              <MiniStat label="WR" value={`${nfa.winRate || 0}%`} valueClass={getWinRateTone(nfa.winRate || 0)} />
              <MiniStat label="PnL" value={formatSignedUsd(nfa.totalPnlUsd)} valueClass={(nfa.totalPnlUsd ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'} />
              <MiniStat label="Battles" value={(nfa.totalBattles || 0).toLocaleString()} />
              <MiniStat label="Trades" value={(nfa.totalTrades || 0).toLocaleString()} />
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <TrackMetric label="Wins / Losses" value={`${(nfa.wins || 0).toLocaleString()} / ${losses.toLocaleString()}`} />
              <TrackMetric label="Current Balance" value={formatUsd(nfa.currentBalanceUsd)} />
              <TrackMetric label="Tournament Rank" value={nfa.tournamentRank ? `#${nfa.tournamentRank}` : '—'} />
              <TrackMetric label="Tournament PnL" value={formatSignedUsd(nfa.tournamentPnlUsd)} />
            </div>

            {nfa.tournamentName && (
              <div className="mt-4 rounded-2xl border border-[#F0B90B]/15 bg-[#F0B90B]/8 px-4 py-3 text-sm text-[#F7D775]">
                Active tournament: <span className="font-semibold text-white">{nfa.tournamentName}</span>
              </div>
            )}

            <div className="mt-5 h-px w-full bg-gradient-to-r from-transparent via-[#F0B90B]/30 to-transparent" />
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-gray-500">Track record first</span>
              <span className="font-semibold text-[#F0B90B]">View NFA →</span>
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

function MiniStat({ label, value, valueClass = 'text-white' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div>
      <div className={`text-sm font-black ${valueClass}`}>{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-gray-500">{label}</div>
    </div>
  );
}

function TrackMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-[0.14em] text-gray-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-white">{value}</div>
    </div>
  );
}
