import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export const dynamic = 'force-dynamic';

const DB_PATH = path.join(process.cwd(), 'data/gembots.db');
const TOURNAMENT_FILE = path.join(process.cwd(), 'data', 'tournament.json');

/**
 * GET /api/nfa/trading/tournament
 * Returns the current/latest tournament + its entries ranked by PnL
 * Source of truth: tournament.json (metadata) + SQLite (live PnL data)
 */
export async function GET() {
  let db: Database.Database | null = null;
  try {
    // Read tournament state
    if (!fs.existsSync(TOURNAMENT_FILE)) {
      return NextResponse.json({ tournament: null, entries: [] });
    }

    let tournament: any;
    try {
      tournament = JSON.parse(fs.readFileSync(TOURNAMENT_FILE, 'utf8'));
    } catch {
      return NextResponse.json({ tournament: null, entries: [] });
    }

    if (!tournament) {
      return NextResponse.json({ tournament: null, entries: [] });
    }

    const participantIds: number[] = (tournament.participants || []).map((p: any) => p.id);
    if (participantIds.length === 0) {
      return NextResponse.json({ tournament, entries: [] });
    }

    db = new Database(DB_PATH, { readonly: true });

    // Get live ELO/PnL stats for tournament participants
    const placeholders = participantIds.map(() => '?').join(',');
    const stats = db.prepare(`
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
      WHERE te.bot_id IN (${placeholders})
      ORDER BY te.total_pnl DESC
    `).all(...participantIds) as any[];

    // Build participant map for extra metadata
    const participantMap = new Map<number, any>();
    for (const p of (tournament.participants || [])) {
      participantMap.set(p.id, p);
    }

    const entries = stats.map((s: any, i: number) => {
      const participant = participantMap.get(s.bot_id);
      return {
        rank: i + 1,
        bot_id: s.bot_id,
        nfa_id: participant?.nfa_id || null,
        bot_name: s.bot_name,
        strategy: participant?.trading_style || 'default',
        ai_model: participant?.ai_model || null,
        tournament_pnl_usd: s.total_pnl,
        tournament_pnl_pct: s.total_pnl ? (s.total_pnl / 100) : 0,
        trades_count: s.total_trades,
        win_rate: s.total_trades > 0 ? ((s.wins / s.total_trades) * 100) : 0,
        elo: s.elo,
        wins: s.wins,
        losses: s.losses,
        draws: s.draws,
        best_trade: s.best_trade,
        worst_trade: s.worst_trade,
      };
    });

    return NextResponse.json({ tournament, entries });
  } catch (err) {
    console.error('GET /api/nfa/trading/tournament error:', err);
    return NextResponse.json({ tournament: null, entries: [] });
  } finally {
    db?.close();
  }
}
