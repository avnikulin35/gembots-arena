#!/usr/bin/env node
/**
 * Export DPO (Direct Preference Optimization) dataset from GemBots battles.
 * 
 * Format: JSONL with fields:
 *   - prompt: battle context (token, market data, timeframe)
 *   - chosen: winner's prediction + reasoning
 *   - rejected: loser's prediction + reasoning
 *   - metadata: actual_x, token, duration, bot names, elo
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PGCMD = 'PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -t -A -F"|"';

async function main() {
  console.log('🔬 Exporting DPO dataset from GemBots battles...\n');
  
  // Query battles with real prices, winner, and both predictions
  const query = `
    SELECT 
      b.id,
      b.token_symbol,
      b.duration_minutes,
      b.entry_price,
      b.market_price,
      b.market_price_1h_ago,
      b.market_price_24h_ago,
      b.market_btc_price,
      b.actual_x,
      b.bot1_prediction,
      b.bot2_prediction,
      50 as bot1_confidence,
      50 as bot2_confidence,
      b.winner_id,
      b.bot1_id,
      b.bot2_id,
      b.bot1_name,
      b.bot2_name,
      COALESCE((SELECT name FROM bots WHERE id=b.bot1_id), b.bot1_name, 'Bot1') as bot1_resolved,
      COALESCE((SELECT name FROM bots WHERE id=b.bot2_id), b.bot2_name, 'Bot2') as bot2_resolved,
      COALESCE((SELECT strategy FROM bots WHERE id=b.bot1_id), 'unknown') as bot1_strategy,
      COALESCE((SELECT strategy FROM bots WHERE id=b.bot2_id), 'unknown') as bot2_strategy,
      'momentum' as strategy,
      b.created_at
    FROM battles b
    WHERE b.status = 'resolved'
      AND b.entry_price IS NOT NULL
      AND b.actual_x IS NOT NULL
      AND b.actual_x != 1.0
      AND b.bot1_prediction IS NOT NULL
      AND b.bot2_prediction IS NOT NULL
      AND b.winner_id IS NOT NULL
    ORDER BY b.created_at ASC
  `;

  const raw = execSync(`${PGCMD} -c "${query.replace(/\n/g, ' ')}"`, { maxBuffer: 100 * 1024 * 1024 }).toString().trim();
  
  if (!raw) {
    console.log('❌ No battles found!');
    process.exit(1);
  }

  const lines = raw.split('\n').filter(l => l.trim());
  console.log(`📊 Found ${lines.length} battles with real prices\n`);

  const dpoRecords = [];
  const sftRecords = [];
  let skipped = 0;

  for (const line of lines) {
    const fields = line.split('|');
    if (fields.length < 24) { skipped++; continue; }

    const [
      id, token, duration, entryPrice, marketPrice,
      price1h, price24h, btcPrice, actualX,
      bot1Pred, bot2Pred, bot1Conf, bot2Conf,
      winnerId, bot1Id, bot2Id, bot1Name, bot2Name,
      bot1Resolved, bot2Resolved, bot1Strategy, bot2Strategy,
      strategy, createdAt
    ] = fields;

    const entry = parseFloat(entryPrice);
    const actual = parseFloat(actualX);
    const pred1 = parseFloat(bot1Pred);
    const pred2 = parseFloat(bot2Pred);

    if (isNaN(entry) || isNaN(actual) || isNaN(pred1) || isNaN(pred2)) { skipped++; continue; }
    if (actual === 1.0) { skipped++; continue; }

    // Determine winner/loser predictions
    const bot1Won = winnerId === bot1Id;
    const winnerPred = bot1Won ? pred1 : pred2;
    const loserPred = bot1Won ? pred2 : pred1;
    const winnerName = bot1Won ? bot1Resolved : bot2Resolved;
    const loserName = bot1Won ? bot2Resolved : bot1Resolved;
    const winnerConf = bot1Won ? (bot1Conf || '50') : (bot2Conf || '50');
    const loserConf = bot1Won ? (bot2Conf || '50') : (bot1Conf || '50');

    // Calculate price changes for context
    const priceChange1h = price1h ? ((entry - parseFloat(price1h)) / parseFloat(price1h) * 100).toFixed(2) : 'N/A';
    const priceChange24h = price24h ? ((entry - parseFloat(price24h)) / parseFloat(price24h) * 100).toFixed(2) : 'N/A';
    const btcPriceVal = btcPrice ? `$${parseFloat(btcPrice).toFixed(0)}` : 'N/A';

    // Build prompt (battle context)
    const prompt = `You are a crypto price prediction model. Analyze the market data and predict the price multiplier after ${duration || 5} minutes.

Token: ${token}
Current Price: $${entry.toFixed(4)}
1h Price Change: ${priceChange1h}%
24h Price Change: ${priceChange24h}%
BTC Price: ${btcPriceVal}
Strategy: ${strategy || 'momentum'}
Duration: ${duration || 5} minutes

Predict the price multiplier (e.g., 1.02 for +2%, 0.98 for -2%). Include your confidence level.`;

    // Build chosen (winner) response
    const chosen = `Prediction: ${winnerPred.toFixed(4)}x\nConfidence: ${winnerConf}%\nThe price will ${winnerPred >= 1 ? 'increase' : 'decrease'} by ${Math.abs((winnerPred - 1) * 100).toFixed(2)}% in the next ${duration || 5} minutes.`;

    // Build rejected (loser) response
    const rejected = `Prediction: ${loserPred.toFixed(4)}x\nConfidence: ${loserConf}%\nThe price will ${loserPred >= 1 ? 'increase' : 'decrease'} by ${Math.abs((loserPred - 1) * 100).toFixed(2)}% in the next ${duration || 5} minutes.`;

    // DPO record
    dpoRecords.push({
      prompt,
      chosen,
      rejected,
      metadata: {
        battle_id: id,
        token,
        duration_minutes: parseInt(duration) || 5,
        entry_price: entry,
        actual_x: actual,
        winner_prediction: winnerPred,
        loser_prediction: loserPred,
        winner_name: winnerName.trim(),
        loser_name: loserName.trim(),
        winner_error: Math.abs(winnerPred - actual),
        loser_error: Math.abs(loserPred - actual),
        created_at: createdAt
      }
    });

    // SFT record (just the winner)
    sftRecords.push({
      messages: [
        { role: 'system', content: 'You are a crypto price prediction model. Predict price multipliers accurately based on market data.' },
        { role: 'user', content: prompt },
        { role: 'assistant', content: chosen }
      ],
      metadata: {
        battle_id: id,
        token,
        actual_x: actual,
        prediction: winnerPred,
        error: Math.abs(winnerPred - actual)
      }
    });
  }

  // Save datasets
  const dataDir = path.join(__dirname, '..', 'data', 'training');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  // DPO dataset
  const dpoPath = path.join(dataDir, 'dpo-dataset.jsonl');
  fs.writeFileSync(dpoPath, dpoRecords.map(r => JSON.stringify(r)).join('\n') + '\n');

  // SFT dataset (winner only)
  const sftPath = path.join(dataDir, 'sft-dataset.jsonl');
  fs.writeFileSync(sftPath, sftRecords.map(r => JSON.stringify(r)).join('\n') + '\n');

  // Stats
  const tokens = {};
  const strategies = {};
  let totalWinnerError = 0;
  let totalLoserError = 0;

  for (const r of dpoRecords) {
    tokens[r.metadata.token] = (tokens[r.metadata.token] || 0) + 1;
    totalWinnerError += r.metadata.winner_error;
    totalLoserError += r.metadata.loser_error;
  }

  console.log('📁 Files saved:');
  console.log(`   DPO: ${dpoPath} (${dpoRecords.length} records)`);
  console.log(`   SFT: ${sftPath} (${sftRecords.length} records)`);
  console.log(`   Skipped: ${skipped}`);
  console.log(`\n📊 Distribution by token:`);
  Object.entries(tokens).sort((a, b) => b[1] - a[1]).forEach(([t, c]) => {
    console.log(`   ${t}: ${c} (${(c / dpoRecords.length * 100).toFixed(1)}%)`);
  });
  console.log(`\n🎯 Avg winner error: ${(totalWinnerError / dpoRecords.length).toFixed(4)}`);
  console.log(`   Avg loser error:  ${(totalLoserError / dpoRecords.length).toFixed(4)}`);
  console.log(`   Winner is ${((totalLoserError / totalWinnerError - 1) * 100).toFixed(1)}% more accurate`);

  // File sizes
  const dpoSize = (fs.statSync(dpoPath).size / 1024 / 1024).toFixed(1);
  const sftSize = (fs.statSync(sftPath).size / 1024 / 1024).toFixed(1);
  console.log(`\n💾 Sizes: DPO ${dpoSize}MB, SFT ${sftSize}MB`);
}

main().catch(e => { console.error(e); process.exit(1); });
