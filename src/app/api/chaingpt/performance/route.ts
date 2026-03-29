import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export const dynamic = 'force-dynamic';

const DB_PATH = path.join(process.cwd(), 'data/gembots.db');
const CHAINGPT_MODEL = 'chaingpt/general_assistant';

export async function GET() {
  let db: Database.Database | null = null;
  try {
    if (!fs.existsSync(DB_PATH)) {
      return NextResponse.json({ error: 'Database not found' }, { status: 404 });
    }

    db = new Database(DB_PATH, { readonly: true });

    // ChainGPT battle stats
    const cgStats = db.prepare(`
      SELECT
        COUNT(*) as battles,
        SUM(CASE WHEN won = 1 THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN won = 0 AND draw = 0 THEN 1 ELSE 0 END) as losses,
        SUM(CASE WHEN draw = 1 THEN 1 ELSE 0 END) as draws,
        ROUND(AVG(pnl), 4) as avg_pnl,
        ROUND(SUM(pnl), 2) as total_pnl,
        ROUND(MAX(pnl), 2) as best_trade,
        ROUND(MIN(pnl), 2) as worst_trade
      FROM (
        SELECT bot1_pnl as pnl,
          CASE WHEN winner_id = bot1_id THEN 1 ELSE 0 END as won,
          CASE WHEN winner_id IS NULL THEN 1 ELSE 0 END as draw
        FROM trading_battles
        WHERE status = 'resolved' AND bot1_model = ?
        UNION ALL
        SELECT bot2_pnl as pnl,
          CASE WHEN winner_id = bot2_id THEN 1 ELSE 0 END as won,
          CASE WHEN winner_id IS NULL THEN 1 ELSE 0 END as draw
        FROM trading_battles
        WHERE status = 'resolved' AND bot2_model = ?
      ) t
    `).get(CHAINGPT_MODEL, CHAINGPT_MODEL) as any;

    // Average stats across all models for comparison
    const allAvg = db.prepare(`
      SELECT
        ROUND(100.0 * SUM(CASE WHEN won = 1 THEN 1 ELSE 0 END) / MAX(COUNT(*), 1), 1) as avg_win_rate,
        ROUND(AVG(pnl), 4) as avg_pnl
      FROM (
        SELECT bot1_pnl as pnl,
          CASE WHEN winner_id = bot1_id THEN 1 ELSE 0 END as won
        FROM trading_battles WHERE status = 'resolved' AND bot1_model IS NOT NULL
        UNION ALL
        SELECT bot2_pnl as pnl,
          CASE WHEN winner_id = bot2_id THEN 1 ELSE 0 END as won
        FROM trading_battles WHERE status = 'resolved' AND bot2_model IS NOT NULL
      ) t
    `).get() as any;

    // Model ranking (by total_pnl)
    const modelRanks = db.prepare(`
      SELECT model, ROUND(SUM(pnl), 2) as total_pnl
      FROM (
        SELECT bot1_model as model, bot1_pnl as pnl
        FROM trading_battles WHERE status = 'resolved' AND bot1_model IS NOT NULL
        UNION ALL
        SELECT bot2_model as model, bot2_pnl as pnl
        FROM trading_battles WHERE status = 'resolved' AND bot2_model IS NOT NULL
      ) t
      GROUP BY model
      ORDER BY total_pnl DESC
    `).all() as any[];

    const ranking = modelRanks.findIndex((m: any) => m.model === CHAINGPT_MODEL) + 1;
    const totalModels = modelRanks.length;

    // API calls from chaingpt-report.json
    let apiCalls = 0;
    try {
      const reportPath = path.join(process.cwd(), 'data', 'chaingpt-report.json');
      if (fs.existsSync(reportPath)) {
        const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
        apiCalls = report.apiCalls || report.totalCalls || 0;
      }
    } catch {
      // Mock fallback
    }

    const battles = cgStats?.battles || 0;
    const wins = cgStats?.wins || 0;
    const losses = cgStats?.losses || 0;
    const draws = cgStats?.draws || 0;
    const winRate = battles > 0 ? (wins / battles) * 100 : 0;
    const avgPnl = cgStats?.avg_pnl || 0;
    const allAvgWinRate = allAvg?.avg_win_rate || 0;
    const allAvgPnl = allAvg?.avg_pnl || 0;

    return NextResponse.json({
      totalBattles: battles,
      wins,
      losses,
      draws,
      winRate: Math.round(winRate * 10) / 10,
      avgPnl,
      totalPnl: cgStats?.total_pnl || 0,
      bestTrade: cgStats?.best_trade || 0,
      worstTrade: cgStats?.worst_trade || 0,
      ranking: ranking || totalModels + 1,
      totalModels,
      vsAvg: {
        winRate: Math.round((winRate - allAvgWinRate) * 10) / 10,
        avgPnl: Math.round((avgPnl - allAvgPnl) * 10000) / 10000,
      },
      apiCalls,
    });
  } catch (error: any) {
    console.error('Error fetching ChainGPT performance:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    if (db) db.close();
  }
}
