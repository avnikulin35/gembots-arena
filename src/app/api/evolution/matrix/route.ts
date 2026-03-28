import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.join(process.cwd(), 'data', 'gembots.db');

export const revalidate = 300; // Cache for 5 minutes

export async function GET() {
  const db = new Database(DB_PATH, { readonly: true });
  try {
    const since = new Date(Date.now() - 72 * 3600000).toISOString();

    // Get resolved battles from last 72h with bot model+strategy info
    const battles = db.prepare(`
      SELECT
        tb.bot1_id,
        tb.bot2_id,
        tb.winner_id,
        tb.bot1_model,
        tb.bot2_model,
        b1.strategy AS bot1_strategy,
        b2.strategy AS bot2_strategy
      FROM trading_battles tb
      LEFT JOIN api_bots b1 ON b1.id = tb.bot1_id
      LEFT JOIN api_bots b2 ON b2.id = tb.bot2_id
      WHERE tb.status = 'resolved'
        AND tb.resolved_at >= ?
      LIMIT 5000
    `).all(since) as {
      bot1_id: string;
      bot2_id: string;
      winner_id: string | null;
      bot1_model: string;
      bot2_model: string;
      bot1_strategy: string | null;
      bot2_strategy: string | null;
    }[];

    if (battles.length === 0) {
      return NextResponse.json({ matrix: [], bestPerModel: {}, totalBattles: 0, totalEvolutions: 0, lastEvolution: null });
    }

    // Build matrix
    const matrix: Record<string, { model: string; style: string; wins: number; total: number }> = {};

    for (const b of battles) {
      const sides = [
        { id: b.bot1_id, model: b.bot1_model, strategy: b.bot1_strategy },
        { id: b.bot2_id, model: b.bot2_model, strategy: b.bot2_strategy },
      ];
      for (const side of sides) {
        if (!side.model || !side.strategy) continue;
        const key = `${side.model}|${side.strategy}`;
        if (!matrix[key]) matrix[key] = { model: side.model, style: side.strategy, wins: 0, total: 0 };
        matrix[key].total++;
        if (b.winner_id === side.id) matrix[key].wins++;
      }
    }

    // Calculate and sort
    const entries = Object.values(matrix)
      .filter(m => m.total >= 10)
      .map(m => ({ ...m, winRate: +(m.wins / m.total * 100).toFixed(1) }))
      .sort((a, b) => b.winRate - a.winRate);

    // Best per model
    const bestPerModel: Record<string, { style: string; winRate: number; battles: number }> = {};
    for (const e of entries) {
      if (!bestPerModel[e.model] || e.winRate > bestPerModel[e.model].winRate) {
        bestPerModel[e.model] = { style: e.style, winRate: e.winRate, battles: e.total };
      }
    }

    // Evolution log stats
    const logFile = path.join(process.cwd(), 'data', 'evolution', 'evolution-log.jsonl');
    let totalEvolutions = 0;
    let lastEvolution = null;
    if (fs.existsSync(logFile)) {
      const lines = fs.readFileSync(logFile, 'utf-8').trim().split('\n').filter(Boolean);
      totalEvolutions = lines.length;
      if (lines.length > 0) {
        lastEvolution = JSON.parse(lines[lines.length - 1]);
      }
    }

    return NextResponse.json({
      matrix: entries,
      bestPerModel,
      totalBattles: battles.length,
      totalEvolutions,
      lastEvolution: lastEvolution ? {
        timestamp: lastEvolution.timestamp,
        mutations: lastEvolution.mutations?.length || 0,
        battles: lastEvolution.totalBattles,
      } : null,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    db.close();
  }
}
