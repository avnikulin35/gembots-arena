import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { encryptPrivateKey } from '@/lib/security/wallet-crypto';
import { getOnChainOwnerAddress } from '@/lib/security/trading-ownership';
import { checkRateLimit, getClientIP } from '@/lib/rate-limit';
import { ZeroAddress } from 'ethers';

// ─── Rate limit for wallet creation: 5 requests per 10 minutes per IP ───
const WALLET_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

// ─── GET: Get wallet info for NFA ────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const nfaId = request.nextUrl.searchParams.get('nfaId');

  if (!nfaId) {
    return NextResponse.json({ error: 'nfaId is required' }, { status: 400 });
  }

  try {
    const { data: bot, error } = await supabase
      .from('bots')
      .select('id, nfa_id, name, trading_wallet_address, trading_mode, trading_config')
      .eq('nfa_id', parseInt(nfaId))
      .single();

    if (error || !bot) {
      return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
    }

    // Get trading stats
    const { data: stats } = await supabase
      .from('nfa_trading_stats')
      .select('*')
      .eq('nfa_id', parseInt(nfaId))
      .single();

    return NextResponse.json({
      botId: bot.id,
      nfaId: bot.nfa_id,
      name: bot.name,
      wallet: bot.trading_wallet_address || null,
      mode: bot.trading_mode || 'off',
      config: bot.trading_config || {},
      stats: stats || null,
    });
  } catch (err) {
    console.error('GET /api/nfa/trading/wallet error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ─── POST: Create wallet for NFA ─────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Rate limit: 5 wallet creation requests per 10 minutes per IP
  const rateLimitResponse = checkRateLimit(request, 5, WALLET_RATE_LIMIT_WINDOW_MS);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body = await request.json();
    const { nfaId, ownerAddress } = body;

    if (!nfaId || !ownerAddress) {
      return NextResponse.json(
        { error: 'nfaId and ownerAddress are required' },
        { status: 400 }
      );
    }

    // Find bot with this nfa_id
    const { data: bot, error: findError } = await supabase
      .from('bots')
      .select('id, nfa_id, wallet_address, trading_wallet_address')
      .eq('nfa_id', parseInt(nfaId))
      .single();

    if (findError || !bot) {
      return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
    }

    // Early exit — wallet already exists (before on-chain / DB checks)
    if (bot.trading_wallet_address) {
      return NextResponse.json({
        wallet: bot.trading_wallet_address,
        message: 'Wallet already exists',
      });
    }

    // ─── On-chain ownership verification (fail-closed for mutating actions) ───
    let onChainOwner: string | null = null;
    try {
      onChainOwner = await getOnChainOwnerAddress(parseInt(nfaId));
    } catch (error) {
      console.warn('[Wallet] On-chain ownership check failed:', error instanceof Error ? error.message : 'unknown error');
      return NextResponse.json(
        { error: 'chain unreachable, try again' },
        { status: 503 }
      );
    }

    if (!onChainOwner || onChainOwner === ZeroAddress) {
      return NextResponse.json(
        { error: 'NFA owner unavailable on-chain' },
        { status: 503 }
      );
    }

    if (onChainOwner.toLowerCase() !== ownerAddress.toLowerCase()) {
      return NextResponse.json(
        { error: 'Not the owner of this NFA (on-chain verification failed)' },
        { status: 403 }
      );
    }

    // ─── DB-level ownership check (always enforced) ───
    if (bot.wallet_address?.toLowerCase() !== ownerAddress.toLowerCase()) {
      return NextResponse.json({ error: 'Not the owner of this NFA bot' }, { status: 403 });
    }

    // ─── Generate and persist wallet ───
    const { ethers } = await import('ethers');
    const wallet = ethers.Wallet.createRandom();
    const address = wallet.address;
    const privateKey = wallet.privateKey;

    // Encrypt private key with AES-256-GCM (shared helper)
    const encrypted = encryptPrivateKey(privateKey);

    const { error: updateError } = await supabase
      .from('bots')
      .update({
        trading_wallet_address: address,
        trading_wallet_encrypted: encrypted,
      })
      .eq('id', bot.id);

    if (updateError) {
      return NextResponse.json({ error: 'Failed to save wallet' }, { status: 500 });
    }

    // Initialize trading stats (ignore conflict)
    try {
      await supabase
        .from('nfa_trading_stats')
        .upsert(
          { nfa_id: parseInt(nfaId), bot_id: bot.id, paper_balance_usd: 10000 },
          { onConflict: 'nfa_id' }
        );
    } catch {
      /* may already exist */
    }

    return NextResponse.json({
      wallet: address,
      message: 'Trading wallet created successfully',
    });
  } catch (err) {
    console.error('POST /api/nfa/trading/wallet error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
