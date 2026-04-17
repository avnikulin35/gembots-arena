/**
 * POST /api/nfa/trading/execute
 *
 * Live trade execution endpoint for NFA Trading League.
 * Validates signed ownership intent, trading mode, risk limits, then executes via PancakeSwap.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { checkRateLimit } from '@/lib/rate-limit';
import { getOnChainOwnerAddress } from '@/lib/security/trading-ownership';
import { TradingAuthError, authorizeTradingMutation } from '@/lib/security/trading-auth';
import { ZeroAddress, isAddress } from 'ethers';
import { executeTrade, TradeOrder, checkLiveTradingReadiness } from '@/lib/bsc/trade-executor';
import {
  isLiveTradingEnabled,
  DEFAULT_SLIPPAGE_BPS,
} from '@/lib/bsc/pancakeswap';

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
  signedMessage: string;
  signature: string;
  nonce: string;
  timestamp: number | string;
}

const EXECUTE_RATE_LIMIT_WINDOW_MS = 60_000;
const EXECUTE_RATE_LIMIT_MAX = 5;

export async function GET() {
  const readiness = checkLiveTradingReadiness();
  return NextResponse.json({
    enabled: isLiveTradingEnabled(),
    readiness,
  });
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = checkRateLimit(request, EXECUTE_RATE_LIMIT_MAX, EXECUTE_RATE_LIMIT_WINDOW_MS);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body: ExecuteRequestBody = await request.json();

    const missing: string[] = [];
    const missingAuth: string[] = [];
    if (!body.nfaId) missing.push('nfaId');
    if (!body.ownerAddress) missing.push('ownerAddress');
    if (!body.action || !['BUY', 'SELL'].includes(body.action)) missing.push('action (BUY/SELL)');
    if (!body.tokenIn) missing.push('tokenIn');
    if (!body.tokenOut) missing.push('tokenOut');
    if (!body.amountIn || body.amountIn <= 0) missing.push('valid amountIn');
    if (!body.signedMessage) missingAuth.push('signedMessage');
    if (!body.signature) missingAuth.push('signature');
    if (!body.nonce) missingAuth.push('nonce');
    if (body.timestamp === undefined || body.timestamp === null || body.timestamp === '') missingAuth.push('timestamp');
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Missing fields: ${missing.join(', ')}` },
        { status: 400 },
      );
    }
    if (missingAuth.length > 0) {
      return NextResponse.json(
        { error: `Unauthorized: missing auth fields: ${missingAuth.join(', ')}` },
        { status: 401 },
      );
    }

    if (!isAddress(body.ownerAddress)) {
      return NextResponse.json({ error: 'ownerAddress must be a valid EVM address' }, { status: 400 });
    }

    let normalizedOwnerAddress = body.ownerAddress;
    try {
      const auth = await authorizeTradingMutation({
        nfaId: body.nfaId,
        ownerAddress: body.ownerAddress,
        signedMessage: body.signedMessage,
        signature: body.signature,
        nonce: body.nonce,
        timestamp: body.timestamp,
      });
      normalizedOwnerAddress = auth.ownerAddress;
    } catch (error) {
      if (error instanceof TradingAuthError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }

    if (!isLiveTradingEnabled()) {
      return NextResponse.json(
        { error: 'Live trading is not enabled. Set NFA_LIVE_TRADING_ENABLED=true' },
        { status: 503 },
      );
    }

    const nfaId = body.nfaId;

    const { data: bot, error: botErr } = await supabase
      .from('bots')
      .select('id, nfa_id, name, wallet_address, trading_wallet_address, trading_wallet_encrypted, trading_mode')
      .eq('nfa_id', nfaId)
      .single();

    if (botErr || !bot) {
      return NextResponse.json({ error: 'NFA bot not found' }, { status: 404 });
    }

    if (!bot.trading_wallet_address || !bot.trading_wallet_encrypted) {
      return NextResponse.json(
        { error: 'Trading wallet not configured. Create a wallet first.' },
        { status: 400 },
      );
    }

    if (bot.trading_mode !== 'live') {
      return NextResponse.json(
        {
          error: `Bot is in ${bot.trading_mode} mode. Switch to 'live' mode first.`,
          currentMode: bot.trading_mode,
        },
        { status: 400 },
      );
    }

    try {
      const onChainOwner = await getOnChainOwnerAddress(nfaId);
      if (!onChainOwner || onChainOwner === ZeroAddress) {
        return NextResponse.json(
          { error: 'NFA owner unavailable on-chain' },
          { status: 503 },
        );
      }

      if (onChainOwner.toLowerCase() !== normalizedOwnerAddress.toLowerCase()) {
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

    if (bot.wallet_address?.toLowerCase() !== normalizedOwnerAddress.toLowerCase()) {
      return NextResponse.json(
        { error: 'Not the owner of this NFA bot' },
        { status: 403 },
      );
    }

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
