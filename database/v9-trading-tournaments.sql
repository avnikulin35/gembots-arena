-- GemBots Supabase Migration v9: Trading League Tournaments
-- Date: 2025-07-15
-- Phase: NFA Trading League Phase 3 — Tournaments + Leaderboard

-- ============================================================
-- 1. Trading Tournaments table
-- ============================================================

CREATE TABLE IF NOT EXISTS public.trading_tournaments (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('upcoming', 'active', 'completed')),
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  total_participants INTEGER DEFAULT 0,
  prize_pool_usd DOUBLE PRECISION DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index on status for active tournament queries
CREATE INDEX IF NOT EXISTS idx_trading_tournaments_status ON public.trading_tournaments (status);
CREATE INDEX IF NOT EXISTS idx_trading_tournaments_end_at ON public.trading_tournaments (end_at);

COMMENT ON TABLE public.trading_tournaments IS 'Weekly trading league tournaments';

-- ============================================================
-- 2. Tournament Entries (per-bot performance during tournament)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.trading_tournament_entries (
  id SERIAL PRIMARY KEY,
  tournament_id INTEGER REFERENCES trading_tournaments(id) ON DELETE CASCADE,
  bot_id INTEGER REFERENCES bots(id) ON DELETE CASCADE,
  nfa_id INTEGER,
  bot_name TEXT,
  strategy TEXT,
  start_pnl_usd DOUBLE PRECISION DEFAULT 0,
  current_pnl_usd DOUBLE PRECISION DEFAULT 0,
  tournament_pnl_usd DOUBLE PRECISION DEFAULT 0,
  tournament_pnl_pct DOUBLE PRECISION DEFAULT 0,
  trades_count INTEGER DEFAULT 0,
  win_rate DOUBLE PRECISION DEFAULT 0,
  rank INTEGER,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tournament_id, bot_id)
);

-- Indexes for tournament entries
CREATE INDEX IF NOT EXISTS idx_tournament_entries_tournament_id ON public.trading_tournament_entries (tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournament_entries_bot_id ON public.trading_tournament_entries (bot_id);
CREATE INDEX IF NOT EXISTS idx_tournament_entries_rank ON public.trading_tournament_entries (rank);
CREATE INDEX IF NOT EXISTS idx_tournament_entries_pnl ON public.trading_tournament_entries (tournament_pnl_usd DESC);

COMMENT ON TABLE public.trading_tournament_entries IS 'Per-bot performance entries within a trading tournament';

-- ============================================================
-- 3. RLS Policies: public read, service role full access
-- ============================================================

ALTER TABLE public.trading_tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_tournament_entries ENABLE ROW LEVEL SECURITY;

-- Public read for tournaments
CREATE POLICY "Anyone can read tournaments"
  ON public.trading_tournaments
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Service role full access for tournaments
CREATE POLICY "Service role full access on tournaments"
  ON public.trading_tournaments
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Public read for tournament entries
CREATE POLICY "Anyone can read tournament entries"
  ON public.trading_tournament_entries
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Service role full access for entries
CREATE POLICY "Service role full access on tournament entries"
  ON public.trading_tournament_entries
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
