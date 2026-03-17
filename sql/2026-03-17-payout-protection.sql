-- 2026-03-17 payout protection layers (additive)

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS payout_locked BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS manual_review_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS risk_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS trust_score INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS account_created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS payout_fail_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.reward_event_audit (
  id BIGSERIAL PRIMARY KEY,
  uid TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_key TEXT NOT NULL,
  amount_coins INT NOT NULL DEFAULT 0,
  amount_pi NUMERIC(20,8),
  accepted BOOLEAN NOT NULL,
  reject_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reward_event_audit_uid_event_idx
  ON public.reward_event_audit (uid, event_type, event_key, created_at DESC);

ALTER TABLE public.monthly_payout_cycles
  ADD COLUMN IF NOT EXISTS total_payout_pi NUMERIC(20,8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS capped_total_payout_pi NUMERIC(20,8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS manual_review_required BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.pi_payout_jobs
  ADD COLUMN IF NOT EXISTS risk_reason TEXT,
  ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS approved_by_admin TEXT,
  ADD COLUMN IF NOT EXISTS treasury_blocked BOOLEAN NOT NULL DEFAULT FALSE;
