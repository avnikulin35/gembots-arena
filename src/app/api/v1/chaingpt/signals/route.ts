import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export const dynamic = 'force-dynamic';

const DB_PATH = path.join(process.cwd(), 'data/gembots.db');
const SIGNALS_PATH = path.join(process.cwd(), 'data/smart-signals.json');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * Smart Signals API — when ChainGPT on-chain data aligns with technical analysis
 * GET /api/v1/chaingpt/signals?limit=10
 */
export async function GET(req: Request) {
  let db: Database.Database | null = null;
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 50);

    db = new Database(DB_PATH, { readonly: true });

    // Find recent ChainGPT battles where confidence was high (>= 0.7)
    // and action was decisive (BUY or SELL, not HOLD)
    // These are "Smart Signals" — when on-chain intelligence drives a conviction trade
    const signals = db.prepare(`
      SELECT
        b.id, b.symbol, b.entry_price, b.started_at, b.resolved_at, b.status,
        CASE
          WHEN b.bot1_model LIKE '%chaingpt%' THEN b.bot1_action
          ELSE b.bot2_action
        END as signal_action,
        CASE
          WHEN b.bot1_model LIKE '%chaingpt%' THEN b.bot1_leverage
          ELSE b.bot2_leverage
        END as signal_leverage,
        CASE
          WHEN b.bot1_model LIKE '%chaingpt%' THEN b.bot1_confidence
          ELSE b.bot2_confidence
        END as signal_confidence,
        CASE
          WHEN b.bot1_model LIKE '%chaingpt%' THEN b.bot1_reasoning
          ELSE b.bot2_reasoning
        END as signal_reasoning,
        CASE
          WHEN b.bot1_model LIKE '%chaingpt%' THEN b.bot1_pnl
          ELSE b.bot2_pnl
        END as signal_pnl,
        CASE
          WHEN b.bot1_model LIKE '%chaingpt%' THEN b.bot1_tp
          ELSE b.bot2_tp
        END as signal_tp,
        CASE
          WHEN b.bot1_model LIKE '%chaingpt%' THEN b.bot1_sl
          ELSE b.bot2_sl
        END as signal_sl,
        CASE
          WHEN b.bot1_model LIKE '%chaingpt%' AND b.winner_id = b.bot1_id THEN 1
          WHEN b.bot2_model LIKE '%chaingpt%' AND b.winner_id = b.bot2_id THEN 1
          ELSE 0
        END as signal_won,
        b.market_data
      FROM trading_battles b
      WHERE (b.bot1_model LIKE '%chaingpt%' OR b.bot2_model LIKE '%chaingpt%')
        AND (
          (b.bot1_model LIKE '%chaingpt%' AND b.bot1_confidence >= 0.7 AND b.bot1_action != 'HOLD')
          OR
          (b.bot2_model LIKE '%chaingpt%' AND b.bot2_confidence >= 0.7 AND b.bot2_action != 'HOLD')
        )
      ORDER BY b.started_at DESC
      LIMIT ?
    `).all(limit) as any[];

    // Calculate signal accuracy
    const resolved = signals.filter(s => s.status === 'resolved');
    const wins = resolved.filter(s => s.signal_won === 1).length;
    const accuracy = resolved.length > 0 ? Math.round((wins / resolved.length) * 100) : 0;

    // Extract technical levels from market_data
    const formattedSignals = signals.map(s => {
      let technicals: any = {};
      try {
        const md = JSON.parse(s.market_data || '{}');
        technicals = {
          pivot: md.pivot,
          resistance_1: md.resistance_1,
          support_1: md.support_1,
          trend: md.trend,
          rsi: md.rsi_14,
          fib_500: md.fib_500,
        };
      } catch {}

      return {
        id: s.id,
        symbol: s.symbol,
        action: s.signal_action,
        leverage: s.signal_leverage,
        confidence: s.signal_confidence,
        take_profit: s.signal_tp,
        stop_loss: s.signal_sl,
        reasoning: s.signal_reasoning,
        entry_price: s.entry_price,
        pnl: s.signal_pnl,
        won: s.signal_won === 1,
        status: s.status,
        technicals,
        timestamp: s.started_at,
        resolved_at: s.resolved_at,
      };
    });

    // Save latest signals for external use
    try {
      fs.writeFileSync(SIGNALS_PATH, JSON.stringify({
        signals: formattedSignals.slice(0, 5),
        accuracy,
        updated_at: new Date().toISOString(),
      }));
    } catch {}

    return NextResponse.json({
      meta: {
        source: 'GemBots × ChainGPT',
        description: 'Smart Signals — high-confidence trades backed by on-chain intelligence',
        signal_count: formattedSignals.length,
        accuracy_pct: accuracy,
        resolved_signals: resolved.length,
        winning_signals: wins,
      },
      signals: formattedSignals,
    }, { headers: CORS_HEADERS });
  } catch (error: any) {
    console.error('Smart signals error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500, headers: CORS_HEADERS });
  } finally {
    if (db) db.close();
  }
}
