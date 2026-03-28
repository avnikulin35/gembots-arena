import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'gembots.db');

export const revalidate = 60; // Cache for 1 minute

export async function GET() {
  const db = new Database(DB_PATH, { readonly: true });
  try {
    const since24h = new Date(Date.now() - 24 * 3600000).toISOString();

    // Total battles
    const { total_battles } = db.prepare(
      `SELECT COUNT(*) as total_battles FROM trading_battles WHERE status = 'resolved'`
    ).get() as { total_battles: number };

    // Battles last 24h
    const { battles_24h } = db.prepare(
      `SELECT COUNT(*) as battles_24h FROM trading_battles WHERE status = 'resolved' AND resolved_at >= ?`
    ).get(since24h) as { battles_24h: number };

    // Active bots (bots that have participated in a battle in last 24h)
    const { active_bots } = db.prepare(`
      SELECT COUNT(DISTINCT bot_id) as active_bots FROM (
        SELECT bot1_id as bot_id FROM trading_battles WHERE resolved_at >= ?
        UNION
        SELECT bot2_id as bot_id FROM trading_battles WHERE resolved_at >= ?
      )
    `).get(since24h, since24h) as { active_bots: number };

    // Top 5 bots by ELO
    const topBots = db.prepare(`
      SELECT ab.name, te.elo, te.wins, te.losses, te.total_pnl
      FROM trading_elo te
      JOIN api_bots ab ON ab.id = te.bot_id
      ORDER BY te.elo DESC
      LIMIT 5
    `).all() as { name: string; elo: number; wins: number; losses: number; total_pnl: number }[];

    // Model performance breakdown
    const modelStats = db.prepare(`
      SELECT model, SUM(wins) as wins, SUM(total) as total FROM (
        SELECT bot1_model as model,
          SUM(CASE WHEN winner_id = bot1_id THEN 1 ELSE 0 END) as wins,
          COUNT(*) as total
        FROM trading_battles
        WHERE status = 'resolved'
        GROUP BY bot1_model
        UNION ALL
        SELECT bot2_model as model,
          SUM(CASE WHEN winner_id = bot2_id THEN 1 ELSE 0 END) as wins,
          COUNT(*) as total
        FROM trading_battles
        WHERE status = 'resolved'
        GROUP BY bot2_model
      )
      GROUP BY model
      ORDER BY CAST(wins AS REAL) / MAX(total, 1) DESC
    `).all() as { model: string; wins: number; total: number }[];

    const modelPerformance = modelStats
      .filter(m => m.model)
      .map(m => ({
        model: m.model,
        wins: m.wins,
        total: m.total,
        winRate: +(m.wins / Math.max(m.total, 1) * 100).toFixed(1),
      }));

    // Symbol breakdown
    const symbolStats = db.prepare(`
      SELECT symbol,
        COUNT(*) as total,
        SUM(CASE WHEN winner_id = bot1_id THEN 1 ELSE 0 END) as bot1_wins,
        SUM(CASE WHEN winner_id = bot2_id THEN 1 ELSE 0 END) as bot2_wins,
        SUM(CASE WHEN winner_id IS NULL OR winner_id = '' THEN 1 ELSE 0 END) as draws
      FROM trading_battles
      WHERE status = 'resolved'
      GROUP BY symbol
      ORDER BY total DESC
    `).all() as { symbol: string; total: number; bot1_wins: number; bot2_wins: number; draws: number }[];

    const symbolBreakdown = symbolStats
      .filter(s => s.symbol)
      .map(s => ({
        symbol: s.symbol,
        totalBattles: s.total,
        draws: s.draws,
        decisiveRate: +((s.bot1_wins + s.bot2_wins) / Math.max(s.total, 1) * 100).toFixed(1),
      }));

    return NextResponse.json({
      totalBattles: total_battles,
      battles24h: battles_24h,
      activeBots: active_bots,
      topBots,
      modelPerformance,
      symbolBreakdown,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    db.close();
  }
}
