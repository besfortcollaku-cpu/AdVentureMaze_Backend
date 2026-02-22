import { Pool } from "pg";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true"
    ? { rejectUnauthorized: false }
    : undefined,
});

/* =====================================================
   INIT  (✅ Fix 1: auto-create core tables incl. sessions)
===================================================== */
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

  // USERS TABLE
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      uid TEXT PRIMARY KEY,
      username TEXT,

      coins INT DEFAULT 0,

      free_restarts_used INT DEFAULT 0,
      free_skips_used INT DEFAULT 0,
      free_hints_used INT DEFAULT 0,

      monthly_key TEXT,
      monthly_coins_earned INT DEFAULT 0,
      monthly_login_days INT DEFAULT 0,
      monthly_levels_completed INT DEFAULT 0,
      monthly_skips_used INT DEFAULT 0,
      monthly_hints_used INT DEFAULT 0,
      monthly_restarts_used INT DEFAULT 0,
      monthly_ads_watched INT DEFAULT 0,
      monthly_valid_invites INT DEFAULT 0,
      monthly_max_win_streak INT DEFAULT 0,

      monthly_rate_breakdown JSONB DEFAULT '{}'::jsonb,
      monthly_final_rate INT DEFAULT 50,

      lifetime_coins_earned INT DEFAULT 0,
      lifetime_coins_spent INT DEFAULT 0,
      lifetime_levels_completed INT DEFAULT 0,
      lifetime_invites_valid INT DEFAULT 0,

      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
await pool.query(`
  ALTER TABLE users
  ADD COLUMN IF NOT EXISTS monthly_key TEXT;
`);
  // PROGRESS TABLE
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

  // REWARD CLAIMS
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reward_claims (
      uid TEXT NOT NULL,
      type TEXT NOT NULL,
      nonce TEXT,
      amount INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // LEVEL REWARDS
  await pool.query(`
    CREATE TABLE IF NOT EXISTS level_rewards (
      uid TEXT NOT NULL,
      level INT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // SESSIONS
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

  // MONTHLY PAYOUTS
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

  // USER ADS
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
       FROM users
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
        `UPDATE users
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
    INSERT INTO users (uid, username, updated_at)
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
    `SELECT * FROM users WHERE uid=$1`,
    [uid]
  );
  return rows[0] || null;
}
export async function addCoins(uid: string, delta: number) {
  const d = Number(delta || 0);

  const { rows } = await pool.query(
    `
    UPDATE users
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
    UPDATE users
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
  cooldownSeconds: number; }) {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM reward_claims WHERE uid=$1 AND nonce=$2`,
    [uid, nonce]
  );
  if (rowCount) return { already: true };

  await pool.query(
    `
    INSERT INTO reward_claims (uid,type,nonce,amount,created_at)
    VALUES ($1,$2,$3,$4,NOW())
  `,
    [uid, type, nonce, amount]
  );

  const user = await addCoins(uid, amount);
  if (type === "ad_50" || type === "ad") {
  await pool.query(
    `UPDATE users SET monthly_ads_watched = COALESCE(monthly_ads_watched,0) + 1 WHERE uid=$1`,
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
  `UPDATE users SET monthly_login_days = COALESCE(monthly_login_days,0) + 1 WHERE uid=$1`,
  [uid]
);
await recalcAndStoreMonthlyRate(uid);
  return { user };
}

export async function claimLevelComplete(uid: string, level: number) {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM level_rewards WHERE uid=$1 AND level=$2`,
    [uid, level]
  );
  if (rowCount) return { already: true };

  await pool.query(
    `
    INSERT INTO level_rewards (uid,level,created_at)
    VALUES ($1,$2,NOW())
  `,
    [uid, level]
  );

  const user = await addCoins(uid, 1);
  await pool.query(
  `
  UPDATE users
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
    `UPDATE users
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
      `UPDATE users
       SET free_skips_used = free_skips_used + 1,
           updated_at = NOW()
       WHERE uid=$1
       RETURNING *`,
      [uid]
    );
await pool.query(
    `
    UPDATE users
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
    UPDATE users
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
    UPDATE users
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
      `UPDATE users
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
      FROM users
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
      FROM users
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
    FROM users
    ORDER BY updated_at DESC
    LIMIT $1 OFFSET $2
  `,
    [limit, offset]
  );

  const { rows: c } = await pool.query(`SELECT COUNT(*) FROM users`);
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
    UPDATE users
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
    `DELETE FROM users WHERE uid = $1`,
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
  const users = await pool.query(`SELECT COUNT(*) FROM users`);
  const coins = await pool.query(`SELECT SUM(coins) FROM users`);
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
    JOIN users u ON u.uid=s.uid
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

export async function ensureMonthlyKey(uid: string) {
  const mk = currentMonthKey();

  const { rows } = await pool.query(
    `SELECT monthly_key FROM users WHERE uid=$1`,
    [uid]
  );

  const cur = rows[0]?.monthly_key ? String(rows[0].monthly_key) : null;

  if (cur === mk) return mk;

  await pool.query(
    `
    UPDATE users
    SET
      monthly_key = $2,
      monthly_coins_earned = 0,
      monthly_login_days = 0,
      monthly_levels_completed = 0,
      monthly_skips_used = 0,
      monthly_hints_used = 0,
      monthly_restarts_used = 0,
      monthly_ads_watched = 0,
      monthly_valid_invites = 0,
      monthly_max_win_streak = 0,
      monthly_rate_breakdown = '{}'::jsonb,
      monthly_final_rate = 50,
      updated_at = NOW()
    WHERE uid = $1
    `,
    [uid, mk]
  );

  return mk;
}

export function calcMonthlyRate(u: any) {
  const breakdown: Record<string, number> = {
    daily: 0,
    levels: 0,
    invites: 0,
    skill: 0,
    engagement: 0,
    streak: 0,
  };

  // BASE
  let rate = 50;

  // DAILY (max +10)
  const days = Number(u?.monthly_login_days || 0);
  if (days >= 20) breakdown.daily = 10;
  else if (days >= 15) breakdown.daily = 7;
  else if (days >= 7) breakdown.daily = 3;

  // LEVELS (max +15)
  const lv = Number(u?.monthly_levels_completed || 0);
  if (lv >= 120) breakdown.levels = 15;
  else if (lv >= 60) breakdown.levels = 10;
  else if (lv >= 20) breakdown.levels = 5;

  // INVITES (max +10)
  const inv = Number(u?.monthly_valid_invites || 0);
  if (inv >= 10) breakdown.invites = 10;
  else if (inv >= 6) breakdown.invites = 6;
  else if (inv >= 3) breakdown.invites = 3;

  // SKILL (encourage usage) (max +5)
  const skips = Number(u?.monthly_skips_used || 0);
  const hints = Number(u?.monthly_hints_used || 0);
  const restarts = Number(u?.monthly_restarts_used || 0);
  let skill = 0;
  if (skips >= 3) skill += 2;
  if (hints >= 3) skill += 2;
  if (restarts >= 1) skill += 1;
  breakdown.skill = Math.min(5, skill);

  // ADS (max +5)
  const ads = Number(u?.monthly_ads_watched || 0);
  if (ads >= 15) breakdown.engagement = 5;
  else if (ads >= 5) breakdown.engagement = 2;

  // STREAK (max +3 here)
  const streak = Number(u?.monthly_max_win_streak || 0);
  if (streak >= 7) breakdown.streak = 3;
  else if (streak >= 3) breakdown.streak = 2;

  rate +=
    breakdown.daily +
    breakdown.levels +
    breakdown.invites +
    breakdown.skill +
    breakdown.engagement +
    breakdown.streak;

  if (rate > 100) rate = 100;

  return { rate, breakdown };
}

export async function recalcAndStoreMonthlyRate(uid: string) {
  const { rows } = await pool.query(`SELECT * FROM users WHERE uid=$1`, [uid]);
  const u = rows[0];
  if (!u) throw new Error("User not found");

  const out = calcMonthlyRate(u);

  const { rows: updated } = await pool.query(
    `
    UPDATE users
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
      `SELECT * FROM users WHERE uid=$1 FOR UPDATE`,
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
      UPDATE users
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