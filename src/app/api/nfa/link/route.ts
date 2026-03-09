import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { ethers } from 'ethers';
import { rateLimit, getClientIP } from '@/lib/rate-limit';

const NFA_CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_BSC_NFA_CONTRACT_ADDRESS || '0x9bC5f392cE8C7aA13BD5bC7D5A1A12A4DD58b3D5';
const BSC_RPC_URL = 'https://bsc-dataseed1.binance.org';
const NFA_STRATEGY_ABI = [
  'function botStrategy(uint256 tokenId) view returns (string)',
  'function tokenURI(uint256 tokenId) view returns (string)',
];

/**
 * Read and parse NFA strategy from on-chain contract
 */
async function fetchStrategyFromChain(nfaId: number): Promise<string | null> {
  try {
    const provider = new ethers.JsonRpcProvider(BSC_RPC_URL);
    const contract = new ethers.Contract(NFA_CONTRACT_ADDRESS, NFA_STRATEGY_ABI, provider);
    
    // v2: strategy is stored directly as a string in botStrategy mapping
    const strategy = await contract.botStrategy(nfaId);
    if (strategy && strategy !== '') {
      return JSON.stringify({ strategy, version: 'v2' });
    }

    // Also try tokenURI for metadata
    const tokenURI = await contract.tokenURI(nfaId);
    if (!tokenURI || tokenURI === '') return null;

    // Parse data URI
    if (tokenURI.startsWith('data:')) {
      const commaIdx = tokenURI.indexOf(',');
      if (commaIdx === -1) return null;
      const base64 = tokenURI.slice(commaIdx + 1);
      const json = Buffer.from(base64, 'base64').toString('utf8');
      JSON.parse(json); // validate
      return json;
    }

    // HTTPS/IPFS
    if (tokenURI.startsWith('http') || tokenURI.startsWith('ipfs://')) {
      const url = tokenURI.startsWith('ipfs://')
        ? `https://ipfs.io/ipfs/${tokenURI.slice(7)}`
        : tokenURI;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const text = await res.text();
        JSON.parse(text); // validate
        return text;
      }
    }

    return null;
  } catch (err) {
    console.warn(`Failed to fetch strategy for NFA #${nfaId}:`, (err as Error).message);
    return null;
  }
}

/**
 * POST /api/nfa/link
 * 
 * Links an NFA token to a bot in Supabase after successful mint.
 * Also fetches and caches the NFA strategy from on-chain.
 * Body: { botId: number, nfaId: number, evmAddress: string }
 */
export async function POST(request: NextRequest) {
  // Rate limit: 5 req/min per IP
  const ip = getClientIP(request);
  const { allowed } = rateLimit(`nfa-link:${ip}`, 5, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  try {
    const body = await request.json();
    const { botId, nfaId, evmAddress } = body;

    // Validate required fields
    if (!botId || nfaId === undefined || nfaId === null || !evmAddress) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: botId, nfaId, evmAddress' },
        { status: 400 }
      );
    }

    // Validate types
    if (typeof botId !== 'number' || typeof nfaId !== 'number') {
      return NextResponse.json(
        { success: false, error: 'botId and nfaId must be numbers' },
        { status: 400 }
      );
    }

    if (typeof evmAddress !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(evmAddress)) {
      return NextResponse.json(
        { success: false, error: 'evmAddress must be a valid EVM address (0x...)' },
        { status: 400 }
      );
    }

    // Check that the bot exists
    const { data: bot, error: fetchError } = await supabase
      .from('bots')
      .select('id, name, nfa_id')
      .eq('id', botId)
      .single();

    if (fetchError || !bot) {
      return NextResponse.json(
        { success: false, error: `Bot with id ${botId} not found` },
        { status: 404 }
      );
    }

    // Check if bot already has an NFA linked
    if (bot.nfa_id !== null && bot.nfa_id !== undefined) {
      return NextResponse.json(
        { success: false, error: `Bot "${bot.name}" already linked to NFA #${bot.nfa_id}` },
        { status: 409 }
      );
    }

    // Check that this nfa_id isn't already assigned to another bot
    const { data: existing } = await supabase
      .from('bots')
      .select('id, name')
      .eq('nfa_id', nfaId)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { success: false, error: `NFA #${nfaId} is already linked to bot "${existing.name}" (id: ${existing.id})` },
        { status: 409 }
      );
    }

    // Fetch strategy from on-chain (non-blocking for link, but try to cache)
    let strategyCache: string | null = null;
    try {
      strategyCache = await fetchStrategyFromChain(nfaId);
      if (strategyCache) {
        console.log(`📦 Cached NFA #${nfaId} strategy (${strategyCache.length} bytes)`);
      }
    } catch (err) {
      console.warn(`⚠️ Could not fetch strategy for NFA #${nfaId}:`, (err as Error).message);
      // Non-critical — strategy can be fetched later by the adapter
    }

    // Update the bot with NFA info + strategy cache
    const updatePayload: Record<string, unknown> = {
      nfa_id: nfaId,
      evm_address: evmAddress.toLowerCase(),
    };
    if (strategyCache) {
      updatePayload.strategy_cache = strategyCache;
    }

    const { error: updateError } = await supabase
      .from('bots')
      .update(updatePayload)
      .eq('id', botId);

    if (updateError) {
      console.error('Failed to link NFA:', updateError);
      return NextResponse.json(
        { success: false, error: 'Database update failed: ' + updateError.message },
        { status: 500 }
      );
    }

    console.log(`✅ NFA #${nfaId} linked to bot "${bot.name}" (id: ${botId}) by ${evmAddress}`);

    return NextResponse.json({
      success: true,
      data: {
        botId,
        botName: bot.name,
        nfaId,
        evmAddress: evmAddress.toLowerCase(),
        strategyCached: !!strategyCache,
      },
    });
  } catch (error: unknown) {
    const e = error as Error;
    console.error('NFA link error:', e.message);
    return NextResponse.json(
      { success: false, error: e.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
