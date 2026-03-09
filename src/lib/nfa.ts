/**
 * GemBotsNFAv5 Contract Interactions — BAP-578 Compliant (Tier-Based Pricing + Metadata URI)
 * 
 * Features: BAP-578 NFA Standard, AgentMetadata, Learning Module,
 *           Battles, Evolution, Marketplace, Strategy, Proof-of-Prompt,
 *           Tier-Based Mint Pricing (Bronze/Silver/Gold)
 */

import { ethers } from 'ethers';
import NFAv5ABI from '@/contracts/GemBotsNFAv5.json';
import LearningABI from '@/contracts/GemBotsLearning.json';

// ============================================================================
// Constants
// ============================================================================

export const NFA_CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_BSC_NFA_CONTRACT_ADDRESS 
  || process.env.NEXT_PUBLIC_BSC_CONTRACT_ADDRESS 
  || '0x9bC5f392cE8C7aA13BD5bC7D5A1A12A4DD58b3D5';
export const LEARNING_CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_BSC_LEARNING_CONTRACT_ADDRESS || '';
export const BSC_CHAIN_ID = 56;
export const BSC_RPC_URL = process.env.NEXT_PUBLIC_BSC_RPC || 'https://bsc-dataseed.binance.org/';
export const BSCSCAN_BASE = 'https://bscscan.com';
export const GENESIS_MAX = 100;
/** @deprecated Use TIER_MINT_FEES[Tier.Bronze] */
export const MINT_FEE_BNB = '0.01';

// ============================================================================
// Tier System
// ============================================================================

export enum Tier {
  Bronze = 0,
  Silver = 1,
  Gold = 2,
  Diamond = 3,
  Legendary = 4,
}

/** Tier-based mint fees in BNB */
export const TIER_MINT_FEES: Record<Tier, string> = {
  [Tier.Bronze]: '0.01',
  [Tier.Silver]: '0.03',
  [Tier.Gold]: '0.1',
  [Tier.Diamond]: '0',
  [Tier.Legendary]: '0',
};

export const TIER_NAMES: Record<number, string> = {
  0: 'Bronze', 1: 'Silver', 2: 'Gold', 3: 'Diamond', 4: 'Legendary',
};

export const TIER_COLORS: Record<number, string> = {
  0: '#CD7F32', 1: '#C0C0C0', 2: '#FFD700', 3: '#B9F2FF', 4: '#FF6B6B',
};

export const TIER_GRADIENTS: Record<number, string> = {
  0: 'from-[#CD7F32]/20 to-[#8B5E3C]/20 border-[#CD7F32]/40',
  1: 'from-[#C0C0C0]/20 to-[#808080]/20 border-[#C0C0C0]/40',
  2: 'from-[#FFD700]/20 to-[#B8860B]/20 border-[#FFD700]/40',
  3: 'from-[#B9F2FF]/20 to-[#4FC3F7]/20 border-[#B9F2FF]/40',
  4: 'from-[#FF6B6B]/20 to-[#FF1744]/20 border-[#FF6B6B]/40',
};

export const TIER_GLOW: Record<number, string> = {
  0: 'shadow-[0_0_15px_rgba(205,127,50,0.3)]',
  1: 'shadow-[0_0_15px_rgba(192,192,192,0.3)]',
  2: 'shadow-[0_0_20px_rgba(255,215,0,0.4)]',
  3: 'shadow-[0_0_25px_rgba(185,242,255,0.5)]',
  4: 'shadow-[0_0_30px_rgba(255,107,107,0.5)]',
};

export const TIER_THRESHOLDS = [0, 10, 50, 100, 250];

// ============================================================================
// BAP-578 Agent Status
// ============================================================================

export enum AgentStatus {
  Active = 0,
  Paused = 1,
  Terminated = 2,
}

export const STATUS_NAMES: Record<number, string> = {
  0: 'Active', 1: 'Paused', 2: 'Terminated',
};

export const STATUS_COLORS: Record<number, string> = {
  0: 'text-green-400', 1: 'text-yellow-400', 2: 'text-red-400',
};

// ============================================================================
// Types
// ============================================================================

/** BAP-578 AgentMetadata */
export interface AgentMetadata {
  persona: string;       // JSON-encoded character traits
  experience: string;    // Agent's role/purpose summary
  voiceHash: string;     // Audio profile reference
  animationURI: string;  // Animation/avatar URI
  vaultURI: string;      // Extended data storage URI
  vaultHash: string;     // bytes32 vault content verification hash
}

/** BAP-578 Agent State */
export interface AgentState {
  balance: bigint;
  status: AgentStatus;
  owner: string;
  logicAddress: string;
  lastActionTimestamp: number;
}

export interface BattleStats {
  wins: number;
  losses: number;
  totalBattles: number;
  currentStreak: number;
  bestStreak: number;
}

export interface StrategyData {
  modelId: string;
  strategyHash: string;
  strategyURI: string;
}

export interface LearningData {
  enabled: boolean;
  module: string;
  merkleRoot: string;
  version: number;
  lastUpdate: number;
}

export interface NFAData {
  nfaId: number;
  configHash: string;
  configURI: string;
  originalCreator: string;
  tier: number;
  isGenesis: boolean;
  stats: BattleStats;
  strategy: StrategyData;
  state: AgentState;
  metadata: AgentMetadata;
  learning: LearningData;
  owner: string;
  listing?: {
    price: bigint;
    seller: string;
    active: boolean;
  };
  // Backward compat
  agentId: number;
  proofOfPrompt: string;
  wins: number;
  losses: number;
  totalBattles: number;
  currentStreak: number;
  bestStreak: number;
}

export interface MarketplaceListing {
  nfaId: number;
  nfa: NFAData;
  price: bigint;
  priceFormatted: string;
  seller: string;
}

// ============================================================================
// Default AgentMetadata
// ============================================================================

export function defaultAgentMetadata(): AgentMetadata {
  return {
    persona: '{}',
    experience: '',
    voiceHash: '',
    animationURI: '',
    vaultURI: '',
    vaultHash: ethers.ZeroHash,
  };
}

// ============================================================================
// Provider & Contract
// ============================================================================

/** @deprecated Use NFAv5ABI.abi directly. Kept for backward compat. */
export const NFA_ABI = NFAv5ABI.abi;

export function getReadProvider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(BSC_RPC_URL);
}

export function getReadContract(): ethers.Contract {
  return new ethers.Contract(NFA_CONTRACT_ADDRESS, NFAv5ABI.abi, getReadProvider());
}

export function getSignedContract(signer: ethers.Signer): ethers.Contract {
  return new ethers.Contract(NFA_CONTRACT_ADDRESS, NFAv5ABI.abi, signer);
}

export function getLearningContract(): ethers.Contract {
  return new ethers.Contract(LEARNING_CONTRACT_ADDRESS, LearningABI.abi, getReadProvider());
}

// ============================================================================
// Read Functions
// ============================================================================

export async function fetchTotalSupply(): Promise<number> {
  const contract = getReadContract();
  return Number(await contract.totalSupply());
}

export async function fetchMintFee(): Promise<string> {
  const contract = getReadContract();
  return ethers.formatEther(await contract.mintFee());
}

export async function fetchGenesisCount(): Promise<number> {
  const contract = getReadContract();
  return Number(await contract.genesisCount());
}

/** Fetch BAP-578 State for an NFA */
export async function fetchAgentState(nfaId: number): Promise<AgentState | null> {
  try {
    const contract = getReadContract();
    const state = await contract.getState(nfaId);
    return {
      balance: state.balance,
      status: Number(state.status) as AgentStatus,
      owner: state.owner,
      logicAddress: state.logicAddress,
      lastActionTimestamp: Number(state.lastActionTimestamp),
    };
  } catch {
    return null;
  }
}

/** Fetch BAP-578 AgentMetadata */
export async function fetchAgentMetadata(nfaId: number): Promise<AgentMetadata | null> {
  try {
    const contract = getReadContract();
    const meta = await contract.getAgentMetadata(nfaId);
    return {
      persona: meta.persona,
      experience: meta.experience,
      voiceHash: meta.voiceHash,
      animationURI: meta.animationURI,
      vaultURI: meta.vaultURI,
      vaultHash: meta.vaultHash,
    };
  } catch {
    return null;
  }
}

/** Fetch battle stats */
export async function fetchBattleStats(nfaId: number): Promise<BattleStats | null> {
  try {
    const contract = getReadContract();
    const stats = await contract.getBattleStats(nfaId);
    return {
      wins: Number(stats.wins),
      losses: Number(stats.losses),
      totalBattles: Number(stats.totalBattles),
      currentStreak: Number(stats.currentStreak),
      bestStreak: Number(stats.bestStreak),
    };
  } catch {
    return null;
  }
}

/** Fetch learning data */
export async function fetchLearningData(nfaId: number): Promise<LearningData | null> {
  try {
    const contract = getReadContract();
    const data = await contract.getLearningData(nfaId);
    return {
      enabled: data.enabled,
      module: data.module,
      merkleRoot: data.merkleRoot,
      version: Number(data.version),
      lastUpdate: Number(data.lastUpdate),
    };
  } catch {
    return null;
  }
}

/** Fetch full NFA data (GemBots view + BAP-578) */
export async function fetchNFA(nfaId: number): Promise<NFAData | null> {
  const contract = getReadContract();
  try {
    // getNFA returns a flat tuple:
    // [agentId, configHash, configURI, originalCreator, tier, wins, losses, totalBattles, currentStreak, bestStreak, modelId, strategyHash, strategyURI]
    const [nfaResult, ownerResult, listingResult] = await Promise.allSettled([
      contract.getNFA(nfaId),
      contract.ownerOf(nfaId),
      contract.getListing(nfaId),
    ]);

    const nfa = nfaResult.status === 'fulfilled' ? nfaResult.value : null;
    const owner = ownerResult.status === 'fulfilled' ? ownerResult.value : null;
    const list = listingResult.status === 'fulfilled' ? listingResult.value : null;

    if (!nfa || !owner) return null;

    // Destructure the flat tuple from getNFA
    const wins = Number(nfa[5] || 0);
    const losses = Number(nfa[6] || 0);
    const totalBattles = Number(nfa[7] || 0);
    const currentStreak = Number(nfa[8] || 0);
    const bestStreak = Number(nfa[9] || 0);

    const stats: BattleStats = { wins, losses, totalBattles, currentStreak, bestStreak };

    return {
      nfaId,
      configHash: nfa[1],
      configURI: nfa[2],
      originalCreator: nfa[3],
      tier: Number(nfa[4]),
      isGenesis: nfaId < GENESIS_MAX,
      stats,
      strategy: {
        modelId: nfa[10] || '',
        strategyHash: nfa[11] || '',
        strategyURI: nfa[12] || '',
      },
      state: {
        balance: BigInt(0),
        status: AgentStatus.Active,
        owner,
        logicAddress: '',
        lastActionTimestamp: 0,
      },
      metadata: defaultAgentMetadata(),
      learning: { enabled: false, module: '', merkleRoot: '', version: 0, lastUpdate: 0 },
      owner,
      listing: list && list.active ? {
        price: list.price,
        seller: list.seller,
        active: true,
      } : undefined,
      // Backward compat
      agentId: nfaId,
      proofOfPrompt: nfa[1],
      wins,
      losses,
      totalBattles,
      currentStreak,
      bestStreak,
    };
  } catch {
    return null;
  }
}

export async function fetchAllNFAs(): Promise<NFAData[]> {
  const totalSupply = await fetchTotalSupply();
  if (totalSupply === 0) return [];

  const promises = [];
  for (let i = 0; i < totalSupply; i++) {
    promises.push(fetchNFA(i));
  }
  
  const results = await Promise.allSettled(promises);
  return results
    .filter((r): r is PromiseFulfilledResult<NFAData | null> => r.status === 'fulfilled')
    .map(r => r.value)
    .filter((nfa): nfa is NFAData => nfa !== null);
}

export async function fetchMarketplaceListings(): Promise<MarketplaceListing[]> {
  const allNFAs = await fetchAllNFAs();
  return allNFAs
    .filter(nfa => nfa.listing?.active)
    .map(nfa => ({
      nfaId: nfa.nfaId,
      nfa,
      price: nfa.listing!.price,
      priceFormatted: ethers.formatEther(nfa.listing!.price),
      seller: nfa.listing!.seller,
    }));
}

// ============================================================================
// Write Functions — Minting
// ============================================================================

/**
 * Mint a new NFA v4: BAP-578 compliant with tier-based pricing
 */
export async function mintNFA(
  signer: ethers.Signer,
  configURI: string,
  strategy: string,
  modelId: string = '',
  meta?: AgentMetadata,
  tier: Tier = Tier.Bronze,
): Promise<ethers.ContractTransactionReceipt | null> {
  const contract = getSignedContract(signer);
  const fee = ethers.parseEther(TIER_MINT_FEES[tier]);
  
  const configHash = ethers.keccak256(ethers.toUtf8Bytes(configURI));
  const strategyHash = ethers.keccak256(ethers.toUtf8Bytes(strategy));
  const agentMeta = meta || defaultAgentMetadata();

  const tx = await contract.mint(
    tier,
    configHash,
    configURI,
    modelId,
    strategyHash,
    strategy,
    agentMeta,
    { value: fee }
  );
  return await tx.wait();
}

/**
 * Fetch on-chain mint fee for a specific tier
 */
export async function fetchTierMintFee(tier: Tier): Promise<string> {
  const contract = getReadContract();
  return ethers.formatEther(await contract.getMintFee(tier));
}

// ============================================================================
// Write Functions — BAP-578 Lifecycle
// ============================================================================

export async function fundAgent(
  signer: ethers.Signer,
  nfaId: number,
  amountBNB: string,
): Promise<ethers.ContractTransactionReceipt | null> {
  const contract = getSignedContract(signer);
  const tx = await contract.fundAgent(nfaId, { value: ethers.parseEther(amountBNB) });
  return await tx.wait();
}

export async function withdrawFromAgent(
  signer: ethers.Signer,
  nfaId: number,
  amountBNB: string,
): Promise<ethers.ContractTransactionReceipt | null> {
  const contract = getSignedContract(signer);
  const tx = await contract.withdrawFromAgent(nfaId, ethers.parseEther(amountBNB));
  return await tx.wait();
}

export async function pauseAgent(
  signer: ethers.Signer,
  nfaId: number,
): Promise<ethers.ContractTransactionReceipt | null> {
  const contract = getSignedContract(signer);
  const tx = await contract.pauseAgent(nfaId);
  return await tx.wait();
}

export async function unpauseAgent(
  signer: ethers.Signer,
  nfaId: number,
): Promise<ethers.ContractTransactionReceipt | null> {
  const contract = getSignedContract(signer);
  const tx = await contract.unpauseAgent(nfaId);
  return await tx.wait();
}

export async function terminateAgent(
  signer: ethers.Signer,
  nfaId: number,
): Promise<ethers.ContractTransactionReceipt | null> {
  const contract = getSignedContract(signer);
  const tx = await contract.terminate(nfaId);
  return await tx.wait();
}

export async function updateAgentMetadata(
  signer: ethers.Signer,
  nfaId: number,
  metadata: AgentMetadata,
): Promise<ethers.ContractTransactionReceipt | null> {
  const contract = getSignedContract(signer);
  const tx = await contract.updateAgentMetadata(nfaId, metadata);
  return await tx.wait();
}

export async function setLogicAddress(
  signer: ethers.Signer,
  nfaId: number,
  logicAddress: string,
): Promise<ethers.ContractTransactionReceipt | null> {
  const contract = getSignedContract(signer);
  const tx = await contract.setLogicAddress(nfaId, logicAddress);
  return await tx.wait();
}

// ============================================================================
// Write Functions — Marketplace
// ============================================================================

export async function listNFA(
  signer: ethers.Signer,
  nfaId: number,
  priceInBNB: string,
): Promise<ethers.ContractTransactionReceipt | null> {
  const contract = getSignedContract(signer);
  const tx = await contract.listForSale(nfaId, ethers.parseEther(priceInBNB));
  return await tx.wait();
}

export async function buyNFA(
  signer: ethers.Signer,
  nfaId: number,
  priceWei: bigint,
): Promise<ethers.ContractTransactionReceipt | null> {
  const contract = getSignedContract(signer);
  const tx = await contract.buyNFA(nfaId, { value: priceWei });
  return await tx.wait();
}

export async function cancelListing(
  signer: ethers.Signer,
  nfaId: number,
): Promise<ethers.ContractTransactionReceipt | null> {
  const contract = getSignedContract(signer);
  const tx = await contract.cancelListing(nfaId);
  return await tx.wait();
}

// ============================================================================
// Write Functions — Evolution & Learning
// ============================================================================

export async function evolveNFA(
  signer: ethers.Signer,
  nfaId: number,
): Promise<ethers.ContractTransactionReceipt | null> {
  const contract = getSignedContract(signer);
  const tx = await contract.evolve(nfaId);
  return await tx.wait();
}

export async function enableLearning(
  signer: ethers.Signer,
  nfaId: number,
  learningModuleAddress: string,
): Promise<ethers.ContractTransactionReceipt | null> {
  const contract = getSignedContract(signer);
  const tx = await contract.enableLearning(nfaId, learningModuleAddress);
  return await tx.wait();
}

// ============================================================================
// Gas Estimation
// ============================================================================

export async function estimateMintGas(
  signer: ethers.Signer,
  uri: string,
  strategy: string,
  tier: Tier = Tier.Bronze,
): Promise<{ gasEstimate: bigint; gasCostBNB: string } | null> {
  try {
    const contract = getSignedContract(signer);
    const fee = ethers.parseEther(TIER_MINT_FEES[tier]);
    const configHash = ethers.keccak256(ethers.toUtf8Bytes(uri));
    const strategyHash = ethers.keccak256(ethers.toUtf8Bytes(strategy));
    const meta = defaultAgentMetadata();

    const gasEstimate = await contract.mint.estimateGas(
      tier, configHash, uri, '', strategyHash, strategy, meta,
      { value: fee }
    );
    const feeData = await signer.provider!.getFeeData();
    const gasPrice = feeData.gasPrice || ethers.parseUnits('1', 'gwei');
    return {
      gasEstimate,
      gasCostBNB: ethers.formatEther(gasEstimate * gasPrice),
    };
  } catch {
    return null;
  }
}

// ============================================================================
// Utility
// ============================================================================

export function getWinRate(wins: number, totalBattles: number): string {
  if (totalBattles === 0) return '0.0';
  return ((wins / totalBattles) * 100).toFixed(1);
}

export function getEvolutionProgress(wins: number, currentTier: number): { current: number; required: number; percent: number } {
  if (currentTier >= 4) return { current: wins, required: wins, percent: 100 };
  const required = TIER_THRESHOLDS[currentTier + 1];
  const prevRequired = TIER_THRESHOLDS[currentTier];
  const progress = wins - prevRequired;
  const needed = required - prevRequired;
  return {
    current: progress,
    required: needed,
    percent: Math.min(100, (progress / needed) * 100),
  };
}

export function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function bscscanAddress(address: string): string {
  return `${BSCSCAN_BASE}/address/${address}`;
}

export function bscscanTx(hash: string): string {
  return `${BSCSCAN_BASE}/tx/${hash}`;
}

export function bscscanNFT(tokenId: number): string {
  return `${BSCSCAN_BASE}/nft/${NFA_CONTRACT_ADDRESS}/${tokenId}`;
}

export function formatAgentBalance(balance: bigint): string {
  return ethers.formatEther(balance);
}

export function parsePersona(persona: string): Record<string, unknown> {
  try {
    return JSON.parse(persona);
  } catch {
    return {};
  }
}
