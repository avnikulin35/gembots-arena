/**
 * POST /api/nfa/trading/execute
 *
 * Live trade execution endpoint for NFA Trading League.
 * Validates ownership, trading mode, risk limits, then executes via PancakeSwap.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { checkRateLimit, getClientIP } from '@/lib/rate-limit';
import { getOnChainOwnerAddress } from '@/lib/security/trading-ownership';
import { ZeroAddress } from 'ethers';
import { executeTrade, TradeOrder, checkLiveTradingReadiness } from '@/lib/bsc/trade-executor';
import {
  isLiveTradingEnabled,
  DEFAULT_SLIPPAGE_BPS,
} from '@/lib/bsc/pancakeswap';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExecuteRequestBody {
  nfaId: number;
  ownerAddress: string;
  action: 'BUY' | 'SELL';
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  slippageBps?: number;
  pair?: string;
  confidence?: number;
  reasoning?: string;
}

const EXECUTE_RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const EXECUTE_RATE_LIMIT_MAX = 10;

// ─── GET: Check live trading readiness ────────────────────────────────────────

export async function GET() {
  const readiness = checkLiveTradingReadiness();
  return NextResponse.json({
    enabled: isLiveTradingEnabled(),
    readiness,
  });
}

// ─── POST: Execute a trade ───────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Rate limit
  const rateLimitResponse = checkRateLimit(request, EXECUTE_RATE_LIMIT_MAX, EXECUTE_RATE_LIMIT_WINDOW_MS);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body: ExecuteRequestBody = await request.json();

    // ── Validation ──────────────────────────────────────────
    const missing: string[] = [];
    if (!body.nfaId) missing.push('nfaId');
    if (!body.ownerAddress) missing.push('ownerAddress');
    if (!body.action || !['BUY', 'SELL'].includes(body.action)) missing.push('action (BUY/SELL)');
    if (!body.tokenIn) missing.push('tokenIn');
    if (!body.tokenOut) missing.push('tokenOut');
    if (!body.amountIn || body.amountIn <= 0) missing.push('valid amountIn');
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Missing fields: ${missing.join(', ')}` },
        { status: 400 },
      );
    }

    // ── Check live trading enabled ─────────────────────────
    if (!isLiveTradingEnabled()) {
      return NextResponse.json(
        { error: 'Live trading is not enabled. Set NFA_LIVE_TRADING_ENABLED=true' },
        { status: 503 },
      );
    }

    const nfaId = body.nfaId;

    // ── Find bot ────────────────────────────────────────────
    const { data: bot, error: botErr } = await supabase
      .from('bots')
      .select('id, nfa_id, name, wallet_address, trading_wallet_address, trading_wallet_encrypted, trading_mode')
      .eq('nfa_id', nfaId)
      .single();

    if (botErr || !bot) {
      return NextResponse.json({ error: 'NFA bot not found' }, { status: 404 });
    }

    // ── Check wallet exists ─────────────────────────────────
    if (!bot.trading_wallet_address || !bot.trading_wallet_encrypted) {
      return NextResponse.json(
        { error: 'Trading wallet not configured. Create a wallet first.' },
        { status: 400 },
      );
    }

    // ── Check trading mode ──────────────────────────────────
    if (bot.trading_mode !== 'live') {
      return NextResponse.json(
        {
          error: `Bot is in ${bot.trading_mode} mode. Switch to 'live' mode first.`,
          currentMode: bot.trading_mode,
        },
        { status: 400 },
      );
    }

    // ── On-chain ownership verification ─────────────────────
    try {
      const onChainOwner = await getOnChainOwnerAddress(nfaId);
      if (!onChainOwner || onChainOwner === ZeroAddress) {
        return NextResponse.json(
          { error: 'NFA owner unavailable on-chain' },
          { status: 503 },
        );
      }

      if (onChainOwner.toLowerCase() !== body.ownerAddress.toLowerCase()) {
        return NextResponse.json(
          { error: 'Not the owner of this NFA (on-chain verification failed)' },
          { status: 403 },
        );
      }
    } catch (error) {
      console.warn('[Execute] On-chain ownership check failed:', error instanceof Error ? error.message : 'unknown error');
      return NextResponse.json(
        { error: 'chain unreachable, try again' },
        { status: 503 },
      );
    }

    // ── DB ownership check (always enforced) ────────────────
    if (bot.wallet_address?.toLowerCase() !== body.ownerAddress.toLowerCase()) {
      return NextResponse.json(
        { error: 'Not the owner of this NFA bot' },
        { status: 403 },
      );
    }

    // ── Build trade order ────────────────────────────────────
    const slippageBps = body.slippageBps
      ? Math.min(Number(body.slippageBps), 200)
      : DEFAULT_SLIPPAGE_BPS;

    const order: TradeOrder = {
      nfaId: body.nfaId,
      botId: bot.id,
      action: body.action,
      tokenIn: body.tokenIn,
      tokenOut: body.tokenOut,
      amountIn: body.amountIn,
      slippageBps,
      pair: body.pair || `${body.tokenIn}/${body.tokenOut}`,
      confidence: body.confidence ?? undefined,
      reasoning: body.reasoning ?? undefined,
    };

    // ── Execute trade ────────────────────────────────────────
    const result = await executeTrade(order);

    return NextResponse.json({
      success: result.success,
      txHash: result.txHash,
      blockNumber: result.blockNumber,
      amountIn: result.amountIn,
      amountOut: result.amountOut,
      gasUsed: result.gasUsed,
      gasCostBnb: result.gasCostBnb,
      error: result.error || null,
      timestamp: result.timestamp,
    }, { status: result.success ? 200 : 400 });

  } catch (err: any) {
    console.error('POST /api/nfa/trading/execute error:', err);

    // Never leak private keys or internal details
    const isClientSafe = err.message?.includes('insufficient') ||
      err.message?.includes('not found') ||
      err.message?.includes('not the owner');

    return NextResponse.json(
      {
        error: isClientSafe ? err.message : 'Trade execution failed. Please try again.',
      },
      { status: 500 },
    );
  }
}
