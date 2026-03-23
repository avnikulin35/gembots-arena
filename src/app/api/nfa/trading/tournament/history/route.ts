import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export const dynamic = 'force-dynamic';

const DB_PATH = path.join(process.cwd(), 'data/gembots.db');
const TOURNAMENT_FILE = path.join(process.cwd(), 'data', 'tournament.json');

/**
 * GET /api/nfa/trading/tournament/history
 * Returns past completed tournaments with their top-3 entries.
 * Source of truth: tournament.json (metadata) + SQLite (live PnL data)
 *
 * Note: Only the latest tournament state is persisted in tournament.json.
 * Completed tournaments are returned if the state file shows status=finished.
 */
export async function GET() {
  let db: Database.Database | null = null;
  try {
    if (!fs.existsSync(TOURNAMENT_FILE)) {
      return NextResponse.json({ tournaments: [] });
    }

    let tournament: any;
    try {
      tournament = JSON.parse(fs.readFileSync(TOURNAMENT_FILE, 'utf8'));
    } catch {
      return NextResponse.json({ tournaments: [] });
    }

    // Only show as history if the tournament is finished
    if (!tournament || tournament.status !== 'finished') {
      return NextResponse.json({ tournaments: [] });
    }

    const participantIds: number[] = (tournament.participants || []).map((p: any) => p.id);
    if (participantIds.length === 0) {
      return NextResponse.json({
        tournaments: [{ ...tournament, top3: [] }],
      });
    }

    db = new Database(DB_PATH, { readonly: true });

    // Get stats for participants
    const placeholders = participantIds.map(() => '?').join(',');
    const stats = db.prepare(`
      SELECT
        te.bot_id,
        ab.name AS bot_name,
        te.elo,
        te.wins,
        te.losses,
        te.total_pnl,
        te.total_trades
      FROM trading_elo te
      JOIN api_bots ab ON te.bot_id = ab.id
      WHERE te.bot_id IN (${placeholders})
      ORDER BY te.total_pnl DESC
      LIMIT 3
    `).all(...participantIds) as any[];

    const participantMap = new Map<number, any>();
    for (const p of (tournament.participants || [])) {
      participantMap.set(p.id, p);
    }

    const top3 = stats.map((s: any, i: number) => {
      const participant = participantMap.get(s.bot_id);
      return {
        rank: i + 1,
        bot_id: s.bot_id,
        nfa_id: participant?.nfa_id || null,
        bot_name: s.bot_name,
        tournament_pnl_usd: s.total_pnl,
        trades_count: s.total_trades,
        win_rate: s.total_trades > 0 ? ((s.wins / s.total_trades) * 100) : 0,
      };
    });

    return NextResponse.json({
      tournaments: [{
        ...tournament,
        top3,
      }],
    });
  } catch (err) {
    console.error('GET /api/nfa/trading/tournament/history error:', err);
    return NextResponse.json({ tournaments: [] });
  } finally {
    db?.close();
  }
}
