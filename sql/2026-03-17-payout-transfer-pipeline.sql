-- 2026-03-17 real payout transfer pipeline (additive)
ALTER TABLE public.pi_payout_jobs
  ADD COLUMN IF NOT EXISTS external_status TEXT,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS treasury_blocked BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS txid TEXT,
  ADD COLUMN IF NOT EXISTS error_message TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS pi_payout_jobs_idempotency_key_uniq
  ON public.pi_payout_jobs (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.payout_transfer_logs (
  id BIGSERIAL PRIMARY KEY,
  payout_job_id BIGINT NOT NULL REFERENCES public.pi_payout_jobs(id) ON DELETE CASCADE,
  uid TEXT NOT NULL,
  wallet_identifier TEXT NOT NULL,
  amount_pi NUMERIC(20,8) NOT NULL,
  request_payload JSONB,
  response_payload JSONB,
  txid TEXT,
  status TEXT NOT NULL,
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payout_transfer_logs_job_idx
  ON public.payout_transfer_logs (payout_job_id, created_at DESC);
