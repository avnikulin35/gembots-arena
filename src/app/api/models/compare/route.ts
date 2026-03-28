import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getModelDisplayName, getProviderEmoji } from '@/lib/model-display';

export const dynamic = 'force-dynamic';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!;

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_KEY);
}

const STRATEGY_LABELS: Record<string, string> = {
  scalper: '⚡ Scalper',
  momentum: '📈 Momentum',
  swing: '🌊 Swing',
  mean_reversion: '🔄 Mean Rev',
  contrarian: '🔮 Contrarian',
};

const MODEL_EMOJIS: Record<string, string> = {
  'GPT-4.1-mini': '🧠',
  'Claude Haiku 3.5': '🎭',
  'Gemini 2.5 Flash': '✨',
  'Grok 4.1': '𝕏',
  'DeepSeek R1': '🔬',
  'DeepSeek R1 Free': '🐋',
  'Llama 4 Maverick': '🦙',
  'Command R': '🔶',
  'Phi-4': '🔷',
  'Qwen 3.5 Coder': '⚡',
  'Mistral Large': '🌊',
  'Mistral Small 3.1': '🌬️',
  'MiniMax M2.5': '🔮',
  'Gemma 3 27B': '💎',
};

export async function GET() {
  try {
    const supabase = getSupabase();

    const { data: bots, error } = await supabase
      .from('bots')
      .select('id, name, ai_model, trading_style, wins, losses, elo, model_id')
      .eq('is_npc', true);

    if (error) throw error;
    if (!bots) return NextResponse.json({ matrix: [], models: [], strategies: [] });

    // Build model × strategy matrix
    const matrixMap: Record<string, Record<string, { wins: number; losses: number; bots: number; avgElo: number; eloSum: number }>> = {};
    const modelTotals: Record<string, { wins: number; losses: number; bots: number; eloSum: number }> = {};

    for (const b of bots) {
      const model = b.model_id ? getModelDisplayName(b.model_id) : (b.ai_model || 'Unknown');
      const strategy = b.trading_style || 'unknown';
      const wins = b.wins || 0;
      const losses = b.losses || 0;
      const elo = b.elo || 1000;

      // Model × Strategy
      if (!matrixMap[model]) matrixMap[model] = {};
      if (!matrixMap[model][strategy]) {
        matrixMap[model][strategy] = { wins: 0, losses: 0, bots: 0, avgElo: 0, eloSum: 0 };
      }
      matrixMap[model][strategy].wins += wins;
      matrixMap[model][strategy].losses += losses;
      matrixMap[model][strategy].bots += 1;
      matrixMap[model][strategy].eloSum += elo;

      // Model totals
      if (!modelTotals[model]) modelTotals[model] = { wins: 0, losses: 0, bots: 0, eloSum: 0 };
      modelTotals[model].wins += wins;
      modelTotals[model].losses += losses;
      modelTotals[model].bots += 1;
      modelTotals[model].eloSum += elo;
    }

    // Build sorted model list (by avg ELO)
    const models = Object.entries(modelTotals)
      .map(([name, t]) => ({
        name,
        emoji: MODEL_EMOJIS[name] || '🤖',
        totalWins: t.wins,
        totalLosses: t.losses,
        totalBattles: t.wins + t.losses,
        winRate: t.wins + t.losses > 0 ? Math.round((t.wins / (t.wins + t.losses)) * 100) : 0,
        avgElo: Math.round(t.eloSum / t.bots),
        bots: t.bots,
      }))
      .sort((a, b) => b.avgElo - a.avgElo);

    // Get unique strategies
    const strategies = Object.keys(STRATEGY_LABELS);

    // Build matrix rows
    const matrix = models.map(model => {
      const cells: Record<string, { winRate: number; battles: number; bots: number; avgElo: number } | null> = {};
      for (const strategy of strategies) {
        const data = matrixMap[model.name]?.[strategy];
        if (data && data.wins + data.losses > 0) {
          cells[strategy] = {
            winRate: Math.round((data.wins / (data.wins + data.losses)) * 100),
            battles: data.wins + data.losses,
            bots: data.bots,
            avgElo: Math.round(data.eloSum / data.bots),
          };
        } else {
          cells[strategy] = null;
        }
      }
      return {
        model: model.name,
        emoji: model.emoji,
        avgElo: model.avgElo,
        totalWinRate: model.winRate,
        totalBattles: model.totalBattles,
        cells,
      };
    });

    // Find best model per strategy
    const bestPerStrategy: Record<string, { model: string; winRate: number }> = {};
    for (const strategy of strategies) {
      let best = { model: '', winRate: 0 };
      for (const row of matrix) {
        const cell = row.cells[strategy];
        if (cell && cell.battles >= 10 && cell.winRate > best.winRate) {
          best = { model: row.model, winRate: cell.winRate };
        }
      }
      if (best.model) bestPerStrategy[strategy] = best;
    }

    return NextResponse.json({
      matrix,
      models: models.map(m => m.name),
      strategies: strategies.map(s => ({ key: s, label: STRATEGY_LABELS[s] || s })),
      bestPerStrategy,
    });
  } catch (e: any) {
    console.error('Model compare API error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
