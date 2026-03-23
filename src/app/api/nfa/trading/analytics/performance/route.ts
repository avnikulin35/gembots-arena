import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

export const dynamic = 'force-dynamic';

const DB_PATH = path.join(process.cwd(), 'data/gembots.db');

/**
 * GET /api/nfa/trading/analytics/performance
 *
 * Returns top performers leaderboard with detailed stats.
 * Query params:
 *   limit=20 (default)
 *   sort=pnl (default) | trades | winrate | elo
 *
 * Source of truth: SQLite (trading_elo + api_bots)
 */
export async function GET(request: NextRequest) {
  let db: Database.Database | null = null;
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);
    const sort = searchParams.get('sort') || 'pnl';

    db = new Database(DB_PATH, { readonly: true });

    const rows = db.prepare(`
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
      WHERE te.total_trades > 0
      ORDER BY te.total_pnl DESC
    `).all() as any[];

    if (rows.length === 0) {
      return NextResponse.json({ performers: [], total: 0 });
    }

    let performers = rows.map((r: any, i: number) => ({
      rank: i + 1,
      nfaId: r.bot_id,
      botName: r.bot_name,
      strategy: 'default',
      tradingMode: 'paper',
      totalPnlUsd: r.total_pnl,
      totalTrades: r.total_trades,
      winRate: r.total_trades > 0 ? parseFloat(((r.wins / r.total_trades) * 100).toFixed(1)) : 0,
      winningTrades: r.wins,
      losingTrades: r.losses,
      bestTradePnl: r.best_trade,
      worstTradePnl: r.worst_trade,
      sharpeRatio: 0,
      maxDrawdownPct: 0,
      avgPnlPct: 0,
      avgHoldMinutes: 15,
      currentStreak: 0,
      bestStreak: 0,
      paperBalance: 10000 + r.total_pnl,
      elo: r.elo,
      commissionsBnb: 0,
      commissionsUsd: 0,
      commissionCount: 0,
    }));

    // Sort based on parameter
    switch (sort) {
      case 'trades':
        performers.sort((a, b) => b.totalTrades - a.totalTrades);
        break;
      case 'winrate':
        performers.sort((a, b) => b.winRate - a.winRate);
        break;
      case 'elo':
        performers.sort((a, b) => b.elo - a.elo);
        break;
      default: // pnl
        performers.sort((a, b) => b.totalPnlUsd - a.totalPnlUsd);
    }

    performers = performers.slice(0, limit).map((p, i) => ({ ...p, rank: i + 1 }));

    return NextResponse.json({
      performers,
      total: rows.length,
      sort,
    });
  } catch (err) {
    console.error('GET /api/nfa/trading/analytics/performance error:', err);
    return NextResponse.json({ error: 'Failed to fetch performance data' }, { status: 500 });
  } finally {
    db?.close();
  }
}
