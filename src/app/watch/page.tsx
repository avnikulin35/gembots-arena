
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
  bot1_action: 'BUY' | 'SELL';
  bot1_leverage: number;
  bot1_pnl: number | null;
  bot2_action: 'BUY' | 'SELL';
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
    .replace(/-\d{4}$/, '')       // remove date suffix
    .replace(/-it$/, '')           // remove -it suffix
    .replace(/-instruct$/, '')     // remove -instruct
    .replace(/(\d+)b/gi, (_, n) => `${n}B`)  // capitalize B
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
    action: 'BUY' | 'SELL';
    side: 'BUY' | 'SELL';
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
  bot1Action: string; // e.g., "BUY 5x"
  bot2Action: string; // e.g., "SELL 3x"
  bot1Reasoning: string;
  bot2Reasoning: string;
  market_data: string;
}

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
    const startedAt = new Date(battle.started_at + 'Z'); // Assume UTC
    const endTime = new Date(startedAt.getTime() + battle.timeframe_minutes * 60 * 1000);
    const remaining = endTime.getTime() - currentTime.getTime();
    timeLeft = Math.max(0, Math.floor(remaining / 1000));
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
      color: '#22c55e', // green
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
      color: '#f59e0b', // amber
      glowColor: 'rgba(245,158,11,0.6)',
      pnl: bot2Pnl,
      lastTrade: { action: battle.bot2_action, side: battle.bot2_action },
    },
    status: battle.status === 'pending' ? 'fighting' : 'finished',
    timeLeft: timeLeft,
    winnerName: winnerName,
    tokenSymbol: battle.symbol.replace('USDT', ''), // BTCUSDT -> BTC
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
  const date = new Date(dateString + 'Z'); // Assume UTC
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
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
  return Math.floor(seconds) + ' seconds ago';
};

export default function WatchPage() {
  const [tradingLeagueData, setTradingLeagueData] = useState<TradingLeagueData | null>(null);
  const [currentFightState, setCurrentFightState] = useState<FightState | null>(null);
  const [botsCount, setBotsCount] = useState(0);

  const fetchTradingLeagueData = useCallback(async () => {
    try {
      const response = await fetch('/api/arena/trading-league');
      const raw = await response.json();
      const currentTime = new Date();

      const data: TradingLeagueData = {
        activeBattles: raw.activeBattles || [],
        recentBattles: raw.recentBattles || [],
        leaderboard: raw.leaderboard || [],
        stats: raw.stats || { totalBattles: 0 },
      };

      setTradingLeagueData(data);
      setBotsCount(new Set([...data.leaderboard.map(b => b.name), ...data.activeBattles.flatMap(b => [b.bot1_name, b.bot2_name])]).size);

      let mainBattle: Battle | null = null;
      if (data.activeBattles.length > 0) {
        mainBattle = data.activeBattles[0];
        setCurrentFightState(mapBattleToFightState(mainBattle, currentTime));
      } else if (data.recentBattles.length > 0) {
        // If no active battles, show the latest resolved battle as 'finished'
        mainBattle = data.recentBattles[0];
        setCurrentFightState(mapBattleToFightState(mainBattle, currentTime));
      } else {
        setCurrentFightState(null); // No battles at all
      }

    } catch (error) {
      console.error('Failed to fetch trading league data:', error);
    }
  }, []);

  useEffect(() => {
    fetchTradingLeagueData(); // Initial fetch
    const interval = setInterval(fetchTradingLeagueData, 10000); // Auto-refresh every 10 seconds
    return () => clearInterval(interval);
  }, [fetchTradingLeagueData]);

  const otherActiveBattles = tradingLeagueData?.activeBattles.slice(1) || [];

  let tradesForTicker: TickerTrade[] = [];
  if (currentFightState && currentFightState.market_data) {
    try {
      const marketData = JSON.parse(currentFightState.market_data);
      if (marketData && Array.isArray(marketData.trades)) {
        tradesForTicker = marketData.trades;
      }
    } catch (error) {
      console.error("Error parsing market_data for TradeTicker:", error);
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
                {otherActiveBattles.map((battle, index) => (
                  <div key={battle.id} className="bg-gray-800/60 border border-gray-700 rounded-lg p-4 flex items-center space-x-4">
                    {/* Placeholder for bot sprite - as BotSprites.RobotSprite is too complex for miniatures without full BotState */}
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
                const mappedFightState = mapBattleToFightState(battle, new Date());
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
