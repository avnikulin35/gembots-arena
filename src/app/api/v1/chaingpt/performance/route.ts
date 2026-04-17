import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export const dynamic = 'force-dynamic';

const DB_PATH = path.join(process.cwd(), 'data/gembots.db');
const CHAINGPT_MODEL = 'chaingpt/general_assistant';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * Public ChainGPT performance API for ecosystem integration
 * GET /api/v1/chaingpt/performance
 */
export async function GET() {
  let db: Database.Database | null = null;
  try {
    db = new Database(DB_PATH, { readonly: true });

    // Overall stats
    const stats = db.prepare(`
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
        FROM trading_battles WHERE status = 'resolved' AND bot1_model = ?
        UNION ALL
        SELECT bot2_pnl as pnl,
          CASE WHEN winner_id = bot2_id THEN 1 ELSE 0 END as won,
          CASE WHEN winner_id IS NULL THEN 1 ELSE 0 END as draw
        FROM trading_battles WHERE status = 'resolved' AND bot2_model = ?
      ) t
    `).get(CHAINGPT_MODEL, CHAINGPT_MODEL) as any;

    // Per-symbol breakdown
    const symbolStats = db.prepare(`
      SELECT symbol,
        COUNT(*) as battles,
        SUM(CASE WHEN won = 1 THEN 1 ELSE 0 END) as wins,
        ROUND(AVG(pnl), 4) as avg_pnl
      FROM (
        SELECT b.symbol, bot1_pnl as pnl,
          CASE WHEN winner_id = bot1_id THEN 1 ELSE 0 END as won
        FROM trading_battles b WHERE status = 'resolved' AND bot1_model = ?
        UNION ALL
        SELECT b.symbol, bot2_pnl as pnl,
          CASE WHEN winner_id = bot2_id THEN 1 ELSE 0 END as won
        FROM trading_battles b WHERE status = 'resolved' AND bot2_model = ?
      ) t GROUP BY symbol ORDER BY battles DESC
    `).all(CHAINGPT_MODEL, CHAINGPT_MODEL) as any[];

    // 24h stats
    const since24h = new Date(Date.now() - 86400000).toISOString();
    const stats24h = db.prepare(`
      SELECT COUNT(*) as battles,
        SUM(CASE WHEN won = 1 THEN 1 ELSE 0 END) as wins
      FROM (
        SELECT CASE WHEN winner_id = bot1_id THEN 1 ELSE 0 END as won
        FROM trading_battles WHERE status = 'resolved' AND bot1_model = ? AND resolved_at >= ?
        UNION ALL
        SELECT CASE WHEN winner_id = bot2_id THEN 1 ELSE 0 END as won
        FROM trading_battles WHERE status = 'resolved' AND bot2_model = ? AND resolved_at >= ?
      ) t
    `).get(CHAINGPT_MODEL, since24h, CHAINGPT_MODEL, since24h) as any;

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

    // Model ranking
    const modelRanks = db.prepare(`
      SELECT model, ROUND(SUM(pnl), 2) as total_pnl FROM (
        SELECT bot1_model as model, bot1_pnl as pnl FROM trading_battles WHERE status = 'resolved' AND bot1_model IS NOT NULL
        UNION ALL
        SELECT bot2_model as model, bot2_pnl as pnl FROM trading_battles WHERE status = 'resolved' AND bot2_model IS NOT NULL
      ) t GROUP BY model ORDER BY total_pnl DESC
    `).all() as any[];
    const ranking = modelRanks.findIndex(m => m.model === CHAINGPT_MODEL) + 1;

    // API usage
    let apiUsage: any = {};
    try {
      const reportPath = path.join(process.cwd(), 'data', 'chaingpt-report.json');
      if (fs.existsSync(reportPath)) apiUsage = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    } catch {}

    const battles = stats?.battles || 0;
    const wins = stats?.wins || 0;
    const winRate = battles > 0 ? Math.round((wins / battles) * 1000) / 10 : 0;
    const avgPnl = stats?.avg_pnl || 0;
    const allAvgWinRate = allAvg?.avg_win_rate || 0;
    const allAvgPnl = allAvg?.avg_pnl || 0;

    return NextResponse.json({
      meta: {
        source: 'GemBots Arena',
        model: 'ChainGPT (general_assistant)',
        features: ['on-chain intelligence', 'whale tracking', 'smart money flows', 'sentiment analysis'],
        url: 'https://gembots.space/chaingpt',
        embed: 'https://gembots.space/embed/widget.js',
        updated_at: new Date().toISOString(),
      },
      performance: {
        total_battles: battles,
        wins, losses: stats?.losses || 0, draws: stats?.draws || 0,
        win_rate: winRate,
        avg_pnl: avgPnl,
        total_pnl: stats?.total_pnl || 0,
        best_trade: stats?.best_trade || 0,
        worst_trade: stats?.worst_trade || 0,
        ranking: ranking || modelRanks.length + 1,
        total_models: modelRanks.length,
      },
      last_24h: {
        battles: stats24h?.battles || 0,
        wins: stats24h?.wins || 0,
        win_rate: stats24h?.battles > 0
          ? Math.round((stats24h.wins / stats24h.battles) * 1000) / 10
          : 0,
      },
      by_symbol: symbolStats.map(s => ({
        symbol: s.symbol,
        battles: s.battles,
        wins: s.wins,
        win_rate: s.battles > 0 ? Math.round((s.wins / s.battles) * 1000) / 10 : 0,
        avg_pnl: s.avg_pnl,
      })),
      vs_avg: {
        win_rate: Math.round((winRate - allAvgWinRate) * 10) / 10,
        avg_pnl: Math.round((avgPnl - allAvgPnl) * 10000) / 10000,
      },
      api_usage: {
        total_credits: 1500000,
        used: apiUsage.totalCalls || apiUsage.apiCalls || 0,
      },
    }, { headers: CORS_HEADERS });
  } catch (error: any) {
    console.error('v1/chaingpt/performance error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500, headers: CORS_HEADERS });
  } finally {
    if (db) db.close();
  }
}
