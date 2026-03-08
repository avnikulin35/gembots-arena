-- GemBots V5 Migration: NFA Strategy Cache
-- Run in Supabase SQL Editor or via Management API
-- Applied: 2026-02-21

-- Add strategy_cache column to bots (stores parsed NFA strategy JSON)
ALTER TABLE bots ADD COLUMN IF NOT EXISTS strategy_cache TEXT;

COMMENT ON COLUMN bots.strategy_cache IS 'Cached NFA strategy JSON from on-chain. Updated on NFA link and periodically by adapter.';

SELECT 'V5 Strategy Cache Migration complete! ⚔️' as result;
