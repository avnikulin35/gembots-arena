'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import HPBar from './HPBar';
import { soundManager } from '../lib/sounds';

interface LiveBattleCardProps {
  battle: {
    id: string;
    bot1: { id: number; name: string; prediction: number; hp?: number; max_hp?: number };
    bot2: { id: number; name: string; prediction: number; hp?: number; max_hp?: number };
    token_symbol: string;
    duration_minutes?: number;
    current_x: number;
    entry_price?: number;
    countdown: number;
    status: string;
    winner_id?: number | null;
    actual_x?: number | null;
  };
  myWallet?: string;
  bot1Wallet?: string;
  bot2Wallet?: string;
  compact?: boolean;
}

async function fetchCurrentX(token: string, entryPrice: number): Promise<number | null> {
  try {
    const cleanToken = token.replace(/^\$/, '').replace(/USDT$/i, '');
    const res = await fetch(`/api/token-price?token=${cleanToken}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.price || entryPrice <= 0) return null;
    return data.price / entryPrice;
  } catch {
    return null;
  }
}

export default function LiveBattleCard({ battle, myWallet, bot1Wallet, bot2Wallet, compact = false }: LiveBattleCardProps) {
  const [countdown, setCountdown] = useState(battle.countdown);
  const [currentX, setCurrentX] = useState(battle.current_x);
  const [expanded, setExpanded] = useState(false);
  const [priceFlash, setPriceFlash] = useState<'up' | 'down' | null>(null);
  const [shaking, setShaking] = useState(false);
  const [prevBot1Winning, setPrevBot1Winning] = useState<boolean | null>(null);
  const lastTickRef = useRef<number>(-1);
  const prevXRef = useRef<number>(battle.current_x);
  const isMine = myWallet && (bot1Wallet === myWallet || bot2Wallet === myWallet);

  // Init sound manager
  useEffect(() => {
    soundManager.init();
  }, []);

  // Live countdown
  useEffect(() => {
    setCountdown(battle.countdown);
  }, [battle.countdown]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  // Countdown tick sound for last 10 seconds
  useEffect(() => {
    if (countdown <= 10 && countdown > 0 && countdown !== lastTickRef.current) {
      lastTickRef.current = countdown;
      soundManager.countdownTick(countdown);
    }
  }, [countdown]);

  // Real price polling — fetch every 10s from /api/token-price
  useEffect(() => {
    if (!battle.entry_price || battle.entry_price <= 0) return;

    const poll = async () => {
      const fetched = await fetchCurrentX(battle.token_symbol, battle.entry_price!);
      if (fetched === null) return;

      setCurrentX((prev) => {
        const diff = fetched - prevXRef.current;
        prevXRef.current = fetched;

        if (Math.abs(diff) > 0.02) {
          setPriceFlash(diff > 0 ? 'up' : 'down');
          setTimeout(() => setPriceFlash(null), 300);
        }
        if (Math.abs(diff) > 0.04) {
          setShaking(true);
          soundManager.criticalHit();
          setTimeout(() => setShaking(false), 300);
        }

        return fetched;
      });
    };

    poll();
    const interval = setInterval(poll, 10_000);
    return () => clearInterval(interval);
  }, [battle.token_symbol, battle.entry_price]);

  // Sync current_x from props when entry_price is not available (fallback)
  useEffect(() => {
    if (!battle.entry_price || battle.entry_price <= 0) {
      setCurrentX(battle.current_x);
    }
  }, [battle.current_x, battle.entry_price]);

  const totalDurationSec = (battle.duration_minutes || 1) * 60;
  const progress = Math.max(0, Math.min(100, ((totalDurationSec - countdown) / totalDurationSec) * 100));
  const isEnding = countdown <= 10;

  // Format countdown for different durations
  const formatCountdown = (sec: number) => {
    if (sec <= 0) return '0:00';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const bot1Diff = Math.abs(currentX - battle.bot1.prediction);
  const bot2Diff = Math.abs(currentX - battle.bot2.prediction);
  const bot1Winning = bot1Diff < bot2Diff;

  // Lead change detection
  useEffect(() => {
    if (prevBot1Winning !== null && prevBot1Winning !== bot1Winning) {
      soundManager.hit();
    }
    setPrevBot1Winning(bot1Winning);
  }, [bot1Winning, prevBot1Winning]);

  // Resolved state
  const isResolved = battle.status === 'resolved';
  const iWon = isResolved && isMine && battle.winner_id && (
    (bot1Wallet === myWallet && battle.winner_id === battle.bot1.id) ||
    (bot2Wallet === myWallet && battle.winner_id === battle.bot2.id)
  );
  const iLost = isResolved && isMine && !iWon;

  // HP values (default 100/100 if not provided)
  const bot1Hp = battle.bot1.hp ?? 100;
  const bot1MaxHp = battle.bot1.max_hp ?? 100;
  const bot2Hp = battle.bot2.hp ?? 100;
  const bot2MaxHp = battle.bot2.max_hp ?? 100;

  // Price flash colors
  const priceFlashClass = priceFlash === 'up'
    ? 'text-green-300 drop-shadow-[0_0_12px_rgba(74,222,128,0.8)]'
    : priceFlash === 'down'
      ? 'text-red-300 drop-shadow-[0_0_12px_rgba(248,113,113,0.8)]'
      : '';

  // Shake animation
  const shakeAnimation = shaking
    ? { x: [0, -3, 3, -3, 3, -2, 2, 0], transition: { duration: 0.4 } }
    : {};

  // Heartbeat animation ONLY for non-mine battles in last 5 seconds (subtle)
  const heartbeatAnimation = (isEnding && !isMine && countdown <= 5)
    ? {
        scale: [1, 1.01, 1],
        transition: {
          duration: 1,
          repeat: Infinity,
          ease: 'easeInOut' as const,
        },
      }
    : {};

  // Resolved result overlay (both compact and expanded)
  if (isResolved && isMine) {
    return (
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className={`relative overflow-hidden rounded-xl border-2 p-4 text-center ${
          iWon 
            ? 'border-green-500 bg-green-900/30' 
            : 'border-red-500 bg-red-900/30'
        }`}
      >
        <div className="text-4xl mb-2">{iWon ? '🏆' : '💔'}</div>
        <div className="text-xl font-bold mb-1">{iWon ? 'YOU WIN!' : 'YOU LOSE!'}</div>
        <div className="text-sm text-gray-400">
          ${battle.token_symbol} → {battle.actual_x?.toFixed(2) || '?'}x
        </div>
        <div className="text-xs text-gray-500 mt-1">
          {battle.bot1.name} ({battle.bot1.prediction}x) vs {battle.bot2.name} ({battle.bot2.prediction}x)
        </div>
      </motion.div>
    );
  }

  if (isResolved && !isMine) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="relative overflow-hidden rounded-xl border border-gray-600 bg-gray-800/40 p-3 text-center"
      >
        <div className="text-lg mb-1">⚔️ Battle Resolved</div>
        <div className="text-sm text-gray-400">
          ${battle.token_symbol} → {battle.actual_x?.toFixed(2) || '?'}x
        </div>
      </motion.div>
    );
  }

  // Compact collapsed view
  if (compact && !expanded) {
    return (
      <motion.div
        initial={{ opacity: 0, y: -5 }}
        animate={{ opacity: 1, y: 0, ...shakeAnimation }}
        className="relative overflow-hidden rounded-lg border border-gray-700/60 bg-gray-800/40 cursor-pointer hover:border-gray-600 transition-all"
        onClick={() => setExpanded(true)}
      >
        {/* Thin progress bar */}
        <div className="absolute bottom-0 left-0 h-0.5 bg-gray-700 w-full">
          <motion.div
            className={`h-full ${isEnding ? 'bg-red-500' : 'bg-teal-500'}`}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>

        <div className="px-3 py-2 flex items-center justify-between gap-2">
          {/* Left: status + token */}
          <div className="flex items-center gap-2 min-w-0">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isEnding ? 'bg-red-500' : 'bg-green-500'} animate-pulse`} />
            <span className="text-xs text-gray-500 flex-shrink-0">${battle.token_symbol}</span>
            {battle.duration_minutes && battle.duration_minutes > 1 && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                battle.duration_minutes === 60 ? 'bg-yellow-900/50 text-yellow-400' : 'bg-purple-900/50 text-purple-400'
              }`}>
                {battle.duration_minutes === 60 ? '🥊 1h' : '🏆 24h'}
              </span>
            )}
          </div>

          {/* Center: price */}
          <span className={`text-sm font-bold font-mono flex-shrink-0 ${
            currentX >= 1.5 ? 'text-green-400' : currentX <= 0.7 ? 'text-red-400' : 'text-cyan-400'
          } ${priceFlashClass}`}>
            {currentX.toFixed(2)}x
          </span>

          {/* Bots mini */}
          <div className="flex items-center gap-1 text-xs min-w-0">
            <span className={`truncate max-w-[60px] ${bot1Winning ? 'text-green-400 font-bold' : 'text-gray-500'}`}>
              {battle.bot1.name}
            </span>
            <span className="text-gray-600 flex-shrink-0">vs</span>
            <span className={`truncate max-w-[60px] ${!bot1Winning ? 'text-green-400 font-bold' : 'text-gray-500'}`}>
              {battle.bot2.name}
            </span>
          </div>

          {/* Timer + expand icon */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className={`text-xs font-mono ${isEnding ? 'text-red-400 font-bold' : 'text-gray-400'}`}>
              {formatCountdown(countdown)}
            </span>
            <span className="text-gray-600 text-xs">▼</span>
          </div>
        </div>
      </motion.div>
    );
  }

  // Full expanded view
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1, ...shakeAnimation, ...heartbeatAnimation }}
      className={`relative overflow-hidden rounded-xl border ${
        isMine
          ? 'border-purple-500/60 shadow-lg shadow-purple-900/30'
          : compact ? 'border-gray-700/60' : 'border-gray-700'
      } bg-gray-800/60`}
    >
      {/* Subtle red border glow when ending (no flickering vignette) */}
      {isEnding && countdown <= 5 && !isMine && (
        <div className="absolute inset-0 pointer-events-none rounded-xl z-10 border-2 border-red-500/30" />
      )}

      {/* Progress bar */}
      <div className="absolute bottom-0 left-0 h-1 bg-gray-700 w-full z-20">
        <motion.div
          className={`h-full ${isEnding ? 'bg-red-500' : 'bg-teal-500'}`}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>

      <div className="p-4 relative z-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${isEnding ? 'bg-red-500' : 'bg-green-500'} animate-pulse`} />
            <span className="text-xs text-gray-400">LIVE</span>
            {isMine && (
              <span className="text-xs bg-purple-900/60 text-purple-400 px-2 py-0.5 rounded-full border border-purple-500/30">
                ⭐ YOU
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">${battle.token_symbol}</span>
            {/* Countdown — red when ending, no pulsating */}
            {isEnding ? (
              <span className="text-sm font-mono font-black text-red-400">
                {formatCountdown(countdown)}
              </span>
            ) : (
              <span className="text-sm font-mono font-bold text-gray-300">
                {formatCountdown(countdown)}
              </span>
            )}
            {compact && (
              <button
                onClick={() => setExpanded(false)}
                className="text-gray-500 hover:text-gray-300 text-xs ml-1"
              >
                ▲
              </button>
            )}
          </div>
        </div>

        {/* Center: Current Price with flash effect */}
        <div className="text-center mb-3">
          <div className="text-xs text-gray-500 mb-1">Current Price</div>
          <div
            className={`text-3xl font-black font-mono transition-colors duration-300 ${
              currentX >= 1.5 ? 'text-green-400' : currentX <= 0.7 ? 'text-red-400' : 'text-cyan-400'
            } ${priceFlashClass}`}
          >
            {currentX.toFixed(2)}x
            {/* Price direction indicator */}
            <AnimatePresence>
              {priceFlash && (
                <motion.span
                  className="text-sm ml-1 inline-block"
                  initial={{ opacity: 1, y: 0 }}
                  animate={{
                    opacity: 0,
                    y: priceFlash === 'up' ? -15 : 15,
                  }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.5 }}
                >
                  {priceFlash === 'up' ? '▲' : '▼'}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Players with HP bars */}
        <div className="flex items-stretch justify-between gap-2">
          {/* Bot 1 */}
          <div className={`flex-1 p-2 rounded-lg transition-all duration-300 ${
            bot1Winning ? 'bg-green-900/20 border border-green-500/20' : 'bg-gray-900/30'
          }`}>
            <div className="text-xs text-gray-400 truncate mb-0.5">{battle.bot1.name}</div>
            <div className={`text-lg font-bold font-mono ${bot1Winning ? 'text-green-400' : 'text-gray-400'}`}>
              {battle.bot1.prediction.toFixed(2)}x
            </div>
            {bot1Winning && <div className="text-xs text-green-500 mb-1">winning</div>}
            <HPBar current={bot1Hp} max={bot1MaxHp} size="sm" />
          </div>

          <div className="px-1 flex items-center text-gray-600 text-xs font-bold">VS</div>

          {/* Bot 2 */}
          <div className={`flex-1 p-2 rounded-lg transition-all duration-300 ${
            !bot1Winning ? 'bg-green-900/20 border border-green-500/20' : 'bg-gray-900/30'
          }`}>
            <div className="text-xs text-gray-400 truncate mb-0.5">{battle.bot2.name}</div>
            <div className={`text-lg font-bold font-mono ${!bot1Winning ? 'text-green-400' : 'text-gray-400'}`}>
              {battle.bot2.prediction.toFixed(2)}x
            </div>
            {!bot1Winning && <div className="text-xs text-green-500 mb-1">winning</div>}
            <HPBar current={bot2Hp} max={bot2MaxHp} size="sm" />
          </div>
        </div>
      </div>
    </motion.div>
  );
}
