/**
 * 🐦 Sentiment Strategy
 *
 * Social-signal driven predictions.
 * Uses KOL mentions and smart money activity as primary indicators,
 * with holder count and v2_score as supporting signals.
 *
 * Key signals: kol_mentions, smart_money, holders, v2_score
 *
 * Theory: Tokens that capture social attention and attract smart money
 * tend to pump. The crowd is sometimes right — especially early.
 */

import type { MarketToken } from '../../src/lib/strategies';

export const meta = {
  id: 'sentiment',
  name: '🐦 Sentiment',
  description: 'Social signal tracker — follows KOL mentions, smart money, and crowd sentiment',
  author: 'GemBots Team',
  version: '1.0.0',
};

function clamp(value: number, min: number, max: number): number {
  return parseFloat(Math.max(min, Math.min(max, value)).toFixed(2));
}

export function predict(token: MarketToken): number {
  const kolMentions = token.kol_mentions ?? 0;
  const smartMoney = token.smart_money ?? 0;
  const holders = token.holders ?? 0;
  const v2Score = token.v2_score ?? 50;
  const age = token.age_minutes ?? 60;

  // Score from 0-100 across all sentiment signals
  let sentimentScore = 0;

  // KOL mentions (0-35 points)
  // More mentions = more hype = bullish
  if (kolMentions >= 5) {
    sentimentScore += 35;
  } else if (kolMentions >= 3) {
    sentimentScore += 25;
  } else if (kolMentions >= 1) {
    sentimentScore += 15;
  }
  // 0 mentions = 0 points

  // Smart money (0-30 points)
  // Smart money flows are the strongest signal
  if (smartMoney >= 5) {
    sentimentScore += 30;
  } else if (smartMoney >= 3) {
    sentimentScore += 22;
  } else if (smartMoney >= 1) {
    sentimentScore += 12;
  }

  // Holder growth proxy (0-20 points)
  // More holders = more distributed = healthier
  if (holders > 5000) {
    sentimentScore += 20;
  } else if (holders > 1000) {
    sentimentScore += 15;
  } else if (holders > 200) {
    sentimentScore += 10;
  } else if (holders > 50) {
    sentimentScore += 5;
  }

  // v2_score (0-15 points)
  if (v2Score > 80) {
    sentimentScore += 15;
  } else if (v2Score > 60) {
    sentimentScore += 10;
  } else if (v2Score > 40) {
    sentimentScore += 5;
  }

  // Convert score to prediction
  // 0-100 → 0.4-4.0 range
  let prediction: number;
  if (sentimentScore >= 80) {
    // Maximum hype — very bullish
    prediction = 3.0 + (sentimentScore - 80) / 25;
  } else if (sentimentScore >= 50) {
    // Strong sentiment — bullish
    prediction = 1.8 + (sentimentScore - 50) / 25;
  } else if (sentimentScore >= 25) {
    // Moderate sentiment — mildly bullish
    prediction = 1.1 + (sentimentScore - 25) / 40;
  } else if (sentimentScore >= 10) {
    // Weak sentiment — neutral
    prediction = 0.8 + sentimentScore / 60;
  } else {
    // No sentiment — bearish (no one cares about this token)
    prediction = 0.5 + sentimentScore / 20;
  }

  // Age modifier — early sentiment signals are stronger
  if (age < 30 && sentimentScore > 40) {
    prediction *= 1.15; // New token with strong sentiment = potential gem
  } else if (age > 1440 && sentimentScore < 20) {
    prediction *= 0.9; // Old token with no buzz = fading
  }

  // Small noise
  const noise = (Math.random() - 0.5) * 0.12;

  return clamp(prediction + noise, 0.3, 5.0);
}
