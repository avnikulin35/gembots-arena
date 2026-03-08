-- GemBots Supabase Migration v6: Add webhook_url column to bots
-- Date: 2026-02-22
-- Phase 4: Webhook/API for user AI neural networks

-- Add webhook_url column (nullable, stores the URL for user's AI webhook)
ALTER TABLE public.bots ADD COLUMN IF NOT EXISTS webhook_url TEXT DEFAULT NULL;

-- Add index for quick lookups of bots with webhooks
CREATE INDEX IF NOT EXISTS idx_bots_webhook_url ON public.bots (webhook_url) WHERE webhook_url IS NOT NULL;

-- Comment
COMMENT ON COLUMN public.bots.webhook_url IS 'URL for user''s custom AI webhook. When set, matchmaker POSTs market data here and waits 10s for prediction response.';
