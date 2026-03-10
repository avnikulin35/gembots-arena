#!/usr/bin/env node
// Load env from .env file
const fs = require('fs');
const envPath = require('path').join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [key, ...val] = line.split('=');
    if (key && !key.startsWith('#') && val.length) {
      process.env[key.trim()] = val.join('=').trim().replace(/^["']|["']$/g, '');
    }
  });
}
/**
 * GemBots Battle Resolver v2 — with ELO Rating + On-Chain Recording
 * 
 * Runs every 10 seconds:
 * 1. Finds battles with status='active' where resolves_at has passed
 * 2. Fetches real token price from Bybit API
 * 3. Calculates actual_x multiplier
 * 4. Determines winner (closest prediction)
 * 5. Updates HP, wins/losses, ELO rating, league
 * 6. Resolves battle
 */

const { ethers } = require('ethers');

// ============================================
// ON-CHAIN BATTLE RECORDER
// ============================================
const BATTLE_RECORDER_ADDRESS = '0x4BaA0bCCD27D68a9A752c0a603b3C0b6E870b3F0';
const BSC_RPC = 'https://bsc-dataseed1.binance.org';
const RECORDER_ABI = [
  'function recordBattle(string battleId, uint256 winnerNfaId, uint256 loserNfaId, string token, uint64 winnerAccuracy, uint64 loserAccuracy, uint64 damage) external',
  'function totalBattlesRecorded() view returns (uint256)',
];

let recorderContract = null;
try {
  const pk = process.env.DEPLOYER_PRIVATE_KEY;
  if (pk) {
    const provider = new ethers.JsonRpcProvider(BSC_RPC);
    const wallet = new ethers.Wallet(pk, provider);
    recorderContract = new ethers.Contract(BATTLE_RECORDER_ADDRESS, RECORDER_ABI, wallet);
    console.log('🔗 On-chain BattleRecorder connected');
  } else {
    console.warn('⚠️ No DEPLOYER_PRIVATE_KEY — on-chain recording disabled');
  }
} catch (e) {
  console.warn('⚠️ BattleRecorder init failed:', e.message);
}

/**
 * Record battle result on-chain (non-blocking, fire-and-forget)
 */
async function recordBattleOnChain(battleId, winnerNfaId, loserNfaId, tokenSymbol, winnerAccBps, loserAccBps, damage) {
  if (!recorderContract) return;
  if (!winnerNfaId || !loserNfaId) {
    console.log('   ⏭️ Skip on-chain: one or both bots have no NFA');
    return;
  }
  try {
    const tx = await recorderContract.recordBattle(
      battleId,
      winnerNfaId,
      loserNfaId,
      tokenSymbol,
      winnerAccBps,
      loserAccBps,
      damage
    );
    console.log(`   ⛓️ On-chain TX: ${tx.hash}`);
    // Don't await receipt — fire and forget to not block resolver
    tx.wait().then(receipt => {
      console.log(`   ⛓️ Confirmed in block ${receipt.blockNumber} (gas: ${receipt.gasUsed})`);
    }).catch(err => {
      console.warn(`   ⚠️ On-chain TX failed: ${err.message}`);
    });
  } catch (e) {
    console.warn(`   ⚠️ On-chain record failed: ${e.message}`);
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY ;

const RESOLVE_INTERVAL = 10000; // 10 seconds
const HP_DAMAGE = 10; // HP lost by loser
const BOT_TOKEN = process.env.BOT_TOKEN;

// ============================================
// TELEGRAM NOTIFICATIONS
// ============================================

async function sendTelegramNotification(telegramId, message) {
  if (!telegramId || !BOT_TOKEN) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramId,
        text: message,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '🎮 Open Arena', web_app: { url: 'https://gembots.space' } }
          ]]
        }
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      // Silently ignore - user may have blocked the bot
      if (!err.includes('bot was blocked') && !err.includes('chat not found')) {
        console.log(`   📱 TG notify failed for ${telegramId}: ${res.status}`);
      }
    }
  } catch (e) {
    // Non-critical, don't crash resolver
  }
}

async function notifyBattleResult(winner, loser, battle, actual_x, eloResult) {
  const tokenSymbol = battle.token_symbol || '???';
  const stakeAmount = battle.stake_sol || 0;
  
  // Notify winner
  if (winner.telegram_id) {
    const winMsg = stakeAmount > 0
      ? `🏆 *Victory!* Your bot *${winner.name}* beat *${loser.name}*!\n\n` +
        `📈 Token: $${tokenSymbol} | Result: ${actual_x.toFixed(2)}x\n` +
        `🎯 Your prediction: ${battle[`bot${battle.bot1_id === winner.id ? '1' : '2'}_prediction`]}x\n` +
        `💰 Won: ${stakeAmount} SOL\n` +
        `📊 ELO: ${eloResult.winnerNewElo} (+${eloResult.winnerDelta})`
      : `🏆 *Victory!* Your bot *${winner.name}* beat *${loser.name}*!\n\n` +
        `📈 Token: $${tokenSymbol} | Result: ${actual_x.toFixed(2)}x\n` +
        `🎯 Your prediction: ${battle[`bot${battle.bot1_id === winner.id ? '1' : '2'}_prediction`]}x\n` +
        `📊 ELO: ${eloResult.winnerNewElo} (+${eloResult.winnerDelta})`;
    await sendTelegramNotification(winner.telegram_id, winMsg);
  }
  
  // Notify loser
  if (loser.telegram_id) {
    const newHp = Math.max(0, (loser.hp || 100) - HP_DAMAGE);
    const loseMsg = `⚔️ *Battle Lost!* *${loser.name}* lost to *${winner.name}*\n\n` +
      `📈 Token: $${tokenSymbol} | Result: ${actual_x.toFixed(2)}x\n` +
      `❤️ HP: ${newHp}/100\n` +
      `📊 ELO: ${eloResult.loserNewElo} (${eloResult.loserDelta})` +
      (newHp === 0 ? '\n\n💀 *Bot eliminated!* Time to rebuild...' : '');
    await sendTelegramNotification(loser.telegram_id, loseMsg);
  }
}

// ============================================
// ELO SYSTEM (mirrors src/lib/elo.ts)
// ============================================

function getKFactor(totalGames) {
  if (totalGames < 10) return 40;
  if (totalGames < 30) return 25;
  return 16;
}

function expectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

function calculateElo(winnerElo, loserElo, winnerGames, loserGames, predictionDiff) {
  winnerElo = winnerElo || 1000;
  loserElo = loserElo || 1000;
  winnerGames = winnerGames || 0;
  loserGames = loserGames || 0;
  predictionDiff = predictionDiff || 1.0;

  const kWinner = getKFactor(winnerGames);
  const kLoser = getKFactor(loserGames);
  
  const expWin = expectedScore(winnerElo, loserElo);
  const expLose = expectedScore(loserElo, winnerElo);
  
  let winnerDelta = Math.round(kWinner * (1 - expWin));
  let loserDelta = Math.round(kLoser * (0 - expLose));
  
  // Perfect prediction bonus (diff < 0.1x)
  const isPerfect = predictionDiff < 0.1;
  if (isPerfect) winnerDelta = Math.round(winnerDelta * 1.5);
  
  // Upset bonus (lower ELO beats higher by 100+)
  const isUpset = loserElo - winnerElo >= 100;
  if (isUpset) winnerDelta = Math.round(winnerDelta * 1.25);
  
  winnerDelta = Math.max(winnerDelta, 1);
  loserDelta = Math.min(loserDelta, -1);
  
  return {
    winnerNewElo: Math.max(100, winnerElo + winnerDelta),
    loserNewElo: Math.max(100, loserElo + loserDelta),
    winnerDelta,
    loserDelta,
    isPerfect,
    isUpset,
  };
}

function getLeagueName(elo) {
  if (elo >= 2000) return 'diamond';
  if (elo >= 1500) return 'gold';
  if (elo >= 1000) return 'silver';
  return 'bronze';
}

// ============================================
// SUPABASE HELPERS
// ============================================

async function supabaseRequest(endpoint, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
    ...options,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': options.prefer || 'return=representation',
      ...options.headers,
    },
  });
  
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Supabase error: ${res.status} - ${text}`);
  }
  
  return text ? JSON.parse(text) : null;
}

// Bybit symbol mappings for price fetching
const BYBIT_BY_ADDRESS = {
  'So11111111111111111111111111111111111111112': 'SOLUSDT',
  '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c': 'BNBUSDT', // BSC BNB
  '0x2170Ed0880ac9A755fd29B2688956BD959F933F8': 'ETHUSDT', // BSC ETH
  '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c': 'BTCUSDT', // BSC BTC
  '0x0D8Ce2A99Bb6e3B7Db580eD848240e4a0F9aE153': 'WIFUSDT', // BSC WIF
  '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82': 'CAKEUSDT',
  '0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD': 'LINKUSDT',
  'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm': 'WIFUSDT', // Solana WIF
};
const BYBIT_BY_SYMBOL = {
  'BTC': 'BTCUSDT', 'ETH': 'ETHUSDT', 'SOL': 'SOLUSDT',
  'BNB': 'BNBUSDT', 'WIF': 'WIFUSDT', 'CAKE': 'CAKEUSDT',
  'LINK': 'LINKUSDT', 'PEPE': 'PEPEUSDT', 'ADA': 'ADAUSDT',
  'XRP': 'XRPUSDT', 'DOGE': 'DOGEUSDT', 'AVAX': 'AVAXUSDT',
  'DOT': 'DOTUSDT', 'SHIB': 'SHIBUSDT', 'MATIC': 'MATICUSDT',
  'MEW': 'MEWUSDT', 'POPCAT': 'POPCATUSDT', 'JTO': 'JTOUSDT',
};

async function fetchTokenPrice(address, tokenSymbol) {
  // 1) Try Bybit API first (fast, no Cloudflare issues)
  const bybitSymbol = BYBIT_BY_ADDRESS[address] || (tokenSymbol && BYBIT_BY_SYMBOL[tokenSymbol.toUpperCase()]);
  if (bybitSymbol) {
    try {
      const res = await fetch(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${bybitSymbol}`);
      const data = await res.json();
      if (data?.result?.list?.[0]) {
        const t = data.result.list[0];
        const price = parseFloat(t.lastPrice);
        const prevPrice24h = t.prevPrice24h ? parseFloat(t.prevPrice24h) : null;
        const priceChange1h = 0; // Bybit ticker doesn't provide 1h change
        const priceChange5m = 0;
        if (price > 0) {
          console.log(`   Bybit price for ${tokenSymbol || address}: $${price} (${bybitSymbol})`);
          return { price, priceChange5m, priceChange1h, source: 'bybit' };
        }
      }
    } catch (e) {
      console.warn(`Bybit price fetch failed for ${bybitSymbol}:`, e.message);
    }
  }

  // 2) Fallback: Jupiter Price API v2
  try {
    const res = await fetch(`https://api.jup.ag/price/v2?ids=${address}`);
    const data = await res.json();
    if (data.data && data.data[address]) {
      const price = parseFloat(data.data[address].price) || 0;
      console.log(`Jupiter fallback price for ${address}: $${price}`);
      return {
        price,
        priceChange5m: 0, // Jupiter doesn't provide change data
        priceChange1h: 0,
        source: 'jupiter',
      };
    }
  } catch (e) {
    console.warn('Jupiter fallback failed:', e.message);
  }

  // Last resort: simulate
  console.warn(`All price sources failed for ${address}, using simulation`);
  return {
    price: 0,
    priceChange5m: (Math.random() - 0.3) * 50,
    priceChange1h: (Math.random() - 0.3) * 100,
    source: 'simulated',
  };
}

// ============================================
// BATTLE RESOLUTION
// ============================================

async function resolveBattle(battle, bot1, bot2) {
  console.log(`\n⚔️ Resolving battle ${battle.id.slice(0, 8)}...`);
  console.log(`   Token: ${battle.token_symbol}`);
  console.log(`   ${bot1.name} (ELO:${bot1.elo || 1000}): ${battle.bot1_prediction}x | ${bot2.name} (ELO:${bot2.elo || 1000}): ${battle.bot2_prediction}x`);
  
  // Fetch current price data
  const priceData = await fetchTokenPrice(battle.token_address, battle.token_symbol);
  let actual_x;
  if (battle.entry_price && battle.entry_price > 0 && priceData.price && priceData.price > 0) {
    actual_x = priceData.price / battle.entry_price;
    console.log(`   Entry: $${battle.entry_price} → Current: $${priceData.price} = ${actual_x.toFixed(4)}x`);
  } else {
    // Fallback to priceChange if no entry_price
    actual_x = Math.max(0.1, 1 + (priceData.priceChange5m / 100));
    console.log(`   ⚠️ No entry_price, using change: ${actual_x.toFixed(4)}x`);
  }
  actual_x = Math.max(0.1, actual_x); // safety floor
  
  // Determine winner (closest to actual)
  const diff1 = Math.abs(battle.bot1_prediction - actual_x);
  const diff2 = Math.abs(battle.bot2_prediction - actual_x);
  
  const bot1Wins = diff1 <= diff2;
  const winner = bot1Wins ? bot1 : bot2;
  const loser = bot1Wins ? bot2 : bot1;
  const winnerDiff = Math.min(diff1, diff2);
  
  console.log(`   Winner: ${winner.name} (diff: ${winnerDiff.toFixed(2)})`);
  
  // Calculate ELO changes
  const winnerTotalGames = (winner.wins || 0) + (winner.losses || 0);
  const loserTotalGames = (loser.wins || 0) + (loser.losses || 0);
  
  const eloResult = calculateElo(
    winner.elo || 1000,
    loser.elo || 1000,
    winnerTotalGames,
    loserTotalGames,
    winnerDiff,
  );
  
  const winnerLeague = getLeagueName(eloResult.winnerNewElo);
  const loserLeague = getLeagueName(eloResult.loserNewElo);
  
  if (eloResult.isPerfect) console.log(`   🎯 PERFECT prediction!`);
  if (eloResult.isUpset) console.log(`   ⚡ UPSET win!`);
  console.log(`   ELO: ${winner.name} ${winner.elo||1000}→${eloResult.winnerNewElo} (+${eloResult.winnerDelta}) | ${loser.name} ${loser.elo||1000}→${eloResult.loserNewElo} (${eloResult.loserDelta})`);
  
  // Update battle status
  const battleUpdate = {
    status: 'resolved',
    actual_x: parseFloat(actual_x.toFixed(4)),
    winner_id: winner.id,
    damage_dealt: HP_DAMAGE,
  };
  
  // Only set finished_at if column exists (graceful)
  try {
    battleUpdate.finished_at = new Date().toISOString();
    await supabaseRequest(`battles?id=eq.${battle.id}`, {
      method: 'PATCH',
      body: JSON.stringify(battleUpdate),
    });
  } catch (e) {
    // If finished_at fails, retry without it
    if (e.message.includes('finished_at')) {
      delete battleUpdate.finished_at;
      await supabaseRequest(`battles?id=eq.${battle.id}`, {
        method: 'PATCH',
        body: JSON.stringify(battleUpdate),
      });
    } else {
      throw e;
    }
  }
  
  // Update winner: +1 win, ELO, league, win_streak, peak_elo
  const winnerUpdate = {
    wins: (winner.wins || 0) + 1,
    win_streak: (winner.win_streak || 0) + 1,
  };
  
  // Add ELO fields if they exist in schema
  if ('elo' in winner) {
    winnerUpdate.elo = eloResult.winnerNewElo;
    winnerUpdate.peak_elo = Math.max(winner.peak_elo || 1000, eloResult.winnerNewElo);
    winnerUpdate.total_battles = winnerTotalGames + 1;
    winnerUpdate.league = winnerLeague;
  }
  
  await supabaseRequest(`bots?id=eq.${winner.id}`, {
    method: 'PATCH',
    body: JSON.stringify(winnerUpdate),
    prefer: 'return=minimal',
  });
  
  // Update loser: +1 loss, HP, ELO, league, reset win_streak
  const newHp = Math.max(0, (loser.hp || 100) - HP_DAMAGE);
  const loserUpdate = {
    losses: (loser.losses || 0) + 1,
    hp: newHp,
    win_streak: 0,
  };
  
  if ('elo' in loser) {
    loserUpdate.elo = eloResult.loserNewElo;
    loserUpdate.total_battles = loserTotalGames + 1;
    loserUpdate.league = loserLeague;
  }
  
  await supabaseRequest(`bots?id=eq.${loser.id}`, {
    method: 'PATCH',
    body: JSON.stringify(loserUpdate),
    prefer: 'return=minimal',
  });
  
  // Update room status
  if (battle.room_id) {
    // Check if room was created by a human/guest — if so, finish it (no auto-rematch)
    const [room] = await supabaseRequest(`rooms?id=eq.${battle.room_id}&select=host_bot_id`);
    let newRoomStatus = 'waiting'; // NPC rooms cycle back to waiting
    if (room) {
      const [hostBot] = await supabaseRequest(`bots?id=eq.${room.host_bot_id}&select=is_npc`);
      if (hostBot && !hostBot.is_npc) {
        newRoomStatus = 'finished'; // Human rooms don't auto-rematch
      }
    }
    await supabaseRequest(`rooms?id=eq.${battle.room_id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: newRoomStatus }),
      prefer: 'return=minimal',
    });
  }
  
  console.log(`   ✅ Battle resolved! ${loser.name} HP: ${newHp}`);
  
  // Send Telegram notifications (non-blocking)
  notifyBattleResult(winner, loser, battle, actual_x, eloResult).catch(() => {});
  
  // Record on-chain (non-blocking) — only for NFA-linked bots
  try {
    // Fetch NFA IDs for winner and loser
    const [winnerNfaArr] = await Promise.all([
      supabaseRequest(`bots?id=eq.${winner.id}&select=nfa_id`),
    ]);
    const [loserNfaArr] = await Promise.all([
      supabaseRequest(`bots?id=eq.${loser.id}&select=nfa_id`),
    ]);
    const winnerNfaId = Array.isArray(winnerNfaArr) ? winnerNfaArr[0]?.nfa_id : winnerNfaArr?.nfa_id;
    const loserNfaId = Array.isArray(loserNfaArr) ? loserNfaArr[0]?.nfa_id : loserNfaArr?.nfa_id;
    
    // Calculate accuracy in basis points (0-10000)
    const winnerAccBps = Math.round(Math.max(0, 1 - Math.min(diff1, diff2) / actual_x) * 10000);
    const loserAccBps = Math.round(Math.max(0, 1 - Math.max(diff1, diff2) / actual_x) * 10000);
    
    // DISABLED: on-chain recording too expensive (~$760/day at current battle rate)
    // TODO: implement daily batch snapshot instead
    // recordBattleOnChain(
    //   battle.id,
    //   winnerNfaId,
    //   loserNfaId,
    //   battle.token_symbol || 'UNKNOWN',
    //   winnerAccBps,
    //   loserAccBps,
    //   HP_DAMAGE
    // );
    console.log('   📝 Battle recorded off-chain (on-chain recording paused)');
  } catch (e) {
    console.warn('   ⚠️ On-chain NFA lookup failed:', e.message);
  }
  
  return { winnerId: winner.id, loserId: loser.id, actual_x, eloResult };
}

async function checkAndResolveBattles() {
  try {
    const now = new Date().toISOString();
    
    const battles = await supabaseRequest(
      `battles?status=eq.active&resolves_at=lt.${now}&select=*`
    );
    
    if (!battles || battles.length === 0) return;
    
    console.log(`\n🔍 Found ${battles.length} battles to resolve`);
    
    for (const battle of battles) {
      try {
        // Fetch full bot data including ELO
        const selectFields = 'id,name,hp,wins,losses,win_streak,elo,peak_elo,total_battles,league,telegram_id';
        const [bot1arr, bot2arr] = await Promise.all([
          supabaseRequest(`bots?id=eq.${battle.bot1_id}&select=${selectFields}`),
          supabaseRequest(`bots?id=eq.${battle.bot2_id}&select=${selectFields}`),
        ]);
        
        const bot1 = bot1arr?.[0];
        const bot2 = bot2arr?.[0];
        
        if (!bot1 || !bot2) {
          console.error(`   Missing bot data for battle ${battle.id}`);
          continue;
        }
        
        await resolveBattle(battle, bot1, bot2);
      } catch (e) {
        console.error(`Failed to resolve battle ${battle.id}:`, e.message);
      }
    }
  } catch (e) {
    console.error('Check battles error:', e.message);
  }
}

// ============================================
// AUTO-RESPAWN DEAD BOTS
// ============================================

async function autoRespawnBots() {
  try {
    // Find NPC bots with hp=0 whose last battle finished > 30 minutes ago
    const deadBots = await supabaseRequest(
      `bots?is_npc=eq.true&hp=eq.0&select=id,name`
    );
    
    if (!deadBots || deadBots.length === 0) return;
    
    let respawnCount = 0;
    for (const bot of deadBots) {
      // Check last battle time
      const lastBattles = await supabaseRequest(
        `battles?or=(bot1_id.eq.${bot.id},bot2_id.eq.${bot.id})&order=created_at.desc&limit=1&select=created_at`
      );
      
      const lastBattleTime = lastBattles?.[0]?.created_at;
      if (!lastBattleTime) {
        // No battles at all — respawn
      } else {
        const deadMinutes = (Date.now() - new Date(lastBattleTime).getTime()) / 60000;
        if (deadMinutes < 30) continue; // Too recent, skip
        
        console.log(`🔄 Auto-respawned: ${bot.name} (was dead for ${Math.round(deadMinutes)}m)`);
      }
      
      await supabaseRequest(`bots?id=eq.${bot.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ hp: 100 }),
        prefer: 'return=minimal',
      });
      respawnCount++;
    }
    
    if (respawnCount > 0) {
      console.log(`🔄 Auto-respawn complete: ${respawnCount} bots revived`);
    }
  } catch (e) {
    console.error('Auto-respawn error:', e.message);
  }
}

async function main() {
  console.log('🤖 GemBots Battle Resolver v2 (with ELO) started');
  console.log(`   Checking every ${RESOLVE_INTERVAL / 1000}s\n`);
  
  await checkAndResolveBattles();
  setInterval(checkAndResolveBattles, RESOLVE_INTERVAL);
  
  // Auto-respawn dead bots every 15 minutes
  setInterval(autoRespawnBots, 15 * 60 * 1000);
  console.log('🔄 Auto-respawn enabled (every 15 minutes)');
}

main().catch(console.error);
