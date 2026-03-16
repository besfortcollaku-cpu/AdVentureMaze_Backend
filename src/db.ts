import { Pool } from "pg";
console.log("Backend v2.0.1");
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true"
    ? { rejectUnauthorized: false }
    : undefined,
});

/* =====================================================
   INIT  (✅ Fix 1: auto-create core tables incl. sessions)
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
      ADD COLUMN IF NOT EXISTS pi_wallet_identifier TEXT;
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
type MonthlyPayoutSnapshotStatus = "eligible" | "below_threshold" | "queued" | "paid" | "failed";
type PiPayoutJobStatus = "queued" | "processing" | "paid" | "failed";

type PayoutJobRecord = {
  id: number;
  cycle_id: number;
  uid: string;
  payout_pi_amount: string;
  wallet_identifier: string | null;
  status: PiPayoutJobStatus;
  txid: string | null;
  error_message: string | null;
  attempts: number;
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

function assertCycleStatus(status: string): MonthlyPayoutCycleStatus {
  const allowed: MonthlyPayoutCycleStatus[] = ["open", "closed", "payouts_generated", "processing", "completed"];
  if (!allowed.includes(status as MonthlyPayoutCycleStatus)) throw new Error("invalid_cycle_status");
  return status as MonthlyPayoutCycleStatus;
}

function assertJobStatus(status: string): PiPayoutJobStatus {
  const allowed: PiPayoutJobStatus[] = ["queued", "processing", "paid", "failed"];
  if (!allowed.includes(status as PiPayoutJobStatus)) throw new Error("invalid_job_status");
  return status as PiPayoutJobStatus;
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
           WHEN ((COALESCE(u.coins, 0)::numeric + COALESCE(u.payout_carry_coins, 0)::numeric) * $2::numeric) < $3::numeric THEN 0::numeric(20,8)
           ELSE ((COALESCE(u.coins, 0)::numeric + COALESCE(u.payout_carry_coins, 0)::numeric) * $2::numeric)::numeric(20,8)
         END AS payout_pi_amount,
         CASE
           WHEN ((COALESCE(u.coins, 0)::numeric + COALESCE(u.payout_carry_coins, 0)::numeric) * $2::numeric) < $3::numeric
             THEN (COALESCE(u.coins, 0)::bigint + COALESCE(u.payout_carry_coins, 0)::bigint)
           ELSE 0::bigint
         END AS carry_out_coins,
         CASE
           WHEN ((COALESCE(u.coins, 0)::numeric + COALESCE(u.payout_carry_coins, 0)::numeric) * $2::numeric) < $3::numeric
             THEN 'below_threshold'
           ELSE 'eligible'
         END AS status,
         NOW()
       FROM public.users u
       WHERE (COALESCE(u.coins, 0)::bigint + COALESCE(u.payout_carry_coins, 0)::bigint) > 0
       ON CONFLICT (cycle_id, uid) DO NOTHING`,
      [cycle.id, conversionRateLocked, minPayoutThresholdPi]
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
         COALESCE(SUM(CASE WHEN status = 'below_threshold' THEN 1 ELSE 0 END), 0)::int AS below_threshold_count
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

    const inserted = await client.query(
      `INSERT INTO public.pi_payout_jobs (
         cycle_id,
         uid,
         payout_pi_amount,
         wallet_identifier,
         status,
         created_at,
         updated_at
       )
       SELECT
         s.cycle_id,
         s.uid,
         s.payout_pi_amount,
         u.pi_wallet_identifier,
         'queued',
         NOW(),
         NOW()
       FROM public.monthly_payout_snapshots s
       LEFT JOIN public.users u ON u.uid = s.uid
       WHERE s.cycle_id = $1
         AND s.status = 'eligible'
         AND s.payout_pi_amount > 0
       ON CONFLICT (cycle_id, uid) DO NOTHING
       RETURNING id`,
      [cycle.id]
    );

    await client.query(
      `UPDATE public.monthly_payout_snapshots s
          SET status = 'queued'
         WHERE s.cycle_id = $1
           AND s.status = 'eligible'
           AND EXISTS (
             SELECT 1
             FROM public.pi_payout_jobs j
             WHERE j.cycle_id = s.cycle_id
               AND j.uid = s.uid
           )`,
      [cycle.id]
    );

    await client.query(
      `UPDATE public.monthly_payout_cycles
          SET status = CASE WHEN status = 'closed' THEN 'payouts_generated' ELSE status END
        WHERE id = $1`,
      [cycle.id]
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
      inserted_jobs: inserted.rowCount || 0,
      total_jobs: Number(totals.rows[0]?.total_jobs || 0),
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

  if (opts?.status) {
    values.push(assertJobStatus(opts.status));
    where.push(`j.status = $${values.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
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
       j.txid,
       j.error_message,
       j.attempts,
       j.created_at,
       j.updated_at
     FROM public.pi_payout_jobs j
     JOIN public.monthly_payout_cycles c ON c.id = j.cycle_id
     ${whereSql}
     ORDER BY j.created_at ASC
     LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    values
  );

  return {
    ok: true,
    rows: out.rows,
  };
}

export async function adminUpdatePayoutJobStatus(opts: {
  jobId: number;
  status: PiPayoutJobStatus;
  txid?: string | null;
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
              error_message = CASE
                WHEN $2 = 'failed' THEN NULLIF($4, '')
                WHEN $2 = 'paid' THEN NULL
                ELSE error_message
              END,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [opts.jobId, status, opts.txid || null, opts.errorMessage || null]
    );

    let snapshotStatus: MonthlyPayoutSnapshotStatus | null = null;
    if (status === "paid") snapshotStatus = "paid";
    if (status === "failed") snapshotStatus = "failed";
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
            updated_at = NOW()
      WHERE id = $1
        AND status = 'failed'
      RETURNING *`,
    [jobId]
  );

  if (!out.rows.length) throw new Error("payout_job_not_failed_or_not_found");

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
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       UPDATE public.pi_payout_jobs j
          SET status = 'processing',
              attempts = attempts + 1,
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

export async function sendPiPayout(job: PayoutJobRecord): Promise<{ txid: string }> {
  if (process.env.PAYOUT_SIMULATE_SUCCESS === "true") {
    return { txid: `sim-${job.id}-${Date.now()}` };
  }

  throw new Error("sendPiPayout_not_implemented");
}

export async function runPayoutWorkerBatch(opts?: { limit?: number }) {
  const limit = Math.max(1, Math.min(100, Number(opts?.limit || 10)));
  const jobs = await claimQueuedPayoutJobs(limit);

  let paid = 0;
  let failed = 0;

  for (const job of jobs) {
    try {
      const tx = await sendPiPayout(job);
      await adminUpdatePayoutJobStatus({
        jobId: Number(job.id),
        status: "paid",
        txid: tx.txid,
      });
      paid += 1;
    } catch (e: any) {
      await adminUpdatePayoutJobStatus({
        jobId: Number(job.id),
        status: "failed",
        errorMessage: String(e?.message || "payout_failed"),
      });
      failed += 1;
    }
  }

  return {
    ok: true,
    claimed: jobs.length,
    paid,
    failed,
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
export async function addCoins(uid: string, delta: number) {
  const d = Number(delta || 0);

  const { rows } = await pool.query(
    `
    UPDATE public.users
    SET
      coins = COALESCE(coins,0) + $2,
      monthly_coins_earned = COALESCE(monthly_coins_earned,0) + GREATEST($2,0),
      lifetime_coins_earned = COALESCE(lifetime_coins_earned,0) + GREATEST($2,0),
      updated_at=NOW()
    WHERE uid=$1
    RETURNING *
  `,
    [uid, d]
  );
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
    throw new Error("missing_nonce");
  }

  // 1) block exact replay of same request
  const nonceRes = await pool.query(
    `SELECT 1 FROM reward_claims WHERE uid=$1 AND nonce=$2 LIMIT 1`,
    [uid, nonce]
  );
  if ((nonceRes.rowCount ?? 0) > 0) {
    return { already: true };
  }

  // 2) block same reward type inside cooldown window
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
      return { already: true, cooldown: true };
    }
  }

  // 3) record claim
  await pool.query(
    `
    INSERT INTO reward_claims (uid, type, nonce, amount, created_at)
    VALUES ($1, $2, $3, $4, NOW())
    `,
    [uid, type, nonce, amount]
  );

  // 4) grant coins
  const user = await addCoins(uid, amount);

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
  const { rowCount } = await pool.query(
    `
    SELECT 1 FROM reward_claims
    WHERE uid=$1 AND type='daily_login'
      AND created_at::date = CURRENT_DATE
  `,
    [uid]
  );

  if (rowCount) return { already: true };

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

  // if already claimed, do not add coin
  if ((insert.rowCount ?? 0) === 0) return { already: true };

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
}: {
  search?: string;
  limit: number;
  offset: number;
}) {
  if (search) {
    const { rows } = await pool.query(
      `
      SELECT *
      FROM public.users
      WHERE username ILIKE '%' || $1 || '%'
         OR uid ILIKE '%' || $1 || '%'
      ORDER BY updated_at DESC
      LIMIT $2 OFFSET $3
    `,
      [search, limit, offset]
    );

    const { rows: c } = await pool.query(
      `
      SELECT COUNT(*)
      FROM public.users
      WHERE username ILIKE '%' || $1 || '%'
         OR uid ILIKE '%' || $1 || '%'
    `,
      [search]
    );

    return { rows, count: Number(c[0].count) };
  }
  


  // ✅ no search
  const { rows } = await pool.query(
    `
    SELECT *
    FROM public.users
    ORDER BY updated_at DESC
    LIMIT $1 OFFSET $2
  `,
    [limit, offset]
  );

  const { rows: c } = await pool.query(`SELECT COUNT(*) FROM public.users`);
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
   Charts (Step 1 – 7 days default)
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
  // 1️⃣ Track ad view
  await trackAdView(uid, "coins");

  // 2️⃣ Read monthly ads
  const ads = await getMonthlyAds(uid);

  // ads_for_coins already incremented
  const coins = coinRewardForAd(ads.ads_for_coins - 1);

  // 3️⃣ Use EXISTING reward system
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

