-- GemBots V4 Migration: NFA ↔ Arena Link
-- Run in Supabase SQL Editor or via Management API
-- Applied: 2026-02-20

-- Add evm_address column to bots (nfa_id already exists from prior migration)
ALTER TABLE bots ADD COLUMN IF NOT EXISTS evm_address TEXT;

-- Index for fast NFA lookups
CREATE INDEX IF NOT EXISTS idx_bots_nfa_id ON bots(nfa_id) WHERE nfa_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bots_evm_address ON bots(evm_address) WHERE evm_address IS NOT NULL;

SELECT 'V4 NFA Link Migration complete! 🔗' as result;
