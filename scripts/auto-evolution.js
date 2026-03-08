#!/usr/bin/env node
/**
 * 🧬 Auto-Evolution Engine for GemBots Arena
 * 
 * Darwinian evolution of bot strategies:
 * 1. Analyze recent battle performance
 * 2. Identify worst performers (bottom 20%)
 * 3. Mutate their strategies by borrowing traits from top performers
 * 4. Update bot configs in DB
 * 5. Log all mutations for tracking
 * 
 * Run: node scripts/auto-evolution.js [--dry-run] [--hours 6]
 * Cron: every 3 hours via PM2/cron
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load .env.local
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
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const HOURS = parseInt(args.find((a, i) => args[i - 1] === '--hours') || '6');
const MUTATION_RATE = 0.3; // 30% parameter shift
const BOTTOM_PCT = 0.20; // Bottom 20% get mutated
const TOP_PCT = 0.20; // Top 20% donate traits

// Trading style parameters that can be mutated
const TRADING_STYLES = ['momentum', 'contrarian', 'swing', 'scalper'];
const RISK_LEVELS = ['low', 'medium', 'high', 'extreme'];
const TIMEFRAMES = ['1m', '5m', '15m', '1h'];

// Mutation operators
const MUTATIONS = {
  // Swap strategy entirely
  swapStyle: (bot, donor) => ({
    ...bot,
    strategy: donor.strategy,
    mutation: `strategy: ${bot.strategy} → ${donor.strategy}`
  }),

  // Swap strategy (trend_follower, whale_watcher, etc.)
  swapStrategy: (bot, donor) => ({
    ...bot,
    strategy: donor.strategy,
    mutation: `strategy: ${bot.strategy} → ${donor.strategy}`
  }),

  // Crossover: take donor's trading_config
  crossoverConfig: (bot, donor) => {
    const donorConfig = donor.trading_config || {};
    const botConfig = bot.trading_config || {};
    // Merge: take some keys from donor
    const merged = { ...botConfig };
    for (const key of Object.keys(donorConfig)) {
      if (Math.random() < 0.5) {
        merged[key] = donorConfig[key];
      }
    }
    return {
      ...bot,
      trading_config: merged,
      mutation: `config crossover from ${donor.name}`
    };
  },

  // Random style mutation
  randomStyle: (bot) => {
    const styles = TRADING_STYLES.filter(s => s !== bot.strategy);
    const newStyle = styles[Math.floor(Math.random() * styles.length)];
    return {
      ...bot,
      strategy: newStyle,
      mutation: `random style: ${bot.strategy} → ${newStyle}`
    };
  }
};

async function getPerformance(hoursBack) {
  const since = new Date(Date.now() - hoursBack * 3600000).toISOString();
  
  // Get all resolved battles in timeframe
  const { data: battles, error } = await supabase
    .from('battles')
    .select('bot1_id, bot2_id, winner_id, bot1_prediction, bot2_prediction, actual_x, token_symbol')
    .eq('status', 'resolved')
    .gte('finished_at', since)
    .limit(5000);

  if (error) throw new Error(`Failed to fetch battles: ${error.message}`);
  if (!battles || battles.length === 0) {
    console.log(`⚠️ No battles in last ${hoursBack}h`);
    return null;
  }

  console.log(`📊 Analyzing ${battles.length} battles from last ${hoursBack}h`);

  // Aggregate per bot
  const stats = {};
  for (const b of battles) {
    for (const botId of [b.bot1_id, b.bot2_id]) {
      if (!stats[botId]) stats[botId] = { wins: 0, losses: 0, battles: 0, predictions: [], actuals: [] };
      stats[botId].battles++;
      const isBot1 = botId === b.bot1_id;
      const prediction = isBot1 ? b.bot1_prediction : b.bot2_prediction;
      stats[botId].predictions.push(prediction || 1);
      stats[botId].actuals.push(b.actual_x || 1);
      if (b.winner_id === botId) stats[botId].wins++;
      else stats[botId].losses++;
    }
  }

  // Calculate win rates and accuracy
  for (const [botId, s] of Object.entries(stats)) {
    s.winRate = s.battles > 0 ? s.wins / s.battles : 0;
    // Prediction accuracy: how close predictions were to actual
    const errors = s.predictions.map((p, i) => Math.abs(p - s.actuals[i]));
    s.avgError = errors.reduce((a, b) => a + b, 0) / errors.length;
    s.score = s.winRate * 100 - s.avgError * 50; // Composite score
  }

  return { stats, totalBattles: battles.length };
}

async function getBots() {
  const { data: bots, error } = await supabase
    .from('bots')
    .select('id, name, strategy, model_id, elo, is_npc, trading_config, strategy_cache')
    .eq('is_npc', true); // Only evolve NPC (host) bots

  if (error) throw new Error(`Failed to fetch bots: ${error.message}`);
  return bots || [];
}

/**
 * 🧬 Model-Strategy Matrix
 * Analyzes which trading_style works best for each AI model
 * Then reassigns underperforming bots to their model's optimal style
 */
async function buildModelStrategyMatrix(hoursBack) {
  const since = new Date(Date.now() - hoursBack * 3600000).toISOString();
  
  // Get battles
  const { data: battles, error: bErr } = await supabase
    .from('battles')
    .select('bot1_id, bot2_id, winner_id')
    .eq('status', 'resolved')
    .gte('finished_at', since)
    .limit(5000);

  if (bErr || !battles || battles.length === 0) return null;

  // Get all bots with model info
  const { data: bots } = await supabase
    .from('bots')
    .select('id, model_id, strategy');
  
  const botMap = {};
  for (const b of bots || []) botMap[b.id] = b;

  // Build matrix: model|style → { wins, total }
  const matrix = {};
  for (const b of battles) {
    for (const side of ['bot1_id', 'bot2_id']) {
      const botId = b[side];
      const bot = botMap[botId];
      if (!bot || !bot.model_id || !bot.strategy) continue;
      const key = `${bot.model_id}|${bot.strategy}`;
      if (!matrix[key]) matrix[key] = { model: bot.model_id, style: bot.strategy, wins: 0, total: 0 };
      matrix[key].total++;
      if (b.winner_id === botId) matrix[key].wins++;
    }
  }

  // Calculate win rates and find best style per model
  const bestPerModel = {};
  for (const entry of Object.values(matrix)) {
    if (entry.total < 10) continue; // Min sample size
    entry.winRate = entry.wins / entry.total;
    
    if (!bestPerModel[entry.model] || entry.winRate > bestPerModel[entry.model].winRate) {
      bestPerModel[entry.model] = entry;
    }
  }

  return { matrix: Object.values(matrix), bestPerModel };
}

async function evolve() {
  console.log(`\n🧬 GemBots Auto-Evolution Engine`);
  console.log(`   Hours: ${HOURS} | Mutation Rate: ${MUTATION_RATE} | ${DRY_RUN ? '🏃 DRY RUN' : '🔥 LIVE'}\n`);

  // 1. Get performance data
  const perf = await getPerformance(HOURS);
  if (!perf) return;

  // 2. Get all host bots
  const bots = await getBots();
  if (bots.length < 5) {
    console.log(`⚠️ Only ${bots.length} host bots — need at least 5 for evolution`);
    return;
  }

  console.log(`🤖 ${bots.length} host bots loaded`);

  // 3. Score and rank bots
  const ranked = bots
    .filter(b => perf.stats[b.id]) // Only bots with battles
    .map(b => ({
      ...b,
      ...perf.stats[b.id]
    }))
    .sort((a, b) => b.score - a.score);

  if (ranked.length < 5) {
    console.log(`⚠️ Only ${ranked.length} bots with battles — need at least 5`);
    return;
  }

  // Print rankings
  console.log(`\n📈 Rankings (${ranked.length} bots with battles):`);
  for (const [i, bot] of ranked.entries()) {
    const emoji = i < ranked.length * TOP_PCT ? '🏆' : i >= ranked.length * (1 - BOTTOM_PCT) ? '💀' : '  ';
    console.log(`  ${emoji} #${i + 1} ${bot.name.padEnd(20)} WR: ${(bot.winRate * 100).toFixed(1)}% | Score: ${bot.score.toFixed(1)} | Style: ${bot.strategy || '?'} | ${bot.battles}b`);
  }

  // 4. Identify top & bottom
  const topCount = Math.max(1, Math.floor(ranked.length * TOP_PCT));
  const bottomCount = Math.max(1, Math.floor(ranked.length * BOTTOM_PCT));
  const topBots = ranked.slice(0, topCount);
  const bottomBots = ranked.slice(-bottomCount);

  console.log(`\n🏆 Top ${topCount} (donors): ${topBots.map(b => b.name).join(', ')}`);
  console.log(`💀 Bottom ${bottomCount} (mutating): ${bottomBots.map(b => b.name).join(', ')}`);

  // 5. Apply mutations
  const mutations = [];
  for (const bot of bottomBots) {
    // Pick a random donor from top bots
    const donor = topBots[Math.floor(Math.random() * topBots.length)];
    
    // Pick 1-2 random mutations
    const mutationKeys = Object.keys(MUTATIONS);
    const numMutations = 1 + Math.floor(Math.random() * 2); // 1-2
    const selectedMutations = [];
    
    for (let i = 0; i < numMutations; i++) {
      const key = mutationKeys[Math.floor(Math.random() * mutationKeys.length)];
      selectedMutations.push(key);
    }

    let mutated = { ...bot };
    const appliedMutations = [];

    for (const key of selectedMutations) {
      const result = MUTATIONS[key](mutated, donor);
      if (result.mutation) {
        appliedMutations.push(`${key}: ${result.mutation}`);
        delete result.mutation;
      }
      mutated = result;
    }

    mutations.push({
      botId: bot.id,
      botName: bot.name,
      donorName: donor.name,
      oldWinRate: bot.winRate,
      oldScore: bot.score,
      changes: appliedMutations,
      updates: {
        strategy: mutated.strategy,
        trading_config: mutated.trading_config,
      }
    });

    console.log(`\n  🧬 ${bot.name} (WR: ${(bot.winRate * 100).toFixed(1)}%) ← donor: ${donor.name} (WR: ${(donor.winRate * 100).toFixed(1)}%)`);
    for (const m of appliedMutations) {
      console.log(`     → ${m}`);
    }
  }

  // 6. Apply to DB (if not dry run)
  if (!DRY_RUN && mutations.length > 0) {
    console.log(`\n💾 Applying ${mutations.length} mutations to DB...`);
    for (const m of mutations) {
      const { error } = await supabase
        .from('bots')
        .update(m.updates)
        .eq('id', m.botId);
      
      if (error) {
        console.log(`  ❌ Failed ${m.botName}: ${error.message}`);
      } else {
        console.log(`  ✅ ${m.botName} updated`);
      }
    }
  }

  // 6.5 Model-Strategy Matrix optimization
  console.log(`\n🧬 MODEL-STRATEGY MATRIX OPTIMIZATION:`);
  const msMatrix = await buildModelStrategyMatrix(HOURS * 2); // Use wider window for more data
  
  if (msMatrix && Object.keys(msMatrix.bestPerModel).length > 0) {
    // Print matrix
    const sorted = msMatrix.matrix
      .filter(m => m.total >= 10)
      .sort((a, b) => (b.wins/b.total) - (a.wins/a.total));
    
    console.log(`\n  📊 Model × Style Win Rates:`);
    for (const s of sorted) {
      const wr = (s.wins / s.total * 100).toFixed(1);
      const isBest = msMatrix.bestPerModel[s.model]?.style === s.style;
      console.log(`  ${isBest ? '⭐' : '  '} ${(s.model || '?').padEnd(22)} ${(s.style || '?').padEnd(14)} WR: ${wr}% (${s.total}b)`);
    }
    
    // Find bots that should switch to their model's best style
    const modelOptimizations = [];
    for (const bot of ranked) {
      const best = msMatrix.bestPerModel[bot.model_id];
      if (!best) continue;
      if (bot.strategy === best.style) continue; // Already optimal
      if (best.winRate < 0.5) continue; // Don't optimize to a losing style
      
      // Check if this bot is already in mutations (from step 5)
      const alreadyMutated = mutations.some(m => m.botId === bot.id);
      if (alreadyMutated) continue;
      
      // Only optimize if significant difference
      const currentEntry = msMatrix.matrix.find(m => m.model === bot.model_id && m.style === bot.strategy);
      const currentWR = currentEntry ? currentEntry.wins / currentEntry.total : 0;
      const improvement = best.winRate - currentWR;
      
      if (improvement > 0.05) { // >5% improvement threshold
        modelOptimizations.push({
          botId: bot.id,
          botName: bot.name,
          model: bot.model_id,
          oldStyle: bot.strategy,
          newStyle: best.style,
          oldWR: currentWR,
          newExpectedWR: best.winRate,
          improvement
        });
      }
    }
    
    if (modelOptimizations.length > 0) {
      // Apply top 3 model optimizations (don't change too many at once)
      const toApply = modelOptimizations
        .sort((a, b) => b.improvement - a.improvement)
        .slice(0, 3);
      
      console.log(`\n  🎯 Model-Optimal Style Reassignments:`);
      for (const opt of toApply) {
        console.log(`  → ${opt.botName} (${opt.model}): ${opt.oldStyle} → ${opt.newStyle} (expected +${(opt.improvement * 100).toFixed(1)}% WR)`);
        
        if (!DRY_RUN) {
          const { error } = await supabase
            .from('bots')
            .update({ strategy: opt.newStyle })
            .eq('id', opt.botId);
          
          if (error) console.log(`    ❌ Failed: ${error.message}`);
          else console.log(`    ✅ Applied`);
        }
        
        mutations.push({
          botId: opt.botId,
          botName: opt.botName,
          donorName: 'MODEL-MATRIX',
          oldWinRate: opt.oldWR,
          oldScore: 0,
          changes: [`model-optimal: ${opt.oldStyle} → ${opt.newStyle} (${opt.model}, +${(opt.improvement * 100).toFixed(1)}%)`],
          updates: { strategy: opt.newStyle }
        });
      }
    } else {
      console.log(`  ✅ All bots already on optimal styles for their models`);
    }
  } else {
    console.log(`  ⚠️ Not enough data for model-strategy matrix`);
  }

  // 7. Save evolution log
  const logEntry = {
    timestamp: new Date().toISOString(),
    hoursAnalyzed: HOURS,
    totalBattles: perf.totalBattles,
    botsRanked: ranked.length,
    mutations: mutations.map(m => ({
      bot: m.botName,
      donor: m.donorName,
      oldWR: (m.oldWinRate * 100).toFixed(1) + '%',
      score: m.oldScore.toFixed(1),
      changes: m.changes
    })),
    dryRun: DRY_RUN
  };

  const logDir = path.join(__dirname, '..', 'data', 'evolution');
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  
  const logFile = path.join(logDir, 'evolution-log.jsonl');
  fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
  console.log(`\n📝 Log saved to ${logFile}`);

  // Summary
  console.log(`\n✅ Evolution complete! ${mutations.length} bots mutated from ${perf.totalBattles} battles.`);
  return { mutations: mutations.length, battles: perf.totalBattles };
}

evolve().catch(err => {
  console.error('❌ Evolution error:', err.message);
  process.exit(1);
});
