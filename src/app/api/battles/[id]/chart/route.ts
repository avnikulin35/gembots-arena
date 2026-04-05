import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'gembots.db');

export const revalidate = 30;

interface BattleRow {
  id: string;
  bot1_id: number;
  bot2_id: number;
  symbol: string;
  entry_price: number;
  bot1_action: string;
  bot2_action: string;
  bot1_leverage: number;
  bot2_leverage: number;
  bot1_confidence: number;
  bot2_confidence: number;
  bot1_tp: number;
  bot2_tp: number;
  bot1_sl: number;
  bot2_sl: number;
  bot1_reasoning: string;
  bot2_reasoning: string;
  bot1_model: string;
  bot2_model: string;
  bot1_pnl: number | null;
  bot2_pnl: number | null;
  winner_id: number | null;
  market_data: string;
  status: string;
  started_at: string;
  resolved_at: string | null;
  exit_price: number | null;
}

interface BotRow {
  id: number;
  name: string;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = new Database(DB_PATH, { readonly: true });

  try {
    const battle = db.prepare(
      `SELECT * FROM trading_battles WHERE id = ?`
    ).get(id) as BattleRow | undefined;

    if (!battle) {
      return NextResponse.json({ error: 'Battle not found' }, { status: 404 });
    }

    // Get bot names
    const bot1 = db.prepare('SELECT id, name FROM api_bots WHERE id = ?').get(battle.bot1_id) as BotRow | undefined;
    const bot2 = db.prepare('SELECT id, name FROM api_bots WHERE id = ?').get(battle.bot2_id) as BotRow | undefined;

    // Parse market data for technicals
    let marketData = {};
    try {
      marketData = JSON.parse(battle.market_data || '{}');
    } catch {}

    // Fetch klines from Bybit for chart
    let klines: number[][] = [];
    try {
      const symbol = battle.symbol;
      const res = await fetch(
        `https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=5&limit=60`,
        { next: { revalidate: 30 } }
      );
      const data = await res.json();
      if (data?.result?.list) {
        klines = [...data.result.list]
          .reverse()
          .map((k: string[]) => [
            parseInt(k[0]),     // timestamp ms
            parseFloat(k[1]),   // open
            parseFloat(k[2]),   // high
            parseFloat(k[3]),   // low
            parseFloat(k[4]),   // close
            parseFloat(k[5]),   // volume
          ]);
      }
    } catch (e) {
      console.warn('Failed to fetch klines for chart:', e);
    }

    return NextResponse.json({
      battle: {
        id: battle.id,
        symbol: battle.symbol,
        status: battle.status,
        entry_price: battle.entry_price,
        exit_price: battle.exit_price,
        started_at: battle.started_at,
        resolved_at: battle.resolved_at,
        winner_id: battle.winner_id,
      },
      bot1: {
        id: battle.bot1_id,
        name: bot1?.name || `Bot #${battle.bot1_id}`,
        model: battle.bot1_model,
        action: battle.bot1_action,
        leverage: battle.bot1_leverage,
        confidence: battle.bot1_confidence,
        take_profit: battle.bot1_tp,
        stop_loss: battle.bot1_sl,
        reasoning: battle.bot1_reasoning,
        pnl: battle.bot1_pnl,
        isWinner: battle.winner_id === battle.bot1_id,
      },
      bot2: {
        id: battle.bot2_id,
        name: bot2?.name || `Bot #${battle.bot2_id}`,
        model: battle.bot2_model,
        action: battle.bot2_action,
        leverage: battle.bot2_leverage,
        confidence: battle.bot2_confidence,
        take_profit: battle.bot2_tp,
        stop_loss: battle.bot2_sl,
        reasoning: battle.bot2_reasoning,
        pnl: battle.bot2_pnl,
        isWinner: battle.winner_id === battle.bot2_id,
      },
      marketData,
      klines,
    });
  } catch (error) {
    console.error('Battle chart error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  } finally {
    db.close();
  }
}
