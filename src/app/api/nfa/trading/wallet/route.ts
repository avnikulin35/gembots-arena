import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { encryptPrivateKey } from '@/lib/security/wallet-crypto';
import { getOnChainOwnerAddress } from '@/lib/security/trading-ownership';
import { checkRateLimit } from '@/lib/rate-limit';
import { TradingAuthError, verifyWalletSignature } from '@/lib/security/trading-auth';
import { ZeroAddress, isAddress } from 'ethers';

const WALLET_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const WALLET_RATE_LIMIT_MAX = 5;
const WALLET_GET_RATE_LIMIT_WINDOW_MS = 10 * 1000;
const WALLET_GET_RATE_LIMIT_MAX = 5;

export async function GET(request: NextRequest) {
  const rateLimitResponse = checkRateLimit(request, WALLET_GET_RATE_LIMIT_MAX, WALLET_GET_RATE_LIMIT_WINDOW_MS);
  if (rateLimitResponse) return rateLimitResponse;

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
  } catch {
    console.error('GET /api/nfa/trading/wallet error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = checkRateLimit(request, WALLET_RATE_LIMIT_MAX, WALLET_RATE_LIMIT_WINDOW_MS);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body = await request.json();
    const { nfaId, ownerAddress, signedMessage, signature, nonce, timestamp } = body;

    const missingFields = [];
    const missingAuth = [];
    if (!nfaId) missingFields.push('nfaId');
    if (!ownerAddress) missingFields.push('ownerAddress');
    if (!signedMessage) missingAuth.push('signedMessage');
    if (!signature) missingAuth.push('signature');
    if (!nonce) missingAuth.push('nonce');
    if (timestamp === undefined || timestamp === null || timestamp === '') missingAuth.push('timestamp');

    if (missingFields.length > 0) {
      return NextResponse.json(
        { error: `${missingFields.join(', ')} are required` },
        { status: 400 }
      );
    }

    if (missingAuth.length > 0) {
      return NextResponse.json(
        { error: `Unauthorized: missing auth fields: ${missingAuth.join(', ')}` },
        { status: 401 }
      );
    }

    if (!isAddress(ownerAddress)) {
      return NextResponse.json({ error: 'ownerAddress must be a valid EVM address' }, { status: 400 });
    }

    let normalizedOwnerAddress = ownerAddress;
    try {
      const auth = await verifyWalletSignature({
        nfaId: parseInt(nfaId),
        ownerAddress,
        signedMessage,
        signature,
        nonce,
        timestamp,
      });
      normalizedOwnerAddress = auth.ownerAddress;
    } catch (error) {
      if (error instanceof TradingAuthError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }

    const { data: bot, error: findError } = await supabase
      .from('bots')
      .select('id, nfa_id, wallet_address, trading_wallet_address')
      .eq('nfa_id', parseInt(nfaId))
      .single();

    if (findError || !bot) {
      return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
    }

    if (bot.trading_wallet_address) {
      return NextResponse.json({
        wallet: bot.trading_wallet_address,
        message: 'Wallet already exists',
      });
    }

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

    if (onChainOwner.toLowerCase() !== normalizedOwnerAddress.toLowerCase()) {
      return NextResponse.json(
        { error: 'Not the owner of this NFA (on-chain verification failed)' },
        { status: 403 }
      );
    }

    if (bot.wallet_address?.toLowerCase() !== normalizedOwnerAddress.toLowerCase()) {
      return NextResponse.json({ error: 'Not the owner of this NFA bot' }, { status: 403 });
    }

    const { ethers } = await import('ethers');
    const wallet = ethers.Wallet.createRandom();
    const address = wallet.address;
    const privateKey = wallet.privateKey;

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
  } catch {
    console.error('POST /api/nfa/trading/wallet error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
