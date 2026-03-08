/**
 * 📉 Mean Reversion Strategy
 *
 * Bet against the crowd — what goes up must come down.
 * Tokens that pumped hard are expected to pull back,
 * tokens that dumped hard are expected to bounce.
 *
 * Key signals: price_change_1h, market_cap, liquidity
 *
 * Theory: Extreme moves tend to revert to the mean.
 * Works best in ranging markets and with larger-cap tokens.
 */

import type { MarketToken } from '../../src/lib/strategies';

export const meta = {
  id: 'mean-reversion',
  name: '📉 Mean Reversion',
  description: 'Contrarian — buys dips, sells rips. Expects extreme moves to revert to the mean.',
  author: 'GemBots Team',
  version: '1.0.0',
};

function clamp(value: number, min: number, max: number): number {
  return parseFloat(Math.max(min, Math.min(max, value)).toFixed(2));
}

export function predict(token: MarketToken): number {
  const change = token.price_change_1h ?? 0;
  const marketCap = token.market_cap ?? 0;
  const liquidity = token.liquidity ?? 0;

  let prediction: number;

  // Core logic: inverse of price change
  if (change > 100) {
    // Massive pump → expect crash
    prediction = 0.3 + Math.random() * 0.15;
  } else if (change > 50) {
    // Big pump → expect significant pullback
    prediction = 0.45 + (100 - change) / 200;
  } else if (change > 25) {
    // Moderate pump → expect mild pullback
    prediction = 0.7 + (50 - change) / 100;
  } else if (change > 5) {
    // Slight rise → slight bearish lean
    prediction = 0.85 + (25 - change) / 120;
  } else if (change > -5) {
    // Sideways → neutral
    prediction = 0.95 + Math.random() * 0.1;
  } else if (change > -25) {
    // Moderate dip → expect bounce
    prediction = 1.3 + Math.abs(change + 5) / 40;
  } else if (change > -50) {
    // Big dump → expect strong bounce
    prediction = 1.8 + Math.abs(change + 25) / 60;
  } else {
    // Capitulation → expect dead cat bounce
    prediction = 2.2 + Math.min(Math.abs(change + 50) / 80, 1.3);
  }

  // Market cap confidence modifier
  // Larger caps revert more reliably than micro caps
  let confidence = 1.0;
  if (marketCap > 10_000_000) {
    confidence = 1.1; // Large caps revert reliably
  } else if (marketCap > 1_000_000) {
    confidence = 1.0;
  } else if (marketCap > 100_000) {
    confidence = 0.95;
  } else {
    confidence = 0.85; // Micro caps can keep pumping/dumping
  }

  // Liquidity modifier — more liquidity = more mean reversion
  if (liquidity > 200_000) {
    confidence *= 1.05;
  } else if (liquidity < 20_000) {
    confidence *= 0.9;
  }

  // Apply confidence: move prediction closer/further from neutral
  if (prediction > 1.0) {
    prediction = 1.0 + (prediction - 1.0) * confidence;
  } else {
    prediction = 1.0 - (1.0 - prediction) * confidence;
  }

  // Small noise
  const noise = (Math.random() - 0.5) * 0.08;

  return clamp(prediction + noise, 0.3, 5.0);
}
