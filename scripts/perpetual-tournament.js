#!/usr/bin/env node

/**
 * GemBots Perpetual Tournament Engine
 * 
 * Runs indefinitely as a pm2 process (or standalone).
 * Creates bracket tournaments from top-8 bots by ELO, simulates live battles
 * with trade-by-trade updates every 3-5 seconds, advances through rounds,
 * crowns champions, and starts fresh tournaments in an infinite loop.
 * 
 * Live state is written to data/tournament.json with a `currentMatch` field
 * containing real-time HP, PnL, and trade history for the active fight.
 * 
 * Usage:
 *   node scripts/perpetual-tournament.js
 *   pm2 start scripts/perpetual-tournament.js --name perpetual-tournament
 */

const fs = require('fs');
const path = require('path');

// ============================================
// ENV & IMPORTS
// ============================================

const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [key, ...val] = line.split('=');
    if (key && !key.startsWith('#')) {
      let v = val.join('=').trim();
      // Strip surrounding quotes
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      process.env[key.trim()] = v;
    }
  });
}

// Betting integration
const betting = require('./betting-integration');

// Reuse helpers from tournament-engine.js
const {
  loadState,
  saveState,
  supabaseQuery,
  supabaseInsert,
} = (() => {
  // Inline the core helpers to avoid require issues with the CLI-style module
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const STATE_FILE = path.join(__dirname, '..', 'data', 'tournament.json');
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  function loadState() {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
    return null;
  }

  function saveState(state) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  }

  async function supabaseQuery(table, params = '') {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
    });
    return res.json();
  }

  async function supabaseInsert(table, data) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify(data),
    });
    return res.json();
  }

  async function supabasePatch(table, filter, data) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(data),
    });
    return res;
  }

  return { loadState, saveState, supabaseQuery, supabaseInsert, supabasePatch };
})();

// Pull supabasePatch out of the closure too
const { supabasePatch } = (() => {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  async function supabasePatch(table, filter, data) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(data),
    });
    return res;
  }

  return { supabasePatch };
})();

// ============================================
// MULTI-PROVIDER LLM PREDICTIONS
// ============================================

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const LLM_TIMEOUT_MS = 20000;

function buildPrompt(botName, token, durationMinutes) {
  return `You are "${botName}", a competitive AI crypto trading bot in GemBots Arena.
You must predict the price multiplier of ${token.symbol} (current: $${token.price}, mcap: $${token.mcap || 'unknown'}) after ${durationMinutes} minutes.

This is a major crypto token on BSC (Binance Smart Chain). These tokens can move 1-5% in minutes during active markets.
Be bold! Conservative predictions (1.00x) lose in the arena. Take a position based on momentum and market sentiment.

Reply ONLY with JSON: {"prediction": <number>, "confidence": <1-100>, "reasoning": "<one sentence>"}
prediction = multiplier (e.g. 1.12 means +12%, 0.88 means -12%). Must be between 0.7 and 2.0.`;
}

function parsePrediction(content) {
  const jsonMatch = content.match(/\{[^}]+\}/);
  if (!jsonMatch) return null;
  const parsed = JSON.parse(jsonMatch[0]);
  const prediction = parseFloat(parsed.prediction);
  const confidence = parseInt(parsed.confidence) || 50;
  if (isNaN(prediction) || prediction <= 0 || prediction > 10) return null;
  return { prediction: parseFloat(prediction.toFixed(3)), confidence, reasoning: parsed.reasoning || '' };
}

// Provider: Gemini (free, fast)
async function callGemini(prompt, modelHint) {
  if (!GEMINI_API_KEY) return null;
  // Use gemini-2.0-flash for all — it's free and fast
  const model = 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 200 },
    }),
    signal: controller.signal,
  });
  clearTimeout(timeout);
  if (!res.ok) return null;
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return text;
}

// Provider: OpenAI (gpt-4.1-mini — cheap)
async function callOpenAI(prompt, modelHint) {
  if (!OPENAI_API_KEY) return null;
  const model = 'gpt-4.1-mini';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
      temperature: 0.7,
    }),
    signal: controller.signal,
  });
  clearTimeout(timeout);
  if (!res.ok) return null;
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

// Provider: OpenRouter (multiple models)
async function callOpenRouter(prompt, modelId) {
  if (!OPENROUTER_API_KEY || !modelId) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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
    signal: controller.signal,
  });
  clearTimeout(timeout);
  if (!res.ok) return null;
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

// Model routing: map model_id to provider
function getProvider(modelId) {
  if (!modelId) return 'gemini';
  // google/gemma-* models go through OpenRouter (free tier), not Gemini API
  if (modelId.startsWith('google/gemma')) return 'openrouter';
  if (modelId.startsWith('google/') || modelId.startsWith('gemini')) return 'gemini';
  if (modelId.startsWith('openai/') || modelId.startsWith('gpt')) return 'openai';
  // All others (x-ai/grok, deepseek, mistralai, qwen, meta-llama, minimax) → OpenRouter
  return 'openrouter';
}

async function getLLMPrediction(botName, modelId, token, durationMinutes = 3) {
  const prompt = buildPrompt(botName, token, durationMinutes);
  const provider = getProvider(modelId);
  let content = null;
  let usedProvider = provider;
  
  try {
    // Try primary provider
    if (provider === 'gemini') {
      content = await callGemini(prompt, modelId);
    } else if (provider === 'openai') {
      content = await callOpenAI(prompt, modelId);
    } else {
      content = await callOpenRouter(prompt, modelId);
    }
    
    // Fallback chain: OpenRouter → OpenAI → Gemini
    if (!content && provider === 'openrouter') {
      content = await callOpenAI(prompt, modelId);
      usedProvider = 'openai';
    }
    if (!content) {
      content = await callGemini(prompt, modelId);
      usedProvider = 'gemini';
    }
    
    if (!content) return null;
    
    const result = parsePrediction(content);
    if (!result) return null;
    
    const modelShort = modelId ? modelId.split('/').pop() : usedProvider;
    log(`   🧠 ${botName} (${modelShort} via ${usedProvider}): ${result.prediction}x | confidence: ${result.confidence}%`);
    return result;
  } catch (err) {
    log(`   ⚠️ LLM error for ${botName}: ${err.message}`);
    return null;
  }
}

function formulaPrediction(elo) {
  return parseFloat((1.0 + (elo - 1000) / 2000).toFixed(2));
}

// ============================================
// CONSTANTS
// ============================================

const MATCH_DURATION_SEC = 180;       // 3 minutes per match
const TRADE_INTERVAL_MIN = 3000;      // trade every 3-5 sec
const TRADE_INTERVAL_MAX = 5000;
const PAUSE_BETWEEN_MATCHES = 15000;  // 15 sec (victory screen)
const BETTING_WINDOW_SEC = 60;         // 60 sec betting window before each match
const PAUSE_BETWEEN_ROUNDS = 30000;   // 30 sec
const PAUSE_BETWEEN_TOURNAMENTS = 60000; // 60 sec
const MAX_HP = 1000;
const MAX_TRADES_IN_STATE = 10;       // keep last 10 trades in currentMatch

// BSC tokens — major crypto + BNB ecosystem (high liquidity on PancakeSwap)
const TOKEN_POOL = [
  { symbol: 'BNB',  address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' },  // WBNB — $5.6M liq
  { symbol: 'BTC',  address: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c' },  // BTCB — $730K liq
  { symbol: 'ETH',  address: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8' },  // ETH — $2M liq
  { symbol: 'SOL',  address: '0x570A5D26f7765Ecb712C0924E4De545B89fD43dF' },  // SOL — $1.4M liq
  { symbol: 'CAKE', address: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82' },  // PancakeSwap — $14M liq
  { symbol: 'XRP',  address: '0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE' },  // XRP — $1.3M liq
  { symbol: 'LINK', address: '0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD' },  // Chainlink — $782K liq
  { symbol: 'ADA',  address: '0x3EE2200Efb3400fAbB9AacF31297cBdD1d435D47' },  // Cardano — $522K liq
];

// ============================================
// LOGGING
// ============================================

function log(...args) {
  console.log(`[PERPETUAL]`, ...args);
}

function logError(...args) {
  console.error(`[PERPETUAL] ❌`, ...args);
}

// ============================================
// HELPERS
// ============================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min, max) {
  return min + Math.random() * (max - min);
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getWeekNumber() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const diff = now.getTime() - start.getTime();
  return Math.ceil(diff / (7 * 24 * 60 * 60 * 1000));
}

let tournamentCounter = 0;
let nfaTournamentCounter = 0;
const MIN_NFA_FOR_TOURNAMENT = 4;  // Min NFA bots to run NFA-only tournament
const NFA_ELO_MULTIPLIER = 1.5;    // NFA League gives 1.5x ELO per win

// ============================================
// REAL PRICE FETCHING (Bybit API)
// ============================================

// Price cache to avoid redundant API calls within short windows
const priceCache = new Map(); // key: mint → { price, timestamp }
const PRICE_CACHE_TTL = 2000; // 2 sec cache

// Bybit symbol mapping by contract address
const BYBIT_BY_ADDRESS = {
  '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c': 'BNBUSDT',
  '0x2170Ed0880ac9A755fd29B2688956BD959F933F8': 'ETHUSDT',
  '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c': 'BTCUSDT',
  '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82': 'CAKEUSDT',
  '0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD': 'LINKUSDT',
  '0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE': 'XRPUSDT',
  '0x570A5D26f7765Ecb712C0924E4De545B89fD43dF': 'SOLUSDT',
  '0x3EE2200Efb3400fAbB9AacF31297cBdD1d435D47': 'ADAUSDT',
  'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm': 'WIFUSDT',
  'So11111111111111111111111111111111111111112': 'SOLUSDT',
};
const BYBIT_BY_SYMBOL = {
  'BTC': 'BTCUSDT', 'ETH': 'ETHUSDT', 'SOL': 'SOLUSDT',
  'BNB': 'BNBUSDT', 'WIF': 'WIFUSDT', 'CAKE': 'CAKEUSDT',
  'LINK': 'LINKUSDT', 'PEPE': 'PEPEUSDT', 'DOGE': 'DOGEUSDT',
  'XRP': 'XRPUSDT', 'ADA': 'ADAUSDT', 'AVAX': 'AVAXUSDT',
  'DOT': 'DOTUSDT',
};

/**
 * Fetch real token price from Bybit API.
 * Returns price in USD or null if unavailable.
 */
async function fetchTokenPrice(mintAddress, tokenSymbol) {
  // Check cache first
  const cached = priceCache.get(mintAddress);
  if (cached && Date.now() - cached.timestamp < PRICE_CACHE_TTL) {
    return cached.price;
  }

  // 1) Try Bybit API first
  const bybitSymbol = BYBIT_BY_ADDRESS[mintAddress] || (tokenSymbol && BYBIT_BY_SYMBOL[tokenSymbol.toUpperCase()]);
  if (bybitSymbol) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${bybitSymbol}`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await res.json();
      if (data?.result?.list?.[0]) {
        const price = parseFloat(data.result.list[0].lastPrice);
        if (!isNaN(price) && price > 0) {
          priceCache.set(mintAddress, { price, timestamp: Date.now() });
          return price;
        }
      }
    } catch (e) {
      // Bybit failed
    }
  }

  // Bybit was our only source for this token
  return null;
}

// ============================================
// TRADING STYLE AI LOGIC
// ============================================

// ─── DEFAULT STRATEGY PARAMS PER STYLE ────────────────────────────────────────
// These are the "factory preset" strategies. Users can customize and mint as NFA.
const DEFAULT_STRATEGIES = {
  momentum: {
    base_style: 'momentum',
    entry_threshold: 0.005,
    exit_threshold: 0.003,
    trend_lookback: 5,
    max_hold_ticks: 8,
    position_size_pct: 50,
    stop_loss_pct: 3.0,
    take_profit_pct: 8.0,
    noise_factor: 0.01,
    boredom_trade_chance: 0.3,
  },
  mean_reversion: {
    base_style: 'mean_reversion',
    entry_threshold: 0.005,
    exit_threshold: 0.005,
    trend_lookback: 5,
    max_hold_ticks: 9,
    position_size_pct: 50,
    stop_loss_pct: 4.0,
    take_profit_pct: 6.0,
    noise_factor: 0.01,
    boredom_trade_chance: 0.25,
  },
  scalper: {
    base_style: 'scalper',
    entry_threshold: 0.001,
    exit_threshold: 0.001,
    trend_lookback: 3,
    max_hold_ticks: 3,
    position_size_pct: 25,
    stop_loss_pct: 1.5,
    take_profit_pct: 3.0,
    noise_factor: 0.005,
    boredom_trade_chance: 0.8,
  },
  swing: {
    base_style: 'swing',
    entry_threshold: 0.01,
    exit_threshold: 0.008,
    trend_lookback: 8,
    max_hold_ticks: 12,
    position_size_pct: 75,
    stop_loss_pct: 5.0,
    take_profit_pct: 12.0,
    noise_factor: 0.01,
    boredom_trade_chance: 0.15,
  },
  contrarian: {
    base_style: 'contrarian',
    entry_threshold: 0.005,
    exit_threshold: 0.008,
    trend_lookback: 5,
    max_hold_ticks: 7,
    position_size_pct: 50,
    stop_loss_pct: 3.0,
    take_profit_pct: 10.0,
    noise_factor: 0.01,
    boredom_trade_chance: 0.35,
  },
};

/**
 * Get strategy params for a bot — from DB or defaults.
 * @param {object|null} dbParams - strategy_params from Supabase (JSONB)
 * @param {string} tradingStyle - fallback style name
 * @returns {object|null} strategy params or null for legacy mode
 */
function getStrategyParams(dbParams, tradingStyle) {
  if (dbParams && typeof dbParams === 'object' && Object.keys(dbParams).length > 0) {
    return dbParams; // Custom strategy from DB/NFA
  }
  // Return default for known styles (enables parameterized mode for ALL bots)
  return DEFAULT_STRATEGIES[tradingStyle] || null;
}

/**
 * Bot AI decision engine — parameterized by strategy config.
 * If strategyParams provided, uses configurable thresholds.
 * Otherwise falls back to hardcoded style behavior (legacy).
 *
 * @param {string} style - trading_style from DB
 * @param {number[]} priceHistory - recent prices (oldest first)
 * @param {object} position - current position { side, entryPrice, size } or null
 * @param {number} botElo - bot's ELO rating
 * @param {object} [strategyParams] - optional strategy config params
 * @returns {{ action: 'open_long'|'open_short'|'close'|'hold', size: number }}
 */
function aiDecision(style, priceHistory, position, botElo, strategyParams) {
  if (priceHistory.length < 2) {
    return { action: 'hold', size: 0 };
  }

  const current = priceHistory[priceHistory.length - 1];
  const prev = priceHistory[priceHistory.length - 2];
  const pctChange = ((current - prev) / prev) * 100;
  
  // Longer trend (last 3-5 candles if available)
  const lookback = Math.min(5, priceHistory.length);
  const oldPrice = priceHistory[priceHistory.length - lookback];
  const trendPct = ((current - oldPrice) / oldPrice) * 100;

  // ELO bonus: better bots make better decisions
  const eloFactor = ((botElo || 1000) - 800) / 400; // 0.5 to 1.5 range
  const decisionQuality = Math.min(1.0, 0.5 + eloFactor * 0.3);

  const size = randomFloat(50, 500);

  // Use very low thresholds since we check every 3-5 sec (meme coins can move 0.001-0.05% per tick)
  // Also add randomness so bots don't just HOLD forever on flat markets
  const noise = (Math.random() - 0.5) * 0.01; // ±0.005% noise to break ties
  const adjChange = pctChange + noise;
  const adjTrend = trendPct + noise;

  // ─── PARAMETERIZED STRATEGY MODE ────────────────────────────────
  // If strategyParams provided, use configurable thresholds
  if (strategyParams && typeof strategyParams === 'object') {
    const sp = strategyParams;
    const entryThresh = sp.entry_threshold ?? 0.005;
    const exitThresh = sp.exit_threshold ?? 0.003;
    const maxHold = sp.max_hold_ticks ?? 8;
    const posSizePct = sp.position_size_pct ?? 50;
    const stopLossPct = sp.stop_loss_pct ?? 2.0;
    const takeProfitPct = sp.take_profit_pct ?? 5.0;
    const noiseFactor = sp.noise_factor ?? 0.01;
    const boredomChance = sp.boredom_trade_chance ?? 0.3;
    const trendLookbackCfg = sp.trend_lookback ?? 5;

    const customNoise = (Math.random() - 0.5) * noiseFactor;
    const customChange = pctChange + customNoise;

    const customLookback = Math.min(trendLookbackCfg, priceHistory.length);
    const customOldPrice = priceHistory[priceHistory.length - customLookback];
    const customTrend = ((current - customOldPrice) / customOldPrice) * 100 + customNoise;

    const customSize = size * (posSizePct / 50); // normalize around 50%

    // Check stop loss / take profit if in position
    if (position) {
      const unrealPct = position.side === 'LONG'
        ? ((current - position.entryPrice) / position.entryPrice) * 100
        : ((position.entryPrice - current) / position.entryPrice) * 100;

      if (unrealPct <= -stopLossPct) return { action: 'close', size: 0 }; // stop loss
      if (unrealPct >= takeProfitPct) return { action: 'close', size: 0 }; // take profit

      const holdTicks = position.holdTicks || 0;
      if (holdTicks > maxHold + Math.floor(Math.random() * 3)) return { action: 'close', size: 0 };
    }

    // Style-specific entry/exit with custom thresholds
    const baseStyle = sp.base_style || style || 'momentum';
    switch (baseStyle) {
      case 'momentum':
        if (!position) {
          if (customChange > entryThresh) return { action: 'open_long', size: customSize };
          if (customChange < -entryThresh) return { action: 'open_short', size: customSize };
          if (Math.random() > (1 - boredomChance)) return { action: Math.random() > 0.5 ? 'open_long' : 'open_short', size: customSize };
        } else {
          if (position.side === 'LONG' && customChange < -exitThresh * decisionQuality) return { action: 'close', size: 0 };
          if (position.side === 'SHORT' && customChange > exitThresh * decisionQuality) return { action: 'close', size: 0 };
        }
        return { action: 'hold', size: 0 };

      case 'mean_reversion':
        if (!position) {
          if (customTrend < -entryThresh * 2) return { action: 'open_long', size: customSize };
          if (customTrend > entryThresh * 2) return { action: 'open_short', size: customSize };
          if (Math.random() > (1 - boredomChance * 0.8)) return { action: Math.random() > 0.5 ? 'open_long' : 'open_short', size: customSize };
        } else {
          if (position.side === 'LONG' && customChange > exitThresh) return { action: 'close', size: 0 };
          if (position.side === 'SHORT' && customChange < -exitThresh) return { action: 'close', size: 0 };
        }
        return { action: 'hold', size: 0 };

      case 'scalper':
        if (!position) {
          if (Math.random() > 0.2) {
            return customChange >= 0
              ? { action: 'open_long', size: customSize * 0.5 }
              : { action: 'open_short', size: customSize * 0.5 };
          }
        } else {
          if (Math.random() > (1 - boredomChance)) return { action: 'close', size: 0 };
        }
        return { action: 'hold', size: 0 };

      case 'swing':
        if (!position) {
          if (customTrend > entryThresh * 4) return { action: 'open_long', size: customSize * 1.5 };
          if (customTrend < -entryThresh * 4) return { action: 'open_short', size: customSize * 1.5 };
          if (Math.random() > 0.85) return { action: Math.random() > 0.5 ? 'open_long' : 'open_short', size: customSize * 1.5 };
        } else {
          const holdTicks = position.holdTicks || 0;
          if (holdTicks < 3) return { action: 'hold', size: 0 };
          if (position.side === 'LONG' && customTrend < -exitThresh * 3) return { action: 'close', size: 0 };
          if (position.side === 'SHORT' && customTrend > exitThresh * 3) return { action: 'close', size: 0 };
        }
        return { action: 'hold', size: 0 };

      case 'contrarian':
        if (!position) {
          if (customChange > entryThresh) return { action: 'open_short', size: customSize };
          if (customChange < -entryThresh) return { action: 'open_long', size: customSize };
          if (Math.random() > (1 - boredomChance)) return { action: Math.random() > 0.5 ? 'open_long' : 'open_short', size: customSize };
        } else {
          if (position.side === 'LONG' && customChange > exitThresh * 1.5) return { action: 'close', size: 0 };
          if (position.side === 'SHORT' && customChange < -exitThresh * 1.5) return { action: 'close', size: 0 };
        }
        return { action: 'hold', size: 0 };

      default:
        if (!position && Math.random() > 0.4) {
          return { action: Math.random() > 0.5 ? 'open_long' : 'open_short', size: customSize };
        }
        if (position && Math.random() > 0.5) return { action: 'close', size: 0 };
        return { action: 'hold', size: 0 };
    }
  }

  // ─── LEGACY HARDCODED MODE (no strategyParams) ──────────────────
  switch (style) {
    case 'momentum': {
      // Buy if rising, sell if falling
      if (!position) {
        if (adjChange > 0.003) return { action: 'open_long', size };
        if (adjChange < -0.003) return { action: 'open_short', size };
        // Bored? Random entry occasionally 
        if (Math.random() > 0.7) return { action: Math.random() > 0.5 ? 'open_long' : 'open_short', size };
        return { action: 'hold', size: 0 };
      }
      // Close if trend reverses or after a few ticks
      const holdTicks = position.holdTicks || 0;
      if (position.side === 'LONG' && adjChange < -0.005 * decisionQuality) return { action: 'close', size: 0 };
      if (position.side === 'SHORT' && adjChange > 0.005 * decisionQuality) return { action: 'close', size: 0 };
      if (holdTicks > 5 + Math.floor(Math.random() * 3)) return { action: 'close', size: 0 };
      return { action: 'hold', size: 0 };
    }

    case 'mean_reversion': {
      // Buy dips, sell rips (expects price to revert)
      if (!position) {
        if (adjTrend < -0.01) return { action: 'open_long', size };
        if (adjTrend > 0.01) return { action: 'open_short', size };
        if (Math.random() > 0.75) return { action: Math.random() > 0.5 ? 'open_long' : 'open_short', size };
        return { action: 'hold', size: 0 };
      }
      const holdTicks = position.holdTicks || 0;
      if (position.side === 'LONG' && adjChange > 0.005) return { action: 'close', size: 0 };
      if (position.side === 'SHORT' && adjChange < -0.005) return { action: 'close', size: 0 };
      if (holdTicks > 6 + Math.floor(Math.random() * 3)) return { action: 'close', size: 0 };
      return { action: 'hold', size: 0 };
    }

    case 'scalper': {
      // Fast in/out, always trade — most active style
      if (!position) {
        if (Math.random() > 0.2) {
          return adjChange >= 0
            ? { action: 'open_long', size: size * 0.5 }
            : { action: 'open_short', size: size * 0.5 };
        }
        return { action: 'hold', size: 0 };
      }
      // Close quickly — almost always close after 1-2 ticks
      if (Math.random() > 0.3) return { action: 'close', size: 0 };
      return { action: 'hold', size: 0 };
    }

    case 'swing': {
      // Hold longer, trade less frequently
      if (!position) {
        if (adjTrend > 0.02) return { action: 'open_long', size: size * 1.5 };
        if (adjTrend < -0.02) return { action: 'open_short', size: size * 1.5 };
        if (Math.random() > 0.85) return { action: Math.random() > 0.5 ? 'open_long' : 'open_short', size: size * 1.5 };
        return { action: 'hold', size: 0 };
      }
      const holdTicks = position.holdTicks || 0;
      if (holdTicks < 3) return { action: 'hold', size: 0 };
      if (position.side === 'LONG' && adjTrend < -0.02) return { action: 'close', size: 0 };
      if (position.side === 'SHORT' && adjTrend > 0.02) return { action: 'close', size: 0 };
      if (holdTicks > 8 + Math.floor(Math.random() * 4)) return { action: 'close', size: 0 };
      return { action: 'hold', size: 0 };
    }

    case 'contrarian': {
      // Act against the trend
      if (!position) {
        if (adjChange > 0.005) return { action: 'open_short', size };
        if (adjChange < -0.005) return { action: 'open_long', size };
        if (Math.random() > 0.65) return { action: Math.random() > 0.5 ? 'open_long' : 'open_short', size };
        return { action: 'hold', size: 0 };
      }
      const holdTicks = position.holdTicks || 0;
      if (position.side === 'LONG' && adjChange > 0.008) return { action: 'close', size: 0 };
      if (position.side === 'SHORT' && adjChange < -0.008) return { action: 'close', size: 0 };
      if (holdTicks > 5 + Math.floor(Math.random() * 3)) return { action: 'close', size: 0 };
      return { action: 'hold', size: 0 };
    }

    default: {
      // Unknown style — random behavior
      if (!position && Math.random() > 0.4) {
        return { action: Math.random() > 0.5 ? 'open_long' : 'open_short', size };
      }
      if (position && Math.random() > 0.5) return { action: 'close', size: 0 };
      return { action: 'hold', size: 0 };
    }
  }
}

// ============================================
// TRADE SIMULATION
// ============================================

/**
 * Generate a single trade for a bot (FALLBACK — random mode).
 * Used when real prices are unavailable.
 */
function generateTrade(botElo, tokenSymbol) {
  const side = Math.random() > 0.5 ? 'LONG' : 'SHORT';
  const size = randomFloat(50, 500).toFixed(1);
  
  // Fallback mode: realistic small PnL (±0.5% max) when real prices unavailable
  // This avoids fake large swings — better to have minimal action than fake numbers
  const eloBonus = ((botElo || 1000) - 1000) / 5000;
  const basePnl = randomFloat(-0.4, 0.5) + eloBonus * 0.2;
  
  let pnl = basePnl;
  
  return {
    side,
    size: parseFloat(size),
    pnl: parseFloat(pnl.toFixed(2)),
    token: tokenSymbol,
    timestamp: Date.now(),
  };
}

/**
 * Generate a trade based on REAL price data and bot AI style.
 * Returns { side, size, pnl, token, entryPrice, exitPrice } or null if holding.
 */
function generateRealTrade(botState, currentPrice, tokenSymbol) {
  const { position, priceHistory, tradingStyle, elo, strategyParams } = botState;
  
  const decision = aiDecision(tradingStyle, priceHistory, position, elo, strategyParams);

  if (decision.action === 'hold') {
    // Update hold ticks if in position
    if (position) position.holdTicks = (position.holdTicks || 0) + 1;
    return null;
  }

  if (decision.action === 'open_long' || decision.action === 'open_short') {
    if (position) return null; // already in position
    
    const side = decision.action === 'open_long' ? 'LONG' : 'SHORT';
    botState.position = {
      side,
      entryPrice: currentPrice,
      size: decision.size,
      holdTicks: 0,
    };
    
    return {
      side,
      size: parseFloat(decision.size.toFixed(1)),
      pnl: 0, // PnL calculated on close
      token: tokenSymbol,
      timestamp: Date.now(),
      action: 'OPEN',
      entryPrice: currentPrice,
    };
  }

  if (decision.action === 'close' && position) {
    let priceDiff = currentPrice - position.entryPrice;
    let pctChange = (priceDiff / position.entryPrice) * 100;
    
    // When price hasn't moved (same cached price), simulate micro-movement
    // based on realistic spread/slippage so fights aren't stuck at 0% PnL.
    // Major tokens move ~0.001-0.01% per 3-5 sec tick.
    if (Math.abs(pctChange) < 0.0001) {
      // Simulate realistic micro-movement: ±0.001% to ±0.02%
      const holdTicks = position.holdTicks || 1;
      const microMove = (Math.random() - 0.45) * 0.015 * Math.sqrt(holdTicks); // slight long bias, scales with hold time
      pctChange = microMove;
    }
    
    // Amplify real PnL by leverage factor so fights have meaningful damage
    const LEVERAGE = 100;
    const rawPnl = position.side === 'LONG' ? pctChange : -pctChange;
    let pnl = rawPnl * LEVERAGE;
    // PnL based on real price movement × leverage (with micro-simulation fallback).
    
    const trade = {
      side: position.side,
      size: parseFloat(position.size.toFixed(1)),
      pnl: parseFloat(pnl.toFixed(2)),
      token: tokenSymbol,
      timestamp: Date.now(),
      action: 'CLOSE',
      entryPrice: position.entryPrice,
      exitPrice: currentPrice,
    };
    
    botState.position = null;
    return trade;
  }

  return null;
}

/**
 * Calculate damage from a trade's PnL.
 * Positive PnL for bot1 means damage to bot2 and vice versa.
 * Damage = abs(PnL) scaled to HP units.
 */
function pnlToDamage(pnl) {
  // 1% PnL ≈ 5 HP damage (scaled so 3 min fight is meaningful)
  return Math.max(0, Math.abs(pnl) * 5);
}

// ============================================
// TOURNAMENT CREATION
// ============================================

async function createNewTournament(nfaOnly = false) {
  const leagueLabel = nfaOnly ? '🏅 NFA' : '🆓 Open';
  log(`📋 Fetching top bots by ELO... (${leagueLabel})`);
  
  // Try with strategy_params first, fallback without if column doesn't exist
  let query = '?select=id,name,elo,league,hp,strategy,ai_model,trading_style,model_id,nfa_id,evm_address&hp=gt.0&is_active=eq.true&order=elo.desc&limit=8';
  if (nfaOnly) {
    query += '&nfa_id=not.is.null'; // Only bots with NFA
  }
  let bots = await supabaseQuery('bots', query);
  if (!bots || (bots.code && bots.code === '42703')) {
    // Column doesn't exist yet — fetch without nfa_id filter
    log('⚠️ strategy_params column not found, using defaults');
    let fallbackQuery = '?select=id,name,elo,league,hp,strategy,ai_model,trading_style,model_id,nfa_id,evm_address&hp=gt.0&is_active=eq.true&order=elo.desc&limit=8';
    bots = await supabaseQuery('bots', fallbackQuery);
  }
  
  const minBots = nfaOnly ? MIN_NFA_FOR_TOURNAMENT : 4;
  if (!bots || bots.length < minBots) {
    log(`⚠️ Not enough ${nfaOnly ? 'NFA' : 'active'} bots (need at least ${minBots}, got ${bots?.length || 0}). ${nfaOnly ? 'Skipping NFA tournament.' : 'Retrying in 30s...'}`);
    return null;
  }

  const bracketSize = bots.length >= 8 ? 8 : 4;
  const participants = bots.slice(0, bracketSize);
  const totalRounds = bracketSize === 8 ? 3 : 2;

  // Seeding: #1 vs #8, #2 vs #7, etc.
  const seeded = [];
  for (let i = 0; i < bracketSize / 2; i++) {
    seeded.push({
      matchOrder: i + 1,
      bot1: participants[i],
      bot2: participants[bracketSize - 1 - i],
    });
  }

  if (nfaOnly) {
    nfaTournamentCounter++;
  } else {
    tournamentCounter++;
  }
  const weekNum = getWeekNumber();
  const tournamentName = nfaOnly 
    ? `NFA League Tournament #${nfaTournamentCounter}`
    : `Perpetual Tournament #${tournamentCounter}`;
  const tournament = {
    id: `perpetual-${weekNum}-${Date.now()}`,
    name: tournamentName,
    status: 'active',
    league: nfaOnly ? 'nfa' : 'free',
    eloMultiplier: nfaOnly ? NFA_ELO_MULTIPLIER : 1.0,
    bracketSize,
    totalRounds,
    currentRound: 1,
    participants: participants.map((b, i) => ({
      id: b.id,
      name: b.name,
      elo: b.elo || 1000,
      seed: i + 1,
      ai_model: b.ai_model || null,
      model_id: b.model_id || null,
      trading_style: b.trading_style || null,
      strategy_params: b.strategy_params || null,
      nfa_id: b.nfa_id || null,
    })),
    rounds: {
      1: seeded.map(m => ({
        matchOrder: m.matchOrder,
        bot1Id: m.bot1.id,
        bot1Name: m.bot1.name,
        bot2Id: m.bot2.id,
        bot2Name: m.bot2.name,
        winnerId: null,
        battleId: null,
        status: 'pending',
      })),
    },
    currentMatch: null,
    createdAt: new Date().toISOString(),
    startsAt: new Date().toISOString(),
  };

  saveState(tournament);

  const leagueEmoji = nfaOnly ? '🏅' : '🏆';
  log(`${leagueEmoji} Tournament Created: ${tournament.name}`);
  log(`   League: ${nfaOnly ? 'NFA League (1.5x ELO)' : 'Free Arena'}`);
  log(`   Bracket: ${bracketSize} bots, ${totalRounds} rounds`);
  for (const m of tournament.rounds[1]) {
    const p1 = participants.find(p => p.id === m.bot1Id);
    const p2 = participants.find(p => p.id === m.bot2Id);
    const nfaTag1 = nfaOnly ? ` NFA#${p1?.nfa_id}` : '';
    const nfaTag2 = nfaOnly ? ` NFA#${p2?.nfa_id}` : '';
    log(`   Match ${m.matchOrder}: ${m.bot1Name}${nfaTag1} (ELO ${p1?.elo || '?'}) vs ${m.bot2Name}${nfaTag2} (ELO ${p2?.elo || '?'})`);
  }

  return tournament;
}

// ============================================
// BATTLE SIMULATION (LIVE)
// ============================================

/**
 * Simulate a full match between two bots with live state updates.
 * This is the core: generates trades every 3-5 sec, updates HP/PnL,
 * writes currentMatch to tournament.json on every tick.
 * 
 * Returns winnerId.
 */
async function simulateMatch(state, roundNum, match) {
  const token = pickRandom(TOKEN_POOL);
  
  // Fetch bot data for ELO-influenced trades
  const bot1Data = state.participants.find(p => p.id === match.bot1Id);
  const bot2Data = state.participants.find(p => p.id === match.bot2Id);
  
  const bot1Elo = bot1Data?.elo || 1000;
  const bot2Elo = bot2Data?.elo || 1000;
  
  // AI model and trading style from participant data
  const STYLES = ['momentum', 'mean_reversion', 'scalper', 'swing', 'contrarian'];
  const bot1Style = bot1Data?.trading_style || STYLES[match.bot1Id % STYLES.length];
  const bot2Style = bot2Data?.trading_style || STYLES[match.bot2Id % STYLES.length];
  const bot1AiModel = bot1Data?.ai_model || null;
  const bot2AiModel = bot2Data?.ai_model || null;
  const bot1ModelId = bot1Data?.model_id || null;
  const bot2ModelId = bot2Data?.model_id || null;

  // Get LLM predictions (parallel calls for speed)
  log(`   🧠 Getting LLM predictions...`);
  const [llm1, llm2] = await Promise.all([
    getLLMPrediction(match.bot1Name, bot1ModelId, token, 3),
    getLLMPrediction(match.bot2Name, bot2ModelId, token, 3),
  ]);
  
  const pred1 = llm1 ? llm1.prediction : formulaPrediction(bot1Elo);
  const pred2 = llm2 ? llm2.prediction : formulaPrediction(bot2Elo);
  
  if (!llm1) log(`   ⚠️ ${match.bot1Name}: fallback to formula (${pred1}x)`);
  if (!llm2) log(`   ⚠️ ${match.bot2Name}: fallback to formula (${pred2}x)`);

  // Create Supabase battle record
  let battleId = null;
  try {
    const room = await supabaseInsert('rooms', {
      host_bot_id: match.bot1Id,
      challenger_bot_id: match.bot2Id,
      status: 'in_battle',
      token_symbol: token.symbol,
      token_address: token.address,
      duration_minutes: 3,
      stake_amount: 0,
      started_at: new Date().toISOString(),
    });
    if (room && room[0]) {
      battleId = room[0].id;
      
      // Create battle record
      const resolves_at = new Date(Date.now() + MATCH_DURATION_SEC * 1000).toISOString();
      await supabaseInsert('battles', {
        room_id: battleId,
        bot1_id: match.bot1Id,
        bot2_id: match.bot2Id,
        bot1_prediction: pred1,
        bot2_prediction: pred2,
        token_symbol: token.symbol,
        token_address: token.address,
        duration_minutes: 3,
        status: 'active',
        resolves_at,
      });
    }
  } catch (e) {
    log(`⚠️ Failed to create Supabase battle: ${e.message}`);
  }

  match.battleId = battleId;

  // === BETTING WINDOW: Create pool and let users bet ===
  const bettingMatchId = `${roundNum}_${match.matchOrder}_${state.id}`;
  try {
    const poolResult = await betting.createBettingPool(bettingMatchId, match.bot1Name, match.bot2Name);
    if (poolResult.success) {
      log(`   💰 Betting pool created: ${bettingMatchId}`);
    }
  } catch (e) {
    log(`   ⚠️ Betting pool creation failed: ${e.message}`);
  }

  // Set match status to 'betting' so frontend shows BETTING OPEN
  match.status = 'betting';
  state.currentMatch = {
    bot1: {
      id: match.bot1Id,
      name: match.bot1Name,
      hp: MAX_HP,
      maxHp: MAX_HP,
      pnl: '0%',
      ai_model: bot1AiModel,
      model_id: bot1ModelId,
      trading_style: bot1Style,
      prediction: pred1,
      confidence: llm1?.confidence || null,
    },
    bot2: {
      id: match.bot2Id,
      name: match.bot2Name,
      hp: MAX_HP,
      maxHp: MAX_HP,
      pnl: '0%',
      ai_model: bot2AiModel,
      model_id: bot2ModelId,
      trading_style: bot2Style,
      prediction: pred2,
      confidence: llm2?.confidence || null,
    },
    trades: [],
    timeLeft: MATCH_DURATION_SEC,
    matchIndex: match.matchOrder,
    matchOrder: match.matchOrder,
    totalMatches: state.rounds[roundNum]?.length || 4,
    token: token.symbol,
    status: 'betting',
    bettingMatchId,
    bettingEndsAt: Date.now() + BETTING_WINDOW_SEC * 1000,
    bettingWindowSec: BETTING_WINDOW_SEC,
  };
  saveState(state);
  log(`   🎰 Betting window open for ${BETTING_WINDOW_SEC}s — PLACE YOUR BETS!`);

  // Wait for betting window
  await sleep(BETTING_WINDOW_SEC * 1000);

  // === LOCK BETS & START FIGHT ===
  match.status = 'active';

  // Initialize match state
  let bot1Hp = MAX_HP;
  let bot2Hp = MAX_HP;
  let bot1Pnl = 0;
  let bot2Pnl = 0;
  const allTrades = [];
  const startTime = Date.now();
  const endTime = startTime + MATCH_DURATION_SEC * 1000;

  log(`⚔️ Match ${match.matchOrder} (R${roundNum}): ${match.bot1Name} vs ${match.bot2Name} on $${token.symbol}`);

  // Try to fetch initial real price
  let useRealPrices = false;
  let startPrice = null;
  try {
    startPrice = await fetchTokenPrice(token.address);
    if (startPrice && startPrice > 0) {
      useRealPrices = true;
      log(`   📊 Real price mode: $${token.symbol} = $${startPrice}`);
    }
  } catch (e) {
    log(`   ⚠️ Price fetch failed, using random mode: ${e.message}`);
  }

  if (!useRealPrices) {
    log(`   🎲 Using random trade mode (price fetch unavailable)`);
  }

  // Lock betting pool now that match is starting
  try {
    const lockResult = await betting.lockBettingPool(bettingMatchId);
    if (lockResult.success) {
      log(`   🔒 Betting pool locked`);
    }
  } catch (e) {
    log(`   ⚠️ Betting pool lock failed: ${e.message}`);
  }

  // Bot AI state for real-price mode
  const bot1State = {
    position: null,
    priceHistory: startPrice ? [startPrice] : [],
    tradingStyle: bot1Style,
    elo: bot1Elo,
    strategyParams: getStrategyParams(bot1Data?.strategy_params, bot1Style),
  };
  const bot2State = {
    position: null,
    priceHistory: startPrice ? [startPrice] : [],
    tradingStyle: bot2Style,
    elo: bot2Elo,
    strategyParams: getStrategyParams(bot2Data?.strategy_params, bot2Style),
  };

  // Trade loop
  while (Date.now() < endTime && bot1Hp > 0 && bot2Hp > 0) {
    if (shuttingDown) return match.bot1Id; // early exit on shutdown

    const timeLeft = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));

    let trade1, trade2;

    if (useRealPrices) {
      // Fetch current price
      const currentPrice = await fetchTokenPrice(token.address);
      
      if (currentPrice && currentPrice > 0) {
        // Update price history (keep last 10 prices)
        bot1State.priceHistory.push(currentPrice);
        bot2State.priceHistory.push(currentPrice);
        if (bot1State.priceHistory.length > 10) bot1State.priceHistory.shift();
        if (bot2State.priceHistory.length > 10) bot2State.priceHistory.shift();

        // Bot AI decisions
        const realTrade1 = generateRealTrade(bot1State, currentPrice, token.symbol);
        const realTrade2 = generateRealTrade(bot2State, currentPrice, token.symbol);

        // Use real trades if bot made a decision, else generate a hold-indicator trade
        trade1 = realTrade1 || {
          side: bot1State.position?.side || 'HOLD',
          size: 0,
          pnl: 0,
          token: token.symbol,
          timestamp: Date.now(),
          action: 'HOLD',
        };
        trade2 = realTrade2 || {
          side: bot2State.position?.side || 'HOLD',
          size: 0,
          pnl: 0,
          token: token.symbol,
          timestamp: Date.now(),
          action: 'HOLD',
        };

        // For bots currently in position, calculate unrealized PnL for display (with leverage)
        const DISPLAY_LEVERAGE = 100;
        if (bot1State.position) {
          const diff1 = currentPrice - bot1State.position.entryPrice;
          let pct1 = (diff1 / bot1State.position.entryPrice) * 100;
          // Simulate micro-movement when price unchanged (avoids flat 0% display)
          if (Math.abs(pct1) < 0.0001) {
            const ht = bot1State.position.holdTicks || 1;
            pct1 = (Math.random() - 0.45) * 0.01 * Math.sqrt(ht);
          }
          trade1.unrealizedPnl = (bot1State.position.side === 'LONG' ? pct1 : -pct1) * DISPLAY_LEVERAGE;
        }
        if (bot2State.position) {
          const diff2 = currentPrice - bot2State.position.entryPrice;
          let pct2 = (diff2 / bot2State.position.entryPrice) * 100;
          if (Math.abs(pct2) < 0.0001) {
            const ht = bot2State.position.holdTicks || 1;
            pct2 = (Math.random() - 0.45) * 0.01 * Math.sqrt(ht);
          }
          trade2.unrealizedPnl = (bot2State.position.side === 'LONG' ? pct2 : -pct2) * DISPLAY_LEVERAGE;
        }
      } else {
        // Price fetch failed mid-match — fallback to random for this tick
        trade1 = generateTrade(bot1Elo, token.symbol);
        trade2 = generateTrade(bot2Elo, token.symbol);
      }
    } else {
      // Random mode (fallback)
      trade1 = generateTrade(bot1Elo, token.symbol);
      trade2 = generateTrade(bot2Elo, token.symbol);
    }

    // Only apply PnL from CLOSE trades (realized) or random trades
    const pnl1 = (trade1.action === 'CLOSE' || !useRealPrices) ? trade1.pnl : 0;
    const pnl2 = (trade2.action === 'CLOSE' || !useRealPrices) ? trade2.pnl : 0;

    bot1Pnl += pnl1;
    bot2Pnl += pnl2;

    // Damage: losing trades hurt you, opponent's gains hurt you
    if (pnl1 < 0) {
      bot1Hp = Math.max(0, bot1Hp - pnlToDamage(pnl1));
    }
    if (pnl2 < 0) {
      bot2Hp = Math.max(0, bot2Hp - pnlToDamage(pnl2));
    }
    if (pnl2 > 0) {
      bot1Hp = Math.max(0, bot1Hp - pnlToDamage(pnl2) * 0.5);
    }
    if (pnl1 > 0) {
      bot2Hp = Math.max(0, bot2Hp - pnlToDamage(pnl1) * 0.5);
    }

    // Also apply unrealized PnL damage (smaller) to keep fights active
    if (useRealPrices) {
      const unreal1 = trade1.unrealizedPnl || 0;
      const unreal2 = trade2.unrealizedPnl || 0;
      if (unreal1 < -0.5) bot1Hp = Math.max(0, bot1Hp - pnlToDamage(unreal1) * 0.2);
      if (unreal2 < -0.5) bot2Hp = Math.max(0, bot2Hp - pnlToDamage(unreal2) * 0.2);
      if (unreal2 > 0.5) bot1Hp = Math.max(0, bot1Hp - pnlToDamage(unreal2) * 0.1);
      if (unreal1 > 0.5) bot2Hp = Math.max(0, bot2Hp - pnlToDamage(unreal1) * 0.1);
    }

    // Record trades (skip HOLD for trade log, but show OPENs and CLOSEs)
    if (trade1.action !== 'HOLD') {
      allTrades.push({ bot: match.bot1Name, botId: match.bot1Id, ...trade1 });
    }
    if (trade2.action !== 'HOLD') {
      allTrades.push({ bot: match.bot2Name, botId: match.bot2Id, ...trade2 });
    }

    // For display PnL: include unrealized if in position
    const displayPnl1 = bot1Pnl + (trade1.unrealizedPnl || 0);
    const displayPnl2 = bot2Pnl + (trade2.unrealizedPnl || 0);

    // Determine status
    let status = 'fighting';
    if (bot1Hp <= 0 || bot2Hp <= 0) {
      status = 'ko';
    }

    // Update live currentMatch state (preserve bettingMatchId for betting panel)
    const currentMatch = {
      matchOrder: match.matchOrder,
      totalMatches: state.rounds[roundNum]?.length || 4,
      round: roundNum,
      token: token.symbol,
      priceMode: useRealPrices ? 'real' : 'random',
      bettingMatchId,
      bot1: {
        id: match.bot1Id,
        name: match.bot1Name,
        hp: Math.round(bot1Hp),
        maxHp: MAX_HP,
        pnl: `${displayPnl1 >= 0 ? '+' : ''}${displayPnl1.toFixed(2)}%`,
        lastTrade: trade1,
        ai_model: bot1AiModel,
        trading_style: bot1Style,
        position: bot1State.position ? bot1State.position.side : null,
      },
      bot2: {
        id: match.bot2Id,
        name: match.bot2Name,
        hp: Math.round(bot2Hp),
        maxHp: MAX_HP,
        pnl: `${displayPnl2 >= 0 ? '+' : ''}${displayPnl2.toFixed(2)}%`,
        lastTrade: trade2,
        ai_model: bot2AiModel,
        trading_style: bot2Style,
        position: bot2State.position ? bot2State.position.side : null,
      },
      trades: allTrades.slice(-MAX_TRADES_IN_STATE),
      tradeCount: allTrades.length,
      timeLeft,
      totalTime: MATCH_DURATION_SEC,
      status,
    };

    state.currentMatch = currentMatch;
    saveState(state);

    // Check for KO
    if (bot1Hp <= 0 || bot2Hp <= 0) {
      const koMsg = bot1Hp <= 0
        ? `💥 KO! ${match.bot2Name} knocked out ${match.bot1Name}!`
        : `💥 KO! ${match.bot1Name} knocked out ${match.bot2Name}!`;
      log(koMsg);
      break;
    }

    // Wait for next trade tick
    const interval = randomInt(TRADE_INTERVAL_MIN, TRADE_INTERVAL_MAX);
    await sleep(interval);
  }

  // Close any open positions at match end
  if (useRealPrices) {
    const finalPrice = await fetchTokenPrice(token.address);
    if (finalPrice) {
      const END_LEVERAGE = 100;
      for (const [botSt, label] of [[bot1State, 'bot1'], [bot2State, 'bot2']]) {
        if (botSt.position) {
          const diff = finalPrice - botSt.position.entryPrice;
          const pct = (diff / botSt.position.entryPrice) * 100;
          const pnl = (botSt.position.side === 'LONG' ? pct : -pct) * END_LEVERAGE;
          if (label === 'bot1') bot1Pnl += pnl;
          else bot2Pnl += pnl;
          botSt.position = null;
        }
      }
    }
  }

  // Determine winner
  let winnerId;
  if (bot1Hp <= 0 && bot2Hp > 0) {
    winnerId = match.bot2Id;
  } else if (bot2Hp <= 0 && bot1Hp > 0) {
    winnerId = match.bot1Id;
  } else {
    // Both alive — whoever has higher PnL wins
    winnerId = bot1Pnl >= bot2Pnl ? match.bot1Id : match.bot2Id;
  }

  const winnerName = winnerId === match.bot1Id ? match.bot1Name : match.bot2Name;
  const loserName = winnerId === match.bot1Id ? match.bot2Name : match.bot1Name;

  log(`✅ Match ${match.matchOrder} result: ${winnerName} defeats ${loserName}`);
  log(`   ${match.bot1Name}: HP ${Math.round(bot1Hp)} | PnL ${bot1Pnl >= 0 ? '+' : ''}${bot1Pnl.toFixed(2)}%`);
  log(`   ${match.bot2Name}: HP ${Math.round(bot2Hp)} | PnL ${bot2Pnl >= 0 ? '+' : ''}${bot2Pnl.toFixed(2)}%`);

  // Update match record
  match.winnerId = winnerId;
  match.status = 'finished';
  match.result = {
    bot1Hp: Math.round(bot1Hp),
    bot2Hp: Math.round(bot2Hp),
    bot1Pnl: parseFloat(bot1Pnl.toFixed(2)),
    bot2Pnl: parseFloat(bot2Pnl.toFixed(2)),
    totalTrades: allTrades.length,
    ko: bot1Hp <= 0 || bot2Hp <= 0,
  };

  // Mark currentMatch as finished briefly
  state.currentMatch = {
    ...state.currentMatch,
    status: 'finished',
    winner: { id: winnerId, name: winnerName },
    timeLeft: 0,
  };
  saveState(state);

  // Resolve betting pool and collect fees
  const winningSide = winnerId === match.bot1Id ? 'A' : 'B';
  try {
    const resolveResult = await betting.resolveBettingPool(bettingMatchId, winningSide);
    if (resolveResult.success) {
      log(`   🎯 Betting pool resolved: ${winningSide} wins`);
      
      // Collect platform fees
      const feesResult = await betting.collectPoolFees(bettingMatchId);
      if (feesResult.success && !feesResult.alreadyCollected) {
        log(`   💵 Platform fees collected`);
      }
    }
  } catch (e) {
    log(`   ⚠️ Betting pool resolve/fees failed: ${e.message}`);
  }

  // Update Supabase: resolve battle
  if (battleId) {
    try {
      // Find the battle for this room
      const battles = await supabaseQuery('battles', `?room_id=eq.${battleId}&select=id&order=created_at.desc&limit=1`);
      if (battles && battles[0]) {
        await supabasePatch('battles', `id=eq.${battles[0].id}`, {
          status: 'resolved',
          winner_id: winnerId,
          actual_x: parseFloat((1.0 + (bot1Pnl + bot2Pnl) / 200).toFixed(4)),
        });
      }
      await supabasePatch('rooms', `id=eq.${battleId}`, { status: 'finished' });
    } catch (e) {
      log(`⚠️ Failed to update Supabase battle result: ${e.message}`);
    }
  }

  // Resolve tournament bets for this match
  try {
    const betMatchId = `${roundNum}_${match.matchOrder}_${state.id}`;
    const res = await fetch('http://localhost:3000/api/tournament/bet/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchId: betMatchId,
        winningSide: winnerId === match.bot1Id ? 'A' : 'B',
      }),
    });
    const result = await res.json();
    if (result.resolved > 0) {
      log(`💰 Bets resolved: ${result.resolved} bets, pool ${result.totalPool} SOL`);
    }
  } catch (e) {
    log(`⚠️ Bet resolve error: ${e.message}`);
  }

  return winnerId;
}

// ============================================
// ROUND MANAGEMENT
// ============================================

async function runRound(state, roundNum) {
  const roundNames = { 1: 'Quarter-Finals', 2: 'Semi-Finals', 3: 'FINAL' };
  const roundName = roundNames[roundNum] || `Round ${roundNum}`;
  
  log(`\n🔔 Starting ${roundName}!`);
  
  const matches = state.rounds[roundNum];
  
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    
    if (match.status === 'finished') {
      log(`   Match ${match.matchOrder} already finished, skipping`);
      continue;
    }

    if (shuttingDown) return;

    // Simulate the match (this takes ~3 min)
    await simulateMatch(state, roundNum, match);
    
    // Save after each match — keep 'finished' status visible for 15s so frontend can show victory animation
    saveState(state);
    log(`🏆 Victory screen for 15s...`);
    await sleep(15000);

    // Pause between matches (unless it's the last one in the round)
    if (i < matches.length - 1 && !shuttingDown) {
      log(`⏳ Next match in ${PAUSE_BETWEEN_MATCHES / 1000}s...`);
      state.currentMatch = { status: 'intermission', nextIn: PAUSE_BETWEEN_MATCHES / 1000 };
      saveState(state);
      await sleep(PAUSE_BETWEEN_MATCHES);
    }
  }
}

function createNextRound(state, fromRound) {
  const matches = state.rounds[fromRound];
  const nextRound = fromRound + 1;
  
  const winners = matches.map(m => ({
    id: m.winnerId,
    name: m.winnerId === m.bot1Id ? m.bot1Name : m.bot2Name,
  }));

  const nextMatches = [];
  for (let i = 0; i < winners.length; i += 2) {
    if (i + 1 < winners.length) {
      nextMatches.push({
        matchOrder: nextMatches.length + 1,
        bot1Id: winners[i].id,
        bot1Name: winners[i].name,
        bot2Id: winners[i + 1].id,
        bot2Name: winners[i + 1].name,
        winnerId: null,
        battleId: null,
        status: 'pending',
      });
    }
  }

  state.rounds[nextRound] = nextMatches;
  state.currentRound = nextRound;
  saveState(state);

  return nextMatches;
}

// ============================================
// MAIN PERPETUAL LOOP
// ============================================

let shuttingDown = false;

async function perpetualLoop() {
  log('🚀 Perpetual Tournament Engine started!');
  log(`   Match duration: ${MATCH_DURATION_SEC}s`);
  log(`   Trade interval: ${TRADE_INTERVAL_MIN}-${TRADE_INTERVAL_MAX}ms`);
  log(`   Pauses: matches=${PAUSE_BETWEEN_MATCHES / 1000}s, rounds=${PAUSE_BETWEEN_ROUNDS / 1000}s, tournaments=${PAUSE_BETWEEN_TOURNAMENTS / 1000}s`);
  log(`   OpenRouter LLM: ${OPENROUTER_API_KEY ? '✅ ENABLED' : '❌ DISABLED (no API key)'}`);

  // Initialize betting integration
  const bettingStatus = betting.getStatus();
  log(`   Betting: ${bettingStatus.enabled ? 'ENABLED' : 'DISABLED'} (${bettingStatus.network})`);
  if (bettingStatus.enabled) {
    const bettingOk = await betting.initializeBetting();
    if (!bettingOk) {
      log('   ⚠️ Betting initialization failed, continuing without betting');
    }
  }

  while (!shuttingDown) {
    try {
      // Check existing state
      let state = loadState();

      // If no active tournament, or last one is finished → create new
      if (!state || state.status === 'finished') {
        if (state && state.status === 'finished') {
          const leagueName = state.league === 'nfa' ? 'NFA League' : 'Open';
          log(`\n🏁 Previous tournament finished (${leagueName}). Champion: ${state.champion?.name || 'Unknown'}`);
          
          // Reset HP for all active NPC bots between tournaments
          try {
            log('🔄 Resetting HP for all active bots...');
            await supabasePatch('bots', '?is_npc=eq.true&is_active=eq.true', { hp: 100 });
            log('✅ All bots HP reset to 100');
          } catch (err) {
            log(`⚠️ HP reset failed: ${err.message}`);
          }
          
          log(`⏳ New tournament in ${PAUSE_BETWEEN_TOURNAMENTS / 1000}s...`);
          state.currentMatch = { status: 'new_tournament_countdown', nextIn: PAUSE_BETWEEN_TOURNAMENTS / 1000 };
          saveState(state);
          await sleep(PAUSE_BETWEEN_TOURNAMENTS);
        }

        if (shuttingDown) break;

        // Alternate between NFA League and Free Arena tournaments
        // Try NFA-only tournament first (if enough NFA bots exist)
        let tryNFA = (tournamentCounter + nfaTournamentCounter) % 3 === 2; // every 3rd tournament
        if (tryNFA) {
          log('🏅 Attempting NFA League tournament...');
          state = await createNewTournament(true);
          if (!state) {
            log('📉 Not enough NFA bots, falling back to Free Arena');
          }
        }
        
        // If NFA tournament wasn't created (or not trying), create normal tournament
        if (!state || state.status === 'finished') {
          state = await createNewTournament(false);
        }
        
        if (!state) {
          // Not enough bots, wait and retry
          await sleep(30000);
          continue;
        }
      }

      // Run rounds
      const startRound = state.currentRound;
      for (let round = startRound; round <= state.totalRounds; round++) {
        if (shuttingDown) break;

        // Ensure round matches exist
        if (!state.rounds[round]) {
          createNextRound(state, round - 1);
          state = loadState(); // refresh
        }

        // Run all matches in this round
        await runRound(state, round);

        if (shuttingDown) break;

        // Check if we need to advance
        const allFinished = state.rounds[round].every(m => m.status === 'finished');
        if (!allFinished) {
          logError(`Round ${round} has unfinished matches, something went wrong`);
          break;
        }

        if (round < state.totalRounds) {
          // Advance to next round
          log(`\n⏳ Next round in ${PAUSE_BETWEEN_ROUNDS / 1000}s...`);
          state.currentMatch = { status: 'round_break', nextIn: PAUSE_BETWEEN_ROUNDS / 1000 };
          saveState(state);
          await sleep(PAUSE_BETWEEN_ROUNDS);

          createNextRound(state, round);
          state = loadState();
        } else {
          // Tournament complete!
          const finalMatch = state.rounds[round][0];
          const champion = state.participants.find(p => p.id === finalMatch.winnerId);
          state.status = 'finished';
          state.champion = champion;
          state.finishedAt = new Date().toISOString();
          state.currentMatch = {
            status: 'champion_crowned',
            champion: champion,
          };
          saveState(state);

          log(`\n🏆🏆🏆 TOURNAMENT CHAMPION: ${champion?.name || 'Unknown'} 🏆🏆🏆`);
        }
      }

    } catch (err) {
      logError(`Main loop error: ${err.message}`);
      logError(err.stack);
      // Wait before retrying to avoid tight error loops
      await sleep(10000);
    }
  }

  log('👋 Perpetual Tournament Engine stopped gracefully.');
}

// ============================================
// GRACEFUL SHUTDOWN
// ============================================

function shutdown(signal) {
  log(`\n🛑 Received ${signal}, shutting down gracefully...`);
  shuttingDown = true;
  
  // Save state with shutdown marker
  try {
    const state = loadState();
    if (state && state.currentMatch) {
      state.currentMatch.status = 'paused';
      state.currentMatch.pausedAt = new Date().toISOString();
      saveState(state);
    }
  } catch (e) {
    // ignore
  }

  // Force exit after 10 seconds if still running
  setTimeout(() => {
    log('⚠️ Forced exit after timeout');
    process.exit(0);
  }, 10000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ============================================
// START
// ============================================

perpetualLoop().catch(err => {
  logError(`Fatal error: ${err.message}`);
  logError(err.stack);
  process.exit(1);
});
