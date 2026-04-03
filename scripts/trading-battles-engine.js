#!/usr/bin/env node
/**
 * GemBots Trading Battles Engine
 * 
 * Creates new trading battles every 15 minutes using real AI models.
 * Fetches fresh market data from Bybit, pairs up bots, runs AI decisions.
 * 
 * PM2 Usage:
 *   pm2 start scripts/trading-battles-engine.js --name trading-battles --cwd ~/Projects/gembots
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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

const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(__dirname, '..', 'data', 'gembots.db');
const SNAPSHOTS_PATH = '/home/clawdbot/Projects/gembots-trader/data/market-snapshots.jsonl';
const FETCH_SNAPSHOTS_SCRIPT = '/tmp/fetch-market-snapshots.js';
const BATTLE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes (increased from 15 for volume growth)
const BATTLES_PER_SYMBOL = 3; // 3 pairs per symbol per cycle = 9 battles/cycle (~2592/day)
const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];

const MODEL_POOL = [
  'qwen/qwen3-235b-a22b-2507',
  'google/gemma-3-12b-it',
  'mistralai/mistral-nemo',
  'google/gemini-2.0-flash-lite-001',
  'meta-llama/llama-4-maverick',
  'deepseek/deepseek-r1',
  'mistralai/mistral-small-24b-instruct-2501',
  'openai/gpt-4.1-nano',
  'local/qwen3-30b',
];

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

const CHAINGPT_API_KEY = process.env.CHAINGPT_API_KEY;
const CHAINGPT_API_URL = 'https://api.chaingpt.org/chat/stream';
const CHAINGPT_BOT_NAME = '🧠 ChainGPT';

const OLLAMA_API_URL = 'http://100.70.191.97:11434/api/chat';
const OLLAMA_MODELS = ['qwen3:30b', 'qwen3.5:35b'];
const OLLAMA_BOT_NAME = '🖥️ Qwen3-Local';

const STRATEGY_DESCRIPTIONS = {
  momentum: `You are a MOMENTUM trader. Follow the trend aggressively. If price is rising → BUY with conviction. If falling → SELL. Use leverage 5-15x when trend is strong.`,
  trend_follower: `You are a TREND FOLLOWER. BUY in uptrends, SELL in downtrends. Use moderate leverage 3-8x.`,
  scalper: `You are a SCALPER. Quick trades, tight TP (0.1-0.3%) and SL (0.1-0.2%). High leverage 10-20x.`,
  swing: `You are a SWING trader. Large positions on high-conviction setups. TP 0.5-1.5%, SL 0.3-0.8%.`,
  contrarian: `You are a CONTRARIAN trader. Trade AGAINST the crowd. Price pumped hard → SELL; dumped → BUY.`,
};

function calculateEMA(values, period) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const multiplier = 2 / (period + 1);
  let ema = Number(values[0]);

  for (let i = 1; i < values.length; i++) {
    const value = Number(values[i]);
    if (!Number.isFinite(value)) continue;
    ema = (value - ema) * multiplier + ema;
  }

  return Number.isFinite(ema) ? ema : null;
}

function calculateRSI(values, period = 14) {
  if (!Array.isArray(values) || values.length < 2) return null;
  const gains = [];
  const losses = [];

  for (let i = 1; i < values.length; i++) {
    const change = Number(values[i]) - Number(values[i - 1]);
    if (!Number.isFinite(change)) continue;
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }

  if (gains.length === 0) return null;

  const sliceSize = Math.min(period, gains.length);
  const avgGain = gains.slice(-sliceSize).reduce((sum, value) => sum + value, 0) / sliceSize;
  const avgLoss = losses.slice(-sliceSize).reduce((sum, value) => sum + value, 0) / sliceSize;

  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;

  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateMACD(values, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }

  const fastMultiplier = 2 / (fastPeriod + 1);
  const slowMultiplier = 2 / (slowPeriod + 1);
  const signalMultiplier = 2 / (signalPeriod + 1);

  let fastEma = Number(values[0]);
  let slowEma = Number(values[0]);
  let signal = 0;
  const macdSeries = [];

  for (const rawValue of values) {
    const value = Number(rawValue);
    if (!Number.isFinite(value)) continue;

    fastEma = (value - fastEma) * fastMultiplier + fastEma;
    slowEma = (value - slowEma) * slowMultiplier + slowEma;

    const macd = fastEma - slowEma;
    macdSeries.push(macd);

    if (macdSeries.length === 1) {
      signal = macd;
    } else {
      signal = (macd - signal) * signalMultiplier + signal;
    }
  }

  if (macdSeries.length === 0) return null;

  const macd = macdSeries[macdSeries.length - 1];
  return {
    macd,
    signal,
    histogram: macd - signal,
  };
}

function getSnapshotFallback(price) {
  return {
    orderbook_imbalance: 0.5,
    rsi_14: 50,
    ema_9: price * 0.999,
    ema_21: price * 0.998,
    macd: 0,
    macd_signal: 0,
    funding_rate: 0,
    open_interest: 0,
  };
}

// ─── Snapshot fetch ────────────────────────────────────────────────────────

async function fetchAndSaveSnapshots() {
  const snapshots = new Map();

  for (const symbol of SYMBOLS) {
    try {
      const [tickerRes, klinesRes, fundingRes, openInterestRes, orderbookRes] = await Promise.all([
        fetch(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol}`),
        fetch(`https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=60&limit=20`),
        fetch(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${symbol}`),
        fetch(`https://api.bybit.com/v5/market/open-interest?category=linear&symbol=${symbol}&intervalTime=5min&limit=1`),
        fetch(`https://api.bybit.com/v5/market/orderbook?category=spot&symbol=${symbol}&limit=25`),
      ]);

      const [ticker, klines, funding, openInterest, orderbook] = await Promise.all([
        tickerRes.json(),
        klinesRes.json(),
        fundingRes.json(),
        openInterestRes.json(),
        orderbookRes.json(),
      ]);

      const tickerData = ticker?.result?.list?.[0];
      if (!tickerData) continue;

      const price = parseFloat(tickerData.lastPrice);
      const price_24h_pct = parseFloat(tickerData.price24hPcnt) * 100;
      const volume_24h = parseFloat(tickerData.volume24h);
      const fallback = getSnapshotFallback(price);

      let price_1h_pct = 0;
      let indicators = { ...fallback };

      try {
        const klineList = Array.isArray(klines?.result?.list) ? [...klines.result.list].reverse() : [];
        const closes = klineList
          .map(candle => parseFloat(candle?.[4]))
          .filter(value => Number.isFinite(value));

        if (klineList.length > 0) {
          const latestOpen = parseFloat(klineList[klineList.length - 1]?.[1]);
          if (Number.isFinite(latestOpen) && latestOpen > 0) {
            price_1h_pct = ((price - latestOpen) / latestOpen) * 100;
          }
        }

        if (closes.length >= 2) {
          const rsi = calculateRSI(closes, 14);
          const ema9 = calculateEMA(closes, 9);
          const ema21 = calculateEMA(closes, 21);
          const macd = calculateMACD(closes, 12, 26, 9);

          indicators = {
            ...indicators,
            rsi_14: Number.isFinite(rsi) ? rsi : fallback.rsi_14,
            ema_9: Number.isFinite(ema9) ? ema9 : fallback.ema_9,
            ema_21: Number.isFinite(ema21) ? ema21 : fallback.ema_21,
            macd: Number.isFinite(macd?.macd) ? macd.macd : fallback.macd,
            macd_signal: Number.isFinite(macd?.signal) ? macd.signal : fallback.macd_signal,
          };
        }
      } catch (indicatorError) {
        console.warn(`Indicator calculation failed for ${symbol}:`, indicatorError.message);
      }

      try {
        const fundingRate = parseFloat(funding?.result?.list?.[0]?.fundingRate);
        indicators.funding_rate = Number.isFinite(fundingRate) ? fundingRate : fallback.funding_rate;
      } catch (fundingError) {
        console.warn(`Funding rate fetch failed for ${symbol}:`, fundingError.message);
      }

      try {
        const oiItem = openInterest?.result?.list?.[0] || openInterest?.result?.list?.[0]?.openInterest;
        const openInterestValue = parseFloat(
          openInterest?.result?.list?.[0]?.openInterest ??
          openInterest?.result?.list?.[0]?.openInterestValue ??
          oiItem
        );
        indicators.open_interest = Number.isFinite(openInterestValue) ? openInterestValue : fallback.open_interest;
      } catch (openInterestError) {
        console.warn(`Open interest fetch failed for ${symbol}:`, openInterestError.message);
      }

      try {
        const bids = Array.isArray(orderbook?.result?.b) ? orderbook.result.b : [];
        const asks = Array.isArray(orderbook?.result?.a) ? orderbook.result.a : [];
        const bidVolume = bids.reduce((sum, level) => sum + (parseFloat(level?.[1]) || 0), 0);
        const askVolume = asks.reduce((sum, level) => sum + (parseFloat(level?.[1]) || 0), 0);
        const totalBook = bidVolume + askVolume;
        indicators.orderbook_imbalance = totalBook > 0 ? bidVolume / totalBook : fallback.orderbook_imbalance;
      } catch (orderbookError) {
        console.warn(`Orderbook fetch failed for ${symbol}:`, orderbookError.message);
      }

      const snap = {
        timestamp: new Date().toISOString(),
        symbol,
        price,
        price_1h_pct,
        price_24h_pct,
        volume_24h,
        orderbook_imbalance: indicators.orderbook_imbalance,
        rsi_14: indicators.rsi_14,
        ema_9: indicators.ema_9,
        ema_21: indicators.ema_21,
        macd: indicators.macd,
        macd_signal: indicators.macd_signal,
        funding_rate: indicators.funding_rate,
        open_interest: indicators.open_interest,
      };

      snapshots.set(symbol, snap);
      fs.appendFileSync(SNAPSHOTS_PATH, JSON.stringify(snap) + '\n');
    } catch (e) {
      console.error(`Failed to fetch ${symbol}:`, e.message);
    }
  }

  return snapshots;
}

// ─── AI Decision ───────────────────────────────────────────────────────────

async function getTradingDecision(modelId, snapshot, strategy) {
  const stratDesc = STRATEGY_DESCRIPTIONS[strategy] || STRATEGY_DESCRIPTIONS.momentum;
  const prompt = `${stratDesc}

Market data for ${snapshot.symbol}:
- Current price: $${snapshot.price}
- 1h change: ${snapshot.price_1h_pct?.toFixed(2)}%
- 24h change: ${snapshot.price_24h_pct?.toFixed(2)}%
- Volume 24h: $${(snapshot.volume_24h / 1e6)?.toFixed(1)}M
- RSI-14: ${snapshot.rsi_14}
- EMA9: ${snapshot.ema_9?.toFixed(2)}, EMA21: ${snapshot.ema_21?.toFixed(2)}
- MACD: ${snapshot.macd?.toFixed?.(4) || snapshot.macd || 'N/A'}, Signal: ${snapshot.macd_signal?.toFixed?.(4) || snapshot.macd_signal || 'N/A'}
- Funding Rate: ${snapshot.funding_rate?.toFixed?.(6) || snapshot.funding_rate || 'N/A'}
- Orderbook Imbalance: ${snapshot.orderbook_imbalance?.toFixed?.(4) || snapshot.orderbook_imbalance || 'N/A'}
- Open Interest: ${snapshot.open_interest ? (snapshot.open_interest / 1e6)?.toFixed(1) + 'M' : 'N/A'}

Make a trading decision for the next 15 minutes.
Respond ONLY with valid JSON (no markdown, no explanation outside JSON):
{"action":"BUY"|"SELL"|"HOLD","size":0.1-1.0,"leverage":1-20,"confidence":0.0-1.0,"take_profit":0.1-3.0,"stop_loss":0.1-2.0,"reasoning":"brief explanation"}`;

  const cleanJsonResponse = (raw) => {
    if (!raw) throw new Error('Empty OpenRouter response');
    let cleaned = String(raw).trim();
    // Strip Qwen3/DeepSeek thinking tags
    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    // Strip leading prose before first JSON brace
    const firstBrace = cleaned.indexOf('{');
    if (firstBrace > 0) cleaned = cleaned.substring(firstBrace);
    cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in OpenRouter response');
    cleaned = jsonMatch[0].replace(/,\s*([}\]])/g, '$1');

    // Fix unquoted keys (e.g. {action: "BUY"} -> {"action": "BUY"})
    cleaned = cleaned.replace(/([{,])\s*([a-zA-Z_]\w*)\s*:/g, '$1"$2":');
    // Fix single-quoted values
    cleaned = cleaned.replace(/:\s*'([^']*)'/g, ':"$1"');
    // Fix unquoted BUY/SELL/HOLD
    cleaned = cleaned.replace(/:\s*(BUY|SELL|HOLD)(\s*[,}])/g, ':"$1"$2');

    let normalized = '';
    let inString = false;
    let escaped = false;

    for (const ch of cleaned) {
      if (inString) {
        if (escaped) {
          normalized += ch;
          escaped = false;
          continue;
        }

        if (ch === '\\') {
          normalized += ch;
          escaped = true;
          continue;
        }

        if (ch === '"') {
          normalized += ch;
          inString = false;
          continue;
        }

        if (ch === '\n') {
          normalized += '\\n';
          continue;
        }

        if (ch === '\r') {
          normalized += '\\r';
          continue;
        }

        if (ch === '\t') {
          normalized += '\\t';
          continue;
        }

        if ((ch >= '\x00' && ch <= '\x08') || ch === '\x0B' || ch === '\x0C' || (ch >= '\x0E' && ch <= '\x1F') || ch === '\x7F') {
          continue;
        }

        normalized += ch;
      } else {
        normalized += ch;
        if (ch === '"') inString = true;
      }
    }

    return normalized;
  };

  const parseDecision = (raw) => {
    const d = JSON.parse(cleanJsonResponse(raw));
    return {
      action: d.action || 'HOLD',
      size: Math.min(1, Math.max(0.1, parseFloat(d.size) || 0.3)),
      leverage: Math.min(20, Math.max(1, parseInt(d.leverage) || 5)),
      confidence: Math.min(1, Math.max(0, parseFloat(d.confidence) || 0.5)),
      take_profit: Math.min(5, Math.max(0.1, parseFloat(d.take_profit) || 1.0)),
      stop_loss: Math.min(5, Math.max(0.1, parseFloat(d.stop_loss) || 0.5)),
      reasoning: d.reasoning || '',
    };
  };

  const requestDecision = async (temperature) => {
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
        max_tokens: 400,
        temperature,
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json();
    return parseDecision(data.choices?.[0]?.message?.content || '');
  };

  try {
    return await requestDecision(0.7);
  } catch (e) {
    if (e instanceof SyntaxError || /No JSON|control character|Unexpected token|Expected/i.test(e.message)) {
      console.warn(`AI decision parse failed for ${modelId}, retrying with temp 0.3:`, e.message);
      try {
        return await requestDecision(0.3);
      } catch (retryError) {
        console.warn(`AI retry failed for ${modelId}:`, retryError.message);
      }
    } else {
      console.warn(`AI decision failed for ${modelId}:`, e.message);
    }
  }

  return {
    action: 'HOLD',
    size: 0,
    leverage: 1,
    confidence: 0,
    take_profit: 0,
    stop_loss: 0,
    reasoning: 'OpenRouter API error — safe HOLD fallback'
  };
}

// ─── ChainGPT Decision ─────────────────────────────────────────────────────

async function getChainGPTDecision(snapshot, strategy) {
  const stratDesc = STRATEGY_DESCRIPTIONS[strategy] || STRATEGY_DESCRIPTIONS.momentum;
  const question = `${stratDesc}

Market data for ${snapshot.symbol}:
- Current price: ${snapshot.price}
- 1h change: ${snapshot.price_1h_pct?.toFixed(2)}%
- 24h change: ${snapshot.price_24h_pct?.toFixed(2)}%
- Volume 24h: ${(snapshot.volume_24h / 1e6)?.toFixed(1)}M
- RSI-14: ${snapshot.rsi_14}
- EMA9: ${snapshot.ema_9?.toFixed(2)}, EMA21: ${snapshot.ema_21?.toFixed(2)}
- MACD: ${snapshot.macd?.toFixed?.(4) || snapshot.macd || 'N/A'}, Signal: ${snapshot.macd_signal?.toFixed?.(4) || snapshot.macd_signal || 'N/A'}
- Funding Rate: ${snapshot.funding_rate?.toFixed?.(6) || snapshot.funding_rate || 'N/A'}
- Orderbook Imbalance: ${snapshot.orderbook_imbalance?.toFixed?.(4) || snapshot.orderbook_imbalance || 'N/A'}
- Open Interest: ${snapshot.open_interest ? (snapshot.open_interest / 1e6)?.toFixed(1) + 'M' : 'N/A'}

Make a trading decision for the next 15 minutes.
Respond ONLY with valid JSON:
{"action":"BUY"|"SELL"|"HOLD","size":0.1-1.0,"leverage":1-20,"confidence":0.0-1.0,"take_profit":0.1-3.0,"stop_loss":0.1-2.0,"reasoning":"brief explanation"}`;

  const cleanJsonResponse = (raw) => {
    if (!raw) throw new Error('Empty ChainGPT response');
    let cleaned = String(raw).trim();
    cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in ChainGPT response');
    cleaned = jsonMatch[0].replace(/,\s*([}\]])/g, '$1');

    // Fix unquoted keys (e.g. {action: "BUY"} -> {"action": "BUY"})
    cleaned = cleaned.replace(/([{,])\s*([a-zA-Z_]\w*)\s*:/g, '$1"$2":');
    // Fix single-quoted values
    cleaned = cleaned.replace(/:\s*'([^']*)'/g, ':"$1"');
    // Fix unquoted BUY/SELL/HOLD
    cleaned = cleaned.replace(/:\s*(BUY|SELL|HOLD)(\s*[,}])/g, ':"$1"$2');

    let normalized = '';
    let inString = false;
    let escaped = false;

    for (const ch of cleaned) {
      if (inString) {
        if (escaped) {
          normalized += ch;
          escaped = false;
          continue;
        }

        if (ch === '\\') {
          normalized += ch;
          escaped = true;
          continue;
        }

        if (ch === '"') {
          normalized += ch;
          inString = false;
          continue;
        }

        if (ch === '\n') {
          normalized += '\\n';
          continue;
        }

        if (ch === '\r') {
          normalized += '\\r';
          continue;
        }

        if (ch === '\t') {
          normalized += '\\t';
          continue;
        }

        if ((ch >= '\x00' && ch <= '\x08') || ch === '\x0B' || ch === '\x0C' || (ch >= '\x0E' && ch <= '\x1F') || ch === '\x7F') {
          continue;
        }

        normalized += ch;
      } else {
        normalized += ch;
        if (ch === '"') inString = true;
      }
    }

    return normalized;
  };

  const parseDecision = (raw) => {
    const d = JSON.parse(cleanJsonResponse(raw));
    return {
      action: d.action || 'HOLD',
      size: Math.min(1, Math.max(0.1, parseFloat(d.size) || 0.3)),
      leverage: Math.min(20, Math.max(1, parseInt(d.leverage) || 5)),
      confidence: Math.min(1, Math.max(0, parseFloat(d.confidence) || 0.5)),
      take_profit: Math.min(5, Math.max(0.1, parseFloat(d.take_profit) || 1.0)),
      stop_loss: Math.min(5, Math.max(0.1, parseFloat(d.stop_loss) || 0.5)),
      reasoning: d.reasoning || '',
    };
  };

  const requestDecision = async (temperature) => {
    const res = await fetch(CHAINGPT_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CHAINGPT_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'general_assistant',
        question,
        chatHistory: 'off',
        temperature,
      }),
    });

    if (!res.ok) throw new Error(`ChainGPT API ${res.status}`);
    const text = await res.text();
    return parseDecision(text);
  };

  try {
    return await requestDecision(0.7);
  } catch (e) {
    if (e instanceof SyntaxError || /No JSON|control character|Unexpected token|Expected/i.test(e.message)) {
      console.warn(`ChainGPT parse failed, retrying with temp 0.3:`, e.message);
      try {
        return await requestDecision(0.3);
      } catch (retryError) {
        console.warn(`ChainGPT retry failed:`, retryError.message);
      }
    } else {
      console.warn(`ChainGPT decision failed:`, e.message);
    }
  }

  return {
    action: 'HOLD',
    size: 0,
    leverage: 1,
    confidence: 0,
    take_profit: 0,
    stop_loss: 0,
    reasoning: 'ChainGPT API error — safe HOLD fallback'
  };
}

// ─── Ollama Decision ───────────────────────────────────────────────────────

async function getOllamaDecision(snapshot, strategy) {
  const stratDesc = STRATEGY_DESCRIPTIONS[strategy] || STRATEGY_DESCRIPTIONS.momentum;
  const ollamaModel = OLLAMA_MODELS[Math.floor(Math.random() * OLLAMA_MODELS.length)];
  const prompt = `${stratDesc}

Market data for ${snapshot.symbol}:
- Current price: ${snapshot.price}
- 1h change: ${snapshot.price_1h_pct?.toFixed(2)}%
- 24h change: ${snapshot.price_24h_pct?.toFixed(2)}%
- Volume 24h: ${(snapshot.volume_24h / 1e6)?.toFixed(1)}M
- RSI-14: ${snapshot.rsi_14}
- EMA9: ${snapshot.ema_9?.toFixed(2)}, EMA21: ${snapshot.ema_21?.toFixed(2)}
- MACD: ${snapshot.macd?.toFixed?.(4) || snapshot.macd || 'N/A'}, Signal: ${snapshot.macd_signal?.toFixed?.(4) || snapshot.macd_signal || 'N/A'}
- Funding Rate: ${snapshot.funding_rate?.toFixed?.(6) || snapshot.funding_rate || 'N/A'}
- Orderbook Imbalance: ${snapshot.orderbook_imbalance?.toFixed?.(4) || snapshot.orderbook_imbalance || 'N/A'}
- Open Interest: ${snapshot.open_interest ? (snapshot.open_interest / 1e6)?.toFixed(1) + 'M' : 'N/A'}

Make a trading decision for the next 15 minutes.
Respond ONLY with valid JSON (no markdown, no explanation outside JSON):
{"action":"BUY"|"SELL"|"HOLD","size":0.1-1.0,"leverage":1-20,"confidence":0.0-1.0,"take_profit":0.1-3.0,"stop_loss":0.1-2.0,"reasoning":"brief explanation"}`;

  const parseDecision = (raw) => {
    if (!raw) throw new Error('Empty Ollama response');
    let cleaned = String(raw).trim();
    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    const firstBrace = cleaned.indexOf('{');
    if (firstBrace > 0) cleaned = cleaned.substring(firstBrace);
    cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in Ollama response');
    cleaned = jsonMatch[0].replace(/,\s*([}\]])/g, '$1');
    cleaned = cleaned.replace(/([{,])\s*([a-zA-Z_]\w*)\s*:/g, '$1"$2":');
    cleaned = cleaned.replace(/:\s*'([^']*)'/g, ':"$1"');
    cleaned = cleaned.replace(/:\s*(BUY|SELL|HOLD)(\s*[,}])/g, ':"$1"$2');
    const d = JSON.parse(cleaned);
    return {
      action: d.action || 'HOLD',
      size: Math.min(1, Math.max(0.1, parseFloat(d.size) || 0.3)),
      leverage: Math.min(20, Math.max(1, parseInt(d.leverage) || 5)),
      confidence: Math.min(1, Math.max(0, parseFloat(d.confidence) || 0.5)),
      take_profit: Math.min(5, Math.max(0.1, parseFloat(d.take_profit) || 0.5)),
      stop_loss: Math.min(5, Math.max(0.1, parseFloat(d.stop_loss) || 0.3)),
      reasoning: String(d.reasoning || '').substring(0, 200),
    };
  };

  try {
    const res = await fetch(OLLAMA_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ollamaModel,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        options: { temperature: 0.7, num_predict: 300 },
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = await res.json();
    return parseDecision(data.message?.content || '');
  } catch (e) {
    console.warn('Ollama decision failed:', e.message);
  }

  return {
    action: 'HOLD',
    size: 0,
    leverage: 1,
    confidence: 0,
    take_profit: 0,
    stop_loss: 0,
    reasoning: 'Ollama API error — safe HOLD fallback',
  };
}

// ─── PnL Calculation ───────────────────────────────────────────────────────

function calculatePnL(decision, entryPrice, exitPrice) {
  if (decision.action === 'HOLD') return 0;
  const direction = decision.action === 'BUY' ? 1 : -1;
  const pricePct = ((exitPrice - entryPrice) / entryPrice) * 100;
  return direction * pricePct * decision.leverage * decision.size;
}

// ─── Main Battle Logic ─────────────────────────────────────────────────────

function updatePortfolio(db, botId, size, pnlPercent) {
  try {
    const row = db.prepare(`SELECT balance, peak_balance, total_trades, total_pnl_usd FROM trading_portfolio WHERE bot_id = ?`).get(botId);
    if (!row) return;

    const balance = Number(row.balance || 10000);
    const pnlUsd = balance * Number(size || 0) * (Number(pnlPercent || 0) / 100);
    const nextBalance = Math.max(100, balance + pnlUsd);
    const nextPeak = Math.max(Number(row.peak_balance || 10000), nextBalance);

    db.prepare(`
      UPDATE trading_portfolio
      SET balance = ?,
          peak_balance = ?,
          total_trades = COALESCE(total_trades, 0) + 1,
          total_pnl_usd = COALESCE(total_pnl_usd, 0) + ?,
          last_updated = datetime('now')
      WHERE bot_id = ?
    `).run(nextBalance, nextPeak, pnlUsd, botId);

    // Sync total_pnl in trading_elo from trading_portfolio (single source of truth)
    const updated = db.prepare(`SELECT total_pnl_usd FROM trading_portfolio WHERE bot_id = ?`).get(botId);
    if (updated) {
      db.prepare(`UPDATE trading_elo SET total_pnl = ? WHERE bot_id = ?`).run(updated.total_pnl_usd, botId);
    }
  } catch (e) {
    console.error(`Portfolio update failed for bot ${botId}:`, e.message);
  }
}

async function runBattleCycle(db) {
  console.log(`\n⏰ [${new Date().toISOString()}] Starting battle cycle...`);
  
  // 1. Fetch fresh market data
  const snapshots = await fetchAndSaveSnapshots();
  console.log(`📊 Fetched ${snapshots.size} market snapshots`);
  
  if (snapshots.size === 0) {
    console.warn('No market data, skipping cycle');
    return;
  }
  
  // 2. Resolve pending battles (use latest prices)
  const pendingBattles = db.prepare(`
    SELECT * FROM trading_battles WHERE status = 'pending' 
    ORDER BY started_at ASC LIMIT 30
  `).all();
  
  let resolved = 0;
  for (const battle of pendingBattles) {
    const snap = snapshots.get(battle.symbol);
    if (!snap) continue;
    
    const exitPrice = snap.price;
    const bot1Pnl = calculatePnL(
      { action: battle.bot1_action, size: battle.bot1_size, leverage: battle.bot1_leverage },
      battle.entry_price, exitPrice
    );
    const bot2Pnl = calculatePnL(
      { action: battle.bot2_action, size: battle.bot2_size, leverage: battle.bot2_leverage },
      battle.entry_price, exitPrice
    );
    
    let winnerId = null;
    if (bot1Pnl > bot2Pnl + 0.01) winnerId = battle.bot1_id;
    else if (bot2Pnl > bot1Pnl + 0.01) winnerId = battle.bot2_id;
    
    db.prepare(`
      UPDATE trading_battles SET
        exit_price = ?, bot1_pnl = ?, bot2_pnl = ?, winner_id = ?,
        status = 'resolved', resolved_at = datetime('now')
      WHERE id = ?
    `).run(exitPrice, bot1Pnl, bot2Pnl, winnerId, battle.id);
    
    // Update ELO
    const K = 32;
    const bot1Elo = (db.prepare(`SELECT elo FROM trading_elo WHERE bot_id = ?`).get(battle.bot1_id)?.elo) || 1500;
    const bot2Elo = (db.prepare(`SELECT elo FROM trading_elo WHERE bot_id = ?`).get(battle.bot2_id)?.elo) || 1500;
    const expected1 = 1 / (1 + Math.pow(10, (bot2Elo - bot1Elo) / 400));
    const score1 = winnerId === battle.bot1_id ? 1 : (winnerId === null ? 0.5 : 0);
    const delta1 = Math.round(K * (score1 - expected1));
    
    db.prepare(`
      UPDATE trading_elo SET elo = elo + ?
      WHERE bot_id = ?
    `).run(delta1, battle.bot1_id);
    db.prepare(`
      UPDATE trading_elo SET elo = elo - ?
      WHERE bot_id = ?
    `).run(delta1, battle.bot2_id);

    // Update wins/losses/draws counters
    if (winnerId === battle.bot1_id) {
      db.prepare(`UPDATE trading_elo SET wins = wins + 1 WHERE bot_id = ?`).run(battle.bot1_id);
      db.prepare(`UPDATE trading_elo SET losses = losses + 1 WHERE bot_id = ?`).run(battle.bot2_id);
    } else if (winnerId === battle.bot2_id) {
      db.prepare(`UPDATE trading_elo SET wins = wins + 1 WHERE bot_id = ?`).run(battle.bot2_id);
      db.prepare(`UPDATE trading_elo SET losses = losses + 1 WHERE bot_id = ?`).run(battle.bot1_id);
    } else {
      db.prepare(`UPDATE trading_elo SET draws = draws + 1 WHERE bot_id = ?`).run(battle.bot1_id);
      db.prepare(`UPDATE trading_elo SET draws = draws + 1 WHERE bot_id = ?`).run(battle.bot2_id);
    }

    updatePortfolio(db, battle.bot1_id, battle.bot1_size, bot1Pnl);
    updatePortfolio(db, battle.bot2_id, battle.bot2_size, bot2Pnl);
    
    resolved++;
  }
  if (resolved > 0) console.log(`✅ Resolved ${resolved} battles`);
  
  // 3. Start new battles
  const activeBots = db.prepare(`
    SELECT ab.id, ab.name, ab.strategy, te.elo FROM api_bots ab
    JOIN trading_elo te ON te.bot_id = ab.id
    WHERE ab.hp > 0
    ORDER BY te.elo DESC LIMIT 30
  `).all();

  if (activeBots.length < 2) {
    console.warn('Not enough bots, skipping new battles');
    return;
  }

  let newBattles = 0;

  for (const symbol of SYMBOLS) {
    const snap = snapshots.get(symbol);
    if (!snap) continue;

    const usedPairs = new Set();
    for (let pairIdx = 0; pairIdx < BATTLES_PER_SYMBOL; pairIdx++) {
    // ELO-based matchmaking: pair bots within ±100 ELO range
    // Shuffle to avoid always picking the same top pair, then find ELO-compatible match
    const ELO_RANGE = 100;
    const shuffled = [...activeBots].sort(() => Math.random() - 0.5);
    let bot1 = null, bot2 = null;
    for (let i = 0; i < shuffled.length - 1 && !bot2; i++) {
      const candidate = shuffled[i];
      // Find the closest ELO opponent within range that hasn't been used
      const opponents = activeBots
        .filter(b => b.id !== candidate.id && Math.abs(b.elo - candidate.elo) <= ELO_RANGE)
        .sort((a, b) => Math.abs(a.elo - candidate.elo) - Math.abs(b.elo - candidate.elo));
      for (const opp of opponents) {
        const pairKey = [candidate.id, opp.id].sort().join('-');
        if (!usedPairs.has(pairKey)) {
          bot1 = candidate;
          bot2 = opp;
          usedPairs.add(pairKey);
          break;
        }
      }
      // Fallback: if no ELO match found, allow any unpaired opponent
      if (!bot2) {
        for (let j = 0; j < shuffled.length && !bot2; j++) {
          if (shuffled[j].id === candidate.id) continue;
          const pairKey = [candidate.id, shuffled[j].id].sort().join('-');
          if (!usedPairs.has(pairKey)) {
            bot1 = candidate;
            bot2 = shuffled[j];
            usedPairs.add(pairKey);
          }
        }
      }
    }
    if (!bot1 || !bot2 || bot1.id === bot2.id) continue;

    console.log(`⚔️  ${symbol}: ${bot1.name} vs ${bot2.name} | model assignment in progress...`);

    const isChainGPT1 = bot1.name === CHAINGPT_BOT_NAME;
    const isChainGPT2 = bot2.name === CHAINGPT_BOT_NAME;
    const isOllama1 = bot1.name === OLLAMA_BOT_NAME;
    const isOllama2 = bot2.name === OLLAMA_BOT_NAME;
    const model1 = isChainGPT1 ? 'chaingpt/general_assistant' : (isOllama1 ? 'local/qwen3-30b' : MODEL_POOL[Math.floor(Math.random() * MODEL_POOL.length)]);
    const model2 = isChainGPT2 ? 'chaingpt/general_assistant' : (isOllama2 ? 'local/qwen3-30b' : MODEL_POOL[Math.floor(Math.random() * MODEL_POOL.length)]);

    const [d1, d2] = await Promise.all([
      isOllama1 ? getOllamaDecision(snap, bot1.strategy || 'momentum') : (
        isChainGPT1 ? getChainGPTDecision(snap, bot1.strategy || 'momentum') : getTradingDecision(model1, snap, bot1.strategy || 'momentum')
      ),
      isOllama2 ? getOllamaDecision(snap, bot2.strategy || 'momentum') : (
        isChainGPT2 ? getChainGPTDecision(snap, bot2.strategy || 'momentum') : getTradingDecision(model2, snap, bot2.strategy || 'momentum')
      ),
    ]);
    
    console.log(`   ${bot1.name}[${model1.split('/')[1]}]: ${d1.action} x${d1.leverage} (conf:${d1.confidence.toFixed(2)})`);
    console.log(`   ${bot2.name}[${model2.split('/')[1]}]: ${d2.action} x${d2.leverage} (conf:${d2.confidence.toFixed(2)})`);
    
    const battleId = uuidv4();
    db.prepare(`
      INSERT INTO trading_battles (
        id, bot1_id, bot2_id, symbol, entry_price,
        bot1_action, bot1_size, bot1_leverage, bot1_confidence, bot1_tp, bot1_sl, bot1_reasoning, bot1_model,
        bot2_action, bot2_size, bot2_leverage, bot2_confidence, bot2_tp, bot2_sl, bot2_reasoning, bot2_model,
        market_data, status, started_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, 'pending', datetime('now')
      )
    `).run(
      battleId, bot1.id, bot2.id, symbol, snap.price,
      d1.action, d1.size, d1.leverage, d1.confidence, d1.take_profit, d1.stop_loss, d1.reasoning, model1,
      d2.action, d2.size, d2.leverage, d2.confidence, d2.take_profit, d2.stop_loss, d2.reasoning, model2,
      JSON.stringify(snap)
    );
    
    newBattles++;
    console.log(`   ✅ Battle ${battleId} created`);
    } // end pairIdx loop
  }

  console.log(`🏆 Cycle done: ${resolved} resolved, ${newBattles} new battles`);
}

// ─── Main Loop ─────────────────────────────────────────────────────────────

async function main() {
  console.log('🎮 GemBots Trading Battles Engine starting...');
  
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS trading_portfolio (
      bot_id INTEGER PRIMARY KEY,
      balance REAL DEFAULT 10000,
      peak_balance REAL DEFAULT 10000,
      total_trades INTEGER DEFAULT 0,
      total_pnl_usd REAL DEFAULT 0,
      last_updated TEXT DEFAULT (datetime('now'))
    );
  `);

  db.prepare(`INSERT OR IGNORE INTO trading_portfolio (bot_id) SELECT bot_id FROM trading_elo`).run();
  
  // Run immediately on start
  try {
    await runBattleCycle(db);
  } catch (e) {
    console.error('First cycle error:', e);
  }
  
  // Then every BATTLE_INTERVAL_MS
  setInterval(async () => {
    try {
      await runBattleCycle(db);
    } catch (e) {
      console.error('Cycle error:', e);
    }
  }, BATTLE_INTERVAL_MS);
  
  console.log(`⏱  Next battle cycle in ${BATTLE_INTERVAL_MS / 60000} minutes`);
}

main();
