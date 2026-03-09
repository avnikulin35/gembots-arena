/**
 * Trading Engine — P&L based battle logic
 */

export interface TradingDecision {
  action: 'BUY' | 'SELL' | 'HOLD';
  size: number;        // 0-1 (fraction of virtual balance)
  leverage: number;    // 1-20
  confidence: number;  // 0-1
  take_profit: number; // % price move
  stop_loss: number;   // % price move
  reasoning: string;
}

export interface MarketSnapshot {
  symbol: string;
  price: number;
  price_1h_pct: number;
  price_24h_pct: number;
  volume_24h: number;
  orderbook_imbalance: number;
  funding_rate: number;
  open_interest: number;
  rsi_14: number;
  ema_9: number;
  ema_21: number;
  macd: { macd: number; signal: number; histogram: number };
}

/**
 * Calculates the P&L percentage for a trading decision.
 * @param decision The trading decision (BUY, SELL, HOLD, size, leverage, TP, SL).
 * @param entryPrice The price at which the trade was entered.
 * @param exitPrice The price at which the trade was exited.
 * @param marketPrices An array of prices during the trade timeframe to check for TP/SL hit.
 * @returns The P&L percentage.
 */
export function calculatePnL(
  decision: TradingDecision,
  entryPrice: number,
  exitPrice: number,
  marketPrices: number[] // Prices at 1-minute intervals during the 15 min timeframe
): number {
  if (decision.action === 'HOLD') {
    return 0;
  }

  let finalExitPrice = exitPrice;

  // Check for Take Profit / Stop Loss hit
  if (decision.take_profit > 0 || decision.stop_loss > 0) {
    for (const price of marketPrices) {
      const priceMove = ((price - entryPrice) / entryPrice) * 100;

      if (decision.action === 'BUY') { // Long position
        if (decision.take_profit > 0 && priceMove >= decision.take_profit) {
          finalExitPrice = entryPrice * (1 + decision.take_profit / 100);
          break;
        }
        if (decision.stop_loss > 0 && priceMove <= -decision.stop_loss) {
          finalExitPrice = entryPrice * (1 - decision.stop_loss / 100);
          break;
        }
      } else if (decision.action === 'SELL') { // Short position
        if (decision.take_profit > 0 && priceMove <= -decision.take_profit) {
          finalExitPrice = entryPrice * (1 - decision.take_profit / 100);
          break;
        }
        if (decision.stop_loss > 0 && priceMove >= decision.stop_loss) {
          finalExitPrice = entryPrice * (1 + decision.stop_loss / 100);
          break;
        }
      }
    }
  }

  let priceChangePct = ((finalExitPrice - entryPrice) / entryPrice) * 100;

  if (decision.action === 'SELL') { // Reverse P&L for short positions
    priceChangePct = -priceChangePct;
  }

  // P&L = size * leverage * priceChangePct
  return decision.size * decision.leverage * priceChangePct;
}

/**
 * Determines the winner of a trading battle based on P&L.
 * @param bot1_pnl P&L of bot 1.
 * @param bot2_pnl P&L of bot 2.
 * @param bot1_action Action of bot 1.
 * @param bot2_action Action of bot 2.
 * @returns The ID of the winning bot, or null for a draw.
 */
export function determineWinner(
  bot1_id: number, bot1_pnl: number, bot1_action: TradingDecision['action'],
  bot2_id: number, bot2_pnl: number, bot2_action: TradingDecision['action']
): number | null {
  if (bot1_action === 'HOLD' && bot2_action === 'HOLD') {
    return null; // Both HOLD, it's a draw
  }

  if (bot1_action === 'HOLD') {
    return bot2_pnl < 0 ? bot1_id : bot2_id; // If bot2 lost, bot1 wins (HOLD is better than loss), else bot2 wins
  }

  if (bot2_action === 'HOLD') {
    return bot1_pnl < 0 ? bot2_id : bot1_id; // If bot1 lost, bot2 wins (HOLD is better than loss), else bot1 wins
  }

  // Neither is HOLD, compare P&L
  if (bot1_pnl > bot2_pnl) {
    return bot1_id;
  } else if (bot2_pnl > bot1_pnl) {
    return bot2_id;
  } else {
    return null; // Equal P&L, it's a draw
  }
}

/**
 * Calculates ELO change for winner and loser.
 * @param winnerElo ELO of the winner.
 * @param loserElo ELO of the loser.
 * @param isDraw True if it's a draw, false otherwise.
 * @param kFactor The K-factor for ELO calculation (default 32).
 * @returns An array containing [winnerDelta, loserDelta].
 */
export function eloChange(winnerElo: number, loserElo: number, isDraw: boolean, kFactor: number = 32): [number, number] {
  const expectedWinA = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
  const expectedWinB = 1 / (1 + Math.pow(10, (winnerElo - loserElo) / 400));

  let winnerScore = 1;
  let loserScore = 0;

  if (isDraw) {
    winnerScore = 0.5;
    loserScore = 0.5;
  }

  const winnerDelta = kFactor * (winnerScore - expectedWinA);
  const loserDelta = kFactor * (loserScore - expectedWinB);

  return [winnerDelta, loserDelta];
}
