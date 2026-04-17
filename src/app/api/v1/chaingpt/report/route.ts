import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

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
 * Auto-generated weekly ChainGPT report for co-marketing
 * GET /api/v1/chaingpt/report?period=7d
 * Returns formatted text ready for Twitter/blog
 */
export async function GET(req: Request) {
  let db: Database.Database | null = null;
  try {
    const { searchParams } = new URL(req.url);
    const days = searchParams.get('period') === '24h' ? 1 : searchParams.get('period') === '30d' ? 30 : 7;
    const since = new Date(Date.now() - days * 86400000).toISOString();

    db = new Database(DB_PATH, { readonly: true });

    // ChainGPT stats for period
    const cgStats = db.prepare(`
      SELECT
        COUNT(*) as battles,
        SUM(CASE WHEN won = 1 THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN won = 0 THEN 1 ELSE 0 END) as losses,
        ROUND(AVG(pnl), 4) as avg_pnl,
        ROUND(SUM(pnl), 2) as total_pnl,
        ROUND(MAX(pnl), 2) as best_trade,
        ROUND(MIN(pnl), 2) as worst_trade
      FROM (
        SELECT bot1_pnl as pnl, CASE WHEN winner_id = bot1_id THEN 1 ELSE 0 END as won
        FROM trading_battles WHERE status = 'resolved' AND bot1_model = ? AND resolved_at >= ?
        UNION ALL
        SELECT bot2_pnl as pnl, CASE WHEN winner_id = bot2_id THEN 1 ELSE 0 END as won
        FROM trading_battles WHERE status = 'resolved' AND bot2_model = ? AND resolved_at >= ?
      ) t
    `).get(CHAINGPT_MODEL, since, CHAINGPT_MODEL, since) as any;

    // Per-symbol for the period
    const bySymbol = db.prepare(`
      SELECT symbol, COUNT(*) as battles,
        SUM(CASE WHEN won = 1 THEN 1 ELSE 0 END) as wins,
        ROUND(AVG(pnl), 4) as avg_pnl
      FROM (
        SELECT b.symbol, bot1_pnl as pnl, CASE WHEN winner_id = bot1_id THEN 1 ELSE 0 END as won
        FROM trading_battles b WHERE status = 'resolved' AND bot1_model = ? AND resolved_at >= ?
        UNION ALL
        SELECT b.symbol, bot2_pnl as pnl, CASE WHEN winner_id = bot2_id THEN 1 ELSE 0 END as won
        FROM trading_battles b WHERE status = 'resolved' AND bot2_model = ? AND resolved_at >= ?
      ) t GROUP BY symbol
    `).all(CHAINGPT_MODEL, since, CHAINGPT_MODEL, since) as any[];

    // High-confidence signals accuracy
    const signals = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN won = 1 THEN 1 ELSE 0 END) as correct
      FROM (
        SELECT CASE WHEN winner_id = bot1_id THEN 1 ELSE 0 END as won
        FROM trading_battles
        WHERE status = 'resolved' AND bot1_model = ? AND bot1_confidence >= 0.7 AND bot1_action != 'HOLD' AND resolved_at >= ?
        UNION ALL
        SELECT CASE WHEN winner_id = bot2_id THEN 1 ELSE 0 END as won
        FROM trading_battles
        WHERE status = 'resolved' AND bot2_model = ? AND bot2_confidence >= 0.7 AND bot2_action != 'HOLD' AND resolved_at >= ?
      ) t
    `).get(CHAINGPT_MODEL, since, CHAINGPT_MODEL, since) as any;

    // Total platform battles for context
    const totalPlatform = (db.prepare(
      `SELECT COUNT(*) as cnt FROM trading_battles WHERE status = 'resolved' AND resolved_at >= ?`
    ).get(since) as any)?.cnt || 0;

    const battles = cgStats?.battles || 0;
    const wins = cgStats?.wins || 0;
    const winRate = battles > 0 ? Math.round((wins / battles) * 1000) / 10 : 0;
    const signalAccuracy = signals?.total > 0 ? Math.round((signals.correct / signals.total) * 100) : 0;

    const periodLabel = days === 1 ? '24h' : days === 7 ? 'week' : '30 days';

    // Generate Twitter-ready text
    const twitterText = [
      `🧠 ChainGPT × GemBots Arena — ${periodLabel} report`,
      ``,
      `📊 ${battles} battles | ${winRate}% win rate`,
      cgStats?.avg_pnl ? `💰 Avg P&L: ${cgStats.avg_pnl >= 0 ? '+' : ''}${cgStats.avg_pnl.toFixed(3)}%` : '',
      cgStats?.best_trade ? `🏆 Best trade: +${cgStats.best_trade.toFixed(2)}%` : '',
      signals?.total > 0 ? `🎯 High-confidence signal accuracy: ${signalAccuracy}% (${signals.correct}/${signals.total})` : '',
      ``,
      ...bySymbol.map(s => {
        const wr = s.battles > 0 ? Math.round((s.wins / s.battles) * 100) : 0;
        return `${s.symbol}: ${wr}% WR (${s.battles} battles)`;
      }),
      ``,
      `On-chain intelligence: whale tracking, smart money flows, sentiment analysis`,
      ``,
      `Live results → gembots.space/chaingpt`,
      `#ChainGPT #GemBots #AITrading #Web3`,
    ].filter(Boolean).join('\n');

    // Blog-ready markdown
    const markdownReport = [
      `# ChainGPT Performance Report — ${periodLabel}`,
      ``,
      `## Summary`,
      `- **Battles**: ${battles} (out of ${totalPlatform} platform total)`,
      `- **Win Rate**: ${winRate}%`,
      `- **Average P&L**: ${cgStats?.avg_pnl >= 0 ? '+' : ''}${(cgStats?.avg_pnl || 0).toFixed(3)}%`,
      `- **Total P&L**: ${cgStats?.total_pnl >= 0 ? '+' : ''}${(cgStats?.total_pnl || 0).toFixed(2)}%`,
      `- **Best Trade**: +${(cgStats?.best_trade || 0).toFixed(2)}%`,
      `- **Worst Trade**: ${(cgStats?.worst_trade || 0).toFixed(2)}%`,
      ``,
      `## Smart Signals (confidence >= 70%)`,
      `- Total signals: ${signals?.total || 0}`,
      `- Correct: ${signals?.correct || 0}`,
      `- Accuracy: ${signalAccuracy}%`,
      ``,
      `## By Symbol`,
      ...bySymbol.map(s => {
        const wr = s.battles > 0 ? Math.round((s.wins / s.battles) * 100) : 0;
        return `- **${s.symbol}**: ${wr}% WR | ${s.battles} battles | Avg P&L: ${s.avg_pnl >= 0 ? '+' : ''}${s.avg_pnl.toFixed(3)}%`;
      }),
      ``,
      `## On-Chain Advantage`,
      `ChainGPT is the only AI model in GemBots Arena with access to real-time blockchain intelligence:`,
      `- Whale movements and large transactions`,
      `- Smart money flows (exchange in/outflows)`,
      `- Market sentiment and fear/greed index`,
      ``,
      `---`,
      `*Generated by GemBots Arena — [gembots.space/chaingpt](https://gembots.space/chaingpt)*`,
    ].join('\n');

    return NextResponse.json({
      period: `${days}d`,
      generated_at: new Date().toISOString(),
      stats: {
        battles, wins, losses: cgStats?.losses || 0,
        win_rate: winRate,
        avg_pnl: cgStats?.avg_pnl || 0,
        total_pnl: cgStats?.total_pnl || 0,
        best_trade: cgStats?.best_trade || 0,
        worst_trade: cgStats?.worst_trade || 0,
        signal_accuracy: signalAccuracy,
        platform_battles: totalPlatform,
      },
      by_symbol: bySymbol,
      content: {
        twitter: twitterText,
        markdown: markdownReport,
      },
    }, { headers: CORS_HEADERS });
  } catch (error: any) {
    console.error('Weekly report error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500, headers: CORS_HEADERS });
  } finally {
    if (db) db.close();
  }
}
