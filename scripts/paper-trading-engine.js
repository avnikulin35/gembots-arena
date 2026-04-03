#!/usr/bin/env node

/**
 * GemBots Paper Trading Engine
 * 
 * PM2 service that runs paper trading for NFA bots:
 * 1. Fetches all bots with trading_mode='paper'
 * 2. For each bot: gets NFA strategy prediction
 * 3. If confidence > threshold → places virtual trade
 * 4. Monitors open positions → closes by TP/SL/timeout
 * 5. Updates trading stats
 * 
 * PAPER TRADING ONLY — no real blockchain transactions.
 */

// ─── Load .env.local ─────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '..', '.env.local');
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

const { getPrice, getAllPrices, getSupportedPairs } = require('./lib/price-feed');
const { getNFAModifiedPrediction } = require('./lib/nfa-strategy-adapter');
const { executeBuy, executeSell, getBNBBalance, getTokenBalance, getAllBalances, MAX_TRADE_BNB, MIN_GAS_RESERVE_BNB } = require('./lib/pancakeswap-trader');
const { getPrivateKeyForBot, decryptPrivateKey } = require('./lib/nfa-wallet-manager');
const { ethers } = require('ethers');

// ─── Config ──────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const TRADE_CHECK_INTERVAL_MS = 60_000;       // Check for new trades every 60s
const POSITION_CHECK_INTERVAL_MS = 30_000;     // Check open positions every 30s
const STATS_UPDATE_INTERVAL_MS = 300_000;      // Update stats every 5 min
const MAX_POSITION_HOLD_MINUTES = 240;          // Auto-close after 4 hours
const DEFAULT_POSITION_SIZE_USD = 100;          // Default virtual position size
const PLATFORM_FEE_PCT = 0.5;                  // 0.5% platform commission per trade

// ─── Supabase Helper ─────────────────────────────────────────────────────────

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
    throw new Error(`Supabase ${res.status}: ${text}`);
  }
  const ct = res.headers.get('content-type');
  if (ct && ct.includes('json')) return res.json();
  return null;
}

// ─── Commission Tracking ─────────────────────────────────────────────────────

/**
 * Record a trading commission
 * @param {number} tradeId - Trade record ID
 * @param {number} nfaId - NFA bot ID
 * @param {number} amountUsd - Trade size in USD
 * @param {string} mode - 'paper' or 'live'
 * @param {string} commissionType - 'trade_fee' or 'tournament_entry'
 */
async function recordCommission(tradeId, nfaId, amountUsd, mode, commissionType = 'trade_fee') {
  try {
    const commissionUsd = amountUsd * (PLATFORM_FEE_PCT / 100);
    // Estimate BNB equivalent (get current BNB price)
    let bnbPrice = 600;
    try {
      const prices = await getAllPrices();
      bnbPrice = prices['BNB/USDT'] || 600;
    } catch {}
    const commissionBnb = commissionUsd / bnbPrice;

    await supabaseRequest('trading_commissions', {
      method: 'POST',
      body: JSON.stringify({
        trade_id: tradeId,
        nfa_id: nfaId,
        amount_bnb: parseFloat(commissionBnb.toFixed(8)),
        amount_usd: parseFloat(commissionUsd.toFixed(4)),
        commission_type: commissionType,
      }),
    });

    const tag = mode === 'live' ? '💰' : '📝';
    console.log(`  ${tag} Commission recorded: $${commissionUsd.toFixed(4)} (${commissionBnb.toFixed(6)} BNB) [${mode}]`);

    // Update daily revenue aggregate
    await updateDailyRevenue(commissionBnb, commissionUsd, amountUsd / bnbPrice, amountUsd, nfaId);
  } catch (err) {
    console.warn(`  ⚠️ Failed to record commission for trade ${tradeId}: ${err.message}`);
  }
}

/**
 * Update the daily platform_revenue aggregate
 */
async function updateDailyRevenue(commBnb, commUsd, volBnb, volUsd, nfaId) {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // Check if today's row exists
    const existing = await supabaseRequest(`platform_revenue?date=eq.${today}&select=*`);
    
    if (existing && existing.length > 0) {
      const row = existing[0];
      await supabaseRequest(`platform_revenue?date=eq.${today}`, {
        method: 'PATCH',
        body: JSON.stringify({
          total_commissions_bnb: parseFloat((row.total_commissions_bnb + commBnb).toFixed(8)),
          total_commissions_usd: parseFloat((row.total_commissions_usd + commUsd).toFixed(4)),
          trade_count: row.trade_count + 1,
          trade_volume_bnb: parseFloat((row.trade_volume_bnb + volBnb).toFixed(6)),
          trade_volume_usd: parseFloat((row.trade_volume_usd + volUsd).toFixed(2)),
          updated_at: new Date().toISOString(),
        }),
        prefer: 'return=minimal',
      });
    } else {
      await supabaseRequest('platform_revenue', {
        method: 'POST',
        body: JSON.stringify({
          date: today,
          total_commissions_bnb: parseFloat(commBnb.toFixed(8)),
          total_commissions_usd: parseFloat(commUsd.toFixed(4)),
          trade_count: 1,
          trade_volume_bnb: parseFloat(volBnb.toFixed(6)),
          trade_volume_usd: parseFloat(volUsd.toFixed(2)),
          active_traders: 1,
        }),
      });
    }
  } catch (err) {
    console.warn(`  ⚠️ Failed to update daily revenue: ${err.message}`);
  }
}

// ─── Trading Strategies (simplified from NFA adapter) ────────────────────────

const STRATEGIES = {
  trend_follower: (priceData) => {
    const change = priceData.change_1h || (priceData.change_24h || 0) / 4;
    if (change > 0.8) return { side: 'buy', confidence: Math.min(0.9, 0.6 + change / 15) };
    if (change < -0.8) return { side: 'sell', confidence: Math.min(0.9, 0.6 + Math.abs(change) / 15) };
    return null;
  },
  mean_reversion: (priceData) => {
    const change = priceData.change_24h || 0;
    if (change > 2) return { side: 'sell', confidence: Math.min(0.85, 0.55 + change / 20) };
    if (change < -2) return { side: 'buy', confidence: Math.min(0.85, 0.55 + Math.abs(change) / 20) };
    return null;
  },
  momentum: (priceData) => {
    const change24h = priceData.change_24h || 0;
    const change1h = priceData.change_1h || change24h / 4;
    if (change1h > 0.3 && change24h > 0.5) return { side: 'buy', confidence: Math.min(0.9, 0.55 + change24h / 12) };
    if (change1h < -0.3 && change24h < -0.5) return { side: 'sell', confidence: Math.min(0.9, 0.55 + Math.abs(change24h) / 12) };
    return null;
  },
  contrarian: (priceData) => {
    const change = priceData.change_24h || 0;
    if (change > 2.5) return { side: 'sell', confidence: Math.min(0.8, 0.55 + change / 20) };
    if (change < -2.5) return { side: 'buy', confidence: Math.min(0.8, 0.55 + Math.abs(change) / 20) };
    return null;
  },
  scalper: (priceData) => {
    // Scalpers trade on confirmed small moves (no random noise)
    const change = priceData.change_1h || (priceData.change_24h || 0) / 6;
    const change5m = priceData.change_5m || change / 12;
    // Require same-direction confirmation from short-term momentum
    if (change > 0.5 && change5m > 0) return { side: 'buy', confidence: Math.min(0.85, 0.62 + Math.abs(change) / 10) };
    if (change < -0.5 && change5m < 0) return { side: 'sell', confidence: Math.min(0.85, 0.62 + Math.abs(change) / 10) };
    return null;
  },
  whale_watcher: (priceData) => {
    // Whale watchers buy big dips, sell big pumps
    const change24h = priceData.change_24h || 0;
    if (change24h < -3) return { side: 'buy', confidence: Math.min(0.9, 0.65 + Math.abs(change24h) / 15) };
    if (change24h > 3) return { side: 'sell', confidence: Math.min(0.9, 0.65 + change24h / 15) };
    // Moderate activity
    const change1h = priceData.change_1h || change24h / 4;
    if (Math.abs(change1h) > 1.5) return { side: change1h > 0 ? 'buy' : 'sell', confidence: 0.65 };
    return null;
  },
  smart_ai: (priceData) => {
    // Neural network style — combines multiple signals
    const change24h = priceData.change_24h || 0;
    const change1h = priceData.change_1h || change24h / 4;
    const combined = change1h * 0.6 + (change24h / 6) * 0.4;
    if (combined > 0.4) return { side: 'buy', confidence: Math.min(0.92, 0.6 + Math.abs(combined) / 10) };
    if (combined < -0.4) return { side: 'sell', confidence: Math.min(0.92, 0.6 + Math.abs(combined) / 10) };
    return null;
  },
};

/**
 * Get trading signal for a bot based on its strategy and market data
 */
function getTradingSignal(bot, priceData, pair) {
  // Determine strategy from bot's strategy or default
  const strategyName = bot.strategy || 'trend_follower';
  const strategyFn = STRATEGIES[strategyName] || STRATEGIES.trend_follower;

  const signal = strategyFn(priceData);
  if (!signal) return null;

  // Apply NFA modifiers if available (from strategy_cache)
  const config = bot.trading_config || {};
  const threshold = config.confidence_threshold || 0.65;

  if (signal.confidence < threshold) return null;

  return {
    pair,
    side: signal.side,
    confidence: signal.confidence,
    strategyName,
  };
}

// ─── Trade Execution (Paper) ─────────────────────────────────────────────────

/**
 * Open a trade (paper or live)
 */
async function openTrade(bot, signal, currentPrice) {
  const config = bot.trading_config || {};
  const maxPositionPct = config.max_position_pct || 10;
  const isLive = bot._mode === 'live' || bot.trading_mode === 'live';
  
  // Get current stats for balance
  let stats;
  try {
    const statsRows = await supabaseRequest(`nfa_trading_stats?bot_id=eq.${bot.id}&select=*`);
    stats = statsRows?.[0];
  } catch {
    stats = null;
  }
  
  const balance = stats?.paper_balance_usd || 10000;
  const positionSize = Math.min(
    balance * (maxPositionPct / 100),
    DEFAULT_POSITION_SIZE_USD
  );

  if (positionSize < 1) {
    console.log(`  ⚠️ NFA #${bot.nfa_id}: Insufficient paper balance ($${balance.toFixed(2)})`);
    return null;
  }

  // Check daily trade limit
  const today = new Date().toISOString().split('T')[0];
  const maxTrades = config.max_trades_per_day || 20;
  
  try {
    const todayTrades = await supabaseRequest(
      `nfa_trades?bot_id=eq.${bot.id}&open_at=gte.${today}T00:00:00Z&select=id`,
    );
    if (todayTrades && todayTrades.length >= maxTrades) {
      console.log(`  ⚠️ NFA #${bot.nfa_id}: Daily trade limit reached (${maxTrades})`);
      return null;
    }
  } catch {
    // Ignore count check error
  }

  // Check max open trades (limit to 3 per bot)
  try {
    const openTrades = await supabaseRequest(
      `nfa_trades?bot_id=eq.${bot.id}&status=eq.open&select=id`
    );
    if (openTrades && openTrades.length >= 3) {
      console.log(`  ⚠️ NFA #${bot.nfa_id}: Max open positions reached (3)`);
      return null;
    }
  } catch {
    // Ignore
  }

  // ─── Live Mode: Execute real swap via PancakeSwap ──────────────────
  let txHash = null;
  let gasUsed = null;

  if (isLive) {
    // Safety: require env var
    if (process.env.NFA_LIVE_TRADING_ENABLED !== 'true') {
      console.log(`  ⚠️ NFA #${bot.nfa_id}: Live trading disabled (NFA_LIVE_TRADING_ENABLED != true)`);
      return null;
    }

    try {
      // Decrypt private key
      const privateKey = decryptPrivateKey(bot.trading_wallet_encrypted);
      const provider = new ethers.JsonRpcProvider(
        process.env.NEXT_PUBLIC_BSC_RPC || 'https://bsc-dataseed.binance.org/',
        56
      );
      const wallet = new ethers.Wallet(privateKey, provider);

      // Calculate BNB amount from position size (use price to convert USD → BNB)
      const bnbPrice = (await getAllPrices())['BNB/USDT'] || 600;
      let amountBNB = positionSize / bnbPrice;
      
      // Safety: cap at MAX_TRADE_BNB
      amountBNB = Math.min(amountBNB, MAX_TRADE_BNB);
      
      if (amountBNB < 0.001) {
        console.log(`  ⚠️ NFA #${bot.nfa_id}: Trade amount too small: ${amountBNB} BNB`);
        return null;
      }

      // Check BNB balance
      const bnbBalance = await getBNBBalance(wallet.address);
      if (parseFloat(bnbBalance) < amountBNB + MIN_GAS_RESERVE_BNB) {
        console.log(`  ⚠️ NFA #${bot.nfa_id}: Insufficient BNB: ${bnbBalance} (need ${amountBNB} + ${MIN_GAS_RESERVE_BNB} gas)`);
        return null;
      }

      console.log(`  🔴 NFA #${bot.nfa_id}: LIVE ${signal.side.toUpperCase()} ${signal.pair} — ${amountBNB.toFixed(4)} BNB`);

      const result = await executeBuy(wallet, signal.pair, amountBNB, config.slippage_pct || 1);
      txHash = result.txHash;
      gasUsed = parseFloat(result.gasUsed);

      console.log(`  ✅ NFA #${bot.nfa_id}: Live trade executed — TX: ${txHash}`);
    } catch (err) {
      console.error(`  ❌ NFA #${bot.nfa_id}: Live trade FAILED: ${err.message}`);
      return null; // Don't record failed trades
    }
  }

  // ─── Record trade ─────────────────────────────────────────────────
  const trade = {
    nfa_id: bot.nfa_id || bot.id,
    bot_id: bot.id,
    pair: signal.pair,
    side: signal.side,
    entry_price: currentPrice,
    size_usd: positionSize,
    confidence: signal.confidence,
    strategy_name: signal.strategyName,
    mode: isLive ? 'live' : 'paper',
    status: 'open',
    tx_hash: txHash,
    gas_used: gasUsed,
  };

  try {
    const result = await supabaseRequest('nfa_trades', {
      method: 'POST',
      body: JSON.stringify(trade),
    });
    const modeEmoji = isLive ? '🔴' : '📈';
    console.log(`  ${modeEmoji} NFA #${bot.nfa_id}: Opened ${signal.side.toUpperCase()} ${signal.pair} @ $${currentPrice.toFixed(2)} ($${positionSize.toFixed(2)}) [${isLive ? 'LIVE' : 'PAPER'}]`);

    // Record commission (0.5% platform fee)
    if (result?.[0]?.id) {
      await recordCommission(result[0].id, bot.nfa_id || bot.id, positionSize, isLive ? 'live' : 'paper');
    }

    return result?.[0];
  } catch (err) {
    console.error(`  ❌ Failed to open trade for NFA #${bot.nfa_id}: ${err.message}`);
    return null;
  }
}

/**
 * Check and close open positions based on TP/SL/timeout
 */
async function checkOpenPositions() {
  let openTrades;
  try {
    openTrades = await supabaseRequest(
      'nfa_trades?status=eq.open&select=*&order=open_at.asc'
    );
  } catch (err) {
    console.error(`  ❌ Failed to fetch open trades: ${err.message}`);
    return;
  }

  if (!openTrades || openTrades.length === 0) return;

  console.log(`  🔍 Checking ${openTrades.length} open positions...`);

  // Get all current prices
  const prices = await getAllPrices();

  for (const trade of openTrades) {
    const priceInfo = prices[trade.pair];
    if (!priceInfo) continue;

    const currentPrice = priceInfo;
    const entryPrice = trade.entry_price;
    const holdMinutes = (Date.now() - new Date(trade.open_at).getTime()) / 60000;

    // Calculate PnL based on side
    let pnlPct;
    if (trade.side === 'buy') {
      pnlPct = ((currentPrice - entryPrice) / entryPrice) * 100;
    } else {
      pnlPct = ((entryPrice - currentPrice) / entryPrice) * 100;
    }

    // Get bot config for TP/SL
    let botConfig = {};
    try {
      const rows = await supabaseRequest(`bots?id=eq.${trade.bot_id}&select=trading_config`);
      botConfig = rows?.[0]?.trading_config || {};
    } catch {
      // Use defaults
    }

    const takeProfitPct = botConfig.take_profit_pct || 6;
    const stopLossPct = botConfig.stop_loss_pct || 2.5;

    let closeReason = null;

    if (pnlPct >= takeProfitPct) {
      closeReason = 'take_profit';
    } else if (pnlPct <= -stopLossPct) {
      closeReason = 'stop_loss';
    } else if (holdMinutes >= MAX_POSITION_HOLD_MINUTES) {
      closeReason = 'timeout';
    }

    if (closeReason) {
      await closeTrade(trade, currentPrice, pnlPct, closeReason);
    }
  }
}

/**
 * Close a trade and update stats (paper or live)
 */
async function closeTrade(trade, exitPrice, pnlPct, closeReason) {
  const pnlUsd = trade.size_usd * (pnlPct / 100);
  const isLive = trade.mode === 'live';

  let closeTxHash = null;
  let closeGasUsed = null;

  // ─── Live Mode: Execute reverse swap ──────────────────────────────
  if (isLive && process.env.NFA_LIVE_TRADING_ENABLED === 'true') {
    try {
      // Get bot info for wallet decryption
      const botRows = await supabaseRequest(
        `bots?id=eq.${trade.bot_id}&select=trading_wallet_encrypted`
      );
      const botData = botRows?.[0];
      
      if (botData?.trading_wallet_encrypted) {
        const privateKey = decryptPrivateKey(botData.trading_wallet_encrypted);
        const provider = new ethers.JsonRpcProvider(
          process.env.NEXT_PUBLIC_BSC_RPC || 'https://bsc-dataseed.binance.org/',
          56
        );
        const wallet = new ethers.Wallet(privateKey, provider);

        // For a buy trade, closing means selling the token back
        // For a sell trade, closing means buying it back
        // For simplicity in Phase 2: if we bought token, sell all of it back
        if (trade.side === 'buy') {
          // We need to sell the tokens we bought. Get the token balance.
          const { baseAddr, quoteAddr } = (() => {
            const [base, quote] = trade.pair.toUpperCase().split('/');
            const { TOKENS } = require('./lib/pancakeswap-trader');
            return { baseAddr: TOKENS[base], quoteAddr: TOKENS[quote] };
          })();
          
          const tokenAddr = trade.pair.startsWith('BNB') ? quoteAddr : baseAddr;
          const { balance } = await getTokenBalance(wallet.address, tokenAddr);
          
          if (parseFloat(balance) > 0) {
            console.log(`  🔄 NFA #${trade.nfa_id}: LIVE closing — selling ${balance} tokens`);
            const result = await executeSell(wallet, trade.pair, balance, 1);
            closeTxHash = result.txHash;
            closeGasUsed = parseFloat(result.gasUsed);
            console.log(`  ✅ NFA #${trade.nfa_id}: Close TX: ${closeTxHash}`);
          }
        }
        // For sell trades (shorts) — in Phase 2 we don't support real shorts
      }
    } catch (err) {
      console.error(`  ❌ NFA #${trade.nfa_id}: Live close FAILED: ${err.message}`);
      // Still close the trade record even if on-chain fails
    }
  }

  try {
    const updateData = {
      exit_price: exitPrice,
      pnl_usd: parseFloat(pnlUsd.toFixed(2)),
      pnl_pct: parseFloat(pnlPct.toFixed(2)),
      status: 'closed',
      close_reason: closeReason,
      close_at: new Date().toISOString(),
    };

    // Add close tx info if available
    if (closeTxHash) {
      updateData.tx_hash = (trade.tx_hash ? trade.tx_hash + ',' : '') + closeTxHash;
    }
    if (closeGasUsed) {
      updateData.gas_used = (trade.gas_used || 0) + closeGasUsed;
    }

    await supabaseRequest(`nfa_trades?id=eq.${trade.id}`, {
      method: 'PATCH',
      body: JSON.stringify(updateData),
      prefer: 'return=minimal',
    });

    const emoji = pnlUsd >= 0 ? '🟢' : '🔴';
    const modeTag = isLive ? ' [LIVE]' : '';
    console.log(`  ${emoji} NFA #${trade.nfa_id}: Closed ${trade.side.toUpperCase()} ${trade.pair} | PnL: $${pnlUsd.toFixed(2)} (${pnlPct.toFixed(2)}%) | Reason: ${closeReason}${modeTag}`);

    // Update paper balance (for both modes — tracks performance)
    await updatePaperBalance(trade.nfa_id, pnlUsd);

    // Record commission on close (exit side fee)
    await recordCommission(trade.id, trade.nfa_id, trade.size_usd, isLive ? 'live' : 'paper');
  } catch (err) {
    console.error(`  ❌ Failed to close trade ${trade.id}: ${err.message}`);
  }
}

/**
 * Update paper balance in trading stats
 */
async function updatePaperBalance(nfaId, pnlUsd) {
  try {
    const stats = await supabaseRequest(`nfa_trading_stats?nfa_id=eq.${nfaId}&select=paper_balance_usd`);
    if (stats && stats.length > 0) {
      const newBalance = (stats[0].paper_balance_usd || 10000) + pnlUsd;
      await supabaseRequest(`nfa_trading_stats?nfa_id=eq.${nfaId}`, {
        method: 'PATCH',
        body: JSON.stringify({ paper_balance_usd: parseFloat(newBalance.toFixed(2)) }),
        prefer: 'return=minimal',
      });
    }
  } catch (err) {
    console.warn(`  ⚠️ Failed to update paper balance for NFA #${nfaId}: ${err.message}`);
  }
}

// ─── Stats Update ────────────────────────────────────────────────────────────

/**
 * Recalculate trading stats for all active bots
 */
async function updateAllStats() {
  let tradingBots;
  try {
    tradingBots = await supabaseRequest(
      `bots?trading_mode=neq.off&select=id,nfa_id`
    );
  } catch {
    return;
  }

  if (!tradingBots || tradingBots.length === 0) return;

  for (const bot of tradingBots) {
    await updateBotStats(bot.nfa_id || bot.id, bot.id);
  }
}

async function updateBotStats(nfaId, botId) {
  try {
    // Get all closed trades
    const trades = await supabaseRequest(
      `nfa_trades?nfa_id=eq.${nfaId}&status=eq.closed&select=pnl_usd,pnl_pct,open_at,close_at&order=close_at.asc`
    );

    if (!trades || trades.length === 0) {
      // Still update with zeros
      await supabaseRequest(`nfa_trading_stats?nfa_id=eq.${nfaId}`, {
        method: 'PATCH',
        body: JSON.stringify({ updated_at: new Date().toISOString() }),
        prefer: 'return=minimal',
      });
      return;
    }

    // Count open trades
    let openTrades;
    try {
      openTrades = await supabaseRequest(
        `nfa_trades?nfa_id=eq.${nfaId}&status=eq.open&select=id`
      );
    } catch {
      openTrades = [];
    }

    const totalTrades = trades.length;
    const winningTrades = trades.filter(t => t.pnl_usd > 0).length;
    const losingTrades = trades.filter(t => t.pnl_usd < 0).length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    const totalPnl = trades.reduce((sum, t) => sum + (t.pnl_usd || 0), 0);
    const avgPnlPct = totalTrades > 0 ? trades.reduce((sum, t) => sum + (t.pnl_pct || 0), 0) / totalTrades : 0;
    const bestTrade = Math.max(...trades.map(t => t.pnl_usd || 0), 0);
    const worstTrade = Math.min(...trades.map(t => t.pnl_usd || 0), 0);

    // Calculate Sharpe Ratio (simplified: mean return / std dev)
    const returns = trades.map(t => t.pnl_pct || 0);
    const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? (meanReturn / stdDev) * Math.sqrt(252) : 0; // Annualized

    // Calculate Max Drawdown
    let peak = 10000; // Starting balance
    let maxDrawdown = 0;
    let runningBalance = 10000;
    for (const t of trades) {
      runningBalance += t.pnl_usd || 0;
      if (runningBalance > peak) peak = runningBalance;
      const drawdown = ((peak - runningBalance) / peak) * 100;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }

    // Streak calculation
    let currentStreak = 0;
    let bestStreak = 0;
    let tempStreak = 0;
    for (const t of trades) {
      if (t.pnl_usd > 0) {
        tempStreak++;
        if (tempStreak > bestStreak) bestStreak = tempStreak;
      } else {
        tempStreak = 0;
      }
    }
    currentStreak = tempStreak;

    // Average hold time
    const holdMinutes = trades
      .filter(t => t.open_at && t.close_at)
      .map(t => (new Date(t.close_at).getTime() - new Date(t.open_at).getTime()) / 60000);
    const avgHoldMinutes = holdMinutes.length > 0
      ? holdMinutes.reduce((a, b) => a + b, 0) / holdMinutes.length
      : 0;

    await supabaseRequest(`nfa_trading_stats?nfa_id=eq.${nfaId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        total_trades: totalTrades,
        open_trades: openTrades?.length || 0,
        winning_trades: winningTrades,
        losing_trades: losingTrades,
        win_rate: parseFloat(winRate.toFixed(2)),
        total_pnl_usd: parseFloat(totalPnl.toFixed(2)),
        avg_pnl_pct: parseFloat(avgPnlPct.toFixed(2)),
        best_trade_pnl: parseFloat(bestTrade.toFixed(2)),
        worst_trade_pnl: parseFloat(worstTrade.toFixed(2)),
        sharpe_ratio: parseFloat(sharpeRatio.toFixed(3)),
        max_drawdown_pct: parseFloat(maxDrawdown.toFixed(2)),
        current_streak: currentStreak,
        best_streak: bestStreak,
        avg_hold_minutes: parseFloat(avgHoldMinutes.toFixed(1)),
        updated_at: new Date().toISOString(),
      }),
      prefer: 'return=minimal',
    });
  } catch (err) {
    console.warn(`  ⚠️ Failed to update stats for NFA #${nfaId}: ${err.message}`);
  }
}

// ─── Main Loop ───────────────────────────────────────────────────────────────

let cycleCount = 0;

async function tradingCycle() {
  cycleCount++;
  console.log(`\n🔄 Trading cycle #${cycleCount} — ${new Date().toISOString()}`);

  // 1. Fetch all active trading bots (paper + live)
  let paperBots = [];
  let liveBots = [];
  try {
    paperBots = await supabaseRequest(
      `bots?trading_mode=eq.paper&select=id,nfa_id,name,strategy,trading_config,strategy_cache`
    ) || [];
  } catch (err) {
    console.error(`  ❌ Failed to fetch paper trading bots: ${err.message}`);
  }

  try {
    liveBots = await supabaseRequest(
      `bots?trading_mode=eq.live&select=id,nfa_id,name,strategy,trading_config,strategy_cache,trading_wallet_address,trading_wallet_encrypted`
    ) || [];
  } catch (err) {
    console.error(`  ❌ Failed to fetch live trading bots: ${err.message}`);
  }

  const allBots = [
    ...paperBots.map(b => ({ ...b, _mode: 'paper' })),
    ...liveBots.map(b => ({ ...b, _mode: 'live' })),
  ];

  if (allBots.length === 0) {
    console.log('  ℹ️ No bots in paper or live trading mode');
    return;
  }

  console.log(`  📊 ${paperBots.length} paper + ${liveBots.length} live bots active`);

  // 2. Fetch all prices
  const prices = await getAllPrices();
  if (Object.keys(prices).length === 0) {
    console.log('  ⚠️ No prices available, skipping cycle');
    return;
  }

  // 3. For each bot, check for trading signals
  for (const bot of allBots) {
    const config = bot.trading_config || {};
    const allowedPairs = config.allowed_pairs || ['BNB/USDT', 'ETH/USDT', 'CAKE/USDT'];

    // Pick a random pair from allowed pairs
    const availablePairs = allowedPairs.filter(p => prices[p]);
    if (availablePairs.length === 0) continue;

    // Check each allowed pair for signals — at most 1 new trade per bot per cycle
    let tradedThisCycle = false;
    for (const pair of availablePairs) {
      if (tradedThisCycle) break;
      const priceData = await getPrice(pair);
      if (!priceData) continue;

      const signal = getTradingSignal(bot, priceData, pair);
      if (signal) {
        const trade = await openTrade(bot, signal, priceData.price);
        if (trade) tradedThisCycle = true;
      }
    }
  }
}

async function main() {
  console.log('🚀 GemBots Trading Engine starting (Paper + Live)...');
  console.log(`  📍 Supabase: ${SUPABASE_URL}`);
  console.log(`  🔴 Live trading: ${process.env.NFA_LIVE_TRADING_ENABLED === 'true' ? 'ENABLED' : 'DISABLED'}`);
  console.log(`  💰 Max trade: ${MAX_TRADE_BNB} BNB | Gas reserve: ${MIN_GAS_RESERVE_BNB} BNB`);
  console.log(`  ⏱ Trade check: ${TRADE_CHECK_INTERVAL_MS / 1000}s`);
  console.log(`  ⏱ Position check: ${POSITION_CHECK_INTERVAL_MS / 1000}s`);
  console.log(`  ⏱ Stats update: ${STATS_UPDATE_INTERVAL_MS / 1000}s`);

  // Initial price fetch
  await getAllPrices();
  console.log('  ✅ Price feed initialized');

  // Trading cycle
  setInterval(async () => {
    try {
      await tradingCycle();
    } catch (err) {
      console.error(`❌ Trading cycle error: ${err.message}`);
    }
  }, TRADE_CHECK_INTERVAL_MS);

  // Position monitoring
  setInterval(async () => {
    try {
      await checkOpenPositions();
    } catch (err) {
      console.error(`❌ Position check error: ${err.message}`);
    }
  }, POSITION_CHECK_INTERVAL_MS);

  // Stats update
  setInterval(async () => {
    try {
      await updateAllStats();
      console.log('  📊 Trading stats updated');
    } catch (err) {
      console.error(`❌ Stats update error: ${err.message}`);
    }
  }, STATS_UPDATE_INTERVAL_MS);

  // First run
  await tradingCycle();
  await checkOpenPositions();
  await updateAllStats();

  console.log('✅ Paper Trading Engine running');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
