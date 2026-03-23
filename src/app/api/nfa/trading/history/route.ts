import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

export const dynamic = 'force-dynamic';

const DB_PATH = path.join(process.cwd(), 'data/gembots.db');

/**
 * GET /api/nfa/trading/history
 * Returns trade (battle) history for a specific bot.
 *
 * Query params:
 *   botId=X   — bot ID (api_bots.id) — preferred
 *   nfaId=X   — legacy alias, treated as botId for backward compat
 *   status=open|closed — filter by battle status (open=pending, closed=resolved)
 *   limit=50  — max results
 *   offset=0  — pagination offset
 *
 * Source of truth: SQLite trading_battles
 */
export async function GET(request: NextRequest) {
  let db: Database.Database | null = null;
  try {
    const botId = request.nextUrl.searchParams.get('botId')
      || request.nextUrl.searchParams.get('nfaId');
    const status = request.nextUrl.searchParams.get('status');
    const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') || '50'), 200);
    const offset = parseInt(request.nextUrl.searchParams.get('offset') || '0');

    if (!botId) {
      return NextResponse.json({ error: 'botId or nfaId is required' }, { status: 400 });
    }

    const id = parseInt(botId);
    db = new Database(DB_PATH, { readonly: true });

    // Map status param to SQLite battle status
    let statusFilter = '';
    const params: any[] = [id, id];

    if (status === 'open') {
      statusFilter = "AND tb.status IN ('pending', 'active')";
    } else if (status === 'closed') {
      statusFilter = "AND tb.status = 'resolved'";
    }

    // Count total matches
    const countResult = db.prepare(`
      SELECT COUNT(*) as total
      FROM trading_battles tb
      WHERE (tb.bot1_id = ? OR tb.bot2_id = ?) ${statusFilter}
    `).get(...params) as { total: number };
    const total = countResult.total;

    // Fetch battles with bot names
    const trades = db.prepare(`
      SELECT
        tb.id,
        tb.symbol,
        tb.entry_price,
        tb.exit_price,
        tb.started_at AS open_at,
        tb.resolved_at AS close_at,
        tb.status,
        tb.bot1_id, tb.bot2_id,
        tb.bot1_action, tb.bot2_action,
        tb.bot1_pnl, tb.bot2_pnl,
        tb.bot1_size, tb.bot2_size,
        tb.bot1_leverage, tb.bot2_leverage,
        tb.bot1_confidence, tb.bot2_confidence,
        tb.bot1_model, tb.bot2_model,
        tb.bot1_reasoning, tb.bot2_reasoning,
        tb.winner_id,
        ab1.name AS bot1_name,
        ab2.name AS bot2_name
      FROM trading_battles tb
      JOIN api_bots ab1 ON tb.bot1_id = ab1.id
      JOIN api_bots ab2 ON tb.bot2_id = ab2.id
      WHERE (tb.bot1_id = ? OR tb.bot2_id = ?) ${statusFilter}
      ORDER BY tb.started_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as any[];

    // Transform into per-bot trade view
    const transformedTrades = trades.map((t: any) => {
      const isBot1 = t.bot1_id === id;
      return {
        id: t.id,
        symbol: t.symbol,
        action: isBot1 ? t.bot1_action : t.bot2_action,
        size: isBot1 ? t.bot1_size : t.bot2_size,
        leverage: isBot1 ? t.bot1_leverage : t.bot2_leverage,
        confidence: isBot1 ? t.bot1_confidence : t.bot2_confidence,
        entry_price: t.entry_price,
        exit_price: t.exit_price,
        pnl_usd: isBot1 ? t.bot1_pnl : t.bot2_pnl,
        model: isBot1 ? t.bot1_model : t.bot2_model,
        reasoning: isBot1 ? t.bot1_reasoning : t.bot2_reasoning,
        open_at: t.open_at,
        close_at: t.close_at,
        status: t.status === 'resolved' ? 'closed' : 'open',
        opponent_id: isBot1 ? t.bot2_id : t.bot1_id,
        opponent_name: isBot1 ? t.bot2_name : t.bot1_name,
        won: t.winner_id === id,
      };
    });

    // Get bot's ELO stats as summary
    const eloStats = db.prepare(`
      SELECT te.*, ab.name AS bot_name
      FROM trading_elo te
      JOIN api_bots ab ON te.bot_id = ab.id
      WHERE te.bot_id = ?
    `).get(id) as any;

    const stats = eloStats ? {
      total_pnl_usd: eloStats.total_pnl,
      total_trades: eloStats.total_trades,
      wins: eloStats.wins,
      losses: eloStats.losses,
      draws: eloStats.draws,
      win_rate: eloStats.total_trades > 0 ? ((eloStats.wins / eloStats.total_trades) * 100) : 0,
      elo: eloStats.elo,
      best_trade: eloStats.best_trade,
      worst_trade: eloStats.worst_trade,
      avg_profit: eloStats.avg_profit,
      avg_loss: eloStats.avg_loss,
    } : null;

    return NextResponse.json({
      botId: id,
      nfaId: id,
      trades: transformedTrades,
      total,
      stats,
      pagination: {
        offset,
        limit,
        hasMore: total > offset + limit,
      },
    });
  } catch (err) {
    console.error('GET /api/nfa/trading/history error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    db?.close();
  }
}
