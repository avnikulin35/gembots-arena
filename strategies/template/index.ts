/**
 * 🎯 Strategy Template — Copy this to create your own strategy!
 *
 * How to use:
 * 1. Copy this folder: `cp -r strategies/template strategies/my-strategy`
 * 2. Edit the `meta` object with your strategy info
 * 3. Implement the `predict()` function with your logic
 * 4. Test it and submit a PR!
 *
 * The predict function receives market data for a token and returns
 * a price prediction multiplier:
 *   - < 1.0 = bearish (expect price to drop)
 *   - 1.0   = neutral (expect no change)
 *   - > 1.0 = bullish (expect price to rise)
 *   - Maximum: 5.0
 *
 * @example
 * predict({ symbol: 'DOGE', address: '0x...', price_change_1h: 25 })
 * // Returns: 1.5 (mildly bullish)
 */

import type { MarketToken } from '../../src/lib/strategies';

/**
 * Strategy metadata — displayed in the UI and leaderboard.
 */
export const meta = {
  /** Unique kebab-case identifier */
  id: 'my-strategy',
  /** Display name (include an emoji!) */
  name: '🎯 My Strategy',
  /** One-line description of your approach */
  description: 'Describe what your strategy does and what signals it uses',
  /** Your name or GitHub username */
  author: 'Your Name',
  /** Semver version */
  version: '1.0.0',
};

/**
 * Clamp a value between min and max, rounded to 2 decimal places.
 */
function clamp(value: number, min: number, max: number): number {
  return parseFloat(Math.max(min, Math.min(max, value)).toFixed(2));
}

/**
 * Generate a price prediction for the given token.
 *
 * @param token - Market data for the token being evaluated
 * @returns Prediction multiplier (0.3 - 5.0)
 *
 * @example
 * // Bullish on tokens with strong volume
 * if ((token.volume_1h ?? 0) > 100000) return 2.0;
 *
 * // Bearish on tokens with no holders
 * if ((token.holders ?? 0) < 10) return 0.5;
 */
export function predict(token: MarketToken): number {
  // TODO: Implement your prediction logic here!
  //
  // Available signals (all optional, use ?? for defaults):
  //   token.price_change_1h  — price change % in last hour
  //   token.volume_1h        — trading volume in last hour
  //   token.market_cap       — market capitalization
  //   token.holders          — number of holders
  //   token.liquidity        — liquidity pool size
  //   token.age_minutes      — how old the token is
  //   token.kol_mentions     — KOL mention count
  //   token.smart_money      — smart money activity score
  //   token.v2_score         — GemBots composite score
  //   token.swaps_count      — number of swaps
  //   token.risk_score       — risk score (0-100)
  //
  // Return: < 1.0 bearish, 1.0 neutral, > 1.0 bullish

  const _change = token.price_change_1h ?? 0;

  // Example: simple neutral strategy
  return clamp(1.0, 0.3, 5.0);
}
