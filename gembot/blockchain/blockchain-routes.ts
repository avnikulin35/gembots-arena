/**
 * Blockchain routes for TON integration
 * - Link wallet address to user
 * - Check NFT ownership (premium access)
 * - Record memory hash on-chain
 * - Verify memory hash
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import db from '../db';

const router = Router();

// ==================== DB MIGRATION ====================
try { db.exec(`ALTER TABLE users ADD COLUMN wallet_address TEXT`); } catch {}
try {
  db.exec(`CREATE TABLE IF NOT EXISTS memory_hashes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    memory_hash TEXT NOT NULL UNIQUE,
    tx_hash TEXT,
    recorded_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_memory_hashes_hash ON memory_hashes(memory_hash)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_memory_hashes_user ON memory_hashes(user_id)`);
} catch {}

// ==================== HELPERS ====================

function shortenAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// TON API base (testnet)
const TONAPI_BASE = 'https://testnet.tonapi.io/v2';

// ==================== 1. LINK WALLET ====================

router.post('/link-wallet', (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { wallet_address } = req.body;
    if (!wallet_address || typeof wallet_address !== 'string') {
      return res.status(400).json({ error: 'wallet_address is required' });
    }

    // Basic TON address validation (raw or friendly format)
    const addr = wallet_address.trim();
    if (addr.length < 32 || addr.length > 67) {
      return res.status(400).json({ error: 'Invalid TON address format' });
    }

    db.prepare('UPDATE users SET wallet_address = ?, updated_at = datetime("now") WHERE id = ?')
      .run(addr, userId);

    res.json({
      success: true,
      wallet_address: addr,
      wallet_short: shortenAddress(addr),
    });
  } catch (err: any) {
    console.error('link-wallet error:', err.message);
    res.status(500).json({ error: 'Failed to link wallet' });
  }
});

// ==================== GET WALLET ====================

router.get('/wallet', (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const row = db.prepare('SELECT wallet_address FROM users WHERE id = ?').get(userId) as any;
    const addr = row?.wallet_address || null;

    res.json({
      wallet_address: addr,
      wallet_short: addr ? shortenAddress(addr) : null,
    });
  } catch (err: any) {
    console.error('get-wallet error:', err.message);
    res.status(500).json({ error: 'Failed to get wallet' });
  }
});

// ==================== UNLINK WALLET ====================

router.delete('/wallet', (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    db.prepare('UPDATE users SET wallet_address = NULL, updated_at = datetime("now") WHERE id = ?')
      .run(userId);

    res.json({ success: true });
  } catch (err: any) {
    console.error('unlink-wallet error:', err.message);
    res.status(500).json({ error: 'Failed to unlink wallet' });
  }
});

// ==================== 2. CHECK NFT ====================

router.get('/check-nft', async (req: Request, res: Response) => {
  try {
    const wallet = req.query.wallet as string;
    if (!wallet) return res.status(400).json({ error: 'wallet query param required' });

    // Query TON API for NFT items owned by this wallet
    const url = `${TONAPI_BASE}/accounts/${encodeURIComponent(wallet)}/nfts?limit=100&indirect_ownership=true`;
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      // If account not found or API error, user has no NFTs
      return res.json({ has_nft: false, is_premium: false, nfts: [] });
    }

    const data = await response.json();
    const nftItems = data.nft_items || [];

    // Check if any NFT is our Vitalik Access Pass
    // In production, filter by collection address
    const COLLECTION_ADDRESS = process.env.NFT_COLLECTION_ADDRESS || '';

    let hasAccessPass = false;
    const relevantNfts: any[] = [];

    for (const nft of nftItems) {
      // If collection address is set, only match that collection
      if (COLLECTION_ADDRESS) {
        const nftCollection = nft.collection?.address || '';
        if (nftCollection === COLLECTION_ADDRESS) {
          hasAccessPass = true;
          relevantNfts.push({
            address: nft.address,
            name: nft.metadata?.name || 'Vitalik Access Pass',
            image: nft.metadata?.image || null,
          });
        }
      } else {
        // Dev mode: check by metadata name pattern
        const name = (nft.metadata?.name || '').toLowerCase();
        if (name.includes('vitalik') && name.includes('pass')) {
          hasAccessPass = true;
          relevantNfts.push({
            address: nft.address,
            name: nft.metadata?.name || 'Vitalik Access Pass',
            image: nft.metadata?.image || null,
          });
        }
      }
    }

    res.json({
      has_nft: hasAccessPass,
      is_premium: hasAccessPass,
      nfts: relevantNfts,
      total_nfts: nftItems.length,
    });
  } catch (err: any) {
    console.error('check-nft error:', err.message);
    res.status(500).json({ error: 'Failed to check NFT ownership' });
  }
});

// ==================== 3. RECORD MEMORY HASH ====================

router.post('/record-memory', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { memory_text, memory_hash: providedHash } = req.body;

    // Either compute hash from text or accept pre-computed hash
    let memoryHash: string;
    if (providedHash && typeof providedHash === 'string') {
      memoryHash = providedHash;
    } else if (memory_text && typeof memory_text === 'string') {
      memoryHash = crypto.createHash('sha256').update(memory_text).digest('hex');
    } else {
      return res.status(400).json({ error: 'memory_text or memory_hash required' });
    }

    // Check if already recorded
    const existing = db.prepare('SELECT * FROM memory_hashes WHERE memory_hash = ?').get(memoryHash) as any;
    if (existing) {
      return res.json({
        success: true,
        already_recorded: true,
        memory_hash: memoryHash,
        tx_hash: existing.tx_hash,
        recorded_at: existing.recorded_at,
      });
    }

    // For MVP: record in DB with a simulated tx_hash
    // In production, this would send a TON transaction with the hash as a comment
    const txHash = `testnet_${crypto.randomBytes(32).toString('hex')}`;

    db.prepare('INSERT INTO memory_hashes (user_id, memory_hash, tx_hash) VALUES (?, ?, ?)')
      .run(userId, memoryHash, txHash);

    res.json({
      success: true,
      already_recorded: false,
      memory_hash: memoryHash,
      tx_hash: txHash,
      recorded_at: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('record-memory error:', err.message);
    res.status(500).json({ error: 'Failed to record memory hash' });
  }
});

// ==================== 4. VERIFY MEMORY HASH ====================

router.get('/verify-memory', (req: Request, res: Response) => {
  try {
    const hash = req.query.hash as string;
    if (!hash) return res.status(400).json({ error: 'hash query param required' });

    const record = db.prepare('SELECT * FROM memory_hashes WHERE memory_hash = ?').get(hash) as any;

    if (!record) {
      return res.json({ verified: false, message: 'Hash not found on-chain' });
    }

    res.json({
      verified: true,
      memory_hash: record.memory_hash,
      tx_hash: record.tx_hash,
      recorded_at: record.recorded_at,
      user_id: record.user_id,
    });
  } catch (err: any) {
    console.error('verify-memory error:', err.message);
    res.status(500).json({ error: 'Failed to verify memory hash' });
  }
});

export default router;
