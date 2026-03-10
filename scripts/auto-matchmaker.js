#!/usr/bin/env node

// Load env
const fs = require('fs');
const envPath = require('path').join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [key, ...val] = line.split('=');
    if (key && !key.startsWith('#')) {
      let v = val.join('=').trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      process.env[key.trim()] = v;
    }
  });
}

/**
 * GemBots Auto-Matchmaker v5
 * 
 * Now with real strategies, webhook support, NFA strategy integration, and LEAGUES:
 * - NFA-linked bots: predictions modified by on-chain strategy params
 * - Preset strategy bots: auto-generate predictions via strategies
 * - API bots with webhook: send webhook, wait 30s for prediction
 * - API bots without webhook: use preset strategy or fallback 1.0x
 * - LEAGUES: "Free Arena" (all bots) and "NFA League" (nfa_id IS NOT NULL)
 *   - NFA League gives 1.5x ELO for wins
 *   - Every 3rd matchmaking cycle is NFA League (if ≥4 NFA bots)
 */

const path = require('path');
const { getNFAModifiedPrediction, getCacheStats } = require('./lib/nfa-strategy-adapter');
const { getProvider } = require('./lib/ai-provider-shim');

// ---- Market Data for Training Dataset ----
const BINANCE_SYMBOLS = {
  BTC: 'BTCUSDT', SOL: 'SOLUSDT', ETH: 'ETHUSDT', BNB: 'BNBUSDT',
  WIF: 'WIFUSDT', BONK: 'BONKUSDT', RENDER: 'RENDERUSDT', BOME: 'BOMEUSDT',
  JTO: 'JTOUSDT', CAKE: 'CAKEUSDT', LINK: 'LINKUSDT', ADA: 'ADAUSDT',
  XRP: 'XRPUSDT', PEPE: 'PEPEUSDT',
};
const BYBIT_SYMBOLS = { MEW: 'MEWUSDT', POPCAT: 'POPCATUSDT' };

// Cache prices for 30s to avoid hammering APIs
const priceCache = {};
const PRICE_CACHE_TTL = 30000;

async function fetchMarketContext(tokenSymbol) {
  const now = Date.now();
  const cacheKey = tokenSymbol;
  if (priceCache[cacheKey] && (now - priceCache[cacheKey].ts) < PRICE_CACHE_TTL) {
    return priceCache[cacheKey].data;
  }

  try {
    let price = null;
    const binanceSym = BINANCE_SYMBOLS[tokenSymbol];
    const bybitSym = BYBIT_SYMBOLS[tokenSymbol];

    if (binanceSym) {
      // Fetch current price + 1h klines from Binance
      const [tickerRes, klineRes] = await Promise.all([
        fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${binanceSym}`).then(r => r.json()).catch(() => null),
        fetch(`https://api.binance.com/api/v3/klines?symbol=${binanceSym}&interval=1h&limit=2`).then(r => r.json()).catch(() => null),
      ]);

      if (tickerRes && tickerRes.lastPrice) {
        price = parseFloat(tickerRes.lastPrice);
        const price1hAgo = klineRes && klineRes[0] ? parseFloat(klineRes[0][1]) : null; // open of previous 1h candle
        const volume = tickerRes.volume ? parseFloat(tickerRes.volume) : null;
        const quoteVolume = tickerRes.quoteVolume ? parseFloat(tickerRes.quoteVolume) : null;

        // BTC price (always from Binance)
        let btcPrice = null;
        if (tokenSymbol !== 'BTC') {
          const btcTicker = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT').then(r => r.json()).catch(() => null);
          btcPrice = btcTicker ? parseFloat(btcTicker.price) : null;
        } else {
          btcPrice = price;
        }

        const ctx = {
          market_price: price,
          market_price_1h_ago: price1hAgo,
          market_price_24h_ago: tickerRes.openPrice ? parseFloat(tickerRes.openPrice) : null,
          market_btc_price: btcPrice,
          market_volume_ratio: quoteVolume && tickerRes.weightedAvgPrice ? 1.0 : null, // simplified
        };
        priceCache[cacheKey] = { ts: now, data: ctx };
        return ctx;
      }
    } else if (bybitSym) {
      const tickerRes = await fetch(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${bybitSym}`).then(r => r.json()).catch(() => null);
      if (tickerRes?.result?.list?.[0]) {
        const t = tickerRes.result.list[0];
        price = parseFloat(t.lastPrice);
        const btcTicker = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT').then(r => r.json()).catch(() => null);

        const ctx = {
          market_price: price,
          market_price_1h_ago: null,
          market_price_24h_ago: t.prevPrice24h ? parseFloat(t.prevPrice24h) : null,
          market_btc_price: btcTicker ? parseFloat(btcTicker.price) : null,
          market_volume_ratio: null,
        };
        priceCache[cacheKey] = { ts: now, data: ctx };
        return ctx;
      }
    }
  } catch (e) {
    // Silent fail — market data is optional, battles still work without it
  }
  return null;
}

// ---- League System ----
const NFA_ELO_MULTIPLIER = 1.5;     // NFA League gives 1.5x ELO per win
const NFA_LEAGUE_CYCLE = 3;          // Every 3rd cycle is NFA League
const MIN_NFA_BOTS_FOR_LEAGUE = 4;   // Minimum NFA bots to run NFA League
let matchmakeCycleCount = 0;          // Counter for league cycling

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Default intervals (normal mode)
const DEFAULT_CHECK_INTERVAL = 30000;
const DEFAULT_MIN_ACTIVE_BATTLES = 10;
const DEFAULT_DURATIONS = [1, 1, 1, 60, 60, 1440]; // weighted: 50% short, 33% mid, 17% long

// Launch Mode config file path
const LAUNCH_MODE_FILE = path.join(__dirname, '..', 'data', 'launch-mode.json');

/**
 * Read launch mode config from data/launch-mode.json
 * Falls back to env LAUNCH_MODE=true/false if file doesn't exist
 * Re-reads on every call so changes are picked up without restart
 */
function getLaunchModeConfig() {
  try {
    // Clear require cache to re-read file each time
    delete require.cache[require.resolve(LAUNCH_MODE_FILE)];
    const config = require(LAUNCH_MODE_FILE);
    return {
      enabled: config.enabled === true,
      checkInterval: config.check_interval_ms || 15000,
      minActiveBattles: config.min_active_battles || 20,
      durations: config.battle_durations || [1, 1, 1, 1, 1, 1],
      announceTelegram: config.announce_telegram !== false,
    };
  } catch {
    // File doesn't exist or is invalid — fall back to env
    const envEnabled = process.env.LAUNCH_MODE === 'true';
    return {
      enabled: envEnabled,
      checkInterval: 15000,
      minActiveBattles: 20,
      durations: [1, 1, 1, 1, 1, 1],
      announceTelegram: true,
    };
  }
}

// Track launch mode state transitions for logging
let _lastLaunchModeState = null;

const CHECK_INTERVAL = DEFAULT_CHECK_INTERVAL; // Used for initial interval; loop uses dynamic interval

// ---- Strategy engine (mirrors src/lib/strategies.ts) ----

function clamp(value, min, max) {
  return parseFloat(Math.max(min, Math.min(max, value)).toFixed(2));
}

function trendFollower(token) {
  const change = token.price_change_1h || 0;
  if (change > 50) return clamp(2.5 + (change - 50) / 100, 2.5, 3.5);
  if (change > 20) return clamp(1.8 + (change - 20) / 50, 1.8, 2.5);
  if (change > 5) return clamp(1.3 + (change - 5) / 30, 1.3, 1.8);
  if (change > -5) return clamp(0.9 + change / 20, 0.85, 1.15);
  if (change > -20) return clamp(0.9 + change / 30, 0.6, 0.9);
  return clamp(0.6 + (change + 20) / 80, 0.3, 0.6);
}

function whaleWatcher(token) {
  const sm = token.smart_money || 0;
  const kol = token.kol_mentions || 0;
  const v2 = token.v2_score || 50;
  let base = 1.0;
  if (sm >= 5) base = 2.5 + (sm - 5) * 0.3;
  else if (sm >= 3) base = 1.8 + (sm - 3) * 0.35;
  else if (sm >= 1) base = 1.3 + (sm - 1) * 0.25;
  else base = 0.7 + Math.random() * 0.3;
  if (kol > 3) base *= 1.15;
  else if (kol > 0) base *= 1.05;
  if (v2 > 70) base *= 1.1;
  else if (v2 < 30) base *= 0.9;
  return clamp(base, 0.4, 5.0);
}

function chaosBot() {
  const r = Math.random();
  if (r < 0.3) return clamp(0.5 + Math.random() * 0.5, 0.5, 1.0);
  if (r < 0.7) return clamp(1.0 + Math.random() * 1.5, 1.0, 2.5);
  return clamp(2.5 + Math.random() * 2.5, 2.5, 5.0);
}

function meanReversion(token) {
  const change = token.price_change_1h || 0;
  if (change > 100) return clamp(0.3 + Math.random() * 0.2, 0.3, 0.5);
  if (change > 50) return clamp(0.5 + (100 - change) / 200, 0.5, 0.7);
  if (change > 20) return clamp(0.7 + (50 - change) / 100, 0.7, 0.95);
  if (change > -5) return clamp(0.95 + Math.random() * 0.1, 0.9, 1.1);
  if (change > -20) return clamp(1.2 + Math.abs(change) / 30, 1.2, 1.8);
  if (change > -50) return clamp(1.8 + Math.abs(change + 20) / 50, 1.8, 2.5);
  return clamp(2.0 + Math.random() * 1.0, 2.0, 3.0);
}

function smartAI(token) {
  const change = token.price_change_1h || 0;
  const sm = token.smart_money || 0;
  const v2 = token.v2_score || 50;
  const risk = token.risk_score || 50;
  const kol = token.kol_mentions || 0;
  const holders = token.holders || 0;
  const liquidity = token.liquidity || 0;
  const age = token.age_minutes || 60;

  let trend = change > 0 ? 1.0 + Math.min(change, 100) / 100 : 1.0 + Math.max(change, -80) / 200;
  let smComp = sm >= 3 ? 1.5 + (sm - 3) * 0.2 : sm >= 1 ? 1.1 + (sm - 1) * 0.2 : 0.8;
  let qual = (100 - risk) / 80;
  if (v2 > 70) qual *= 1.2;
  else if (v2 < 30) qual *= 0.8;
  if (kol > 2) qual *= 1.1;
  let safety = 1.0;
  if (liquidity > 100000) safety = 1.15;
  else if (liquidity > 50000) safety = 1.05;
  else if (liquidity < 10000) safety = 0.85;
  if (age < 5) safety *= 0.9;
  if (holders > 1000) safety *= 1.05;
  else if (holders < 50) safety *= 0.9;

  const pred = trend * 0.4 + smComp * 0.25 + qual * 0.2 + safety * 0.15;
  const noise = (Math.random() - 0.5) * 0.15;
  return clamp(pred + noise, 0.3, 5.0);
}

const STRATEGY_MAP = {
  trend_follower: trendFollower,
  whale_watcher: whaleWatcher,
  chaos: chaosBot,
  mean_reversion: meanReversion,
  smart_ai: smartAI,
  // Legacy mappings
  aggressive: trendFollower,
  conservative: meanReversion,
  random: chaosBot,
  smart: smartAI,
};

// ---- Gemini API (Free fallback) ----

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

async function getGeminiPrediction(botName, token, durationMinutes) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
  const startTime = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const prompt = buildLLMPrompt(botName, token, durationMinutes);
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `You are a crypto prediction bot named ${botName}. Always respond with valid JSON only. No markdown.\n\n${prompt}` }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 300 },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const latencyMs = Date.now() - startTime;
    if (!response.ok) throw new Error(`Gemini API error ${response.status}`);
    const data = await response.json();
    const content = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    if (!content) throw new Error('Empty Gemini response');
    let parsed;
    try { parsed = JSON.parse(content); } catch {
      const m = content.match(/\{[\s\S]*?\}/);
      if (m) parsed = JSON.parse(m[0]); else throw new Error('Failed to parse Gemini response');
    }
    const prediction = clamp(Number(parsed.prediction) || 1.0, 0.1, 100.0);
    const confidence = Math.max(0, Math.min(100, Number(parsed.confidence) || 50));
    console.log(`  🤖 Gemini [${botName}] → ${prediction}x (conf: ${confidence}%) | ${latencyMs}ms`);
    return prediction;
  } catch (error) {
    clearTimeout(timeout);
    console.error(`  ❌ Gemini error [${botName}]: ${error.message} (${Date.now() - startTime}ms)`);
    throw error;
  }
}

// ---- OpenRouter LLM Prediction ----

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_TIMEOUT_MS = 30000;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

function formatNumber(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(2)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(2)}K`;
  return (n || 0).toFixed(2);
}

function buildLLMPrompt(botName, token, durationMinutes) {
  const timeframe = durationMinutes <= 1
    ? '1 minute'
    : durationMinutes <= 60
    ? `${durationMinutes} minutes`
    : `${Math.round(durationMinutes / 60)} hours`;

  return `You are ${botName}, an expert crypto market analyst bot competing in a prediction arena.

Analyze the following market data for token $${token.symbol || 'UNKNOWN'} and predict the price multiplier over the next ${timeframe}.

## Market Data
- **Token:** $${token.symbol || 'UNKNOWN'}
- **Price Change (1h):** ${(token.price_change_1h || 0) > 0 ? '+' : ''}${(token.price_change_1h || 0).toFixed(2)}%
- **Price Change (24h):** ${(token.price_change_24h || 0) > 0 ? '+' : ''}${(token.price_change_24h || 0).toFixed(2)}%
- **24h Volume:** $${formatNumber(token.volume_24h || 0)}
- **Liquidity:** $${formatNumber(token.liquidity || 0)}
- **Market Cap:** $${formatNumber(token.market_cap || 0)}
- **Holders:** ${token.holders || 0}
- **Smart Money Signals:** ${token.smart_money || 0}
- **KOL Mentions:** ${token.kol_mentions || 0}
- **Battle Duration:** ${timeframe}

## Task
Predict the price multiplier (0.1 to 100.0). 1.0 = no change, 2.0 = doubles, 0.5 = halves.

Respond ONLY with valid JSON: {"prediction": <number>, "reasoning": "<brief>", "confidence": <0-100>}`;
}

// ---- Ollama Local LLM Prediction ----
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OLLAMA_TIMEOUT_MS = 180000; // 180s — local models need time for cold start + inference

/**
 * Parse prediction multiplier from Ollama text response.
 * Tries multiple formats: Nx, bare decimal, "up/down by N%".
 * Returns null if no valid prediction found.
 */
function parseOllamaPrediction(text) {
  // 1. Standard format: "1.0123x" or "Prediction: 0.9963x"
  const xMatch = text.match(/(\d+\.\d+)x/i);
  if (xMatch) return Number(xMatch[1]);

  // 2. "down by N%" → 1 - N/100
  const downMatch = text.match(/down\s+by\s+(\d+(?:\.\d+)?)%/i);
  if (downMatch) return 1 - Number(downMatch[1]) / 100;

  // 3. "up by N%" → 1 + N/100
  const upMatch = text.match(/up\s+by\s+(\d+(?:\.\d+)?)%/i);
  if (upMatch) return 1 + Number(upMatch[1]) / 100;

  // 4. Skip if it looks like an absolute price target (not a multiplier)
  const targetMatch = text.match(/target:?\s*\$?(\d+\.?\d*)/i);
  if (targetMatch && Number(targetMatch[1]) > 10) {
    // Likely an absolute price, not a multiplier — skip
  } else if (targetMatch) {
    return Number(targetMatch[1]);
  }

  // 5. Bare decimal number (0.80 - 2.00 range = likely a multiplier)
  const bareMatch = text.match(/\b(\d+\.\d+)\b/);
  if (bareMatch) {
    const val = Number(bareMatch[1]);
    if (val >= 0.1 && val <= 10.0) return val;
  }

  return null;
}

/**
 * Parse confidence from Ollama text response.
 * Returns 0-100 integer.
 */
function parseOllamaConfidence(text) {
  // Numeric: "Confidence: 75%" or "confidence: 85"
  const numMatch = text.match(/[Cc]onfidence:?\s*(\d+)\s*%?/i);
  if (numMatch) return Math.max(0, Math.min(100, Number(numMatch[1])));

  // Word-based confidence
  if (/\b(high\s+confidence|confidence:?\s*high|very\s+confident)\b/i.test(text)) return 80;
  if (/\b(moderate|medium|confidence:?\s*medium)\b/i.test(text)) return 60;
  if (/\b(low\s+confidence|confidence:?\s*low|not\s+confident)\b/i.test(text)) return 30;

  // Default: 50% (not 30%)
  return 50;
}

async function getOllamaPrediction(botName, ollamaModel, token, durationMinutes) {
  const startTime = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

  try {
    const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ollamaModel,
        messages: [
          { role: 'system', content: 'You are a crypto market prediction bot. Always respond with valid JSON only. No markdown formatting.' },
          { role: 'user', content: buildLLMPrompt(botName, token, durationMinutes) },
        ],
        stream: false,
        keep_alive: '30m',
        options: { temperature: 0.7, num_predict: 300 },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Ollama API error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    let content = (data.message?.content || '').trim();
    if (content.startsWith('```')) {
      content = content.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }
    const jsonMatch = content.match(/\{[\s\S]*?\}/);
    let prediction, confidence;
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      prediction = clamp(Number(parsed.prediction) || 1.0, 0.1, 100.0);
      confidence = Math.max(0, Math.min(100, Number(parsed.confidence) || 50));
    } else {
      // Fallback: parse fine-tuned model text format with multiple strategies
      prediction = parseOllamaPrediction(content);
      if (prediction === null) {
        // Retry with simplified prompt
        console.warn('⚠️ Parse failed for NemoTrader:', content.substring(0, 100));
        try {
          const retryResp = await fetch(`${OLLAMA_HOST}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: ollamaModel,
              messages: [
                { role: 'system', content: 'You are a crypto market prediction bot. Always respond with valid JSON only. No markdown formatting.' },
                { role: 'user', content: buildLLMPrompt(botName, token, durationMinutes) },
                { role: 'assistant', content },
                { role: 'user', content: 'Reply with ONLY a number like 0.95 or 1.05:' },
              ],
              stream: false,
              keep_alive: '30m',
              options: { temperature: 0.3, num_predict: 20 },
            }),
          });
          if (retryResp.ok) {
            const retryData = await retryResp.json();
            const retryContent = (retryData.message?.content || '').trim();
            prediction = parseOllamaPrediction(retryContent);
          }
        } catch (_) { /* retry failed, will throw below */ }
        if (prediction === null) throw new Error(`No parseable prediction in Ollama response: ${content.slice(0, 100)}`);
      }
      prediction = clamp(prediction, 0.1, 100.0);
      confidence = parseOllamaConfidence(content);
    }

    console.log(`  🏠 Ollama [${botName}] ${ollamaModel} → ${prediction}x (conf: ${confidence}%, ${latencyMs}ms)`);
    return prediction;
  } catch (e) {
    clearTimeout(timeout);
    throw new Error(`Ollama prediction failed: ${e.message}`);
  }
}

async function getOpenRouterPrediction(botName, modelId, token, durationMinutes) {
  if (!OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY not set');
  }

  const startTime = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);

  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://gembots.space',
        'X-Title': 'GemBots Arena',
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: 'system', content: 'You are a crypto market prediction bot. Always respond with valid JSON only. No markdown formatting.' },
          { role: 'user', content: buildLLMPrompt(botName, token, durationMinutes) },
        ],
        temperature: 0.7,
        max_tokens: 300,
        top_p: 0.9,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenRouter API error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const content = (data.choices?.[0]?.message?.content || '').trim();
    const tokensUsed = (data.usage?.prompt_tokens || 0) + (data.usage?.completion_tokens || 0);

    if (!content) throw new Error('Empty response from OpenRouter');

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      const jsonMatch = content.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error(`Failed to parse LLM response: ${content.substring(0, 200)}`);
      }
    }

    const prediction = clamp(Number(parsed.prediction) || 1.0, 0.1, 100.0);
    const confidence = Math.max(0, Math.min(100, Number(parsed.confidence) || 50));

    console.log(`  🤖 LLM [${modelId}] → ${prediction}x (conf: ${confidence}%) | ${tokensUsed} tok | ${latencyMs}ms`);
    return prediction;
  } catch (error) {
    clearTimeout(timeout);
    const latencyMs = Date.now() - startTime;
    if (error.name === 'AbortError') {
      console.error(`  ⏱️ LLM timeout [${modelId}] after ${latencyMs}ms`);
    } else {
      console.error(`  ❌ LLM error [${modelId}]: ${error.message} (${latencyMs}ms)`);
    }
    throw error;
  }
}

/**
 * Call NFA bot webhook for prediction.
 * Timeout: 10 seconds. Returns prediction number or null on failure.
 */
async function callNFAWebhook(bot, token, battleId, opponent) {
  if (!bot.webhook_url) return null;
  
  const payload = {
    event: 'battle_prediction',
    battle_id: battleId || `match_${Date.now()}`,
    token: {
      symbol: token.symbol || 'UNKNOWN',
      price: token.price || 0,
      change_1h: token.price_change_1h || 0,
      change_24h: token.price_change_24h || 0,
      volume_24h: token.volume_24h || 0,
      liquidity: token.liquidity || 0,
    },
    opponent: opponent ? {
      name: opponent.name || 'Unknown',
      elo: opponent.elo || 1000,
    } : { name: 'Unknown', elo: 1000 },
    deadline_seconds: 10,
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout
    const startMs = Date.now();
    
    const res = await fetch(bot.webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const latencyMs = Date.now() - startMs;
    
    if (res.ok) {
      const data = await res.json();
      if (data.prediction && typeof data.prediction === 'number') {
        const prediction = clamp(data.prediction, 0.1, 100);
        const confidence = data.confidence || 0;
        console.log(`  🌐 NFA Webhook [${bot.name}] → ${prediction}x (conf: ${(confidence * 100).toFixed(0)}%) | ${latencyMs}ms`);
        return prediction;
      }
    }
    console.log(`  ⚠️ NFA Webhook [${bot.name}] bad response (${res.status}) | ${latencyMs}ms`);
  } catch (e) {
    if (e.name === 'AbortError') {
      console.log(`  ⏱️ NFA Webhook [${bot.name}] timeout (10s)`);
    } else {
      console.log(`  ⚠️ NFA Webhook [${bot.name}] error: ${e.message}`);
    }
  }
  return null;
}

/**
 * Try to get LLM prediction with 1 retry, then fallback to formula strategy.
 * If bot has NFA webhook_url → try webhook first (10s timeout).
 * If bot has NFA strategy → apply NFA modifiers on top of base prediction.
 */
async function getPredictionWithLLMFallback(bot, strategy, token, customParams, durationMinutes, opponent) {
  // Priority 1: NFA webhook (user's own AI)
  if (bot.webhook_url && bot.nfa_id != null) {
    const webhookPrediction = await callNFAWebhook(bot, token, null, opponent);
    if (webhookPrediction !== null) {
      return webhookPrediction;
    }
    console.log(`  ⚠️ NFA Webhook fallback for ${bot.name} → using LLM/strategy`);
  }

  // Priority 2: Generic AIProvider (e.g., custom provider configured via AI_PROVIDER env)
  const provider = getProvider();
  if (provider.name === "Custom AI Provider" && process.env.AI_PROVIDER !== "example") { // Use custom provider when configured
    try {
      const prompt = buildLLMPrompt(bot.name, token, durationMinutes || 1);
      // AI strategy generation logic returns a string prediction directly.
      const rawPrediction = await provider.generateStrategy(prompt);
      // Assuming Provider returns JSON with prediction and confidence
      let parsed;
      try {
        parsed = JSON.parse(rawPrediction);
      } catch {
        const m = rawPrediction.match(/\{[\s\S]*?\}/);
        if (m) parsed = JSON.parse(m[0]);
        else throw new Error('Failed to parse AI provider response');
      }

      const prediction = clamp(Number(parsed.prediction) || 1.0, 0.1, 100.0);
      const confidence = Math.max(0, Math.min(100, Number(parsed.confidence) || 50));
      console.log(`  🔗 ${provider.name} [${bot.name}] → ${prediction}x (conf: ${confidence}%)`);
      return prediction;
    } catch (e) {
      console.log(`  ⚠️ ${provider.name} failed for ${bot.name}: ${e.message}, falling back to next provider`);
    }
  }


  let basePrediction;

  if (!bot.model_id || !OPENROUTER_API_KEY) {
    // No model_id or no API key — use formula strategy directly
    basePrediction = generatePrediction(strategy, token, customParams);
  } else if (bot.model_id.startsWith('ollama/')) {
    // Ollama local model — route to local Ollama instance
    const ollamaModel = bot.model_id.replace('ollama/', '');
    try {
      basePrediction = await getOllamaPrediction(bot.name, ollamaModel, token, durationMinutes || 1);
    } catch (error) {
      console.log(`  ⚠️ Ollama failed for ${bot.name}: ${error.message}, falling back to formula`);
      basePrediction = generatePrediction(strategy, token, customParams);
    }
  } else {
    // Fallback model chain: try bot's model → free fallbacks → formula
    const FALLBACK_MODELS = [
      'mistralai/mistral-nemo',
      'google/gemma-3-12b-it',
      'mistralai/mistral-small-24b-instruct-2501',
    ];
    const modelsToTry = [bot.model_id, ...FALLBACK_MODELS.filter(m => m !== bot.model_id)].slice(0, 3);
    let gotLLM = false;
    for (const modelId of modelsToTry) {
      try {
        basePrediction = await getOpenRouterPrediction(bot.name, modelId, token, durationMinutes || 1);
        gotLLM = true;
        break;
      } catch (error) {
        if (modelId === bot.model_id) {
          console.log(`  🔄 Primary model failed for ${bot.name} (${modelId}), trying fallback...`);
        } else {
          console.log(`  🔄 Fallback ${modelId} also failed for ${bot.name}`);
        }
      }
    }
    // Last resort: try Gemini before falling back to formula
    if (!gotLLM && GEMINI_API_KEY) {
      try {
        basePrediction = await getGeminiPrediction(bot.name, token, durationMinutes || 1);
        gotLLM = true;
      } catch (e) {
        console.log(`  ⚠️ Gemini also failed for ${bot.name}`);
      }
    }
    if (!gotLLM) {
      console.log(`  ⚠️ All LLMs failed for ${bot.name}, using formula strategy (${strategy})`);
      basePrediction = generatePrediction(strategy, token, customParams);
    }
  }

  // Apply NFA strategy modifiers if bot has linked NFA
  try {
    const result = await getNFAModifiedPrediction(bot.id, basePrediction, token);
    if (result.usedNFA) {
      console.log(`  🧬 NFA Strategy "${result.strategyName}" applied: ${basePrediction.toFixed(2)}x → ${result.prediction.toFixed(2)}x`);
      return result.prediction;
    }
  } catch (err) {
    // NFA adapter error — non-fatal, use base prediction
    console.log(`  ⚠️ NFA adapter error for ${bot.name}: ${err.message}`);
  }

  return basePrediction;
}

function generatePrediction(strategy, token, customParams = null) {
  const fn = STRATEGY_MAP[strategy] || smartAI;
  let prediction = fn(token);
  
  // Apply custom_params if provided
  if (customParams) {
    // Aggression: scales prediction away from 1.0 (higher = more extreme predictions)
    if (customParams.aggression !== undefined) {
      const a = customParams.aggression;
      prediction = 1.0 + (prediction - 1.0) * (0.5 + a); // 0.5x at aggression=0, 1.5x at aggression=1
    }
    
    // Mean reversion bias: pulls prediction toward 1.0 (price stays same)
    if (customParams.mean_reversion_bias !== undefined && customParams.mean_reversion_bias > 0) {
      const mrb = customParams.mean_reversion_bias;
      prediction = prediction * (1 - mrb) + 1.0 * mrb;
    }
    
    // Noise level: adds randomness
    const noise = (customParams.noise_level !== undefined ? customParams.noise_level : 0.15);
    prediction += (Math.random() - 0.5) * noise * 2;
    
    prediction = clamp(prediction, 0.3, 5.0);
  }
  
  return prediction;
}

// ---- Supabase helpers ----

async function supabaseRequest(path, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': options.prefer || 'return=representation',
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase error ${res.status}: ${text}`);
  }
  const contentType = res.headers.get('content-type');
  if (contentType && contentType.includes('json')) return res.json();
  return null;
}

async function getActiveBots() {
  // Only NPC bots — never auto-match human/guest bots
  // Include model_id for OpenRouter LLM predictions + nfa_id for league system + webhook_url for user AI
  return supabaseRequest('bots?hp=gt.0&is_npc=eq.true&select=*,model_id,nfa_id,evm_address,webhook_url&limit=60');
}

async function getUserBots() {
  return supabaseRequest('user_bots?is_active=eq.true&select=*');
}

async function getWaitingRooms() {
  return supabaseRequest('rooms?status=eq.waiting&select=*&order=created_at.asc');
}

async function getActiveBattles() {
  return supabaseRequest('battles?status=eq.active&select=bot1_id,bot2_id');
}

async function getTrendingToken() {
  try {
    const res = await fetch('http://localhost:3005/api/v1/market?limit=5');
    const data = await res.json();
    const tokens = data.tokens || [];
    if (tokens.length === 0) return { symbol: 'SOL', address: 'So11111111111111111111111111111111111111112' };
    return tokens[Math.floor(Math.random() * tokens.length)];
  } catch {
    return { symbol: 'SOL', address: 'So11111111111111111111111111111111111111112' };
  }
}

// Parse strategy data from user_bots (may be JSON with webhook_url)
function parseStrategy(strategyField) {
  if (!strategyField) return { strategy: 'smart_ai', webhook_url: null, is_api_bot: false, custom_params: null };
  try {
    const parsed = JSON.parse(strategyField);
    return {
      strategy: parsed.strategy || 'smart_ai',
      webhook_url: parsed.webhook_url || null,
      is_api_bot: parsed.is_api_bot || false,
      custom_params: parsed.custom_params || null,
    };
  } catch {
    return { strategy: strategyField, webhook_url: null, is_api_bot: false, custom_params: null };
  }
}

// Send webhook to API bot
async function sendWebhook(webhookUrl, payload) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout
    
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    
    if (res.ok) {
      const data = await res.json();
      if (data.prediction && typeof data.prediction === 'number') {
        return clamp(data.prediction, 0.1, 100);
      }
    }
  } catch (e) {
    console.log(`  ⚠️ Webhook failed: ${e.message}`);
  }
  return null; // Fallback
}

async function joinRoom(bot, room, strategy, token, preserveChallenger = false, customParams = null) {
  const prediction = await getPredictionWithLLMFallback(bot, strategy, token, customParams, room.duration_minutes || 1, null);
  const durationMs = (room.duration_minutes || 1) * 60 * 1000;
  const resolves_at = new Date(Date.now() + durationMs).toISOString();

  // Use host's prediction from the room if available (human-created challenge)
  // Otherwise generate one based on strategy
  let hostPrediction;
  if (room.host_prediction && room.host_prediction > 0) {
    hostPrediction = room.host_prediction;
  } else {
    const hostStrategy = await getHostStrategy(room.host_bot_id);
    hostPrediction = generatePrediction(hostStrategy, token);
  }

  // Use room's token if set (human chose a specific token), else use passed token
  const battleToken = (room.token_address && room.token_symbol)
    ? { address: room.token_address, symbol: room.token_symbol }
    : token;

  // Fetch market context for training data (non-blocking — battle still created if this fails)
  const marketCtx = await fetchMarketContext(battleToken.symbol || 'SOL');

  // Fetch host bot name
  let hostBotName = '';
  try {
    const hostBots = await supabaseRequest(`bots?id=eq.${room.host_bot_id}&select=name`);
    if (hostBots && hostBots[0]) hostBotName = hostBots[0].name || '';
  } catch {}

  // Create battle
  const battleData = {
    room_id: room.id,
    bot1_id: room.host_bot_id,
    bot2_id: bot.id,
    bot1_name: hostBotName,
    bot2_name: bot.name || '',
    bot1_prediction: hostPrediction,
    bot2_prediction: prediction,
    token_symbol: battleToken.symbol || 'SOL',
    token_address: battleToken.address || '',
    duration_minutes: room.duration_minutes || 1,
    status: 'active',
    resolves_at,
  };
  // Attach market data if available
  if (marketCtx) {
    if (marketCtx.market_price) battleData.market_price = marketCtx.market_price;
    if (marketCtx.market_price_1h_ago) battleData.market_price_1h_ago = marketCtx.market_price_1h_ago;
    if (marketCtx.market_price_24h_ago) battleData.market_price_24h_ago = marketCtx.market_price_24h_ago;
    if (marketCtx.market_btc_price) battleData.market_btc_price = marketCtx.market_btc_price;
    if (marketCtx.market_volume_ratio) battleData.market_volume_ratio = marketCtx.market_volume_ratio;
    if (marketCtx.market_price) battleData.entry_price = marketCtx.market_price;
  }
  // Bybit fallback for entry_price
  if (!battleData.entry_price && battleData.token_symbol) {
    try {
      const BYBIT_MAP = {BTC:'BTCUSDT',ETH:'ETHUSDT',SOL:'SOLUSDT',BNB:'BNBUSDT',WIF:'WIFUSDT'};
      const sym = BYBIT_MAP[battleData.token_symbol];
      if (sym) {
        const r = await fetch(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${sym}`).then(r=>r.json());
        if (r?.result?.list?.[0]?.lastPrice) battleData.entry_price = parseFloat(r.result.list[0].lastPrice);
      }
    } catch(e) {}
  }
  console.log(`  💰 Battle data entry_price: ${battleData.entry_price}, market_price: ${battleData.market_price}`);
  const [battle] = await supabaseRequest('battles', {
    method: 'POST',
    body: JSON.stringify(battleData),
  });

  // Update room status
  const roomPatch = { 
    status: 'in_battle',
    started_at: new Date().toISOString(),
  };
  if (!preserveChallenger) {
    roomPatch.challenger_bot_id = bot.id;
  }
  await supabaseRequest(`rooms?id=eq.${room.id}`, {
    method: 'PATCH',
    body: JSON.stringify(roomPatch),
    prefer: 'return=minimal',
  });

  const hostLabel = room.host_prediction ? 'human' : 'npc';
  console.log(`  ⚔️ ${bot.name} (${strategy} → ${prediction}x) vs Host (${hostLabel} → ${hostPrediction}x) | $${battleToken.symbol}`);

  // Send webhooks to API bots
  await sendBattleWebhooks(battle, bot, room, token);

  return battle;
}

async function getHostStrategy(botId) {
  try {
    const userBots = await supabaseRequest(`user_bots?bot_id=eq.${botId}&select=strategy`);
    if (userBots && userBots[0]) {
      const { strategy } = parseStrategy(userBots[0].strategy);
      return strategy;
    }
  } catch {}
  // For NPC bots, use random strategy
  const strategies = ['trend_follower', 'whale_watcher', 'smart_ai', 'chaos', 'mean_reversion'];
  return strategies[Math.floor(Math.random() * strategies.length)];
}

async function sendBattleWebhooks(battle, challengerBot, room, token) {
  if (!battle) return;
  
  // Check both bots for webhooks
  for (const botId of [room.host_bot_id, challengerBot.id]) {
    try {
      const userBots = await supabaseRequest(`user_bots?bot_id=eq.${botId}&select=strategy`);
      if (!userBots || !userBots[0]) continue;
      
      const { webhook_url, is_api_bot } = parseStrategy(userBots[0].strategy);
      if (!webhook_url || !is_api_bot) continue;

      // Get opponent info
      const opponentId = botId === room.host_bot_id ? challengerBot.id : room.host_bot_id;
      const opponentBots = await supabaseRequest(`bots?id=eq.${opponentId}&select=name,wins,losses`);
      const opponent = opponentBots?.[0] || { name: 'Unknown', wins: 0, losses: 0 };

      const payload = {
        event: 'battle_start',
        battle_id: battle.id,
        token: {
          symbol: token.symbol,
          address: token.address,
          price_change_1h: token.price_change_1h || 0,
          smart_money: token.smart_money || 0,
          v2_score: token.v2_score || 0,
        },
        opponent: {
          name: opponent.name,
          wins: opponent.wins,
          losses: opponent.losses,
        },
        deadline_seconds: 30,
      };

      console.log(`  📡 Sending webhook to bot ${botId}...`);
      const webhookPrediction = await sendWebhook(webhook_url, payload);
      
      if (webhookPrediction !== null) {
        // Update the bot's prediction in the battle
        const field = botId === battle.bot1_id ? 'bot1_prediction' : 'bot2_prediction';
        await supabaseRequest(`battles?id=eq.${battle.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ [field]: webhookPrediction }),
          prefer: 'return=minimal',
        });
        console.log(`  ✅ Webhook prediction: ${webhookPrediction}x`);
      } else {
        console.log(`  ⚠️ No webhook response, using preset prediction`);
      }
    } catch (e) {
      console.log(`  ⚠️ Webhook error for bot ${botId}: ${e.message}`);
    }
  }
}

async function matchmake() {
  console.log('\n🔄 Matchmake cycle starting...');
  try {
    const [allBots, userBotLinks, waitingRooms, activeBattles] = await Promise.all([
      getActiveBots(),
      getUserBots(),
      getWaitingRooms(),
      getActiveBattles(),
    ]);

    // Build strategy map from user_bots
    const botStrategyMap = {};
    const botCustomParams = {};
    (userBotLinks || []).forEach(ub => {
      const { strategy, custom_params } = parseStrategy(ub.strategy);
      botStrategyMap[ub.bot_id] = strategy;
      if (custom_params) botCustomParams[ub.bot_id] = custom_params;
    });

    // Find bots NOT currently in a battle
    const busyBotIds = new Set();
    (activeBattles || []).forEach(b => {
      busyBotIds.add(b.bot1_id);
      busyBotIds.add(b.bot2_id);
    });

    const freeBots = (allBots || []).filter(b => !busyBotIds.has(b.id));
    const freeRooms = [...(waitingRooms || [])];

    if (freeBots.length === 0) return;

    matchmakeCycleCount++;
    const isNFALeagueCycle = matchmakeCycleCount % NFA_LEAGUE_CYCLE === 0;
    const nfaBots = (allBots || []).filter(b => b.nfa_id != null);
    const hasEnoughNFA = nfaBots.length >= MIN_NFA_BOTS_FOR_LEAGUE;
    const currentLeague = (isNFALeagueCycle && hasEnoughNFA) ? 'NFA League' : 'Free Arena';

    const launchTag = getLaunchModeConfig().enabled ? ' 🚀' : '';
    const leagueTag = currentLeague === 'NFA League' ? ' 🏅 NFA League' : ' 🆓 Free Arena';
    console.log(`🤖 Matchmaker${launchTag}${leagueTag}: ${freeBots.length} free bots (${nfaBots.length} NFA), ${freeRooms.length} waiting rooms`);

    // Get a trending token for battles (fallback for bot-vs-bot rooms)
    const fallbackToken = await getTrendingToken();

    // Match free bots to waiting rooms (human challenges first)
    // Separate: pre-matched rooms (tournament/challenge with both bots set) vs open rooms
    const preMatchedRooms = freeRooms.filter(r => r.challenger_bot_id != null);
    const openRooms = freeRooms.filter(r => r.challenger_bot_id == null);

    // Auto-start pre-matched rooms (tournaments, direct challenges)
    for (const room of preMatchedRooms) {
      const challengerBot = (allBots || []).find(b => b.id === room.challenger_bot_id);
      if (!challengerBot) {
        if (room.challenger_bot_id === 56) console.log('  ❗ NemoTrader NOT found in allBots!');
        continue;
      }
      if (challengerBot.id === 56) console.log('  🧠 Processing NemoTrader room:', room.id, room.token_symbol);
      
      const strategy = botStrategyMap[challengerBot.id] || 'smart_ai';
      const token = (room.token_address && room.token_symbol)
        ? { address: room.token_address, symbol: room.token_symbol, price_change_1h: 0, smart_money: 0, v2_score: 0 }
        : fallbackToken;
      
      await joinRoom(challengerBot, room, strategy, token, true /* preserveChallenger */, botCustomParams[challengerBot.id] || null);
      console.log(`  🏆 Tournament/Challenge: ${challengerBot.name} vs Host ${room.host_bot_id}`);
    }

    for (const bot of freeBots) {
      if (openRooms.length === 0) break;

      const roomIdx = openRooms.findIndex(r => r.host_bot_id !== bot.id);
      if (roomIdx === -1) continue;

      const room = openRooms.splice(roomIdx, 1)[0];
      const strategy = botStrategyMap[bot.id] || 'smart_ai';
      
      // Use room's token if host specified one, otherwise fallback
      const token = (room.token_address && room.token_symbol)
        ? { address: room.token_address, symbol: room.token_symbol, price_change_1h: 0, smart_money: 0, v2_score: 0 }
        : fallbackToken;
      
      await joinRoom(bot, room, strategy, token, false, botCustomParams[bot.id] || null);
    }

    // === AUTO NPC BATTLES: keep at least MIN_ACTIVE_BATTLES going ===
    const launchConfig = getLaunchModeConfig();
    const MIN_ACTIVE_BATTLES = launchConfig.enabled ? launchConfig.minActiveBattles : DEFAULT_MIN_ACTIVE_BATTLES;
    const currentActive = (activeBattles || []).length;
    const needed = MIN_ACTIVE_BATTLES - currentActive - freeRooms.length; // account for rooms about to be matched
    
    if (needed > 0 && fallbackToken) {
      // Refresh free bots (some may have been used above)
      let stillFree = freeBots.filter(b => !busyBotIds.has(b.id));
      
      // In NFA League cycle, only use bots with NFA
      if (currentLeague === 'NFA League') {
        const nfaFree = stillFree.filter(b => b.nfa_id != null);
        if (nfaFree.length >= 2) {
          stillFree = nfaFree;
          console.log(`  🏅 NFA League: ${nfaFree.length} NFA bots available for matching`);
        } else {
          console.log(`  ⚠️ NFA League: not enough free NFA bots (${nfaFree.length}), falling back to Free Arena`);
        }
      }
      
      // Pick random durations for variety (Launch Mode = mostly short battles)
      const durations = launchConfig.enabled ? launchConfig.durations : DEFAULT_DURATIONS;
      
      // Create NPC vs NPC battles directly (pairs of free bots)
      const pairsToCreate = Math.min(Math.floor(stillFree.length / 2), needed);
      
      for (let i = 0; i < pairsToCreate; i++) {
        const bot1 = stillFree[i * 2];
        const bot2 = stillFree[i * 2 + 1];
        if (!bot1 || !bot2) break;

        const duration = durations[Math.floor(Math.random() * durations.length)];
        const strategy1 = botStrategyMap[bot1.id] || 'smart_ai';
        const strategy2 = botStrategyMap[bot2.id] || 'smart_ai';
        // Use LLM predictions for bots with model_id, formula fallback otherwise
        const pred1 = await getPredictionWithLLMFallback(bot1, strategy1, fallbackToken, botCustomParams[bot1.id] || null, duration, bot2);
        const pred2 = await getPredictionWithLLMFallback(bot2, strategy2, fallbackToken, botCustomParams[bot2.id] || null, duration, bot1);
        const durationMs = duration * 60 * 1000;
        const resolves_at = new Date(Date.now() + durationMs).toISOString();

        try {
          // Create room
          const [room] = await supabaseRequest('rooms', {
            method: 'POST',
            body: JSON.stringify({
              host_bot_id: bot1.id,
              status: 'in_battle',
              stake_amount: 0,
              token_address: fallbackToken.address,
              token_symbol: fallbackToken.symbol,
              duration_minutes: duration,
              started_at: new Date().toISOString(),
              challenger_bot_id: bot2.id,
            }),
          });

          // Determine if this is an NFA League match (both bots have NFA)
          const isNFAMatch = currentLeague === 'NFA League' && bot1.nfa_id != null && bot2.nfa_id != null;

          // Fetch market context for training data
          const npcMarketCtx = await fetchMarketContext(fallbackToken.symbol);

          // Create battle with league metadata + market context
          const npcBattleData = {
            room_id: room.id,
            bot1_id: bot1.id,
            bot2_id: bot2.id,
            bot1_name: bot1.name || '',
            bot2_name: bot2.name || '',
            bot1_prediction: pred1,
            bot2_prediction: pred2,
            token_symbol: fallbackToken.symbol,
            token_address: fallbackToken.address,
            duration_minutes: duration,
            status: 'active',
            resolves_at,
            league: isNFAMatch ? 'nfa' : 'free',
            elo_multiplier: isNFAMatch ? NFA_ELO_MULTIPLIER : 1.0,
          };
          if (npcMarketCtx) {
            if (npcMarketCtx.market_price) npcBattleData.market_price = npcMarketCtx.market_price;
            if (npcMarketCtx.market_price_1h_ago) npcBattleData.market_price_1h_ago = npcMarketCtx.market_price_1h_ago;
            if (npcMarketCtx.market_price_24h_ago) npcBattleData.market_price_24h_ago = npcMarketCtx.market_price_24h_ago;
            if (npcMarketCtx.market_btc_price) npcBattleData.market_btc_price = npcMarketCtx.market_btc_price;
            if (npcMarketCtx.market_volume_ratio) npcBattleData.market_volume_ratio = npcMarketCtx.market_volume_ratio;
            if (npcMarketCtx.market_price) npcBattleData.entry_price = npcMarketCtx.market_price;
          }
          // Bybit fallback for entry_price
          if (!npcBattleData.entry_price && npcBattleData.token_symbol) {
            try {
              const BYBIT_MAP = {BTC:'BTCUSDT',ETH:'ETHUSDT',SOL:'SOLUSDT',BNB:'BNBUSDT',WIF:'WIFUSDT'};
              const sym = BYBIT_MAP[npcBattleData.token_symbol];
              if (sym) {
                const r = await fetch(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${sym}`).then(r=>r.json());
                if (r?.result?.list?.[0]?.lastPrice) npcBattleData.entry_price = parseFloat(r.result.list[0].lastPrice);
              }
            } catch(e) {}
          }
          await supabaseRequest('battles', {
            method: 'POST',
            body: JSON.stringify(npcBattleData),
          });

          busyBotIds.add(bot1.id);
          busyBotIds.add(bot2.id);
          const dLabel = duration === 1 ? '⚡1m' : duration === 60 ? '🥊1h' : '🏆24h';
          const leagueLabel = isNFAMatch ? '🏅NFA' : '🆓Free';
          console.log(`  🤖 NPC Battle [${leagueLabel}]: ${bot1.name} (${pred1.toFixed(2)}x) vs ${bot2.name} (${pred2.toFixed(2)}x) | $${fallbackToken.symbol} ${dLabel}`);
        } catch (e) {
          console.error(`  ❌ Failed to create NPC battle: ${e.message}`);
        }
      }
      
      if (pairsToCreate > 0) {
        console.log(`  📊 Created ${pairsToCreate} NPC battles (target: ${MIN_ACTIVE_BATTLES}, was: ${currentActive})`);
      }
    }

  } catch (error) {
    console.error('Matchmaker error:', error.message);
  }
}

// Main loop with dynamic interval (supports Launch Mode hot-reload)
console.log('🎮 GemBots Auto-Matchmaker v6 started');
console.log(`   Real strategies enabled ✅`);
console.log(`   Webhook support enabled ✅`);
console.log(`   OpenRouter LLM predictions enabled ${OPENROUTER_API_KEY ? '✅' : '❌ (no API key)'}`);
console.log(`   NFA Strategy Adapter enabled ✅`);
console.log(`   NFA League System enabled ✅ (every ${NFA_LEAGUE_CYCLE}rd cycle, 1.5x ELO, min ${MIN_NFA_BOTS_FOR_LEAGUE} NFA bots)`);
console.log(`   Launch Mode support enabled ✅`);
console.log(`   Launch Mode config: ${LAUNCH_MODE_FILE}`);

const initialConfig = getLaunchModeConfig();
console.log(`   Launch Mode: ${initialConfig.enabled ? '🚀 ACTIVE' : '⏸️ OFF'}`);
console.log(`   Default interval: ${DEFAULT_CHECK_INTERVAL / 1000}s | Launch interval: ${initialConfig.checkInterval / 1000}s`);
_lastLaunchModeState = initialConfig.enabled;

async function mainLoop() {
  try {
  await matchmake();
  } catch(e) { console.error('❌ MATCHMAKE CRASH:', e.message, e.stack?.split('\n')[1]); }

  // Re-read launch mode config for next interval
  const config = getLaunchModeConfig();
  const interval = config.enabled ? config.checkInterval : DEFAULT_CHECK_INTERVAL;

  // Log state transitions
  if (config.enabled !== _lastLaunchModeState) {
    if (config.enabled) {
      console.log(`\n🚀🚀🚀 LAUNCH MODE ACTIVATED! Interval: ${interval / 1000}s, Min battles: ${config.minActiveBattles}`);
    } else {
      console.log(`\n⏸️ Launch Mode deactivated. Back to normal: ${interval / 1000}s interval, ${DEFAULT_MIN_ACTIVE_BATTLES} min battles`);
    }
    _lastLaunchModeState = config.enabled;
  }

  setTimeout(mainLoop, interval);
}

mainLoop();
