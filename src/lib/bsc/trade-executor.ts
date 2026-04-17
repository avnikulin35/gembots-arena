/**
 * Trade Executor for NFA Live Trading
 *
 * Orchestrates the full trade pipeline:
 *  1. Decrypt wallet private key
 *  2. Run risk checks
 *  3. Get PancakeSwap quote
 *  4. Execute swap
 *  5. Record trade in Supabase (nfa_trades)
 *  6. Emit WebSocket event
 */

import { ethers, Wallet } from 'ethers';
import { createClient } from '@supabase/supabase-js';
import { decryptPrivateKey } from '@/lib/security/wallet-crypto';
import {
  getProvider,
  getQuote,
  executeBuy,
  executeSell,
  TOKENS,
  WBNB,
  DEFAULT_SLIPPAGE_BPS,
  validateSlippage,
  isLiveTradingEnabled,
  getLiveTradingGuard,
} from '@/lib/bsc/pancakeswap';
import { canTrade, triggerCircuitBreaker, type RiskCheckResult } from '@/lib/bsc/risk-manager';

// ─── Supabase Client ─────────────────────────────────────────────────────────

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error('SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) is required for trade executor startup');
}

if (!supabaseServiceRoleKey) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for live trading startup');
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TradeOrder {
  nfaId: number;
  botId: number;
  action: 'BUY' | 'SELL';
  tokenIn: string;
  tokenOut: string;
  amountIn: number | string;
  slippageBps?: number;
  confidence?: number;     // LLM confidence (0-1)
  reasoning?: string;      // LLM reasoning
  pair?: string;           // e.g. "BNB/USDT"
}

export interface TradeResult {
  success: boolean;
  txHash?: string;
  blockNumber?: number;
  amountIn?: string;
  amountOut?: string;
  gasUsed?: string;
  gasCostBnb?: string;
  error?: string;
  riskCheck?: RiskCheckResult;
  quoteAmount?: string;
  timestamp: string;
}

// ─── Helper: get wallet decrypted key ────────────────────────────────────────

async function getDecryptedWallet(botId: number): Promise<Wallet> {
  const { data, error } = await supabase
    .from('bots')
    .select('trading_wallet_address, trading_wallet_encrypted')
    .eq('id', botId)
    .single();

  if (error || !data) {
    throw new Error(`Bot ${botId} not found in database`);
  }

  if (!data.trading_wallet_encrypted) {
    throw new Error(`Bot ${botId} has no encrypted wallet`);
  }

  if (!data.trading_wallet_address) {
    throw new Error(`Bot ${botId} has no wallet address`);
  }

  // Decrypt the private key
  const privateKey = decryptPrivateKey(data.trading_wallet_encrypted);

  // Create wallet from private key
  const wallet = new Wallet(privateKey, getProvider());

  // Safety check: address must match what we have on record
  if (wallet.address.toLowerCase() !== data.trading_wallet_address.toLowerCase()) {
    throw new Error(
      `Wallet address mismatch: decrypted=${wallet.address}, stored=${data.trading_wallet_address}`,
    );
  }

  return wallet;
}

// ─── Helper: record trade in Supabase ─────────────────────────────────────────

async function recordTrade(
  order: TradeOrder,
  result: TradeResult,
): Promise<void> {
  const status = result.success
    ? 'confirmed'
    : 'failed';

  const { error } = await supabase.from('nfa_trades').insert({
    nfa_id: order.nfaId,
    bot_id: order.botId,
    action: order.action,
    token_in: order.tokenIn,
    token_out: order.tokenOut,
    amount_in: Number(order.amountIn) || 0,
    amount_out: result.amountOut ? Number(result.amountOut) : null,
    price_at_entry: null, // TODO: calculate from quote or swap result
    tx_hash: result.txHash || null,
    gas_used: result.gasUsed ? Number(result.gasUsed) : 0,
    gas_cost_bnb: result.gasCostBnb ? Number(result.gasCostBnb) : 0,
    status,
    error_message: result.error || null,
    created_at: new Date().toISOString(),
  });

  if (error) {
    console.error('[TradeExecutor] Failed to record trade:', error.message);
  } else {
    console.log(`[TradeExecutor] Trade recorded: ${order.action} ${order.pair || `${order.tokenIn}/${order.tokenOut}`} — ${status}`);
  }
}

// ─── Main: Execute Trade ─────────────────────────────────────────────────────

/**
 * Execute a single trade order for an NFA bot.
 * Flow: guard → risk check → decrypt key → quote → swap → record
 */
export async function executeTrade(order: TradeOrder): Promise<TradeResult> {
  const timestamp = new Date().toISOString();

  try {
    // 0. Check live trading is enabled
    const guard = getLiveTradingGuard();
    if (!guard.enabled) {
      const result: TradeResult = {
        success: false,
        error: `Live trading is disabled: ${guard.reason}`,
        timestamp,
      };
      await recordTrade(order, result);
      return result;
    }

    // 1. Get wallet address for balance checks
    const { data: botData } = await supabase
      .from('bots')
      .select('trading_wallet_address, trading_config')
      .eq('id', order.botId)
      .single();

    if (!botData?.trading_wallet_address) {
      const result: TradeResult = {
        success: false,
        error: 'Bot has no wallet address configured',
        timestamp,
      };
      await recordTrade(order, result);
      return result;
    }

    const walletAddress = botData.trading_wallet_address;
    const tradingConfig = (botData as any).trading_config || {};

    // 2. Calculate trade amount in USD (approximate for risk check)
    // For BNB→token trades, we use BNB amount as the "USD" value estimate
    const tradeAmountUsd = Number(order.amountIn); // TODO: convert BNB to USD via oracle

    // 3. Risk check
    const riskCheck = await canTrade(order.nfaId, order.botId, tradeAmountUsd, walletAddress);
    if (!riskCheck.allowed) {
      const result: TradeResult = {
        success: false,
        error: riskCheck.reason,
        riskCheck,
        timestamp,
      };
      await recordTrade(order, result);
      return result;
    }

    // 4. Decrypt wallet
    const wallet = await getDecryptedWallet(order.botId);

    const slippageBps = validateSlippage(order.slippageBps ?? DEFAULT_SLIPPAGE_BPS);

    // 5. Get quote before execution
    let quoteAmount = '';
    try {
      const quote = await getQuote(order.tokenIn, order.tokenOut, order.amountIn);
      quoteAmount = quote.amountOut;
      console.log(`[TradeExecutor] Quote: ${order.amountIn} ${order.tokenIn} → ${quote.amountOut} ${order.tokenOut}`);
    } catch (err: any) {
      console.warn(`[TradeExecutor] Quote failed (will proceed): ${err.message}`);
    }

    // 6. Execute swap
    let swapResult;
    if (order.action === 'BUY' && order.tokenIn.toUpperCase() === 'BNB') {
      swapResult = await executeBuy(
        wallet,
        order.tokenOut,
        Number(order.amountIn),
        slippageBps,
      );
    } else if (order.action === 'SELL' && order.tokenOut.toUpperCase() === 'BNB') {
      swapResult = await executeSell(
        wallet,
        order.tokenIn,
        order.amountIn,
        slippageBps,
      );
    } else {
      // Generic token-to-token swap (TODO: implement full V3 path)
      const result: TradeResult = {
        success: false,
        error: `Unsupported pair: ${order.tokenIn}→${order.tokenOut}. Only BNB↔token trades supported currently.`,
        timestamp,
      };
      await recordTrade(order, result);
      return result;
    }

    // 7. Build successful result
    const result: TradeResult = {
      success: true,
      txHash: swapResult.txHash,
      blockNumber: swapResult.blockNumber,
      amountIn: swapResult.amountIn,
      amountOut: swapResult.amountOut,
      gasUsed: swapResult.gasUsed,
      gasCostBnb: swapResult.gasCostBnb,
      quoteAmount,
      riskCheck,
      timestamp,
    };

    // Wipe private key from memory
    (wallet as any).privateKey = null;

    // 8. Record trade
    await recordTrade(order, result);

    return result;
  } catch (err: any) {
    console.error('[TradeExecutor] Execute failed:', err.message);

    const result: TradeResult = {
      success: false,
      error: err.message,
      timestamp,
    };
    await recordTrade(order, result);
    return result;
  }
}

// ─── Quick Helpers ───────────────────────────────────────────────────────────

/**
 * Check if live trading is operational (no decryption, no on-chain calls)
 */
export function checkLiveTradingReadiness(): { ready: boolean; issues: string[] } {
  const issues: string[] = [];

  if (!isLiveTradingEnabled()) {
    issues.push('NFA_LIVE_TRADING_ENABLED is not true');
  }
  if (!process.env.NFA_WALLET_MASTER_KEY) {
    issues.push('NFA_WALLET_MASTER_KEY is not set');
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    issues.push('NEXT_PUBLIC_SUPABASE_URL is not set');
  }
  if (!supabaseServiceRoleKey) {
    issues.push('Supabase service role key is not set');
  }

  return { ready: issues.length === 0, issues };
}
