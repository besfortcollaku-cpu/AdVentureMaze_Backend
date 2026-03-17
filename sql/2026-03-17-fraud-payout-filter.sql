-- 2026-03-17 fraud detection + payout filter (additive)

CREATE TABLE IF NOT EXISTS public.user_ad_activity (
  id SERIAL PRIMARY KEY,
  uid TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  ip TEXT,
  country TEXT,
  asn TEXT,
  isp TEXT,
  is_vpn BOOLEAN DEFAULT FALSE,
  ad_type TEXT,
  level_before INTEGER,
  level_after INTEGER
);

CREATE INDEX IF NOT EXISTS user_ad_activity_uid_created_idx
  ON public.user_ad_activity (uid, created_at DESC);

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS fraud_score INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vpn_flag BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS suspicious BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ads_watched_today INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_ad_at TIMESTAMP;
