CREATE TABLE IF NOT EXISTS public.daily_leaderboard_snapshots (
  id BIGSERIAL PRIMARY KEY,
  date_key DATE NOT NULL,
  uid TEXT NOT NULL,
  rank INTEGER NOT NULL,
  coins_earned INTEGER NOT NULL,
  reward_coins INTEGER NOT NULL DEFAULT 0,
  eligible BOOLEAN NOT NULL DEFAULT TRUE,
  claimed BOOLEAN NOT NULL DEFAULT FALSE,
  claimed_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(date_key, uid)
);

CREATE INDEX IF NOT EXISTS daily_leaderboard_snapshots_date_rank_idx
  ON public.daily_leaderboard_snapshots (date_key, rank);
