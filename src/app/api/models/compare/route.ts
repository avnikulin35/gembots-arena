import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';
import { getModelDisplayName } from '@/lib/model-display';

export const dynamic = 'force-dynamic';

const DB_PATH = path.join(process.cwd(), 'data/gembots.db');

const STRATEGY_LABELS: Record<string, string> = {
  scalper: '⚡ Scalper',
  momentum: '📈 Momentum',
  swing: '🌊 Swing',
  mean_reversion: '🔄 Mean Rev',
  contrarian: '🔮 Contrarian',
  trend_follower: '📊 Trend Follower',
};

const MODEL_EMOJIS: Record<string, string> = {
  'GPT-4.1 Nano': '🧠',
  'Gemini Flash Lite': '✨',
  'DeepSeek R1': '🔬',
  'Llama 4 Maverick': '🦙',
  'Qwen3 235B': '⚡',
  'Mistral Nemo': '🌊',
  'Mistral Small': '🌬️',
  'Gemma 3 12B': '💎',
  'Grok 4.1 Fast': '𝕏',
  'ChainGPT': '🧠',
};

export async function GET() {
  let db: Database.Database | null = null;
  try {
    db = new Database(DB_PATH, { readonly: true });

    // Get all battles with model info
    const battles = db.prepare(`
      SELECT 
        bot1_id, bot2_id, winner_id, bot1_pnl, bot2_pnl,
        bot1_model, bot2_model
      FROM trading_battles
      WHERE status = 'resolved'
    `).all() as any[];

    // Get bot strategies
    const bots = db.prepare('SELECT id, name, strategy FROM api_bots').all() as any[];
    const botMap = new Map(bots.map((b: any) => [b.id, b]));

    // Build model × strategy performance matrix
    const matrixMap: Record<string, Record<string, { wins: number; losses: number; totalPnl: number }>> = {};

    for (const b of battles) {
      for (const side of ['bot1', 'bot2'] as const) {
        const botId = b[`${side}_id`];
        const modelId = b[`${side}_model`];
        if (!modelId) continue;
        
        const bot = botMap.get(botId);
        const strategy = bot?.strategy || 'unknown';
        const model = getModelDisplayName(modelId);
        const pnl = b[`${side}_pnl`] || 0;
        const won = b.winner_id === botId;

        if (!matrixMap[model]) matrixMap[model] = {};
        if (!matrixMap[model][strategy]) matrixMap[model][strategy] = { wins: 0, losses: 0, totalPnl: 0 };
        
        matrixMap[model][strategy].totalPnl += pnl;
        if (won) matrixMap[model][strategy].wins++;
        else matrixMap[model][strategy].losses++;
      }
    }

    // Build model totals
    const modelTotals: Record<string, { wins: number; losses: number; totalPnl: number }> = {};
    for (const [model, strategies] of Object.entries(matrixMap)) {
      modelTotals[model] = { wins: 0, losses: 0, totalPnl: 0 };
      for (const s of Object.values(strategies)) {
        modelTotals[model].wins += s.wins;
        modelTotals[model].losses += s.losses;
        modelTotals[model].totalPnl += s.totalPnl;
      }
    }

    const models = Object.entries(modelTotals)
      .map(([name, t]) => ({
        name,
        emoji: MODEL_EMOJIS[name] || '🤖',
        totalWins: t.wins,
        totalLosses: t.losses,
        totalBattles: t.wins + t.losses,
        winRate: t.wins + t.losses > 0 ? Math.round((t.wins / (t.wins + t.losses)) * 100) : 0,
        avgPnl: t.wins + t.losses > 0 ? Math.round(t.totalPnl / (t.wins + t.losses) * 100) / 100 : 0,
        bots: 0,
      }))
      .sort((a, b) => b.winRate - a.winRate || b.totalBattles - a.totalBattles);

    const strategies = Object.keys(STRATEGY_LABELS);

    const matrix = models.map(model => {
      const cells: Record<string, any> = {};
      for (const strategy of strategies) {
        const data = matrixMap[model.name]?.[strategy];
        if (data && data.wins + data.losses > 0) {
          cells[strategy] = {
            winRate: Math.round((data.wins / (data.wins + data.losses)) * 100),
            battles: data.wins + data.losses,
            bots: 1,
            avgPnl: Math.round(data.totalPnl / (data.wins + data.losses) * 100) / 100,
          };
        } else {
          cells[strategy] = null;
        }
      }
      return {
        model: model.name,
        emoji: model.emoji,
        avgElo: 0,
        totalWinRate: model.winRate,
        totalBattles: model.totalBattles,
        avgPnl: model.avgPnl,
        cells,
      };
    });

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
  } finally {
    db?.close();
  }
}
