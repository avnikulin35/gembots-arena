import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DATA_DIR = path.join(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export const db = new Database(path.join(DATA_DIR, 'gembots.db'));

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS stakes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet_address TEXT NOT NULL,
    token_mint TEXT NOT NULL,
    token_symbol TEXT,
    amount_sol REAL NOT NULL,
    entry_price REAL NOT NULL,
    target_multiplier REAL DEFAULT 2.0,
    result TEXT DEFAULT 'pending',
    exit_price REAL,
    payout_sol REAL,
    created_at TEXT DEFAULT (datetime('now')),
    resolved_at TEXT
  );

  CREATE TABLE IF NOT EXISTS bots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    wallet_address TEXT UNIQUE NOT NULL,
    reputation INTEGER DEFAULT 100,
    total_predictions INTEGER DEFAULT 0,
    successful_predictions INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS api_bots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    wallet_address TEXT UNIQUE NOT NULL,
    api_key TEXT UNIQUE NOT NULL,
    webhook_url TEXT,
    webhook_secret TEXT NOT NULL,
    total_bets INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    last_active_at TEXT
  );

  CREATE TABLE IF NOT EXISTS predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id INTEGER,
    token_mint TEXT NOT NULL,
    token_symbol TEXT,
    prediction_type TEXT NOT NULL,
    target_price REAL,
    confidence REAL,
    result TEXT DEFAULT 'pending',
    actual_price REAL,
    predicted_at TEXT DEFAULT (datetime('now')),
    resolved_at TEXT,
    FOREIGN KEY (bot_id) REFERENCES bots(id)
  );

  CREATE TABLE IF NOT EXISTS token_prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_mint TEXT NOT NULL,
    price REAL NOT NULL,
    timestamp TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS daily_pool (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT UNIQUE NOT NULL,
    total_stakes_sol REAL DEFAULT 0,
    total_losers_sol REAL DEFAULT 0,
    platform_fee_sol REAL DEFAULT 0,
    winners_payout_sol REAL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS trade_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_name TEXT NOT NULL,
    action TEXT NOT NULL,
    token_symbol TEXT NOT NULL,
    token_mint TEXT,
    price REAL NOT NULL,
    amount REAL NOT NULL,
    confidence REAL DEFAULT 0.8,\
    timestamp TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS trading_battles (
    id TEXT PRIMARY KEY,
    bot1_id INTEGER NOT NULL,
    bot2_id INTEGER NOT NULL,
    symbol TEXT NOT NULL,
    entry_price REAL NOT NULL,
    exit_price REAL,
    started_at TEXT DEFAULT (datetime('now')),
    resolved_at TEXT,
    timeframe_minutes INTEGER DEFAULT 15,
    
    bot1_action TEXT,
    bot1_size REAL DEFAULT 0.1,
    bot1_leverage INTEGER DEFAULT 1,
    bot1_confidence REAL,
    bot1_tp REAL,
    bot1_sl REAL,
    bot1_pnl REAL,
    bot1_reasoning TEXT,
    
    bot2_action TEXT,
    bot2_size REAL DEFAULT 0.1,
    bot2_leverage INTEGER DEFAULT 1,
    bot2_confidence REAL,
    bot2_tp REAL,
    bot2_sl REAL,
    bot2_reasoning TEXT,
    
    market_data TEXT,
    winner_id INTEGER,
    status TEXT DEFAULT 'pending',
    
    FOREIGN KEY (bot1_id) REFERENCES api_bots(id),
    FOREIGN KEY (bot2_id) REFERENCES api_bots(id)
  );

  CREATE TABLE IF NOT EXISTS trading_elo (
    bot_id INTEGER PRIMARY KEY,
    elo REAL DEFAULT 1500,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    draws INTEGER DEFAULT 0,
    total_pnl REAL DEFAULT 0,
    best_trade REAL DEFAULT 0,
    worst_trade REAL DEFAULT 0,
    avg_profit REAL DEFAULT 0,
    avg_loss REAL DEFAULT 0,
    total_trades INTEGER DEFAULT 0,
    FOREIGN KEY (bot_id) REFERENCES api_bots(id)
  );

  CREATE INDEX IF NOT EXISTS idx_stakes_wallet ON stakes(wallet_address);
  CREATE INDEX IF NOT EXISTS idx_stakes_result ON stakes(result);
  CREATE INDEX IF NOT EXISTS idx_stakes_created ON stakes(created_at);
  CREATE INDEX IF NOT EXISTS idx_predictions_result ON predictions(result);
  CREATE INDEX IF NOT EXISTS idx_token_prices_mint ON token_prices(token_mint);
  CREATE INDEX IF NOT EXISTS idx_trade_events_time ON trade_events(timestamp);
`);

// Stakes functions
export function createStake(data: {
  walletAddress: string;
  tokenMint: string;
  tokenSymbol?: string;
  amountSol: number;
  entryPrice: number;
  targetMultiplier?: number;
}) {
  const stmt = db.prepare(`
    INSERT INTO stakes (wallet_address, token_mint, token_symbol, amount_sol, entry_price, target_multiplier)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    data.walletAddress,
    data.tokenMint,
    data.tokenSymbol || null,
    data.amountSol,
    data.entryPrice,
    data.targetMultiplier || 2.0
  );
  return result.lastInsertRowid;
}

export function getStakesByWallet(walletAddress: string) {
  return db.prepare(`
    SELECT * FROM stakes WHERE wallet_address = ? ORDER BY created_at DESC
  `).all(walletAddress);
}

export function getActiveStakes() {
  return db.prepare(`
    SELECT * FROM stakes WHERE result = 'pending' ORDER BY created_at DESC
  `).all();
}

export function getPendingStakesForResolution() {
  // Get stakes from yesterday that need resolution
  return db.prepare(`
    SELECT * FROM stakes 
    WHERE result = 'pending' 
    AND date(created_at) < date('now')
    ORDER BY created_at ASC
  `).all();
}

export function resolveStake(id: number, data: {
  result: 'win' | 'lose';
  exitPrice: number;
  payoutSol: number;
}) {
  const stmt = db.prepare(`
    UPDATE stakes 
    SET result = ?, exit_price = ?, payout_sol = ?, resolved_at = datetime('now')
    WHERE id = ?
  `);
  return stmt.run(data.result, data.exitPrice, data.payoutSol, id);
}

// Stats functions
export function getTodayStats() {
  return db.prepare(`
    SELECT 
      COUNT(*) as total_stakes,
      SUM(amount_sol) as total_sol,
      SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN result = 'lose' THEN 1 ELSE 0 END) as losses
    FROM stakes 
    WHERE date(created_at) = date('now')
  `).get();
}

export function getLeaderboard(limit = 10) {
  return db.prepare(`
    SELECT 
      wallet_address,
      COUNT(*) as total_stakes,
      SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) as wins,
      SUM(payout_sol) as total_winnings,
      SUM(amount_sol) as total_staked
    FROM stakes
    GROUP BY wallet_address
    ORDER BY total_winnings DESC
    LIMIT ?
  `).all(limit);
}

// Token price tracking
export function saveTokenPrice(tokenMint: string, price: number) {
  const stmt = db.prepare(`
    INSERT INTO token_prices (token_mint, price) VALUES (?, ?)
  `);
  return stmt.run(tokenMint, price);
}

export function getLatestPrice(tokenMint: string) {
  return db.prepare(`
    SELECT price FROM token_prices 
    WHERE token_mint = ? 
    ORDER BY timestamp DESC 
    LIMIT 1
  `).get(tokenMint) as { price: number } | undefined;
}

export function getPriceChange(tokenMint: string, minutesAgo: number): number {
  const current = getLatestPrice(tokenMint);
  if (!current) return 0;
  
  const historical = db.prepare(`
    SELECT price FROM token_prices 
    WHERE token_mint = ? AND timestamp <= datetime('now', ? || ' minutes')
    ORDER BY timestamp DESC 
    LIMIT 1
  `).get(tokenMint, `-${minutesAgo}`) as { price: number } | undefined;
  
  if (!historical || historical.price === 0) return 0;
  return ((current.price - historical.price) / historical.price) * 100;
}

// Trade events functions
export function saveTradeEvent(data: {
  botName: string;
  action: string;
  tokenSymbol: string;
  tokenMint?: string;
  price: number;
  amount: number;
  confidence?: number;
}) {
  const stmt = db.prepare(`
    INSERT INTO trade_events (bot_name, action, token_symbol, token_mint, price, amount, confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(data.botName, data.action, data.tokenSymbol, data.tokenMint || null, data.price, data.amount, data.confidence || 0.8);
}

export function getTokenVolume24h(tokenMint: string): number {
  const result = db.prepare(`
    SELECT COALESCE(SUM(price * amount), 0) as volume
    FROM trade_events
    WHERE token_mint = ? AND timestamp >= datetime('now', '-24 hours')
  `).get(tokenMint) as { volume: number } | undefined;
  return result?.volume || 0;
}

export function getRecentTradeEvents(limit: number = 20) {
  return db.prepare(`
    SELECT id, bot_name, action, token_symbol, token_mint, price, amount, confidence, timestamp
    FROM trade_events
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(limit) as Array<{
    id: number; bot_name: string; action: string; token_symbol: string;
    token_mint: string | null; price: number; amount: number; confidence: number; timestamp: string;
  }>;
}

// API Bots functions
export function createApiBot(data: {
  name: string;
  walletAddress: string;
  webhookUrl?: string;
}) {
  const crypto = require('crypto');
  const apiKey = `bot_${crypto.randomBytes(20).toString('hex')}`;
  const webhookSecret = crypto.randomBytes(32).toString('hex');
  
  const stmt = db.prepare(`
    INSERT INTO api_bots (name, wallet_address, api_key, webhook_url, webhook_secret)
    VALUES (?, ?, ?, ?, ?)\
  `);
  const result = stmt.run(
    data.name,
    data.walletAddress,
    apiKey,
    data.webhookUrl || null,
    webhookSecret
  );
  
  return {
    id: result.lastInsertRowid,
    apiKey,
    webhookSecret
  };
}

export function getBotByApiKey(apiKey: string) {
  return db.prepare(`
    SELECT * FROM api_bots WHERE api_key = ?
  `).get(apiKey);
}

export function updateBotStats(apiKey: string, result: 'win' | 'lose') {
  const updateField = result === 'win' ? 'wins = wins + 1' : 'losses = losses + 1';
  
  const stmt = db.prepare(`
    UPDATE api_bots 
    SET total_bets = total_bets + 1, ${updateField}, last_active_at = datetime('now')
    WHERE api_key = ?
  `);
  return stmt.run(apiKey);
}

export function getApiBotsLeaderboard() {
  return db.prepare(`
    SELECT 
      name,
      wins,
      losses,
      total_bets,
      CASE WHEN total_bets > 0 THEN ROUND((wins * 100.0 / total_bets), 2) ELSE 0 END as win_rate,
      created_at
    FROM api_bots
    WHERE total_bets > 0
    ORDER BY wins DESC, win_rate DESC
    LIMIT 20
  `).all();
}

export function linkBetToBot(betId: number, apiKey: string) {
  // Add bot_api_key column to stakes if it doesn't exist
  try {
    db.exec('ALTER TABLE stakes ADD COLUMN bot_api_key TEXT');
  } catch (e) {
    // Column already exists
  }
  
  const stmt = db.prepare(`
    UPDATE stakes SET bot_api_key = ? WHERE id = ?
  `);
  return stmt.run(apiKey, betId);
}

// Trading Battle functions
interface TradingBattleData {
  id: string;
  bot1_id: number;
  bot2_id: number;
  symbol: string;
  entry_price: number;
  bot1_action: string;
  bot1_size: number;
  bot1_leverage: number;
  bot1_confidence: number;
  bot1_tp: number;
  bot1_sl: number;
  bot1_reasoning: string;
  bot2_action: string;
  bot2_size: number;
  bot2_leverage: number;
  bot2_confidence: number;
  bot2_tp: number;
  bot2_sl: number;
  bot2_reasoning: string;
  market_data: string;
  bot1_model?: string;
  bot2_model?: string;
}

export function createTradingBattle(data: TradingBattleData) {
  const stmt = db.prepare(`
    INSERT INTO trading_battles (
      id, bot1_id, bot2_id, symbol, entry_price, 
      bot1_action, bot1_size, bot1_leverage, bot1_confidence, bot1_tp, bot1_sl, bot1_reasoning,
      bot2_action, bot2_size, bot2_leverage, bot2_confidence, bot2_tp, bot2_sl, bot2_reasoning,
      market_data, bot1_model, bot2_model
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    data.id, data.bot1_id, data.bot2_id, data.symbol, data.entry_price,
    data.bot1_action, data.bot1_size, data.bot1_leverage, data.bot1_confidence, data.bot1_tp, data.bot1_sl, data.bot1_reasoning,
    data.bot2_action, data.bot2_size, data.bot2_leverage, data.bot2_confidence, data.bot2_tp, data.bot2_sl, data.bot2_reasoning,
    data.market_data, data.bot1_model || null, data.bot2_model || null
  );
  return data.id;
}

interface ResolveTradingBattleData {
  exit_price: number;
  bot1_pnl: number;
  bot2_pnl: number;
  winner_id: number | null;
  status: 'resolved';
}

export function resolveTradingBattle(id: string, data: ResolveTradingBattleData) {
  const stmt = db.prepare(`
    UPDATE trading_battles
    SET exit_price = ?, bot1_pnl = ?, bot2_pnl = ?, winner_id = ?, status = ?, resolved_at = datetime('now')
    WHERE id = ?
  `);
  return stmt.run(data.exit_price, data.bot1_pnl, data.bot2_pnl, data.winner_id, data.status, id);
}

export function getActiveTradingBattles() {
  return db.prepare(`
    SELECT * FROM trading_battles WHERE status IN ('pending', 'active')
  `).all();
}

export function getRecentTradingBattles(limit: number = 10) {
  return db.prepare(`
    SELECT * FROM trading_battles WHERE status = 'resolved' ORDER BY resolved_at DESC LIMIT ?
  `).all(limit);
}

// Trading ELO functions
export function getTradingLeaderboard(limit: number = 10) {
  return db.prepare(`
    SELECT * FROM trading_elo ORDER BY elo DESC LIMIT ?
  `).all();
}

export function getTradingBotStats(botId: number) {
  return db.prepare(`
    SELECT * FROM trading_elo WHERE bot_id = ?
  `).get(botId);
}

export function updateTradingElo(botId: number, eloChange: number, pnl: number, isWin: boolean | null) {
  let updateQuery = `
    UPDATE trading_elo
    SET elo = elo + ?, total_pnl = total_pnl + ?, total_trades = total_trades + 1
  `;
  if (isWin === true) {
    updateQuery += `, wins = wins + 1`;
  } else if (isWin === false) {
    updateQuery += `, losses = losses + 1`;
  } else if (isWin === null) {
    updateQuery += `, draws = draws + 1`;
  }

  // Update best/worst trade
  updateQuery += `, best_trade = IIF(?, MAX(best_trade, ?), best_trade)`; // If pnl > 0, update best_trade
  updateQuery += `, worst_trade = IIF(?, MIN(worst_trade, ?), worst_trade)`; // If pnl < 0, update worst_trade

  // Update avg profit/loss
  updateQuery += `, avg_profit = IIF(?, (avg_profit * wins + ?) / (wins + 1), avg_profit)`;
  updateQuery += `, avg_loss = IIF(?, (avg_loss * losses + ?) / (losses + 1), avg_loss)`;


  const stmt = db.prepare(updateQuery + ` WHERE bot_id = ?`);
  
  // Initialize ELO if bot doesn't exist
  const existingBot = getTradingBotStats(botId);
  if (!existingBot) {
    db.prepare(`INSERT OR IGNORE INTO trading_elo (bot_id) VALUES (?)`).run(botId);
  }

  return stmt.run(
    eloChange,
    pnl,
    pnl > 0 ? 1 : 0, pnl, // best_trade
    pnl < 0 ? 1 : 0, pnl, // worst_trade
    pnl > 0 ? 1 : 0, pnl, // avg_profit
    pnl < 0 ? 1 : 0, pnl, // avg_loss
    botId
  );
}

export default db;
