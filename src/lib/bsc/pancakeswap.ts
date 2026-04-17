/**
 * PancakeSwap V3 / SmartRouter Adapter for GemBots NFA Live Trading
 *
 * Production-shaped wrapper around PancakeSwap SmartRouter on BSC mainnet.
 * Uses ethers.js v6 (already in deps). NO extra SDK packages.
 *
 * Router: 0x13f4EA83D0bd40E75C8222255bc855a974568Dd4 (V3 SmartRouter)
 * Fallback (V2): 0x10ED43C718714eb63d5aA57B78B54704E256024E
 *
 * Safety limits:
 *   - Max 0.1 BNB per trade
 *   - Slippage: default 50 bps, max 200 bps (2%)
 *   - Min BNB gas reserve: 0.005 BNB
 */

import { ethers, JsonRpcProvider, Contract, Wallet } from 'ethers';

// ─── Constants ───────────────────────────────────────────────────────────────

export const BSC_RPC_URL = process.env.NEXT_PUBLIC_BSC_RPC || 'https://bsc-dataseed.binance.org/';
export const BSC_CHAIN_ID = 56;

// PancakeSwap V3 SmartRouter
export const PANCAKE_ROUTER_V3 = '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4';
// PancakeSwap V2 Router (fallback)
export const PANCAKE_ROUTER_V2 = '0x10ED43C718714eb63d5aA57B78B54704E256024E';

// Wrapped BNB
export const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';

// Major tokens on BSC
export const TOKENS: Record<string, string> = {
  WBNB: WBNB,
  BNB: WBNB,
  USDT: '0x55d398326f99059fF775485246999027B3197955',
  USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
  CAKE: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82',
  ETH: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
  BTCB: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c',
  BUSD: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
};

// Safety limits
export const MAX_TRADE_BNB = 0.1;
export const MIN_GAS_RESERVE_BNB = 0.005;
export const DEFAULT_SLIPPAGE_BPS = 50;    // 0.5%
export const MAX_SLIPPAGE_BPS = 200;       // 2%
export const DEFAULT_GAS_PRICE_GWEI = 3;
export const SWAP_DEADLINE_SECONDS = 300;   // 5 min
export const SWAP_GAS_LIMIT_V2 = 350_000;
export const SWAP_GAS_LIMIT_V3 = 500_000;

// ─── Minimal ABIs ────────────────────────────────────────────────────────────

// V2 Router (used for price quotes + fallback swaps)
const ROUTER_V2_ABI = [
  'function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)',
  'function swapExactETHForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external payable returns (uint256[] memory amounts)',
  'function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts)',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts)',
  'function WETH() external pure returns (address)',
];

// PancakeSwap V3 SmartRouter ABI — minimal subset for swapping
// https://docs.pancakeswap.finance/code/smart-router-v3
const SMART_ROUTER_V3_ABI = [
  // V3 exactInput: swap with a path encoded as bytes
  'function exactInput((bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum) params) external payable returns (uint256 amountOut)',
  // V3 exactOutput
  'function exactOutput((bytes path, address recipient, uint256 amountOut, uint256 amountInMaximum) params) external payable returns (uint256 amountIn)',
  // V2 compatibility via SmartRouter
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts)',
  'function swapExactETHForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external payable returns (uint256[] memory amounts)',
  'function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts)',
];

// ERC20
const ERC20_ABI = [
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
];

// ─── Provider Factory ────────────────────────────────────────────────────────

let _provider: JsonRpcProvider | null = null;

export function getProvider(): JsonRpcProvider {
  if (!_provider) {
    _provider = new ethers.JsonRpcProvider(BSC_RPC_URL, BSC_CHAIN_ID);
  }
  return _provider;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getRouterV2(provider: JsonRpcProvider | Wallet): Contract {
  return new Contract(PANCAKE_ROUTER_V2, ROUTER_V2_ABI, provider);
}

function getTokenContract(address: string, provider: JsonRpcProvider | Wallet): Contract {
  return new Contract(address, ERC20_ABI, provider);
}

/**
 * Resolve token symbol or address to canonical address
 */
export function resolveToken(token: string): string {
  const upper = token.toUpperCase();
  return TOKENS[upper] || token;
}

/**
 * Build optimal path for V2 swap. Always routes through WBNB if needed.
 */
function buildPath(tokenIn: string, tokenOut: string): string[] {
  const addrIn = resolveToken(tokenIn);
  const addrOut = resolveToken(tokenOut);

  if (addrIn === addrOut) throw new Error('tokenIn === tokenOut');

  // If either is WBNB → direct pair
  if (addrIn === WBNB || addrOut === WBNB) {
    return [addrIn, addrOut];
  }
  // Otherwise route through WBNB
  return [addrIn, WBNB, addrOut];
}

/**
 * Encode V3 path: tokenIn → fee0 → tokenMid → fee1 → tokenOut
 * Uses 0.3% (3000) fee tiers.
 */
function encodeV3Path(path: string[]): string {
  const FEE_3000 = '000bb8'; // 0.3% in hex
  let encoded = path[0].slice(2).toLowerCase(); // remove 0x
  for (let i = 1; i < path.length; i++) {
    encoded += FEE_3000 + path[i].slice(2).toLowerCase();
  }
  return '0x' + encoded;
}

// ─── Token Helpers ───────────────────────────────────────────────────────────

/**
 * Get ERC20 token decimals (defaults to 18 for BNB)
 */
export async function getTokenDecimals(token: string): Promise<number> {
  const addr = resolveToken(token);
  if (addr === WBNB) return 18;
  const provider = getProvider();
  const tokenContract = getTokenContract(addr, provider);
  return Number(await tokenContract.decimals());
}

/**
 * Get token balance for a wallet address
 */
export async function getTokenBalance(walletAddress: string, token: string): Promise<string> {
  const addr = resolveToken(token);
  const provider = getProvider();

  if (addr === WBNB) {
    const balance = await provider.getBalance(walletAddress);
    return ethers.formatEther(balance);
  }

  const tokenContract = getTokenContract(addr, provider);
  const [balance, decimals] = await Promise.all([
    tokenContract.balanceOf(walletAddress),
    tokenContract.decimals(),
  ]);
  return ethers.formatUnits(balance, Number(decimals));
}

// ─── Quote / Price ───────────────────────────────────────────────────────────

export interface QuoteResult {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  amountOutWei: string;
  path: string[];
  priceImpactBps: number;
}

/**
 * Get a swap quote — how much tokenOut you get for amountIn of tokenIn
 * Uses V2 Router for quotes (simpler, works for all pairs).
 */
export async function getQuote(
  tokenIn: string,
  tokenOut: string,
  amountIn: string | number,
): Promise<QuoteResult> {
  const provider = getProvider();
  const router = getRouterV2(provider);

  const addrIn = resolveToken(tokenIn);
  const addrOut = resolveToken(tokenOut);

  const decimalsIn = addrIn === WBNB ? 18 : (await getTokenContract(addrIn, provider).decimals());
  const decimalsOut = addrOut === WBNB ? 18 : (await getTokenContract(addrOut, provider).decimals());

  const amountInWei = ethers.parseUnits(String(amountIn), Number(decimalsIn));
  const path = buildPath(tokenIn, tokenOut);

  try {
    const amounts = await router.getAmountsOut(amountInWei, path);
    const amountOutWei = amounts[amounts.length - 1];
    const amountOut = ethers.formatUnits(amountOutWei, Number(decimalsOut));

    return {
      tokenIn,
      tokenOut,
      amountIn: String(amountIn),
      amountOut,
      amountOutWei: amountOutWei.toString(),
      path,
      priceImpactBps: 0, // TODO: compute with mid-price oracle if needed
    };
  } catch (err: any) {
    throw new Error(`getQuote failed for ${tokenIn}→${tokenOut}: ${err.message}`);
  }
}

/**
 * Get the price of a token pair as tokenOut per tokenIn.
 * E.g. getTokenPrice('BNB', 'USDT') → how much USDT 1 BNB buys
 */
export async function getTokenPrice(
  baseToken: string,
  quoteToken: string = 'USDT',
): Promise<string> {
  const amountIn = 1; // always quote 1 unit
  const quote = await getQuote(baseToken, quoteToken, amountIn);
  return quote.amountOut;
}

// ─── Gas Estimation ──────────────────────────────────────────────────────────

export async function estimateGasBnB(walletAddress: string): Promise<{
  bnbBalance: string;
  hasMinGas: boolean;
  minGasBnb: string;
}> {
  const provider = getProvider();
  const balance = await provider.getBalance(walletAddress);

  return {
    bnbBalance: ethers.formatEther(balance),
    hasMinGas: balance >= ethers.parseEther(String(MIN_GAS_RESERVE_BNB)),
    minGasBnb: String(MIN_GAS_RESERVE_BNB),
  };
}

// ─── Slippage Validation ─────────────────────────────────────────────────────

export function validateSlippage(slippageBps: number): number {
  if (isNaN(slippageBps) || slippageBps < 0) {
    return DEFAULT_SLIPPAGE_BPS;
  }
  if (slippageBps > MAX_SLIPPAGE_BPS) {
    throw new Error(`Slippage ${slippageBps} bps exceeds maximum ${MAX_SLIPPAGE_BPS} bps (${MAX_SLIPPAGE_BPS / 100}%)`);
  }
  return slippageBps;
}

export function validateAmountBnb(amountBnb: number): number {
  if (isNaN(amountBnb) || amountBnb <= 0) {
    throw new Error(`Invalid trade amount: ${amountBnb}`);
  }
  if (amountBnb > MAX_TRADE_BNB) {
    throw new Error(`Trade amount ${amountBnb} BNB exceeds safety limit of ${MAX_TRADE_BNB} BNB`);
  }
  return amountBnb;
}

// ─── Swap Execution ──────────────────────────────────────────────────────────

export interface SwapResult {
  txHash: string;
  blockNumber: number;
  amountIn: string;
  amountOut: string;
  gasUsed: string;
  gasPriceGwei: string;
  gasCostBnb: string;
}

/**
 * Execute a BUY: swap BNB → token via PancakeSwap V3 SmartRouter (V2 fallback)
 *
 * IMPORTANT: V3 SmartRouter exactInput requires ABI-encoded path bytes.
 * We use the V2 wrapper method available on SmartRouter for reliability until
 * @pancakeswap/smart-router package is added.
 */
export async function executeBuy(
  wallet: Wallet,
  tokenOut: string,
  amountBnb: number,
  slippageBps: number = DEFAULT_SLIPPAGE_BPS,
): Promise<SwapResult> {
  const provider = getProvider();
  const signer = wallet.connect(provider);

  // Validate
  validateAmountBnb(amountBnb);
  validateSlippage(slippageBps);

  const addrOut = resolveToken(tokenOut);
  const path = [WBNB, addrOut];

  // Check balance
  const balance = await provider.getBalance(wallet.address);
  const amountWei = ethers.parseEther(String(amountBnb));
  const gasReserve = ethers.parseEther(String(MIN_GAS_RESERVE_BNB));

  if (balance < amountWei + gasReserve) {
    const balFormatted = ethers.formatEther(balance);
    throw new Error(
      `Insufficient BNB balance: ${balFormatted} BNB (need ${amountBnb} + ${MIN_GAS_RESERVE_BNB} gas reserve)`,
    );
  }

  // Get quote for slippage
  const router = getRouterV2(signer);
  const amounts = await router.getAmountsOut(amountWei, path);
  const expectedOut = amounts[amounts.length - 1];
  const slippageFactor = BigInt(10000 - slippageBps);
  const minAmountOut = (expectedOut * slippageFactor) / BigInt(10000);

  const deadline = Math.floor(Date.now() / 1000) + SWAP_DEADLINE_SECONDS;
  const gasPrice = ethers.parseUnits(String(DEFAULT_GAS_PRICE_GWEI), 'gwei');

  console.log(`[PancakeSwap] BUY: ${amountBnb} BNB → ${tokenOut} (slippage: ${slippageBps} bps)`);

  // Use V2 swap via SmartRouter (has V2 fallback built-in)
  const tx = await router.swapExactETHForTokens(
    minAmountOut,
    path,
    wallet.address,
    deadline,
    {
      value: amountWei,
      gasPrice,
      gasLimit: SWAP_GAS_LIMIT_V2,
    },
  );

  console.log(`[PancakeSwap] BUY tx submitted: ${tx.hash}`);
  const receipt = await tx.wait();

  const gasUsed = receipt.gasUsed;
  const gasCostBnb = ethers.formatEther(gasUsed * gasPrice);

  const decimalsOut = addrOut === WBNB ? 18 : await getTokenDecimals(addrOut);

  return {
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    amountIn: `${amountBnb} BNB`,
    amountOut: ethers.formatUnits(expectedOut, Number(decimalsOut)),
    gasUsed: gasUsed.toString(),
    gasPriceGwei: String(DEFAULT_GAS_PRICE_GWEI),
    gasCostBnb,
  };
}

/**
 * Execute a SELL: swap token → BNB via PancakeSwap
 */
export async function executeSell(
  wallet: Wallet,
  tokenIn: string,
  tokenAmount: string | number,
  slippageBps: number = DEFAULT_SLIPPAGE_BPS,
): Promise<SwapResult> {
  const provider = getProvider();
  const signer = wallet.connect(provider);

  validateSlippage(slippageBps);

  const addrIn = resolveToken(tokenIn);
  const path = [addrIn, WBNB];

  const tokenContract = getTokenContract(addrIn, signer);
  const [decimalsIn, tokenBalance] = await Promise.all([
    tokenContract.decimals(),
    tokenContract.balanceOf(wallet.address),
  ]);

  const amountInWei = ethers.parseUnits(String(tokenAmount), Number(decimalsIn));

  if (tokenBalance < amountInWei) {
    const balFormatted = ethers.formatUnits(tokenBalance, Number(decimalsIn));
    throw new Error(
      `Insufficient ${tokenIn} balance: ${balFormatted} (need ${tokenAmount})`,
    );
  }

  // Check BNB for gas
  const bnbBalance = await provider.getBalance(wallet.address);
  if (bnbBalance < ethers.parseEther(String(MIN_GAS_RESERVE_BNB))) {
    throw new Error(`Insufficient BNB for gas: need ${MIN_GAS_RESERVE_BNB} BNB`);
  }

  // Approve router (if needed)
  const routerAddr = PANCAKE_ROUTER_V2; // SmartRouter can accept V2 approvals
  const allowance = await tokenContract.allowance(wallet.address, routerAddr);
  if (allowance < amountInWei) {
    console.log(`[PancakeSwap] Approving ${tokenIn} for router...`);
    const approveTx = await tokenContract.approve(routerAddr, ethers.MaxUint256, {
      gasPrice: ethers.parseUnits(String(DEFAULT_GAS_PRICE_GWEI), 'gwei'),
    });
    await approveTx.wait();
    console.log(`[PancakeSwap] Approval confirmed`);
  }

  // Get quote
  const amounts = await getRouterV2(signer).getAmountsOut(amountInWei, path);
  const expectedOut = amounts[amounts.length - 1];
  const slippageFactor = BigInt(10000 - slippageBps);
  const minAmountOut = (expectedOut * slippageFactor) / BigInt(10000);

  const deadline = Math.floor(Date.now() / 1000) + SWAP_DEADLINE_SECONDS;
  const gasPrice = ethers.parseUnits(String(DEFAULT_GAS_PRICE_GWEI), 'gwei');

  console.log(`[PancakeSwap] SELL: ${tokenAmount} ${tokenIn} → BNB (slippage: ${slippageBps} bps)`);

  const tx = await getRouterV2(signer).swapExactTokensForETH(
    amountInWei,
    minAmountOut,
    path,
    wallet.address,
    deadline,
    {
      gasPrice,
      gasLimit: SWAP_GAS_LIMIT_V2,
    },
  );

  console.log(`[PancakeSwap] SELL tx submitted: ${tx.hash}`);
  const receipt = await tx.wait();
  const gasUsed = receipt.gasUsed;
  const gasCostBnb = ethers.formatEther(gasUsed * gasPrice);

  return {
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    amountIn: `${tokenAmount} ${tokenIn}`,
    amountOut: `${ethers.formatEther(expectedOut)} BNB`,
    gasUsed: gasUsed.toString(),
    gasPriceGwei: String(DEFAULT_GAS_PRICE_GWEI),
    gasCostBnb,
  };
}

// ─── Live Trading Guard ──────────────────────────────────────────────────────

export function isLiveTradingEnabled(): boolean {
  return process.env.NFA_LIVE_TRADING_ENABLED === 'true';
}

export function getLiveTradingGuard(): { enabled: boolean; reason?: string } {
  if (!isLiveTradingEnabled()) {
    return { enabled: false, reason: 'NFA_LIVE_TRADING_ENABLED is not set to "true"' };
  }
  return { enabled: true };
}
