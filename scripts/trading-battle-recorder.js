#!/usr/bin/env node
/**
 * Trading League Battle Recorder — On-Chain (Batch Mode)
 * 
 * Records resolved Trading League battles to BSC mainnet via NFA v5 contract.
 * Uses recordBattle(nfaId, opponentNfaId, won, battleId) — winner/loser based on P&L.
 * 
 * Only records battles where BOTH bots have NFA IDs.
 * 
 * Usage:
 *   node scripts/trading-battle-recorder.js              # Record all unrecorded
 *   node scripts/trading-battle-recorder.js --dry-run     # Preview only
 *   node scripts/trading-battle-recorder.js --max 50      # Limit batch size
 */

const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const Database = require('better-sqlite3');

// ── ENV ──

const envLocalPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envLocalPath)) {
  fs.readFileSync(envLocalPath, 'utf8').split('\n').forEach(line => {
    const [key, ...val] = line.split('=');
    if (key && !key.startsWith('#')) {
      let v = val.join('=').trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!process.env[key.trim()]) process.env[key.trim()] = v;
    }
  });
}

const bscEnvPath = path.join(__dirname, '..', 'contracts', 'bsc', '.env');
if (fs.existsSync(bscEnvPath)) {
  fs.readFileSync(bscEnvPath, 'utf8').split('\n').forEach(line => {
    const [key, ...val] = line.split('=');
    if (key && !key.startsWith('#')) {
      let v = val.join('=').trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!process.env[key.trim()]) process.env[key.trim()] = v;
    }
  });
}

// ── CONFIG ──

const NFA_CONTRACT = '0x9bC5f392cE8C7aA13BD5bC7D5A1A12A4DD58b3D5';
const BSC_RPC = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/';
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY;
const DB_PATH = path.join(__dirname, '..', 'data', 'gembots.db');
const STATE_FILE = path.join(__dirname, '..', 'data', 'trading-recorder-state.json');
const TX_DELAY_MS = 1500;

// ── CLI ARGS ──

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const maxIdx = args.indexOf('--max');
const MAX_BATCH = maxIdx !== -1 ? parseInt(args[maxIdx + 1]) : 100;

// ── HELPERS ──

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { lastRecordedId: null, totalRecorded: 0, lastRun: null }; }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ── MAIN ──

async function main() {
  if (!DEPLOYER_KEY) {
    log('❌ DEPLOYER_PRIVATE_KEY not set. Check contracts/bsc/.env');
    process.exit(1);
  }

  const db = new Database(DB_PATH, { readonly: true });
  const state = loadState();

  log('🔗 Trading League Battle Recorder');
  log(`   Contract: ${NFA_CONTRACT}`);
  log(`   Dry run: ${DRY_RUN}`);
  log(`   Max batch: ${MAX_BATCH}`);
  log(`   Last recorded: ${state.lastRecordedId || 'none'}`);

  // Get resolved battles where both bots have NFA IDs
  // Join with api_bots to get nfa_id for both participants
  const battles = db.prepare(`
    SELECT 
      tb.id,
      tb.bot1_id, tb.bot2_id,
      tb.winner_id,
      tb.bot1_pnl, tb.bot2_pnl,
      tb.symbol,
      tb.resolved_at,
      b1.nfa_id as bot1_nfa_id,
      b1.name as bot1_name,
      b2.nfa_id as bot2_nfa_id,
      b2.name as bot2_name
    FROM trading_battles tb
    JOIN api_bots b1 ON b1.id = tb.bot1_id
    JOIN api_bots b2 ON b2.id = tb.bot2_id
    WHERE tb.status = 'resolved'
      AND b1.nfa_id IS NOT NULL
      AND b2.nfa_id IS NOT NULL
      AND tb.id NOT IN (
        SELECT battle_id FROM trading_onchain_records
      )
    ORDER BY tb.resolved_at ASC
    LIMIT ?
  `).all(MAX_BATCH);

  log(`📊 Found ${battles.length} recordable battles (both bots have NFA)`);

  if (battles.length === 0) {
    log('✅ Nothing to record. All caught up!');
    db.close();
    return;
  }

  if (DRY_RUN) {
    for (const b of battles) {
      const winner = b.winner_id === b.bot1_id ? b.bot1_name : 
                     b.winner_id === b.bot2_id ? b.bot2_name : 'Draw';
      log(`  ${b.symbol} | NFA#${b.bot1_nfa_id} vs NFA#${b.bot2_nfa_id} | Winner: ${winner} | PnL: ${(b.bot1_pnl || 0).toFixed(2)}% vs ${(b.bot2_pnl || 0).toFixed(2)}%`);
    }
    log(`\n🔍 DRY RUN complete. Would record ${battles.length} battles.`);
    db.close();
    return;
  }

  // Connect to BSC
  const provider = new ethers.JsonRpcProvider(BSC_RPC);
  const wallet = new ethers.Wallet(DEPLOYER_KEY, provider);
  const balance = await provider.getBalance(wallet.address);
  log(`   Wallet: ${wallet.address} | Balance: ${ethers.formatEther(balance)} BNB`);

  const contract = new ethers.Contract(NFA_CONTRACT, [
    'function recordBattle(uint256 nfaId, uint256 opponentNfaId, bool won, string battleId)'
  ], wallet);

  // Create tracking table if not exists (need writable connection)
  const dbWrite = new Database(DB_PATH);
  dbWrite.exec(`
    CREATE TABLE IF NOT EXISTS trading_onchain_records (
      battle_id TEXT PRIMARY KEY,
      tx_hash TEXT,
      nfa_id INTEGER,
      opponent_nfa_id INTEGER,
      won INTEGER,
      recorded_at TEXT DEFAULT (datetime('now'))
    )
  `);

  const insertRecord = dbWrite.prepare(`
    INSERT OR IGNORE INTO trading_onchain_records (battle_id, tx_hash, nfa_id, opponent_nfa_id, won)
    VALUES (?, ?, ?, ?, ?)
  `);

  let recorded = 0;
  let errors = 0;

  for (const battle of battles) {
    try {
      // Record for bot1's NFA perspective
      const bot1Won = battle.winner_id === battle.bot1_id;
      const bot2Won = battle.winner_id === battle.bot2_id;
      const isDraw = !battle.winner_id;

      // Record from winner's perspective (or bot1 if draw)
      const nfaId = bot1Won || isDraw ? battle.bot1_nfa_id : battle.bot2_nfa_id;
      const opponentId = bot1Won || isDraw ? battle.bot2_nfa_id : battle.bot1_nfa_id;
      const won = bot1Won || bot2Won; // false for draws

      log(`⛓️  Recording: NFA#${nfaId} vs NFA#${opponentId} | Won: ${won} | ${battle.symbol}`);

      const tx = await contract.recordBattle(nfaId, opponentId, won, battle.id);
      const receipt = await tx.wait();
      
      log(`   ✅ TX: ${receipt.hash} (gas: ${receipt.gasUsed.toString()})`);

      insertRecord.run(battle.id, receipt.hash, nfaId, opponentId, won ? 1 : 0);
      recorded++;

      await sleep(TX_DELAY_MS);
    } catch (err) {
      log(`   ❌ Error: ${err.message?.slice(0, 100)}`);
      errors++;
      if (errors >= 3) {
        log('🛑 Too many errors, stopping.');
        break;
      }
    }
  }

  state.totalRecorded = (state.totalRecorded || 0) + recorded;
  state.lastRun = new Date().toISOString();
  saveState(state);

  log(`\n📋 Summary: ${recorded} recorded, ${errors} errors, ${state.totalRecorded} total all-time`);
  
  dbWrite.close();
  db.close();
}

main().catch(err => {
  log(`💥 Fatal: ${err.message}`);
  process.exit(1);
});
