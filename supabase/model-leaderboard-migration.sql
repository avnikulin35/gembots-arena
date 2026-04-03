-- Model Leaderboard Migration
-- Adds model_id to bots table and creates model_stats aggregation view

-- 1. Add model_id column to bots table (nullable, varchar)
ALTER TABLE bots ADD COLUMN IF NOT EXISTS model_id VARCHAR(255) DEFAULT NULL;

-- 2. Create index on model_id for efficient grouping
CREATE INDEX IF NOT EXISTS idx_bots_model_id ON bots (model_id) WHERE model_id IS NOT NULL;

-- 3. Create model_stats view
-- Aggregates battle stats per LLM model from the bots table
CREATE OR REPLACE VIEW model_stats AS
SELECT
  b.model_id,
  COUNT(DISTINCT b.id) AS bot_count,
  SUM(b.wins + b.losses) AS total_battles,
  SUM(b.wins) AS wins,
  SUM(b.losses) AS losses,
  CASE
    WHEN SUM(b.wins + b.losses) > 0
    THEN ROUND((SUM(b.wins)::numeric / SUM(b.wins + b.losses)::numeric) * 100, 2)
    ELSE 0
  END AS win_rate,
  ROUND(AVG(b.elo)::numeric, 0) AS avg_elo,
  MAX(b.peak_elo) AS peak_elo,
  ROUND(AVG(
    CASE
      WHEN (b.wins + b.losses) > 0
      THEN (b.wins::numeric / (b.wins + b.losses)::numeric) * 100
      ELSE 0
    END
  )::numeric, 2) AS avg_accuracy,
  COALESCE(SUM(pnl.total_pnl), 0) AS total_pnl
FROM bots b
LEFT JOIN (
  -- Calculate PnL from battles: positive when bot wins, negative when loses
  SELECT
    bot_id,
    SUM(pnl) AS total_pnl
  FROM (
    SELECT bot1_id AS bot_id,
      CASE WHEN winner_id = bot1_id THEN COALESCE(stake_amount, 0) ELSE -COALESCE(stake_amount, 0) END AS pnl
    FROM battles WHERE status = 'resolved'
    UNION ALL
    SELECT bot2_id AS bot_id,
      CASE WHEN winner_id = bot2_id THEN COALESCE(stake_amount, 0) ELSE -COALESCE(stake_amount, 0) END AS pnl
    FROM battles WHERE status = 'resolved'
  ) battle_pnl
  GROUP BY bot_id
) pnl ON pnl.bot_id = b.id
WHERE b.model_id IS NOT NULL
GROUP BY b.model_id
ORDER BY win_rate DESC, avg_elo DESC;

-- 4. Grant read access to anon and authenticated roles
GRANT SELECT ON model_stats TO anon;
GRANT SELECT ON model_stats TO authenticated;
