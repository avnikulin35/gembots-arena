#!/usr/bin/env node
'use strict';
/**
 * 🧬 GemBots Auto-Evolution 2.0 — Karpathy-style Optimization Loop
 *
 * For each bot:
 * 1. Load battle history (last 1000 finished battles)
 * 2. Run backtester with current params → baseline score
 * 3. Mutate 1-2 params → backtest → keep if better
 * 4. Repeat N experiments per bot
 * 5. Apply best params to Supabase (unless --dry-run)
 *
 * Score metric: total_pnl * sqrt(trade_count)
 *
 * Usage: node scripts/auto-evolution-v2.js [--dry-run] [--bot-id <id>] [--experiments <n>]
 */

const { createClient } = require('@supabase/supabase-js');
const fs   = require('fs');
const path = require('path');

// ── Load .env.local ────────────────────────────────────────────────────────────
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY     || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// ── CLI args ───────────────────────────────────────────────────────────────────
const args        = process.argv.slice(2);
const DRY_RUN     = args.includes('--dry-run');
const BOT_ID      = (() => { const i = args.indexOf('--bot-id');      return i >= 0 ? parseInt(args[i+1]) : null; })();
const EXPERIMENTS = (() => { const i = args.indexOf('--experiments'); return i >= 0 ? parseInt(args[i+1]) : 50; })();
const BATTLE_LIMIT = 1000;
const PAGE_SIZE    = 500; // Supabase pagination

console.log(`\n🧬 GemBots Auto-Evolution v2.0  |  Karpathy Loop`);
console.log(`   Experiments: ${EXPERIMENTS} | ${DRY_RUN ? '🏃 DRY RUN' : '🔥 LIVE'} | BotID: ${BOT_ID ?? 'all'}\n`);

// ── Parameter spec ─────────────────────────────────────────────────────────────
const PARAM_SPECS = [
  { key: 'confidence_threshold', min: 0.30, max: 0.90, step: 0.05 },
  { key: 'stop_loss_pct',        min: 1.00, max: 10.0, step: 0.50 },
  { key: 'take_profit_pct',      min: 2.00, max: 15.0, step: 0.50 },
  { key: 'max_position_pct',     min: 5.00, max: 25.0, step: 1.00 },
];

const STRATEGIES = ['momentum', 'contrarian', 'scalper', 'swing', 'whale_watcher', 'trend_follower'];

const DEFAULT_CONFIG = {
  confidence_threshold: 0.60,
  stop_loss_pct:        3.00,
  take_profit_pct:      6.00,
  max_position_pct:    10.00,
  max_trades_per_day:  10,
  allowed_pairs:       [],
};

// ── Utilities ──────────────────────────────────────────────────────────────────
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function pickRandom(arr, n) {
  const copy = [...arr];
  const out  = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

// ── Mutate config ──────────────────────────────────────────────────────────────
/**
 * Mutate 1-2 numeric params and optionally flip strategy.
 * Returns { mutatedConfig, mutatedStrategy, description }
 */
function mutateBot(config, strategy) {
  const mConfig   = deepClone(config);
  let   mStrategy = strategy;
  const desc      = [];

  // How many numeric params to mutate (1 or 2)
  const numMutate = 1 + Math.floor(Math.random() * 2);
  const picked    = pickRandom(PARAM_SPECS, numMutate);

  for (const spec of picked) {
    const old    = mConfig[spec.key] ?? ((DEFAULT_CONFIG[spec.key]));
    const range  = spec.max - spec.min;
    // ±10-20% of range
    const delta  = (0.10 + Math.random() * 0.10) * range * (Math.random() < 0.5 ? 1 : -1);
    // Round to step
    let newVal   = Math.round((old + delta) / spec.step) * spec.step;
    newVal       = parseFloat(clamp(newVal, spec.min, spec.max).toFixed(4));
    mConfig[spec.key] = newVal;
    desc.push(`${spec.key}: ${old}→${newVal}`);
  }

  // 15% chance: also flip strategy
  if (Math.random() < 0.15) {
    const other = STRATEGIES.filter(s => s !== mStrategy);
    mStrategy = other[Math.floor(Math.random() * other.length)];
    desc.push(`strategy: ${strategy}→${mStrategy}`);
  }

  return { mutatedConfig: mConfig, mutatedStrategy: mStrategy, description: desc.join(', ') };
}

// ── Backtester ─────────────────────────────────────────────────────────────────
/**
 * Pure-JS backtester. No API calls.
 *
 * For each battle (sorted by time):
 *   1. Does bot's prediction confidence exceed threshold? → take trade
 *   2. Simulate win/loss based on actual_x vs prediction direction
 *   3. Apply TP/SL to compute P&L
 *
 * prediction field: multiplier (e.g. 1.5 = predict +50%)
 * actual_x:         actual multiplier (e.g. 1.2 = gained +20%)
 *
 * Direction: prediction > 1.0 → long, < 1.0 → short
 * Win condition: direction matches actual movement
 *
 * P&L per trade (as % of position):
 *   win  → +take_profit_pct
 *   loss → -stop_loss_pct
 *
 * Score = total_pnl * sqrt(trade_count)   [same as NemoTrader]
 */
function backtest(battles, config, strategy, isBot1Array) {
  const confThresh = config.confidence_threshold ?? DEFAULT_CONFIG.confidence_threshold;
  const tpPct      = (config.take_profit_pct     ?? DEFAULT_CONFIG.take_profit_pct)     / 100;
  const slPct      = (config.stop_loss_pct        ?? DEFAULT_CONFIG.stop_loss_pct)        / 100;
  const maxPos     = (config.max_position_pct     ?? DEFAULT_CONFIG.max_position_pct)     / 100;

  let totalPnl    = 0;
  let tradeCount  = 0;
  let wins        = 0;
  let losses      = 0;

  for (let i = 0; i < battles.length; i++) {
    const b          = battles[i];
    const isBot1     = isBot1Array[i];
    const prediction = isBot1 ? b.bot1_prediction : b.bot2_prediction;
    const actualX    = b.actual_x;

    if (prediction == null || actualX == null) continue;

    // Confidence proxy: how far from neutral (1.0) the prediction is
    const confidence = Math.abs(prediction - 1.0);
    if (confidence < confThresh * 0.3) continue; // Scaled — conf_threshold 0-0.9 maps to 0-0.27 deviation

    // Direction of prediction
    const predictLong = prediction >= 1.0;
    const actualLong  = actualX    >= 1.0;
    const won         = predictLong === actualLong;

    // P&L as fraction of position size
    const pnl = won ? tpPct * maxPos : -slPct * maxPos;

    totalPnl   += pnl;
    tradeCount++;
    if (won) wins++; else losses++;
  }

  const score    = tradeCount > 0 ? totalPnl * Math.sqrt(tradeCount) : 0;
  const winRate  = tradeCount > 0 ? wins / tradeCount : 0;

  return { score, totalPnl, tradeCount, wins, losses, winRate };
}

// ── Supabase helpers ───────────────────────────────────────────────────────────
async function loadBots() {
  let query = supabase
    .from('bots')
    .select('id, name, model_id, strategy, trading_config')
    .eq('is_npc', true);

  if (BOT_ID) query = query.eq('id', BOT_ID);

  const { data, error } = await query;
  if (error) throw new Error(`loadBots: ${error.message}`);
  return data || [];
}

/**
 * Fetch last BATTLE_LIMIT finished battles for a bot (paginated).
 * Returns array of battles + isBot1Array (parallel arrays).
 */
async function loadBotBattles(botId) {
  const battles    = [];
  const isBot1Arr  = [];
  let   from       = 0;
  const limit      = Math.min(PAGE_SIZE, BATTLE_LIMIT);

  while (battles.length < BATTLE_LIMIT) {
    const fetchCount = Math.min(limit, BATTLE_LIMIT - battles.length);

    const { data, error } = await supabase
      .from('battles')
      .select('bot1_id, bot1_prediction, bot2_prediction, actual_x')
      .in('status', ['finished', 'resolved'])
      .or(`bot1_id.eq.${botId},bot2_id.eq.${botId}`)
      .not('actual_x', 'is', null)
      .order('created_at', { ascending: false })
      .range(from, from + fetchCount - 1);

    if (error) throw new Error(`loadBotBattles(${botId}): ${error.message}`);
    if (!data || data.length === 0) break;

    for (const b of data) {
      battles.push(b);
      isBot1Arr.push(b.bot1_id === botId);
    }

    from += data.length;
    if (data.length < fetchCount) break;
  }

  return { battles, isBot1Arr };
}

// ── Log ────────────────────────────────────────────────────────────────────────
const LOG_DIR  = path.join(__dirname, '..', 'data', 'evolution');
const LOG_FILE = path.join(LOG_DIR, 'evolution-v2-log.jsonl');

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function logExperiment(entry) {
  fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
}

// ── Karpathy loop for one bot ──────────────────────────────────────────────────
async function optimizeBot(bot) {
  const botLabel = `${bot.name} (id=${bot.id})`;
  console.log(`\n${'─'.repeat(70)}`);
  console.log(`🤖 ${botLabel}`);
  console.log(`   Strategy: ${bot.strategy || '?'}  |  Config: ${JSON.stringify(bot.trading_config || {})}`);

  // Load battles
  const { battles, isBot1Arr } = await loadBotBattles(bot.id);
  if (battles.length < 20) {
    console.log(`   ⚠️  Only ${battles.length} battles — skipping (need ≥20)`);
    return null;
  }
  console.log(`   📊 ${battles.length} battles loaded`);

  // Prepare config
  const initConfig   = { ...DEFAULT_CONFIG, ...(bot.trading_config || {}) };
  const initStrategy = bot.strategy || 'momentum';

  // Baseline
  const baseline = backtest(battles, initConfig, initStrategy, isBot1Arr);
  console.log(`   📐 Baseline: score=${baseline.score.toFixed(4)} | trades=${baseline.tradeCount} | winRate=${(baseline.winRate*100).toFixed(1)}% | pnl=${baseline.totalPnl.toFixed(4)}`);

  let bestConfig   = deepClone(initConfig);
  let bestStrategy = initStrategy;
  let bestScore    = baseline.score;
  let improvements = 0;

  const startedAt = new Date().toISOString();

  for (let n = 1; n <= EXPERIMENTS; n++) {
    const { mutatedConfig, mutatedStrategy, description } = mutateBot(bestConfig, bestStrategy);
    const result = backtest(battles, mutatedConfig, mutatedStrategy, isBot1Arr);
    const improved = result.score > bestScore;
    const delta    = result.score - bestScore;

    const logEntry = {
      ts:         new Date().toISOString(),
      bot_id:     bot.id,
      bot_name:   bot.name,
      experiment: n,
      mutation:   description,
      score_before: bestScore,
      score_after:  result.score,
      delta,
      trade_count:  result.tradeCount,
      win_rate:     result.winRate,
      total_pnl:    result.totalPnl,
      kept:         improved,
    };
    logExperiment(logEntry);

    if (improved) {
      bestConfig   = mutatedConfig;
      bestStrategy = mutatedStrategy;
      bestScore    = result.score;
      improvements++;
      const deltaStr = (delta >= 0 ? '+' : '') + delta.toFixed(4);
      console.log(`   ✅ [#${String(n).padStart(3)}] ${description.substring(0, 55).padEnd(55)} | ${deltaStr} → score=${bestScore.toFixed(4)}`);
    }
  }

  console.log(`\n   🏁 Done: ${improvements}/${EXPERIMENTS} improvements | Best score: ${bestScore.toFixed(4)} (baseline: ${baseline.score.toFixed(4)})`);

  const improvement = bestScore - baseline.score;
  const improvePct  = baseline.score !== 0 ? (improvement / Math.abs(baseline.score) * 100) : 0;
  console.log(`   📈 Improvement: ${improvement >= 0 ? '+' : ''}${improvement.toFixed(4)} (${improvePct.toFixed(1)}%)`);
  console.log(`   🎯 Final config: ${JSON.stringify(bestConfig)}`);
  console.log(`   🎯 Final strategy: ${bestStrategy}`);

  return {
    bot_id:        bot.id,
    bot_name:      bot.name,
    started_at:    startedAt,
    finished_at:   new Date().toISOString(),
    battles_used:  battles.length,
    experiments:   EXPERIMENTS,
    improvements,
    baseline_score:  baseline.score,
    best_score:      bestScore,
    improvement,
    improve_pct:     improvePct,
    baseline_config: initConfig,
    best_config:     bestConfig,
    baseline_strategy: initStrategy,
    best_strategy:     bestStrategy,
    baseline_win_rate: baseline.winRate,
    baseline_trades:   baseline.tradeCount,
  };
}

// ── Apply best params to Supabase ──────────────────────────────────────────────
async function applyResult(result) {
  const { error } = await supabase
    .from('bots')
    .update({
      strategy:       result.best_strategy,
      trading_config: result.best_config,
    })
    .eq('id', result.bot_id);

  if (error) {
    console.error(`   ❌ Failed to update bot ${result.bot_name}: ${error.message}`);
    return false;
  }
  console.log(`   ✅ Updated bot ${result.bot_name} in Supabase`);
  return true;
}

// ── Summary to dashboard data ──────────────────────────────────────────────────
function writeSummary(results) {
  const summaryPath = path.join(LOG_DIR, 'evolution-v2-summary.json');
  const summary = {
    generated_at:   new Date().toISOString(),
    dry_run:        DRY_RUN,
    total_bots:     results.length,
    total_improved: results.filter(r => r.improvement > 0).length,
    results: results.map(r => ({
      bot_id:            r.bot_id,
      bot_name:          r.bot_name,
      battles_used:      r.battles_used,
      experiments:       r.experiments,
      improvements:      r.improvements,
      baseline_score:    parseFloat(r.baseline_score.toFixed(4)),
      best_score:        parseFloat(r.best_score.toFixed(4)),
      improvement:       parseFloat(r.improvement.toFixed(4)),
      improve_pct:       parseFloat(r.improve_pct.toFixed(2)),
      baseline_win_rate: parseFloat((r.baseline_win_rate * 100).toFixed(1)),
      baseline_trades:   r.baseline_trades,
      baseline_config:   r.baseline_config,
      best_config:       r.best_config,
      baseline_strategy: r.baseline_strategy,
      best_strategy:     r.best_strategy,
      started_at:        r.started_at,
      finished_at:       r.finished_at,
    })),
  };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`\n📊 Summary written → ${summaryPath}`);
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  ensureLogDir();

  // 1. Load bots
  const bots = await loadBots();
  if (bots.length === 0) {
    console.log('⚠️  No bots found.');
    return;
  }
  console.log(`🤖 Loaded ${bots.length} bot(s)`);

  const results = [];

  // 2. Optimize each bot
  for (const bot of bots) {
    try {
      const result = await optimizeBot(bot);
      if (!result) continue;
      results.push(result);

      // 3. Apply if not dry-run and improvement exists
      if (!DRY_RUN && result.improvement > 0) {
        await applyResult(result);
      } else if (DRY_RUN) {
        console.log(`   [DRY RUN] Would update bot ${result.bot_name}`);
      } else {
        console.log(`   ℹ️  No improvement — keeping current params`);
      }
    } catch (err) {
      console.error(`❌ Error optimizing bot ${bot.name}: ${err.message}`);
    }
  }

  // 4. Summary
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

main().catch(err => {
  console.error('❌ Fatal error:', err.message);
  process.exit(1);
});
