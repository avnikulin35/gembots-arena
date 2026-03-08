-- GemBots Supabase Migration v8: Live Trading Support
-- Date: 2025-07-14
-- Phase: NFA Trading League Phase 2 — PancakeSwap Integration

-- ============================================================
-- 1. Add tx_hash and gas_used columns to nfa_trades
-- ============================================================

ALTER TABLE public.nfa_trades ADD COLUMN IF NOT EXISTS tx_hash TEXT;
ALTER TABLE public.nfa_trades ADD COLUMN IF NOT EXISTS gas_used DOUBLE PRECISION;

-- Index for looking up trades by tx hash
CREATE INDEX IF NOT EXISTS idx_nfa_trades_tx_hash ON public.nfa_trades (tx_hash) WHERE tx_hash IS NOT NULL;

COMMENT ON COLUMN public.nfa_trades.tx_hash IS 'Blockchain transaction hash for live trades';
COMMENT ON COLUMN public.nfa_trades.gas_used IS 'Gas used for the swap transaction';
