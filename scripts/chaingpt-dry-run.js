#!/usr/bin/env node
/**
 * ChainGPT Dry-Run — Strategy Optimizer
 * 
 * Tests all 5 strategies (momentum, trend_follower, scalper, swing, contrarian)
 * using ChainGPT as the AI brain vs random MODEL_POOL opponents via OpenRouter.
 * Uses a separate DB: data/chaingpt-dry-run.db (never touches gembots.db)
 *
 * Usage:
 *   node scripts/chaingpt-dry-run.js
 */

const fs = require('fs');
const path = require('path');

// ─── Load .env.local ───────────────────────────────────────────────────────
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [key, ...val] = line.split('=');
    if (key && !key.startsWith('#')) {
      let v = val.join('=').trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!process.env[key.trim()]) process.env[key.trim()] = v;
    }
  });
}

// Also load clawd .env for OPENROUTER key
const clawdEnv = '/home/clawdbot/clawd/.env';
if (fs.existsSync(clawdEnv)) {
  fs.readFileSync(clawdEnv, 'utf8').split('\n').forEach(line => {
    const [key, ...val] = line.split('=');
    if (key && !key.startsWith('#')) {
      let v = val.join('=').trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!process.env[key.trim()]) process.env[key.trim()] = v;
    }
  });
}

const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');

// ─── Config ─────────────────────────────────────────────────────────────────
const DRY_RUN_DB_PATH = path.join(__dirname, '..', 'data', 'chaingpt-dry-run.db');
const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
const BATTLES_PER_STRATEGY = 20;

const CHAINGPT_API_KEY = process.env.CHAINGPT_API_KEY || 'fa41cf12-7461-42fe-b17f-1af25302e143';
const CHAINGPT_URL = 'https://api.chaingpt.org/chat/stream';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

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

const STRATEGIES = ['momentum', 'trend_follower', 'scalper', 'swing', 'contrarian'];

const STRATEGY_DESCRIPTIONS = {
  momentum: `You are a MOMENTUM trader. Follow the trend aggressively. If price is rising → BUY with conviction. If falling → SELL. Use leverage 5-15x when trend is strong.`,
  trend_follower: `You are a TREND FOLLOWER. BUY in uptrends, SELL in downtrends. Use moderate leverage 3-8x.`,
  scalper: `You are a SCALPER. Quick trades, tight TP (0.1-0.3%) and SL (0.1-0.2%). High leverage 10-20x.`,
  swing: `You are a SWING trader. Large positions on high-conviction setups. TP 0.5-1.5%, SL 0.3-0.8%.`,
  contrarian: `You are a CONTRARIAN trader. Trade AGAINST the crowd. Price pumped hard → SELL; dumped → BUY.`,
};

// ─── DB Setup ───────────────────────────────────────────────────────────────
function initDb() {
  const db = new Database(DRY_RUN_DB_PATH);
  db.pragma('journal_mode = DELETE');
  db.exec(`
    CREATE TABLE IF NOT EXISTS dry_run_battles (
      id TEXT PRIMARY KEY,
      strategy TEXT NOT NULL,
      opponent_model TEXT NOT NULL,
      symbol TEXT NOT NULL,
      entry_price REAL,
      exit_price REAL,
      chaingpt_action TEXT,
      chaingpt_size REAL,
      chaingpt_leverage INTEGER,
      chaingpt_confidence REAL,
      chaingpt_tp REAL,
      chaingpt_sl REAL,
      chaingpt_reasoning TEXT,
      chaingpt_pnl REAL,
      opp_action TEXT,
      opp_size REAL,
      opp_leverage INTEGER,
      opp_confidence REAL,
      opp_pnl REAL,
      winner TEXT,
      market_data TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  return db;
}

// ─── Fetch Market Data ───────────────────────────────────────────────────────
async function fetchMarketData(symbol) {
  const [tickerRes, klinesRes] = await Promise.all([
    fetch(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol}`),
    fetch(`https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=60&limit=2`)
  ]);
  const ticker = await tickerRes.json();
  const klines = await klinesRes.json();
  const t = ticker?.result?.list?.[0];
  if (!t) throw new Error(`No ticker data for ${symbol}`);

  const price = parseFloat(t.lastPrice);
  const price_24h_pct = parseFloat(t.price24hPcnt) * 100;
  const volume_24h = parseFloat(t.volume24h);

  const klineList = klines?.result?.list || [];
  let price_1h_pct = 0;
  if (klineList.length >= 2) {
    const open1h = parseFloat(klineList[0][1]);
    if (open1h > 0) price_1h_pct = ((price - open1h) / open1h) * 100;
  }

  return { symbol, price, price_1h_pct, price_24h_pct, volume_24h, rsi_14: 50, ema_9: price * 0.999, ema_21: price * 0.998 };
}

function simulateExitPrice(entryPrice) {
  const change = (Math.random() - 0.5) * 0.006;
  return entryPrice * (1 + change);
}

// ─── ChainGPT Decision (correct API format) ──────────────────────────────────
async function getChainGPTDecision(snapshot, strategy) {
  const stratDesc = STRATEGY_DESCRIPTIONS[strategy];
  const question = `${stratDesc}

Market data for ${snapshot.symbol}:
- Current price: $${snapshot.price}
- 1h change: ${snapshot.price_1h_pct?.toFixed(2)}%
- 24h change: ${snapshot.price_24h_pct?.toFixed(2)}%
- Volume 24h: $${(snapshot.volume_24h / 1e6)?.toFixed(1)}M
- RSI-14: ${snapshot.rsi_14}
- EMA9: ${snapshot.ema_9?.toFixed(2)}, EMA21: ${snapshot.ema_21?.toFixed(2)}

Make a trading decision for the next 15 minutes.
Respond ONLY with valid JSON (no extra text):
{"action":"BUY","size":0.5,"leverage":5,"confidence":0.7,"take_profit":1.0,"stop_loss":0.5,"reasoning":"brief explanation"}`;

  try {
    const res = await fetch(CHAINGPT_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CHAINGPT_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'general_assistant',
        question,
        chatHistory: 'off',
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`ChainGPT API ${res.status}: ${text.slice(0, 200)}`);
    }

    // ChainGPT streams plain text (not SSE)
    const text = await res.text();
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const d = JSON.parse(jsonMatch[0]);
      return {
        action: ['BUY', 'SELL', 'HOLD'].includes(d.action) ? d.action : 'HOLD',
        size: Math.min(1, Math.max(0.1, parseFloat(d.size) || 0.3)),
        leverage: Math.min(20, Math.max(1, parseInt(d.leverage) || 5)),
        confidence: Math.min(1, Math.max(0, parseFloat(d.confidence) || 0.5)),
        take_profit: Math.min(5, Math.max(0.1, parseFloat(d.take_profit) || 1.0)),
        stop_loss: Math.min(5, Math.max(0.1, parseFloat(d.stop_loss) || 0.5)),
        reasoning: d.reasoning || '',
        source: 'chaingpt',
      };
    }
    throw new Error(`No JSON in response: ${text.slice(0, 200)}`);
  } catch (e) {
    console.warn(`  ⚠️  ChainGPT failed: ${e.message}`);
    return { action: 'HOLD', size: 0.3, leverage: 3, confidence: 0.5, take_profit: 1.0, stop_loss: 0.5, reasoning: `error: ${e.message}`, source: 'fallback' };
  }
}

// ─── OpenRouter Decision ─────────────────────────────────────────────────────
async function getOpenRouterDecision(modelId, snapshot, strategy) {
  const stratDesc = STRATEGY_DESCRIPTIONS[strategy];
  const prompt = `${stratDesc}

Market data for ${snapshot.symbol}:
- Price: $${snapshot.price} | 1h: ${snapshot.price_1h_pct?.toFixed(2)}% | 24h: ${snapshot.price_24h_pct?.toFixed(2)}%
- Volume 24h: $${(snapshot.volume_24h / 1e6)?.toFixed(1)}M | RSI: ${snapshot.rsi_14}

Respond ONLY with valid JSON:
{"action":"BUY"|"SELL"|"HOLD","size":0.1-1.0,"leverage":1-20,"confidence":0.0-1.0,"take_profit":0.1-3.0,"stop_loss":0.1-2.0,"reasoning":"brief"}`;

  try {
    const res = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://gembots.space',
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
        temperature: 0.7,
      }),
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const d = JSON.parse(jsonMatch[0]);
      return {
        action: ['BUY', 'SELL', 'HOLD'].includes(d.action) ? d.action : 'HOLD',
        size: Math.min(1, Math.max(0.1, parseFloat(d.size) || 0.3)),
        leverage: Math.min(20, Math.max(1, parseInt(d.leverage) || 5)),
        confidence: Math.min(1, Math.max(0, parseFloat(d.confidence) || 0.5)),
        take_profit: Math.min(5, Math.max(0.1, parseFloat(d.take_profit) || 1.0)),
        stop_loss: Math.min(5, Math.max(0.1, parseFloat(d.stop_loss) || 0.5)),
        reasoning: d.reasoning || '',
      };
    }
    throw new Error('no JSON');
  } catch (e) {
    console.warn(`  ⚠️  OpenRouter (${modelId.split('/')[1]}) failed: ${e.message}`);
    return { action: 'HOLD', size: 0.3, leverage: 3, confidence: 0.5, take_profit: 1.0, stop_loss: 0.5, reasoning: 'fallback' };
  }
}

function calcPnL(decision, entryPrice, exitPrice) {
  if (decision.action === 'HOLD') return 0;
  const direction = decision.action === 'BUY' ? 1 : -1;
  const pricePct = ((exitPrice - entryPrice) / entryPrice) * 100;
  return direction * pricePct * decision.leverage * decision.size;
}

async function main() {
  console.log('🤖 ChainGPT Dry-Run — Strategy Optimizer');
  console.log(`📁 DB: ${DRY_RUN_DB_PATH}`);
  console.log(`🔑 ChainGPT: ${CHAINGPT_API_KEY.slice(0,8)}... | OpenRouter: ${OPENROUTER_API_KEY ? OPENROUTER_API_KEY.slice(0,12) + '...' : 'MISSING!'}`);

  if (!OPENROUTER_API_KEY) { console.error('❌ OPENROUTER_API_KEY missing'); process.exit(1); }

  const db = initDb();

  console.log('\n📊 Fetching market data from Bybit...');
  const marketData = {};
  for (const sym of SYMBOLS) {
    try {
      marketData[sym] = await fetchMarketData(sym);
      const d = marketData[sym];
      console.log(`  ${sym}: $${d.price.toFixed(2)} | 1h: ${d.price_1h_pct.toFixed(2)}% | 24h: ${d.price_24h_pct.toFixed(2)}%`);
    } catch (e) {
      console.error(`  ❌ ${sym}: ${e.message}`);
    }
  }

  const availableSymbols = Object.keys(marketData);
  if (availableSymbols.length === 0) { console.error('❌ No market data'); process.exit(1); }

  const results = {};
  for (const strat of STRATEGIES) {
    results[strat] = { wins: 0, losses: 0, draws: 0, totalPnL: 0, battles: 0 };
  }

  let battleNum = 0;
  const totalBattles = STRATEGIES.length * BATTLES_PER_STRATEGY;

  for (const strategy of STRATEGIES) {
    console.log(`\n⚔️  Strategy: ${strategy.toUpperCase()} (${BATTLES_PER_STRATEGY} battles)`);
    console.log('─'.repeat(65));

    for (let i = 0; i < BATTLES_PER_STRATEGY; i++) {
      battleNum++;
      const symbol = availableSymbols[Math.floor(Math.random() * availableSymbols.length)];
      const snap = marketData[symbol];
      const opponentModel = MODEL_POOL[Math.floor(Math.random() * MODEL_POOL.length)];
      const oppShort = opponentModel.split('/')[1] || opponentModel;

      process.stdout.write(`  [${String(battleNum).padStart(3)}/${totalBattles}] ${symbol} vs ${oppShort.slice(0,20).padEnd(20)}... `);

      const [cgDecision, oppDecision] = await Promise.all([
        getChainGPTDecision(snap, strategy),
        getOpenRouterDecision(opponentModel, snap, strategy),
      ]);

      const exitPrice = simulateExitPrice(snap.price);
      const cgPnL = calcPnL(cgDecision, snap.price, exitPrice);
      const oppPnL = calcPnL(oppDecision, snap.price, exitPrice);

      let winner = 'draw';
      if (cgPnL > oppPnL + 0.01) winner = 'chaingpt';
      else if (oppPnL > cgPnL + 0.01) winner = 'opponent';

      const r = results[strategy];
      r.battles++;
      r.totalPnL += cgPnL;
      if (winner === 'chaingpt') r.wins++;
      else if (winner === 'opponent') r.losses++;
      else r.draws++;

      db.prepare(`
        INSERT INTO dry_run_battles (
          id, strategy, opponent_model, symbol, entry_price, exit_price,
          chaingpt_action, chaingpt_size, chaingpt_leverage, chaingpt_confidence,
          chaingpt_tp, chaingpt_sl, chaingpt_reasoning, chaingpt_pnl,
          opp_action, opp_size, opp_leverage, opp_confidence, opp_pnl,
          winner, market_data
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        uuidv4(), strategy, opponentModel, symbol, snap.price, exitPrice,
        cgDecision.action, cgDecision.size, cgDecision.leverage, cgDecision.confidence,
        cgDecision.take_profit, cgDecision.stop_loss, cgDecision.reasoning, cgPnL,
        oppDecision.action, oppDecision.size, oppDecision.leverage, oppDecision.confidence, oppPnL,
        winner, JSON.stringify(snap)
      );

      const winEmoji = winner === 'chaingpt' ? '✅' : (winner === 'draw' ? '➖' : '❌');
      console.log(`${winEmoji} CG:${cgDecision.action}(x${cgDecision.leverage}) ${cgPnL.toFixed(3)} | Opp:${oppDecision.action}(x${oppDecision.leverage}) ${oppPnL.toFixed(3)}`);
    }
  }

  // ─── Print Summary ────────────────────────────────────────────────────────
  console.log('\n');
  console.log('═'.repeat(72));
  console.log('  📊 ChainGPT Dry-Run Results — Strategy Comparison');
  console.log('═'.repeat(72));
  console.log(`  ${'Strategy'.padEnd(16)} | ${'W-L-D'.padEnd(9)} | ${'Win%'.padEnd(7)} | ${'Avg PnL'.padEnd(9)} | Total PnL`);
  console.log('─'.repeat(72));

  const sorted = STRATEGIES
    .map(s => ({ strategy: s, ...results[s] }))
    .sort((a, b) => (b.wins / b.battles) - (a.wins / a.battles));

  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const winRate = r.battles > 0 ? ((r.wins / r.battles) * 100).toFixed(1) : '0.0';
    const avgPnL = r.battles > 0 ? (r.totalPnL / r.battles).toFixed(4) : '0.0000';
    const totalPnL = r.totalPnL >= 0 ? `+${r.totalPnL.toFixed(3)}` : r.totalPnL.toFixed(3);
    const wld = `${r.wins}-${r.losses}-${r.draws}`;
    const medal = i === 0 ? '🥇' : (i === 1 ? '🥈' : (i === 2 ? '🥉' : '  '));
    console.log(`${medal}${r.strategy.padEnd(16)} | ${wld.padEnd(9)} | ${(winRate + '%').padEnd(7)} | ${avgPnL.padEnd(9)} | ${totalPnL}`);
  }

  console.log('═'.repeat(72));

  const byAvgPnL = [...sorted].sort((a, b) => (b.totalPnL / b.battles) - (a.totalPnL / a.battles));
  const byTotalPnL = [...sorted].sort((a, b) => b.totalPnL - a.totalPnL);

  console.log(`\n🏆 Best Win Rate:  ${sorted[0].strategy} (${((sorted[0].wins / sorted[0].battles) * 100).toFixed(1)}%)`);
  console.log(`💰 Best Avg PnL:  ${byAvgPnL[0].strategy} (${(byAvgPnL[0].totalPnL / byAvgPnL[0].battles).toFixed(4)} per battle)`);
  console.log(`📈 Best Total PnL: ${byTotalPnL[0].strategy} (${byTotalPnL[0].totalPnL >= 0 ? '+' : ''}${byTotalPnL[0].totalPnL.toFixed(3)})`);
  console.log(`\n📁 Results saved to: ${DRY_RUN_DB_PATH}`);
  console.log('✅ Dry-run complete!\n');

  db.close();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
