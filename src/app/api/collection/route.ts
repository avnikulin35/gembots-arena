import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Database from 'better-sqlite3';
import path from 'path';
import { getModelDisplayName } from '@/lib/model-display';

export const dynamic = 'force-dynamic';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

const NFA_CONTRACT = process.env.NEXT_PUBLIC_BSC_NFA_CONTRACT_ADDRESS || '0x9bC5f392cE8C7aA13BD5bC7D5A1A12A4DD58b3D5';
const SQLITE_DB_PATH = path.join(process.cwd(), 'data/gembots.db');

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

    // Fetch trading stats from SQLite (source of truth for live trading data)
    const nfaIds = (bots || []).map((b) => Number(b.nfa_id)).filter((v) => Number.isFinite(v));
    let statsMap = new Map<number, {
      total_pnl_usd: number;
      total_trades: number;
      win_rate: number;
      paper_balance_usd: number | null;
    }>();

    let sqliteDb: Database.Database | null = null;
    try {
      sqliteDb = new Database(SQLITE_DB_PATH, { readonly: true });
      const tradingRows = sqliteDb.prepare(`
        SELECT
          ab.nfa_id,
          te.total_pnl AS total_pnl_usd,
          te.total_trades,
          CASE WHEN te.total_trades > 0 THEN (te.wins * 100.0 / te.total_trades) ELSE 0 END AS win_rate,
          tp.balance AS paper_balance_usd
        FROM api_bots ab
        LEFT JOIN trading_elo te ON te.bot_id = ab.id
        LEFT JOIN trading_portfolio tp ON tp.bot_id = ab.id
        WHERE ab.nfa_id IS NOT NULL
      `).all() as Array<{
        nfa_id: number | string;
        total_pnl_usd: number | null;
        total_trades: number | null;
        win_rate: number | null;
        paper_balance_usd: number | null;
      }>;

      for (const row of tradingRows) {
        const nfaId = Number(row.nfa_id);
        if (!Number.isFinite(nfaId)) continue;
        statsMap.set(nfaId, {
          total_pnl_usd: Number(row.total_pnl_usd) || 0,
          total_trades: Number(row.total_trades) || 0,
          win_rate: Number(row.win_rate) || 0,
          paper_balance_usd: row.paper_balance_usd == null ? null : Number(row.paper_balance_usd),
        });
      }
    } catch (sqliteError) {
      console.error('Collection SQLite trading stats error:', sqliteError);
    } finally {
      sqliteDb?.close();
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

      const numericNfaId = Number(bot.nfa_id);
      const tradingStats = statsMap.get(numericNfaId) || null;
      const tournamentEntry = tournamentMap.get(numericNfaId) || null;

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
      tradingStyle: g.strategy,
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
