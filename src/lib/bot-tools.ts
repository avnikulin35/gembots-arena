
import { supabase } from './supabase'; // Assuming supabase client is available

interface PriceData {
  timestamp: string;
  price: number;
  volume: number; // Assuming volume will be available in token_prices or a joined table
}

interface PriceHistoryResult {
  history: PriceData[];
}

interface VelocityScannerResult {
  velocity1m: string;
  velocity5m: string;
  velocity15m: string;
  pattern: string;
}

interface SafetyCheckResult {
  riskScore: number;
  riskLevel: string;
  liquidityScore: number;
  holderScore: number;
  ageScore: number;
}

// Helper to fetch price data from Supabase
async function fetchPriceHistoryFromDb(tokenMint: string, minutes: number): Promise<PriceData[]> {
  const { data, error } = await supabase
    .from('token_prices')
    .select('timestamp, price') // Assuming volume is not directly in token_prices, will need to adapt
    .eq('mint', tokenMint)
    .gte('timestamp', new Date(Date.now() - minutes * 60 * 1000).toISOString())
    .order('timestamp', { ascending: true });

  if (error) {
    console.error('Error fetching price history:', error);
    return [];
  }

  // Placeholder for volume, actual volume would come from a more detailed price worker
  return data.map((item: any) => ({
    timestamp: item.timestamp,
    price: item.price,
    volume: 0, // TODO: Integrate actual volume if available
  }));
}

// Tool 1: Price History
export async function getPriceHistory(tokenMint: string, periods: number[] = [5, 15, 30]): Promise<Record<string, PriceHistoryResult>> {
  const results: Record<string, PriceHistoryResult> = {};
  for (const minutes of periods) {
    const history = await fetchPriceHistoryFromDb(tokenMint, minutes);
    results[`last_${minutes}_minutes`] = { history };
  }
  return results;
}

// Tool 2: Velocity Scanner
export async function getVelocitySpike(tokenMint: string): Promise<VelocityScannerResult> {
  const now = Date.now();
  const prices: { [key: string]: number | null } = {};

  // Fetch prices for 1m, 5m, 15m ago
  const fetchPriceAtTime = async (minutesAgo: number): Promise<number | null> => {
    const timeAgo = new Date(now - minutesAgo * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('token_prices')
      .select('price')
      .eq('mint', tokenMint)
      .order('timestamp', { ascending: false })
      .lt('timestamp', timeAgo) // get price *before* this time
      .limit(1);

    if (error) {
      console.error(`Error fetching price for ${minutesAgo}m ago:`, error);
      return null;
    }
    return data && data.length > 0 ? data[0].price : null;
  };

  const currentPriceData = await fetchPriceHistoryFromDb(tokenMint, 1); // Get latest price
  const currentPrice = currentPriceData.length > 0 ? currentPriceData[currentPriceData.length - 1].price : null;

  if (currentPrice === null) {
    return {
      velocity1m: 'N/A',
      velocity5m: 'N/A',
      velocity15m: 'N/A',
      pattern: 'insufficient data'
    };
  }

  prices['current'] = currentPrice;
  prices['1m_ago'] = await fetchPriceAtTime(1);
  prices['5m_ago'] = await fetchPriceAtTime(5);
  prices['15m_ago'] = await fetchPriceAtTime(15);

  const calculateVelocity = (current: number, past: number | null): string => {
    if (past === null || past === 0) return 'N/A';
    const change = ((current - past) / past) * 100;
    return change.toFixed(2) + '%';
  };

  const velocity1m = calculateVelocity(prices.current, prices['1m_ago']);
  const velocity5m = calculateVelocity(prices.current, prices['5m_ago']);
  const velocity15m = calculateVelocity(prices.current, prices['15m_ago']);

  let pattern = 'stable';
  if (parseFloat(velocity1m) > 5 && parseFloat(velocity5m) > 10 && parseFloat(velocity15m) > 15) {
    pattern = 'accelerating pump';
  } else if (parseFloat(velocity1m) < -5 && parseFloat(velocity5m) < -10 && parseFloat(velocity15m) < -15) {
    pattern = 'dumping';
  } else if (parseFloat(velocity1m) > 0 && parseFloat(velocity5m) > parseFloat(velocity1m) && parseFloat(velocity15m) > parseFloat(velocity5m)) {
    pattern = 'accelerating pump';
  } else if (parseFloat(velocity1m) < 0 && parseFloat(velocity5m) < parseFloat(velocity1m) && parseFloat(velocity15m) < parseFloat(velocity5m)) {
    pattern = 'decelerating dump'; // Added a specific dump pattern
  } else if (parseFloat(velocity1m) < 0 && parseFloat(velocity5m) > 0) {
    pattern = 'decelerating';
  }

  return { velocity1m, velocity5m, velocity15m, pattern };
}


// Tool 3: Safety Check
export async function getSafetyCheck(tokenMint: string): Promise<SafetyCheckResult> {
  // Placeholder values, actual data would come from Bybit API or other APIs
  // For now, hardcode some dummy values or fetch simple data from DB
  const liquidityDepth = 10000; // Example: $10,000
  const topHolderConcentration = 0.3; // Example: 30%
  const tokenAgeDays = 30; // Example: 30 days

  // Get token creation date from DB if available, otherwise use a default or assume it's new
  let tokenCreationDate: Date | null = null;
  const { data: predictionData, error: predictionError } = await supabase
    .from('predictions')
    .select('predicted_at')
    .eq('token_mint', tokenMint)
    .order('predicted_at', { ascending: true })
    .limit(1);

  if (!predictionError && predictionData && predictionData.length > 0) {
    tokenCreationDate = new Date(predictionData[0].predicted_at);
  } else {
    // If not in predictions, assume a default age for new tokens
    tokenCreationDate = new Date(Date.now() - tokenAgeDays * 24 * 60 * 60 * 1000);
  }

  const ageScore = Math.min(100, (Date.now() - tokenCreationDate.getTime()) / (30 * 24 * 60 * 60 * 1000) * 50); // 50 points per month, max 100

  // Placeholder for real liquidity and holder data.
  // In a real scenario, this would involve fetching from external APIs like Bybit API.
  // For this task, I'll use simple hardcoded values and integrate with the database for token age.
  const { data: tokenData, error: tokenError } = await supabase
    .from('token_prices') // Assuming we can get some basic token info from here, or a separate `tokens` table
    .select('mint') // Just to check if the token exists and get its approximate age
    .eq('mint', tokenMint)
    .limit(1);

  let realLiquidityDepth = liquidityDepth; // Placeholder
  let realTopHolderConcentration = topHolderConcentration; // Placeholder

  // If a dedicated 'tokens' table existed, we'd query it for real data.
  // For now, these are illustrative.

  let liquidityScore = 0;
  if (realLiquidityDepth > 50000) liquidityScore = 100;
  else if (realLiquidityDepth > 10000) liquidityScore = 70;
  else if (realLiquidityDepth > 1000) liquidityScore = 30;
  else liquidityScore = 0;

  let holderScore = 0;
  if (realTopHolderConcentration < 0.1) holderScore = 100;
  else if (realTopHolderConcentration < 0.3) holderScore = 70;
  else if (realTopHolderConcentration < 0.5) holderScore = 30;
  else holderScore = 0;

  const riskScore = (liquidityScore + holderScore + ageScore) / 3;

  let riskLevel = 'LOW';
  if (realLiquidityDepth < 5000 || realTopHolderConcentration > 0.5) {
    riskLevel = 'HIGH';
  } else if (riskScore < 50) {
    riskLevel = 'MEDIUM';
  }

  return { riskScore, riskLevel, liquidityScore, holderScore, ageScore };
}
