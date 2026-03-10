import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

export const dynamic = 'force-dynamic';

const DB_PATH = path.join(process.cwd(), 'data/gembots.db');

export async function GET() {
  let db: Database.Database | null = null;
  try {
    db = new Database(DB_PATH, { readonly: true });

    const bots = db.prepare(`
      SELECT 
        b.id,
        b.name,
        b.strategy,
        b.nfa_id,
        b.league,
        b.hp,
        COALESCE(e.wins, 0) as wins,
        COALESCE(e.losses, 0) as losses,
        COALESCE(e.draws, 0) as draws,
        COALESCE(e.wins + e.losses + e.draws, 0) as total_battles,
        COALESCE(e.elo, 1500) as elo,
        COALESCE(e.total_pnl, 0) as total_pnl,
        COALESCE(e.best_trade, 0) as best_trade,
        COALESCE(e.worst_trade, 0) as worst_trade
      FROM api_bots b
      LEFT JOIN trading_elo e ON e.bot_id = b.id
      ORDER BY e.elo DESC
    `).all();

    return NextResponse.json({ bots });
  } catch (e) {
    return NextResponse.json({ bots: [], error: (e as Error).message }, { status: 500 });
  } finally {
    db?.close();
  }
}
