import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

export const dynamic = 'force-dynamic'; // Ensure dynamic rendering

const DB_PATH = path.join(process.cwd(), 'data/gembots.db');

interface BattleResult {
  id: number;
  bot1_id: number;
  bot2_id: number;
  symbol: string;
  entry_price: number;
  bot1_action: string;
  bot2_action: string;
  leverage: number;
  pnl_bot1: number | null;
  pnl_bot2: number | null;
  created_at: string;
  resolved_at: string | null;
  status: string;
  bot1_name?: string;
  bot2_name?: string;
}

interface TradingElo {
  bot_id: number;
  elo: number;
  wins: number;
  losses: number;
  draws: number;
  total_pnl: number;
  best_trade: number;
  worst_trade: number;
  name: string;
}

export async function GET() {
  let db: Database.Database | null = null;
  try {
    db = new Database(DB_PATH, { readonly: true });

    // Leaderboard: trading_elo JOIN api_bots (top 20)
    const leaderboardQuery = db.prepare(`
      SELECT
        t.bot_id,
        t.elo,
        t.wins,
        t.losses,
        t.draws,
        t.total_pnl,
        t.best_trade,
        t.worst_trade,
        ab.name
      FROM trading_elo t
      JOIN api_bots ab ON t.bot_id = ab.id
      ORDER BY t.elo DESC
      LIMIT 20;
    `);
    const leaderboard: TradingElo[] = leaderboardQuery.all() as TradingElo[];

    // Recent Battles: последние 10 resolved trading_battles с именами ботов
    const recentBattlesQuery = db.prepare(`
      SELECT
        tb.*,
        ab1.name AS bot1_name,
        ab2.name AS bot2_name
      FROM trading_battles tb
      JOIN api_bots ab1 ON tb.bot1_id = ab1.id
      JOIN api_bots ab2 ON tb.bot2_id = ab2.id
      WHERE tb.status = 'resolved'
      ORDER BY tb.resolved_at DESC
      LIMIT 10;
    `);
    const recentBattles: BattleResult[] = recentBattlesQuery.all() as BattleResult[];

    // Active Battles: текущие pending бои
    const activeBattlesQuery = db.prepare(`
      SELECT
        tb.*,
        ab1.name AS bot1_name,
        ab2.name AS bot2_name
      FROM trading_battles tb
      JOIN api_bots ab1 ON tb.bot1_id = ab1.id
      JOIN api_bots ab2 ON tb.bot2_id = ab2.id
      WHERE tb.status = 'pending'
      ORDER BY tb.started_at DESC;
    `);
    const activeBattles: BattleResult[] = activeBattlesQuery.all() as BattleResult[];

    // Stats: { totalBattles, avgPnl, bestTrade, worstTrade, modelsCount }
    const totalBattlesQuery = db.prepare(`SELECT COUNT(*) as total FROM trading_battles;`);
    const totalBattles = (totalBattlesQuery.get() as { total: number }).total;

    const avgPnlQuery = db.prepare(`
      SELECT AVG(pnl) AS avg_pnl FROM (
        SELECT bot1_pnl AS pnl FROM trading_battles WHERE bot1_pnl IS NOT NULL
        UNION ALL
        SELECT bot2_pnl AS pnl FROM trading_battles WHERE bot2_pnl IS NOT NULL
      );
    `);
    const avgPnl = (avgPnlQuery.get() as { avg_pnl: number | null }).avg_pnl || 0;

    const bestTradeQuery = db.prepare(`
      SELECT MAX(pnl) AS best_pnl FROM (
        SELECT bot1_pnl AS pnl FROM trading_battles WHERE bot1_pnl IS NOT NULL
        UNION ALL
        SELECT bot2_pnl AS pnl FROM trading_battles WHERE bot2_pnl IS NOT NULL
      );
    `);
    const bestTrade = (bestTradeQuery.get() as { best_pnl: number | null }).best_pnl || 0;

    const worstTradeQuery = db.prepare(`
      SELECT MIN(pnl) AS worst_pnl FROM (
        SELECT bot1_pnl AS pnl FROM trading_battles WHERE bot1_pnl IS NOT NULL
        UNION ALL
        SELECT bot2_pnl AS pnl FROM trading_battles WHERE bot2_pnl IS NOT NULL
      );
    `);
    const worstTrade = (worstTradeQuery.get() as { worst_pnl: number | null }).worst_pnl || 0;

    const modelsCountQuery = db.prepare(`
      SELECT COUNT(DISTINCT model) as count FROM (
        SELECT bot1_model as model FROM trading_battles WHERE bot1_model IS NOT NULL
        UNION
        SELECT bot2_model FROM trading_battles WHERE bot2_model IS NOT NULL
      );
    `);
    const modelsCount = (modelsCountQuery.get() as { count: number }).count;

    // Model Leaderboard: aggregate stats per AI model
    const modelLeaderboardQuery = db.prepare(`
      SELECT
        model,
        COUNT(*) as battles,
        SUM(CASE WHEN won=1 THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN won=0 AND draw=0 THEN 1 ELSE 0 END) as losses,
        SUM(CASE WHEN draw=1 THEN 1 ELSE 0 END) as draws,
        ROUND(100.0 * SUM(CASE WHEN won=1 THEN 1 ELSE 0 END) / COUNT(*), 1) as win_rate,
        ROUND(AVG(pnl), 4) as avg_pnl,
        ROUND(SUM(pnl), 2) as total_pnl,
        ROUND(MAX(pnl), 2) as best_trade,
        ROUND(MIN(pnl), 2) as worst_trade
      FROM (
        SELECT bot1_model as model, bot1_pnl as pnl,
          CASE WHEN winner_id=bot1_id THEN 1 ELSE 0 END as won,
          CASE WHEN winner_id IS NULL THEN 1 ELSE 0 END as draw
        FROM trading_battles WHERE status='resolved' AND bot1_model IS NOT NULL
        UNION ALL
        SELECT bot2_model as model, bot2_pnl as pnl,
          CASE WHEN winner_id=bot2_id THEN 1 ELSE 0 END as won,
          CASE WHEN winner_id IS NULL THEN 1 ELSE 0 END as draw
        FROM trading_battles WHERE status='resolved' AND bot2_model IS NOT NULL
      ) t
      GROUP BY model
      ORDER BY win_rate DESC, total_pnl DESC;
    `);
    const modelLeaderboard = modelLeaderboardQuery.all();

    const stats = {
      totalBattles,
      avgPnl,
      bestTrade,
      worstTrade,
      modelsCount,
    };

    return NextResponse.json({
      leaderboard,
      modelLeaderboard,
      recentBattles,
      activeBattles,
      stats,
    });
  } catch (error: any) {
    console.error('Error fetching trading league data:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    if (db) {
      db.close();
    }
  }
}
