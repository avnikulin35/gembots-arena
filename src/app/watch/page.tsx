
'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import LiveFightView from '@/components/tournament/LiveFightView';
import { VSBadge } from '@/components/tournament/VSBadge';
import TokenPriceChart from '@/components/tournament/TokenPriceChart';
import TradeTicker from '@/components/tournament/TradeTicker';
import { ArenaBackground } from '@/components/tournament/ArenaEffects';
import { TickerTrade } from '@/components/tournament/TradeTicker'; // Import TickerTrade type
// Removed import for BotSprites as it's not a default export and its `RobotSprite` component is too complex for simple miniatures.

// ─── TYPES ────────────────────────────────────────────────────────────────────

type TradeAction = 'BUY' | 'SELL' | 'HOLD';

interface BotAction {
  action: string;
  leverage: number;
}

interface Battle {
  id: string;
  bot1_id: number;
  bot2_id: number;
  symbol: string;
  entry_price: number;
  started_at: string;
  timeframe_minutes: number;
  bot1_action: TradeAction;
  bot1_leverage: number;
  bot1_pnl: number | null;
  bot2_action: TradeAction;
  bot2_leverage: number;
  bot2_pnl: number | null;
  bot1_name: string;
  bot2_name: string;
  bot1_model?: string;
  bot2_model?: string;
  bot1_reasoning: string;
  bot2_reasoning: string;
  market_data: string;
  status: 'pending' | 'resolved'; // Assuming 'active' is covered by 'pending' for display
  exit_price?: number;
  winner_id?: number;
  resolved_at?: string;
}

function formatModelName(modelId: string): string {
  // 'qwen/qwen3-235b-a22b-2507' → 'Qwen3 235B'
  const name = modelId.split('/').pop() || modelId;
  return name
    .replace(/-\d{4}$/, '')
    .replace(/-it$/, '')
    .replace(/-instruct$/, '')
    .replace(/(\d+)b/gi, (_, n) => `${n}B`)
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface LeaderboardEntry {
  name: string;
  elo: number;
  total_pnl: number;
  wins: number;
  losses: number;
}

interface TradingLeagueData {
  activeBattles: Battle[];
  recentBattles: Battle[];
  leaderboard: LeaderboardEntry[];
  stats: { totalBattles: number };
}

interface FightBotState {
  id: number;
  name: string;
  model?: string;
  ai_model?: string;
  hp: number;
  maxHp: number;
  color: string;
  glowColor: string;
  pnl: number | undefined;
  lastTrade: {
    action: TradeAction;
    side: TradeAction;
  };
}

interface FightState {
  bot1: FightBotState;
  bot2: FightBotState;
  status: 'fighting' | 'finished' | 'waiting';
  timeLeft: number;
  winnerName: string | undefined;
  tokenSymbol: string;
  symbol: string;
  entryPrice: number;
  bot1Action: string;
  bot2Action: string;
  bot1Reasoning: string;
  bot2Reasoning: string;
  market_data: string;
}

const BATTLE_DURATION_SECONDS = 15 * 60;

const SYMBOL_BADGE_CLASSES: Record<string, string> = {
  BTCUSDT: 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
  ETHUSDT: 'bg-blue-500/15 text-blue-300 border border-blue-500/30',
  SOLUSDT: 'bg-purple-500/15 text-purple-300 border border-purple-500/30',
};

const ACTION_CLASSES: Record<TradeAction, string> = {
  BUY: 'bg-green-500/15 text-green-400 border border-green-500/30',
  SELL: 'bg-red-500/15 text-red-400 border border-red-500/30',
  HOLD: 'bg-gray-700/60 text-gray-300 border border-gray-600/70',
};

const parseBattleDate = (dateString: string) => {
  if (!dateString) return new Date(NaN);
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(dateString);
  return new Date(hasTimezone ? dateString : `${dateString}Z`);
};

const getBattleRemainingSeconds = (battle: Battle, nowMs: number) => {
  const startedAt = parseBattleDate(battle.started_at);
  if (Number.isNaN(startedAt.getTime())) return 0;
  const endTimeMs = startedAt.getTime() + BATTLE_DURATION_SECONDS * 1000;
  return Math.max(0, Math.floor((endTimeMs - nowMs) / 1000));
};

const formatCountdown = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
};

const calculateHp = (pnl: number | undefined): number => {
  if (pnl === undefined) return 100;
  const hp = 100 - Math.abs(pnl) * 20;
  return Math.max(10, Math.min(100, hp));
};

const mapBattleToFightState = (battle: Battle, currentTime: Date): FightState => {
  const isResolved = battle.status === 'resolved';
  const bot1Pnl = isResolved && battle.bot1_pnl !== null ? battle.bot1_pnl : undefined;
  const bot2Pnl = isResolved && battle.bot2_pnl !== null ? battle.bot2_pnl : undefined;

  let timeLeft = 0;
  if (battle.status !== 'resolved' && battle.started_at) {
    timeLeft = getBattleRemainingSeconds(battle, currentTime.getTime());
  }

  const winnerName = isResolved && battle.winner_id
    ? (battle.winner_id === battle.bot1_id ? battle.bot1_name : battle.bot2_name)
    : undefined;

  return {
    bot1: {
      id: battle.bot1_id,
      name: battle.bot1_name,
      model: battle.bot1_model || undefined,
      ai_model: battle.bot1_model ? formatModelName(battle.bot1_model) : undefined,
      hp: calculateHp(bot1Pnl),
      maxHp: 100,
      color: '#22c55e',
      glowColor: 'rgba(34,197,94,0.6)',
      pnl: bot1Pnl,
      lastTrade: { action: battle.bot1_action, side: battle.bot1_action },
    },
    bot2: {
      id: battle.bot2_id,
      name: battle.bot2_name,
      model: battle.bot2_model || undefined,
      ai_model: battle.bot2_model ? formatModelName(battle.bot2_model) : undefined,
      hp: calculateHp(bot2Pnl),
      maxHp: 100,
      color: '#f59e0b',
      glowColor: 'rgba(245,158,11,0.6)',
      pnl: bot2Pnl,
      lastTrade: { action: battle.bot2_action, side: battle.bot2_action },
    },
    status: battle.status === 'pending' ? 'fighting' : 'finished',
    timeLeft,
    winnerName,
    tokenSymbol: battle.symbol.replace('USDT', ''),
    symbol: battle.symbol,
    entryPrice: battle.entry_price,
    bot1Action: `${battle.bot1_action} ${battle.bot1_leverage}x`,
    bot2Action: `${battle.bot2_action} ${battle.bot2_leverage}x`,
    bot1Reasoning: battle.bot1_reasoning,
    bot2Reasoning: battle.bot2_reasoning,
    market_data: battle.market_data,
  };
};

const formatPnl = (pnl: number | null | undefined) => {
  if (pnl == null) return <span className="text-gray-500">-</span>;
  const sign = pnl >= 0 ? '+' : '';
  const colorClass = pnl >= 0 ? 'text-green-400' : 'text-red-400';
  return <span className={colorClass}>{sign}{pnl.toFixed(2)}%</span>;
};

const timeAgo = (dateString: string) => {
  const date = parseBattleDate(dateString);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  let interval = seconds / 31536000;
  if (interval > 1) return Math.floor(interval) + ' years ago';
  interval = seconds / 2592000;
  if (interval > 1) return Math.floor(interval) + ' months ago';
  interval = seconds / 86400;
  if (interval > 1) return Math.floor(interval) + ' days ago';
  interval = seconds / 3600;
  if (interval > 1) return Math.floor(interval) + ' hours ago';
  interval = seconds / 60;
  if (interval > 1) return Math.floor(interval) + ' minutes ago';
  return Math.max(0, Math.floor(seconds)) + ' seconds ago';
};

// Live price cell — polls /api/token-price every 10s and shows current price + % vs entry
function LivePriceCell({ symbol, entryPrice }: { symbol: string; entryPrice: number }) {
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);

  useEffect(() => {
    const cleanSymbol = symbol.replace(/USDT$/i, '');

    const fetchPrice = async () => {
      try {
        const res = await fetch(`/api/token-price?token=${cleanSymbol}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.price) setCurrentPrice(data.price);
      } catch {
        // Silently ignore fetch errors
      }
    };

    fetchPrice();
    const interval = setInterval(fetchPrice, 10_000);
    return () => clearInterval(interval);
  }, [symbol]);

  if (currentPrice === null) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
        <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">Live Price</div>
        <div className="text-base font-semibold text-gray-500 animate-pulse">Loading…</div>
      </div>
    );
  }

  const pctChange = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0;
  const isUp = pctChange >= 0;
  const priceColor = isUp ? 'text-green-400' : 'text-red-400';

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
      <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">Live Price</div>
      <div className={`text-base font-semibold ${priceColor}`}>
        ${currentPrice.toLocaleString(undefined, { maximumFractionDigits: 4 })}
      </div>
      <div className={`text-xs mt-0.5 ${priceColor}`}>
        {isUp ? '▲' : '▼'} {Math.abs(pctChange).toFixed(2)}% vs entry
      </div>
    </div>
  );
}

export default function WatchPage() {
  const [tradingLeagueData, setTradingLeagueData] = useState<TradingLeagueData | null>(null);
  const [currentFightState, setCurrentFightState] = useState<FightState | null>(null);
  const [botsCount, setBotsCount] = useState(0);
  const [nowMs, setNowMs] = useState(Date.now());

  const fetchTradingLeagueData = useCallback(async () => {
    try {
      const response = await fetch('/api/arena/trading-league');
      const raw = await response.json();

      const data: TradingLeagueData = {
        activeBattles: raw.activeBattles || [],
        recentBattles: raw.recentBattles || [],
        leaderboard: raw.leaderboard || [],
        stats: raw.stats || { totalBattles: 0 },
      };

      setTradingLeagueData(data);
      setBotsCount(new Set([...data.leaderboard.map(b => b.name), ...data.activeBattles.flatMap(b => [b.bot1_name, b.bot2_name])]).size);
    } catch (error) {
      console.error('Failed to fetch trading league data:', error);
    }
  }, []);

  useEffect(() => {
    fetchTradingLeagueData();
    const refreshInterval = setInterval(fetchTradingLeagueData, 30000);
    return () => clearInterval(refreshInterval);
  }, [fetchTradingLeagueData]);

  useEffect(() => {
    const tickInterval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(tickInterval);
  }, []);

  useEffect(() => {
    if (!tradingLeagueData) {
      setCurrentFightState(null);
      return;
    }

    const currentTime = new Date(nowMs);

    if (tradingLeagueData.activeBattles.length > 0) {
      setCurrentFightState(mapBattleToFightState(tradingLeagueData.activeBattles[0], currentTime));
      return;
    }

    if (tradingLeagueData.recentBattles.length > 0) {
      setCurrentFightState(mapBattleToFightState(tradingLeagueData.recentBattles[0], currentTime));
      return;
    }

    setCurrentFightState(null);
  }, [tradingLeagueData, nowMs]);

  const otherActiveBattles = tradingLeagueData?.activeBattles.slice(1) || [];
  const liveBattles = tradingLeagueData?.activeBattles || [];

  let tradesForTicker: TickerTrade[] = [];
  if (currentFightState && currentFightState.market_data) {
    try {
      const marketData = JSON.parse(currentFightState.market_data);
      if (marketData && Array.isArray(marketData.trades)) {
        tradesForTicker = marketData.trades;
      }
    } catch (error) {
      console.error('Error parsing market_data for TradeTicker:', error);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white font-mono p-8">
      <motion.header
        initial={{ opacity: 0, y: -50 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="text-center mb-12"
      >
        <h1 className="text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-red-500 to-yellow-500">
          ⚔️ Live Trading Battles
        </h1>
        <div className="text-lg text-gray-400 mt-2">
          Total Battles: {tradingLeagueData?.stats.totalBattles || 0} | Total Bots: {botsCount}
        </div>
      </motion.header>

      <motion.section
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
        className="max-w-7xl mx-auto mb-8"
      >
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-5">
            <div>
              <h2 className="text-2xl font-bold text-white">Live Battles</h2>
              <p className="text-sm text-gray-400">Pending trading battles with live 15-minute countdowns.</p>
            </div>
            <div className="text-xs text-gray-500">Auto-refresh every 30s</div>
          </div>

          {liveBattles.length > 0 ? (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {liveBattles.map((battle) => {
                const remainingSeconds = getBattleRemainingSeconds(battle, nowMs);
                const countdownDone = remainingSeconds <= 0;

                return (
                  <div key={battle.id} className="bg-gray-950/80 border border-gray-800 rounded-xl p-4">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ${SYMBOL_BADGE_CLASSES[battle.symbol] || 'bg-gray-800 text-gray-300 border border-gray-700'}`}>
                          {battle.symbol}
                        </span>
                        <span className="text-xs text-gray-500">Started {timeAgo(battle.started_at)}</span>
                      </div>
                      <div className={`text-sm font-bold ${countdownDone ? 'text-yellow-400' : 'text-cyan-300'}`}>
                        {countdownDone ? 'Resolving...' : formatCountdown(remainingSeconds)}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 mb-4">
                      <div className="min-w-0 flex-1">
                        <div className="text-lg font-semibold text-white truncate">{battle.bot1_name}</div>
                      </div>
                      <span className="text-sm text-gray-500 font-bold">VS</span>
                      <div className="min-w-0 flex-1 text-right">
                        <div className="text-lg font-semibold text-white truncate">{battle.bot2_name}</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
                        <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">Actions</div>
                        <div className="flex items-center justify-between gap-2 text-sm">
                          <span className={`inline-flex rounded-full px-2.5 py-1 font-semibold ${ACTION_CLASSES[battle.bot1_action] || ACTION_CLASSES.HOLD}`}>
                            {battle.bot1_action}
                          </span>
                          <span className="text-gray-600">vs</span>
                          <span className={`inline-flex rounded-full px-2.5 py-1 font-semibold ${ACTION_CLASSES[battle.bot2_action] || ACTION_CLASSES.HOLD}`}>
                            {battle.bot2_action}
                          </span>
                        </div>
                      </div>

                      <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
                        <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">Entry Price</div>
                        <div className="text-base font-semibold text-white">
                          ${Number(battle.entry_price || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                        </div>
                      </div>

                      <LivePriceCell symbol={battle.symbol} entryPrice={battle.entry_price} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="bg-gray-950/80 border border-gray-800 rounded-xl px-5 py-8 text-center text-gray-400">
              No active battles. Next cycle starts soon...
            </div>
          )}
        </div>
      </motion.section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-7xl mx-auto">
        {/* Main Fight View and Info Panel */}
        <div className="lg:col-span-2 space-y-8">
          {currentFightState ? (
            <>
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.7 }}
                className="relative rounded-lg overflow-hidden"
              >
                <LiveFightView
                  botA={currentFightState.bot1}
                  botB={currentFightState.bot2}
                  status={currentFightState.status}
                  timeLeft={currentFightState.timeLeft}
                  winnerName={currentFightState.winnerName}
                  token={currentFightState.tokenSymbol}
                />
              </motion.div>

              {/* Battle Info — сразу под боем, без пробелов */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 -mt-2">
                <div className="bg-gray-800/70 border border-gray-700 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-400">Symbol</p>
                  <p className="text-lg font-bold text-yellow-400">{currentFightState.tokenSymbol}</p>
                </div>
                <div className="bg-gray-800/70 border border-gray-700 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-400">Entry Price</p>
                  <p className="text-lg font-bold text-white">${currentFightState.entryPrice.toFixed(2)}</p>
                </div>
                <div className="bg-green-900/30 border border-green-700/50 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-400">{currentFightState.bot1.name}</p>
                  <p className="text-lg font-bold text-green-400">{currentFightState.bot1Action}</p>
                </div>
                <div className="bg-amber-900/30 border border-amber-700/50 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-400">{currentFightState.bot2.name}</p>
                  <p className="text-lg font-bold text-amber-400">{currentFightState.bot2Action}</p>
                </div>
              </div>

              {/* Reasoning — collapsible */}
              <details className="bg-gray-800/50 border border-gray-700 rounded-lg p-3">
                <summary className="text-sm font-bold text-blue-300 cursor-pointer">💡 Bot Reasoning</summary>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2 text-xs">
                  <div>
                    <p className="text-green-400 font-bold mb-1">{currentFightState.bot1.name}:</p>
                    <p className="text-gray-400 leading-relaxed">{currentFightState.bot1Reasoning}</p>
                  </div>
                  <div>
                    <p className="text-amber-400 font-bold mb-1">{currentFightState.bot2.name}:</p>
                    <p className="text-gray-400 leading-relaxed">{currentFightState.bot2Reasoning}</p>
                  </div>
                </div>
              </details>
            </>
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5 }}
              className="bg-gray-900 border border-gray-800 rounded-lg p-6 shadow-xl text-center py-20"
            >
              <h2 className="text-3xl font-bold text-gray-500 mb-4">No Active Battles</h2>
              <p className="text-gray-600">Next battle soon... Prepare for impact!</p>
            </motion.div>
          )}

          {/* Battle Queue (Other active battles) */}
          {otherActiveBattles.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              <h2 className="text-2xl font-bold text-purple-400 mb-4">Battle Queue ({otherActiveBattles.length})</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {otherActiveBattles.map((battle) => (
                  <div key={battle.id} className="bg-gray-800/60 border border-gray-700 rounded-lg p-4 flex items-center space-x-4">
                    <div className="w-12 h-12 flex items-center justify-center bg-gray-700 rounded-full text-xs text-gray-300">BOT {battle.bot1_id}</div>
                    <div className="flex-grow">
                      <p className="font-bold text-lg">{battle.bot1_name} <span className="text-yellow-400">VS</span> {battle.bot2_name}</p>
                      <p className="text-sm text-gray-400">{battle.symbol.replace('USDT', '')} | {battle.timeframe_minutes} min</p>
                    </div>
                    <span className="bg-indigo-700 text-white text-xs font-bold px-2 py-1 rounded-full">UP NEXT</span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </div>

        {/* Recent Results and Leaderboard */}
        <div className="lg:col-span-1 space-y-8">
          {/* Recent Results Section */}
          <motion.div
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
          >
            <h2 className="text-2xl font-bold text-blue-400 mb-4">Recent Results ({tradingLeagueData?.recentBattles.length || 0})</h2>
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 shadow-md space-y-3">
              {tradingLeagueData?.recentBattles.slice(0, 5).map((battle) => {
                const mappedFightState = mapBattleToFightState(battle, new Date(nowMs));
                const winnerName = mappedFightState.winnerName;
                return (
                  <div key={battle.id} className="bg-gray-800/60 border border-gray-700 rounded-lg p-3 shadow-sm">
                    <div className="flex justify-between items-center mb-1">
                      <span className="bg-gray-700 text-white text-xs font-bold px-2 py-0.5 rounded-full">{battle.symbol.replace('USDT', '')}</span>
                      <span className="text-xs text-gray-400">{timeAgo(battle.resolved_at || battle.started_at)}</span>
                    </div>
                    <div className="text-base text-gray-300">
                      <span className={`font-bold ${winnerName === battle.bot1_name ? 'text-green-400' : ''}`}>{battle.bot1_name}</span> ({formatPnl(battle.bot1_pnl)})
                      {' '}vs{' '}
                      <span className={`font-bold ${winnerName === battle.bot2_name ? 'text-green-400' : ''}`}>{battle.bot2_name}</span> ({formatPnl(battle.bot2_pnl)})
                    </div>
                    {winnerName && (
                      <p className="text-sm text-yellow-300 mt-1">Winner: {winnerName}</p>
                    )}
                  </div>
                );
              })}
              {(tradingLeagueData?.recentBattles.length === 0 || !tradingLeagueData) && (
                <p className="text-gray-500 text-center py-4">No recent results available.</p>
              )}
            </div>
          </motion.div>

          {/* Mini Leaderboard */}
          <motion.div
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.6 }}
          >
            <h2 className="text-2xl font-bold text-yellow-400 mb-4">Top Bots</h2>
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 shadow-md">
              {tradingLeagueData?.leaderboard.slice(0, 5).map((bot, index) => (
                <div key={index} className="flex justify-between items-center py-2 border-b border-gray-800 last:border-b-0">
                  <span className="text-md font-bold text-gray-300">{index + 1}. {bot.name}</span>
                  <div className="text-right">
                    <span className="text-yellow-400 font-bold mr-2">ELO: {Math.round(bot.elo)}</span>
                    {formatPnl(bot.total_pnl)}
                  </div>
                </div>
              ))}
              {(!tradingLeagueData?.leaderboard || tradingLeagueData.leaderboard.length === 0) && (
                <p className="text-gray-500 text-center py-4">Leaderboard data not available.</p>
              )}
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
