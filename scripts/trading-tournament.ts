import { db, createTradingBattle, resolveTradingBattle, getActiveTradingBattles, getTradingBotStats, updateTradingElo } from '../src/lib/db';
import { getTradingDecision } from '../src/lib/trading-predictor';
import { calculatePnL, determineWinner, eloChange } from '../src/lib/trading-engine';
import { config } from 'dotenv';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

// Load environment variables from .env.local
config({ path: path.resolve(process.cwd(), '.env.local') });

const MARKET_SNAPSHOTS_PATH = '/home/clawdbot/Projects/gembots-trader/data/market-snapshots.jsonl';
const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
const BATTLE_TIMEFRAME_MINUTES = 15;
const INTERVAL_MS = BATTLE_TIMEFRAME_MINUTES * 60 * 1000;

async function getLatestMarketSnapshots(): Promise<Map<string, any>> {
  const snapshots = new Map<string, any>();
  if (!fs.existsSync(MARKET_SNAPSHOTS_PATH)) {
    console.warn('Market snapshots file not found:', MARKET_SNAPSHOTS_PATH);
    return snapshots;
  }

  const fileContent = fs.readFileSync(MARKET_SNAPSHOTS_PATH, 'utf-8');
  const lines = fileContent.split('\n').filter(line => line.trim() !== '');

  for (const line of lines) {
    try {
      const snapshot = JSON.parse(line);
      snapshots.set(snapshot.symbol, snapshot);
    } catch (error) {
      console.error('Error parsing market snapshot line:', line, error);
    }
  }
  return snapshots;
}

// Model pool for trading battles — each bot gets a random model from this pool
const MODEL_POOL = [
  'qwen/qwen3-235b-a22b-2507',
  'google/gemma-3-12b-it',
  'mistralai/mistral-nemo',
  'google/gemini-2.0-flash-lite-001',
  'meta-llama/llama-4-maverick',
  'deepseek/deepseek-r1',
  'mistralai/mistral-small-24b-instruct-2501',
  'x-ai/grok-4.1-fast',
];

async function getRandomActiveBots(count: number): Promise<Array<any>> {
  // Only pick bots that have trading_elo entries (migrated from Supabase with proper names)
  const bots = db.prepare(`
    SELECT ab.id, ab.name, ab.strategy FROM api_bots ab
    JOIN trading_elo te ON te.bot_id = ab.id
    WHERE ab.hp > 0
    ORDER BY RANDOM() LIMIT ?
  `).all(count);

  // Assign random models from pool
  for (const bot of bots) {
    (bot as any).model_id = MODEL_POOL[Math.floor(Math.random() * MODEL_POOL.length)];
  }

  if (bots.length < count) {
    console.warn(`Not enough active bots found. Found ${bots.length}, needed ${count}.`);
  }
  return bots;
}

async function startNewBattles() {
  console.log('Starting new trading battles...');
  const latestSnapshots = await getLatestMarketSnapshots();
  const availableBots = await getRandomActiveBots(2);

  if (availableBots.length < 2) {
    console.warn('Cannot start battles: Not enough active bots available.');
    return;
  }

  const bot1 = availableBots[0];
  const bot2 = availableBots[1];

  for (const symbol of SYMBOLS) {
    const snapshot = latestSnapshots.get(symbol);
    if (!snapshot) {
      console.warn(`No market data for ${symbol}. Skipping battle.`);
      continue;
    }

    console.log(`⚔️ ${symbol}: ${bot1.name} (${bot1.model_id}) vs ${bot2.name} (${bot2.model_id})`);
    const bot1Decision = await getTradingDecision(bot1.model_id, snapshot);
    const bot2Decision = await getTradingDecision(bot2.model_id, snapshot);

    const battleId = uuidv4();
    createTradingBattle({
      id: battleId,
      bot1_id: bot1.id,
      bot2_id: bot2.id,
      symbol: symbol,
      entry_price: snapshot.price,
      bot1_action: bot1Decision.action,
      bot1_size: bot1Decision.size,
      bot1_leverage: bot1Decision.leverage,
      bot1_confidence: bot1Decision.confidence,
      bot1_tp: bot1Decision.take_profit,
      bot1_sl: bot1Decision.stop_loss,
      bot1_reasoning: bot1Decision.reasoning,
      bot2_action: bot2Decision.action,
      bot2_size: bot2Decision.size,
      bot2_leverage: bot2Decision.leverage,
      bot2_confidence: bot2Decision.confidence,
      bot2_tp: bot2Decision.take_profit,
      bot2_sl: bot2Decision.stop_loss,
      bot2_reasoning: bot2Decision.reasoning,
      market_data: JSON.stringify(snapshot),
      bot1_model: bot1.model_id,
      bot2_model: bot2.model_id,
    });
    console.log(`Started battle ${battleId} for ${symbol} between ${bot1.name} and ${bot2.name}.`)
  }
}

async function resolveActiveBattles() {
  console.log('Resolving active trading battles...');
  const activeBattles = getActiveTradingBattles();
  const latestSnapshots = await getLatestMarketSnapshots(); // Get latest prices for resolution

  for (const battle of activeBattles) {
    const snapshot = latestSnapshots.get(battle.symbol);
    if (!snapshot) {
      console.warn(`No current market data for ${battle.symbol}. Skipping resolution for battle ${battle.id}.`);
      continue;
    }

    const exitPrice = snapshot.price;
    // For TP/SL calculation, we need historical prices during the timeframe.
    // Since we don't have a real-time stream here, we'll simplify and just use entry and exit for now.
    // A more advanced implementation would capture price points every minute.
    const marketPricesDuringBattle = [battle.entry_price, exitPrice]; // Simplified

    const bot1Decision: TradingDecision = {
      action: battle.bot1_action,
      size: battle.bot1_size,
      leverage: battle.bot1_leverage,
      confidence: battle.bot1_confidence,
      take_profit: battle.bot1_tp,
      stop_loss: battle.bot1_sl,
      reasoning: battle.bot1_reasoning,
    };
    const bot2Decision: TradingDecision = {
      action: battle.bot2_action,
      size: battle.bot2_size,
      leverage: battle.bot2_leverage,
      confidence: battle.bot2_confidence,
      take_profit: battle.bot2_tp,
      stop_loss: battle.bot2_sl,
      reasoning: battle.bot2_reasoning,
    };

    const bot1PnL = calculatePnL(bot1Decision, battle.entry_price, exitPrice, marketPricesDuringBattle);
    const bot2PnL = calculatePnL(bot2Decision, battle.entry_price, exitPrice, marketPricesDuringBattle);

    const winnerId = determineWinner(
      battle.bot1_id, bot1PnL, battle.bot1_action,
      battle.bot2_id, bot2PnL, battle.bot2_action
    );

    resolveTradingBattle(battle.id, {
      exit_price: exitPrice,
      bot1_pnl: bot1PnL,
      bot2_pnl: bot2PnL,
      winner_id: winnerId,
      status: 'resolved',
    });
    console.log(`Resolved battle ${battle.id}. Bot1 PnL: ${bot1PnL.toFixed(2)}%, Bot2 PnL: ${bot2PnL.toFixed(2)}%. Winner: ${winnerId || 'Draw'}`);

    // Update ELO and bot stats
    const bot1Stats = getTradingBotStats(battle.bot1_id);
    const bot2Stats = getTradingBotStats(battle.bot2_id);

    let bot1Elo = bot1Stats ? bot1Stats.elo : 1500;
    let bot2Elo = bot2Stats ? bot2Stats.elo : 1500;

    if (winnerId === battle.bot1_id) {
      const [bot1Delta, bot2Delta] = eloChange(bot1Elo, bot2Elo, false);
      updateTradingElo(battle.bot1_id, bot1Delta, bot1PnL, true);
      updateTradingElo(battle.bot2_id, bot2Delta, bot2PnL, false);
    } else if (winnerId === battle.bot2_id) {
      const [bot2Delta, bot1Delta] = eloChange(bot2Elo, bot1Elo, false);
      updateTradingElo(battle.bot1_id, bot1Delta, bot1PnL, false);
      updateTradingElo(battle.bot2_id, bot2Delta, bot2PnL, true);
    } else { // Draw
      const [bot1Delta, bot2Delta] = eloChange(bot1Elo, bot2Elo, true);
      updateTradingElo(battle.bot1_id, bot1Delta, bot1PnL, null);
      updateTradingElo(battle.bot2_id, bot2Delta, bot2PnL, null);
    }
    // TODO: Broadcast via WebSocket (if available)
  }
}

async function tradingTournamentLoop() {
  console.log("🏟️ Trading Tournament started!");
  
  // Resolve any existing active battles first (e.g., after a restart)
  await resolveActiveBattles();
  
  // Start first batch immediately
  console.log("🚀 Starting first batch of battles...");
  await startNewBattles();

  setInterval(async () => {
    console.log(`\n⏰ [${new Date().toISOString()}] New trading cycle...`);
    await resolveActiveBattles(); // Resolve battles from previous interval
    await startNewBattles();    // Start new battles for the current interval
  }, INTERVAL_MS);
}

tradingTournamentLoop();
