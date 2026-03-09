#!/usr/bin/env node
/**
 * Fetch 1-minute candles from Bybit for BTC, ETH, SOL
 * covering the Classic Arena period (2026-02-07 to 2026-03-09).
 * Saves to data/candles/<SYMBOL>_1m.json
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
const INTERVAL = '1'; // 1 minute
const LIMIT = 1000;   // max per request
const START_DATE = new Date('2026-02-07T00:00:00Z');
const END_DATE = new Date('2026-03-10T00:00:00Z');
const OUT_DIR = path.join(__dirname, '..', 'data', 'candles');
const DELAY_MS = 200; // polite rate limiting

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'GemBots/1.0' } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error: ${data.slice(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

async function fetchSymbol(symbol) {
  const allCandles = [];
  let startMs = START_DATE.getTime();
  const endMs = END_DATE.getTime();
  let requests = 0;

  log(`📊 Fetching ${symbol} candles...`);

  while (startMs < endMs) {
    const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${INTERVAL}&start=${startMs}&limit=${LIMIT}`;
    
    const resp = await fetchJSON(url);
    
    if (resp.retCode !== 0) {
      log(`   ❌ Error: ${resp.retMsg}`);
      break;
    }

    const candles = resp.result?.list || [];
    if (candles.length === 0) break;

    // Bybit returns newest first, reverse for chronological order
    const sorted = candles.reverse();
    
    for (const c of sorted) {
      allCandles.push({
        ts: parseInt(c[0]),
        open: parseFloat(c[1]),
        high: parseFloat(c[2]),
        low: parseFloat(c[3]),
        close: parseFloat(c[4]),
        volume: parseFloat(c[5]),
      });
    }

    // Move start to after last candle
    const lastTs = parseInt(sorted[sorted.length - 1][0]);
    startMs = lastTs + 60000; // +1 minute
    requests++;

    if (requests % 10 === 0) {
      const pct = ((startMs - START_DATE.getTime()) / (endMs - START_DATE.getTime()) * 100).toFixed(1);
      log(`   ${symbol}: ${requests} requests, ${allCandles.length} candles, ${pct}%`);
    }

    await sleep(DELAY_MS);
  }

  // Deduplicate by timestamp
  const seen = new Set();
  const unique = allCandles.filter(c => {
    if (seen.has(c.ts)) return false;
    seen.add(c.ts);
    return true;
  });

  // Save
  const outPath = path.join(OUT_DIR, `${symbol}_1m.json`);
  fs.writeFileSync(outPath, JSON.stringify(unique));
  
  log(`   ✅ ${symbol}: ${unique.length} candles, ${requests} requests → ${outPath}`);
  return { symbol, candles: unique.length, requests };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  
  log('🚀 Bybit Candle Fetcher — BTC, ETH, SOL (1m, 30 days)');
  
  const results = [];
  for (const sym of SYMBOLS) {
    const r = await fetchSymbol(sym);
    results.push(r);
  }

  log('\n📋 Summary:');
  let totalReqs = 0;
  for (const r of results) {
    log(`   ${r.symbol}: ${r.candles} candles (${r.requests} requests)`);
    totalReqs += r.requests;
  }
  log(`   Total API requests: ${totalReqs}`);
}

main().catch(err => {
  log(`💥 Fatal: ${err.message}`);
  process.exit(1);
});
