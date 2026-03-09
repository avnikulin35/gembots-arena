#!/usr/bin/env node
/**
 * Build training dataset from Classic Arena battles + Bybit candles.
 * 
 * For each battle: look up 1m candles for the token at battle time,
 * compute market context (last 60 candles = 1h history),
 * and label with actual price movement (actual_x).
 * 
 * Output: data/training/training_dataset.jsonl
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const CANDLE_DIR = path.join(__dirname, '..', 'data', 'candles');
const OUT_DIR = path.join(__dirname, '..', 'data', 'training');
const OUT_FILE = path.join(OUT_DIR, 'training_dataset.jsonl');

const TOKEN_MAP = {
  'BTC': 'BTCUSDT',
  'ETH': 'ETHUSDT', 
  'SOL': 'SOLUSDT',
};

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }

// Load candles into a Map<timestamp_minute, candle>
function loadCandles(symbol) {
  const filePath = path.join(CANDLE_DIR, `${symbol}_1m.json`);
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const map = new Map();
  for (const c of raw) {
    map.set(c.ts, c);
  }
  return map;
}

// Get N candles before timestamp
function getCandlesBefore(candleMap, timestampMs, count) {
  const minuteTs = Math.floor(timestampMs / 60000) * 60000;
  const candles = [];
  for (let i = count; i >= 1; i--) {
    const ts = minuteTs - i * 60000;
    const c = candleMap.get(ts);
    if (c) candles.push(c);
  }
  return candles;
}

// Get candle at specific minute
function getCandleAt(candleMap, timestampMs) {
  const minuteTs = Math.floor(timestampMs / 60000) * 60000;
  return candleMap.get(minuteTs);
}

// Compute features from candle history
function computeFeatures(candles, currentPrice) {
  if (candles.length < 5) return null;
  
  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  
  // Price changes
  const last5 = closes.slice(-5);
  const last15 = closes.slice(-15);
  const last60 = closes;
  
  const pctChange5m = (last5[last5.length-1] / last5[0] - 1) * 100;
  const pctChange15m = last15.length >= 2 ? (last15[last15.length-1] / last15[0] - 1) * 100 : 0;
  const pctChange60m = last60.length >= 2 ? (last60[last60.length-1] / last60[0] - 1) * 100 : 0;
  
  // Volatility (std of 1m returns)
  const returns = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push((closes[i] / closes[i-1] - 1) * 100);
  }
  const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const volatility = Math.sqrt(returns.reduce((a, b) => a + (b - meanReturn) ** 2, 0) / returns.length);
  
  // Volume trend
  const vol5 = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const vol15 = volumes.slice(-15).reduce((a, b) => a + b, 0) / Math.min(15, volumes.length);
  const volumeRatio = vol15 > 0 ? vol5 / vol15 : 1;
  
  // High-Low range (last 5 candles)
  const range5 = (Math.max(...highs.slice(-5)) - Math.min(...lows.slice(-5))) / currentPrice * 100;
  
  // RSI (14 periods)
  const rsiPeriod = Math.min(14, returns.length);
  const rsiReturns = returns.slice(-rsiPeriod);
  const gains = rsiReturns.filter(r => r > 0);
  const losses = rsiReturns.filter(r => r < 0).map(r => Math.abs(r));
  const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / rsiPeriod : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / rsiPeriod : 0.001;
  const rsi = 100 - 100 / (1 + avgGain / avgLoss);
  
  return {
    price: currentPrice,
    pct_change_5m: parseFloat(pctChange5m.toFixed(4)),
    pct_change_15m: parseFloat(pctChange15m.toFixed(4)),
    pct_change_60m: parseFloat(pctChange60m.toFixed(4)),
    volatility_1m: parseFloat(volatility.toFixed(4)),
    volume_ratio_5_15: parseFloat(volumeRatio.toFixed(4)),
    range_5m_pct: parseFloat(range5.toFixed(4)),
    rsi_14: parseFloat(rsi.toFixed(2)),
    candle_count: candles.length,
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  
  log('🚀 Building Training Dataset from Classic Arena + Bybit Candles');
  
  // Load candles
  const candleMaps = {};
  for (const [token, symbol] of Object.entries(TOKEN_MAP)) {
    log(`📊 Loading ${symbol} candles...`);
    candleMaps[token] = loadCandles(symbol);
    log(`   ${candleMaps[token].size} candles loaded`);
  }
  
  // Connect to Supabase (Classic battles)
  const client = new Client({
    host: '127.0.0.1',
    port: 54322,
    database: 'postgres',
    user: 'postgres',
    password: 'postgres',
  });
  await client.connect();
  
  // Fetch battles for BTC, ETH, SOL
  const tokens = Object.keys(TOKEN_MAP);
  const query = `
    SELECT id, token_symbol, created_at, finished_at, 
      bot1_prediction, bot2_prediction, actual_x,
      market_price, market_price_1h_ago, market_price_24h_ago,
      duration_minutes
    FROM battles 
    WHERE status = 'resolved' 
      AND token_symbol IN ('BTC', 'ETH', 'SOL')
      AND actual_x IS NOT NULL
    ORDER BY created_at ASC
  `;
  
  log(`📥 Fetching Classic battles for ${tokens.join(', ')}...`);
  const { rows } = await client.query(query);
  log(`   ${rows.length} battles fetched`);
  
  // Process each battle
  const outStream = fs.createWriteStream(OUT_FILE);
  let processed = 0;
  let skipped = 0;
  
  for (const battle of rows) {
    const candleMap = candleMaps[battle.token_symbol];
    if (!candleMap) { skipped++; continue; }
    
    const battleTime = new Date(battle.created_at).getTime();
    
    // Get 60 candles (1h) before battle
    const history = getCandlesBefore(candleMap, battleTime, 60);
    if (history.length < 10) { skipped++; continue; }
    
    const currentCandle = getCandleAt(candleMap, battleTime);
    const currentPrice = currentCandle ? currentCandle.close : history[history.length - 1].close;
    
    // Compute features
    const features = computeFeatures(history, currentPrice);
    if (!features) { skipped++; continue; }
    
    // Label: actual price movement
    const actualX = parseFloat(battle.actual_x);
    const pnlPct = (actualX - 1) * 100;
    
    let direction;
    if (pnlPct > 0.1) direction = 'BUY';
    else if (pnlPct < -0.1) direction = 'SELL';
    else direction = 'HOLD';
    
    // Training record
    const record = {
      // Input features
      symbol: battle.token_symbol,
      timestamp: battle.created_at,
      ...features,
      // Last 15 closes (relative to current price)
      recent_closes: history.slice(-15).map(c => parseFloat(((c.close / currentPrice - 1) * 100).toFixed(4))),
      // Label
      direction,
      actual_pnl_pct: parseFloat(pnlPct.toFixed(4)),
      actual_x: parseFloat(actualX.toFixed(6)),
      timeframe_min: battle.duration_minutes || 3,
    };
    
    outStream.write(JSON.stringify(record) + '\n');
    processed++;
    
    if (processed % 10000 === 0) {
      log(`   Processed: ${processed}, Skipped: ${skipped}`);
    }
  }
  
  outStream.end();
  await client.end();
  
  // Stats
  log(`\n📋 Dataset Summary:`);
  log(`   Total battles: ${rows.length}`);
  log(`   Processed: ${processed}`);
  log(`   Skipped: ${skipped}`);
  log(`   Output: ${OUT_FILE}`);
  
  // Count labels
  const lines = fs.readFileSync(OUT_FILE, 'utf8').trim().split('\n');
  const labels = { BUY: 0, SELL: 0, HOLD: 0 };
  for (const line of lines) {
    const r = JSON.parse(line);
    labels[r.direction]++;
  }
  log(`   Labels: BUY=${labels.BUY}, SELL=${labels.SELL}, HOLD=${labels.HOLD}`);
  log(`   File size: ${(fs.statSync(OUT_FILE).size / 1024 / 1024).toFixed(1)} MB`);
}

main().catch(err => {
  log(`💥 Fatal: ${err.message}`);
  process.exit(1);
});
