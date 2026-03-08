/**
 * 🚀 Momentum Strategy
 *
 * Classic momentum trading — ride the wave.
 * Tokens with strong upward momentum get bullish predictions,
 * tokens losing steam get bearish ones.
 *
 * Key signals: price_change_1h, volume_1h, swaps_count
 *
 * Theory: Objects in motion tend to stay in motion.
 * Strong volume + price increase = momentum likely to continue.
 */

import type { MarketToken } from '../../src/lib/strategies';

export const meta = {
  id: 'momentum',
  name: '🚀 Momentum',
  description: 'Rides the wave — bullish on strong upward momentum with volume confirmation',
  author: 'GemBots Team',
  version: '1.0.0',
};

function clamp(value: number, min: number, max: number): number {
  return parseFloat(Math.max(min, Math.min(max, value)).toFixed(2));
}

export function predict(token: MarketToken): number {
  const change = token.price_change_1h ?? 0;
  const volume = token.volume_1h ?? 0;
  const swaps = token.swaps_count ?? 0;

  // Base prediction from price momentum
  let prediction: number;

  if (change > 80) {
    // Parabolic move — strong bullish but watch for exhaustion
    prediction = 3.0 + Math.min((change - 80) / 100, 1.5);
  } else if (change > 30) {
    // Strong momentum — bullish
    prediction = 2.0 + (change - 30) / 100;
  } else if (change > 10) {
    // Building momentum — mildly bullish
    prediction = 1.3 + (change - 10) / 40;
  } else if (change > -10) {
    // Sideways — neutral
    prediction = 0.9 + change / 50;
  } else if (change > -30) {
    // Losing momentum — bearish
    prediction = 0.6 + (change + 30) / 60;
  } else {
    // Freefall — very bearish
    prediction = 0.3 + Math.max((change + 50) / 100, 0);
  }

  // Volume confirmation multiplier
  // High volume confirms the trend, low volume suggests weak move
  let volumeMultiplier = 1.0;
  if (volume > 500000) {
    volumeMultiplier = 1.2; // Very high volume confirms trend
  } else if (volume > 100000) {
    volumeMultiplier = 1.1;
  } else if (volume > 10000) {
    volumeMultiplier = 1.0;
  } else {
    volumeMultiplier = 0.9; // Low volume = weak conviction
  }

  // Swap activity boost — more swaps = more interest
  if (swaps > 500) {
    volumeMultiplier *= 1.05;
  } else if (swaps < 20) {
    volumeMultiplier *= 0.95;
  }

  prediction *= volumeMultiplier;

  // Small noise for variety
  const noise = (Math.random() - 0.5) * 0.1;

  return clamp(prediction + noise, 0.3, 5.0);
}
