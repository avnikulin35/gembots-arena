#!/usr/bin/env node
/**
 * ChainGPT Strategy Factory
 * Generates custom trading strategies using ChainGPT AI
 */
const fs = require('fs');
const path = require('path');

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

const Database = require('better-sqlite3');
const DB_PATH = path.join(__dirname, '..', 'data', 'gembots.db');
const CHAINGPT_API_KEY = process.env.CHAINGPT_API_KEY;
const CHAINGPT_URL = 'https://api.chaingpt.org/chat/stream';
const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS custom_strategies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    style TEXT,
    prompt TEXT NOT NULL,
    preferred_leverage INTEGER DEFAULT 5,
    created_by TEXT DEFAULT 'chaingpt',
    win_rate REAL DEFAULT 0,
    total_battles INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

async function fetchMarketData() {
  const data = {};
  for (const symbol of SYMBOLS) {
    try {
      const res = await fetch(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol}`);
      const json = await res.json();
      const t = json?.result?.list?.[0];
      if (!t) continue;
      data[symbol] = {
        price: parseFloat(t.lastPrice),
        change24h: (parseFloat(t.price24hPcnt) * 100).toFixed(2),
        volume24h: (parseFloat(t.volume24h) / 1e6).toFixed(1)
      };
    } catch (e) { console.error(`Failed to fetch ${symbol}:`, e.message); }
  }
  return data;
}

async function generateStrategy(marketData) {
  const marketStr = Object.entries(marketData)
    .map(([s, d]) => `- ${s}: $${d.price}, 24h: ${d.change24h}%, Vol: $${d.volume24h}M`)
    .join('\n');

  const question = `You are a professional crypto quant. Analyze the current market conditions and create an optimal trading strategy.

Market data:
${marketStr}

Create a unique, creative trading strategy optimized for these conditions. Respond ONLY with valid JSON:
{"name":"creative unique name","description":"2-3 sentence strategy description","style":"aggressive or moderate or conservative","preferred_leverage":5,"prompt":"Full system prompt: You are a [NAME] trader. Detailed instructions how to trade, when to BUY SELL HOLD, what signals to watch, leverage rules, TP SL rules"}`;

  const res = await fetch(CHAINGPT_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CHAINGPT_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ model: 'general_assistant', question, chatHistory: 'off' })
  });

  if (!res.ok) throw new Error(`ChainGPT API ${res.status}: ${await res.text()}`);
  
  const text = await res.text();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in response: ' + text.slice(0, 200));
  return JSON.parse(jsonMatch[0]);
}

async function main() {
  console.log('🏭 ChainGPT Strategy Factory');
  console.log(`🔑 API Key: ${CHAINGPT_API_KEY ? CHAINGPT_API_KEY.slice(0, 8) + '...' : 'MISSING'}`);

  const marketData = await fetchMarketData();
  console.log('📊 Market:', Object.entries(marketData).map(([s, d]) => `${s}: $${d.price}`).join(', '));

  const strategy = await generateStrategy(marketData);
  console.log(`🧠 Generated: ${strategy.name} — ${strategy.description}`);

  const existing = db.prepare('SELECT id FROM custom_strategies WHERE name = ?').get(strategy.name);
  if (existing) {
    console.log(`⚠️ Strategy "${strategy.name}" already exists, skipping.`);
    return;
  }

  db.prepare(`INSERT INTO custom_strategies (name, description, style, prompt, preferred_leverage) VALUES (?, ?, ?, ?, ?)`)
    .run(strategy.name, strategy.description, strategy.style, strategy.prompt, strategy.preferred_leverage || 5);

  const count = db.prepare('SELECT COUNT(*) as c FROM custom_strategies WHERE active = 1').get();
  console.log(`✅ Created "${strategy.name}" — ${strategy.description}`);
  console.log(`📦 Total custom strategies: ${count.c}`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
