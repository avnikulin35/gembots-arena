import { ethers } from 'ethers';
import NFAv5ABI from '@/contracts/GemBotsNFAv5.json';
import { BSC_RPC_URL, NFA_CONTRACT_ADDRESS } from '@/lib/nfa';

const ADDRESS_ZERO = ethers.ZeroAddress;

let cachedProvider: ethers.JsonRpcProvider | null = null;
let cachedContract: ethers.Contract | null = null;

function getProvider() {
  if (!cachedProvider) {
    cachedProvider = new ethers.JsonRpcProvider(
      process.env.BSC_RPC_URL || BSC_RPC_URL,
      56
    );
  }

  return cachedProvider;
}

function getContract() {
  if (!cachedContract) {
    cachedContract = new ethers.Contract(NFA_CONTRACT_ADDRESS, NFAv5ABI.abi, getProvider());
  }

  return cachedContract;
}

export function normalizeAddress(address: string): string {
  return ethers.getAddress(address);
}

export async function getOnChainOwnerAddress(nfaId: number): Promise<string | null> {
  try {
    const owner = await getContract().ownerOf(nfaId);
    return normalizeAddress(owner);
  } catch {
    return null;
  }
}

/**
 * Verify that the caller owns the given NFA.
 *
 * Returns { verified: true, onChainOwner } when on-chain confirms the caller.
 * Returns { verified: false, onChainOwner } when on-chain disagrees (or is unavailable).
 *
 * Callers should treat verified=true as strong proof and verified=false
 * as a signal to fall back to DB-only checks (or reject, depending on policy).
 */
export async function verifyNfaOwnership(params: {
  nfaId: number;
  ownerAddress: string;
  recordedOwnerAddress?: string | null;
}): Promise<{ verified: boolean; onChainOwner: string | null }> {
  const requestedOwner = normalizeAddress(params.ownerAddress);
  const recordedOwner = params.recordedOwnerAddress ? normalizeAddress(params.recordedOwnerAddress) : null;
  const onChainOwner = await getOnChainOwnerAddress(params.nfaId);

  if (!onChainOwner || onChainOwner === ADDRESS_ZERO) return { verified: false, onChainOwner: null };
  if (onChainOwner !== requestedOwner) return { verified: false, onChainOwner };
  if (recordedOwner && recordedOwner !== onChainOwner) return { verified: false, onChainOwner };

  return { verified: true, onChainOwner };
}
