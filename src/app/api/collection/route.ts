import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getModelDisplayName } from '@/lib/model-display';

export const dynamic = 'force-dynamic';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

const NFA_CONTRACT = process.env.NEXT_PUBLIC_BSC_NFA_CONTRACT_ADDRESS || '0x9bC5f392cE8C7aA13BD5bC7D5A1A12A4DD58b3D5';

// Genesis NFAs that aren't in the bots table
const GENESIS_NFAS = [
  {
    id: 0,
    name: '🌟 Opus Genesis',
    nfa_id: 0,
    strategy: 'genesis',
    trading_style: 'visionary',
    ai_model: 'Claude Opus',
    evm_address: '0x133C89BC9Dc375fBc46493A92f4Fd2486F8F0d76',
    wins: 0,
    losses: 0,
    total_battles: 0,
    elo: 0,
    league: 'legendary',
    special: 'Genesis',
  },
  {
    id: -1,
    name: '👑 The Founder',
    nfa_id: 1,
    strategy: 'founder',
    trading_style: 'legendary',
    ai_model: 'Claude Opus',
    evm_address: '0x133C89BC9Dc375fBc46493A92f4Fd2486F8F0d76',
    wins: 0,
    losses: 0,
    total_battles: 0,
    elo: 0,
    league: 'legendary',
    special: 'Founder',
  },
];

export async function GET() {
  try {
    const supabase = getSupabase();

    // Fetch bots with NFA IDs
    const { data: bots, error } = await supabase
      .from('bots')
      .select('id, name, strategy, nfa_id, evm_address, wins, losses, total_battles, elo, model_id, league')
      .not('nfa_id', 'is', null)
      .order('nfa_id', { ascending: true });

    if (error) {
      console.error('Collection fetch error:', error);
      return NextResponse.json({ error: 'Failed to fetch collection' }, { status: 500 });
    }

    // Fetch trading stats for all NFAs
    const nfaIds = (bots || []).map((b) => b.nfa_id).filter(Boolean);
    let statsMap = new Map<number, {
      total_pnl_usd: number;
      total_trades: number;
      win_rate: number;
      paper_balance_usd: number;
    }>();

    if (nfaIds.length > 0) {
      const { data: stats } = await supabase
        .from('nfa_trading_stats')
        .select('nfa_id, total_pnl_usd, total_trades, win_rate, paper_balance_usd')
        .in('nfa_id', nfaIds);

      if (stats) {
        for (const s of stats) {
          statsMap.set(s.nfa_id, s);
        }
      }
    }

    // Fetch current active tournament
    const { data: activeTournaments } = await supabase
      .from('trading_tournaments')
      .select('id, name, status')
      .eq('status', 'active')
      .order('start_at', { ascending: false })
      .limit(1);

    const activeTournament = activeTournaments && activeTournaments.length > 0 ? activeTournaments[0] : null;

    // Fetch tournament entries for the active tournament
    // Note: tournament_entries.nfa_id actually stores the bot_id (bots.id), not bots.nfa_id
    // So we map by bot_id and then resolve to the actual nfa_id via the bots table
    let tournamentMap = new Map<number, {
      tournament_pnl_usd: number;
      rank: number;
      tournament_name: string;
    }>();

    if (activeTournament) {
      const { data: entries } = await supabase
        .from('trading_tournament_entries')
        .select('bot_id, tournament_pnl_usd, rank')
        .eq('tournament_id', activeTournament.id);

      // Build bot_id -> nfa_id mapping from the bots data
      const botIdToNfaId = new Map<number, number>();
      for (const bot of (bots || [])) {
        botIdToNfaId.set(bot.id, bot.nfa_id);
      }

      if (entries) {
        for (const e of entries) {
          const realNfaId = botIdToNfaId.get(e.bot_id);
          if (realNfaId !== undefined) {
            tournamentMap.set(realNfaId, {
              tournament_pnl_usd: e.tournament_pnl_usd || 0,
              rank: e.rank || 0,
              tournament_name: activeTournament.name,
            });
          }
        }
      }
    }

    const processedBots = (bots || []).map((bot) => {
      const totalBattles = bot.total_battles || (bot.wins || 0) + (bot.losses || 0);
      const winRate = totalBattles > 0
        ? Math.round(((bot.wins || 0) / totalBattles) * 100)
        : 0;

      const tradingStats = statsMap.get(bot.nfa_id) || null;
      const tournamentEntry = tournamentMap.get(bot.nfa_id) || null;

      return {
        id: bot.id,
        name: bot.name || 'Unknown Bot',
        nfaId: bot.nfa_id,
        strategy: bot.strategy || 'unknown',
        tradingStyle: 'unknown',
        aiModel: bot.model_id ? getModelDisplayName(bot.model_id) : 'Unknown',
        evmAddress: bot.evm_address || '',
        wins: bot.wins || 0,
        losses: bot.losses || 0,
        totalBattles,
        winRate,
        elo: bot.elo || 1000,
        league: bot.league || 'bronze',
        special: null as string | null,
        isGenesis: false,
        marketplacePrice: null as number | null,
        bscscanUrl: `https://bscscan.com/token/${NFA_CONTRACT}?a=${bot.nfa_id}`,
        // Trading League data
        totalPnlUsd: tradingStats?.total_pnl_usd ?? null,
        totalTrades: tradingStats?.total_trades ?? 0,
        tradingWinRate: tradingStats?.win_rate ?? null,
        currentBalanceUsd: tradingStats?.paper_balance_usd ?? null,
        // Tournament data
        tournamentPnlUsd: tournamentEntry?.tournament_pnl_usd ?? null,
        tournamentRank: tournamentEntry?.rank ?? null,
        tournamentName: tournamentEntry?.tournament_name ?? null,
      };
    });

    // Prepend genesis NFAs
    const genesisProcessed = GENESIS_NFAS.map((g) => ({
      id: g.id,
      name: g.name,
      nfaId: g.nfa_id,
      strategy: g.strategy,
      tradingStyle: g.trading_style,
      aiModel: g.ai_model,
      evmAddress: g.evm_address,
      wins: g.wins,
      losses: g.losses,
      totalBattles: g.total_battles,
      winRate: 0,
      elo: g.elo,
      league: g.league,
      special: g.special,
      bscscanUrl: `https://bscscan.com/token/${NFA_CONTRACT}?a=${g.nfa_id}`,
      // Trading League data (genesis bots don't trade)
      totalPnlUsd: null as number | null,
      totalTrades: 0,
      tradingWinRate: null as number | null,
      currentBalanceUsd: null as number | null,
      tournamentPnlUsd: null as number | null,
      tournamentRank: null as number | null,
      tournamentName: null as string | null,
    }));

    const allNfas = [...genesisProcessed, ...processedBots];

    // Unique strategies for filter
    const strategies = [...new Set(allNfas.map((b) => b.strategy))].sort();

    return NextResponse.json({
      nfas: allNfas,
      total: allNfas.length,
      contract: NFA_CONTRACT,
      strategies,
      activeTournament: activeTournament ? { id: activeTournament.id, name: activeTournament.name } : null,
    });
  } catch (error) {
    console.error('Collection API error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
