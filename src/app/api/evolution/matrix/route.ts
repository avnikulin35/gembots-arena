import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export const revalidate = 300; // Cache for 5 minutes

export async function GET() {
  try {
    const since = new Date(Date.now() - 72 * 3600000).toISOString(); // Last 72h

    // Get battles
    const { data: battles } = await supabase
      .from('battles')
      .select('bot1_id, bot2_id, winner_id')
      .eq('status', 'resolved')
      .gte('finished_at', since)
      .limit(5000);

    if (!battles || battles.length === 0) {
      return NextResponse.json({ matrix: [], bestPerModel: {}, totalBattles: 0 });
    }

    // Get bots
    const { data: bots } = await supabase
      .from('bots')
      .select('id, ai_model, trading_style');

    const botMap: Record<string, any> = {};
    for (const b of bots || []) botMap[b.id] = b;

    // Build matrix
    const matrix: Record<string, { model: string; style: string; wins: number; total: number }> = {};
    for (const b of battles) {
      for (const side of ['bot1_id', 'bot2_id'] as const) {
        const botId = b[side];
        const bot = botMap[botId];
        if (!bot?.ai_model || !bot?.trading_style) continue;
        const key = `${bot.ai_model}|${bot.trading_style}`;
        if (!matrix[key]) matrix[key] = { model: bot.ai_model, style: bot.trading_style, wins: 0, total: 0 };
        matrix[key].total++;
        if (b.winner_id === botId) matrix[key].wins++;
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
    const fs = await import('fs');
    const path = await import('path');
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
  }
}
