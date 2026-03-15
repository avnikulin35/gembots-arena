/**
 * Daily Resolver - runs at 00:00 UTC
 * Resolves all pending stakes from yesterday
 */

import Database from 'better-sqlite3';
import path from 'path';
import { sendWebhook } from '../src/lib/webhook';

const JUPITER_PRICE_API = 'https://price.jup.ag/v4/price';
const PLATFORM_FEE = 0.05; // 5%

const db = new Database(path.join(process.cwd(), 'data', 'gembots.db'));

interface Stake {
  id: number;
  wallet_address: string;
  token_mint: string;
  token_symbol: string | null;
  amount_sol: number;
  entry_price: number;
  target_multiplier: number;
  result: string;
  created_at: string;
}

interface StakeWithBot {
  id: number;
  wallet_address: string;
  token_mint: string;
  token_symbol: string | null;
  amount_sol: number;
  entry_price: number;
  target_multiplier: number;
  result: string;
  created_at: string;
  bot_api_key?: string;
}

async function getTokenPrice(mint: string): Promise<number | null> {
  try {
    const response = await fetch(`${JUPITER_PRICE_API}?ids=${mint}`);
    if (!response.ok) return null;
    const data = await response.json();
    return data.data?.[mint]?.price || null;
  } catch {
    return null;
  }
}

async function resolvePendingStakes() {
  console.log('🎰 Starting daily resolution...');
  
  // Get all pending stakes from before today
  const pendingStakes = db.prepare(`
    SELECT * FROM stakes 
    WHERE result = 'pending' 
    AND date(created_at) < date('now')
  `).all() as Stake[];
  
  console.log(`📊 Found ${pendingStakes.length} pending stakes to resolve`);
  
  if (pendingStakes.length === 0) {
    console.log('✅ No stakes to resolve');
    return;
  }

  // Group by token to batch price fetches
  const tokenMints = [...new Set(pendingStakes.map(s => s.token_mint))];
  const prices: Record<string, number> = {};
  
  for (const mint of tokenMints) {
    const price = await getTokenPrice(mint);
    if (price) prices[mint] = price;
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 200));
  }
  
  console.log(`💰 Fetched prices for ${Object.keys(prices).length} tokens`);

  let totalWinners = 0;
  let totalLosers = 0;
  let loserPool = 0;
  const winners: Array<{ id: number; stake: Stake; multiplier: number }> = [];
  const losers: Array<{ id: number; stake: Stake }> = [];

  // Determine winners and losers
  for (const stake of pendingStakes) {
    const exitPrice = prices[stake.token_mint];
    
    if (!exitPrice) {
      console.log(`⚠️ No price for ${stake.token_mint}, skipping stake ${stake.id}`);
      continue;
    }

    const multiplier = exitPrice / stake.entry_price;
    const isWinner = multiplier >= stake.target_multiplier;

    if (isWinner) {
      totalWinners++;
      winners.push({ id: stake.id, stake, multiplier });
    } else {
      totalLosers++;
      losers.push({ id: stake.id, stake });
      loserPool += stake.amount_sol;
    }
  }

  console.log(`🏆 Winners: ${totalWinners} | 💀 Losers: ${totalLosers}`);
  console.log(`💎 Loser pool: ${loserPool.toFixed(4)} SOL`);

  // Calculate payouts
  const platformFee = loserPool * PLATFORM_FEE;
  const winnerPool = loserPool - platformFee;
  const payoutPerWinner = winners.length > 0 ? winnerPool / winners.length : 0;

  console.log(`🏦 Platform fee: ${platformFee.toFixed(4)} SOL`);
  console.log(`💵 Payout per winner: ${payoutPerWinner.toFixed(4)} SOL (+ original stake)`);

  // Update winners
  const updateStmt = db.prepare(`
    UPDATE stakes 
    SET result = ?, exit_price = ?, payout_sol = ?, resolved_at = datetime('now')
    WHERE id = ?
  `);

  // Get stakes with bot API keys for webhook notifications
  const getStakeWithBot = db.prepare(`
    SELECT s.*, s.bot_api_key 
    FROM stakes s 
    WHERE s.id = ?
  `);

  for (const winner of winners) {
    const exitPrice = prices[winner.stake.token_mint];
    const payout = winner.stake.amount_sol + payoutPerWinner; // Original stake + share of loser pool
    updateStmt.run('win', exitPrice, payout, winner.id);
    console.log(`✅ Stake #${winner.id}: WIN (${winner.multiplier.toFixed(2)}x) → ${payout.toFixed(4)} SOL`);
    
    // Send webhook if stake is from a bot
    const stakeWithBot = getStakeWithBot.get(winner.id) as StakeWithBot | undefined;
    if (stakeWithBot?.bot_api_key) {
      await sendWebhook(stakeWithBot.bot_api_key, {
        bet_id: winner.id,
        result: 'win',
        payout: payout,
        pnl: payout - winner.stake.amount_sol,
        token_mint: winner.stake.token_mint,
        entry_price: winner.stake.entry_price,
        exit_price: exitPrice,
        resolved_at: new Date().toISOString()
      });
    }
  }

  // Update losers
  for (const loser of losers) {
    const exitPrice = prices[loser.stake.token_mint];
    updateStmt.run('lose', exitPrice, 0, loser.id);
    console.log(`❌ Stake #${loser.id}: LOSE → 0 SOL`);
    
    // Send webhook if stake is from a bot
    const stakeWithBot = getStakeWithBot.get(loser.id) as StakeWithBot | undefined;
    if (stakeWithBot?.bot_api_key) {
      await sendWebhook(stakeWithBot.bot_api_key, {
        bet_id: loser.id,
        result: 'lose',
        payout: 0,
        pnl: -loser.stake.amount_sol,
        token_mint: loser.stake.token_mint,
        entry_price: loser.stake.entry_price,
        exit_price: exitPrice,
        resolved_at: new Date().toISOString()
      });
    }
  }

  // Log daily stats
  const today = new Date().toISOString().split('T')[0];
  const insertDaily = db.prepare(`
    INSERT OR REPLACE INTO daily_pool (date, total_stakes_sol, total_losers_sol, platform_fee_sol, winners_payout_sol)
    VALUES (?, ?, ?, ?, ?)
  `);
  insertDaily.run(
    today,
    pendingStakes.reduce((sum, s) => sum + s.amount_sol, 0),
    loserPool,
    platformFee,
    winnerPool
  );

  console.log('\n🎉 Daily resolution complete!');
  console.log(`📈 Total resolved: ${winners.length + losers.length}`);
  console.log(`💰 Platform earned: ${platformFee.toFixed(4)} SOL`);
}

// Run
resolvePendingStakes()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Resolution failed:', err);
    process.exit(1);
  });
