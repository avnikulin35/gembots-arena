import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

export const dynamic = 'force-dynamic';

const DB_PATH = path.join(process.cwd(), 'data/gembots.db');

export async function GET() {
  let db: Database.Database | null = null;
  try {
    db = new Database(DB_PATH, { readonly: true });

    // Total battles in last 24h
    const totalBattles = (db.prepare(`
      SELECT COUNT(*) as total FROM trading_battles
      WHERE started_at >= datetime('now', '-24 hours')
    `).get() as { total: number }).total;

    const resolvedBattles = (db.prepare(`
      SELECT COUNT(*) as total FROM trading_battles
      WHERE status = 'resolved' AND resolved_at >= datetime('now', '-24 hours')
    `).get() as { total: number }).total;

    // Top bot by ELO (with PnL)
    const topBot = db.prepare(`
      SELECT ab.name, t.elo, t.total_pnl as pnl
      FROM trading_elo t
      JOIN api_bots ab ON t.bot_id = ab.id
      ORDER BY t.elo DESC
      LIMIT 1
    `).get() as { name: string; elo: number; pnl: number } | undefined;

    // Worst bot by ELO
    const worstBot = db.prepare(`
      SELECT ab.name, t.elo, t.total_pnl as pnl
      FROM trading_elo t
      JOIN api_bots ab ON t.bot_id = ab.id
      WHERE (t.wins + t.losses + t.draws) > 0
      ORDER BY t.elo ASC
      LIMIT 1
    `).get() as { name: string; elo: number; pnl: number } | undefined;

    // Model rankings (24h)
    const modelRankings = db.prepare(`
      SELECT
        model,
        COUNT(*) as battles,
        ROUND(100.0 * SUM(CASE WHEN won = 1 THEN 1 ELSE 0 END) / COUNT(*), 1) as win_rate,
        ROUND(AVG(pnl), 4) as avg_pnl
      FROM (
        SELECT bot1_model as model, bot1_pnl as pnl,
          CASE WHEN winner_id = bot1_id THEN 1 ELSE 0 END as won
        FROM trading_battles
        WHERE status = 'resolved' AND bot1_model IS NOT NULL
          AND resolved_at >= datetime('now', '-24 hours')
        UNION ALL
        SELECT bot2_model as model, bot2_pnl as pnl,
          CASE WHEN winner_id = bot2_id THEN 1 ELSE 0 END as won
        FROM trading_battles
        WHERE status = 'resolved' AND bot2_model IS NOT NULL
          AND resolved_at >= datetime('now', '-24 hours')
      ) t
      GROUP BY model
      ORDER BY win_rate DESC, avg_pnl DESC
    `).all() as { model: string; battles: number; win_rate: number; avg_pnl: number }[];

    // Best trade (24h)
    const bestTrade = db.prepare(`
      SELECT bot_name, symbol, pnl, timestamp FROM (
        SELECT ab.name as bot_name, tb.symbol, tb.bot1_pnl as pnl, tb.resolved_at as timestamp
        FROM trading_battles tb
        JOIN api_bots ab ON tb.bot1_id = ab.id
        WHERE tb.status = 'resolved' AND tb.bot1_pnl IS NOT NULL
          AND tb.resolved_at >= datetime('now', '-24 hours')
        UNION ALL
        SELECT ab.name as bot_name, tb.symbol, tb.bot2_pnl as pnl, tb.resolved_at as timestamp
        FROM trading_battles tb
        JOIN api_bots ab ON tb.bot2_id = ab.id
        WHERE tb.status = 'resolved' AND tb.bot2_pnl IS NOT NULL
          AND tb.resolved_at >= datetime('now', '-24 hours')
      ) ORDER BY pnl DESC LIMIT 1
    `).get() as { bot_name: string; symbol: string; pnl: number; timestamp: string } | undefined;

    // Worst trade (24h)
    const worstTrade = db.prepare(`
      SELECT bot_name, symbol, pnl, timestamp FROM (
        SELECT ab.name as bot_name, tb.symbol, tb.bot1_pnl as pnl, tb.resolved_at as timestamp
        FROM trading_battles tb
        JOIN api_bots ab ON tb.bot1_id = ab.id
        WHERE tb.status = 'resolved' AND tb.bot1_pnl IS NOT NULL
          AND tb.resolved_at >= datetime('now', '-24 hours')
        UNION ALL
        SELECT ab.name as bot_name, tb.symbol, tb.bot2_pnl as pnl, tb.resolved_at as timestamp
        FROM trading_battles tb
        JOIN api_bots ab ON tb.bot2_id = ab.id
        WHERE tb.status = 'resolved' AND tb.bot2_pnl IS NOT NULL
          AND tb.resolved_at >= datetime('now', '-24 hours')
      ) ORDER BY pnl ASC LIMIT 1
    `).get() as { bot_name: string; symbol: string; pnl: number; timestamp: string } | undefined;

    // ChainGPT stats (24h) — model name contains 'chaingpt'
    const chaingptStats = db.prepare(`
      SELECT
        COUNT(*) as battles,
        ROUND(100.0 * SUM(CASE WHEN won = 1 THEN 1 ELSE 0 END) / MAX(COUNT(*), 1), 1) as win_rate,
        ROUND(AVG(pnl), 4) as avg_pnl
      FROM (
        SELECT bot1_pnl as pnl,
          CASE WHEN winner_id = bot1_id THEN 1 ELSE 0 END as won
        FROM trading_battles
        WHERE status = 'resolved' AND bot1_model LIKE '%chaingpt%'
          AND resolved_at >= datetime('now', '-24 hours')
        UNION ALL
        SELECT bot2_pnl as pnl,
          CASE WHEN winner_id = bot2_id THEN 1 ELSE 0 END as won
        FROM trading_battles
        WHERE status = 'resolved' AND bot2_model LIKE '%chaingpt%'
          AND resolved_at >= datetime('now', '-24 hours')
      ) t
    `).get() as { battles: number; win_rate: number; avg_pnl: number };

    // Generate summary text
    const topModelName = modelRankings.length > 0 ? modelRankings[0].model.split('/').pop() : 'N/A';
    const summaryText = [
      `🤖 GemBots Arena — Daily Report`,
      ``,
      `⚔️ ${totalBattles} battles | ${resolvedBattles} resolved`,
      topBot ? `👑 Top Bot: ${topBot.name} (ELO ${Math.round(topBot.elo)}, PnL $${topBot.pnl.toFixed(2)})` : '',
      worstBot ? `💀 Worst Bot: ${worstBot.name} (ELO ${Math.round(worstBot.elo)})` : '',
      bestTrade ? `📈 Best Trade: ${bestTrade.bot_name} +$${bestTrade.pnl.toFixed(2)} on ${bestTrade.symbol}` : '',
      worstTrade ? `📉 Worst Trade: ${worstTrade.bot_name} $${worstTrade.pnl.toFixed(2)} on ${worstTrade.symbol}` : '',
      `🏆 Top Model: ${topModelName} (${modelRankings[0]?.win_rate ?? 0}% WR)`,
      chaingptStats.battles > 0 ? `🧠 ChainGPT: ${chaingptStats.battles} battles, ${chaingptStats.win_rate}% WR` : '',
      ``,
      `🔗 gembots.io/reports`,
    ].filter(Boolean).join('\n');

    return NextResponse.json({
      total_battles: totalBattles,
      resolved_battles: resolvedBattles,
      top_bot: topBot ?? null,
      worst_bot: worstBot ?? null,
      model_rankings: modelRankings,
      best_trade: bestTrade ?? null,
      worst_trade: worstTrade ?? null,
      chaingpt_stats: {
        battles: chaingptStats.battles,
        win_rate: chaingptStats.win_rate ?? 0,
        avg_pnl: chaingptStats.avg_pnl ?? 0,
      },
      summary_text: summaryText,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error fetching daily report:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (db) db.close();
  }
}
