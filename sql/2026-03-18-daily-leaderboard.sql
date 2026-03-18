-- 2026-03-18 daily leaderboard (additive)

CREATE TABLE IF NOT EXISTS public.daily_user_stats (
  id BIGSERIAL PRIMARY KEY,
  uid TEXT NOT NULL,
  date_key DATE NOT NULL,
  coins_earned INTEGER NOT NULL DEFAULT 0,
  levels_completed INTEGER NOT NULL DEFAULT 0,
  ads_watched INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(uid, date_key)
);

CREATE INDEX IF NOT EXISTS daily_user_stats_date_key_idx
  ON public.daily_user_stats (date_key);

CREATE INDEX IF NOT EXISTS daily_user_stats_date_coins_idx
  ON public.daily_user_stats (date_key, coins_earned DESC);
