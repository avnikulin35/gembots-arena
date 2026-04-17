-- GemBots Supabase Migration v9: Live Trading Enhancements
-- Date: 2025-04-14
-- Enhances nfa_trades table for live trade execution pipeline

-- ============================================================
-- 1. Add live trading columns to nfa_trades
-- ============================================================

ALTER TABLE public.nfa_trades ADD COLUMN IF NOT EXISTS token_in TEXT;
ALTER TABLE public.nfa_trades ADD COLUMN IF NOT EXISTS token_out TEXT;
ALTER TABLE public.nfa_trades ADD COLUMN IF NOT EXISTS tx_hash TEXT;
ALTER TABLE public.nfa_trades ADD COLUMN IF NOT EXISTS gas_used DOUBLE PRECISION;
ALTER TABLE public.nfa_trades ADD COLUMN IF NOT EXISTS gas_cost_bnb DOUBLE PRECISION;
ALTER TABLE public.nfa_trades ADD COLUMN IF NOT EXISTS amount_in DOUBLE PRECISION DEFAULT 0;
ALTER TABLE public.nfa_trades ADD COLUMN IF NOT EXISTS amount_out DOUBLE PRECISION;
ALTER TABLE public.nfa_trades ADD COLUMN IF NOT EXISTS price_at_entry DOUBLE PRECISION;
ALTER TABLE public.nfa_trades ADD COLUMN IF NOT EXISTS error_message TEXT;

-- Status extension to include rejected/failed/confirmed
-- (existing CHECK constraint may need to be dropped and recreated)
ALTER TABLE public.nfa_trades DROP CONSTRAINT IF EXISTS nfa_trades_status_check;
ALTER TABLE public.nfa_trades ADD CONSTRAINT nfa_trades_status_check
  CHECK (status IN ('open', 'closed', 'pending', 'confirmed', 'failed', 'rejected'));

-- Action extension to include REJECTED
ALTER TABLE public.nfa_trades DROP CONSTRAINT IF EXISTS nfa_trades_side_check;
ALTER TABLE public.nfa_trades ADD CONSTRAINT nfa_trades_side_check
  CHECK (side IN ('buy', 'sell', 'rejected'));

-- ============================================================
-- 2. Indexes for live trading lookups
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_nfa_trades_tx_hash
  ON public.nfa_trades (tx_hash)
  WHERE tx_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_nfa_trades_status_live
  ON public.nfa_trades (status)
  WHERE mode = 'live';

CREATE INDEX IF NOT EXISTS idx_nfa_trades_created_at_desc
  ON public.nfa_trades (created_at DESC);

-- ============================================================
-- 3. Comments
-- ============================================================

COMMENT ON COLUMN public.nfa_trades.token_in IS 'Input token symbol or address (e.g. BNB)';
COMMENT ON COLUMN public.nfa_trades.token_out IS 'Output token symbol or address (e.g. USDT)';
COMMENT ON COLUMN public.nfa_trades.tx_hash IS 'Blockchain transaction hash for live trades';
COMMENT ON COLUMN public.nfa_trades.gas_used IS 'Gas units consumed by the swap';
COMMENT ON COLUMN public.nfa_trades.gas_cost_bnb IS 'Gas cost in BNB';
COMMENT ON COLUMN public.nfa_trades.amount_in IS 'Amount of input token (numeric)';
COMMENT ON COLUMN public.nfa_trades.amount_out IS 'Amount of output token received (numeric)';
COMMENT ON COLUMN public.nfa_trades.price_at_entry IS 'Token price at trade entry';
COMMENT ON COLUMN public.nfa_trades.error_message IS 'Error detail for failed/rejected trades';
