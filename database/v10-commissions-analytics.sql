-- GemBots Supabase Migration v10: Commissions & Analytics
-- Date: 2025-07-18
-- Phase: NFA Trading League Phase 4 — Commission System + Analytics

-- ============================================================
-- 1. Trading Commissions table
-- ============================================================

CREATE TABLE IF NOT EXISTS public.trading_commissions (
  id SERIAL PRIMARY KEY,
  trade_id INTEGER REFERENCES nfa_trades(id) ON DELETE SET NULL,
  nfa_id INTEGER NOT NULL,
  amount_bnb DOUBLE PRECISION NOT NULL DEFAULT 0,
  amount_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  commission_type TEXT NOT NULL DEFAULT 'trade_fee' CHECK (commission_type IN ('trade_fee', 'tournament_entry')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_trading_commissions_nfa_id ON public.trading_commissions (nfa_id);
CREATE INDEX IF NOT EXISTS idx_trading_commissions_trade_id ON public.trading_commissions (trade_id);
CREATE INDEX IF NOT EXISTS idx_trading_commissions_type ON public.trading_commissions (commission_type);
CREATE INDEX IF NOT EXISTS idx_trading_commissions_created_at ON public.trading_commissions (created_at);

COMMENT ON TABLE public.trading_commissions IS 'Per-trade commission records (0.5% platform fee)';

-- ============================================================
-- 2. Platform Revenue (daily aggregates)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.platform_revenue (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL UNIQUE,
  total_commissions_bnb DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_commissions_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  trade_count INTEGER NOT NULL DEFAULT 0,
  trade_volume_bnb DOUBLE PRECISION NOT NULL DEFAULT 0,
  trade_volume_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  active_traders INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_platform_revenue_date ON public.platform_revenue (date DESC);

COMMENT ON TABLE public.platform_revenue IS 'Daily aggregated platform revenue and trading stats';

-- ============================================================
-- 3. Add entry_fee_bnb to trading_tournaments
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trading_tournaments' AND column_name = 'entry_fee_bnb'
  ) THEN
    ALTER TABLE public.trading_tournaments ADD COLUMN entry_fee_bnb DOUBLE PRECISION NOT NULL DEFAULT 0;
  END IF;
END $$;

COMMENT ON COLUMN public.trading_tournaments.entry_fee_bnb IS 'Tournament entry fee in BNB (0 = free entry)';

-- ============================================================
-- 4. RLS Policies
-- ============================================================

ALTER TABLE public.trading_commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_revenue ENABLE ROW LEVEL SECURITY;

-- Public read for commissions (aggregated queries)
CREATE POLICY "Anyone can read commissions"
  ON public.trading_commissions
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Service role full access for commissions
CREATE POLICY "Service role full access on commissions"
  ON public.trading_commissions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Public read for platform revenue
CREATE POLICY "Anyone can read platform revenue"
  ON public.platform_revenue
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Service role full access for platform revenue
CREATE POLICY "Service role full access on platform revenue"
  ON public.platform_revenue
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
