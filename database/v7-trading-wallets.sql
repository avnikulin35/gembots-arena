-- GemBots Supabase Migration v7: Trading League — Wallet + Paper Trading
-- Date: 2025-07-13
-- Phase: NFA Trading League (paper trading)

-- ============================================================
-- 1. Add trading columns to bots table
-- ============================================================

ALTER TABLE public.bots ADD COLUMN IF NOT EXISTS trading_wallet_address TEXT DEFAULT NULL;
ALTER TABLE public.bots ADD COLUMN IF NOT EXISTS trading_wallet_encrypted TEXT DEFAULT NULL;
ALTER TABLE public.bots ADD COLUMN IF NOT EXISTS trading_mode TEXT DEFAULT 'off';
ALTER TABLE public.bots ADD COLUMN IF NOT EXISTS trading_config JSONB DEFAULT '{
  "max_position_pct": 10,
  "max_daily_loss_pct": 5,
  "allowed_pairs": ["BNB/USDT", "ETH/USDT", "CAKE/USDT"],
  "max_trades_per_day": 20,
  "confidence_threshold": 0.7,
  "take_profit_pct": 5,
  "stop_loss_pct": 3
}'::jsonb;

-- Constraints
ALTER TABLE public.bots DROP CONSTRAINT IF EXISTS bots_trading_mode_check;
ALTER TABLE public.bots ADD CONSTRAINT bots_trading_mode_check CHECK (trading_mode IN ('off', 'paper', 'live'));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_bots_trading_mode ON public.bots (trading_mode) WHERE trading_mode != 'off';
CREATE INDEX IF NOT EXISTS idx_bots_trading_wallet ON public.bots (trading_wallet_address) WHERE trading_wallet_address IS NOT NULL;

-- Comments
COMMENT ON COLUMN public.bots.trading_wallet_address IS 'EVM wallet public address for NFA trading';
COMMENT ON COLUMN public.bots.trading_wallet_encrypted IS 'AES-256-GCM encrypted private key for trading wallet';
COMMENT ON COLUMN public.bots.trading_mode IS 'Trading mode: off | paper | live';
COMMENT ON COLUMN public.bots.trading_config IS 'Trading configuration JSON: limits, pairs, thresholds';

-- ============================================================
-- 2. NFA Trades table
-- ============================================================

CREATE TABLE IF NOT EXISTS public.nfa_trades (
  id BIGSERIAL PRIMARY KEY,
  nfa_id INTEGER NOT NULL,
  bot_id INTEGER REFERENCES public.bots(id) ON DELETE CASCADE,
  pair TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  entry_price DOUBLE PRECISION NOT NULL,
  exit_price DOUBLE PRECISION,
  size_usd DOUBLE PRECISION NOT NULL DEFAULT 100,
  pnl_usd DOUBLE PRECISION,
  pnl_pct DOUBLE PRECISION,
  mode TEXT NOT NULL DEFAULT 'paper' CHECK (mode IN ('paper', 'live')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  confidence DOUBLE PRECISION,
  strategy_name TEXT,
  close_reason TEXT,
  open_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  close_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for nfa_trades
CREATE INDEX IF NOT EXISTS idx_nfa_trades_nfa_id ON public.nfa_trades (nfa_id);
CREATE INDEX IF NOT EXISTS idx_nfa_trades_bot_id ON public.nfa_trades (bot_id);
CREATE INDEX IF NOT EXISTS idx_nfa_trades_status ON public.nfa_trades (status) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_nfa_trades_open_at ON public.nfa_trades (open_at DESC);
CREATE INDEX IF NOT EXISTS idx_nfa_trades_mode ON public.nfa_trades (mode);

COMMENT ON TABLE public.nfa_trades IS 'NFA Trading League trades — paper and live';

-- ============================================================
-- 3. NFA Trading Stats table (materialized per-bot stats)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.nfa_trading_stats (
  nfa_id INTEGER PRIMARY KEY,
  bot_id INTEGER REFERENCES public.bots(id) ON DELETE CASCADE,
  total_trades INTEGER NOT NULL DEFAULT 0,
  open_trades INTEGER NOT NULL DEFAULT 0,
  winning_trades INTEGER NOT NULL DEFAULT 0,
  losing_trades INTEGER NOT NULL DEFAULT 0,
  win_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_pnl_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  avg_pnl_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  best_trade_pnl DOUBLE PRECISION NOT NULL DEFAULT 0,
  worst_trade_pnl DOUBLE PRECISION NOT NULL DEFAULT 0,
  sharpe_ratio DOUBLE PRECISION NOT NULL DEFAULT 0,
  max_drawdown_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  current_streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  avg_hold_minutes DOUBLE PRECISION NOT NULL DEFAULT 0,
  paper_balance_usd DOUBLE PRECISION NOT NULL DEFAULT 10000,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nfa_trading_stats_bot_id ON public.nfa_trading_stats (bot_id);
CREATE INDEX IF NOT EXISTS idx_nfa_trading_stats_pnl ON public.nfa_trading_stats (total_pnl_usd DESC);

COMMENT ON TABLE public.nfa_trading_stats IS 'Aggregated trading statistics per NFA bot';

-- ============================================================
-- 4. Enable RLS (Row Level Security) — allow service role full access
-- ============================================================

ALTER TABLE public.nfa_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nfa_trading_stats ENABLE ROW LEVEL SECURITY;

-- Service role policies (our backend)
DROP POLICY IF EXISTS "Service role full access on nfa_trades" ON public.nfa_trades;
CREATE POLICY "Service role full access on nfa_trades" ON public.nfa_trades
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on nfa_trading_stats" ON public.nfa_trading_stats;
CREATE POLICY "Service role full access on nfa_trading_stats" ON public.nfa_trading_stats
  FOR ALL USING (true) WITH CHECK (true);

-- Public read-only policies
DROP POLICY IF EXISTS "Public read nfa_trades" ON public.nfa_trades;
CREATE POLICY "Public read nfa_trades" ON public.nfa_trades
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read nfa_trading_stats" ON public.nfa_trading_stats;
CREATE POLICY "Public read nfa_trading_stats" ON public.nfa_trading_stats
  FOR SELECT USING (true);
