import { Pool } from "pg";
import { sendPiPayout as sendPiPayoutAdapter, getSendingWalletAvailableBalancePi } from "./services/piPayoutSender";
import { lookupIpRisk } from "./services/ipRisk";
console.log("Backend v2.0.1");
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true"
    ? { rejectUnauthorized: false }
    : undefined,
});

/* =====================================================
   INIT  (âœ… Fix 1: auto-create core tables incl. sessions)
===================================================== */

export async function useNonce(uid: string, nonce: string) {
  if (!nonce) throw new Error("missing_nonce");

  try {
    await pool.query(
      `INSERT INTO reward_nonces (nonce, uid) VALUES ($1,$2)`,
      [nonce, uid]
    );
  } catch (e:any) {
    if (e.code === "23505") {
      throw new Error("nonce_reused");
    }
    throw e;
  }
}
export async function consumeItem(
  uid: string,
  item: "restart" | "skip" | "hint",
  mode: SpendMode,
  nonce?: string
) {
  switch (item) {
    case "restart":
      return useRestarts(uid, mode, nonce);

    case "skip":
      return useSkip(uid, mode, nonce);

    case "hint":
      return useHint(uid, mode, nonce);

    default:
      throw new Error("INVALID_ITEM");
  }
}
export async function initDB() {
  await pool.query("SELECT 1");

  // --- core tables ---
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.users (
      uid TEXT PRIMARY KEY,
      username TEXT,
      coins INT DEFAULT 0,

      free_restarts_used INT DEFAULT 0,
      free_skips_used INT DEFAULT 0,
      free_hints_used INT DEFAULT 0,

      -- monthly rollover bookkeeping (legacy)
      coins_month TEXT,

      -- NEW monthly key + metrics
      monthly_key TEXT,
      monthly_coins_earned INT DEFAULT 0,
      monthly_login_days INT DEFAULT 0,
      monthly_levels_completed INT DEFAULT 0,
      monthly_skips_used INT DEFAULT 0,
      monthly_hints_used INT DEFAULT 0,
      monthly_restarts_used INT DEFAULT 0,
      monthly_ads_watched INT DEFAULT 0,
      monthly_surprise_boxes_opened INT DEFAULT 0,
      monthly_mystery_boxes_opened INT DEFAULT 0,
      monthly_valid_invites INT DEFAULT 0,
      lifetime_valid_invites INT DEFAULT 0,
      monthly_max_win_streak INT DEFAULT 0,
      monthly_rate_breakdown JSONB DEFAULT '{}'::jsonb,
      monthly_final_rate INT DEFAULT 50,

      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  // daily login reward tracking
  await pool.query(`
    ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS last_daily_login DATE
  `);

  // invite/referral tracking
  await pool.query(`
    ALTER TABLE public.users
      ADD COLUMN IF NOT EXISTS invite_code TEXT,
      ADD COLUMN IF NOT EXISTS invited_by_uid TEXT,
      ADD COLUMN IF NOT EXISTS invited_at TIMESTAMP
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_invite_code_unique
    ON public.users (invite_code)
    WHERE invite_code IS NOT NULL
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.user_invites (
      invitee_uid TEXT PRIMARY KEY,
      inviter_uid TEXT NOT NULL,
      invite_code TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS user_invites_inviter_idx
    ON public.user_invites (inviter_uid)
  `);

  // --- upgrades for existing DBs (safe to run every boot) ---
  await pool.query(`
    ALTER TABLE public.users
      ADD COLUMN IF NOT EXISTS monthly_key TEXT,
      ADD COLUMN IF NOT EXISTS monthly_coins_earned INT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS monthly_login_days INT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS monthly_levels_completed INT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS monthly_skips_used INT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS monthly_hints_used INT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS monthly_restarts_used INT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS monthly_ads_watched INT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS monthly_surprise_boxes_opened INT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS monthly_mystery_boxes_opened INT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS monthly_valid_invites INT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS lifetime_valid_invites INT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS monthly_max_win_streak INT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS monthly_rate_breakdown JSONB DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS monthly_final_rate INT DEFAULT 50;
  `);
  await pool.query(`
    ALTER TABLE public.users
      ADD COLUMN IF NOT EXISTS restarts_balance INT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS skips_balance INT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS hints_balance INT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS daily_streak INT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS last_daily_claim_date DATE,
      ADD COLUMN IF NOT EXISTS lifetime_coins_earned INT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS lifetime_coins_spent INT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS lifetime_levels_completed INT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS payout_carry_coins BIGINT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS pi_wallet_identifier TEXT,
      ADD COLUMN IF NOT EXISTS wallet_verified BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS wallet_last_updated_at TIMESTAMP;
  `);
  await pool.query(`
    ALTER TABLE public.users
      ADD COLUMN IF NOT EXISTS payout_locked BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS manual_review_required BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS risk_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS trust_score INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS account_created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS payout_fail_count INTEGER NOT NULL DEFAULT 0;
  `);


  await pool.query(`
    CREATE TABLE IF NOT EXISTS progress (
      uid TEXT PRIMARY KEY,
      level INT DEFAULT 1,
      coins INT DEFAULT 0,
      painted_keys JSONB DEFAULT '[]'::jsonb,
      resume JSONB DEFAULT NULL,
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

await pool.query(`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS mystery_box_pending BOOLEAN NOT NULL DEFAULT FALSE`);

  await pool.query(`
    ALTER TABLE public.users
      ADD COLUMN IF NOT EXISTS fraud_score INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS vpn_flag BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS suspicious BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS payout_locked BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS manual_review_required BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS risk_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS payout_fail_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS ads_watched_today INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS last_ip TEXT,
      ADD COLUMN IF NOT EXISTS last_user_agent TEXT,
      ADD COLUMN IF NOT EXISTS last_ad_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS last_ad_watch_at TIMESTAMP;
  `);
  await pool.query(`
    ALTER TABLE public.users
      ADD COLUMN IF NOT EXISTS mc_balance INT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS rp_score INT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS daily_rp INT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS last_rp_reset TIMESTAMP DEFAULT NOW();
  `);

  await pool.query(`
    UPDATE public.users
       SET mc_balance = COALESCE(coins, 0)
     WHERE COALESCE(mc_balance, 0) = 0
       AND COALESCE(coins, 0) <> 0
  `);

  await pool.query(`
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
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS user_ad_activity_uid_created_idx
      ON public.user_ad_activity (uid, created_at DESC);
  `);
  await pool.query(`
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
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS ad_watch_logs_uid_created_idx
      ON public.ad_watch_logs (uid, created_at DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS ad_watch_logs_ip_created_idx
      ON public.ad_watch_logs (ip, created_at DESC);
  `);  await pool.query(`
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
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS daily_user_stats_date_key_idx
      ON public.daily_user_stats (date_key);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS daily_user_stats_date_coins_idx
      ON public.daily_user_stats (date_key, coins_earned DESC);
  `);

  await pool.query(`
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
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS daily_leaderboard_snapshots_date_rank_idx
      ON public.daily_leaderboard_snapshots (date_key, rank);
  `);


  await pool.query(`
    CREATE TABLE IF NOT EXISTS reward_claims (
      uid TEXT NOT NULL,
      type TEXT NOT NULL,
      nonce TEXT,
      amount INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reward_nonces (
      nonce TEXT PRIMARY KEY,
      uid TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);


  await pool.query(`
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
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS reward_event_audit_uid_event_idx
      ON public.reward_event_audit (uid, event_type, event_key, created_at DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS daily_reward_missed_days (
      uid TEXT NOT NULL,
      day INT NOT NULL,
      is_recovered BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (uid, day)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS daily_reward_recoveries (
      uid TEXT NOT NULL,
      day INT NOT NULL,
      cycle_anchor TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (uid, day, cycle_anchor)
    );
  `);

  await pool.query(`
  CREATE TABLE IF NOT EXISTS public.level_rewards (
    uid TEXT NOT NULL,
    level INT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  );
`);

await pool.query(`
  CREATE UNIQUE INDEX IF NOT EXISTS level_rewards_uid_level_unique
  ON public.level_rewards (uid, level)
`);
  
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      uid TEXT PRIMARY KEY,
      session_id TEXT,
      user_agent TEXT,
      ip TEXT,
      started_at TIMESTAMP,
      last_seen_at TIMESTAMP NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS monthly_payouts (
      uid TEXT NOT NULL,
      month TEXT NOT NULL,
      coins_collected INT NOT NULL,
      pi_amount NUMERIC,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW(),
      sent_at TIMESTAMP,
      tx_id TEXT,
      PRIMARY KEY (uid, month)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.monthly_payout_cycles (
      id BIGSERIAL PRIMARY KEY,
      month_key TEXT NOT NULL UNIQUE,
      conversion_rate_locked NUMERIC(20,8) NOT NULL,
      min_payout_threshold_pi NUMERIC(20,8) NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      closed_at TIMESTAMP
    );
  `);

  await pool.query(`
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
  `);

  await pool.query(`
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
  `);


  await pool.query(`
    ALTER TABLE public.monthly_payout_cycles
      ADD COLUMN IF NOT EXISTS total_payout_pi NUMERIC(20,8) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS capped_total_payout_pi NUMERIC(20,8) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS manual_review_required BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  await pool.query(`
    ALTER TABLE public.pi_payout_jobs
      ADD COLUMN IF NOT EXISTS flagged BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS risk_reason TEXT,
      ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'auto',
      ADD COLUMN IF NOT EXISTS approved_by_admin TEXT,
      ADD COLUMN IF NOT EXISTS treasury_blocked BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS external_status TEXT,
      ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
  `);

  await pool.query(`
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
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS payout_transfer_logs_job_idx
      ON public.payout_transfer_logs (payout_job_id, created_at DESC);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.admin_runtime_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS pi_payout_jobs_idempotency_key_uniq
      ON public.pi_payout_jobs (idempotency_key)
      WHERE idempotency_key IS NOT NULL;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS monthly_payout_snapshots_cycle_status_idx
      ON public.monthly_payout_snapshots (cycle_id, status);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS pi_payout_jobs_status_cycle_idx
      ON public.pi_payout_jobs (status, cycle_id, created_at);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_ads (
      uid TEXT NOT NULL,
      month TEXT NOT NULL,
      ads_for_coins INT DEFAULT 0,
      ads_for_skips INT DEFAULT 0,
      ads_for_hints INT DEFAULT 0,
      PRIMARY KEY (uid, month)
    );
  `);
  await pool.query(`
    ALTER TABLE user_ads
    ADD COLUMN IF NOT EXISTS ads_for_restarts INT DEFAULT 0
  `);
}



/* =====================================================
   CONSTANTS
===================================================== */
export const FREE_RESTARTS_PER_ACCOUNT = 3;
export const FREE_SKIPS_PER_ACCOUNT = 3;
export const FREE_HINTS_PER_ACCOUNT = 3;
export const RESTART_COST_COINS = 50;
export const SKIP_COST_COINS = 50;
export const HINT_COST_COINS = 50;
export const CONSUMABLES = {
  restart: { coinCost: 50, freeLimit: 3 },
  skip:    { coinCost: 50, freeLimit: 3 },
  hint:    { coinCost: 50, freeLimit: 3 },
} as const;

export type ConsumableKey = keyof typeof CONSUMABLES;
export type SpendMode = "free" | "coins" | "ad" | "pi";

export function getFreeSkipsLeft(u: any) {
  const used = Number(u?.free_skips_used || 0);
  return Math.max(0, FREE_SKIPS_PER_ACCOUNT - used);
}

export function getFreeHintsLeft(u: any) {
  const used = Number(u?.free_hints_used || 0);
  return Math.max(0, FREE_HINTS_PER_ACCOUNT - used);
}

/* =====================================================
   USERS
===================================================== */
function currentMonthKey() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`; // e.g. 2026-01
}
export async function ensureMonthlyKey(uid: string) {
  const mk = currentMonthKey();

  // ensure column exists even on old DBs
  await pool.query(`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS monthly_key TEXT;`);

  const { rows } = await pool.query(
    `SELECT monthly_key FROM public.users WHERE uid=$1`,
    [uid]
  );

  const existing = rows?.[0]?.monthly_key ? String(rows[0].monthly_key) : "";

  if (existing !== mk) {
    await pool.query(
      `UPDATE public.users
       SET monthly_key=$2,
           monthly_coins_earned=0,
           monthly_login_days=0,
           monthly_levels_completed=0,
           monthly_skips_used=0,
           monthly_hints_used=0,
           monthly_restarts_used=0,
           monthly_ads_watched=0,
           monthly_surprise_boxes_opened=0,
           monthly_mystery_boxes_opened=0,
           monthly_valid_invites=0,
           monthly_max_win_streak=0,
           monthly_rate_breakdown='{}'::jsonb,
           monthly_final_rate=COALESCE(monthly_final_rate,50),
           updated_at=NOW()
       WHERE uid=$1`,
      [uid, mk]
    );
  }
}

export function monthKeyForDate(d: Date) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * Month-close: takes each user's current coins, writes a ledger row (monthly_payouts),
 * then resets the user's coins to 0.
 *
 * IMPORTANT: This does NOT send Pi coins. It's the safe, idempotent
 * accounting step you need before you plug in the Pi transfer logic.
 */
export async function closeMonthAndResetCoins(opts?: { month?: string }) {
  const month = String(opts?.month || currentMonthKey());

  // Use a transaction to avoid partial resets
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `SELECT uid, COALESCE(coins,0)::int AS coins
       FROM public.users
       WHERE COALESCE(coins,0) <> 0
       FOR UPDATE`,
    );

    for (const r of rows) {
      const uid = String(r.uid);
      const coins = Number(r.coins || 0);

      // insert payout row once per (uid,month)
      await client.query(
        `INSERT INTO monthly_payouts (uid, month, coins_collected, status, created_at)
         VALUES ($1,$2,$3,'pending',NOW())
         ON CONFLICT (uid, month) DO NOTHING`,
        [uid, month, coins]
      );

      // reset coins (idempotent)
      await client.query(
        `UPDATE public.users
         SET coins = 0,
             coins_month = $2,
             updated_at = NOW()
         WHERE uid = $1`,
        [uid, month]
      );
    }

    await client.query("COMMIT");

    return {
      ok: true,
      month,
      users_reset: rows.length,
      total_coins_reset: rows.reduce((s, r) => s + Number(r.coins || 0), 0),
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}


type MonthlyPayoutCycleStatus = "open" | "closed" | "payouts_generated" | "processing" | "completed";
type MonthlyPayoutSnapshotStatus = "eligible" | "below_threshold" | "manual_review" | "blocked" | "queued" | "paid" | "failed";
type PiPayoutJobStatus = "queued" | "processing" | "paid" | "failed" | "failed_permanent" | "blocked" | "manual_review";

type PayoutJobRecord = {
  id: number;
  cycle_id: number;
  uid: string;
  payout_pi_amount: string;
  wallet_identifier: string | null;
  status: PiPayoutJobStatus;
  txid: string | null;
  external_status?: string | null;
  sent_at?: string | null;
  confirmed_at?: string | null;
  error_message: string | null;
  attempts: number;
  idempotency_key?: string | null;
  treasury_blocked?: boolean;
  review_status?: string | null;
  flagged?: boolean;
  risk_reason?: string | null;
};

const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function normalizeMonthKey(input?: string) {
  const key = String(input || currentMonthKey()).trim();
  if (!MONTH_KEY_RE.test(key)) throw new Error("invalid_month_key");
  return key;
}

function toPositiveNumber(value: unknown, fieldName: string) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`invalid_${fieldName}`);
  return n;
}

function toNonNegativeInt(value: unknown, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

function envNumber(name: string, fallback: number) {
  const raw = process.env[name];
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

const MAX_USER_MONTHLY_PI = envNumber("MAX_USER_MONTHLY_PI", 100);
const MAX_GLOBAL_MONTHLY_PI = envNumber("MAX_GLOBAL_MONTHLY_PI", 100000);
const MIN_ACCOUNT_AGE_DAYS = envNumber("MIN_ACCOUNT_AGE_DAYS", 7);
const MIN_LEVEL_FOR_PAYOUT = envNumber("MIN_LEVEL_FOR_PAYOUT", 3);
const TREASURY_RESERVE_PI = envNumber("TREASURY_RESERVE_PI", 0);
const SUSPICIOUS_MONTHLY_COINS = envNumber("SUSPICIOUS_MONTHLY_COINS", 10000);
const PAYOUT_FAIL_REVIEW_COUNT = envNumber("PAYOUT_FAIL_REVIEW_COUNT", 3);
const PAYOUT_MAX_ATTEMPTS = Math.max(1, Math.floor(envNumber("PAYOUT_MAX_ATTEMPTS", 3)));
const SENDING_WALLET_MIN_REQUIRED_PI = envNumber("SENDING_WALLET_MIN_REQUIRED_PI", 0);
const FRAUD_SCORE_SUSPICIOUS_THRESHOLD = Math.max(1, Math.floor(envNumber("FRAUD_SCORE_SUSPICIOUS_THRESHOLD", 4)));
const FRAUD_SCORE_MANUAL_REVIEW_THRESHOLD = Math.max(FRAUD_SCORE_SUSPICIOUS_THRESHOLD, Math.floor(envNumber("FRAUD_SCORE_MANUAL_REVIEW_THRESHOLD", 6)));
const FRAUD_SCORE_PAYOUT_LOCK_THRESHOLD = Math.max(FRAUD_SCORE_MANUAL_REVIEW_THRESHOLD, Math.floor(envNumber("FRAUD_SCORE_PAYOUT_LOCK_THRESHOLD", 8)));
const PAYOUT_ELIGIBLE_ADS_PER_DAY = Math.max(0, Math.floor(envNumber("PAYOUT_ELIGIBLE_ADS_PER_DAY", 5)));
const FRAUD_SHARED_IP_USER_THRESHOLD = Math.max(2, Math.floor(envNumber("FRAUD_SHARED_IP_USER_THRESHOLD", 5)));
const FRAUD_DUPLICATE_WALLET_THRESHOLD = Math.max(2, Math.floor(envNumber("FRAUD_DUPLICATE_WALLET_THRESHOLD", 3)));
const FRAUD_MIN_SECONDS_BETWEEN_REWARDED_ADS = Math.max(30, Math.floor(envNumber("FRAUD_MIN_SECONDS_BETWEEN_REWARDED_ADS", 120)));
const FRAUD_NEW_ACCOUNT_DAYS = Math.max(1, Math.floor(envNumber("FRAUD_NEW_ACCOUNT_DAYS", Math.max(1, MIN_ACCOUNT_AGE_DAYS))));
const PAYOUT_SIM_MODE_CONFIG_KEY = "payout_simulate_success";
let runtimePayoutSimulationMode: boolean | null = null;

function isPayoutSimulationMode() {
  if (typeof runtimePayoutSimulationMode === "boolean") return runtimePayoutSimulationMode;
  return process.env.PAYOUT_SIMULATE_SUCCESS === "true";
}

export async function adminSyncPayoutSimulationModeFromDb() {
  try {
    const out = await pool.query(
      `SELECT value FROM public.admin_runtime_config WHERE key = $1 LIMIT 1`,
      [PAYOUT_SIM_MODE_CONFIG_KEY]
    );
    const raw = String(out.rows?.[0]?.value ?? "").trim().toLowerCase();
    if (raw === "true" || raw === "false") {
      runtimePayoutSimulationMode = raw === "true";
      process.env.PAYOUT_SIMULATE_SUCCESS = runtimePayoutSimulationMode ? "true" : "false";
    }
  } catch {
    // keep env/default mode if config table isn't ready yet
  }
  return { ok: true, simulation_mode: isPayoutSimulationMode() };
}

export async function adminSetPayoutSimulationMode(enabled: boolean) {
  runtimePayoutSimulationMode = Boolean(enabled);
  process.env.PAYOUT_SIMULATE_SUCCESS = runtimePayoutSimulationMode ? "true" : "false";
  await pool.query(
    `INSERT INTO public.admin_runtime_config (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [PAYOUT_SIM_MODE_CONFIG_KEY, runtimePayoutSimulationMode ? "true" : "false"]
  );
  return { ok: true, simulation_mode: runtimePayoutSimulationMode };
}

type PayoutRiskEvaluation = {
  allowed: boolean;
  manualReview: boolean;
  trustScore: number;
  reasons: string[];
  riskFlags: string[];
};

function parseTsMs(v: any): number | null {
  if (!v) return null;
  const d = new Date(v);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function evaluateUserPayoutRisk(user: any, stats: { monthlyCoins: number }): PayoutRiskEvaluation {
  const now = Date.now();
  const accountTs = parseTsMs(user?.account_created_at || user?.updated_at);
  const accountAgeDays = accountTs ? Math.max(0, Math.floor((now - accountTs) / 86400000)) : 0;
  const level = Number(user?.level ?? 1);
  const failCount = Number(user?.payout_fail_count || 0);
  const wallet = String(user?.pi_wallet_identifier || "").trim();

  const reasons: string[] = [];
  const riskFlags: string[] = [];
  let trustScore = 100;
  let allowed = true;
  let manualReview = false;

  if (!wallet) {
    allowed = false;
    reasons.push("missing_wallet_identifier");
    riskFlags.push("wallet_missing");
    trustScore -= 40;
  }
  if (Boolean(user?.payout_locked)) {
    allowed = false;
    reasons.push("payout_locked");
    riskFlags.push("payout_locked");
    trustScore -= 40;
  }
  if (Boolean(user?.manual_review_required)) {
    allowed = false;
    manualReview = true;
    reasons.push("manual_review_required");
    riskFlags.push("manual_review_required");
    trustScore -= 25;
  }
  if (Boolean(user?.suspicious) || Boolean(user?.vpn_flag) || Number(user?.fraud_score || 0) >= FRAUD_SCORE_MANUAL_REVIEW_THRESHOLD) {
    allowed = false;
    manualReview = true;
    reasons.push("fraud_review_required");
    if (Boolean(user?.suspicious)) riskFlags.push("suspicious");
    if (Boolean(user?.vpn_flag)) riskFlags.push("vpn_detected");
    if (Number(user?.fraud_score || 0) >= FRAUD_SCORE_MANUAL_REVIEW_THRESHOLD) riskFlags.push("fraud_score_high");
    trustScore -= 25;
  }
  if (accountAgeDays < MIN_ACCOUNT_AGE_DAYS) {
    allowed = false;
    reasons.push("account_too_new");
    riskFlags.push("new_account");
    trustScore -= 30;
  }
  if (!Number.isFinite(level) || level < MIN_LEVEL_FOR_PAYOUT) {
    allowed = false;
    reasons.push("level_below_minimum");
    riskFlags.push("low_level");
    trustScore -= 25;
  }
  if (Number(stats?.monthlyCoins || 0) >= SUSPICIOUS_MONTHLY_COINS) {
    allowed = false;
    manualReview = true;
    reasons.push("suspicious_monthly_coin_volume");
    riskFlags.push("coin_spike");
    trustScore -= 20;
  }
  if (failCount >= PAYOUT_FAIL_REVIEW_COUNT) {
    allowed = false;
    manualReview = true;
    reasons.push("repeated_payout_failures");
    riskFlags.push("payout_failures");
    trustScore -= 20;
  }

  trustScore = Math.max(0, Math.min(100, trustScore));
  return { allowed, manualReview, trustScore, reasons, riskFlags };
}

async function writeUserRiskState(client: any, uid: string, risk: PayoutRiskEvaluation) {
  const flags = JSON.stringify(Array.from(new Set(risk.riskFlags)));
  await client.query(
    `UPDATE public.users
        SET trust_score = $2,
            risk_flags = $3::jsonb,
            manual_review_required = $4,
            updated_at = NOW()
      WHERE uid = $1`,
    [uid, risk.trustScore, flags, risk.manualReview]
  );
}

async function auditRewardEvent(opts: {
  uid: string;
  eventType: string;
  eventKey: string;
  amountCoins?: number;
  amountPi?: number | null;
  accepted: boolean;
  rejectReason?: string | null;
}) {
  await pool.query(
    `INSERT INTO public.reward_event_audit (
       uid, event_type, event_key, amount_coins, amount_pi, accepted, reject_reason, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
    [
      opts.uid,
      opts.eventType,
      opts.eventKey,
      Number(opts.amountCoins || 0),
      opts.amountPi ?? null,
      opts.accepted,
      opts.rejectReason || null,
    ]
  );
}

async function getTotalPaidPi(): Promise<number> {
  const out = await pool.query(
    `SELECT COALESCE(SUM(payout_pi_amount), 0)::numeric AS total
       FROM public.pi_payout_jobs
      WHERE status = 'paid'`
  );
  return Number(out.rows[0]?.total || 0);
}

async function assertTreasuryCanPayout(payoutPi: number): Promise<{ ok: boolean; reason?: string; availablePi?: number; paidPi?: number }> {
  if (process.env.PAYOUT_SIMULATE_SUCCESS === "true") {
    return { ok: true };
  }
  const availableFromAdapter = await getSendingWalletAvailableBalancePi();
  const available =
    (Number.isFinite(availableFromAdapter as number)
      ? Number(availableFromAdapter)
      : Number(process.env.SENDING_WALLET_AVAILABLE_PI || process.env.PAYOUT_TREASURY_AVAILABLE_PI));

  if (!Number.isFinite(available)) {
    return { ok: false, reason: 'treasury_guard' };
  }

  const paid = await getTotalPaidPi();
  const remainingAfterSend = available - paid - payoutPi;
  const walletAfterSend = available - payoutPi;

  if (remainingAfterSend < TREASURY_RESERVE_PI) {
    return { ok: false, reason: 'treasury_guard', availablePi: available, paidPi: paid };
  }

  if (walletAfterSend < SENDING_WALLET_MIN_REQUIRED_PI) {
    return { ok: false, reason: 'treasury_guard', availablePi: available, paidPi: paid };
  }

  return { ok: true, availablePi: available, paidPi: paid };
}

function normalizePayoutErrorClass(raw: unknown): string {
  const msg = String(raw || '').toLowerCase();
  if (msg.includes('missing_wallet')) return 'missing_wallet';
  if (msg.includes('treasury_guard')) return 'treasury_guard';
  if (msg.includes('adapter_not_configured') || msg.includes('real_payout_adapter_not_configured')) return 'adapter_not_configured';
  if (msg.includes('timeout') || msg.includes('network') || msg.includes('fetch')) return 'temporary_network_error';
  if (msg.includes('duplicate_send_guard')) return 'duplicate_send_guard';
  if (msg.includes('rejected') || msg.includes('invalid_wallet') || msg.includes('insufficient_funds')) return 'permanent_rejection';
  return 'temporary_network_error';
}

async function insertPayoutTransferLog(opts: {
  payoutJobId: number;
  uid: string;
  walletIdentifier: string;
  amountPi: number;
  requestPayload?: any;
  responsePayload?: any;
  txid?: string | null;
  status: string;
  errorMessage?: string | null;
}) {
  await pool.query(
    `INSERT INTO public.payout_transfer_logs (
       payout_job_id, uid, wallet_identifier, amount_pi,
       request_payload, response_payload, txid, status, error_message, created_at
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, NOW())`,
    [
      opts.payoutJobId,
      opts.uid,
      opts.walletIdentifier,
      opts.amountPi,
      opts.requestPayload ? JSON.stringify(opts.requestPayload) : null,
      opts.responsePayload ? JSON.stringify(opts.responsePayload) : null,
      opts.txid || null,
      opts.status,
      opts.errorMessage || null,
    ]
  );
}


export function calculateFraudScore(user: any, sessionData: {
  is_vpn?: boolean;
  level_before?: number | null;
  level_after?: number | null;
  rapidRepeat?: boolean;
}) {
  let score = 0;

  if (sessionData?.is_vpn) score += 2;
  if (Number(user?.ads_watched_today || 0) > 10) score += 2;
  if (sessionData?.rapidRepeat) score += 2;
  if (sessionData?.level_after === sessionData?.level_before) score += 2;

  return score;
}

function isQueryClient(v: any): v is { query: (sql: string, values?: any[]) => Promise<any> } {
  return !!v && typeof v.query === "function";
}

export async function evaluateUserFraud(uid: string, opts?: {
  client?: { query: (sql: string, values?: any[]) => Promise<any> };
  rapidAdRepeat?: boolean;
  vpnDetected?: boolean;
}) {
  const db = isQueryClient(opts?.client) ? opts!.client : pool;

  const userRes = await db.query(
    `SELECT uid, fraud_score, suspicious, payout_locked, manual_review_required, vpn_flag,
            ads_watched_today, payout_fail_count, monthly_coins_earned, account_created_at,
            pi_wallet_identifier, last_ip
       FROM public.users
      WHERE uid = $1
      LIMIT 1`,
    [uid]
  );
  const user = userRes.rows[0];
  if (!user) throw new Error("user_not_found");

  const riskFlags: string[] = [];
  let score = 0;

  const wallet = String(user.pi_wallet_identifier || "").trim();
  const lastIp = String(user.last_ip || "").trim();
  const adsToday = Number(user.ads_watched_today || 0);
  const payoutFails = Number(user.payout_fail_count || 0);
  const monthlyCoins = Number(user.monthly_coins_earned || 0);

  if (Boolean(user.vpn_flag) || Boolean(opts?.vpnDetected)) {
    score += 2;
    riskFlags.push("vpn_detected");
  }

  if (adsToday > 10) {
    score += 2;
    riskFlags.push("too_many_ads_today");
  }

  let rapidAdRepeat = Boolean(opts?.rapidAdRepeat);
  if (!rapidAdRepeat) {
    const rapidRes = await db.query(
      `SELECT created_at
         FROM public.ad_watch_logs
        WHERE uid = $1
        ORDER BY created_at DESC
        LIMIT 2`,
      [uid]
    );
    if ((rapidRes.rowCount || 0) >= 2) {
      const a = new Date(rapidRes.rows[0].created_at).getTime();
      const b = new Date(rapidRes.rows[1].created_at).getTime();
      if (Number.isFinite(a) && Number.isFinite(b)) {
        rapidAdRepeat = (Math.abs(a - b) / 1000) < FRAUD_MIN_SECONDS_BETWEEN_REWARDED_ADS;
      }
    }
  }
  if (rapidAdRepeat) {
    score += 2;
    riskFlags.push("rapid_ad_repeat");
  }

  if (wallet) {
    const dupWalletRes = await db.query(
      `SELECT COUNT(*)::int AS c
         FROM public.users
        WHERE pi_wallet_identifier = $1`,
      [wallet]
    );
    const dupWalletCount = Number(dupWalletRes.rows[0]?.c || 0);
    if (dupWalletCount >= FRAUD_DUPLICATE_WALLET_THRESHOLD) {
      score += 3;
      riskFlags.push("duplicate_wallet_cluster");
    }
  }

  if (lastIp) {
    const sharedIpRes = await db.query(
      `SELECT COUNT(DISTINCT uid)::int AS c
         FROM public.ad_watch_logs
        WHERE ip = $1
          AND created_at >= (NOW() - INTERVAL '14 days')`,
      [lastIp]
    );
    const sharedIpUsers = Number(sharedIpRes.rows[0]?.c || 0);
    if (sharedIpUsers >= FRAUD_SHARED_IP_USER_THRESHOLD) {
      score += 3;
      riskFlags.push("shared_ip_cluster");
    }
  }

  if (payoutFails >= 3) {
    score += 2;
    riskFlags.push("repeated_payout_failures");
  }

  if (monthlyCoins >= SUSPICIOUS_MONTHLY_COINS) {
    score += 2;
    riskFlags.push("high_monthly_earnings");
  }

  const accountMs = user.account_created_at ? new Date(user.account_created_at).getTime() : NaN;
  if (Number.isFinite(accountMs)) {
    const ageDays = Math.max(0, Math.floor((Date.now() - accountMs) / 86400000));
    if (ageDays < FRAUD_NEW_ACCOUNT_DAYS) {
      score += 2;
      riskFlags.push("new_account");
    }
  }

  const uniqueFlags = Array.from(new Set(riskFlags));
  const suspicious = score >= FRAUD_SCORE_SUSPICIOUS_THRESHOLD;
  const manualReview = score >= FRAUD_SCORE_MANUAL_REVIEW_THRESHOLD;
  const payoutLocked = score >= FRAUD_SCORE_PAYOUT_LOCK_THRESHOLD;

  const updated = await db.query(
    `UPDATE public.users
        SET fraud_score = $2,
            suspicious = $3,
            manual_review_required = $4,
            payout_locked = $5,
            risk_flags = $6::jsonb,
            updated_at = NOW()
      WHERE uid = $1
      RETURNING uid, fraud_score, suspicious, manual_review_required, payout_locked, risk_flags, vpn_flag, ads_watched_today`,
    [uid, score, suspicious, manualReview, payoutLocked, JSON.stringify(uniqueFlags)]
  );

  return {
    ok: true,
    uid,
    fraud_score: score,
    suspicious,
    manual_review_required: manualReview,
    payout_locked: payoutLocked,
    risk_flags: uniqueFlags,
    user: updated.rows[0] || null,
  };
}

export async function trackRewardedAdActivity(opts: {
  uid: string;
  ip?: string | null;
  user_agent?: string | null;
  country?: string | null;
  asn?: string | null;
  isp?: string | null;
  is_vpn?: boolean;
  ad_type: string;
  level_before?: number | null;
  level_after?: number | null;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const lock = await client.query(
      `SELECT uid, fraud_score, vpn_flag, suspicious, ads_watched_today, last_ad_at, last_ad_watch_at
         FROM public.users
        WHERE uid = $1
        FOR UPDATE`,
      [opts.uid]
    );
    const user = lock.rows[0];
    if (!user) throw new Error("user_not_found");

    const ipRisk = await lookupIpRisk(opts.ip || null, opts.user_agent || null);
    const isVpn = Boolean(opts.is_vpn) || Boolean(ipRisk.is_vpn);
    const country = opts.country || ipRisk.country || null;
    const asn = opts.asn || ipRisk.asn || null;
    const isp = opts.isp || ipRisk.isp || null;
    const adsWatchedToday = Number(user?.ads_watched_today || 0);
    const eligibleForPayout = adsWatchedToday < PAYOUT_ELIGIBLE_ADS_PER_DAY;
    const lastAdMs = user?.last_ad_watch_at ? new Date(user.last_ad_watch_at).getTime() : NaN;
    const rapidRepeat = Number.isFinite(lastAdMs)
      ? ((Date.now() - Number(lastAdMs)) / 1000) < FRAUD_MIN_SECONDS_BETWEEN_REWARDED_ADS
      : false;

    const scoreAdd = calculateFraudScore(user, {
      is_vpn: isVpn,
      level_before: opts.level_before ?? null,
      level_after: opts.level_after ?? null,
      rapidRepeat,
    });

    await client.query(
      `INSERT INTO public.user_ad_activity (
         uid, ip, country, asn, isp, is_vpn, ad_type, level_before, level_after, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
      [
        opts.uid,
        opts.ip || null,
        country,
        asn,
        isp,
        isVpn,
        opts.ad_type,
        opts.level_before ?? null,
        opts.level_after ?? null,
      ]
    );

    await client.query(
      `INSERT INTO public.ad_watch_logs (
         uid, ad_type, ip, user_agent, country, isp, asn, is_vpn, eligible_for_payout, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
      [
        opts.uid,
        opts.ad_type,
        opts.ip || null,
        opts.user_agent || null,
        country,
        isp,
        asn,
        isVpn,
        eligibleForPayout,
      ]
    );

    await client.query(
      `UPDATE public.users
          SET fraud_score = COALESCE(fraud_score, 0) + $2,
              vpn_flag = CASE WHEN $3 THEN TRUE ELSE COALESCE(vpn_flag, FALSE) END,
              ads_watched_today = COALESCE(ads_watched_today, 0) + 1,
              last_ad_at = NOW(),
              last_ad_watch_at = NOW(),
              last_ip = COALESCE($4, last_ip),
              last_user_agent = COALESCE($5, last_user_agent),
              updated_at = NOW()
        WHERE uid = $1`,
      [opts.uid, scoreAdd, isVpn, opts.ip || null, opts.user_agent || null]
    );

    const fraudEval = await evaluateUserFraud(opts.uid, {
      client,
      rapidAdRepeat: rapidRepeat,
      vpnDetected: isVpn,
    });

    await client.query("COMMIT");
    try { await incrementDailyUserStats(opts.uid, { adsWatched: 1 }); } catch {}
    return {
      ok: true,
      score_added: scoreAdd,
      eligible_for_payout: eligibleForPayout,
      ip_risk: ipRisk,
      fraud: fraudEval,
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
export async function resetDailyAdCounters() {
  const out = await pool.query(
    `UPDATE public.users
        SET ads_watched_today = 0
      WHERE COALESCE(ads_watched_today, 0) <> 0`
  );
  return { ok: true, reset_users: Number(out.rowCount || 0) };
}

function assertCycleStatus(status: string): MonthlyPayoutCycleStatus {
  const allowed: MonthlyPayoutCycleStatus[] = ["open", "closed", "payouts_generated", "processing", "completed"];
  if (!allowed.includes(status as MonthlyPayoutCycleStatus)) throw new Error("invalid_cycle_status");
  return status as MonthlyPayoutCycleStatus;
}

function assertJobStatus(status: string): PiPayoutJobStatus {
  const allowed: PiPayoutJobStatus[] = ["queued", "processing", "paid", "failed", "failed_permanent", "blocked", "manual_review"];
  if (!allowed.includes(status as PiPayoutJobStatus)) throw new Error("invalid_job_status");
  return status as PiPayoutJobStatus;
}

function assertSnapshotStatus(status: string): MonthlyPayoutSnapshotStatus {
  const allowed: MonthlyPayoutSnapshotStatus[] = [
    "eligible",
    "below_threshold",
    "manual_review",
    "blocked",
    "queued",
    "paid",
    "failed",
  ];
  if (!allowed.includes(status as MonthlyPayoutSnapshotStatus)) throw new Error("invalid_snapshot_status");
  return status as MonthlyPayoutSnapshotStatus;
}

async function resolveCycleForUpdate(
  client: { query: (q: string, values?: any[]) => Promise<{ rows: any[] }> },
  opts: { cycleId?: number; monthKey?: string }
) {
  if (opts.cycleId) {
    const out = await client.query(
      `SELECT * FROM public.monthly_payout_cycles WHERE id = $1 FOR UPDATE`,
      [opts.cycleId]
    );
    return out.rows[0] || null;
  }

  if (opts.monthKey) {
    const out = await client.query(
      `SELECT * FROM public.monthly_payout_cycles WHERE month_key = $1 FOR UPDATE`,
      [opts.monthKey]
    );
    return out.rows[0] || null;
  }

  throw new Error("cycle_reference_required");
}

export async function closeMonthlyPayoutCycle(opts: {
  monthKey?: string;
  conversionRateLocked: number;
  minPayoutThresholdPi: number;
}) {
  const monthKey = normalizeMonthKey(opts.monthKey);
  const conversionRateLocked = toPositiveNumber(opts.conversionRateLocked, "conversion_rate_locked");
  const minPayoutThresholdPi = toPositiveNumber(opts.minPayoutThresholdPi, "min_payout_threshold_pi");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO public.monthly_payout_cycles (
         month_key,
         conversion_rate_locked,
         min_payout_threshold_pi,
         status,
         created_at
       )
       VALUES ($1, $2, $3, 'open', NOW())
       ON CONFLICT (month_key) DO NOTHING`,
      [monthKey, conversionRateLocked, minPayoutThresholdPi]
    );

    const cycleRes = await client.query(
      `SELECT *
         FROM public.monthly_payout_cycles
        WHERE month_key = $1
        FOR UPDATE`,
      [monthKey]
    );
    const cycle = cycleRes.rows[0];
    if (!cycle) throw new Error("cycle_not_found");

    const existingStatus = assertCycleStatus(String(cycle.status || "open"));
    if (existingStatus !== "open") {
      const snapCount = await client.query(
        `SELECT COUNT(*)::int AS c FROM public.monthly_payout_snapshots WHERE cycle_id = $1`,
        [cycle.id]
      );
      await client.query("COMMIT");
      return {
        ok: true,
        cycle_id: Number(cycle.id),
        month_key: String(cycle.month_key),
        status: existingStatus,
        snapshots_count: Number(snapCount.rows[0]?.c || 0),
        idempotent: true,
      };
    }

    await client.query(
      `UPDATE public.monthly_payout_cycles
          SET conversion_rate_locked = $2,
              min_payout_threshold_pi = $3,
              status = 'closed',
              closed_at = NOW()
        WHERE id = $1`,
      [cycle.id, conversionRateLocked, minPayoutThresholdPi]
    );

    await client.query(
      `INSERT INTO public.monthly_payout_snapshots (
         cycle_id,
         uid,
         coins_earned,
         carry_in_coins,
         total_coins_for_settlement,
         payout_pi_amount,
         carry_out_coins,
         status,
         created_at
       )
       SELECT
         $1 AS cycle_id,
         u.uid,
         COALESCE(u.coins, 0)::bigint AS coins_earned,
         COALESCE(u.payout_carry_coins, 0)::bigint AS carry_in_coins,
         (COALESCE(u.coins, 0)::bigint + COALESCE(u.payout_carry_coins, 0)::bigint) AS total_coins_for_settlement,
          CASE
            WHEN (COALESCE(u.payout_locked, FALSE) = TRUE)
              THEN 0::numeric(20,8)
            WHEN (COALESCE(u.manual_review_required, FALSE) = TRUE OR COALESCE(u.suspicious, FALSE) = TRUE OR COALESCE(u.vpn_flag, FALSE) = TRUE OR COALESCE(u.fraud_score, 0) >= $4)
              THEN 0::numeric(20,8)
            WHEN ((COALESCE(u.coins, 0)::numeric + COALESCE(u.payout_carry_coins, 0)::numeric) * $2::numeric) < $3::numeric
              THEN 0::numeric(20,8)
            ELSE ((COALESCE(u.coins, 0)::numeric + COALESCE(u.payout_carry_coins, 0)::numeric) * $2::numeric)::numeric(20,8)
          END AS payout_pi_amount,
          CASE
            WHEN (COALESCE(u.payout_locked, FALSE) = TRUE)
              THEN (COALESCE(u.coins, 0)::bigint + COALESCE(u.payout_carry_coins, 0)::bigint)
            WHEN (COALESCE(u.manual_review_required, FALSE) = TRUE OR COALESCE(u.suspicious, FALSE) = TRUE OR COALESCE(u.vpn_flag, FALSE) = TRUE OR COALESCE(u.fraud_score, 0) >= $4)
              THEN (COALESCE(u.coins, 0)::bigint + COALESCE(u.payout_carry_coins, 0)::bigint)
            WHEN ((COALESCE(u.coins, 0)::numeric + COALESCE(u.payout_carry_coins, 0)::numeric) * $2::numeric) < $3::numeric
              THEN (COALESCE(u.coins, 0)::bigint + COALESCE(u.payout_carry_coins, 0)::bigint)
            ELSE 0::bigint
          END AS carry_out_coins,
          CASE
            WHEN (COALESCE(u.payout_locked, FALSE) = TRUE)
              THEN 'blocked'
            WHEN (COALESCE(u.manual_review_required, FALSE) = TRUE OR COALESCE(u.suspicious, FALSE) = TRUE OR COALESCE(u.vpn_flag, FALSE) = TRUE OR COALESCE(u.fraud_score, 0) >= $4)
              THEN 'manual_review'
            WHEN ((COALESCE(u.coins, 0)::numeric + COALESCE(u.payout_carry_coins, 0)::numeric) * $2::numeric) < $3::numeric
              THEN 'below_threshold'
            ELSE 'eligible'
          END AS status,
         NOW()
       FROM public.users u
       WHERE (COALESCE(u.coins, 0)::bigint + COALESCE(u.payout_carry_coins, 0)::bigint) > 0
       ON CONFLICT (cycle_id, uid) DO NOTHING`,
      [cycle.id, conversionRateLocked, minPayoutThresholdPi, FRAUD_SCORE_MANUAL_REVIEW_THRESHOLD]
    );

    await client.query(
      `UPDATE public.users u
          SET coins = 0,
              payout_carry_coins = s.carry_out_coins,
              updated_at = NOW()
         FROM public.monthly_payout_snapshots s
        WHERE s.cycle_id = $1
          AND s.uid = u.uid`,
      [cycle.id]
    );

    const countRes = await client.query(
      `SELECT
         COUNT(*)::int AS snapshots_count,
         COALESCE(SUM(CASE WHEN status = 'eligible' THEN 1 ELSE 0 END), 0)::int AS eligible_count,
         COALESCE(SUM(CASE WHEN status = 'below_threshold' THEN 1 ELSE 0 END), 0)::int AS below_threshold_count,
         COALESCE(SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END), 0)::int AS blocked_count
       FROM public.monthly_payout_snapshots
       WHERE cycle_id = $1`,
      [cycle.id]
    );

    await client.query("COMMIT");

    return {
      ok: true,
      cycle_id: Number(cycle.id),
      month_key: monthKey,
      status: "closed" as MonthlyPayoutCycleStatus,
      snapshots_count: Number(countRes.rows[0]?.snapshots_count || 0),
      eligible_count: Number(countRes.rows[0]?.eligible_count || 0),
      below_threshold_count: Number(countRes.rows[0]?.below_threshold_count || 0),
      blocked_count: Number(countRes.rows[0]?.blocked_count || 0),
      idempotent: false,
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function generatePayoutJobs(opts: { cycleId?: number; monthKey?: string }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const monthKey = opts.monthKey ? normalizeMonthKey(opts.monthKey) : undefined;
    const cycle = await resolveCycleForUpdate(client, {
      cycleId: opts.cycleId,
      monthKey,
    });
    if (!cycle) throw new Error("cycle_not_found");

    const cycleStatus = assertCycleStatus(String(cycle.status || "open"));
    if (cycleStatus === "open") throw new Error("cycle_not_closed");
    await client.query(
      `UPDATE public.monthly_payout_snapshots s
          SET status = 'blocked'
         FROM public.users u
        WHERE s.cycle_id = $1
          AND s.status = 'eligible'
          AND u.uid = s.uid
          AND NULLIF(BTRIM(COALESCE(u.pi_wallet_identifier, '')), '') IS NULL`,
      [cycle.id]
    );

    const candidates = await client.query(
      `SELECT s.*, u.pi_wallet_identifier, u.payout_locked, u.manual_review_required, u.payout_fail_count, u.suspicious, u.vpn_flag, u.fraud_score,
              u.account_created_at, p.level
         FROM public.monthly_payout_snapshots s
         LEFT JOIN public.users u ON u.uid = s.uid
         LEFT JOIN public.progress p ON p.uid = s.uid
        WHERE s.cycle_id = $1
          AND s.status = 'eligible'
          AND s.payout_pi_amount > 0
          AND NULLIF(BTRIM(COALESCE(u.pi_wallet_identifier, '')), '') IS NOT NULL
        ORDER BY s.id ASC`,
      [cycle.id]
    );

    let insertedJobs = 0;
    let totalPayoutPi = 0;
    let cappedTotalPi = 0;
    let globalCapHit = false;

    for (const row of candidates.rows) {
      if (globalCapHit) {
        await client.query(
          `UPDATE public.monthly_payout_snapshots
              SET status = 'manual_review'
            WHERE cycle_id = $1 AND uid = $2 AND status = 'eligible'`,
          [cycle.id, row.uid]
        );
        continue;
      }

      const payoutOriginal = Number(row.payout_pi_amount || 0);
      const payoutCapped = Math.min(payoutOriginal, MAX_USER_MONTHLY_PI);
      totalPayoutPi += payoutOriginal;
      cappedTotalPi += payoutCapped;

      const fraudState = await evaluateUserFraud(String(row.uid), { client });
      const risk = evaluateUserPayoutRisk(
        {
          ...row,
          level: Number(row.level || 1),
          pi_wallet_identifier: row.pi_wallet_identifier,
          payout_fail_count: Number(row.payout_fail_count || 0),
          suspicious: Boolean(fraudState.suspicious),
          vpn_flag: Boolean(row.vpn_flag),
          fraud_score: Number(fraudState.fraud_score || row.fraud_score || 0),
          manual_review_required: Boolean(fraudState.manual_review_required),
          payout_locked: Boolean(fraudState.payout_locked),
        },
        { monthlyCoins: Number(row.total_coins_for_settlement || 0) }
      );

      await writeUserRiskState(client, String(row.uid), risk);

      if (!risk.allowed) {
        const nextStatus: MonthlyPayoutSnapshotStatus = risk.manualReview ? "manual_review" : "blocked";
        await client.query(
          `UPDATE public.monthly_payout_snapshots
              SET status = $3
            WHERE cycle_id = $1 AND uid = $2`,
          [cycle.id, row.uid, nextStatus]
        );

        await client.query(
          `INSERT INTO public.pi_payout_jobs (
             cycle_id, uid, payout_pi_amount, wallet_identifier, status,
             flagged, risk_reason, review_status, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,TRUE,$6,$7,NOW(),NOW())
           ON CONFLICT (cycle_id, uid) DO NOTHING`,
          [
            cycle.id,
            row.uid,
            payoutCapped,
            row.pi_wallet_identifier || null,
            nextStatus === "manual_review" ? "manual_review" : "blocked",
            (risk.reasons || []).join(",") || (nextStatus === "manual_review" ? "manual_review_required" : "blocked_by_risk"),
            nextStatus === "manual_review" ? "manual_review" : "auto",
          ]
        );
        continue;
      }

      if (cappedTotalPi > MAX_GLOBAL_MONTHLY_PI) {
        globalCapHit = true;
        await client.query(
          `UPDATE public.monthly_payout_cycles
              SET manual_review_required = TRUE
            WHERE id = $1`,
          [cycle.id]
        );
        await client.query(
          `UPDATE public.monthly_payout_snapshots
              SET status = 'manual_review'
            WHERE cycle_id = $1 AND uid = $2`,
          [cycle.id, row.uid]
        );
        continue;
      }

      if (!Number.isFinite(payoutCapped) || payoutCapped <= 0) {
        await client.query(
          `UPDATE public.monthly_payout_snapshots
              SET status = 'below_threshold'
            WHERE cycle_id = $1 AND uid = $2`,
          [cycle.id, row.uid]
        );
        continue;
      }

      const ins = await client.query(
        `INSERT INTO public.pi_payout_jobs (
           cycle_id,
           uid,
           payout_pi_amount,
           wallet_identifier,
           status,
           flagged,
           risk_reason,
           review_status,
           created_at,
           updated_at
         ) VALUES ($1, $2, $3, $4, 'queued', $5, $6, 'auto', NOW(), NOW())
         ON CONFLICT (cycle_id, uid) DO NOTHING
         RETURNING id`,
        [
          cycle.id,
          row.uid,
          payoutCapped,
          row.pi_wallet_identifier || null,
          payoutOriginal > payoutCapped,
          payoutOriginal > payoutCapped ? "user_cap_applied" : null,
        ]
      );

      if ((ins.rowCount || 0) > 0) {
        insertedJobs += 1;
        await client.query(
          `UPDATE public.monthly_payout_snapshots
              SET status = 'queued'
            WHERE cycle_id = $1 AND uid = $2`,
          [cycle.id, row.uid]
        );
      }
    }

    await client.query(
      `UPDATE public.monthly_payout_cycles
          SET status = CASE WHEN status = 'closed' THEN 'payouts_generated' ELSE status END,
              total_payout_pi = $2,
              capped_total_payout_pi = $3
        WHERE id = $1`,
      [cycle.id, totalPayoutPi, cappedTotalPi]
    );

    const totals = await client.query(
      `SELECT COUNT(*)::int AS total_jobs
       FROM public.pi_payout_jobs
       WHERE cycle_id = $1`,
      [cycle.id]
    );

    await client.query("COMMIT");

    return {
      ok: true,
      cycle_id: Number(cycle.id),
      month_key: String(cycle.month_key),
      inserted_jobs: insertedJobs,
      total_jobs: Number(totals.rows[0]?.total_jobs || 0),
      global_cap_hit: globalCapHit,
      total_payout_pi: totalPayoutPi,
      capped_total_payout_pi: cappedTotalPi,
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function adminListPayoutJobs(opts?: {
  cycleId?: number;
  monthKey?: string;
  status?: PiPayoutJobStatus;
  uidSearch?: string;
  limit?: number;
  offset?: number;
}) {
  const limit = Math.max(1, Math.min(500, toNonNegativeInt(opts?.limit, 100)));
  const offset = Math.max(0, toNonNegativeInt(opts?.offset, 0));
  const values: any[] = [];
  const where: string[] = [];

  if (opts?.cycleId) {
    values.push(opts.cycleId);
    where.push(`j.cycle_id = $${values.length}`);
  }

  if (opts?.monthKey) {
    values.push(normalizeMonthKey(opts.monthKey));
    where.push(`c.month_key = $${values.length}`);
  }

  const rawStatus = String(opts?.status || "").trim().toLowerCase();
  if (rawStatus && rawStatus !== "all") {
    values.push(assertJobStatus(rawStatus));
    where.push(`j.status = $${values.length}`);
  }

  if (opts?.uidSearch) {
    values.push(String(opts.uidSearch).trim());
    where.push(`j.uid ILIKE '%' || $${values.length} || '%'`);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS c
     FROM public.pi_payout_jobs j
     JOIN public.monthly_payout_cycles c ON c.id = j.cycle_id
     ${whereSql}`,
    values
  );

  values.push(limit);
  const limitIndex = values.length;
  values.push(offset);
  const offsetIndex = values.length;

  const out = await pool.query(
    `SELECT
       j.id,
       j.cycle_id,
       c.month_key,
       j.uid,
       j.payout_pi_amount,
       j.wallet_identifier,
       j.status,
       j.flagged,
       j.risk_reason,
       j.review_status,
       j.txid,
       j.external_status,
       j.treasury_blocked,
       j.error_message,
       j.attempts,
       j.idempotency_key,
       j.sent_at,
       j.confirmed_at,
       j.created_at,
       j.updated_at
     FROM public.pi_payout_jobs j
     JOIN public.monthly_payout_cycles c ON c.id = j.cycle_id
     ${whereSql}
     ORDER BY j.created_at DESC, j.id DESC
     LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    values
  );

  return {
    ok: true,
    rows: out.rows,
    count: Number(countRes.rows[0]?.c || 0),
  };
}


export async function adminListPayoutTransferLogs(jobId: number, limit = 50) {
  const out = await pool.query(
    `SELECT id, payout_job_id, uid, wallet_identifier, amount_pi, request_payload, response_payload,
            txid, status, error_message, created_at
       FROM public.payout_transfer_logs
      WHERE payout_job_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT $2`,
    [jobId, Math.max(1, Math.min(500, Number(limit || 50)))]
  );

  return { ok: true, rows: out.rows };
}

export async function adminListPayoutCycles(opts?: { limit?: number }) {
  const limit = Math.max(1, Math.min(24, toNonNegativeInt(opts?.limit, 6)));
  const out = await pool.query(
    `SELECT
       c.id,
       c.month_key,
       c.conversion_rate_locked,
       c.min_payout_threshold_pi,
       c.status,
       c.created_at,
       c.closed_at,
       COALESCE(COUNT(s.id), 0)::int AS total_users,
       COALESCE(SUM(s.payout_pi_amount), 0)::numeric(20,8) AS total_payout_pi
     FROM public.monthly_payout_cycles c
     LEFT JOIN public.monthly_payout_snapshots s ON s.cycle_id = c.id
     GROUP BY c.id, c.month_key, c.conversion_rate_locked, c.min_payout_threshold_pi, c.status, c.created_at, c.closed_at
     ORDER BY c.created_at DESC
     LIMIT $1`,
    [limit]
  );

  return { ok: true, rows: out.rows };
}

export async function adminGetPayoutSnapshotSummary(opts?: { cycleId?: number; monthKey?: string }) {
  const values: any[] = [];
  const where: string[] = [];

  if (opts?.cycleId) {
    values.push(opts.cycleId);
    where.push(`s.cycle_id = $${values.length}`);
  }

  if (opts?.monthKey) {
    values.push(normalizeMonthKey(opts.monthKey));
    where.push(`c.month_key = $${values.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const out = await pool.query(
    `SELECT
       COALESCE(COUNT(*), 0)::int AS total_users_snapshotted,
       COALESCE(SUM(CASE WHEN s.status = 'eligible' THEN 1 ELSE 0 END), 0)::int AS eligible_count,
       COALESCE(SUM(CASE WHEN s.status = 'below_threshold' THEN 1 ELSE 0 END), 0)::int AS below_threshold_count,
       COALESCE(SUM(CASE WHEN s.status = 'manual_review' THEN 1 ELSE 0 END), 0)::int AS manual_review_count,
       COALESCE(SUM(CASE WHEN s.status = 'blocked' THEN 1 ELSE 0 END), 0)::int AS blocked_count,
       COALESCE(SUM(CASE WHEN s.status = 'queued' THEN 1 ELSE 0 END), 0)::int AS queued_count,
       COALESCE(SUM(CASE WHEN s.status = 'paid' THEN 1 ELSE 0 END), 0)::int AS paid_count,
       COALESCE(SUM(CASE WHEN s.status = 'failed' THEN 1 ELSE 0 END), 0)::int AS failed_count,
       COALESCE(SUM(s.payout_pi_amount), 0)::numeric(20,8) AS total_payout_pi_amount
     FROM public.monthly_payout_snapshots s
     JOIN public.monthly_payout_cycles c ON c.id = s.cycle_id
     ${whereSql}`,
    values
  );

  return { ok: true, summary: out.rows[0] || null };
}

export async function adminGetPayoutRuntimeConfig() {
  await adminSyncPayoutSimulationModeFromDb();
  return {
    ok: true,
    simulation_mode: isPayoutSimulationMode(),
    payout_max_attempts: PAYOUT_MAX_ATTEMPTS,
    pi_payout_adapter_enabled: process.env.PI_PAYOUT_ADAPTER_ENABLED === "true",
    max_user_monthly_pi: MAX_USER_MONTHLY_PI,
    max_global_monthly_pi: MAX_GLOBAL_MONTHLY_PI,
    min_account_age_days: MIN_ACCOUNT_AGE_DAYS,
    min_level_for_payout: MIN_LEVEL_FOR_PAYOUT,
    treasury_reserve_pi: TREASURY_RESERVE_PI,
    sending_wallet_min_required_pi: SENDING_WALLET_MIN_REQUIRED_PI,
    fraud_score_suspicious_threshold: FRAUD_SCORE_SUSPICIOUS_THRESHOLD,
    fraud_score_manual_review_threshold: FRAUD_SCORE_MANUAL_REVIEW_THRESHOLD,
    fraud_score_payout_lock_threshold: FRAUD_SCORE_PAYOUT_LOCK_THRESHOLD,
    payout_eligible_ads_per_day: PAYOUT_ELIGIBLE_ADS_PER_DAY,
  };
}

export async function adminListPayoutSnapshots(opts?: {
  cycleId?: number;
  monthKey?: string;
  limit?: number;
  offset?: number;
}) {
  const limit = Math.max(1, Math.min(500, toNonNegativeInt(opts?.limit, 100)));
  const offset = Math.max(0, toNonNegativeInt(opts?.offset, 0));
  const values: any[] = [];
  const where: string[] = [];

  if (opts?.cycleId) {
    values.push(opts.cycleId);
    where.push(`s.cycle_id = $${values.length}`);
  }

  if (opts?.monthKey) {
    values.push(normalizeMonthKey(opts.monthKey));
    where.push(`c.month_key = $${values.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const summaryRes = await pool.query(
    `SELECT
       COALESCE(COUNT(*), 0)::int AS total_users_snapshotted,
       COALESCE(SUM(CASE WHEN s.status = 'eligible' THEN 1 ELSE 0 END), 0)::int AS eligible_count,
       COALESCE(SUM(CASE WHEN s.status = 'below_threshold' THEN 1 ELSE 0 END), 0)::int AS below_threshold_count,
       COALESCE(SUM(CASE WHEN s.status = 'manual_review' THEN 1 ELSE 0 END), 0)::int AS manual_review_count,
       COALESCE(SUM(CASE WHEN s.status = 'blocked' THEN 1 ELSE 0 END), 0)::int AS blocked_count,
       COALESCE(SUM(CASE WHEN s.status = 'queued' THEN 1 ELSE 0 END), 0)::int AS queued_count,
       COALESCE(SUM(CASE WHEN s.status = 'paid' THEN 1 ELSE 0 END), 0)::int AS paid_count,
       COALESCE(SUM(CASE WHEN s.status = 'failed' THEN 1 ELSE 0 END), 0)::int AS failed_count,
       COALESCE(SUM(s.payout_pi_amount), 0)::numeric(20,8) AS total_payout_pi_amount
     FROM public.monthly_payout_snapshots s
     JOIN public.monthly_payout_cycles c ON c.id = s.cycle_id
     ${whereSql}`,
    values
  );

  values.push(limit);
  const limitIndex = values.length;
  values.push(offset);
  const offsetIndex = values.length;

  const out = await pool.query(
    `SELECT s.*, c.month_key
     FROM public.monthly_payout_snapshots s
     JOIN public.monthly_payout_cycles c ON c.id = s.cycle_id
     ${whereSql}
     ORDER BY s.created_at DESC, s.id DESC
     LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    values
  );

  return { ok: true, rows: out.rows, summary: summaryRes.rows[0] || null };
}

export async function adminRetryFailedPayouts(opts?: { monthKey?: string }) {
  const values: any[] = [];
  let where = `j.status = 'failed'`;

  if (opts?.monthKey) {
    values.push(normalizeMonthKey(opts.monthKey));
    where += ` AND c.month_key = $${values.length}`;
  }

  const out = await pool.query(
    `UPDATE public.pi_payout_jobs j
        SET status = 'queued',
            error_message = NULL,
            updated_at = NOW()
       FROM public.monthly_payout_cycles c
      WHERE j.cycle_id = c.id
        AND ${where}
      RETURNING j.id, j.uid, j.cycle_id`,
    values
  );

  if (out.rows.length > 0) {
    const pairs = out.rows.map((r: any) => [Number(r.cycle_id), String(r.uid)]);
    for (const p of pairs) {
      await pool.query(
        `UPDATE public.monthly_payout_snapshots
            SET status = 'queued'
          WHERE cycle_id = $1 AND uid = $2`,
        [p[0], p[1]]
      );
    }
  }

  return { ok: true, retried: out.rows.length };
}

export async function adminResolvePayoutJob(jobId: number) {
  const out = await pool.query(
    `UPDATE public.pi_payout_jobs
        SET error_message = NULL,
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [jobId]
  );

  if (!out.rows.length) throw new Error("payout_job_not_found");
  return { ok: true, row: out.rows[0] };
}
export async function adminUpdatePayoutJobStatus(opts: {
  jobId: number;
  status: PiPayoutJobStatus;
  txid?: string | null;
  externalStatus?: string | null;
  treasuryBlocked?: boolean;
  sentAt?: string | null;
  confirmedAt?: string | null;
  errorMessage?: string | null;
}) {
  const status = assertJobStatus(opts.status);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const lock = await client.query(
      `SELECT * FROM public.pi_payout_jobs WHERE id = $1 FOR UPDATE`,
      [opts.jobId]
    );
    const job = lock.rows[0];
    if (!job) throw new Error("payout_job_not_found");

    const updated = await client.query(
      `UPDATE public.pi_payout_jobs
          SET status = $2,
              txid = CASE WHEN $2 = 'paid' THEN NULLIF($3, '') ELSE txid END,
              external_status = COALESCE(NULLIF($4, ''), external_status),
              treasury_blocked = COALESCE($5, treasury_blocked),
              sent_at = CASE WHEN $2 = 'paid' THEN COALESCE($6::timestamp, sent_at, NOW()) ELSE sent_at END,
              confirmed_at = CASE WHEN $2 = 'paid' THEN COALESCE($7::timestamp, confirmed_at, NOW()) ELSE confirmed_at END,
              error_message = CASE
                WHEN $2 IN ('failed', 'failed_permanent', 'blocked', 'manual_review') THEN NULLIF($8, '')
                WHEN $2 = 'paid' THEN NULL
                ELSE error_message
              END,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [
        opts.jobId,
        status,
        opts.txid || null,
        opts.externalStatus || null,
        typeof opts.treasuryBlocked === "boolean" ? opts.treasuryBlocked : null,
        opts.sentAt || null,
        opts.confirmedAt || null,
        opts.errorMessage || null,
      ]
    );

    let snapshotStatus: MonthlyPayoutSnapshotStatus | null = null;
    if (status === "paid") snapshotStatus = "paid";
    if (status === "failed" || status === "failed_permanent") snapshotStatus = "failed";
    if (status === "blocked") snapshotStatus = "blocked";
    if (status === "manual_review") snapshotStatus = "manual_review";
    if (status === "queued" || status === "processing") snapshotStatus = "queued";

    if (snapshotStatus) {
      await client.query(
        `UPDATE public.monthly_payout_snapshots
            SET status = $3
          WHERE cycle_id = $1 AND uid = $2`,
        [updated.rows[0].cycle_id, updated.rows[0].uid, snapshotStatus]
      );
    }

    const cycleAgg = await client.query(
      `SELECT
         COUNT(*)::int AS total_jobs,
         COALESCE(SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END), 0)::int AS paid_jobs
       FROM public.pi_payout_jobs
       WHERE cycle_id = $1`,
      [updated.rows[0].cycle_id]
    );

    const totalJobs = Number(cycleAgg.rows[0]?.total_jobs || 0);
    const paidJobs = Number(cycleAgg.rows[0]?.paid_jobs || 0);

    await client.query(
      `UPDATE public.monthly_payout_cycles
          SET status = CASE
            WHEN $2 > 0 AND $2 = $3 THEN 'completed'
            ELSE 'processing'
          END
        WHERE id = $1
          AND status <> 'open'`,
      [updated.rows[0].cycle_id, totalJobs, paidJobs]
    );

    await client.query("COMMIT");
    return { ok: true, row: updated.rows[0] };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function adminRequeueFailedPayoutJob(jobId: number) {
  const out = await pool.query(
    `UPDATE public.pi_payout_jobs
        SET status = 'queued',
            error_message = NULL,
            treasury_blocked = FALSE,
            updated_at = NOW()
      WHERE id = $1
        AND status IN ('failed', 'blocked')
      RETURNING *`,
    [jobId]
  );

  if (!out.rows.length) throw new Error("payout_job_not_requeueable_or_not_found");

  await pool.query(
    `UPDATE public.monthly_payout_snapshots
        SET status = 'queued'
      WHERE cycle_id = $1
        AND uid = $2`,
    [out.rows[0].cycle_id, out.rows[0].uid]
  );

  return { ok: true, row: out.rows[0] };
}

async function claimQueuedPayoutJobs(limit: number) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await client.query(
      `WITH picked AS (
         SELECT id
         FROM public.pi_payout_jobs
         WHERE status = 'queued'
           AND COALESCE(review_status, 'auto') IN ('auto', 'approved')
           AND COALESCE(treasury_blocked, FALSE) = FALSE
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       UPDATE public.pi_payout_jobs j
          SET status = 'processing',
              updated_at = NOW()
         FROM picked
        WHERE j.id = picked.id
       RETURNING j.*`,
      [Math.max(1, Math.min(100, limit))]
    );

    if ((out.rowCount || 0) > 0) {
      const cycleIds = Array.from(
        new Set(out.rows.map((r: any) => Number(r.cycle_id)).filter((n: number) => Number.isFinite(n)))
      );

      if (cycleIds.length > 0) {
        await client.query(
          `UPDATE public.monthly_payout_cycles
              SET status = 'processing'
            WHERE id = ANY($1::bigint[])
              AND status IN ('closed', 'payouts_generated')`,
          [cycleIds]
        );
      }
    }

    await client.query("COMMIT");
    return out.rows as PayoutJobRecord[];
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function sendPiPayout(job: PayoutJobRecord): Promise<{ ok: boolean; txid?: string; externalStatus?: string; error?: string; raw?: any }> {
  const normalizedWallet = String(job.wallet_identifier || "").trim().toLowerCase();
  const idempotencyKey = String(job.idempotency_key || `payout-job-${job.id}`);

  if (!normalizedWallet) {
    return { ok: false, error: "missing_wallet" };
  }

  return sendPiPayoutAdapter({
    uid: String(job.uid),
    walletIdentifier: normalizedWallet,
    amountPi: Number(job.payout_pi_amount || 0),
    idempotencyKey,
  });
}

export async function runPayoutWorkerBatch(opts?: { limit?: number }) {
  const limit = Math.max(1, Math.min(100, Number(opts?.limit || 10)));
  const jobs = await claimQueuedPayoutJobs(limit);

  let paid = 0;
  let failed = 0;
  let blocked = 0;
  let manualReview = 0;
  let failedPermanent = 0;

  for (const job of jobs) {
    const uid = String(job.uid);
    const payoutPi = Number(job.payout_pi_amount || 0);
    const currentAttempts = Number(job.attempts || 0);

    if (String(job.status) === "paid" || (job.txid && String(job.txid).trim())) {
      await adminUpdatePayoutJobStatus({
        jobId: Number(job.id),
        status: "failed_permanent",
        errorMessage: "duplicate_send_guard",
      });
      await insertPayoutTransferLog({
        payoutJobId: Number(job.id),
        uid,
        walletIdentifier: String(job.wallet_identifier || ""),
        amountPi: payoutPi,
        requestPayload: { reason: "already_has_txid_or_paid" },
        status: "failed_permanent",
        errorMessage: "duplicate_send_guard",
      });
      failedPermanent += 1;
      continue;
    }

    const idempotencyKey = String(job.idempotency_key || `payout-job-${job.id}`);
    await pool.query(
      `UPDATE public.pi_payout_jobs
          SET idempotency_key = COALESCE(idempotency_key, $2),
              updated_at = NOW()
        WHERE id = $1`,
      [job.id, idempotencyKey]
    );

    const userRes = await pool.query(
      `SELECT u.uid, u.pi_wallet_identifier, u.payout_locked, u.manual_review_required,
              u.suspicious, u.vpn_flag, u.fraud_score, u.risk_flags,
              u.payout_fail_count, u.account_created_at, u.monthly_coins_earned, p.level
         FROM public.users u
         LEFT JOIN public.progress p ON p.uid = u.uid
        WHERE u.uid = $1`,
      [uid]
    );
    const user = userRes.rows[0] || null;

    const normalizedWallet = String(user?.pi_wallet_identifier || job.wallet_identifier || "").trim().toLowerCase();
    if (!normalizedWallet) {
      await pool.query(
        `UPDATE public.pi_payout_jobs
            SET status = 'blocked',
                treasury_blocked = FALSE,
                wallet_identifier = NULL,
                attempts = attempts + 1,
                error_message = 'missing_wallet',
                updated_at = NOW()
          WHERE id = $1`,
        [job.id]
      );
      await adminUpdatePayoutJobStatus({ jobId: Number(job.id), status: "blocked", errorMessage: "missing_wallet" });
      await insertPayoutTransferLog({
        payoutJobId: Number(job.id),
        uid,
        walletIdentifier: "",
        amountPi: payoutPi,
        requestPayload: { idempotency_key: idempotencyKey },
        status: "blocked",
        errorMessage: "missing_wallet",
      });
      blocked += 1;
      continue;
    }

    const risk = evaluateUserPayoutRisk(user, { monthlyCoins: Number(user?.monthly_coins_earned || 0) });
    if (risk.manualReview) {
      await writeUserRiskState(pool, uid, risk);
      await adminUpdatePayoutJobStatus({
        jobId: Number(job.id),
        status: "manual_review",
        errorMessage: risk.reasons.join(",") || "manual_review_required",
      });
      await insertPayoutTransferLog({
        payoutJobId: Number(job.id),
        uid,
        walletIdentifier: normalizedWallet,
        amountPi: payoutPi,
        requestPayload: { idempotency_key: idempotencyKey },
        status: "manual_review",
        errorMessage: risk.reasons.join(",") || "manual_review_required",
      });
      manualReview += 1;
      continue;
    }

    const treasury = await assertTreasuryCanPayout(payoutPi);
    if (!treasury.ok) {
      await pool.query(
        `UPDATE public.pi_payout_jobs
            SET status = 'blocked',
                treasury_blocked = TRUE,
                attempts = attempts + 1,
                error_message = 'treasury_guard',
                updated_at = NOW()
          WHERE id = $1`,
        [job.id]
      );
      await adminUpdatePayoutJobStatus({ jobId: Number(job.id), status: "blocked", errorMessage: "treasury_guard" });
      await insertPayoutTransferLog({
        payoutJobId: Number(job.id),
        uid,
        walletIdentifier: normalizedWallet,
        amountPi: payoutPi,
        requestPayload: { idempotency_key: idempotencyKey, treasury },
        status: "blocked",
        errorMessage: "treasury_guard",
      });
      blocked += 1;
      continue;
    }

    const requestPayload = {
      uid,
      wallet_identifier: normalizedWallet,
      amount_pi: payoutPi,
      idempotency_key: idempotencyKey,
    };

    try {
      const tx = await sendPiPayout({
        ...job,
        wallet_identifier: normalizedWallet,
        idempotency_key: idempotencyKey,
      });

      if (!tx.ok || !String(tx.txid || "").trim()) {
        const normalizedError = normalizePayoutErrorClass(tx.error || "payout_failed");
        const nextAttempts = currentAttempts + 1;
        const nextStatus: PiPayoutJobStatus =
          normalizedError === "permanent_rejection" || normalizedError === "duplicate_send_guard" || nextAttempts >= PAYOUT_MAX_ATTEMPTS
            ? "failed_permanent"
            : "failed";

        await pool.query(
          `UPDATE public.pi_payout_jobs
              SET attempts = attempts + 1,
                  error_message = $2,
                  external_status = COALESCE($3, external_status),
                  updated_at = NOW()
            WHERE id = $1`,
          [job.id, normalizedError, tx.externalStatus || null]
        );

        await adminUpdatePayoutJobStatus({
          jobId: Number(job.id),
          status: nextStatus,
          errorMessage: normalizedError,
        });

        await insertPayoutTransferLog({
          payoutJobId: Number(job.id),
          uid,
          walletIdentifier: normalizedWallet,
          amountPi: payoutPi,
          requestPayload,
          responsePayload: tx.raw || tx,
          status: nextStatus,
          errorMessage: normalizedError,
        });

        if (nextStatus === "failed_permanent") failedPermanent += 1;
        else failed += 1;
        continue;
      }

      await pool.query(
        `UPDATE public.pi_payout_jobs
            SET wallet_identifier = $2,
                idempotency_key = COALESCE(idempotency_key, $3),
                external_status = $4,
                sent_at = COALESCE(sent_at, NOW()),
                confirmed_at = CASE
                  WHEN $4 ILIKE '%confirmed%' OR $4 ILIKE '%complete%' OR $4 ILIKE '%simulated%' THEN COALESCE(confirmed_at, NOW())
                  ELSE confirmed_at
                END,
                error_message = NULL,
                treasury_blocked = FALSE,
                updated_at = NOW()
          WHERE id = $1`,
        [job.id, normalizedWallet, idempotencyKey, tx.externalStatus || null]
      );

      await adminUpdatePayoutJobStatus({
        jobId: Number(job.id),
        status: "paid",
        txid: tx.txid,
      });

      await insertPayoutTransferLog({
        payoutJobId: Number(job.id),
        uid,
        walletIdentifier: normalizedWallet,
        amountPi: payoutPi,
        requestPayload,
        responsePayload: tx.raw || tx,
        txid: tx.txid,
        status: "paid",
      });
      paid += 1;
    } catch (e: any) {
      const normalizedError = normalizePayoutErrorClass(e?.message || "payout_failed");
      const nextAttempts = currentAttempts + 1;
      const nextStatus: PiPayoutJobStatus =
        normalizedError === "permanent_rejection" || normalizedError === "duplicate_send_guard" || nextAttempts >= PAYOUT_MAX_ATTEMPTS
          ? "failed_permanent"
          : "failed";

      await pool.query(
        `UPDATE public.users
            SET payout_fail_count = COALESCE(payout_fail_count, 0) + 1,
                updated_at = NOW()
          WHERE uid = $1`,
        [uid]
      );

      await pool.query(
        `UPDATE public.pi_payout_jobs
            SET attempts = attempts + 1,
                error_message = $2,
                updated_at = NOW()
          WHERE id = $1`,
        [job.id, normalizedError]
      );

      await adminUpdatePayoutJobStatus({
        jobId: Number(job.id),
        status: nextStatus,
        errorMessage: normalizedError,
      });

      await insertPayoutTransferLog({
        payoutJobId: Number(job.id),
        uid,
        walletIdentifier: normalizedWallet,
        amountPi: payoutPi,
        requestPayload,
        responsePayload: { error: String(e?.message || "payout_failed") },
        status: nextStatus,
        errorMessage: normalizedError,
      });

      if (nextStatus === "failed_permanent") failedPermanent += 1;
      else failed += 1;
    }
  }

  return {
    ok: true,
    claimed: jobs.length,
    paid,
    failed,
    failed_permanent: failedPermanent,
    blocked,
    manual_review: manualReview,
  };
}


export async function ensureUserAdsRow(uid: string) {
  const month = currentMonthKey();

  await pool.query(
    `
    INSERT INTO user_ads (uid, month)
    VALUES ($1, $2)
    ON CONFLICT (uid, month) DO NOTHING
    `,
    [uid, month]
  );

  return { uid, month };
}

export async function upsertUser({
  uid, username,
}: { uid: string; username: string; }) {
  const { rows } = await pool.query(
    `
    INSERT INTO public.users (uid, username, updated_at)
    VALUES ($1,$2,NOW())
    ON CONFLICT (uid)
    DO UPDATE SET
      username = EXCLUDED.username,
      updated_at = NOW()
    RETURNING *
  `,
    [uid, username]
  );
  return rows[0];
}

export async function getUserByUid(uid: string) {
  const { rows } = await pool.query(
    `SELECT * FROM public.users WHERE uid=$1`,
    [uid]
  );
  return rows[0] || null;
}

const DAILY_RP_CAP = 30;

export async function syncMcBalanceFromLegacyCoins(uid: string) {
  const out = await pool.query(
    `UPDATE public.users
        SET mc_balance = COALESCE(coins, 0)
      WHERE uid = $1
        AND COALESCE(mc_balance, 0) <> COALESCE(coins, 0)
      RETURNING uid, coins, mc_balance`,
    [uid]
  );
  return { ok: true, synced: (out.rowCount ?? 0) > 0, user: out.rows[0] || null };
}

export async function resetDailyRP(uid: string) {
  const out = await pool.query(
    `UPDATE public.users
        SET daily_rp = 0,
            last_rp_reset = NOW(),
            updated_at = NOW()
      WHERE uid = $1
      RETURNING uid, daily_rp, last_rp_reset`,
    [uid]
  );
  return { ok: true, user: out.rows[0] || null };
}

export async function resetDailyRPIfNeeded(uid: string) {
  const out = await pool.query(
    `UPDATE public.users
        SET daily_rp = 0,
            last_rp_reset = NOW(),
            updated_at = NOW()
      WHERE uid = $1
        AND (
          last_rp_reset IS NULL
          OR (last_rp_reset AT TIME ZONE 'UTC')::date < (NOW() AT TIME ZONE 'UTC')::date
        )
      RETURNING uid, daily_rp, last_rp_reset`,
    [uid]
  );
  return { ok: true, reset: (out.rowCount ?? 0) > 0, user: out.rows[0] || null };
}

export async function addMC(uid: string, amount: number) {
  const delta = Math.trunc(Number(amount || 0));
  if (!Number.isFinite(delta) || delta === 0) {
    return getUserByUid(uid);
  }

  const out = await pool.query(
    `UPDATE public.users
        SET mc_balance = COALESCE(mc_balance, 0) + $2,
            updated_at = NOW()
      WHERE uid = $1
      RETURNING *`,
    [uid, delta]
  );
  return out.rows[0] || null;
}

export async function addRP(uid: string, amount: number) {
  const requested = Math.max(0, Math.trunc(Number(amount || 0)));
  if (!requested) return { ok: true, added: 0, cap: DAILY_RP_CAP };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE public.users
          SET daily_rp = 0,
              last_rp_reset = NOW(),
              updated_at = NOW()
        WHERE uid = $1
          AND (
            last_rp_reset IS NULL
            OR (last_rp_reset AT TIME ZONE 'UTC')::date < (NOW() AT TIME ZONE 'UTC')::date
          )`,
      [uid]
    );

    const lock = await client.query(
      `SELECT daily_rp, rp_score
         FROM public.users
        WHERE uid = $1
        FOR UPDATE`,
      [uid]
    );

    const user = lock.rows[0];
    if (!user) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'user_not_found' };
    }

    const remaining = Math.max(0, DAILY_RP_CAP - Number(user.daily_rp || 0));
    const toAdd = Math.min(requested, remaining);

    if (toAdd <= 0) {
      await client.query('COMMIT');
      return { ok: true, added: 0, cap: DAILY_RP_CAP };
    }

    const updated = await client.query(
      `UPDATE public.users
          SET rp_score = COALESCE(rp_score, 0) + $2,
              daily_rp = COALESCE(daily_rp, 0) + $2,
              updated_at = NOW()
        WHERE uid = $1
        RETURNING uid, rp_score, daily_rp`,
      [uid, toAdd]
    );

    await client.query('COMMIT');
    return { ok: true, added: toAdd, cap: DAILY_RP_CAP, user: updated.rows[0] || null };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
export async function incrementDailyUserStats(uid: string, delta?: {
  coinsEarned?: number;
  levelsCompleted?: number;
  adsWatched?: number;
}) {
  const coinsEarned = Math.max(0, Math.floor(Number(delta?.coinsEarned || 0)));
  const levelsCompleted = Math.max(0, Math.floor(Number(delta?.levelsCompleted || 0)));
  const adsWatched = Math.max(0, Math.floor(Number(delta?.adsWatched || 0)));

  if (coinsEarned <= 0 && levelsCompleted <= 0 && adsWatched <= 0) {
    return { ok: true, skipped: true };
  }

  await pool.query(
    `INSERT INTO public.daily_user_stats (
       uid, date_key, coins_earned, levels_completed, ads_watched, created_at, updated_at
     ) VALUES ($1, CURRENT_DATE, $2, $3, $4, NOW(), NOW())
     ON CONFLICT (uid, date_key)
     DO UPDATE SET
       coins_earned = public.daily_user_stats.coins_earned + EXCLUDED.coins_earned,
       levels_completed = public.daily_user_stats.levels_completed + EXCLUDED.levels_completed,
       ads_watched = public.daily_user_stats.ads_watched + EXCLUDED.ads_watched,
       updated_at = NOW()`,
    [uid, coinsEarned, levelsCompleted, adsWatched]
  );

  return { ok: true };
}

export async function getDailyLeaderboard(limit = 20) {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit || 20))));
  const out = await pool.query(
    `WITH ranked AS (
       SELECT
         ROW_NUMBER() OVER (ORDER BY s.coins_earned DESC, s.updated_at ASC, s.uid ASC)::int AS rank,
         s.uid,
         COALESCE(u.username, s.uid) AS username,
         s.coins_earned
       FROM public.daily_user_stats s
       JOIN public.users u ON u.uid = s.uid
       WHERE s.date_key = CURRENT_DATE
     )
     SELECT rank, uid, username, coins_earned
       FROM ranked
      ORDER BY rank ASC
      LIMIT $1`,
    [safeLimit]
  );
  return { ok: true, rows: out.rows };
}

export async function getDailyLeaderboardMe(uid: string) {
  const meUser = await pool.query(
    `SELECT uid,
            COALESCE(username, uid) AS username,
            COALESCE(suspicious, FALSE) AS suspicious,
            COALESCE(payout_locked, FALSE) AS payout_locked,
            COALESCE(manual_review_required, FALSE) AS manual_review_required
       FROM public.users
      WHERE uid = $1
      LIMIT 1`,
    [uid]
  );

  const userRow = meUser.rows[0] || {};
  const username = String(userRow?.username || uid);
  const publicEligible =
    !Boolean(userRow?.suspicious) &&
    !Boolean(userRow?.payout_locked) &&
    !Boolean(userRow?.manual_review_required);

  const own = await pool.query(
    `SELECT COALESCE(coins_earned, 0)::int AS coins_earned
       FROM public.daily_user_stats
      WHERE uid = $1
        AND date_key = CURRENT_DATE
      LIMIT 1`,
    [uid]
  );
  const coinsEarned = Number(own.rows[0]?.coins_earned || 0);

  const rankedAll = await pool.query(
    `WITH ranked AS (
       SELECT
         ROW_NUMBER() OVER (ORDER BY s.coins_earned DESC, s.updated_at ASC, s.uid ASC)::int AS rank,
         s.uid
       FROM public.daily_user_stats s
       WHERE s.date_key = CURRENT_DATE
     )
     SELECT rank
       FROM ranked
      WHERE uid = $1
      LIMIT 1`,
    [uid]
  );

  const publicReason = !publicEligible
    ? (Boolean(userRow?.payout_locked)
        ? "payout_locked"
        : Boolean(userRow?.manual_review_required)
          ? "manual_review_required"
          : "suspicious")
    : null;

  return {
    ok: true,
    row: {
      rank: rankedAll.rows[0]?.rank != null ? Number(rankedAll.rows[0].rank) : null,
      uid,
      username,
      coins_earned: coinsEarned,
      public_eligible: publicEligible,
      public_exclusion_reason: publicReason,
    },
  };
}

export async function getDailyLeaderboardRaw(limit = 100) {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit || 100))));
  const out = await pool.query(
    `SELECT
       s.uid,
       COALESCE(u.username, s.uid) AS username,
       s.date_key,
       s.coins_earned,
       s.levels_completed,
       s.ads_watched,
       s.updated_at,
       COALESCE(u.suspicious, FALSE) AS suspicious,
       COALESCE(u.payout_locked, FALSE) AS payout_locked,
       COALESCE(u.manual_review_required, FALSE) AS manual_review_required
     FROM public.daily_user_stats s
     LEFT JOIN public.users u ON u.uid = s.uid
     WHERE s.date_key = CURRENT_DATE
     ORDER BY s.coins_earned DESC, s.updated_at ASC, s.uid ASC
     LIMIT $1`,
    [safeLimit]
  );
  return { ok: true, rows: out.rows };
}

const DAILY_RANKING_REWARD_TABLE: Record<number, number> = {
  1: 120,
  2: 100,
  3: 80,
  4: 60,
  5: 50,
  6: 40,
  7: 35,
  8: 30,
  9: 25,
 10: 20,
};

function parseDateKey(input?: string | null) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error("invalid_date_key");
  return raw;
}

export async function snapshotDailyLeaderboardRewards(opts?: { dateKey?: string | null }) {
  const dateKey = parseDateKey(opts?.dateKey);
  const targetDateExpr = dateKey ? "$1::date" : "(CURRENT_DATE - INTERVAL '1 day')::date";
  const params = dateKey ? [dateKey] : [];

  const snapshotSql = `WITH ranked AS (
      SELECT
        s.uid,
        s.coins_earned::int AS coins_earned,
        ROW_NUMBER() OVER (ORDER BY s.coins_earned DESC, s.updated_at ASC, s.uid ASC)::int AS rank
      FROM public.daily_user_stats s
      JOIN public.users u ON u.uid = s.uid
      WHERE s.date_key = ${targetDateExpr}
        AND COALESCE(u.suspicious, FALSE) = FALSE
        AND COALESCE(u.payout_locked, FALSE) = FALSE
        AND COALESCE(u.manual_review_required, FALSE) = FALSE
    ), top10 AS (
      SELECT * FROM ranked WHERE rank <= 10
    )
    INSERT INTO public.daily_leaderboard_snapshots (
      date_key, uid, rank, coins_earned, reward_coins, eligible, claimed, created_at
    )
    SELECT
      ${targetDateExpr} AS date_key,
      t.uid,
      t.rank,
      t.coins_earned,
      CASE t.rank
        WHEN 1 THEN 120
        WHEN 2 THEN 100
        WHEN 3 THEN 80
        WHEN 4 THEN 60
        WHEN 5 THEN 50
        WHEN 6 THEN 40
        WHEN 7 THEN 35
        WHEN 8 THEN 30
        WHEN 9 THEN 25
        WHEN 10 THEN 20
        ELSE 0
      END::int AS reward_coins,
      TRUE AS eligible,
      FALSE AS claimed,
      NOW() AS created_at
    FROM top10 t
    ON CONFLICT (date_key, uid) DO NOTHING`;

  await pool.query(snapshotSql, params);

  const summarySql = `SELECT
      date_key,
      COUNT(*)::int AS rows_count,
      COALESCE(SUM(reward_coins), 0)::int AS total_reward_coins
    FROM public.daily_leaderboard_snapshots
    WHERE date_key = ${targetDateExpr}
    GROUP BY date_key`;

  const summary = await pool.query(summarySql, params);

  return {
    ok: true,
    date_key: summary.rows[0]?.date_key || (dateKey || null),
    rows_count: Number(summary.rows[0]?.rows_count || 0),
    total_reward_coins: Number(summary.rows[0]?.total_reward_coins || 0),
  };
}

export async function getDailyLeaderboardRewardMe(uid: string) {
  const out = await pool.query(
    `SELECT date_key, rank, reward_coins, claimed, claimed_at
       FROM public.daily_leaderboard_snapshots
      WHERE uid = $1
        AND eligible = TRUE
        AND claimed = FALSE
        AND reward_coins > 0
      ORDER BY date_key DESC, rank ASC
      LIMIT 1`,
    [uid]
  );

  if (!out.rows.length) return { ok: true, available: false };

  return {
    ok: true,
    available: true,
    row: {
      date_key: out.rows[0].date_key,
      rank: Number(out.rows[0].rank || 0),
      reward_coins: Number(out.rows[0].reward_coins || 0),
      claimed: Boolean(out.rows[0].claimed),
      claimed_at: out.rows[0].claimed_at || null,
    },
  };
}

export async function claimDailyLeaderboardReward(uid: string) {
  await pool.query("BEGIN");
  try {
    const userLock = await pool.query(
      `SELECT uid, coins,
              COALESCE(suspicious, FALSE) AS suspicious,
              COALESCE(payout_locked, FALSE) AS payout_locked,
              COALESCE(manual_review_required, FALSE) AS manual_review_required
         FROM public.users
        WHERE uid = $1
        FOR UPDATE`,
      [uid]
    );

    if (!userLock.rows.length) {
      await pool.query("ROLLBACK");
      return { ok: false, error: "user_not_found" };
    }

    if (Boolean(userLock.rows[0].suspicious) || Boolean(userLock.rows[0].payout_locked) || Boolean(userLock.rows[0].manual_review_required)) {
      await pool.query("ROLLBACK");
      return { ok: false, error: "no_reward_available" };
    }

    const rewardRow = await pool.query(
      `SELECT id, date_key, rank, reward_coins
         FROM public.daily_leaderboard_snapshots
        WHERE uid = $1
          AND eligible = TRUE
          AND claimed = FALSE
          AND reward_coins > 0
        ORDER BY date_key DESC, rank ASC
        LIMIT 1
        FOR UPDATE`,
      [uid]
    );

    if (!rewardRow.rows.length) {
      await pool.query("ROLLBACK");
      return { ok: false, error: "no_reward_available" };
    }

    const row = rewardRow.rows[0];
    const rewardCoins = Number(row.reward_coins || 0);
    if (rewardCoins <= 0) {
      await pool.query("ROLLBACK");
      return { ok: false, error: "no_reward_available" };
    }

    const updatedUser = await pool.query(
      `UPDATE public.users
          SET coins = COALESCE(coins,0) + $2,
              monthly_coins_earned = COALESCE(monthly_coins_earned,0) + $2,
              lifetime_coins_earned = COALESCE(lifetime_coins_earned,0) + $2,
              updated_at = NOW()
        WHERE uid = $1
      RETURNING *`,
      [uid, rewardCoins]
    );

    await pool.query(
      `UPDATE public.daily_leaderboard_snapshots
          SET claimed = TRUE,
              claimed_at = NOW()
        WHERE id = $1`,
      [row.id]
    );

    await pool.query("COMMIT");

    try {
      await recalcAndStoreMonthlyRate(uid);
    } catch {}

    try {
      await auditRewardEvent({
        uid,
        eventType: "daily_leaderboard_reward",
        eventKey: `${row.date_key}:#${row.rank}`,
        amountCoins: rewardCoins,
        accepted: true,
      });
    } catch {}

    return {
      ok: true,
      rewardCoins,
      rank: Number(row.rank || 0),
      dateKey: String(row.date_key),
      user: updatedUser.rows[0] || null,
    };
  } catch (e) {
    await pool.query("ROLLBACK");
    throw e;
  }
}

export async function adminGetDailyLeaderboardRewardRaw(opts?: { dateKey?: string | null; limit?: number }) {
  const dateKey = parseDateKey(opts?.dateKey);
  const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(opts?.limit || 100))));
  const out = await pool.query(
    `SELECT
       s.id,
       s.date_key,
       s.uid,
       COALESCE(u.username, s.uid) AS username,
       s.rank,
       s.coins_earned,
       s.reward_coins,
       s.eligible,
       s.claimed,
       s.claimed_at,
       s.created_at
     FROM public.daily_leaderboard_snapshots s
     LEFT JOIN public.users u ON u.uid = s.uid
     WHERE ($1::date IS NULL OR s.date_key = $1::date)
     ORDER BY s.date_key DESC, s.rank ASC, s.uid ASC
     LIMIT $2`,
    [dateKey, safeLimit]
  );

  return { ok: true, rows: out.rows };
}

export async function addCoins(uid: string, delta: number) {
  const d = Number(delta || 0);

  const { rows } = await pool.query(
    `
    UPDATE public.users
    SET
      coins = COALESCE(coins,0) + $2,
      mc_balance = COALESCE(mc_balance,0) + $2,
      monthly_coins_earned = COALESCE(monthly_coins_earned,0) + GREATEST($2,0),
      lifetime_coins_earned = COALESCE(lifetime_coins_earned,0) + GREATEST($2,0),
      updated_at=NOW()
    WHERE uid=$1
    RETURNING *
  `,
    [uid, d]
  );
  if (d > 0) {
    try { await incrementDailyUserStats(uid, { coinsEarned: d }); } catch {}
  }

  return rows[0];
}

export async function spendCoins(uid: string, amount: number) {
  const a = Math.abs(Number(amount || 0));
  if (!a) throw new Error("Amount required");

  const { rows } = await pool.query(
    `
    UPDATE public.users
SET
  coins = COALESCE(coins,0) - $2,
  mc_balance = COALESCE(mc_balance,0) - $2,
  lifetime_coins_spent = COALESCE(lifetime_coins_spent,0) + $2,
  updated_at=NOW()
      WHERE uid=$1 AND COALESCE(coins,0) >= $2
      RETURNING *
    `,
    [uid, a]
  );

  if (!rows.length) {
    throw new Error("Not enough coins");
  }
  return rows[0];
}

/* =====================================================
   PROGRESS
===================================================== */
export async function getProgressByUid(uid: string) {
  const { rows } = await pool.query(
    `SELECT * FROM progress WHERE uid=$1`,
    [uid]
  );
  return rows[0] || null;
}

export async function setProgressByUid({
  uid,
  level,
  coins,
  paintedKeys,
  resume,
}: {
  uid: string;
  level?: number;
  coins?: number;
  paintedKeys?: any;
  resume?: any;
}) {
  await pool.query(
    `
    INSERT INTO progress (uid, level, coins, painted_keys, resume)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (uid)
    DO UPDATE SET
      level = GREATEST(progress.level, EXCLUDED.level),
      coins = EXCLUDED.coins,
      painted_keys = COALESCE($4::jsonb, progress.painted_keys),
      resume = $5,
      updated_at = NOW()
    `,
    [
      uid,
      level ?? 1,
      coins ?? 0,
      paintedKeys ? JSON.stringify(paintedKeys) : null,
resume ? JSON.stringify(resume) : null,
    ]
  );
}

/* =====================================================
   REWARDS
===================================================== */

export async function claimReward({
  uid, type, nonce, amount, cooldownSeconds,
}: {
  uid: string;
  type: string;
  nonce: string;
  amount: number;
  cooldownSeconds: number;
}) {
  if (!nonce) {
    await auditRewardEvent({ uid, eventType: type, eventKey: "missing_nonce", amountCoins: amount, accepted: false, rejectReason: "missing_nonce" });
    throw new Error("missing_nonce");
  }

  const nonceRes = await pool.query(
    `SELECT 1 FROM reward_claims WHERE uid=$1 AND nonce=$2 LIMIT 1`,
    [uid, nonce]
  );
  if ((nonceRes.rowCount ?? 0) > 0) {
    await auditRewardEvent({ uid, eventType: type, eventKey: nonce, amountCoins: amount, accepted: false, rejectReason: "duplicate_nonce" });
    return { already: true };
  }

  if (cooldownSeconds > 0) {
    const cooldownRes = await pool.query(
      `
      SELECT 1
      FROM reward_claims
      WHERE uid = $1
        AND type = $2
        AND created_at > NOW() - ($3 * INTERVAL '1 second')
      LIMIT 1
      `,
      [uid, type, cooldownSeconds]
    );

    if ((cooldownRes.rowCount ?? 0) > 0) {
      await auditRewardEvent({ uid, eventType: type, eventKey: nonce, amountCoins: amount, accepted: false, rejectReason: "cooldown_active" });
      return { already: true, cooldown: true };
    }
  }

  await pool.query(
    `
    INSERT INTO reward_claims (uid, type, nonce, amount, created_at)
    VALUES ($1, $2, $3, $4, NOW())
    `,
    [uid, type, nonce, amount]
  );

  const user = await addCoins(uid, amount);
  await auditRewardEvent({ uid, eventType: type, eventKey: nonce, amountCoins: amount, accepted: true });

  if (type === "ad_50" || type === "ad") {
    await pool.query(
      `UPDATE public.users
       SET monthly_ads_watched = COALESCE(monthly_ads_watched,0) + 1,
           monthly_surprise_boxes_opened = COALESCE(monthly_surprise_boxes_opened,0) + 1
       WHERE uid=$1`,
      [uid]
    );
    await recalcAndStoreMonthlyRate(uid);
  }

  return { user };
}

export async function claimDailyLogin(uid: string) {
  const dayKey = new Date().toISOString().slice(0, 10);
  const { rowCount } = await pool.query(
    `
    SELECT 1 FROM reward_claims
    WHERE uid=$1 AND type='daily_login'
      AND created_at::date = CURRENT_DATE
  `,
    [uid]
  );

  if (rowCount) {
    await auditRewardEvent({ uid, eventType: "daily_login", eventKey: dayKey, amountCoins: 5, accepted: false, rejectReason: "daily_already_claimed" });
    return { already: true };
  }

  await pool.query(
    `
    INSERT INTO reward_claims (uid,type,amount,created_at)
    VALUES ($1,'daily_login',5,NOW())
  `,
    [uid]
  );

  const user = await addCoins(uid, 5);
  await pool.query(
    `UPDATE public.users SET monthly_login_days = COALESCE(monthly_login_days,0) + 1 WHERE uid=$1`,
    [uid]
  );
  await recalcAndStoreMonthlyRate(uid);
  await auditRewardEvent({ uid, eventType: "daily_login", eventKey: dayKey, amountCoins: 5, accepted: true });
  return { user };
}

export async function claimLevelComplete(uid: string, level: number) {
  if (!Number.isInteger(level) || level < 1) {
    throw new Error("invalid_level");
  }
  const insert = await pool.query(
    `
    INSERT INTO public.level_rewards (uid, level, created_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (uid, level) DO NOTHING
    `,
    [uid, level]
  );

  if ((insert.rowCount ?? 0) === 0) {
    await auditRewardEvent({ uid, eventType: "level_complete", eventKey: String(level), amountCoins: 1, accepted: false, rejectReason: "duplicate_level_reward" });
    return { already: true };
  }

  const user = await addCoins(uid, 1);

  await pool.query(
    `
    UPDATE public.users
    SET
      monthly_levels_completed = COALESCE(monthly_levels_completed,0) + 1,
      lifetime_levels_completed = COALESCE(lifetime_levels_completed,0) + 1
    WHERE uid=$1
    `,
    [uid]
  );

  await recalcAndStoreMonthlyRate(uid);
  await auditRewardEvent({ uid, eventType: "level_complete", eventKey: String(level), amountCoins: 1, accepted: true });
  return { user };
}

/* =====================================================
  RESTARTS / SKIPS / HINTS 
===================================================== */

export async function useRestarts(
  uid: string,
  mode: SpendMode,
  nonce?: string
) {
  const user = await getUserByUid(uid);
  if (!user) throw new Error("User not found");

  // ---- FREE ----
  if (mode === "free") {
  if (user.free_restarts_used >= 3) {
    return { ok: false, error: "NO_FREE_RESTARTS" };
  }

  const { rows } = await pool.query(
    `UPDATE public.users
     SET free_restarts_used = free_restarts_used + 1,
         updated_at = NOW()
     WHERE uid = $1
     RETURNING *`,
    [uid]
  );

  return { ok: true, user: rows[0] };
}

  // ---- COINS ----
  if (mode === "coins") {
    const u = await spendCoins(uid, RESTART_COST_COINS);

    await pool.query(
      `INSERT INTO reward_claims (uid,type,amount,created_at)
       VALUES ($1,'restart_coin',-$2,NOW())`,
      [uid, RESTART_COST_COINS]
    );

    return { ok: true, user: u };
  }
}

export async function useSkip(
  uid: string,
  mode: SpendMode,
  nonce?: string
) {
  const user = await getUserByUid(uid);
  if (!user) throw new Error("User not found");

  // ---- FREE ----
  if (mode === "free") {
    if (user.free_skips_used >= 3) {
      return { ok: false, error: "NO_FREE_SKIPS" };
    }

    const { rows } = await pool.query(
      `UPDATE public.users
       SET free_skips_used = free_skips_used + 1,
           updated_at = NOW()
       WHERE uid=$1
       RETURNING *`,
      [uid]
    );
await pool.query(
    `
    UPDATE public.users
    SET monthly_skips_used = COALESCE(monthly_skips_used,0) + 1
    WHERE uid=$1
    `,
    [uid]
  );

  await recalcAndStoreMonthlyRate(uid);
    return { ok: true, user: rows[0] };
  }

  // ---- COINS ----
  if (mode === "coins") {
    const u = await spendCoins(uid, SKIP_COST_COINS);

    await pool.query(
      `INSERT INTO reward_claims (uid,type,amount,created_at)
       VALUES ($1,'skip_coin',-$2,NOW())`,
      [uid, SKIP_COST_COINS]
    );
await pool.query(
    `
    UPDATE public.users
    SET monthly_skips_used = COALESCE(monthly_skips_used,0) + 1
    WHERE uid=$1
    `,
    [uid]
  );

  await recalcAndStoreMonthlyRate(uid);
    return { ok: true, user: u };
  }

  // ---- AD ----
  if (mode === "ad") {
    if (!nonce) throw new Error("Missing nonce");

    const already = await pool.query(
      `SELECT 1 FROM reward_claims
       WHERE uid=$1 AND type='skip_ad' AND nonce=$2`,
      [uid, nonce]
    );
    if (already.rowCount) {
      return { ok: true, already: true, user };
    }

    await pool.query(
      `INSERT INTO reward_claims (uid,type,nonce,amount,created_at)
       VALUES ($1,'skip_ad',$2,0,NOW())`,
      [uid, nonce]
    );

    await trackAdView(uid, "skips");
    await pool.query(
    `
    UPDATE public.users
    SET
      monthly_skips_used = COALESCE(monthly_skips_used,0) + 1,
      monthly_ads_watched = COALESCE(monthly_ads_watched,0) + 1
    WHERE uid=$1
    `,
    [uid]
  );

  await recalcAndStoreMonthlyRate(uid);
    return { ok: true, user };
  }

  throw new Error("INVALID_SKIP_MODE");
}


export async function useHint(uid: string, mode: SpendMode, nonce?: string) {
  const user = await getUserByUid(uid);
  if (!user) throw new Error("User not found");

  if (mode === "free") {
    if (getFreeHintsLeft(user) <= 0) throw new Error("No free hints left");
    const { rows } = await pool.query(
      `UPDATE public.users
       SET free_hints_used = COALESCE(free_hints_used,0) + 1,
           updated_at=NOW()
       WHERE uid=$1
       RETURNING *`,
      [uid]
    );
    return { ok: true, user: rows[0] };
  }

  if (mode === "coins") {
    const u = await spendCoins(uid, HINT_COST_COINS);
    await pool.query(
      `INSERT INTO reward_claims (uid,type,amount,created_at)
       VALUES ($1,'hint_coin',-$2,NOW())`,
      [uid, HINT_COST_COINS]
    );
    return { ok: true, user: u };
  }

  // mode === "ad"
  if (!nonce) throw new Error("Missing nonce");
  const already = await pool.query(
    `SELECT 1 FROM reward_claims WHERE uid=$1 AND type='hint_ad' AND nonce=$2`,
    [uid, nonce]
  );
  if (already.rowCount) return { ok: true, already: true, user };

  await pool.query(
    `INSERT INTO reward_claims (uid,type,nonce,amount,created_at)
     VALUES ($1,'hint_ad',$2,0,NOW())`,
    [uid, nonce]
  );
  await trackAdView(uid, "hints");
  return { ok: true, user };
}

/* =====================================================
   ONLINE / SESSIONS
===================================================== */
export async function touchUserOnline(uid: string) {
  await pool.query(
    `
    INSERT INTO sessions (uid, session_id, last_seen_at)
    VALUES ($1,'auto',NOW())
    ON CONFLICT (uid)
    DO UPDATE SET last_seen_at=NOW()
  `,
    [uid]
  );
}

export async function startSession({
  uid, sessionId, userAgent, ip,
}: { uid: string; sessionId: string; userAgent: string; ip: string; }) {
  const { rows } = await pool.query(
    `
    INSERT INTO sessions (uid,session_id,user_agent,ip,started_at,last_seen_at)
    VALUES ($1,$2,$3,$4,NOW(),NOW())
    ON CONFLICT (uid)
    DO UPDATE SET last_seen_at=NOW(), session_id=$2
    RETURNING *
  `,
    [uid, sessionId, userAgent, ip]
  );
  return rows[0];
}

export async function pingSession(uid: string) {
  const { rows } = await pool.query(
    `
    UPDATE sessions
    SET last_seen_at=NOW()
    WHERE uid=$1
    RETURNING *
  `,
    [uid]
  );
  return rows[0];
}

export async function endSession(uid: string) {
  const { rows } = await pool.query(
    `DELETE FROM sessions WHERE uid=$1 RETURNING *`,
    [uid]
  );
  return rows[0];
}

/* =====================================================
   ADMIN
===================================================== */

export async function adminListUsers({
  search,
  limit,
  offset,
  suspiciousOnly,
  vpnOnly,
  manualReviewOnly,
  payoutLockedOnly,
}: {
  search?: string;
  limit: number;
  offset: number;
  suspiciousOnly?: boolean;
  vpnOnly?: boolean;
  manualReviewOnly?: boolean;
  payoutLockedOnly?: boolean;
}) {
  const values: any[] = [];
  const where: string[] = [];

  if (search) {
    values.push(search);
    where.push(`(username ILIKE '%' || $${values.length} || '%' OR uid ILIKE '%' || $${values.length} || '%')`);
  }

  if (suspiciousOnly) {
    where.push(`(COALESCE(suspicious, FALSE) = TRUE OR COALESCE(vpn_flag, FALSE) = TRUE OR COALESCE(fraud_score, 0) >= ${FRAUD_SCORE_MANUAL_REVIEW_THRESHOLD})`);
  }
  if (vpnOnly) where.push(`COALESCE(vpn_flag, FALSE) = TRUE`);
  if (manualReviewOnly) where.push(`COALESCE(manual_review_required, FALSE) = TRUE`);
  if (payoutLockedOnly) where.push(`COALESCE(payout_locked, FALSE) = TRUE`);

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  values.push(limit);
  const limitIdx = values.length;
  values.push(offset);
  const offsetIdx = values.length;

  const { rows } = await pool.query(
    `
    SELECT *
    FROM public.users
    ${whereSql}
    ORDER BY updated_at DESC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `,
    values
  );

  const countValues = values.slice(0, values.length - 2);
  const { rows: c } = await pool.query(
    `SELECT COUNT(*) FROM public.users ${whereSql}`,
    countValues
  );

  return { rows, count: Number(c[0].count) };
}

export async function adminGetUser(uid: string) {
  const user = await getUserByUid(uid);
  const progress = await getProgressByUid(uid);

  const { rows: stats } = await pool.query(
    `SELECT type,COUNT(*) FROM reward_claims WHERE uid=$1 GROUP BY type`,
    [uid]
  );

  const { rows: session } = await pool.query(
    `SELECT * FROM sessions WHERE uid=$1`,
    [uid]
  );

  return {
    user,
    progress,
    stats,
    last_session: session[0] || null,
  };
}

export async function adminSetUserPayoutLock(uid: string, locked: boolean) {
  const { rows } = await pool.query(
    `UPDATE public.users
        SET payout_locked = $2,
            updated_at = NOW()
      WHERE uid = $1
      RETURNING uid, payout_locked, suspicious, manual_review_required, fraud_score, risk_flags`,
    [uid, locked]
  );
  if (!rows[0]) throw new Error("user_not_found");
  return { ok: true, row: rows[0] };
}

export async function adminSetUserSuspicious(uid: string, suspicious: boolean) {
  const { rows } = await pool.query(
    `UPDATE public.users
        SET suspicious = $2,
            updated_at = NOW()
      WHERE uid = $1
      RETURNING uid, payout_locked, suspicious, manual_review_required, fraud_score, risk_flags`,
    [uid, suspicious]
  );
  if (!rows[0]) throw new Error("user_not_found");
  return { ok: true, row: rows[0] };
}

export async function adminSetUserManualReview(uid: string, manualReview: boolean) {
  const { rows } = await pool.query(
    `UPDATE public.users
        SET manual_review_required = $2,
            updated_at = NOW()
      WHERE uid = $1
      RETURNING uid, payout_locked, suspicious, manual_review_required, fraud_score, risk_flags`,
    [uid, manualReview]
  );
  if (!rows[0]) throw new Error("user_not_found");
  return { ok: true, row: rows[0] };
}

export async function adminReevaluateUserFraud(uid: string) {
  return evaluateUserFraud(uid);
}
export async function adminResetFreeCounters(uid: string) {
  const { rows } = await pool.query(
    `
    UPDATE public.users
    SET free_skips_used=0, free_hints_used=0
    WHERE uid=$1
    RETURNING *
  `,
    [uid]
  );
  return rows[0];
}
export async function adminDeleteUser(uid: string) {
  // delete user
  await pool.query(
    `DELETE FROM public.users WHERE uid = $1`,
    [uid]
  );

  // delete progress
  await pool.query(
    `DELETE FROM progress WHERE uid = $1`,
    [uid]
  );

  // delete sessions
  await pool.query(
    `DELETE FROM sessions WHERE uid = $1`,
    [uid]
  );

  return { ok: true };
}
export async function adminGetStats({ onlineMinutes }: { onlineMinutes: number }) {
  const users = await pool.query(`SELECT COUNT(*) FROM public.users`);
  const coins = await pool.query(`SELECT SUM(coins) FROM public.users`);
  const online = await pool.query(
    `
    SELECT COUNT(*) FROM sessions
    WHERE last_seen_at > NOW() - ($1 || ' minutes')::interval
  `,
    [onlineMinutes]
  );



  const ad50 = await pool.query(`SELECT COUNT(*) FROM reward_claims WHERE type='ad_50'`);
  const daily = await pool.query(`SELECT COUNT(*) FROM reward_claims WHERE type='daily_login'`);
  const levels = await pool.query(`SELECT COUNT(*) FROM level_rewards`);

  return {
    users_total: Number(users.rows[0].count),
    coins_total: Number(coins.rows[0].sum || 0),
    online_now: Number(online.rows[0].count),
    ad50_count: Number(ad50.rows[0].count),
    daily_login_count: Number(daily.rows[0].count),
    level_complete_count: Number(levels.rows[0].count),
  };
}

export async function adminListOnlineUsers({
  minutes, limit, offset,
}: { minutes: number; limit: number; offset: number; }) {
  const { rows } = await pool.query(
    `
    SELECT u.uid,u.username,u.coins,
           s.last_seen_at,s.started_at,s.user_agent
    FROM sessions s
    JOIN public.users u ON u.uid=s.uid
    WHERE s.last_seen_at > NOW() - ($1 || ' minutes')::interval
    ORDER BY s.last_seen_at DESC
    LIMIT $2 OFFSET $3
  `,
    [minutes, limit, offset]
  );

  return { rows, count: rows.length };
}


/* ============================
   Charts (Step 1 â€“ 7 days default)
============================ */
export async function adminChartCoins({ days }: { days: number }) {
  const d = Math.max(1, Math.min(90, Number(days || 7)));
  const { rows } = await pool.query(
    `
    SELECT
      to_char(gs.day, 'YYYY-MM-DD') AS day,
      COALESCE(SUM(rc.amount), 0)::int AS coins
    FROM generate_series(
      CURRENT_DATE - ($1::int - 1),
      CURRENT_DATE,
      interval '1 day'
    ) AS gs(day)
    LEFT JOIN reward_claims rc
      ON rc.created_at::date = gs.day::date
    GROUP BY gs.day
    ORDER BY gs.day ASC
  `,
    [d]
  );
  return rows.map(r => ({ day: r.day, coins: Number(r.coins) }));
}

export async function adminChartActiveUsers({ days }: { days: number }) {
      const d = Math.max(1, Math.min(90, Number(days || 7)));
      const { rows } = await pool.query(
      `
      SELECT
      to_char(gs.day, 'YYYY-MM-DD') AS day,
      COALESCE(COUNT(DISTINCT s.uid), 0)::int AS active_users
      FROM generate_series(
      CURRENT_DATE - ($1::int - 1),
      CURRENT_DATE,
      interval '1 day'
      ) AS gs(day)
      LEFT JOIN sessions s
      ON s.last_seen_at::date = gs.day::date
      GROUP BY gs.day
      ORDER BY gs.day ASC
      `,
      [d]
      );
      return rows.map(r => ({ day: r.day, active_users: Number(r.active_users) }));
      }
      
      export async function trackAdView(
      uid: string,
      kind: "coins" | "skips" | "hints"| "restarts"
      ) {
      const month = currentMonthKey();

      await pool.query(
      `
      INSERT INTO user_ads (uid, month)
      VALUES ($1, $2)
      ON CONFLICT (uid, month)
      DO NOTHING
      `,
      [uid, month]
      );

      const column =
  kind === "coins"
    ? "ads_for_coins"
    : kind === "skips"
    ? "ads_for_skips"
    : kind === "hints"
    ? "ads_for_hints"
    : "ads_for_restarts";
      await pool.query(
      `
      UPDATE user_ads
      SET ${column} = ${column} + 1
      WHERE uid = $1 AND month = $2
      `,
      [uid, month]
      );
      }
                

export async function getMonthlyAds(uid: string) {
  const month = currentMonthKey();

  const { rows } = await pool.query(
    `
    SELECT
      ads_for_coins,
      ads_for_skips,
      ads_for_hints
    FROM user_ads
    WHERE uid = $1 AND month = $2
    `,
    [uid, month]
  );

  if (!rows.length) {
    return {
      ads_for_coins: 0,
      ads_for_skips: 0,
      ads_for_hints: 0,
    };
  }

  return rows[0];
}

function coinRewardForAd(adsForCoinsThisMonth: number) {
  const reward = 50 - adsForCoinsThisMonth;
  return Math.max(reward, 2);
}
export async function claimCoinAd(uid: string) {
  // 1ï¸âƒ£ Track ad view
  await trackAdView(uid, "coins");

  // 2ï¸âƒ£ Read monthly ads
  const ads = await getMonthlyAds(uid);

  // ads_for_coins already incremented
  const coins = coinRewardForAd(ads.ads_for_coins - 1);

  // 3ï¸âƒ£ Use EXISTING reward system
  const nonce = `coin-ad-${currentMonthKey()}-${ads.ads_for_coins}`;

  return await claimReward({
    uid,
    type: "ad",
    nonce,
    amount: coins,
    cooldownSeconds: 0,
  });
}

export async function getCompletedLevels(uid: string) {
  const { rows } = await pool.query(
    `SELECT level FROM level_rewards WHERE uid=$1`,
    [uid]
  );
  return rows.map(r => r.level);
}
function prevMonthKey() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1; // 1..12
  const prev = new Date(Date.UTC(y, m - 2, 1)); // previous month
  return monthKeyForDate(prev);
}



export function calcMonthlyRate(u: any) {
  const invitesCount = Number(u?.lifetime_valid_invites ?? u?.monthly_valid_invites ?? 0);
  const loginDays = Number(u?.monthly_login_days || 0);
  const levelsCompleted = Number(u?.monthly_levels_completed || 0);
  const surpriseBoxesOpened = Number(u?.monthly_surprise_boxes_opened || 0);
  const mysteryBoxesOpened = Number(u?.monthly_mystery_boxes_opened || 0);
  const skipsUsed = Number(u?.monthly_skips_used || 0);
  const hintsUsed = Number(u?.monthly_hints_used || 0);
  const restartsUsed = Number(u?.monthly_restarts_used || 0);

  const base = 50;
  const invitesPersistent = Math.min(10, Math.max(0, invitesCount) * 2); // +2% per invite, max +10%
  const loginMonthly = Math.min(10, Math.floor(Math.max(0, loginDays) / 2)); // 20 days => +10%
  const usageMonthly =
    (skipsUsed >= 5 ? 1 : 0) +
    (hintsUsed >= 5 ? 1 : 0) +
    (restartsUsed >= 5 ? 1 : 0); // +1% each type after 5 monthly uses, max +3%
  // Levels bonus is monthly-capped at +10%, reaching cap at 200 completed levels.
  const levelsMonthly = Math.min(10, Math.floor(Math.max(0, levelsCompleted) / 20)); // +1% per 20 levels
  const surpriseMonthly = Math.min(10, Math.floor(Math.max(0, surpriseBoxesOpened) / 20)); // 200/month => +10%
  const mysteryMonthly = mysteryBoxesOpened >= 1 ? 5 : 0; // 1/month => +5%

  const breakdown: Record<string, number> = {
    base,
    invites_persistent: invitesPersistent,
    login_monthly: loginMonthly,
    usage_monthly: usageMonthly,
    levels_monthly: levelsMonthly,
    surprise_monthly: surpriseMonthly,
    mystery_monthly: mysteryMonthly,

    // Legacy keys kept for compatibility with existing UI/consumers.
    daily: loginMonthly,
    levels: levelsMonthly,
    invites: invitesPersistent,
    skill: usageMonthly,
    engagement: 0,
    streak: 0,
  };

  const rate = Math.min(
    100,
    base +
      invitesPersistent +
      loginMonthly +
      usageMonthly +
      levelsMonthly +
      surpriseMonthly +
      mysteryMonthly
  );

  return { rate, breakdown };
}

export async function recalcAndStoreMonthlyRate(uid: string) {
  const { rows } = await pool.query(`SELECT * FROM public.users WHERE uid=$1`, [uid]);
  const u = rows[0];
  if (!u) throw new Error("User not found");

  const out = calcMonthlyRate(u);

  const { rows: updated } = await pool.query(
    `
    UPDATE public.users
    SET
      monthly_rate_breakdown = $2::jsonb,
      monthly_final_rate = $3,
      updated_at = NOW()
    WHERE uid=$1
    RETURNING *
    `,
    [uid, JSON.stringify(out.breakdown), out.rate]
  );

  return { user: updated[0], breakdown: out.breakdown, rate: out.rate };
}

export async function claimMonthlyRewards(uid: string, opts?: { month?: string }) {
  const month = String(opts?.month || prevMonthKey());

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // lock user
    const { rows } = await client.query(
      `SELECT * FROM public.users WHERE uid=$1 FOR UPDATE`,
      [uid]
    );
    const u = rows[0];
    if (!u) throw new Error("User not found");

    // snapshot coins + rate
    const coinsCollected = Number(u.coins || 0);
    const rate = Math.max(0, Math.min(100, Number(u.monthly_final_rate || 50)));

    // create payout row once
    await client.query(
      `
      INSERT INTO monthly_payouts (uid, month, coins_collected, pi_amount, status, created_at)
      VALUES ($1,$2,$3,NULL,'pending',NOW())
      ON CONFLICT (uid, month) DO NOTHING
      `,
      [uid, month, coinsCollected]
    );

    // reset coins + monthly stats
    await client.query(
      `
      UPDATE public.users
      SET
        coins = 0,
        monthly_key = $2,
        monthly_coins_earned = 0,
        monthly_login_days = 0,
        monthly_levels_completed = 0,
        monthly_skips_used = 0,
        monthly_hints_used = 0,
        monthly_restarts_used = 0,
        monthly_ads_watched = 0,
        monthly_surprise_boxes_opened = 0,
        monthly_mystery_boxes_opened = 0,
        monthly_valid_invites = 0,
        monthly_max_win_streak = 0,
        monthly_rate_breakdown = '{}'::jsonb,
        monthly_final_rate = 50,
        updated_at = NOW()
      WHERE uid=$1
      RETURNING *
      `,
      [uid, currentMonthKey()]
    );

    await client.query("COMMIT");

    return {
      ok: true,
      month,
      coins_collected: coinsCollected,
      rate_snapshot: rate,
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}




function normalizeInviteCode(input: string) {
  return String(input || "").trim().toUpperCase();
}

function makeInviteCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export async function ensureInviteCode(uid: string) {
  const existing = await pool.query(
    `SELECT invite_code FROM public.users WHERE uid=$1 LIMIT 1`,
    [uid]
  );

  const current = String(existing.rows[0]?.invite_code || "").trim();
  if (current) return current;

  for (let i = 0; i < 10; i++) {
    const code = makeInviteCode();
    try {
      const updated = await pool.query(
        `
        UPDATE public.users
        SET invite_code = $2,
            updated_at = NOW()
        WHERE uid = $1
          AND (invite_code IS NULL OR invite_code = '')
        RETURNING invite_code
        `,
        [uid, code]
      );

      const got = String(updated.rows[0]?.invite_code || "").trim();
      if (got) return got;

      const recheck = await pool.query(
        `SELECT invite_code FROM public.users WHERE uid=$1 LIMIT 1`,
        [uid]
      );
      const maybe = String(recheck.rows[0]?.invite_code || "").trim();
      if (maybe) return maybe;
    } catch (e: any) {
      if (e?.code !== "23505") throw e;
    }
  }

  throw new Error("invite_code_generation_failed");
}

export async function getInviteSummary(uid: string) {
  const code = await ensureInviteCode(uid);

  const me = await pool.query(
    `SELECT invited_by_uid FROM public.users WHERE uid=$1 LIMIT 1`,
    [uid]
  );

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS count FROM public.user_invites WHERE inviter_uid=$1`,
    [uid]
  );

  const listRes = await pool.query(
    `
    SELECT ui.invitee_uid, u.username, ui.created_at
    FROM public.user_invites ui
    LEFT JOIN public.users u ON u.uid = ui.invitee_uid
    WHERE ui.inviter_uid = $1
    ORDER BY ui.created_at DESC
    LIMIT 200
    `,
    [uid]
  );

  return {
    invite_code: code,
    invited_by_uid: me.rows[0]?.invited_by_uid || null,
    invited_count: Number(countRes.rows[0]?.count || 0),
    invited_users: listRes.rows,
  };
}

export async function claimInviteCode(inviteeUid: string, rawCode: string) {
  const inviteCode = normalizeInviteCode(rawCode);
  if (!inviteCode) throw new Error("invite_code_required");

  const client = await pool.connect();
  let committed = false;
  let inviterUid = "";

  try {
    await client.query("BEGIN");

    const inviteeRes = await client.query(
      `SELECT uid, invited_by_uid FROM public.users WHERE uid=$1 FOR UPDATE`,
      [inviteeUid]
    );
    const invitee = inviteeRes.rows[0];
    if (!invitee) throw new Error("invitee_not_found");

    if (invitee.invited_by_uid) {
      throw new Error("invite_already_claimed");
    }

    const inviterRes = await client.query(
      `SELECT uid FROM public.users WHERE invite_code=$1 LIMIT 1`,
      [inviteCode]
    );
    inviterUid = String(inviterRes.rows[0]?.uid || "");
    if (!inviterUid) throw new Error("invite_code_invalid");

    if (inviterUid === inviteeUid) {
      throw new Error("cannot_invite_self");
    }

    await client.query(
      `
      INSERT INTO public.user_invites (invitee_uid, inviter_uid, invite_code, created_at)
      VALUES ($1,$2,$3,NOW())
      `,
      [inviteeUid, inviterUid, inviteCode]
    );

    await client.query(
      `
      UPDATE public.users
      SET invited_by_uid = $2,
          invited_at = NOW(),
          updated_at = NOW()
      WHERE uid = $1
      `,
      [inviteeUid, inviterUid]
    );

    await client.query(
      `
      UPDATE public.users
      SET monthly_valid_invites = COALESCE(monthly_valid_invites,0) + 1,
          lifetime_valid_invites = COALESCE(lifetime_valid_invites,0) + 1,
          updated_at = NOW()
      WHERE uid = $1
      `,
      [inviterUid]
    );

    await client.query("COMMIT");
    committed = true;

    await recalcAndStoreMonthlyRate(inviterUid);

    return {
      ok: true,
      inviter_uid: inviterUid,
      invite_code: inviteCode,
    };
  } catch (e) {
    if (!committed) {
      await client.query("ROLLBACK");
    }
    throw e;
  } finally {
    client.release();
  }
}







