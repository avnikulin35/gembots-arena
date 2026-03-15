#!/usr/bin/env node
/**
 * GemBots NFA Battle Recorder — BATCH MODE
 * 
 * Collects battles from Supabase and records them on-chain in batches.
 * Designed to run manually or via cron every 2-3 days (NOT continuous polling).
 * 
 * Contract: 0x9bC5f392cE8C7aA13BD5bC7D5A1A12A4DD58b3D5 (BSC Mainnet)
 * 
 * Usage:
 *   node scripts/nfa-battle-recorder.js                    # Record all unrecorded battles
 *   node scripts/nfa-battle-recorder.js --since 2026-02-18 # Record battles since date
 *   node scripts/nfa-battle-recorder.js --dry-run           # Show what would be recorded
 *   node scripts/nfa-battle-recorder.js --max 50            # Limit batch size
 * 
 * Cron example (every 3 days at 06:00 UTC):
 *   0 6 1,4,7,10,13,16,19,22,25,28 * * cd ~/Projects/gembots && node scripts/nfa-battle-recorder.js
 */

const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

// ============================================================================
// ENV
// ============================================================================

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

// ============================================================================
// CONFIG
// ============================================================================

const BSC_RPC_URL = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/';
const NFA_CONTRACT_ADDRESS = '0x9bC5f392cE8C7aA13BD5bC7D5A1A12A4DD58b3D5';
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const STATE_FILE = path.join(__dirname, '..', 'data', 'nfa-recorder-state.json');

// Tier thresholds (matches contract)
const TIER_THRESHOLDS = [0, 10, 50, 100, 250];

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 3000;
const TX_DELAY_MS = 1500; // delay between on-chain txs to avoid nonce issues

// ============================================================================
// CLI ARGS
// ============================================================================

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const sinceIdx = args.indexOf('--since');
const SINCE_DATE = sinceIdx !== -1 ? args[sinceIdx + 1] : null;
const maxIdx = args.indexOf('--max');
const MAX_BATCH = maxIdx !== -1 ? parseInt(args[maxIdx + 1], 10) : 500;

// ============================================================================
// ABI
// ============================================================================

const NFA_ABI = [
  'function recordBattle(uint256 nfaId, uint256 opponentNfaId, bool won, string battleId) external',
  'function evolve(uint256 nfaId) external',
  'function totalSupply() view returns (uint256)',
  'function getBattleStats(uint256 nfaId) view returns (tuple(uint256 wins, uint256 losses, uint256 totalBattles, uint256 currentStreak, uint256 bestStreak))',
  'function nfas(uint256) view returns (uint256 agentId, bytes32 configHash, string configURI, address originalCreator, uint8 tier)',
  'event BattleRecorded(uint256 indexed nfaId, uint256 opponentNfaId, bool won, string battleId)',
  'event Evolved(uint256 indexed nfaId, uint8 newTier)',
];

// ============================================================================
// LOGGING
// ============================================================================

function log(...args) {
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  console.log(`[NFA-BATCH ${ts}]`, ...args);
}

function logError(...args) {
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  console.error(`[NFA-BATCH ${ts}] ❌`, ...args);
}

// ============================================================================
// STATE
// ============================================================================

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (e) { logError('Load state failed:', e.message); }
  return {
    processedBattles: {},  // battleId → { recorded, timestamp }
    nfaMapping: {},        // botId → nfaId (cache)
    stats: { totalBatched: 0, totalEvolved: 0, totalErrors: 0, lastRun: null },
  };
}

function saveState(state) {
  try {
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) { logError('Save state failed:', e.message); }
}

// ============================================================================
// SUPABASE
// ============================================================================

async function supabaseGet(endpoint) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

// ============================================================================
// BLOCKCHAIN
// ============================================================================

let provider, wallet, contract;

function initBlockchain() {
  if (!DEPLOYER_PRIVATE_KEY) {
    logError('DEPLOYER_PRIVATE_KEY not set! Set it in contracts/bsc/.env');
    process.exit(1);
  }
  provider = new ethers.JsonRpcProvider(BSC_RPC_URL, { name: 'bsc', chainId: 56 });
  wallet = new ethers.Wallet(DEPLOYER_PRIVATE_KEY, provider);
  contract = new ethers.Contract(NFA_CONTRACT_ADDRESS, NFA_ABI, wallet);
}

async function sendTx(name, txFn, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      log(`  ⏳ ${name} (attempt ${attempt})...`);
      const tx = await txFn();
      log(`  📤 TX: ${tx.hash}`);
      const receipt = await tx.wait();
      log(`  ✅ Confirmed (block ${receipt.blockNumber}, gas ${receipt.gasUsed})`);
      return { success: true, hash: tx.hash, gasUsed: receipt.gasUsed };
    } catch (e) {
      const msg = e.message || String(e);
      if (msg.includes('revert') || msg.includes('NotBattleResolver')) {
        logError(`  ${name} reverted: ${msg.slice(0, 200)}`);
        return { success: false, error: msg, revert: true };
      }
      logError(`  ${name} attempt ${attempt} failed: ${msg.slice(0, 200)}`);
      if (attempt < retries) await sleep(RETRY_DELAY_MS);
    }
  }
  return { success: false, error: 'Max retries' };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============================================================================
// NFA MAPPING
// ============================================================================

async function loadNfaMappings(state) {
  try {
    // Get all bots that have nfa_id set
    const bots = await supabaseGet('bots?nfa_id=not.is.null&select=id,name,nfa_id');
    for (const bot of bots) {
      state.nfaMapping[bot.id] = bot.nfa_id;
    }
    log(`📋 Loaded ${bots.length} bot→NFA mappings from Supabase`);
    return bots.length;
  } catch (e) {
    logError('Failed to load NFA mappings:', e.message);
    return 0;
  }
}

// ============================================================================
// GAS ESTIMATION
// ============================================================================

async function estimateBatchGas(battles, state) {
  let totalGas = BigInt(0);
  let recordableBattles = 0;

  for (const battle of battles) {
    const winnerId = battle.winner_id;
    const loserId = battle.bot1_id === winnerId ? battle.bot2_id : battle.bot1_id;
    const winnerNfaId = state.nfaMapping[winnerId];
    const loserNfaId = state.nfaMapping[loserId];

    if (!winnerNfaId || !loserNfaId) continue;
    recordableBattles++;

    // Each battle = 2 recordBattle calls (~130K gas each)
    totalGas += BigInt(260_000);
  }

  // Get current gas price
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice || ethers.parseUnits('1', 'gwei');
  const totalCostWei = totalGas * gasPrice;
  const totalCostBNB = ethers.formatEther(totalCostWei);

  return {
    recordableBattles,
    estimatedGas: totalGas.toString(),
    gasPriceGwei: ethers.formatUnits(gasPrice, 'gwei'),
    estimatedCostBNB: totalCostBNB,
    estimatedCostUSD: (parseFloat(totalCostBNB) * 600).toFixed(2), // rough BNB price
  };
}

// ============================================================================
// MAIN BATCH LOGIC
// ============================================================================

async function main() {
  console.log('');
  log('═══════════════════════════════════════════════════════');
  log('  GemBots NFA Battle Recorder — BATCH MODE');
  log(`  Contract: ${NFA_CONTRACT_ADDRESS}`);
  log(`  Mode: ${DRY_RUN ? '🔍 DRY RUN' : '🔴 LIVE'}`);
  if (SINCE_DATE) log(`  Since: ${SINCE_DATE}`);
  log(`  Max batch: ${MAX_BATCH}`);
  log('═══════════════════════════════════════════════════════');

  if (!DRY_RUN) {
    initBlockchain();
    const balance = await provider.getBalance(wallet.address);
    log(`🔑 Resolver: ${wallet.address}`);
    log(`💰 Balance: ${ethers.formatEther(balance)} BNB`);

    const totalSupply = await contract.totalSupply();
    log(`🤖 Total NFAs on-chain: ${totalSupply}`);
  }

  const state = loadState();
  
  // Load bot→NFA mappings from Supabase
  const mappingCount = await loadNfaMappings(state);
  if (mappingCount === 0) {
    log('⚠️  No bots have NFA tokens linked. Nothing to record.');
    log('   Link NFAs to bots first via /api/nfa/link or mint page.');
    return;
  }

  // Fetch resolved battles
  let query = 'battles?status=eq.resolved&order=finished_at.asc';
  if (SINCE_DATE) {
    query += `&finished_at=gte.${SINCE_DATE}T00:00:00Z`;
  } else if (state.stats.lastRun) {
    // Since last run
    query += `&finished_at=gte.${state.stats.lastRun}`;
  }
  query += `&limit=${MAX_BATCH}`;

  log(`📡 Fetching battles from Supabase...`);
  const allBattles = await supabaseGet(query);
  log(`   Found ${allBattles.length} resolved battles`);

  // Filter out already processed
  const newBattles = allBattles.filter(b => !state.processedBattles[String(b.id)]);
  log(`   New (unprocessed): ${newBattles.length}`);

  if (newBattles.length === 0) {
    log('✅ No new battles to record. All caught up!');
    state.stats.lastRun = new Date().toISOString();
    saveState(state);
    return;
  }

  // Categorize battles
  const recordable = [];
  const skipped = [];
  
  for (const battle of newBattles) {
    const winnerId = battle.winner_id;
    const loserId = battle.bot1_id === winnerId ? battle.bot2_id : battle.bot1_id;
    const winnerNfaId = state.nfaMapping[winnerId];
    const loserNfaId = state.nfaMapping[loserId];

    if (winnerNfaId && loserNfaId) {
      recordable.push({ battle, winnerNfaId, loserNfaId });
    } else {
      skipped.push({ battle, reason: !winnerNfaId && !loserNfaId ? 'both_no_nfa' : 'one_no_nfa' });
    }
  }

  log(`\n📊 BATCH SUMMARY:`);
  log(`   Total new battles:  ${newBattles.length}`);
  log(`   Recordable (both have NFA): ${recordable.length}`);
  log(`   Skipped (missing NFA):      ${skipped.length}`);

  // Gas estimation
  if (recordable.length > 0) {
    if (!DRY_RUN) {
      const gasInfo = await estimateBatchGas(newBattles, state);
      log(`\n⛽ GAS ESTIMATE:`);
      log(`   Recordable battles: ${gasInfo.recordableBattles}`);
      log(`   On-chain txs needed: ${gasInfo.recordableBattles * 2} (2 per battle)`);
      log(`   Gas price: ${gasInfo.gasPriceGwei} gwei`);
      log(`   Estimated total gas: ${gasInfo.estimatedGas}`);
      log(`   Estimated cost: ~${gasInfo.estimatedCostBNB} BNB (~$${gasInfo.estimatedCostUSD})`);
    }

    if (DRY_RUN) {
      log(`\n🔍 DRY RUN — would record ${recordable.length} battles:`);
      for (const { battle, winnerNfaId, loserNfaId } of recordable.slice(0, 20)) {
        log(`   Battle #${battle.id}: NFA#${winnerNfaId} beat NFA#${loserNfaId} (${battle.finished_at})`);
      }
      if (recordable.length > 20) log(`   ... and ${recordable.length - 20} more`);
    } else {
      // Execute batch recording
      log(`\n🚀 RECORDING ${recordable.length} BATTLES ON-CHAIN...`);
      let successCount = 0;
      let errorCount = 0;
      let totalGasUsed = BigInt(0);

      for (let i = 0; i < recordable.length; i++) {
        const { battle, winnerNfaId, loserNfaId } = recordable[i];
        const battleId = String(battle.id);
        
        log(`\n⚔️  [${i + 1}/${recordable.length}] Battle #${battleId}: NFA#${winnerNfaId} vs NFA#${loserNfaId}`);

        // Record winner
        const winResult = await sendTx(
          `recordBattle(NFA#${winnerNfaId} WON)`,
          () => contract.recordBattle(winnerNfaId, loserNfaId, true, battleId),
        );

        if (winResult.success && winResult.gasUsed) {
          totalGasUsed += winResult.gasUsed;
        }

        await sleep(TX_DELAY_MS);

        // Record loser
        const loseResult = await sendTx(
          `recordBattle(NFA#${loserNfaId} LOST)`,
          () => contract.recordBattle(loserNfaId, winnerNfaId, false, battleId),
        );

        if (loseResult.success && loseResult.gasUsed) {
          totalGasUsed += loseResult.gasUsed;
        }

        if (winResult.success && loseResult.success) {
          successCount++;
          state.processedBattles[battleId] = {
            recorded: true,
            winnerNfaId,
            loserNfaId,
            timestamp: Date.now(),
          };
        } else {
          errorCount++;
          state.processedBattles[battleId] = {
            recorded: false,
            error: winResult.error || loseResult.error,
            timestamp: Date.now(),
          };
          state.stats.totalErrors++;
        }

        // Save state periodically
        if (i % 10 === 0) saveState(state);
        await sleep(TX_DELAY_MS);
      }

      // Try evolving NFAs that may qualify
      log(`\n🌟 Checking evolution eligibility...`);
      const nfaIds = new Set();
      for (const { winnerNfaId, loserNfaId } of recordable) {
        nfaIds.add(winnerNfaId);
        nfaIds.add(loserNfaId);
      }

      let evolveCount = 0;
      for (const nfaId of nfaIds) {
        try {
          const stats = await contract.getBattleStats(nfaId);
          const wins = Number(stats.wins);
          const nfaData = await contract.nfas(nfaId);
          const currentTier = Number(nfaData.tier);

          if (currentTier >= 4) continue;
          const nextThreshold = TIER_THRESHOLDS[currentTier + 1];
          if (wins >= nextThreshold) {
            log(`   🌟 NFA#${nfaId}: ${wins} wins >= ${nextThreshold} → evolving!`);
            const result = await sendTx(`evolve(NFA#${nfaId})`, () => contract.evolve(nfaId));
            if (result.success) {
              evolveCount++;
              state.stats.totalEvolved++;
            }
            await sleep(TX_DELAY_MS);
          }
        } catch (e) {
          // Non-critical
        }
      }

      state.stats.totalBatched += successCount;
      state.stats.lastRun = new Date().toISOString();

      log(`\n════════════════════════════════════════`);
      log(`  BATCH COMPLETE`);
      log(`  Recorded: ${successCount}/${recordable.length}`);
      log(`  Errors: ${errorCount}`);
      log(`  Evolved: ${evolveCount}`);
      log(`  Total gas used: ${totalGasUsed.toString()}`);
      log(`════════════════════════════════════════\n`);
    }
  }

  // Mark skipped battles so we don't re-process them
  for (const { battle, reason } of skipped) {
    state.processedBattles[String(battle.id)] = { skipped: true, reason, timestamp: Date.now() };
  }

  // Cleanup old entries (keep last 2000)
  const entries = Object.entries(state.processedBattles);
  if (entries.length > 2000) {
    entries.sort((a, b) => (b[1].timestamp || 0) - (a[1].timestamp || 0));
    const keep = new Set(entries.slice(0, 2000).map(([k]) => k));
    for (const [k] of entries) {
      if (!keep.has(k)) delete state.processedBattles[k];
    }
    log('🧹 Cleaned up old state entries');
  }

  saveState(state);
  log('✅ Done.');
}

main().catch(err => { logError('Fatal:', err); process.exit(1); });
