import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { ethers } from 'ethers';

// ─── Token addresses (BSC mainnet) ──────────────────────────────────────────

const TOKENS: Record<string, string> = {
  USDT: '0x55d398326f99059fF775485246999027B3197955',
  CAKE: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82',
  ETH:  '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
};

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

// ─── GET: Get real wallet balance ────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const nfaId = request.nextUrl.searchParams.get('nfaId');
  const ownerAddress = request.nextUrl.searchParams.get('ownerAddress');

  if (!nfaId) {
    return NextResponse.json({ error: 'nfaId is required' }, { status: 400 });
  }

  // Require ownerAddress to prevent unauthorized balance enumeration
  if (!ownerAddress) {
    return NextResponse.json(
      { error: 'ownerAddress is required for balance queries' },
      { status: 400 }
    );
  }

  try {
    const nfaIdNum = parseInt(nfaId);

    const { data: bot, error } = await supabase
      .from('bots')
      .select('id, nfa_id, wallet_address, trading_wallet_address, trading_mode')
      .eq('nfa_id', nfaIdNum)
      .single();

    if (error || !bot) {
      return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
    }

    if (!bot.trading_wallet_address) {
      return NextResponse.json({ error: 'No wallet generated for this bot' }, { status: 400 });
    }

    // Verify caller owns the bot
    if (bot.wallet_address?.toLowerCase() !== ownerAddress.toLowerCase()) {
      return NextResponse.json({ error: 'Not the owner of this NFA bot' }, { status: 403 });
    }

    const walletAddress = bot.trading_wallet_address;
    const rpcUrl = process.env.NEXT_PUBLIC_BSC_RPC || 'https://bsc-dataseed.binance.org/';
    const provider = new ethers.JsonRpcProvider(rpcUrl, 56);

    // Fetch BNB balance
    const bnbBalance = await provider.getBalance(walletAddress);
    const bnb = ethers.formatEther(bnbBalance);

    // Fetch token balances
    const tokens: Array<{ symbol: string; balance: string; address: string }> = [];

    for (const [symbol, address] of Object.entries(TOKENS)) {
      try {
        const contract = new ethers.Contract(address, ERC20_ABI, provider);
        const [balance, decimals] = await Promise.all([
          contract.balanceOf(walletAddress),
          contract.decimals(),
        ]);
        const formatted = ethers.formatUnits(balance, decimals);
        if (parseFloat(formatted) > 0) {
          tokens.push({ symbol, balance: formatted, address });
        }
      } catch {
        // Skip failed token queries
      }
    }

    return NextResponse.json({
      nfaId: bot.nfa_id,
      wallet: walletAddress,
      mode: bot.trading_mode,
      bnb,
      bnbUsd: null, // Could add price conversion later
      tokens,
      lowBalance: parseFloat(bnb) < 0.01,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('GET /api/nfa/trading/balance error');
    return NextResponse.json({ error: 'Failed to fetch balance' }, { status: 500 });
  }
}
