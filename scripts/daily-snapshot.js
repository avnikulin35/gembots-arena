#!/usr/bin/env node
/**
 * GemBots Daily Snapshot — записывает итоги дня в BSC блокчейн
 * 
 * Одна транзакция в день: 0 BNB transfer на свой адрес с JSON в input data.
 * Данные: дата, тип турнира, топ ботов (ELO, wins, losses), итого боёв за день.
 * 
 * Источник данных: SQLite (Trading League)
 * База: ~/Projects/gembots/data/gembots.db
 * 
 * Запуск: node scripts/daily-snapshot.js [--date 2026-02-25] [--dry-run]
 */

const fs = require('fs');
const path = require('path');

// Load .env.local
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [key, ...val] = line.split('=');
    if (key && !key.startsWith('#') && val.length) {
      process.env[key.trim()] = val.join('=').trim().replace(/^["']|["']$/g, '');
    }
  });
}

// Also load contracts/.env for DEPLOYER_PRIVATE_KEY
const contractsEnvPath = path.join(__dirname, '..', 'contracts', 'bsc', '.env');
if (fs.existsSync(contractsEnvPath)) {
  fs.readFileSync(contractsEnvPath, 'utf8').split('\n').forEach(line => {
    const [key, ...val] = line.split('=');
    if (key && !key.startsWith('#') && val.length && !process.env[key.trim()]) {
      process.env[key.trim()] = val.join('=').trim().replace(/^["']|["']$/g, '');
    }
  });
}

const { ethers } = require('ethers');
const Database = require('better-sqlite3');

// --- Config ---
const DB_PATH = path.join(__dirname, '..', 'data', 'gembots.db');
const BSC_RPC = 'https://bsc-dataseed1.binance.org';
const DEPLOYER_PK = process.env.DEPLOYER_PRIVATE_KEY;
const WALLET_ADDRESS = '0x133C89BC9Dc375fBc46493A92f4Fd2486F8F0d76';

// --- Args ---
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const dateArg = args.find((a, i) => args[i - 1] === '--date');

// Default: yesterday (so we snapshot a complete day)
function getSnapshotDate() {
  if (dateArg) return dateArg;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split('T')[0];
}

async function main() {
  const snapshotDate = getSnapshotDate();
  console.log(`📸 GemBots Daily Snapshot for ${snapshotDate}`);
  console.log(`   Mode: ${dryRun ? '🧪 DRY RUN' : '🔗 ON-CHAIN'}`);
  console.log(`   Source: SQLite (Trading League)`);

  if (!fs.existsSync(DB_PATH)) {
    console.error(`❌ SQLite DB not found: ${DB_PATH}`);
    process.exit(1);
  }

  const db = new Database(DB_PATH, { readonly: true });

  // 1. Total battles (all time)
  const totalBattles = db.prepare(
    `SELECT COUNT(*) as cnt FROM trading_battles WHERE status = 'resolved'`
  ).get().cnt;

  // 2. Battles today (resolved on snapshotDate)
  const battlesToday = db.prepare(
    `SELECT COUNT(*) as cnt FROM trading_battles
     WHERE status = 'resolved' AND DATE(resolved_at) = ?`
  ).get(snapshotDate).cnt;

  console.log(`   ⚔️ Total battles: ${totalBattles}`);
  console.log(`   📅 Battles today (${snapshotDate}): ${battlesToday}`);

  // 3. Unique tokens traded today
  const tokenRows = db.prepare(
    `SELECT DISTINCT symbol FROM trading_battles
     WHERE status = 'resolved' AND DATE(resolved_at) = ?
     ORDER BY symbol`
  ).all(snapshotDate);
  const tokens = tokenRows.map(r => r.symbol);

  // 4. Top bots by ELO (join with api_bots for name, find model from battles)
  const topBotsRaw = db.prepare(
    `SELECT e.bot_id as id, b.name, e.elo, e.wins, e.losses
     FROM trading_elo e
     JOIN api_bots b ON b.id = e.bot_id
     ORDER BY e.elo DESC
     LIMIT 10`
  ).all();

  // Find most-recently-used model for each bot
  const topBots = topBotsRaw.map(bot => {
    // Check bot1_model and bot2_model — pick the latest non-null model this bot used
    const modelRow = db.prepare(
      `SELECT bot1_model as model FROM trading_battles
       WHERE bot1_id = ? AND bot1_model IS NOT NULL
       ORDER BY COALESCE(resolved_at, started_at) DESC LIMIT 1`
    ).get(bot.id)
      || db.prepare(
      `SELECT bot2_model as model FROM trading_battles
       WHERE bot2_id = ? AND bot2_model IS NOT NULL
       ORDER BY COALESCE(resolved_at, started_at) DESC LIMIT 1`
    ).get(bot.id);

    return {
      id: bot.id,
      name: bot.name,
      elo: Math.round(bot.elo * 100) / 100,
      wins: bot.wins,
      losses: bot.losses,
      model: modelRow ? modelRow.model : null,
    };
  });

  // 5. Unique models used across all battles
  const modelRows = db.prepare(
    `SELECT DISTINCT bot1_model as model FROM trading_battles WHERE bot1_model IS NOT NULL
     UNION
     SELECT DISTINCT bot2_model FROM trading_battles WHERE bot2_model IS NOT NULL
     ORDER BY model`
  ).all();
  const models = modelRows.map(r => r.model);

  db.close();

  // 6. Build snapshot payload
  const snapshot = {
    date: snapshotDate,
    type: 'trading_league',
    totalBattles,
    battlesToday,
    tokens,
    topBots,
    models,
  };

  const jsonStr = JSON.stringify(snapshot);
  const dataBytes = ethers.toUtf8Bytes(jsonStr);

  console.log(`\n   📦 Payload: ${jsonStr.length} bytes`);
  console.log(`   🪙 Tokens today: ${tokens.join(', ') || 'none'}`);
  console.log(`   🏆 Top 3:`);
  topBots.slice(0, 3).forEach((b, i) => {
    console.log(`      ${i + 1}. ${b.name} — ELO ${b.elo} | ${b.wins}W/${b.losses}L | ${b.model || 'unknown model'}`);
  });
  console.log(`\n   JSON snapshot:\n${JSON.stringify(snapshot, null, 2)}`);

  if (dryRun) {
    console.log('\n🧪 DRY RUN — snapshot NOT sent to blockchain');
    console.log(`   Would send tx with ${dataBytes.length} bytes data to ${WALLET_ADDRESS}`);
    return;
  }

  // 7. Send on-chain
  if (!DEPLOYER_PK) {
    console.error('❌ Missing DEPLOYER_PRIVATE_KEY');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(BSC_RPC);
  const wallet = new ethers.Wallet(DEPLOYER_PK, provider);
  
  console.log(`\n   🔑 Wallet: ${wallet.address}`);
  const balance = await provider.getBalance(wallet.address);
  console.log(`   💰 Balance: ${ethers.formatEther(balance)} BNB`);

  if (balance === 0n) {
    console.error('❌ No BNB for gas');
    process.exit(1);
  }

  try {
    // Send to null address (0x0...dead) — we just need the data in the tx, not the recipient
    const SNAPSHOT_TARGET = '0x000000000000000000000000000000000000dEaD';
    const tx = await wallet.sendTransaction({
      to: SNAPSHOT_TARGET,
      value: 0,
      data: ethers.hexlify(dataBytes),
      gasLimit: 21000 + dataBytes.length * 68,
    });
    
    console.log(`   📤 TX sent: ${tx.hash}`);
    console.log(`   ⏳ Waiting for confirmation...`);
    
    const receipt = await tx.wait();
    console.log(`   ✅ Confirmed in block ${receipt.blockNumber}`);
    console.log(`   🔗 https://bscscan.com/tx/${tx.hash}`);
    
    // Save record locally
    const recordPath = path.join(__dirname, '..', 'data', 'snapshots.json');
    let records = [];
    try { records = JSON.parse(fs.readFileSync(recordPath, 'utf8')); } catch {}
    records.push({
      date: snapshotDate,
      type: 'trading_league',
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      totalBattles,
      battlesToday,
      gasUsed: receipt.gasUsed.toString(),
      ts: new Date().toISOString(),
    });
    fs.writeFileSync(recordPath, JSON.stringify(records, null, 2));
    console.log(`   💾 Saved to data/snapshots.json`);
    
  } catch (e) {
    console.error(`   ❌ TX failed: ${e.message}`);
    process.exit(1);
  }
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
