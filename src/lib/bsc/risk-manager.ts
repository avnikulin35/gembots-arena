/**
 * Risk Manager for NFA Live Trading
 *
 * Checks all risk constraints before allowing a trade:
 * - Max position size (% of portfolio)
 * - Daily loss limit (%)
 * - Max trades per day
 * - Minimum BNB gas reserve
 *
 * Circuit breaker: auto-switches bot from live → paper when daily loss exceeded.
 * Logs all rejected trades with reason.
 */

import { createClient } from '@supabase/supabase-js';
import { MIN_GAS_RESERVE_BNB } from '@/lib/bsc/pancakeswap';
import { ethers } from 'ethers';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl) {
  throw new Error('SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) is required for risk manager startup');
}

if (!supabaseServiceRoleKey) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY (or legacy SUPABASE_SERVICE_KEY) is required for risk manager startup');
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RiskCheckResult {
  allowed: boolean;
  reason?: string;
  details: {
    maxPositionUsd: number;
    currentPortfolioUsd: number;
    dailyPnlUsd: number;
    dailyTradesCount: number;
    bnbBalance: string;
    hasMinGas: boolean;
  };
}

export interface RejectedTradeLog {
  nfaId: number;
  botId: number;
  action: string;
  pair: string;
  amountUsd: number;
  reason: string;
  dailyPnlUsd: number;
  dailyTradesCount: number;
}

// ─── Config Defaults ─────────────────────────────────────────────────────────

const DEFAULT_MAX_POSITION_PCT = 25;     // % of portfolio per trade
const DEFAULT_MAX_DAILY_LOSS_PCT = 10;   // % daily loss before circuit breaker
const DEFAULT_MAX_TRADES_PER_DAY = 50;   // max trades/day

// ─── Helper: fetch today's trades ─────────────────────────────────────────────

async function getTodayTrades(nfaId: number, botId: number) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString();

  const { data, error } = await supabase
    .from('nfa_trades')
    .select('amount_in, amount_out, status, error_message, created_at, action, price_at_entry')
    .eq('nfa_id', nfaId)
    .gte('created_at', todayISO)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[RiskManager] Failed to fetch today trades:', error.message);
    return [];
  }
  return data || [];
}

// ─── Helper: get portfolio value ──────────────────────────────────────────────

async function getPortfolioValue(nfaId: number): Promise<number> {
  const { data, error } = await supabase
    .from('nfa_trading_stats')
    .select('paper_balance_usd, live_balance_usd, total_pnl')
    .eq('nfa_id', nfaId)
    .single();

  if (error || !data) {
    // default portfolio value if stats don't exist yet
    return 10000;
  }
  // For live mode, use live_balance_usd if available, else paper_balance as estimate
  const base = (data as any).live_balance_usd || (data as any).paper_balance_usd || 10000;
  const pnl = (data as any).total_pnl || 0;
  return Number(base) + Number(pnl);
}

// ─── Helper: get bot trading config ──────────────────────────────────────────

async function getBotConfig(botId: number): Promise<{
  max_position_pct: number;
  max_daily_loss_pct: number;
  max_trades_per_day: number;
}> {
  const { data, error } = await supabase
    .from('bots')
    .select('trading_config')
    .eq('id', botId)
    .single();

  if (error || !data) {
    return {
      max_position_pct: DEFAULT_MAX_POSITION_PCT,
      max_daily_loss_pct: DEFAULT_MAX_DAILY_LOSS_PCT,
      max_trades_per_day: DEFAULT_MAX_TRADES_PER_DAY,
    };
  }

  const cfg = (data as any).trading_config || {};
  return {
    max_position_pct: cfg.max_position_pct ?? DEFAULT_MAX_POSITION_PCT,
    max_daily_loss_pct: cfg.max_daily_loss_pct ?? DEFAULT_MAX_DAILY_LOSS_PCT,
    max_trades_per_day: cfg.max_trades_per_day ?? DEFAULT_MAX_TRADES_PER_DAY,
  };
}

// ─── Helper: log rejected trade ──────────────────────────────────────────────

async function logRejectedTrade(log: RejectedTradeLog) {
  try {
    const { error } = await supabase
      .from('nfa_trades')
      .insert({
        nfa_id: log.nfaId,
        bot_id: log.botId,
        action: 'REJECTED',
        token_in: log.pair,
        token_out: '',
        amount_in: log.amountUsd,
        amount_out: 0,
        price_at_entry: 0,
        tx_hash: null,
        gas_used: 0,
        gas_cost_bnb: 0,
        status: 'rejected',
        error_message: log.reason,
        created_at: new Date().toISOString(),
      });
    if (error) {
      console.error('[RiskManager] Failed to log rejected trade:', error.message);
    }
  } catch {
    // swallow — logging should never block the pipeline
  }
}

// ─── Helper: get BNB balance ─────────────────────────────────────────────────

async function getBotBnbBalance(walletAddress: string): Promise<{
  bnbBalance: string;
  hasMinGas: boolean;
}> {
  const { ethers: ethersModule } = await import('ethers');
  const rpcUrl = process.env.NEXT_PUBLIC_BSC_RPC || 'https://bsc-dataseed.binance.org/';
  const provider = new ethersModule.JsonRpcProvider(rpcUrl, 56);

  const balance = await provider.getBalance(walletAddress);
  return {
    bnbBalance: ethersModule.formatEther(balance),
    hasMinGas: balance >= ethersModule.parseEther(String(MIN_GAS_RESERVE_BNB)),
  };
}

// ─── Main Risk Check ─────────────────────────────────────────────────────────

/**
 * Check if a trade is allowed for an NFA bot.
 * Returns { allowed: true } or { allowed: false, reason: '...' }
 */
export async function canTrade(
  nfaId: number,
  botId: number,
  tradeAmountUsd: number,
  walletAddress: string,
): Promise<RiskCheckResult> {
  const [config, portfolio, todayTrades, gasInfo] = await Promise.all([
    getBotConfig(botId),
    getPortfolioValue(nfaId),
    getTodayTrades(nfaId, botId),
    getBotBnbBalance(walletAddress),
  ]);

  // Calculate today's P&L
  let dailyPnlUsd = 0;
  for (const t of todayTrades) {
    const amt = Number((t as any).amount_in) || 0;
    if ((t as any).status === 'confirmed' || (t as any).status === 'closed') {
      // Simple P&L from amount difference (approximate for BNB-denominated trades)
      dailyPnlUsd += Number((t as any).amount_out || 0) - amt;
    }
  }

  const details = {
    maxPositionUsd: Math.round((portfolio * config.max_position_pct) / 100 * 100) / 100,
    currentPortfolioUsd: portfolio,
    dailyPnlUsd: Math.round(dailyPnlUsd * 100) / 100,
    dailyTradesCount: todayTrades.length,
    bnbBalance: gasInfo.bnbBalance,
    hasMinGas: gasInfo.hasMinGas,
  };

  // 1. Max position size check
  if (tradeAmountUsd > details.maxPositionUsd) {
    const reason = `Position size $${tradeAmountUsd} exceeds max $${details.maxPositionUsd} (${config.max_position_pct}% of $${details.currentPortfolioUsd} portfolio)`;
    console.warn(`[RiskManager] REJECTED: ${reason}`);
    await logRejectedTrade({
      nfaId, botId, action: 'BUY', pair: 'N/A', amountUsd: tradeAmountUsd,
      reason, dailyPnlUsd: details.dailyPnlUsd, dailyTradesCount: details.dailyTradesCount,
    });
    return { allowed: false, reason, details };
  }

  // 2. Daily loss limit check
  const maxDailyLossUsd = (portfolio * config.max_daily_loss_pct) / 100;
  if (dailyPnlUsd < -maxDailyLossUsd) {
    const reason = `Daily P&L ($${dailyPnlUsd}) exceeds max loss ($-${maxDailyLossUsd}) — circuit breaker triggered`;
    console.warn(`[RiskManager] CIRCUIT BREAKER: ${reason}`);
    await logRejectedTrade({
      nfaId, botId, action: 'BUY', pair: 'N/A', amountUsd: tradeAmountUsd,
      reason, dailyPnlUsd: details.dailyPnlUsd, dailyTradesCount: details.dailyTradesCount,
    });

    // Circuit breaker: switch to paper mode
    try {
      await supabase
        .from('bots')
        .update({ trading_mode: 'paper' })
        .eq('id', botId);
      console.log(`[RiskManager] Circuit breaker: switched bot ${botId} to paper mode`);
    } catch {
      console.error('[RiskManager] Failed to switch to paper mode');
    }

    return { allowed: false, reason, details };
  }

  // 3. Max trades per day check
  if (todayTrades.length >= config.max_trades_per_day) {
    const reason = `Daily trade limit reached: ${todayTrades.length}/${config.max_trades_per_day}`;
    console.warn(`[RiskManager] REJECTED: ${reason}`);
    await logRejectedTrade({
      nfaId, botId, action: 'BUY', pair: 'N/A', amountUsd: tradeAmountUsd,
      reason, dailyPnlUsd: details.dailyPnlUsd, dailyTradesCount: details.dailyTradesCount,
    });
    return { allowed: false, reason, details };
  }

  // 4. Minimum BNB gas check
  if (!gasInfo.hasMinGas) {
    const reason = `Insufficient BNB for gas: ${gasInfo.bnbBalance} (minimum ${MIN_GAS_RESERVE_BNB})`;
    console.warn(`[RiskManager] REJECTED: ${reason}`);
    await logRejectedTrade({
      nfaId, botId, action: 'BUY', pair: 'N/A', amountUsd: tradeAmountUsd,
      reason, dailyPnlUsd: details.dailyPnlUsd, dailyTradesCount: details.dailyTradesCount,
    });
    return { allowed: false, reason, details };
  }

  return { allowed: true, details };
}

// ─── Circuit breaker manual trigger ──────────────────────────────────────────

/**
 * Manually trigger the circuit breaker — switch bot from live to paper mode
 */
export async function triggerCircuitBreaker(
  botId: number,
  nfaId: number,
  reason: string,
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('bots')
      .update({ trading_mode: 'paper' })
      .eq('id', botId);

    if (error) throw error;

    console.log(`[RiskManager] Circuit breaker activated for bot ${botId} (NFA #${nfaId}): ${reason}`);

    // Log the circuit breaker event
    await logRejectedTrade({
      nfaId, botId, action: 'CIRCUIT_BREAKER', pair: 'N/A', amountUsd: 0,
      reason: `Circuit breaker: ${reason}`, dailyPnlUsd: 0, dailyTradesCount: 0,
    });

    return true;
  } catch (err: any) {
    console.error('[RiskManager] Failed to trigger circuit breaker:', err.message);
    return false;
  }
}
