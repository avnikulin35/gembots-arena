#!/usr/bin/env node
'use strict';
/**
 * 🧬 GemBots Auto-Evolution 2.0 — Trading League edition
 *
 * Canonical live data source: SQLite `trading_battles` + `api_bots`.
 * This script optimizes live arena bot strategies against realized trading PnL.
 *
 * Usage: node scripts/auto-evolution-v2.js [--dry-run] [--bot-id <id>] [--experiments <n>]
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const BOT_ID = (() => {
  const i = args.indexOf('--bot-id');
  return i >= 0 ? parseInt(args[i + 1], 10) : null;
})();
const EXPERIMENTS = (() => {
  const i = args.indexOf('--experiments');
  return i >= 0 ? parseInt(args[i + 1], 10) : 50;
})();

const DB_PATH = path.join(__dirname, '..', 'data', 'gembots.db');
const BATTLE_LIMIT = 1000;
const db = new Database(DB_PATH);

console.log(`\n🧬 GemBots Auto-Evolution v2.0 | Trading League`);
console.log(`   Experiments: ${EXPERIMENTS} | ${DRY_RUN ? '🏃 DRY RUN' : '🔥 LIVE'} | BotID: ${BOT_ID ?? 'all'}\n`);

const PARAM_SPECS = [
  { key: 'confidence_threshold', min: 0.30, max: 0.90, step: 0.05 },
  { key: 'stop_loss_pct', min: 1.00, max: 10.0, step: 0.50 },
  { key: 'take_profit_pct', min: 2.00, max: 15.0, step: 0.50 },
  { key: 'max_position_pct', min: 5.00, max: 25.0, step: 1.00 },
];

const STRATEGIES = ['momentum', 'contrarian', 'scalper', 'swing', 'whale_watcher', 'trend_follower'];

const DEFAULT_CONFIG = {
  confidence_threshold: 0.60,
  stop_loss_pct: 3.00,
  take_profit_pct: 6.00,
  max_position_pct: 10.00,
  max_trades_per_day: 10,
  allowed_pairs: [],
};

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function pickRandom(arr, n) {
  const copy = [...arr];
  const out = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

function mutateBot(config, strategy) {
  const mConfig = deepClone(config);
  let mStrategy = strategy;
  const desc = [];

  const numMutate = 1 + Math.floor(Math.random() * 2);
  const picked = pickRandom(PARAM_SPECS, numMutate);

  for (const spec of picked) {
    const oldVal = mConfig[spec.key] ?? DEFAULT_CONFIG[spec.key];
    const range = spec.max - spec.min;
    const delta = (0.10 + Math.random() * 0.10) * range * (Math.random() < 0.5 ? 1 : -1);
    let newVal = Math.round((oldVal + delta) / spec.step) * spec.step;
    newVal = parseFloat(clamp(newVal, spec.min, spec.max).toFixed(4));
    mConfig[spec.key] = newVal;
    desc.push(`${spec.key}: ${oldVal}→${newVal}`);
  }

  if (Math.random() < 0.15) {
    const other = STRATEGIES.filter(s => s !== mStrategy);
    mStrategy = other[Math.floor(Math.random() * other.length)];
    desc.push(`strategy: ${strategy}→${mStrategy}`);
  }

  return { mutatedConfig: mConfig, mutatedStrategy: mStrategy, description: desc.join(', ') };
}

function backtest(battles, config, strategy, isBot1Array) {
  const confThresh = config.confidence_threshold ?? DEFAULT_CONFIG.confidence_threshold;
  const tpPct = (config.take_profit_pct ?? DEFAULT_CONFIG.take_profit_pct) / 100;
  const slPct = (config.stop_loss_pct ?? DEFAULT_CONFIG.stop_loss_pct) / 100;
  const maxPos = (config.max_position_pct ?? DEFAULT_CONFIG.max_position_pct) / 100;

  let totalPnl = 0;
  let tradeCount = 0;
  let wins = 0;
  let losses = 0;

  for (let i = 0; i < battles.length; i++) {
    const b = battles[i];
    const isBot1 = isBot1Array[i];
    const action = isBot1 ? b.bot1_action : b.bot2_action;
    const confidence = Number(isBot1 ? b.bot1_confidence : b.bot2_confidence) || 0;
    const rawPnlPct = Number(isBot1 ? b.bot1_pnl : b.bot2_pnl);

    if (action === 'HOLD' || !Number.isFinite(rawPnlPct)) continue;
    if (confidence < confThresh) continue;

    const cappedPct = clamp(rawPnlPct / 100, -slPct, tpPct);
    const realizedPnl = cappedPct * maxPos;

    totalPnl += realizedPnl;
    tradeCount += 1;
    if (rawPnlPct > 0) wins += 1;
    else if (rawPnlPct < 0) losses += 1;
  }

  const score = tradeCount > 0 ? totalPnl * Math.sqrt(tradeCount) : 0;
  const winRate = tradeCount > 0 ? wins / tradeCount : 0;

  return { score, totalPnl, tradeCount, wins, losses, winRate, strategy };
}

function loadBots() {
  const where = BOT_ID ? 'WHERE ab.id = ?' : '';
  return db.prepare(`
    SELECT ab.id, ab.name, ab.strategy
    FROM api_bots ab
    JOIN trading_elo te ON te.bot_id = ab.id
    ${where}
    ORDER BY te.elo DESC, ab.id ASC
  `).all(...(BOT_ID ? [BOT_ID] : []));
}

function loadBotBattles(botId) {
  const battles = db.prepare(`
    SELECT
      id,
      bot1_id,
      bot2_id,
      bot1_action,
      bot1_confidence,
      bot1_pnl,
      bot2_action,
      bot2_confidence,
      bot2_pnl,
      resolved_at,
      symbol
    FROM trading_battles
    WHERE status = 'resolved'
      AND (bot1_id = ? OR bot2_id = ?)
      AND ((bot1_id = ? AND bot1_pnl IS NOT NULL) OR (bot2_id = ? AND bot2_pnl IS NOT NULL))
    ORDER BY resolved_at DESC
    LIMIT ?
  `).all(botId, botId, botId, botId, BATTLE_LIMIT);

  return {
    battles,
    isBot1Arr: battles.map(b => b.bot1_id === botId),
  };
}

const LOG_DIR = path.join(__dirname, '..', 'data', 'evolution');
const LOG_FILE = path.join(LOG_DIR, 'evolution-v2-log.jsonl');

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function logExperiment(entry) {
  fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
}

async function optimizeBot(bot) {
  const botLabel = `${bot.name} (id=${bot.id})`;
  console.log(`\n${'─'.repeat(70)}`);
  console.log(`🤖 ${botLabel}`);
  console.log(`   Strategy: ${bot.strategy || '?'} | Live source: trading_battles`);

  const { battles, isBot1Arr } = loadBotBattles(bot.id);
  if (battles.length < 20) {
    console.log(`   ⚠️  Only ${battles.length} battles — skipping (need ≥20)`);
    return null;
  }

  console.log(`   📊 ${battles.length} battles loaded from trading_battles`);

  const initConfig = { ...DEFAULT_CONFIG };
  const initStrategy = bot.strategy || 'momentum';
  const baseline = backtest(battles, initConfig, initStrategy, isBot1Arr);
  console.log(`   📐 Baseline: score=${baseline.score.toFixed(4)} | trades=${baseline.tradeCount} | winRate=${(baseline.winRate * 100).toFixed(1)}% | pnl=${baseline.totalPnl.toFixed(4)}`);

  let bestConfig = deepClone(initConfig);
  let bestStrategy = initStrategy;
  let bestScore = baseline.score;
  let improvements = 0;
  const startedAt = new Date().toISOString();

  for (let n = 1; n <= EXPERIMENTS; n++) {
    const { mutatedConfig, mutatedStrategy, description } = mutateBot(bestConfig, bestStrategy);
    const result = backtest(battles, mutatedConfig, mutatedStrategy, isBot1Arr);
    const improved = result.score > bestScore;
    const delta = result.score - bestScore;

    logExperiment({
      ts: new Date().toISOString(),
      bot_id: bot.id,
      bot_name: bot.name,
      experiment: n,
      mutation: description,
      score_before: bestScore,
      score_after: result.score,
      delta,
      trade_count: result.tradeCount,
      win_rate: result.winRate,
      total_pnl: result.totalPnl,
      kept: improved,
    });

    if (improved) {
      bestConfig = mutatedConfig;
      bestStrategy = mutatedStrategy;
      bestScore = result.score;
      improvements += 1;
      const deltaStr = (delta >= 0 ? '+' : '') + delta.toFixed(4);
      console.log(`   ✅ [#${String(n).padStart(3)}] ${description.substring(0, 55).padEnd(55)} | ${deltaStr} → score=${bestScore.toFixed(4)}`);
    }
  }

  console.log(`\n   🏁 Done: ${improvements}/${EXPERIMENTS} improvements | Best score: ${bestScore.toFixed(4)} (baseline: ${baseline.score.toFixed(4)})`);
  const improvement = bestScore - baseline.score;
  const improvePct = baseline.score !== 0 ? (improvement / Math.abs(baseline.score) * 100) : 0;
  console.log(`   📈 Improvement: ${improvement >= 0 ? '+' : ''}${improvement.toFixed(4)} (${improvePct.toFixed(1)}%)`);
  console.log(`   🎯 Final config: ${JSON.stringify(bestConfig)}`);
  console.log(`   🎯 Final strategy: ${bestStrategy}`);

  return {
    bot_id: bot.id,
    bot_name: bot.name,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    battles_used: battles.length,
    experiments: EXPERIMENTS,
    improvements,
    baseline_score: baseline.score,
    best_score: bestScore,
    improvement,
    improve_pct: improvePct,
    baseline_config: initConfig,
    best_config: bestConfig,
    baseline_strategy: initStrategy,
    best_strategy: bestStrategy,
    baseline_win_rate: baseline.winRate,
    baseline_trades: baseline.tradeCount,
  };
}

async function applyResult(result) {
  const outcome = db.prepare(`UPDATE api_bots SET strategy = ? WHERE id = ?`).run(result.best_strategy, result.bot_id);
  if (!outcome.changes) {
    console.error(`   ❌ Failed to update bot ${result.bot_name}`);
    return false;
  }
  console.log(`   ✅ Updated live bot ${result.bot_name} strategy in api_bots`);
  return true;
}

function writeSummary(results) {
  const summaryPath = path.join(LOG_DIR, 'evolution-v2-summary.json');
  const summary = {
    generated_at: new Date().toISOString(),
    dry_run: DRY_RUN,
    source: 'sqlite/trading_battles',
    total_bots: results.length,
    total_improved: results.filter(r => r.improvement > 0).length,
    results: results.map(r => ({
      bot_id: r.bot_id,
      bot_name: r.bot_name,
      battles_used: r.battles_used,
      experiments: r.experiments,
      improvements: r.improvements,
      baseline_score: parseFloat(r.baseline_score.toFixed(4)),
      best_score: parseFloat(r.best_score.toFixed(4)),
      improvement: parseFloat(r.improvement.toFixed(4)),
      improve_pct: parseFloat(r.improve_pct.toFixed(2)),
      baseline_win_rate: parseFloat((r.baseline_win_rate * 100).toFixed(1)),
      baseline_trades: r.baseline_trades,
      baseline_config: r.baseline_config,
      best_config: r.best_config,
      baseline_strategy: r.baseline_strategy,
      best_strategy: r.best_strategy,
      started_at: r.started_at,
      finished_at: r.finished_at,
    })),
  };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`\n📊 Summary written → ${summaryPath}`);
}

async function main() {
  ensureLogDir();
  const bots = loadBots();
  if (bots.length === 0) {
    console.log('⚠️  No live trading bots found.');
    return;
  }
  console.log(`🤖 Loaded ${bots.length} bot(s) from api_bots`);

  const results = [];
  for (const bot of bots) {
    try {
      const result = await optimizeBot(bot);
      if (!result) continue;
      results.push(result);

      if (!DRY_RUN && result.improvement > 0) {
        await applyResult(result);
      } else if (DRY_RUN) {
        console.log(`   [DRY RUN] Would update bot ${result.bot_name}`);
      } else {
        console.log('   ℹ️  No improvement — keeping current params');
      }
    } catch (err) {
      console.error(`❌ Error optimizing bot ${bot.name}: ${err.message}`);
    }
  }

  if (results.length === 0) {
    console.log('\n⚠️  No results to summarize.');
    return;
  }

  writeSummary(results);

  console.log('\n' + '═'.repeat(70));
  console.log('📋 FINAL SUMMARY');
  console.log('═'.repeat(70));
  for (const r of results) {
    const arrow = r.improvement > 0 ? '✅' : '↔️ ';
    console.log(`${arrow} ${r.bot_name.padEnd(24)} score: ${r.baseline_score.toFixed(3)} → ${r.best_score.toFixed(3)} (${r.improvement >= 0 ? '+' : ''}${r.improve_pct.toFixed(1)}%)  strategy: ${r.baseline_strategy}→${r.best_strategy}`);
  }
  console.log(`\n✅ Evolution v2 complete! ${results.filter(r => r.improvement > 0).length}/${results.length} bots improved.`);
  console.log(`📝 Experiment log: ${LOG_FILE}`);
}

main()
  .catch(err => {
    console.error('❌ Fatal error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => {
    db.close();
  });
