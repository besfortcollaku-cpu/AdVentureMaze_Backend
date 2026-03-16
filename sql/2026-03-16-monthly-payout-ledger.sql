-- 2026-03-16 monthly payout architecture (additive)

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS payout_carry_coins BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pi_wallet_identifier TEXT;

CREATE TABLE IF NOT EXISTS public.monthly_payout_cycles (
  id BIGSERIAL PRIMARY KEY,
  month_key TEXT NOT NULL UNIQUE,
  conversion_rate_locked NUMERIC(20,8) NOT NULL,
  min_payout_threshold_pi NUMERIC(20,8) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.monthly_payout_snapshots (
  id BIGSERIAL PRIMARY KEY,
  cycle_id BIGINT NOT NULL REFERENCES public.monthly_payout_cycles(id) ON DELETE CASCADE,
  uid TEXT NOT NULL,
  coins_earned BIGINT NOT NULL,
  carry_in_coins BIGINT NOT NULL DEFAULT 0,
  total_coins_for_settlement BIGINT NOT NULL,
  payout_pi_amount NUMERIC(20,8) NOT NULL,
  carry_out_coins BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (cycle_id, uid)
);

CREATE TABLE IF NOT EXISTS public.pi_payout_jobs (
  id BIGSERIAL PRIMARY KEY,
  cycle_id BIGINT NOT NULL REFERENCES public.monthly_payout_cycles(id) ON DELETE CASCADE,
  uid TEXT NOT NULL,
  payout_pi_amount NUMERIC(20,8) NOT NULL,
  wallet_identifier TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  txid TEXT,
  error_message TEXT,
  attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (cycle_id, uid)
);

CREATE INDEX IF NOT EXISTS monthly_payout_snapshots_cycle_status_idx
  ON public.monthly_payout_snapshots (cycle_id, status);

CREATE INDEX IF NOT EXISTS pi_payout_jobs_status_cycle_idx
  ON public.pi_payout_jobs (status, cycle_id, created_at);
