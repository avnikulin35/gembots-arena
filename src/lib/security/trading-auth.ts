import { createClient } from '@supabase/supabase-js';
import { isAddress, verifyMessage } from 'ethers';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const TRADING_CHAIN_ID = 56;
const TRADING_CONTRACT = (process.env.NEXT_PUBLIC_BSC_NFA_CONTRACT_ADDRESS || 'unknown').toLowerCase();

if (!supabaseUrl) {
  throw new Error('SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) is required for trading auth');
}

if (!supabaseServiceRoleKey) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY (or legacy SUPABASE_SERVICE_KEY) is required for trading auth');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);
const NONCE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class TradingAuthError extends Error {
  status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

interface BaseAuthPayload {
  nfaId: number;
  ownerAddress: string;
  signedMessage: string;
  signature: string;
  nonce: string;
  timestamp: number | string;
}

export interface WalletSignaturePayload extends BaseAuthPayload {}

export interface TradeSignaturePayload extends BaseAuthPayload {
  action: 'BUY' | 'SELL' | string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string | number;
}

function normalizeTimestamp(value: number | string): string {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string' && value.trim()) return value.trim();
  throw new TradingAuthError('timestamp is required', 400);
}

function parseTimestampMs(value: string): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new TradingAuthError('timestamp must be a unix timestamp in milliseconds', 400);
  }
  return numeric;
}

function normalizeOwnerAddress(ownerAddress: string): string {
  if (!ownerAddress || !isAddress(ownerAddress)) {
    throw new TradingAuthError('ownerAddress must be a valid EVM address', 400);
  }
  return ownerAddress;
}

function validateBasePayload(payload: BaseAuthPayload): { timestamp: string } {
  if (!Number.isInteger(payload.nfaId) || payload.nfaId <= 0) {
    throw new TradingAuthError('nfaId must be a positive integer', 400);
  }

  normalizeOwnerAddress(payload.ownerAddress);

  if (!payload.nonce || !UUID_REGEX.test(payload.nonce)) {
    throw new TradingAuthError('nonce must be a valid uuid', 400);
  }

  if (!payload.signature || !payload.signature.startsWith('0x')) {
    throw new TradingAuthError('signature is required', 400);
  }

  if (!payload.signedMessage || typeof payload.signedMessage !== 'string') {
    throw new TradingAuthError('signedMessage is required', 400);
  }

  const timestamp = normalizeTimestamp(payload.timestamp);
  const timestampMs = parseTimestampMs(timestamp);
  if (Math.abs(Date.now() - timestampMs) > SIGNATURE_MAX_AGE_MS) {
    throw new TradingAuthError('timestamp expired or invalid', 401);
  }

  return { timestamp };
}

export function buildWalletMessage(nfaId: number, nonce: string, timestamp: number | string): string {
  return `GemBots Trade|nfaId=${nfaId}|nonce=${nonce}|timestamp=${normalizeTimestamp(timestamp)}`;
}

export function buildTradeMessage(payload: {
  nfaId: number;
  action: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string | number;
  nonce: string;
  timestamp: number | string;
}): string {
  const action = String(payload.action).toUpperCase();
  const tokenIn = String(payload.tokenIn).toLowerCase();
  const tokenOut = String(payload.tokenOut).toLowerCase();
  const amountIn = String(payload.amountIn);
  const nonce = payload.nonce;
  const timestamp = normalizeTimestamp(payload.timestamp);
  return `GemBots Trade|chainId=${TRADING_CHAIN_ID}|contract=${TRADING_CONTRACT}|nfaId=${payload.nfaId}|action=${action}|tokenIn=${tokenIn}|tokenOut=${tokenOut}|amountIn=${amountIn}|nonce=${nonce}|timestamp=${timestamp}`;
}

async function markNonceUsed(nonce: string): Promise<void> {
  const cutoff = new Date(Date.now() - NONCE_MAX_AGE_MS).toISOString();
  await supabaseAdmin.from('used_nonces').delete().lt('used_at', cutoff);

  const { error } = await supabaseAdmin.from('used_nonces').insert({
    nonce,
    used_at: new Date().toISOString(),
  });

  if (!error) return;

  if (error.code === '23505') {
    throw new TradingAuthError('nonce already used', 401);
  }

  throw new Error(`Failed to persist nonce: ${error.message}`);
}

async function verifySignedMessage(payload: BaseAuthPayload, expectedMessage: string): Promise<{ ownerAddress: string; message: string }> {
  const recoveredAddress = verifyMessage(expectedMessage, payload.signature);
  if (recoveredAddress.toLowerCase() !== payload.ownerAddress.toLowerCase()) {
    throw new TradingAuthError('signature verification failed', 401);
  }

  await markNonceUsed(payload.nonce);

  return {
    ownerAddress: recoveredAddress,
    message: expectedMessage,
  };
}

/**
 * Wallet operations use a narrower signature because they do not bind trade execution parameters.
 */
export async function verifyWalletSignature(payload: WalletSignaturePayload): Promise<{ ownerAddress: string; message: string }> {
  const { timestamp } = validateBasePayload(payload);
  const expectedMessage = buildWalletMessage(payload.nfaId, payload.nonce, timestamp);

  if (payload.signedMessage !== expectedMessage) {
    throw new TradingAuthError('signed message mismatch', 401);
  }

  return verifySignedMessage(payload, expectedMessage);
}

/**
 * Trade execution must bind every mutating trade parameter to the signature.
 */
export async function verifyTradeSignature(payload: TradeSignaturePayload): Promise<{ ownerAddress: string; message: string }> {
  const { timestamp } = validateBasePayload(payload);

  if (!payload.action || !['BUY', 'SELL'].includes(String(payload.action).toUpperCase())) {
    throw new TradingAuthError('action must be BUY or SELL', 400);
  }

  if (!payload.tokenIn || !payload.tokenOut) {
    throw new TradingAuthError('tokenIn and tokenOut are required', 400);
  }

  if (payload.amountIn === undefined || payload.amountIn === null || String(payload.amountIn) === '') {
    throw new TradingAuthError('amountIn is required', 400);
  }

  const expectedMessage = buildTradeMessage({
    nfaId: payload.nfaId,
    action: payload.action,
    tokenIn: payload.tokenIn,
    tokenOut: payload.tokenOut,
    amountIn: payload.amountIn,
    nonce: payload.nonce,
    timestamp,
  });

  if (payload.signedMessage !== expectedMessage) {
    throw new TradingAuthError('signed message mismatch', 401);
  }

  return verifySignedMessage(payload, expectedMessage);
}
