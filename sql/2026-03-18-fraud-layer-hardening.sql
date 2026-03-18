-- 2026-03-18 fraud detection + payout filtering hardening (additive)

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS fraud_score INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS suspicious BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS payout_locked BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS manual_review_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS vpn_flag BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS risk_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS payout_fail_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_ip TEXT,
  ADD COLUMN IF NOT EXISTS last_user_agent TEXT,
  ADD COLUMN IF NOT EXISTS ads_watched_today INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_ad_watch_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS public.ad_watch_logs (
  id BIGSERIAL PRIMARY KEY,
  uid TEXT NOT NULL,
  ad_type TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  country TEXT,
  isp TEXT,
  asn TEXT,
  is_vpn BOOLEAN NOT NULL DEFAULT FALSE,
  eligible_for_payout BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ad_watch_logs_uid_created_idx
  ON public.ad_watch_logs (uid, created_at DESC);

CREATE INDEX IF NOT EXISTS ad_watch_logs_ip_created_idx
  ON public.ad_watch_logs (ip, created_at DESC);

CREATE TABLE IF NOT EXISTS public.reward_event_audit (
  id BIGSERIAL PRIMARY KEY,
  uid TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_key TEXT NOT NULL,
  amount_coins INTEGER NOT NULL DEFAULT 0,
  accepted BOOLEAN NOT NULL,
  reject_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE public.pi_payout_jobs
  ADD COLUMN IF NOT EXISTS flagged BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS risk_reason TEXT,
  ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'auto';
