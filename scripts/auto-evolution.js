#!/usr/bin/env node
/**
 * 🧬 Auto-Evolution Engine for GemBots Trading League (SQLite)
 * 
 * Migrated from Supabase → SQLite to fix connection pool timeouts.
 * Works with trading_battles + trading_elo + api_bots tables.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// Load .env.local
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

const db = new Database(path.join(__dirname, '..', 'data', 'gembots.db'));
db.pragma('journal_mode = WAL');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const HOURS = parseInt(args.find((a, i) => args[i - 1] === '--hours') || '6');
const BOTTOM_PCT = 0.20;
const TOP_PCT = 0.20;

const TRADING_STYLES = ['momentum', 'contrarian', 'swing', 'scalper', 'trend_follower'];

const MUTATIONS = {
  swapStrategy: (bot, donor) => ({
    ...bot,
    strategy: donor.strategy,
    mutation: `strategy: ${bot.strategy} → ${donor.strategy}`
  }),
  randomStyle: (bot) => {
    const styles = TRADING_STYLES.filter(s => s !== bot.strategy);
    const newStyle = styles[Math.floor(Math.random() * styles.length)];
    return { ...bot, strategy: newStyle, mutation: `random style: ${bot.strategy} → ${newStyle}` };
  }
};

function getPerformance(hoursBack) {
  const since = new Date(Date.now() - hoursBack * 3600000).toISOString().slice(0, 19).replace('T', ' ');
  
  const battles = db.prepare(`
    SELECT bot1_id, bot2_id, winner_id, bot1_pnl, bot2_pnl, bot1_model, bot2_model
    FROM trading_battles
    WHERE status = 'resolved' AND resolved_at > ?
  `).all(since);

  if (!battles || battles.length === 0) {
    console.log(`⚠️ No battles in last ${hoursBack}h`);
    return null;
  }

  console.log(`📊 Analyzing ${battles.length} battles from last ${hoursBack}h`);

  const stats = {};
  for (const b of battles) {
    for (const side of ['bot1', 'bot2']) {
      const botId = b[`${side}_id`];
      const pnl = b[`${side}_pnl`] || 0;
      if (!stats[botId]) stats[botId] = { wins: 0, losses: 0, battles: 0, totalPnl: 0 };
      stats[botId].battles++;
      stats[botId].totalPnl += pnl;
      if (b.winner_id === botId) stats[botId].wins++;
      else stats[botId].losses++;
    }
  }

  for (const s of Object.values(stats)) {
    s.winRate = s.battles > 0 ? s.wins / s.battles : 0;
    s.avgPnl = s.battles > 0 ? s.totalPnl / s.battles : 0;
    s.score = s.winRate * 100 + s.avgPnl * 10;
  }

  return { stats, totalBattles: battles.length };
}

function getBots() {
  return db.prepare(`
    SELECT id, name, strategy FROM api_bots WHERE hp > 0 OR hp IS NULL
  `).all();
}

function buildModelStrategyMatrix(hoursBack) {
  const since = new Date(Date.now() - hoursBack * 3600000).toISOString();

  const battles = db.prepare(`
    SELECT bot1_id, bot2_id, winner_id, bot1_model, bot2_model FROM trading_battles
    WHERE status = 'resolved' AND resolved_at > ?
  `).all(since);

  if (!battles || battles.length === 0) return null;

  const bots = db.prepare(`SELECT id, strategy FROM api_bots`).all();
  const botMap = {};
  for (const b of bots) botMap[b.id] = b;

  const matrix = {};
  for (const b of battles) {
    for (const [sideId, sideModel] of [['bot1_id', 'bot1_model'], ['bot2_id', 'bot2_model']]) {
      const botId = b[sideId];
      const model = b[sideModel];
      const bot = botMap[botId];
      if (!bot || !model || !bot.strategy) continue;
      const key = `${model}|${bot.strategy}`;
      if (!matrix[key]) matrix[key] = { model: model, style: bot.strategy, wins: 0, total: 0 };
      matrix[key].total++;
      if (b.winner_id === botId) matrix[key].wins++;
    }
  }

  const bestPerModel = {};
  for (const entry of Object.values(matrix)) {
    if (entry.total < 10) continue;
    entry.winRate = entry.wins / entry.total;
    if (!bestPerModel[entry.model] || entry.winRate > bestPerModel[entry.model].winRate) {
      bestPerModel[entry.model] = entry;
    }
  }

  return { matrix: Object.values(matrix), bestPerModel };
}

function evolve() {
  console.log(`\n🧬 GemBots Auto-Evolution Engine (SQLite)`);
  console.log(`   Hours: ${HOURS} | ${DRY_RUN ? '🏃 DRY RUN' : '🔥 LIVE'}\n`);

  const perf = getPerformance(HOURS);
  if (!perf) return;

  const bots = getBots();
  if (bots.length < 5) {
    console.log(`⚠️ Only ${bots.length} bots — need at least 5`);
    return;
  }

  console.log(`🤖 ${bots.length} bots loaded`);

  const ranked = bots
    .filter(b => perf.stats[b.id])
    .map(b => ({ ...b, ...perf.stats[b.id] }))
    .sort((a, b) => b.score - a.score);

  if (ranked.length < 5) {
    console.log(`⚠️ Only ${ranked.length} bots with battles — need at least 5`);
    return;
  }

  console.log(`\n📈 Rankings (${ranked.length} bots with battles):`);
  for (const [i, bot] of ranked.entries()) {
    const emoji = i < ranked.length * TOP_PCT ? '🏆' : i >= ranked.length * (1 - BOTTOM_PCT) ? '💀' : '  ';
    console.log(`  ${emoji} #${i + 1} ${(bot.name || '?').padEnd(20)} WR: ${(bot.winRate * 100).toFixed(1)}% | PnL: ${bot.avgPnl.toFixed(2)}% | Score: ${bot.score.toFixed(1)} | ${bot.strategy || '?'} | ${bot.battles}b`);
  }

  const topCount = Math.max(1, Math.floor(ranked.length * TOP_PCT));
  const bottomCount = Math.max(1, Math.floor(ranked.length * BOTTOM_PCT));
  const topBots = ranked.slice(0, topCount);
  const bottomBots = ranked.slice(-bottomCount);

  console.log(`\n🏆 Top ${topCount} (donors): ${topBots.map(b => b.name).join(', ')}`);
  console.log(`💀 Bottom ${bottomCount} (mutating): ${bottomBots.map(b => b.name).join(', ')}`);

  const mutations = [];
  for (const bot of bottomBots) {
    const donor = topBots[Math.floor(Math.random() * topBots.length)];
    const mutationKey = Math.random() < 0.7 ? 'swapStrategy' : 'randomStyle';
    const result = MUTATIONS[mutationKey](bot, donor);
    const mutation = result.mutation;
    delete result.mutation;

    mutations.push({
      botId: bot.id,
      botName: bot.name,
      donorName: donor.name,
      oldWinRate: bot.winRate,
      oldScore: bot.score,
      changes: [`${mutationKey}: ${mutation}`],
      newStrategy: result.strategy,
    });

    console.log(`\n  🧬 ${bot.name} (WR: ${(bot.winRate * 100).toFixed(1)}%) ← donor: ${donor.name} (WR: ${(donor.winRate * 100).toFixed(1)}%)`);
    console.log(`     → ${mutation}`);
  }

  // Apply mutations
  if (!DRY_RUN && mutations.length > 0) {
    console.log(`\n💾 Applying ${mutations.length} mutations...`);
    const updateStmt = db.prepare(`UPDATE api_bots SET strategy = ? WHERE id = ?`);
    for (const m of mutations) {
      try {
        updateStmt.run(m.newStrategy, m.botId);
        console.log(`  ✅ ${m.botName} → ${m.newStrategy}`);
      } catch (e) {
        console.log(`  ❌ Failed ${m.botName}: ${e.message}`);
      }
    }
  }

  // Model-Strategy Matrix
  console.log(`\n🧬 MODEL-STRATEGY MATRIX:`);
  const msMatrix = buildModelStrategyMatrix(HOURS * 2);

  if (msMatrix && Object.keys(msMatrix.bestPerModel).length > 0) {
    const sorted = msMatrix.matrix
      .filter(m => m.total >= 10)
      .sort((a, b) => (b.wins / b.total) - (a.wins / a.total));

    console.log(`\n  📊 Model × Style Win Rates:`);
    for (const s of sorted) {
      const wr = (s.wins / s.total * 100).toFixed(1);
      const isBest = msMatrix.bestPerModel[s.model]?.style === s.style;
      console.log(`  ${isBest ? '⭐' : '  '} ${(s.model || '?').padEnd(30)} ${(s.style || '?').padEnd(14)} WR: ${wr}% (${s.total}b)`);
    }

    // Get most common model per bot from recent battles
    const botModels = {};
    const recentBattles = db.prepare(`
      SELECT bot1_id, bot1_model, bot2_id, bot2_model FROM trading_battles
      WHERE status = 'resolved' AND resolved_at > ? AND bot1_model IS NOT NULL
    `).all(new Date(Date.now() - HOURS * 2 * 3600000).toISOString());
    for (const b of recentBattles) {
      if (b.bot1_model) { botModels[b.bot1_id] = b.bot1_model; }
      if (b.bot2_model) { botModels[b.bot2_id] = b.bot2_model; }
    }

    // Optimize bots to their model's best style
    const optimizations = [];
    for (const bot of ranked) {
      const modelId = botModels[bot.id];
      if (!modelId) continue;
      const best = msMatrix.bestPerModel[modelId];
      if (!best || bot.strategy === best.style || best.winRate < 0.5) continue;
      if (mutations.some(m => m.botId === bot.id)) continue;

      const currentEntry = msMatrix.matrix.find(m => m.model === modelId && m.style === bot.strategy);
      const currentWR = currentEntry ? currentEntry.wins / currentEntry.total : 0;
      const improvement = best.winRate - currentWR;

      if (improvement > 0.05) {
        optimizations.push({ botId: bot.id, botName: bot.name, oldStyle: bot.strategy, newStyle: best.style, improvement });
      }
    }

    if (optimizations.length > 0) {
      const toApply = optimizations.sort((a, b) => b.improvement - a.improvement).slice(0, 3);
      console.log(`\n  🎯 Model-Optimal Reassignments:`);
      for (const opt of toApply) {
        console.log(`  → ${opt.botName}: ${opt.oldStyle} → ${opt.newStyle} (+${(opt.improvement * 100).toFixed(1)}%)`);
        if (!DRY_RUN) {
          try {
            db.prepare(`UPDATE api_bots SET strategy = ? WHERE id = ?`).run(opt.newStyle, opt.botId);
            console.log(`    ✅ Applied`);
          } catch (e) {
            console.log(`    ❌ ${e.message}`);
          }
        }
      }
    } else {
      console.log(`  ✅ All bots on optimal styles`);
    }
  }

  // Save log
  const logEntry = {
    timestamp: new Date().toISOString(),
    hoursAnalyzed: HOURS,
    totalBattles: perf.totalBattles,
    botsRanked: ranked.length,
    mutations: mutations.map(m => ({
      bot: m.botName, donor: m.donorName,
      oldWR: (m.oldWinRate * 100).toFixed(1) + '%',
      changes: m.changes
    })),
    dryRun: DRY_RUN
  };

  const logDir = path.join(__dirname, '..', 'data', 'evolution');
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  fs.appendFileSync(path.join(logDir, 'evolution-log.jsonl'), JSON.stringify(logEntry) + '\n');

  console.log(`\n✅ Evolution complete! ${mutations.length} mutations from ${perf.totalBattles} battles.`);
}

try {
  evolve();
} catch (err) {
  console.error('❌ Evolution error:', err.message);
  process.exit(1);
} finally {
  db.close();
}
