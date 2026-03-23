/**
 * GemBots Preset Strategies
 * 
 * Each strategy takes market token data and returns a prediction multiplier.
 * The prediction represents what the bot thinks the token's price will do.
 */

export interface MarketToken {
  symbol: string;
  address: string;
  price_usd?: number;
  market_cap?: number;
  volume_1h?: number;
  holders?: number;
  liquidity?: number;
  age_minutes?: number;
  kol_mentions?: number;
  smart_money?: number;
  v2_score?: number;
  price_change_1h?: number;
  swaps_count?: number;
  risk_score?: number;
}

export type StrategyId = 'trend_follower' | 'whale_watcher' | 'chaos' | 'mean_reversion' | 'smart_ai' | 'aggressive' | 'conservative' | 'random' | 'smart';

export type StrategyFn = (token: MarketToken) => number;

/**
 * 🎯 Trend Follower
 * Looks at price_change_1h. If rising → prediction higher (1.5-3x), falling → lower (0.5-0.9x)
 */
export function trendFollower(token: MarketToken): number {
  const change = token.price_change_1h ?? 0;
  
  if (change > 50) {
    // Strong uptrend → bullish 2.5-3.5x
    return clamp(2.5 + (change - 50) / 100, 2.5, 3.5);
  } else if (change > 20) {
    // Moderate uptrend → bullish 1.8-2.5x
    return clamp(1.8 + (change - 20) / 50, 1.8, 2.5);
  } else if (change > 5) {
    // Slight uptrend → mild bullish 1.3-1.8x
    return clamp(1.3 + (change - 5) / 30, 1.3, 1.8);
  } else if (change > -5) {
    // Sideways → near 1x
    return clamp(0.9 + change / 20, 0.85, 1.15);
  } else if (change > -20) {
    // Slight downtrend → bearish 0.6-0.9x
    return clamp(0.9 + change / 30, 0.6, 0.9);
  } else {
    // Strong downtrend → very bearish 0.3-0.6x
    return clamp(0.6 + (change + 20) / 80, 0.3, 0.6);
  }
}

/**
 * 🐋 Whale Watcher
 * Uses smart_money score. High SM → bullish prediction
 */
export function whaleWatcher(token: MarketToken): number {
  const sm = token.smart_money ?? 0;
  const kolMentions = token.kol_mentions ?? 0;
  const v2Score = token.v2_score ?? 50;
  
  // Smart money is the primary signal
  let base = 1.0;
  
  if (sm >= 5) {
    // Heavy smart money involvement → very bullish
    base = 2.5 + (sm - 5) * 0.3;
  } else if (sm >= 3) {
    // Good smart money → bullish
    base = 1.8 + (sm - 3) * 0.35;
  } else if (sm >= 1) {
    // Some smart money → mildly bullish
    base = 1.3 + (sm - 1) * 0.25;
  } else {
    // No smart money → cautious, below 1x
    base = 0.7 + Math.random() * 0.3;
  }
  
  // KOL mentions boost
  if (kolMentions > 3) base *= 1.15;
  else if (kolMentions > 0) base *= 1.05;
  
  // v2_score adjustment
  if (v2Score > 70) base *= 1.1;
  else if (v2Score < 30) base *= 0.9;
  
  return clamp(base, 0.4, 5.0);
}

/**
 * 🎲 Chaos Bot
 * Pure random prediction 0.5-5.0x
 */
export function chaosBot(_token: MarketToken): number {
  // Weighted random - slight bias towards 1-2x range
  const r = Math.random();
  if (r < 0.3) {
    // 30% chance: bearish 0.5-1.0x
    return clamp(0.5 + Math.random() * 0.5, 0.5, 1.0);
  } else if (r < 0.7) {
    // 40% chance: mild 1.0-2.5x
    return clamp(1.0 + Math.random() * 1.5, 1.0, 2.5);
  } else {
    // 30% chance: moonshot 2.5-5.0x
    return clamp(2.5 + Math.random() * 2.5, 2.5, 5.0);
  }
}

/**
 * 📊 Mean Reversion
 * If token pumped hard → expects pullback (closer to 1x)
 * If token dumped → expects bounce (above 1x)
 */
export function meanReversion(token: MarketToken): number {
  const change = token.price_change_1h ?? 0;
  
  if (change > 100) {
    // Massive pump → expect crash back to ~0.3-0.5x
    return clamp(0.3 + Math.random() * 0.2, 0.3, 0.5);
  } else if (change > 50) {
    // Big pump → expect significant pullback 0.5-0.7x
    return clamp(0.5 + (100 - change) / 200, 0.5, 0.7);
  } else if (change > 20) {
    // Moderate pump → expect mild pullback 0.7-0.9x
    return clamp(0.7 + (50 - change) / 100, 0.7, 0.95);
  } else if (change > -5) {
    // Sideways → stay near 1x
    return clamp(0.95 + Math.random() * 0.1, 0.9, 1.1);
  } else if (change > -20) {
    // Moderate dump → expect bounce 1.2-1.8x
    return clamp(1.2 + Math.abs(change) / 30, 1.2, 1.8);
  } else if (change > -50) {
    // Big dump → expect strong bounce 1.8-2.5x
    return clamp(1.8 + Math.abs(change + 20) / 50, 1.8, 2.5);
  } else {
    // Massive dump → expect dead cat bounce 2.0-3.0x
    return clamp(2.0 + Math.random() * 1.0, 2.0, 3.0);
  }
}

/**
 * 🧠 Smart AI
 * Combination of trend + smart_money + volatility + risk
 */
export function smartAI(token: MarketToken): number {
  const change = token.price_change_1h ?? 0;
  const sm = token.smart_money ?? 0;
  const v2Score = token.v2_score ?? 50;
  const risk = token.risk_score ?? 50;
  const kolMentions = token.kol_mentions ?? 0;
  const holders = token.holders ?? 0;
  const liquidity = token.liquidity ?? 0;
  const age = token.age_minutes ?? 60;
  
  // Start with trend component (40% weight)
  let trendComponent = 1.0;
  if (change > 0) {
    trendComponent = 1.0 + Math.min(change, 100) / 100;
  } else {
    trendComponent = 1.0 + Math.max(change, -80) / 200;
  }
  
  // Smart money component (25% weight)
  let smComponent = 1.0;
  if (sm >= 3) smComponent = 1.5 + (sm - 3) * 0.2;
  else if (sm >= 1) smComponent = 1.1 + (sm - 1) * 0.2;
  else smComponent = 0.8;
  
  // Quality/risk component (20% weight)
  let qualityComponent = 1.0;
  // Lower risk = higher quality
  qualityComponent *= (100 - risk) / 80; // range ~0.25-1.25
  // Good v2 score boosts
  if (v2Score > 70) qualityComponent *= 1.2;
  else if (v2Score < 30) qualityComponent *= 0.8;
  // KOL mentions
  if (kolMentions > 2) qualityComponent *= 1.1;
  
  // Liquidity/safety component (15% weight)
  let safetyComponent = 1.0;
  if (liquidity > 100000) safetyComponent = 1.15;
  else if (liquidity > 50000) safetyComponent = 1.05;
  else if (liquidity < 10000) safetyComponent = 0.85;
  
  // Age adjustment - very new tokens are higher risk/reward
  if (age < 5) safetyComponent *= 0.9; // Too new, risky
  else if (age < 30) safetyComponent *= 1.05; // Sweet spot
  
  // Holder count
  if (holders > 1000) safetyComponent *= 1.05;
  else if (holders < 50) safetyComponent *= 0.9;
  
  // Weighted combination
  const prediction = (
    trendComponent * 0.4 +
    smComponent * 0.25 +
    qualityComponent * 0.2 +
    safetyComponent * 0.15
  );
  
  // Add small noise for variety
  const noise = (Math.random() - 0.5) * 0.15;
  
  return clamp(prediction + noise, 0.3, 5.0);
}

// Helper
function clamp(value: number, min: number, max: number): number {
  return parseFloat(Math.max(min, Math.min(max, value)).toFixed(2));
}

// Strategy registry — maps all IDs (both new and legacy) to functions
const STRATEGY_REGISTRY: Record<string, StrategyFn> = {
  // New strategy IDs
  trend_follower: trendFollower,
  whale_watcher: whaleWatcher,
  chaos: chaosBot,
  mean_reversion: meanReversion,
  smart_ai: smartAI,
  // Legacy strategy IDs from the UI
  aggressive: trendFollower,    // Aggressive → Trend Follower
  conservative: meanReversion,  // Conservative → Mean Reversion
  random: chaosBot,             // Random → Chaos Bot
  smart: smartAI,               // Smart → Smart AI
};

/**
 * Get a strategy function by ID
 */
export function getStrategy(strategyId: string): StrategyFn {
  return STRATEGY_REGISTRY[strategyId] || smartAI;
}

/**
 * Generate prediction for a bot given strategy and token data
 */
export function generatePrediction(strategyId: string, token: MarketToken): number {
  const strategy = getStrategy(strategyId);
  return strategy(token);
}

/**
 * All available strategies with metadata
 */
export const STRATEGIES_META = [
  { id: 'trend_follower', name: '🎯 Trend Follower', desc: 'Follows price momentum — bullish when rising, bearish when falling', color: 'from-orange-600 to-red-600' },
  { id: 'whale_watcher', name: '🐋 Whale Watcher', desc: 'Follows smart money and KOL signals', color: 'from-blue-600 to-indigo-600' },
  { id: 'chaos', name: '🎲 Chaos Bot', desc: 'Pure random predictions 0.5-5.0x', color: 'from-purple-600 to-pink-600' },
  { id: 'mean_reversion', name: '📊 Mean Reversion', desc: 'Bets against the trend — buys dips, sells rips', color: 'from-teal-600 to-cyan-600' },
  { id: 'smart_ai', name: '🧠 Smart AI', desc: 'Combines trend, smart money, volatility & risk analysis', color: 'from-green-600 to-emerald-600' },
];
