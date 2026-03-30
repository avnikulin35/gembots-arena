import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

export const dynamic = 'force-dynamic';

function getDb() {
  const Database = require('better-sqlite3');
  return new Database(path.join(process.cwd(), 'data', 'gembots.db'));
}

export async function GET(req: NextRequest) {
  let db: any;
  try {
    db = getDb();

    const bots = db.prepare(`
      SELECT 
        ab.id, ab.name, ab.league, ab.win_streak, ab.avatar_state,
        COALESCE(te.elo, 1500) as elo,
        COALESCE(te.wins, 0) as wins,
        COALESCE(te.losses, 0) as losses,
        COALESCE(te.draws, 0) as draws,
        COALESCE(te.total_pnl, 0) as total_pnl,
        COALESCE(te.best_trade, 0) as best_trade,
        COALESCE(te.worst_trade, 0) as worst_trade,
        COALESCE(te.total_trades, 0) as total_trades
      FROM api_bots ab
      LEFT JOIN trading_elo te ON ab.id = te.bot_id
      ORDER BY COALESCE(te.elo, 1500) DESC
      LIMIT 50
    `).all();

    // Get most recent model used per bot from trading_battles
    const modelMap: Record<number, string> = {};
    try {
      const models = db.prepare(`
        SELECT bot_id, model FROM (
          SELECT bot1_id as bot_id, bot1_model as model, resolved_at FROM trading_battles WHERE bot1_model IS NOT NULL
          UNION ALL
          SELECT bot2_id as bot_id, bot2_model as model, resolved_at FROM trading_battles WHERE bot2_model IS NOT NULL
        ) ORDER BY resolved_at DESC
      `).all();
      for (const m of models) {
        if (!modelMap[m.bot_id]) modelMap[m.bot_id] = m.model;
      }
    } catch {}

    const processedBots = bots
      .map((bot: any) => {
        const totalBattles = (bot.wins || 0) + (bot.losses || 0) + (bot.draws || 0);
        const winRate = totalBattles > 0
          ? Math.round((bot.wins / totalBattles) * 100)
          : 0;

        return {
          id: bot.id,
          name: bot.name || 'Unknown Bot',
          wins: bot.wins || 0,
          losses: bot.losses || 0,
          draws: bot.draws || 0,
          totalBattles,
          winRate,
          league: bot.league || 'bronze',
          hp: 100,
          elo: Math.round(bot.elo * 100) / 100,
          peakElo: Math.round(bot.elo * 100) / 100,
          winStreak: bot.win_streak || 0,
          aiModel: modelMap[bot.id] || null,
          totalPnl: Math.round(bot.total_pnl * 100) / 100,
          bestTrade: Math.round(bot.best_trade * 10000) / 10000,
          worstTrade: Math.round(bot.worst_trade * 10000) / 10000,
        };
      })
      .filter((bot: any) => bot.totalBattles >= 1)
      .slice(0, 20);

    const totalBots = bots.length;
    const totalBattles = processedBots.reduce((sum: number, bot: any) => sum + bot.totalBattles, 0) / 2; // each battle counted twice
    const topWinRate = processedBots.length > 0 ? processedBots[0].winRate : 0;

    db.close();

    return NextResponse.json({
      leaderboard: processedBots,
      stats: {
        totalBots,
        totalBattles: Math.round(totalBattles),
        topWinRate,
      }
    });
  } catch (error) {
    console.error('Leaderboard API error:', error instanceof Error ? error.message : error, error instanceof Error ? error.stack : '');
    if (db) try { db.close(); } catch {}
    return NextResponse.json({ error: 'Failed to fetch leaderboard', detail: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
