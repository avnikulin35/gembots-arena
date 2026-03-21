import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

export const dynamic = 'force-dynamic';

const DB_PATH = path.join(process.cwd(), 'data/gembots.db');

export async function GET() {
  let db: InstanceType<typeof Database> | null = null;
  try {
    db = new Database(DB_PATH, { readonly: true });

    const battles = db.prepare(`
      SELECT
        t.id,
        t.symbol,
        t.entry_price,
        t.exit_price,
        t.started_at,
        t.resolved_at,
        t.status,
        t.bot1_action,
        t.bot1_confidence,
        t.bot1_leverage,
        t.bot1_pnl,
        t.bot1_model,
        t.bot2_action,
        t.bot2_confidence,
        t.bot2_leverage,
        t.bot2_pnl,
        t.bot2_model,
        t.commentary,
        b1.name AS bot1_name,
        b2.name AS bot2_name,
        CASE WHEN t.winner_id = t.bot1_id THEN b1.name
             WHEN t.winner_id = t.bot2_id THEN b2.name
             ELSE NULL END AS winner_name
      FROM trading_battles t
      JOIN api_bots b1 ON b1.id = t.bot1_id
      JOIN api_bots b2 ON b2.id = t.bot2_id
      WHERE t.status = 'resolved'
      ORDER BY t.resolved_at DESC
      LIMIT 10
    `).all();

    return NextResponse.json({ success: true, battles });
  } catch (err: unknown) {
    console.error('[API /battles/latest]', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  } finally {
    db?.close();
  }
}
