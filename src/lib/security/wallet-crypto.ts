import crypto from 'crypto';

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 16;
const AUTH_TAG_LENGTH_BYTES = 16;
const PRIVATE_KEY_REGEX = /^0x[a-fA-F0-9]{64}$/;

function assertHexLength(value: string, expectedBytes: number, label: string) {
  if (!/^[a-fA-F0-9]+$/.test(value) || value.length !== expectedBytes * 2) {
    throw new Error(`Invalid ${label}`);
  }
}

export function getWalletMasterKey(): Buffer {
  const masterKey = process.env.NFA_WALLET_MASTER_KEY;

  if (!masterKey || masterKey.length !== 64 || !/^[a-fA-F0-9]{64}$/.test(masterKey)) {
    throw new Error('NFA_WALLET_MASTER_KEY must be a 32-byte hex string (64 chars)');
  }

  return Buffer.from(masterKey, 'hex');
}

export function encryptPrivateKey(privateKey: string): string {
  if (!PRIVATE_KEY_REGEX.test(privateKey)) {
    throw new Error('Invalid private key format');
  }

  const key = getWalletMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(privateKey, 'utf8')),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptPrivateKey(encryptedData: string): string {
  const [ivHex, authTagHex, ciphertextHex] = encryptedData.split(':');

  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error('Invalid encrypted data format');
  }

  assertHexLength(ivHex, IV_LENGTH_BYTES, 'IV');
  assertHexLength(authTagHex, AUTH_TAG_LENGTH_BYTES, 'auth tag');
  if (!/^[a-fA-F0-9]+$/.test(ciphertextHex)) {
    throw new Error('Invalid ciphertext');
  }

  const key = getWalletMasterKey();
  const decipher = crypto.createDecipheriv(
    ENCRYPTION_ALGORITHM,
    key,
    Buffer.from(ivHex, 'hex')
  );

  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');

  if (!PRIVATE_KEY_REGEX.test(decrypted)) {
    throw new Error('Decrypted private key has invalid format');
  }

  return decrypted;
}
