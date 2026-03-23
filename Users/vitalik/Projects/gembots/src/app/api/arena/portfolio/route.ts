import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

export const dynamic = 'force-dynamic';

const DB_PATH = path.join(process.cwd(), 'data/gembots.db');

interface TradingPortfolioRow {
  bot_id: number;
  name: string;
  balance: number;
  peak_balance: number;
  total_trades: number;
  total_pnl_usd: number;
  drawdown_pct: number;
}

export async function GET() {
  let db: Database.Database | null = null;

  try {
    db = new Database(DB_PATH, { readonly: true });

    const portfolioQuery = db.prepare(`
      SELECT
        tp.bot_id,
        ab.name,
        tp.balance,
        tp.peak_balance,
        tp.total_trades,
        tp.total_pnl_usd,
        CASE
          WHEN tp.peak_balance > 0 THEN ROUND(((tp.peak_balance - tp.balance) / tp.peak_balance) * 100, 2)
          ELSE 0
        END AS drawdown_pct
      FROM trading_portfolio tp
      JOIN api_bots ab ON tp.bot_id = ab.id
      ORDER BY tp.balance DESC, tp.total_pnl_usd DESC, ab.name ASC
    `);

    const portfolios = portfolioQuery.all() as TradingPortfolioRow[];

    return NextResponse.json({ portfolios });
  } catch (error: any) {
    console.error('Error fetching trading portfolios:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch trading portfolios', portfolios: [] },
      { status: 500 }
    );
  } finally {
    db?.close();
  }
}
