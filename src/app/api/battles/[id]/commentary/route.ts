import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

export const dynamic = 'force-dynamic';

const DB_PATH = path.join(process.cwd(), 'data/gembots.db');

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let db: InstanceType<typeof Database> | null = null;
  try {
    db = new Database(DB_PATH, { readonly: true });

    const battle = db.prepare(`
      SELECT
        t.id,
        t.symbol,
        t.commentary,
        t.resolved_at,
        b1.name AS bot1_name,
        b2.name AS bot2_name,
        CASE WHEN t.winner_id = t.bot1_id THEN b1.name
             WHEN t.winner_id = t.bot2_id THEN b2.name
             ELSE NULL END AS winner_name
      FROM trading_battles t
      JOIN api_bots b1 ON b1.id = t.bot1_id
      JOIN api_bots b2 ON b2.id = t.bot2_id
      WHERE t.id = ?
    `).get(id) as { id: string; symbol: string; commentary: string | null; resolved_at: string; bot1_name: string; bot2_name: string; winner_name: string | null } | undefined;

    if (!battle) {
      return NextResponse.json({ success: false, error: 'Battle not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      id: battle.id,
      symbol: battle.symbol,
      commentary: battle.commentary,
      bot1_name: battle.bot1_name,
      bot2_name: battle.bot2_name,
      winner_name: battle.winner_name,
      resolved_at: battle.resolved_at,
    });
  } catch (err: unknown) {
    console.error('[API /battles/:id/commentary]', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  } finally {
    db?.close();
  }
}
