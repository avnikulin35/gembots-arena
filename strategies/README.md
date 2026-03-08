# 🎮 GemBots Strategy SDK

Create custom trading strategies for GemBots Arena — the AI benchmark where models compete in crypto prediction battles.

## Quick Start

1. Copy the template: `cp -r strategies/template strategies/my-strategy`
2. Edit `strategies/my-strategy/index.ts`
3. Implement your `predict()` function
4. Submit a PR!

## Strategy Interface

Every strategy must export:

```typescript
import { MarketToken } from '../../src/lib/strategies';

// Metadata about your strategy
export const meta = {
  id: 'my-strategy',          // unique kebab-case id
  name: '🎯 My Strategy',     // display name with emoji
  description: 'What it does', // short description
  author: 'Your Name',
  version: '1.0.0',
};

// Prediction function
export function predict(token: MarketToken): number {
  // Return a prediction multiplier:
  //   < 1.0 = bearish (expect price to drop)
  //   1.0   = neutral (expect price to stay same)
  //   > 1.0 = bullish (expect price to rise)
  //   max 5.0
  return 1.0;
}
```

## MarketToken Data

Your strategy receives this data for each token:

| Field | Type | Description |
|-------|------|-------------|
| `symbol` | string | Token symbol (e.g., "DOGE") |
| `address` | string | Contract address |
| `price_usd` | number? | Current price in USD |
| `market_cap` | number? | Market capitalization |
| `volume_1h` | number? | Trading volume in last hour |
| `holders` | number? | Number of holders |
| `liquidity` | number? | Liquidity pool size |
| `age_minutes` | number? | Token age in minutes |
| `kol_mentions` | number? | KOL (Key Opinion Leader) mentions count |
| `smart_money` | number? | Smart money activity score |
| `v2_score` | number? | GemBots v2 composite score |
| `price_change_1h` | number? | Price change % in last hour |
| `swaps_count` | number? | Number of swaps |
| `risk_score` | number? | Risk score (0-100, higher = riskier) |

> **Note:** All fields except `symbol` and `address` are optional. Your strategy should handle `undefined` values gracefully.

## Example Strategies

| Strategy | Approach | Key Signals |
|----------|----------|-------------|
| [momentum](./momentum/) | Follow the trend | `price_change_1h`, `volume_1h` |
| [mean-reversion](./mean-reversion/) | Bet against extremes | `price_change_1h` |
| [sentiment](./sentiment/) | Social signals | `kol_mentions`, `smart_money` |

## Tips

- **Handle missing data**: Use nullish coalescing (`??`) for optional fields
- **Clamp your output**: Keep predictions between 0.3 and 5.0
- **Add randomness sparingly**: A small noise factor prevents ties but too much = chaos bot
- **Test your strategy**: Run it against various token scenarios before submitting
- **Be creative**: The best strategies combine multiple signals in novel ways

## Testing

```bash
# Run the test suite
npm test -- --grep "strategies"

# Manual test
npx ts-node -e "
  const { predict } = require('./strategies/my-strategy');
  console.log(predict({ symbol: 'TEST', address: '0x...', price_change_1h: 50 }));
"
```

## Submitting Your Strategy

1. Fork the repo
2. Create your strategy in `strategies/your-strategy-name/`
3. Make sure `npm run build` passes
4. Open a PR with:
   - Strategy description and rationale
   - Example scenarios showing your strategy's behavior
   - Any relevant research or references

---

Built with 🦍 by the GemBots community
