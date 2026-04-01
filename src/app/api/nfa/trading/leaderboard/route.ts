import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export const dynamic = 'force-dynamic';

const DB_PATH = path.join(process.cwd(), 'data/gembots.db');
const TOURNAMENT_FILE = path.join(process.cwd(), 'data', 'tournament.json');

/**
 * GET /api/nfa/trading/leaderboard
 *
 * Query params:
 *   type=tournament  — current tournament ranking
 *   type=alltime     — all-time by total_pnl
 *   type=weekly      — last 7 days
 *   tournament_id=X  — specific tournament (uses tournament.json if matches)
 *   (no params)      — legacy: returns all bots with stats
 *
 * Source of truth: SQLite (trading_elo, trading_battles, api_bots)
 */
export async function GET(request: NextRequest) {
  let db: Database.Database | null = null;
  try {
    db = new Database(DB_PATH, { readonly: true });
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const tournamentId = searchParams.get('tournament_id');

    if (type === 'tournament' || tournamentId) {
      return getTournamentLeaderboard(db);
    }

    if (type === 'alltime') {
      return getAllTimeLeaderboard(db);
    }

    if (type === 'weekly') {
      return getWeeklyLeaderboard(db);
    }

    return getLegacyLeaderboard(db);
  } catch (err) {
    console.error('GET /api/nfa/trading/leaderboard error:', err);
    return NextResponse.json({ bots: [], entries: [], tournament: null });
  } finally {
    db?.close();
  }
}

function getTournamentLeaderboard(db: Database.Database) {
  // Read tournament metadata from tournament.json
  let tournament: any = null;
  if (fs.existsSync(TOURNAMENT_FILE)) {
    try {
      tournament = JSON.parse(fs.readFileSync(TOURNAMENT_FILE, 'utf8'));
    } catch { /* ignore parse errors */ }
  }

  if (!tournament) {
    return NextResponse.json({ tournament: null, entries: [] });
  }

  // Get participant bot_ids from tournament
  const participantIds: number[] = (tournament.participants || []).map((p: any) => p.id);

  if (participantIds.length === 0) {
    return NextResponse.json({ tournament, entries: [] });
  }

  // Get ELO stats for tournament participants from SQLite
  const placeholders = participantIds.map(() => '?').join(',');
  const entries = db.prepare(`
    SELECT
      te.bot_id,
      ab.name AS bot_name,
      te.elo,
      te.wins,
      te.losses,
      te.draws,
      te.total_pnl,
      te.best_trade,
      te.worst_trade,
      te.total_trades
    FROM trading_elo te
    JOIN api_bots ab ON te.bot_id = ab.id
    WHERE te.bot_id IN (${placeholders})
    ORDER BY te.total_pnl DESC
  `).all(...participantIds) as any[];

  // Build tournament participant map for nfa_id lookup
  const participantMap = new Map<number, any>();
  for (const p of (tournament.participants || [])) {
    participantMap.set(p.id, p);
  }

  const ranked = entries.map((e: any, i: number) => {
    const participant = participantMap.get(e.bot_id);
    return {
      rank: i + 1,
      bot_id: e.bot_id,
      nfa_id: participant?.nfa_id || null,
      bot_name: e.bot_name,
      strategy: participant?.strategy || 'default',
      pnl_usd: e.total_pnl,
      pnl_pct: e.total_pnl ? (e.total_pnl / 100) : 0,
      trades: e.total_trades,
      win_rate: e.total_trades > 0 ? ((e.wins / e.total_trades) * 100) : 0,
      elo: e.elo,
      updated_at: null,
    };
  });

  return NextResponse.json({ tournament, entries: ranked });
}

function getAllTimeLeaderboard(db: Database.Database) {
  const entries = db.prepare(`
    SELECT
      te.bot_id,
      ab.name AS bot_name,
      te.elo,
      te.wins,
      te.losses,
      te.draws,
      te.total_pnl,
      te.best_trade,
      te.worst_trade,
      te.total_trades,
      te.avg_profit,
      te.avg_loss
    FROM trading_elo te
    JOIN api_bots ab ON te.bot_id = ab.id
    ORDER BY te.total_pnl DESC
  `).all() as any[];

  const ranked = entries.map((e: any, i: number) => ({
    rank: i + 1,
    bot_id: e.bot_id,
    nfa_id: null,
    bot_name: e.bot_name,
    strategy: 'default',
    pnl_usd: e.total_pnl,
    pnl_pct: e.total_pnl ? (e.total_pnl / 100) : 0,
    trades: e.total_trades,
    win_rate: e.total_trades > 0 ? ((e.wins / e.total_trades) * 100) : 0,
    elo: e.elo,
  }));

  return NextResponse.json({ tournament: null, entries: ranked });
}

function getWeeklyLeaderboard(db: Database.Database) {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Aggregate PnL from resolved battles in last 7 days, per bot
  const rows = db.prepare(`
    SELECT bot_id, bot_name, SUM(pnl) as total_pnl, COUNT(*) as trades,
           SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins
    FROM (
      SELECT bot1_id AS bot_id, ab1.name AS bot_name, bot1_pnl AS pnl
      FROM trading_battles tb
      JOIN api_bots ab1 ON tb.bot1_id = ab1.id
      WHERE tb.status = 'resolved' AND tb.resolved_at >= ?
      UNION ALL
      SELECT bot2_id AS bot_id, ab2.name AS bot_name, bot2_pnl AS pnl
      FROM trading_battles tb
      JOIN api_bots ab2 ON tb.bot2_id = ab2.id
      WHERE tb.status = 'resolved' AND tb.resolved_at >= ?
    ) t
    GROUP BY bot_id
    ORDER BY total_pnl DESC
  `).all(weekAgo, weekAgo) as any[];

  const entries = rows.map((r: any, i: number) => ({
    rank: i + 1,
    bot_id: r.bot_id,
    nfa_id: null,
    bot_name: r.bot_name,
    strategy: 'default',
    pnl_usd: r.total_pnl,
    pnl_pct: (r.total_pnl / 100),
    trades: r.trades,
    win_rate: r.trades > 0 ? ((r.wins / r.trades) * 100) : 0,
  }));

  return NextResponse.json({ tournament: null, entries });
}

function getLegacyLeaderboard(db: Database.Database) {
  const bots = db.prepare(`
    SELECT
      ab.id,
      ab.name,
      ab.wallet_address AS trading_wallet_address,
      te.elo,
      te.wins,
      te.losses,
      te.draws,
      te.total_pnl,
      te.best_trade,
      te.worst_trade,
      te.total_trades,
      te.avg_profit,
      te.avg_loss
    FROM api_bots ab
    LEFT JOIN trading_elo te ON ab.id = te.bot_id
    ORDER BY te.total_pnl DESC NULLS LAST
  `).all() as any[];

  const result = bots.map((bot: any) => ({
    id: bot.id,
    nfa_id: null,
    name: bot.name,
    trading_wallet_address: bot.trading_wallet_address,
    trading_mode: 'paper',
    stats: bot.total_trades ? {
      total_pnl_usd: bot.total_pnl,
      total_trades: bot.total_trades,
      win_rate: bot.total_trades > 0 ? ((bot.wins / bot.total_trades) * 100) : 0,
      wins: bot.wins,
      losses: bot.losses,
      elo: bot.elo,
      best_trade: bot.best_trade,
      worst_trade: bot.worst_trade,
    } : null,
  }));

  return NextResponse.json({ bots: result });
}
