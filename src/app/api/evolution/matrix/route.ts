import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

export const revalidate = 300;
export const dynamic = 'force-dynamic';

const DB_PATH = path.join(process.cwd(), 'data', 'gembots.db');
const EVOLUTION_DIR = path.join(process.cwd(), 'data', 'evolution');
const V2_LOG_FILE = path.join(EVOLUTION_DIR, 'evolution-v2-log.jsonl');
const V2_SUMMARY_FILE = path.join(EVOLUTION_DIR, 'evolution-v2-summary.json');

interface BattleRow {
  bot1_id: number;
  bot2_id: number;
  winner_id: number | null;
  bot1_model: string | null;
  bot2_model: string | null;
  bot1_strategy: string | null;
  bot2_strategy: string | null;
}

export async function GET() {
  let db: Database.Database | null = null;

  try {
    db = new Database(DB_PATH, { readonly: true });
    const since = new Date(Date.now() - 72 * 3600000).toISOString().replace('T', ' ').slice(0, 19);

    const battles = db.prepare(`
      SELECT
        tb.bot1_id,
        tb.bot2_id,
        tb.winner_id,
        tb.bot1_model,
        tb.bot2_model,
        ab1.strategy AS bot1_strategy,
        ab2.strategy AS bot2_strategy
      FROM trading_battles tb
      JOIN api_bots ab1 ON ab1.id = tb.bot1_id
      JOIN api_bots ab2 ON ab2.id = tb.bot2_id
      WHERE tb.status = 'resolved'
        AND tb.resolved_at IS NOT NULL
        AND tb.resolved_at >= ?
      ORDER BY tb.resolved_at DESC
      LIMIT 5000
    `).all(since) as BattleRow[];

    if (battles.length === 0) {
      return NextResponse.json({ matrix: [], bestPerModel: {}, totalBattles: 0, totalEvolutions: 0, lastEvolution: null });
    }

    const matrix: Record<string, { model: string; style: string; wins: number; total: number }> = {};

    for (const battle of battles) {
      const sides = [
        { botId: battle.bot1_id, winnerId: battle.winner_id, model: battle.bot1_model, style: battle.bot1_strategy },
        { botId: battle.bot2_id, winnerId: battle.winner_id, model: battle.bot2_model, style: battle.bot2_strategy },
      ];

      for (const side of sides) {
        if (!side.model || !side.style) continue;
        const key = `${side.model}|${side.style}`;
        if (!matrix[key]) {
          matrix[key] = { model: side.model, style: side.style, wins: 0, total: 0 };
        }
        matrix[key].total += 1;
        if (side.winnerId === side.botId) {
          matrix[key].wins += 1;
        }
      }
    }

    const entries = Object.values(matrix)
      .filter(entry => entry.total >= 10)
      .map(entry => ({ ...entry, winRate: +(entry.wins / entry.total * 100).toFixed(1) }))
      .sort((a, b) => b.winRate - a.winRate || b.total - a.total);

    const bestPerModel: Record<string, { style: string; winRate: number; battles: number }> = {};
    for (const entry of entries) {
      if (!bestPerModel[entry.model] || entry.winRate > bestPerModel[entry.model].winRate) {
        bestPerModel[entry.model] = {
          style: entry.style,
          winRate: entry.winRate,
          battles: entry.total,
        };
      }
    }

    let totalEvolutions = 0;
    let lastEvolution: { timestamp: string; mutations: number; battles: number } | null = null;

    if (fs.existsSync(V2_LOG_FILE)) {
      const lines = fs.readFileSync(V2_LOG_FILE, 'utf-8').split('\n').map(line => line.trim()).filter(Boolean);
      totalEvolutions = lines.length;
    }

    if (fs.existsSync(V2_SUMMARY_FILE)) {
      try {
        const summary = JSON.parse(fs.readFileSync(V2_SUMMARY_FILE, 'utf-8'));
        if (summary?.generated_at) {
          lastEvolution = {
            timestamp: summary.generated_at,
            mutations: Array.isArray(summary.results)
              ? summary.results.reduce((sum: number, item: any) => sum + (item.improvements || 0), 0)
              : 0,
            battles: Array.isArray(summary.results)
              ? summary.results.reduce((sum: number, item: any) => sum + (item.battles_used || 0), 0)
              : 0,
          };
        }
      } catch (error) {
        console.error('[API /evolution/matrix] Failed to parse v2 summary:', error);
      }
    }

    return NextResponse.json({
      matrix: entries,
      bestPerModel,
      totalBattles: battles.length,
      totalEvolutions,
      lastEvolution,
    });
  } catch (err: any) {
    console.error('[API /evolution/matrix]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    db?.close();
  }
}
