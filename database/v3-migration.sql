-- GemBots V3 Migration: Schema Fixes + ELO Rating
-- Run in Supabase SQL Editor

-- ============================================
-- 1. FIX SCHEMA GAPS in battles table
-- ============================================
ALTER TABLE battles ADD COLUMN IF NOT EXISTS bot1_name TEXT;
ALTER TABLE battles ADD COLUMN IF NOT EXISTS bot2_name TEXT;
ALTER TABLE battles ADD COLUMN IF NOT EXISTS bot1_wallet TEXT;
ALTER TABLE battles ADD COLUMN IF NOT EXISTS bot2_wallet TEXT;
ALTER TABLE battles ADD COLUMN IF NOT EXISTS stake_amount DECIMAL(10, 4) DEFAULT 0;
ALTER TABLE battles ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;

-- ============================================
-- 2. ADD ELO RATING to bots table
-- ============================================
ALTER TABLE bots ADD COLUMN IF NOT EXISTS elo INTEGER DEFAULT 1000;
ALTER TABLE bots ADD COLUMN IF NOT EXISTS peak_elo INTEGER DEFAULT 1000;
ALTER TABLE bots ADD COLUMN IF NOT EXISTS total_battles INTEGER DEFAULT 0;

-- ============================================
-- 3. ADD STRATEGY to bots table (for Bot Mode)
-- ============================================
ALTER TABLE bots ADD COLUMN IF NOT EXISTS strategy TEXT DEFAULT 'smart_ai';
ALTER TABLE bots ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT FALSE;

-- ============================================
-- 4. INDEXES for performance
-- ============================================
CREATE INDEX IF NOT EXISTS idx_battles_status ON battles(status);
CREATE INDEX IF NOT EXISTS idx_battles_finished ON battles(finished_at);
CREATE INDEX IF NOT EXISTS idx_bots_elo ON bots(elo DESC);
CREATE INDEX IF NOT EXISTS idx_bots_active ON bots(is_active);

-- ============================================
-- 5. UPDATE existing bots with ELO based on wins/losses
-- ============================================
UPDATE bots SET 
  elo = GREATEST(100, 1000 + (wins - losses) * 15),
  peak_elo = GREATEST(1000, 1000 + wins * 15),
  total_battles = wins + losses
WHERE elo = 1000 AND (wins > 0 OR losses > 0);

-- ============================================
-- 6. LEAGUE FUNCTION (computed from ELO)
-- ============================================
CREATE OR REPLACE FUNCTION get_league(elo_rating INTEGER)
RETURNS TEXT AS $$
BEGIN
  IF elo_rating >= 2000 THEN RETURN 'diamond';
  ELSIF elo_rating >= 1500 THEN RETURN 'gold';
  ELSIF elo_rating >= 1000 THEN RETURN 'silver';
  ELSE RETURN 'bronze';
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

SELECT 'V3 Migration complete! 🚀' as result;
