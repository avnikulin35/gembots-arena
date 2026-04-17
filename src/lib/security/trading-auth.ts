import { createClient } from '@supabase/supabase-js';
import { isAddress, verifyMessage } from 'ethers';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error('SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) is required for trading auth');
}

if (!supabaseServiceRoleKey) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for trading auth');
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

export interface TradingAuthPayload {
  nfaId: number;
  ownerAddress: string;
  signedMessage: string;
  signature: string;
  nonce: string;
  timestamp: number | string;
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

export function buildTradingMessage(nfaId: number, nonce: string, timestamp: number | string): string {
  return `GemBots Trade|nfaId=${nfaId}|nonce=${nonce}|timestamp=${normalizeTimestamp(timestamp)}`;
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

export async function authorizeTradingMutation(payload: TradingAuthPayload): Promise<{ ownerAddress: string; message: string }> {
  const { nfaId, ownerAddress, signedMessage, signature, nonce } = payload;

  if (!Number.isInteger(nfaId) || nfaId <= 0) {
    throw new TradingAuthError('nfaId must be a positive integer', 400);
  }

  if (!ownerAddress || !isAddress(ownerAddress)) {
    throw new TradingAuthError('ownerAddress must be a valid EVM address', 400);
  }

  if (!nonce || !UUID_REGEX.test(nonce)) {
    throw new TradingAuthError('nonce must be a valid uuid', 400);
  }

  if (!signature || !signature.startsWith('0x')) {
    throw new TradingAuthError('signature is required', 400);
  }

  if (!signedMessage || typeof signedMessage !== 'string') {
    throw new TradingAuthError('signedMessage is required', 400);
  }

  const timestamp = normalizeTimestamp(payload.timestamp);
  const timestampMs = parseTimestampMs(timestamp);
  if (Math.abs(Date.now() - timestampMs) > SIGNATURE_MAX_AGE_MS) {
    throw new TradingAuthError('timestamp expired or invalid', 401);
  }

  const expectedMessage = buildTradingMessage(nfaId, nonce, timestamp);
  if (signedMessage !== expectedMessage) {
    throw new TradingAuthError('signed message mismatch', 401);
  }

  const recoveredAddress = verifyMessage(expectedMessage, signature);
  if (recoveredAddress.toLowerCase() != ownerAddress.toLowerCase()) {
    throw new TradingAuthError('signature verification failed', 401);
  }

  await markNonceUsed(nonce);

  return {
    ownerAddress: recoveredAddress,
    message: expectedMessage,
  };
}
