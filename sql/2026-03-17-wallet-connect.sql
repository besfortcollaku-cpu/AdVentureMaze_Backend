-- 2026-03-17 wallet connect fields (additive)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS pi_wallet_identifier TEXT,
  ADD COLUMN IF NOT EXISTS wallet_verified BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS wallet_last_updated_at TIMESTAMP;
