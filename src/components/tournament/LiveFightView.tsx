'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RobotSprite, BotState, getHpTier } from './BotSprites';
import { ArenaBackground, FightFlash, DamagePopup, type DamagePopupData } from './ArenaEffects';
import { VSBadge } from './VSBadge';
import TokenPriceChart from './TokenPriceChart';

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface FightBotState {
  id: number;
  name: string;
  hp: number;
  maxHp: number;
  color: string;
  glowColor: string;
  pnl?: number;
  ai_model?: string;
  trading_style?: string;
  elo?: number;
  nfa_id?: number | null;
  lastTrade?: {
    side?: string;
    action?: string;
    pnl?: number;
    size?: number;
    unrealizedPnl?: number;
  };
  position?: string | null;
}

export interface FightTrade {
  id: number;
  bot: 'A' | 'B';
  token: string;
  action: 'buy' | 'sell';
  pnl: number;
  isCombo: boolean;
  timestamp: number;
}

interface LiveFightViewProps {
  botA: FightBotState | null;
  botB: FightBotState | null;
  status: 'waiting' | 'betting' | 'fighting' | 'finished';
  timeLeft: number;
  winnerName?: string;
  nextMatchIn?: number;
  token?: string;
  bettingEndsAt?: number;
}

// ─── TOKEN BADGE ──────────────────────────────────────────────────────────────

function TokenBadge({ token }: { token: string }) {
  return (
    <motion.div
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-yellow-500/30 bg-yellow-500/10 backdrop-blur-sm"
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 0.3, type: 'spring' }}
    >
      <span className="text-sm">🪙</span>
      <span
        className="font-orbitron text-[10px] md:text-xs font-bold tracking-wider text-yellow-400"
        style={{ textShadow: '0 0 8px rgba(255,215,0,0.5)' }}
      >
        ${token}
      </span>
    </motion.div>
  );
}

// ─── HP BAR (Street Fighter style from fight-demo) ───────────────────────────

function HPBarFight({ bot, side, aiModel }: { bot: BotState; side: 'left' | 'right'; aiModel?: string }) {
  const percentage = Math.max(0, (bot.hp / bot.maxHp) * 100);
  const barColor =
    percentage > 60 ? 'from-green-400 to-green-500'
    : percentage > 30 ? 'from-yellow-400 to-orange-500'
    : 'from-red-500 to-red-600';

  return (
    <div className={`flex-1 min-w-0 ${side === 'right' ? 'flex flex-col items-end' : ''}`}>
      {/* Bot name + AI Model + PnL */}
      <div className={`flex items-center gap-1 md:gap-2 mb-0.5 ${side === 'right' ? 'flex-row-reverse' : ''}`}>
        <span
          className="font-orbitron text-[10px] md:text-sm font-bold tracking-wider truncate"
          style={{ color: bot.color, textShadow: `0 0 10px ${bot.glowColor}` }}
        >
          {bot.name}
        </span>
        {bot.nfa_id != null && (
          <a href={`/nfa/${bot.nfa_id}/reputation`} className="flex items-center gap-0.5 px-1 md:px-1.5 py-0.5 rounded bg-cyan-500/15 border border-cyan-500/30 text-[8px] md:text-[10px] text-cyan-400 hover:bg-cyan-500/25 transition-colors font-mono flex-shrink-0" title="View on-chain reputation">
            NFA #{bot.nfa_id}
          </a>
        )}
        <span className={`font-mono text-[10px] md:text-xs font-semibold ${bot.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          {bot.totalPnl >= 0 ? '+' : ''}{bot.totalPnl.toFixed(1)}%
        </span>
      </div>
      {aiModel && (
        <div className={`mb-0.5 ${side === 'right' ? 'text-right' : 'text-left'}`}>
          <span className="text-[9px] md:text-xs text-purple-400/80 font-mono">
            🤖 {aiModel}
          </span>
        </div>
      )}

      {/* HP bar container */}
      <div className="relative w-full h-4 md:h-7 rounded-sm overflow-hidden border border-white/10 bg-gray-900/80">
        {/* Background tick marks */}
        <div className="absolute inset-0 flex">
          {Array.from({ length: 20 }, (_, i) => (
            <div key={i} className="flex-1 border-r border-white/5" />
          ))}
        </div>

        {/* HP fill */}
        <motion.div
          className={`absolute top-0 ${side === 'left' ? 'left-0' : 'right-0'} h-full bg-gradient-to-r ${barColor}`}
          initial={{ width: '100%' }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          style={{
            boxShadow: `0 0 15px ${bot.glowColor}, inset 0 1px 0 rgba(255,255,255,0.3)`,
          }}
        />

        {/* HP text */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-mono text-[10px] md:text-sm font-bold text-white drop-shadow-lg">
            {Math.max(0, Math.round(bot.hp))} / {bot.maxHp}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── ROUND TIMER ──────────────────────────────────────────────────────────────

function RoundTimer({ seconds }: { seconds: number }) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const isLow = seconds < 30;

  return (
    <motion.div
      className="text-center px-2"
      animate={isLow ? { scale: [1, 1.1, 1] } : {}}
      transition={isLow ? { duration: 0.5, repeat: Infinity } : {}}
    >
      <div className="text-[9px] md:text-[10px] text-gray-500 uppercase tracking-widest mb-0.5">Round</div>
      <div
        className={`font-orbitron font-bold text-sm md:text-2xl ${isLow ? 'text-red-400' : 'text-white'}`}
        style={{
          textShadow: isLow
            ? '0 0 20px rgba(255,60,60,0.6)'
            : '0 0 10px rgba(153,69,255,0.4)',
        }}
      >
        {mins}:{secs.toString().padStart(2, '0')}
      </div>
    </motion.div>
  );
}

// ─── POSITION INDICATOR BADGE ─────────────────────────────────────────────────

function PositionBadge({ position, side }: { position?: string | null; side: 'left' | 'right' }) {
  if (!position || position === 'HOLD') return null;

  const isLong = position === 'LONG';
  const emoji = isLong ? '📈' : '📉';
  const color = isLong ? 'text-green-400 border-green-500/40 bg-green-500/15' : 'text-red-400 border-red-500/40 bg-red-500/15';
  const glow = isLong ? '0 0 8px rgba(74,222,128,0.4)' : '0 0 8px rgba(248,113,113,0.4)';

  return (
    <motion.div
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[9px] md:text-[10px] font-mono font-bold ${color}`}
      style={{ boxShadow: glow }}
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.5 }}
      transition={{ type: 'spring', damping: 15 }}
    >
      <span>{emoji}</span>
      <span>{position}</span>
    </motion.div>
  );
}

// ─── TRADE FLASH POPUP ────────────────────────────────────────────────────────

interface TradeFlashData {
  id: number;
  action: string;
  side: string;
  pnl: number;
  size: number;
}

let tradeFlashIdCounter = 0;

function TradeFlashPopup({ flash, side }: { flash: TradeFlashData; side: 'left' | 'right' }) {
  const isOpen = flash.action === 'OPEN';
  const isProfit = flash.pnl >= 0;
  const emoji = isOpen ? '🟢' : (isProfit ? '💰' : '🔴');

  let text: string;
  if (isOpen) {
    text = `OPENED ${flash.side} $${flash.size.toFixed(0)}`;
  } else {
    text = `CLOSED ${flash.side} ${isProfit ? '+' : ''}${flash.pnl.toFixed(1)}%`;
  }

  const bgColor = isOpen
    ? 'bg-blue-500/20 border-blue-400/40'
    : isProfit
      ? 'bg-green-500/20 border-green-400/40'
      : 'bg-red-500/20 border-red-400/40';

  const textColor = isOpen ? 'text-blue-300' : isProfit ? 'text-green-300' : 'text-red-300';
  const glowColor = isOpen ? 'rgba(96,165,250,0.5)' : isProfit ? 'rgba(74,222,128,0.5)' : 'rgba(248,113,113,0.5)';

  return (
    <motion.div
      className={`absolute ${side === 'left' ? 'left-2 md:left-4' : 'right-2 md:right-4'} z-30 pointer-events-none`}
      style={{ top: '35%' }}
      initial={{ opacity: 0, y: 10, scale: 0.7 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.8 }}
      transition={{ duration: 0.3, type: 'spring', damping: 20 }}
    >
      <div
        className={`flex items-center gap-1 px-2 py-1 rounded-lg border backdrop-blur-sm ${bgColor}`}
        style={{ boxShadow: `0 0 12px ${glowColor}` }}
      >
        <span className="text-xs">{emoji}</span>
        <span className={`text-[9px] md:text-[10px] font-mono font-bold whitespace-nowrap ${textColor}`}>
          {text}
        </span>
      </div>
    </motion.div>
  );
}

// ─── PNL PULSE EFFECT ─────────────────────────────────────────────────────────

function PnlPulse({ pnl, side }: { pnl: number; side: 'left' | 'right' }) {
  const isProfit = pnl >= 0;
  const color = isProfit ? 'rgba(74,222,128,0.3)' : 'rgba(248,113,113,0.3)';

  return (
    <motion.div
      className={`absolute ${side === 'left' ? 'left-0' : 'right-0'} top-0 w-1/2 h-full pointer-events-none z-5`}
      initial={{ opacity: 0.6 }}
      animate={{ opacity: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1 }}
      style={{
        background: `radial-gradient(ellipse at ${side === 'left' ? '30%' : '70%'} 50%, ${color}, transparent 70%)`,
      }}
    />
  );
}

// ─── BOT FIGHTER CONTAINER ────────────────────────────────────────────────────

function BotFighter({ bot, side, isShaking, opponentHp, botId, opponentBotId }: { bot: BotState; side: 'left' | 'right'; isShaking: boolean; opponentHp: number; botId?: number; opponentBotId?: number }) {
  return (
    <motion.div
      className="flex flex-col items-center self-end"
      animate={
        isShaking
          ? { x: [0, -8, 8, -6, 6, -3, 3, 0] }
          : {}
      }
      transition={{ duration: 0.4 }}
    >
      <RobotSprite bot={bot} side={side} isShaking={isShaking} opponentHp={opponentHp} botId={botId} opponentBotId={opponentBotId} />
    </motion.div>
  );
}

// ─── WAITING STATE ────────────────────────────────────────────────────────────

function WaitingState({ nextMatchIn, message }: { nextMatchIn?: number; message?: string }) {
  const [countdown, setCountdown] = useState(nextMatchIn ?? 0);

  useEffect(() => {
    if (nextMatchIn !== undefined) setCountdown(nextMatchIn);
  }, [nextMatchIn]);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [countdown]);

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center z-20">
      <motion.div
        className="text-center"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
      >
        <motion.div
          className="text-4xl mb-4"
          animate={{ scale: [1, 1.1, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          ⚔️
        </motion.div>
        <h3 className="font-orbitron text-lg md:text-xl font-bold text-white mb-2">
          {message || 'Next match starting soon...'}
        </h3>
        {countdown > 0 && (
          <div className="font-orbitron text-2xl md:text-4xl font-black text-yellow-400">
            {Math.floor(countdown / 60)}:{(countdown % 60).toString().padStart(2, '0')}
          </div>
        )}
      </motion.div>
    </div>
  );
}

// ─── VICTORY PHASE TYPES ──────────────────────────────────────────────────────

type VictoryPhase = 'ko' | 'zoom' | 'stats' | 'transition';

// ─── CONFETTI PARTICLES (pure CSS keyframes via inline styles) ────────────────

function ConfettiParticles() {
  const particles = useMemo(() => Array.from({ length: 30 }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 2,
    duration: 2 + Math.random() * 2,
    size: 4 + Math.random() * 6,
    color: ['#FFD700', '#FF6B00', '#9945FF', '#14F195', '#00F0FF', '#FF4444', '#FF69B4'][i % 7],
    rotation: Math.random() * 360,
    drift: (Math.random() - 0.5) * 60,
  })), []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-30">
      {particles.map(p => (
        <motion.div
          key={p.id}
          className="absolute"
          style={{
            left: `${p.left}%`,
            top: -10,
            width: p.size,
            height: p.size * 0.6,
            background: p.color,
            borderRadius: p.id % 3 === 0 ? '50%' : p.id % 3 === 1 ? '2px' : '0',
            transform: `rotate(${p.rotation}deg)`,
          }}
          initial={{ y: -20, opacity: 1, rotate: p.rotation }}
          animate={{
            y: [0, 400],
            x: [0, p.drift],
            opacity: [1, 1, 0.5],
            rotate: [p.rotation, p.rotation + 360 + Math.random() * 360],
          }}
          transition={{
            duration: p.duration,
            delay: p.delay,
            repeat: Infinity,
            ease: 'easeIn',
          }}
        />
      ))}
    </div>
  );
}

// ─── GOLDEN BORDER GLOW ───────────────────────────────────────────────────────

function GoldenBorderGlow({ color }: { color: string }) {
  return (
    <motion.div
      className="absolute inset-0 rounded-xl pointer-events-none z-5"
      initial={{ opacity: 0 }}
      animate={{ opacity: [0.4, 0.8, 0.4] }}
      transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      style={{
        boxShadow: `inset 0 0 30px ${color}40, 0 0 40px ${color}30, 0 0 80px ${color}15`,
        border: `2px solid ${color}60`,
        borderRadius: 'inherit',
      }}
    />
  );
}

// ─── PHASE 1: K.O. IMPACT ─────────────────────────────────────────────────────

function KOPhase() {
  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center z-40"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Flash overlay */}
      <motion.div
        className="absolute inset-0 bg-white"
        initial={{ opacity: 0.8 }}
        animate={{ opacity: 0 }}
        transition={{ duration: 0.5 }}
      />
      {/* K.O. text */}
      <motion.div
        className="relative font-orbitron font-black text-5xl md:text-8xl"
        initial={{ scale: 3, opacity: 0 }}
        animate={{ scale: [3, 0.9, 1.1, 1], opacity: 1 }}
        transition={{ duration: 0.6, times: [0, 0.5, 0.75, 1], ease: 'easeOut' }}
        style={{
          background: 'linear-gradient(135deg, #FFD700, #FF6B00, #FF4444)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          filter: 'drop-shadow(0 0 30px rgba(255,215,0,0.8)) drop-shadow(0 0 60px rgba(255,107,0,0.5))',
        }}
      >
        K.O.!
      </motion.div>
    </motion.div>
  );
}

// ─── PHASE 2: ZOOM ON WINNER ──────────────────────────────────────────────────

function ZoomPhase({ winnerName, winnerBot, winnerSide }: {
  winnerName: string;
  winnerBot: FightBotState;
  winnerSide: 'left' | 'right';
}) {
  const pnl = winnerBot.pnl ?? 0;
  return (
    <motion.div
      className="absolute inset-0 z-30 flex flex-col items-center justify-center pointer-events-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
    >
      {/* Winner name */}
      <motion.div
        className="relative z-10 text-center"
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.5, duration: 0.6 }}
      >
        <motion.div
          className="font-orbitron text-xl md:text-3xl font-black mb-1 tracking-wider"
          animate={{ textShadow: [
            `0 0 20px ${winnerBot.glowColor}80`,
            `0 0 40px ${winnerBot.glowColor}CC`,
            `0 0 20px ${winnerBot.glowColor}80`,
          ]}}
          transition={{ duration: 1.5, repeat: Infinity }}
          style={{ color: winnerBot.color }}
        >
          {winnerName}
        </motion.div>
        <motion.div
          className="font-orbitron text-base md:text-xl font-bold text-yellow-400"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 }}
          style={{ textShadow: '0 0 15px rgba(255,215,0,0.5)' }}
        >
          WINS!
        </motion.div>
        {/* PnL badge */}
        <motion.div
          className={`mt-2 font-mono text-sm md:text-lg font-bold ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 1.3, type: 'spring' }}
          style={{ textShadow: pnl >= 0 ? '0 0 10px rgba(20,241,149,0.6)' : '0 0 10px rgba(255,68,68,0.6)' }}
        >
          PnL: {pnl >= 0 ? '+' : ''}{pnl.toFixed(1)}%
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

// ─── PHASE 3: BATTLE RESULTS ──────────────────────────────────────────────────

function StatsPhase({ winnerName, botA, botB }: {
  winnerName: string;
  botA: FightBotState;
  botB: FightBotState;
}) {
  const aIsWinner = botA.name === winnerName;
  const winner = aIsWinner ? botA : botB;
  const loser = aIsWinner ? botB : botA;

  return (
    <motion.div
      className="absolute inset-0 z-40 flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.4 } }}
      transition={{ duration: 0.5 }}
    >
      <motion.div
        className="bg-black/80 backdrop-blur-md rounded-xl border border-yellow-500/30 p-4 md:p-6 max-w-[90%] w-[340px] md:w-[400px]"
        initial={{ scale: 0.8, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: 'spring', damping: 20 }}
        style={{ boxShadow: '0 0 40px rgba(255,215,0,0.15), 0 0 80px rgba(153,69,255,0.1)' }}
      >
        {/* Title */}
        <motion.div className="text-center mb-3 md:mb-4">
          <span className="text-2xl md:text-3xl">🏆</span>
          <div
            className="font-orbitron text-lg md:text-xl font-black mt-1"
            style={{ color: winner.color, textShadow: `0 0 15px ${winner.glowColor}80` }}
          >
            {winnerName} WINS!
          </div>
        </motion.div>

        {/* Stats grid */}
        <div className="space-y-2 md:space-y-3">
          {/* Winner row */}
          <motion.div
            className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2 border border-yellow-500/20"
            initial={{ x: -20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 0.3 }}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm">👑</span>
              <span className="font-orbitron text-xs md:text-sm font-bold" style={{ color: winner.color }}>
                {winner.name}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-[10px] md:text-xs text-gray-400">
                HP: {Math.max(0, Math.round(winner.hp))}/{winner.maxHp}
              </span>
              <span className={`font-mono text-xs md:text-sm font-bold ${(winner.pnl ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {(winner.pnl ?? 0) >= 0 ? '+' : ''}{(winner.pnl ?? 0).toFixed(1)}%
              </span>
            </div>
          </motion.div>

          {/* Loser row */}
          <motion.div
            className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2 border border-red-500/10"
            initial={{ x: 20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm">💀</span>
              <span className="font-orbitron text-xs md:text-sm font-bold text-gray-400">
                {loser.name}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-[10px] md:text-xs text-gray-500">
                HP: {Math.max(0, Math.round(loser.hp))}/{loser.maxHp}
              </span>
              <span className={`font-mono text-xs md:text-sm font-bold ${(loser.pnl ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {(loser.pnl ?? 0) >= 0 ? '+' : ''}{(loser.pnl ?? 0).toFixed(1)}%
              </span>
            </div>
          </motion.div>

          {/* Damage dealt summary */}
          <motion.div
            className="flex justify-between text-[10px] md:text-xs text-gray-500 px-1 pt-1"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.7 }}
          >
            <span>Damage dealt: <span className="text-gray-300">{Math.max(0, Math.round(loser.maxHp - loser.hp))}</span></span>
            <span>Damage dealt: <span className="text-gray-300">{Math.max(0, Math.round(winner.maxHp - winner.hp))}</span></span>
          </motion.div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── PHASE 4: TRANSITION TO NEXT MATCH ────────────────────────────────────────

function TransitionPhase({ nextMatchIn }: { nextMatchIn?: number }) {
  const [countdown, setCountdown] = useState(nextMatchIn ?? 5);

  useEffect(() => {
    if (nextMatchIn !== undefined) setCountdown(nextMatchIn);
  }, [nextMatchIn]);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [countdown]);

  return (
    <motion.div
      className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm rounded-xl"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
    >
      <motion.div
        className="text-3xl md:text-4xl mb-3"
        animate={{ scale: [1, 1.1, 1] }}
        transition={{ duration: 2, repeat: Infinity }}
      >
        ⚔️
      </motion.div>
      <motion.div
        className="font-orbitron text-base md:text-xl font-bold text-gray-300 mb-2"
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2 }}
      >
        Next match...
      </motion.div>
      {countdown > 0 && (
        <motion.div
          className="font-orbitron text-2xl md:text-4xl font-black text-yellow-400"
          key={countdown}
          initial={{ scale: 1.3, opacity: 0.5 }}
          animate={{ scale: 1, opacity: 1 }}
          style={{ textShadow: '0 0 20px rgba(255,215,0,0.5)' }}
        >
          {countdown}s
        </motion.div>
      )}
    </motion.div>
  );
}

// ─── FINISHED STATE (orchestrates all 4 phases) ──────────────────────────────

function FinishedState({ winnerName, botA, botB, nextMatchIn }: {
  winnerName: string;
  botA: FightBotState;
  botB: FightBotState;
  nextMatchIn?: number;
}) {
  const [phase, setPhase] = useState<VictoryPhase>('ko');
  const winnerSide = botA.name === winnerName ? 'left' : 'right';
  const winnerBot = botA.name === winnerName ? botA : botB;
  const loserSide = winnerSide === 'left' ? 'right' : 'left';

  // Phase timer
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(setTimeout(() => setPhase('zoom'), 2000));
    timers.push(setTimeout(() => setPhase('stats'), 8000));
    timers.push(setTimeout(() => setPhase('transition'), 12000));
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <>
      {/* Golden border glow during entire victory */}
      <GoldenBorderGlow color={winnerBot.color} />

      {/* Confetti during zoom and stats phases */}
      <AnimatePresence>
        {(phase === 'zoom' || phase === 'stats') && <ConfettiParticles />}
      </AnimatePresence>

      {/* Arena zoom transform */}
      <motion.div
        className="absolute inset-0 z-15 overflow-hidden"
        animate={
          phase === 'zoom'
            ? {
                scale: 1.6,
                x: winnerSide === 'left' ? '15%' : '-15%',
                y: '-5%',
              }
            : phase === 'stats' || phase === 'transition'
            ? { scale: 1, x: '0%', y: '0%' }
            : { scale: 1, x: '0%', y: '0%' }
        }
        transition={{
          duration: phase === 'zoom' ? 1.5 : 1.0,
          ease: [0.25, 0.1, 0.25, 1],
        }}
        style={{ transformOrigin: winnerSide === 'left' ? 'left center' : 'right center' }}
      >
        {/* HP Bars + Timer (faded in zoom) */}
        <motion.div
          className="relative z-10 flex items-start gap-1 md:gap-2 px-2 md:px-4 pt-3"
          animate={{ opacity: phase === 'zoom' ? 0 : phase === 'ko' ? 1 : 0 }}
          transition={{ duration: 0.5 }}
        >
          <HPBarFight bot={mapToBotState(botA)} side="left" aiModel={botA.ai_model} />
          <div className="flex flex-col items-center gap-1 shrink-0">
            <RoundTimer seconds={0} />
          </div>
          <HPBarFight bot={mapToBotState(botB)} side="right" aiModel={botB.ai_model} />
        </motion.div>

        {/* Bots */}
        <div className="relative z-10 flex-1 flex items-center justify-center gap-2 md:gap-8 px-4 pb-2 pt-2">
          {/* Bot A */}
          <motion.div
            animate={{
              opacity: loserSide === 'left' && phase !== 'ko' ? 0 : 1,
              filter: loserSide === 'left' && phase === 'zoom' ? 'grayscale(1) brightness(0.3)' : 'none',
            }}
            transition={{ duration: 0.8 }}
          >
            {winnerSide === 'left' && phase === 'zoom' && (
              <motion.div
                className="absolute inset-0 rounded-full pointer-events-none"
                animate={{
                  boxShadow: [
                    `0 0 20px ${winnerBot.glowColor}60, 0 0 40px ${winnerBot.glowColor}30`,
                    `0 0 40px ${winnerBot.glowColor}90, 0 0 80px ${winnerBot.glowColor}50`,
                    `0 0 20px ${winnerBot.glowColor}60, 0 0 40px ${winnerBot.glowColor}30`,
                  ],
                }}
                transition={{ duration: 1.5, repeat: Infinity }}
              />
            )}
            <motion.div
              animate={winnerSide === 'left' && phase === 'zoom' ? { rotate: [-2, 2, -2] } : {}}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
            >
              <BotFighter bot={mapToBotState(botA)} side="left" isShaking={false} opponentHp={botB.hp} botId={botA.id} opponentBotId={botB.id} />
            </motion.div>
          </motion.div>
          <motion.div
            className="mb-12 md:mb-16"
            animate={{ opacity: 0, scale: 0 }}
            transition={{ duration: 0.3 }}
          >
            {/* VS removed from KO phase — only kept between bots in fighting state */}
          </motion.div>
          {/* Bot B */}
          <motion.div
            animate={{
              opacity: loserSide === 'right' && phase !== 'ko' ? 0 : 1,
              filter: loserSide === 'right' && phase === 'zoom' ? 'grayscale(1) brightness(0.3)' : 'none',
            }}
            transition={{ duration: 0.8 }}
          >
            {winnerSide === 'right' && phase === 'zoom' && (
              <motion.div
                className="absolute inset-0 rounded-full pointer-events-none"
                animate={{
                  boxShadow: [
                    `0 0 20px ${winnerBot.glowColor}60, 0 0 40px ${winnerBot.glowColor}30`,
                    `0 0 40px ${winnerBot.glowColor}90, 0 0 80px ${winnerBot.glowColor}50`,
                    `0 0 20px ${winnerBot.glowColor}60, 0 0 40px ${winnerBot.glowColor}30`,
                  ],
                }}
                transition={{ duration: 1.5, repeat: Infinity }}
              />
            )}
            <motion.div
              animate={winnerSide === 'right' && phase === 'zoom' ? { rotate: [-2, 2, -2] } : {}}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
            >
              <BotFighter bot={mapToBotState(botB)} side="right" isShaking={false} opponentHp={botA.hp} botId={botB.id} opponentBotId={botA.id} />
            </motion.div>
          </motion.div>
        </div>
      </motion.div>

      {/* Phase overlays */}
      <AnimatePresence mode="wait">
        {phase === 'ko' && <KOPhase key="ko" />}
        {phase === 'zoom' && (
          <ZoomPhase key="zoom" winnerName={winnerName} winnerBot={winnerBot} winnerSide={winnerSide} />
        )}
        {phase === 'stats' && (
          <StatsPhase key="stats" winnerName={winnerName} botA={botA} botB={botB} />
        )}
        {phase === 'transition' && (
          <TransitionPhase key="transition" nextMatchIn={nextMatchIn} />
        )}
      </AnimatePresence>
    </>
  );
}

// ─── HELPER: Map FightBotState to full BotState ──────────────────────────────

function mapToBotState(bot: FightBotState, stateOverride?: 'idle' | 'attack' | 'hurt' | 'critical'): BotState {
  return {
    name: bot.name,
    hp: bot.hp ?? 0,
    maxHp: bot.maxHp || 1000,
    color: bot.color,
    glowColor: bot.glowColor,
    comboCount: 0,
    state: stateOverride || 'idle',
    totalPnl: bot.pnl ?? 0,
    nfa_id: bot.nfa_id,
  };
}

// ─── BETTING PHASE VIEW ───────────────────────────────────────────────────────

function BettingBotCard({ bot, side, delay, opponentBotId }: { bot: FightBotState; side: 'left' | 'right'; delay: number; opponentBotId?: number }) {
  const borderColor = side === 'left' ? 'border-[#9945FF]/40' : 'border-[#14F195]/40';
  const glowShadow = side === 'left'
    ? '0 0 20px rgba(153,69,255,0.15), 0 0 40px rgba(153,69,255,0.05)'
    : '0 0 20px rgba(20,241,149,0.15), 0 0 40px rgba(20,241,149,0.05)';
  const accentColor = side === 'left' ? '#9945FF' : '#14F195';

  return (
    <motion.div
      className={`flex-1 min-w-0 max-w-[200px] md:max-w-[220px] rounded-xl border ${borderColor} bg-black/50 backdrop-blur-md overflow-hidden`}
      style={{ boxShadow: glowShadow }}
      initial={{ opacity: 0, x: side === 'left' ? -40 : 40, scale: 0.9 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      transition={{ delay, duration: 0.5, type: 'spring', damping: 20 }}
    >
      {/* Robot sprite area */}
      <div className="relative flex items-center justify-center pt-3 pb-1 px-2">
        <motion.div
          animate={{ y: [0, -4, 0] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut', delay: side === 'left' ? 0 : 0.5 }}
        >
          <BotFighter
            bot={mapToBotState(bot)}
            side={side}
            isShaking={false}
            opponentHp={1000}
            botId={bot.id}
            opponentBotId={opponentBotId}
          />
        </motion.div>
      </div>

      {/* Bot info */}
      <div className="px-3 pb-3 text-center space-y-1">
        {/* Name */}
        <motion.div
          className="font-orbitron text-xs md:text-sm font-bold tracking-wide truncate"
          style={{ color: bot.color, textShadow: `0 0 10px ${bot.glowColor}` }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: delay + 0.2 }}
        >
          {bot.name}
        </motion.div>
        {bot.nfa_id != null && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: delay + 0.25 }}>
            <a href={`/nfa/${bot.nfa_id}/reputation`} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-cyan-500/15 border border-cyan-500/30 text-[9px] text-cyan-400 hover:bg-cyan-500/25 transition-colors font-mono" title="Blockchain Agent">
              🔗 NFA #{bot.nfa_id}
            </a>
          </motion.div>
        )}

        {/* AI Model */}
        {bot.ai_model && (
          <motion.div
            className="flex items-center justify-center gap-1"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: delay + 0.3 }}
          >
            <span className="text-[10px]">🤖</span>
            <span className="text-[10px] md:text-xs text-gray-400 font-mono truncate">
              {bot.ai_model}
            </span>
          </motion.div>
        )}

        {/* Trading style */}
        {bot.trading_style && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: delay + 0.35 }}
          >
            <span
              className="inline-block px-2 py-0.5 rounded-full text-[9px] md:text-[10px] font-mono font-semibold uppercase tracking-wider border"
              style={{
                color: accentColor,
                borderColor: `${accentColor}40`,
                backgroundColor: `${accentColor}10`,
              }}
            >
              {bot.trading_style}
            </span>
          </motion.div>
        )}

        {/* ELO */}
        {bot.elo && (
          <motion.div
            className="flex items-center justify-center gap-1"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: delay + 0.4 }}
          >
            <span className="text-[10px]">⭐</span>
            <span className="text-[10px] md:text-xs text-yellow-500/80 font-mono font-semibold">
              ELO {bot.elo}
            </span>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

function BettingCountdown({ bettingEndsAt, fallbackSeconds }: { bettingEndsAt?: number; fallbackSeconds: number }) {
  const [seconds, setSeconds] = useState(() => {
    if (bettingEndsAt) {
      return Math.max(0, Math.ceil((bettingEndsAt - Date.now()) / 1000));
    }
    return fallbackSeconds;
  });

  useEffect(() => {
    const tick = () => {
      if (bettingEndsAt) {
        setSeconds(Math.max(0, Math.ceil((bettingEndsAt - Date.now()) / 1000)));
      } else {
        setSeconds(s => Math.max(0, s - 1));
      }
    };
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [bettingEndsAt]);

  const isUrgent = seconds <= 10;

  return (
    <motion.div
      className="text-center"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.6 }}
    >
      <div className="text-[9px] md:text-[10px] text-gray-500 uppercase tracking-widest font-mono mb-0.5">
        Match starts in
      </div>
      <motion.div
        className={`font-orbitron font-black text-2xl md:text-4xl ${isUrgent ? 'text-red-400' : 'text-yellow-400'}`}
        animate={isUrgent ? { scale: [1, 1.12, 1] } : {}}
        transition={isUrgent ? { duration: 0.5, repeat: Infinity } : {}}
        style={{
          textShadow: isUrgent
            ? '0 0 20px rgba(255,60,60,0.6), 0 0 40px rgba(255,60,60,0.3)'
            : '0 0 20px rgba(255,215,0,0.5), 0 0 40px rgba(255,215,0,0.2)',
        }}
      >
        {seconds}s
      </motion.div>
    </motion.div>
  );
}

function BettingPhaseView({ botA, botB, token, bettingEndsAt, timeLeft }: {
  botA: FightBotState;
  botB: FightBotState;
  token?: string;
  bettingEndsAt?: number;
  timeLeft: number;
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center z-20 px-3 pt-3 md:pt-4 justify-start overflow-y-auto">
      {/* Header */}
      <motion.div
        className="text-center mb-3 md:mb-4 mt-1"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <motion.div
          className="font-orbitron text-lg md:text-2xl font-black tracking-wider"
          animate={{
            textShadow: [
              '0 0 20px rgba(153,69,255,0.6), 0 0 40px rgba(20,241,149,0.3)',
              '0 0 30px rgba(153,69,255,0.8), 0 0 60px rgba(20,241,149,0.5)',
              '0 0 20px rgba(153,69,255,0.6), 0 0 40px rgba(20,241,149,0.3)',
            ],
          }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          style={{
            background: 'linear-gradient(90deg, #9945FF, #14F195)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          ⚔️ CHOOSE YOUR FIGHTER
        </motion.div>
      </motion.div>

      {/* Token badge */}
      {token && (
        <motion.div
          className="mb-3 md:mb-4"
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3, type: 'spring' }}
        >
          <div className="flex items-center gap-2 px-4 py-1.5 rounded-full border border-yellow-500/40 bg-yellow-500/10 backdrop-blur-sm">
            <span className="text-base">🪙</span>
            <span
              className="font-orbitron text-sm md:text-lg font-black tracking-wider text-yellow-400"
              style={{ textShadow: '0 0 12px rgba(255,215,0,0.6)' }}
            >
              ${token}
            </span>
          </div>
        </motion.div>
      )}

      {/* Bot cards + VS */}
      <div className="flex items-center justify-center gap-2 md:gap-4 w-full max-w-[520px]">
        <BettingBotCard bot={botA} side="left" delay={0.1} opponentBotId={botB.id} />

        {/* VS badge */}
        <motion.div
          className="shrink-0"
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.25, type: 'spring', damping: 12 }}
        >
          <VSBadge />
        </motion.div>

        <BettingBotCard bot={botB} side="right" delay={0.15} opponentBotId={botA.id} />
      </div>

      {/* Countdown */}
      <div className="mt-3 md:mt-4">
        <BettingCountdown bettingEndsAt={bettingEndsAt} fallbackSeconds={timeLeft} />
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

let popupIdCounter = 0;

export default function LiveFightView({ botA, botB, status, timeLeft, winnerName, nextMatchIn, token, bettingEndsAt }: LiveFightViewProps) {
  const hasBots = botA && botB;

  // Track previous HP for hit detection
  const prevHpA = useRef<number | null>(null);
  const prevHpB = useRef<number | null>(null);

  // Animation states
  const [stateA, setStateA] = useState<'idle' | 'attack' | 'hurt' | 'critical'>('idle');
  const [stateB, setStateB] = useState<'idle' | 'attack' | 'hurt' | 'critical'>('idle');
  const [screenShake, setScreenShake] = useState(false);
  const [fightFlash, setFightFlash] = useState(false);
  const [flashColor, setFlashColor] = useState('#ffffff');
  const [damagePopups, setDamagePopups] = useState<DamagePopupData[]>([]);

  // Trade animation states
  const [tradeFlashA, setTradeFlashA] = useState<TradeFlashData | null>(null);
  const [tradeFlashB, setTradeFlashB] = useState<TradeFlashData | null>(null);
  const [pnlPulseA, setPnlPulseA] = useState<number | null>(null);
  const [pnlPulseB, setPnlPulseB] = useState<number | null>(null);
  const prevTradeA = useRef<string | null>(null);
  const prevTradeB = useRef<string | null>(null);

  // Timers ref for cleanup
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(t => clearTimeout(t));
    timersRef.current = [];
  }, []);

  // Detect HP changes and trigger animations
  useEffect(() => {
    if (!botA || !botB || status !== 'fighting') {
      prevHpA.current = botA?.hp ?? null;
      prevHpB.current = botB?.hp ?? null;
      return;
    }

    const hpA = botA.hp;
    const hpB = botB.hp;
    const oldHpA = prevHpA.current;
    const oldHpB = prevHpB.current;

    // Skip first render (no previous data)
    if (oldHpA === null || oldHpB === null) {
      prevHpA.current = hpA;
      prevHpB.current = hpB;
      return;
    }

    const damageToA = oldHpA - hpA; // positive = A took damage
    const damageToB = oldHpB - hpB; // positive = B took damage

    const newPopups: DamagePopupData[] = [];

    // Bot A took damage → A is hurt, B attacked
    if (damageToA > 2) {
      const isCrit = damageToA > 100;
      setStateA(isCrit ? 'critical' : 'hurt');
      setStateB('attack');

      newPopups.push({
        id: ++popupIdCounter,
        x: 60 + Math.random() * 40, // left side area
        y: 60 + Math.random() * 40,
        value: -Math.round(damageToA),
        isCritical: isCrit,
        bot: 'A',
      });

      if (damageToA > 80) {
        setScreenShake(true);
        const t1 = setTimeout(() => setScreenShake(false), 300);
        timersRef.current.push(t1);
      }
      if (isCrit) {
        setFlashColor('#FF4444');
        setFightFlash(true);
        const t2 = setTimeout(() => setFightFlash(false), 350);
        timersRef.current.push(t2);
      }

      const t3 = setTimeout(() => {
        setStateA('idle');
        setStateB('idle');
      }, 500);
      timersRef.current.push(t3);
    }

    // Bot B took damage → B is hurt, A attacked
    if (damageToB > 2) {
      const isCrit = damageToB > 100;
      setStateB(isCrit ? 'critical' : 'hurt');
      setStateA('attack');

      newPopups.push({
        id: ++popupIdCounter,
        x: 200 + Math.random() * 40, // right side area
        y: 60 + Math.random() * 40,
        value: -Math.round(damageToB),
        isCritical: isCrit,
        bot: 'B',
      });

      if (damageToB > 80) {
        setScreenShake(true);
        const t4 = setTimeout(() => setScreenShake(false), 300);
        timersRef.current.push(t4);
      }
      if (isCrit) {
        setFlashColor('#9945FF');
        setFightFlash(true);
        const t5 = setTimeout(() => setFightFlash(false), 350);
        timersRef.current.push(t5);
      }

      const t6 = setTimeout(() => {
        setStateA('idle');
        setStateB('idle');
      }, 500);
      timersRef.current.push(t6);
    }

    if (newPopups.length > 0) {
      setDamagePopups(prev => [...prev, ...newPopups].slice(-8));
      // Clean up old popups after animation
      const t7 = setTimeout(() => {
        setDamagePopups(prev => prev.filter(p => !newPopups.find(np => np.id === p.id)));
      }, 1200);
      timersRef.current.push(t7);
    }

    prevHpA.current = hpA;
    prevHpB.current = hpB;
  }, [botA?.hp, botB?.hp, status, botA, botB, clearTimers]);

  // Detect trade changes and trigger flash animations
  useEffect(() => {
    if (!botA || !botB || status !== 'fighting') return;

    // Bot A trade detection
    const tradeKeyA = botA.lastTrade
      ? `${botA.lastTrade.action}-${botA.lastTrade.side}-${botA.lastTrade.pnl}-${botA.lastTrade.size}`
      : null;
    if (tradeKeyA && tradeKeyA !== prevTradeA.current && botA.lastTrade?.action && botA.lastTrade.action !== 'HOLD') {
      const flash: TradeFlashData = {
        id: ++tradeFlashIdCounter,
        action: botA.lastTrade.action || 'OPEN',
        side: botA.lastTrade.side || 'LONG',
        pnl: botA.lastTrade.pnl || 0,
        size: botA.lastTrade.size || 0,
      };
      setTradeFlashA(flash);
      const t = setTimeout(() => setTradeFlashA(null), 2500);
      timersRef.current.push(t);

      // PnL pulse on CLOSE
      if (botA.lastTrade.action === 'CLOSE' && botA.lastTrade.pnl !== undefined) {
        setPnlPulseA(botA.lastTrade.pnl);
        const t2 = setTimeout(() => setPnlPulseA(null), 1200);
        timersRef.current.push(t2);
      }
    }
    prevTradeA.current = tradeKeyA;

    // Bot B trade detection
    const tradeKeyB = botB.lastTrade
      ? `${botB.lastTrade.action}-${botB.lastTrade.side}-${botB.lastTrade.pnl}-${botB.lastTrade.size}`
      : null;
    if (tradeKeyB && tradeKeyB !== prevTradeB.current && botB.lastTrade?.action && botB.lastTrade.action !== 'HOLD') {
      const flash: TradeFlashData = {
        id: ++tradeFlashIdCounter,
        action: botB.lastTrade.action || 'OPEN',
        side: botB.lastTrade.side || 'LONG',
        pnl: botB.lastTrade.pnl || 0,
        size: botB.lastTrade.size || 0,
      };
      setTradeFlashB(flash);
      const t = setTimeout(() => setTradeFlashB(null), 2500);
      timersRef.current.push(t);

      // PnL pulse on CLOSE
      if (botB.lastTrade.action === 'CLOSE' && botB.lastTrade.pnl !== undefined) {
        setPnlPulseB(botB.lastTrade.pnl);
        const t2 = setTimeout(() => setPnlPulseB(null), 1200);
        timersRef.current.push(t2);
      }
    }
    prevTradeB.current = tradeKeyB;
  }, [botA?.lastTrade, botB?.lastTrade, botA, botB, status]);

  // Cleanup on unmount
  useEffect(() => clearTimers, [clearTimers]);

  const fullBotA = useMemo(() => botA ? mapToBotState(botA, stateA) : null, [botA, stateA]);
  const fullBotB = useMemo(() => botB ? mapToBotState(botB, stateB) : null, [botB, stateB]);

  return (
    <motion.div
      className="relative w-full h-full min-h-[400px] md:min-h-[400px] max-h-[500px] md:max-h-[500px] rounded-xl overflow-hidden border border-white/5"
      animate={screenShake ? { x: [0, -6, 6, -4, 4, -2, 2, 0] } : { x: 0 }}
      transition={{ duration: 0.3 }}
    >
      <ArenaBackground />

      {/* Fight Flash overlay */}
      <FightFlash active={fightFlash} color={flashColor} />

      {/* Damage Popups */}
      <AnimatePresence>
        {damagePopups.map(popup => (
          <DamagePopup key={popup.id} popup={popup} />
        ))}
      </AnimatePresence>

      {/* Fight content */}
      {hasBots && fullBotA && fullBotB && status === 'fighting' && (
        <>
          {/* HP Bars + Timer + Token + Position Badges */}
          <div className="relative z-10 flex items-end gap-1 md:gap-2 px-2 md:px-4 pt-3">
            <div className="relative flex-1 min-w-0 pb-5">
              <HPBarFight bot={fullBotA} side="left" aiModel={botA?.ai_model} />
              <AnimatePresence mode="wait">
                {botA?.position && (
                  <div className="absolute left-0 -bottom-0.5 z-20">
                    <PositionBadge key={`posA-${botA.position}`} position={botA.position} side="left" />
                  </div>
                )}
              </AnimatePresence>
            </div>
            <div className="flex flex-col items-center gap-1 shrink-0 pb-5">
              <RoundTimer seconds={timeLeft} />
              {token && <TokenBadge token={token} />}
            </div>
            <div className="relative flex-1 min-w-0 pb-5">
              <HPBarFight bot={fullBotB} side="right" aiModel={botB?.ai_model} />
              <AnimatePresence mode="wait">
                {botB?.position && (
                  <div className="absolute right-0 -bottom-0.5 z-20">
                    <PositionBadge key={`posB-${botB.position}`} position={botB.position} side="right" />
                  </div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Token Price Chart — between HP bars and bots */}
          {token && (
            <div className="relative z-10 px-3 md:px-6 -mt-1">
              <TokenPriceChart token={token} />
            </div>
          )}

          {/* PnL Pulse Effects */}
          <AnimatePresence>
            {pnlPulseA !== null && <PnlPulse key={`pulseA-${Date.now()}`} pnl={pnlPulseA} side="left" />}
            {pnlPulseB !== null && <PnlPulse key={`pulseB-${Date.now()}`} pnl={pnlPulseB} side="right" />}
          </AnimatePresence>

          {/* Trade Flash Popups */}
          <AnimatePresence>
            {tradeFlashA && <TradeFlashPopup key={`flashA-${tradeFlashA.id}`} flash={tradeFlashA} side="left" />}
            {tradeFlashB && <TradeFlashPopup key={`flashB-${tradeFlashB.id}`} flash={tradeFlashB} side="right" />}
          </AnimatePresence>

          {/* Bots in arena */}
          <div className="relative z-10 flex-1 flex items-end justify-center gap-2 md:gap-8 px-4 pb-4 md:pb-6">
            <BotFighter bot={fullBotA} side="left" isShaking={stateA === 'hurt' || stateA === 'critical'} opponentHp={fullBotB.hp} botId={botA?.id} opponentBotId={botB?.id} />
            <div className="mb-8 md:mb-12">
              <VSBadge />
            </div>
            <BotFighter bot={fullBotB} side="right" isShaking={stateB === 'hurt' || stateB === 'critical'} opponentHp={fullBotA.hp} botId={botB?.id} opponentBotId={botA?.id} />
          </div>
        </>
      )}

      {/* Waiting state */}
      {(status === 'waiting' || !hasBots) && (
        <WaitingState nextMatchIn={nextMatchIn} />
      )}

      {/* Betting state — show bot cards, VS, token, countdown */}
      {status === 'betting' && hasBots && botA && botB && (
        <BettingPhaseView
          botA={botA}
          botB={botB}
          token={token}
          bettingEndsAt={bettingEndsAt}
          timeLeft={timeLeft}
        />
      )}

      {/* Finished state — FinishedState renders bots internally with zoom */}
      {status === 'finished' && winnerName && hasBots && botA && botB && (
        <FinishedState winnerName={winnerName} botA={botA} botB={botB} nextMatchIn={nextMatchIn} />
      )}
    </motion.div>
  );
}
