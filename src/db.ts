import { Pool } from "pg";

/* ============================================================
   DATABASE CONNECTION
============================================================ */

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false,
});

/* ============================================================
   INIT DB (EXTENDED, NOT REPLACED)
============================================================ */

export async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      uid TEXT PRIMARY KEY,
      username TEXT,
      coins INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS progress (
      uid TEXT PRIMARY KEY REFERENCES users(uid) ON DELETE CASCADE,
      level INTEGER DEFAULT 1,
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      uid TEXT,
      started_at TIMESTAMP DEFAULT NOW(),
      last_ping TIMESTAMP DEFAULT NOW()
    );

    /* -------- NEW TABLES (MERGED) -------- */

    -- Ad tracking (coins / skips / hints)
    CREATE TABLE IF NOT EXISTS ad_events (
      id SERIAL PRIMARY KEY,
      uid TEXT REFERENCES users(uid) ON DELETE CASCADE,
      type TEXT CHECK (type IN ('coin','skip','hint')) NOT NULL,
      reward_coins INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );

    -- Monthly free counters
    CREATE TABLE IF NOT EXISTS free_counters (
      uid TEXT PRIMARY KEY REFERENCES users(uid) ON DELETE CASCADE,
      month_key TEXT NOT NULL,
      free_skips_used INTEGER DEFAULT 0,
      free_hints_used INTEGER DEFAULT 0
    );

    -- Optional ledger (future Pi conversion)
    CREATE TABLE IF NOT EXISTS coin_ledger (
      id SERIAL PRIMARY KEY,
      uid TEXT REFERENCES users(uid) ON DELETE CASCADE,
      source TEXT,
      coins INTEGER,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

/* ============================================================
   USERS
============================================================ */

export async function upsertUser(uid: string, username: string) {
  await pool.query(
    `
    INSERT INTO users (uid, username)
    VALUES ($1, $2)
    ON CONFLICT (uid)
    DO UPDATE SET username = EXCLUDED.username
    `,
    [uid, username]
  );
}

export async function getProgressByUid(uid: string) {
  const res = await pool.query(
    `SELECT level FROM progress WHERE uid = $1`,
    [uid]
  );
  return res.rows[0] || { level: 1 };
}

export async function setProgressByUid(uid: string, level: number) {
  await pool.query(
    `
    INSERT INTO progress (uid, level)
    VALUES ($1, $2)
    ON CONFLICT (uid)
    DO UPDATE SET level = $2, updated_at = NOW()
    `,
    [uid, level]
  );
}

/* ============================================================
   COINS & REWARDS
============================================================ */

export async function claimReward(uid: string, coins: number, source = "reward") {
  await pool.query(
    `UPDATE users SET coins = coins + $1 WHERE uid = $2`,
    [coins, uid]
  );

  await pool.query(
    `INSERT INTO coin_ledger (uid, source, coins) VALUES ($1, $2, $3)`,
    [uid, source, coins]
  );
}

export async function claimDailyLogin(uid: string) {
  await claimReward(uid, 5, "daily_login");
}

export async function claimLevelComplete(uid: string, level: number) {
  await claimReward(uid, 1, `level_${level}`);
}

/* ============================================================
   ADS (NEW LOGIC)
============================================================ */

export async function logAdEvent(
  uid: string,
  type: "coin" | "skip" | "hint",
  rewardCoins = 0
) {
  await pool.query(
    `
    INSERT INTO ad_events (uid, type, reward_coins)
    VALUES ($1, $2, $3)
    `,
    [uid, type, rewardCoins]
  );

  if (rewardCoins > 0) {
    await claimReward(uid, rewardCoins, "ad");
  }
}

/* Coin ad decay: 50 → 49 → ... → min 2 */
export async function getTodayCoinAdReward(uid: string) {
  const res = await pool.query(
    `
    SELECT COUNT(*)::int AS cnt
    FROM ad_events
    WHERE uid = $1
      AND type = 'coin'
      AND created_at::date = CURRENT_DATE
    `,
    [uid]
  );

  const watched = res.rows[0]?.cnt ?? 0;
  return Math.max(50 - watched, 2);
}

/* ============================================================
   FREE SKIPS / HINTS (MONTHLY)
============================================================ */

function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function ensureFreeRow(uid: string) {
  const month = currentMonthKey();
  await pool.query(
    `
    INSERT INTO free_counters (uid, month_key)
    VALUES ($1, $2)
    ON CONFLICT (uid)
    DO UPDATE SET month_key = $2
    `,
    [uid, month]
  );
}

export async function consumeFreeSkip(uid: string) {
  await ensureFreeRow(uid);
  await pool.query(
    `UPDATE free_counters SET free_skips_used = free_skips_used + 1 WHERE uid = $1`,
    [uid]
  );
}

export async function consumeFreeHint(uid: string) {
  await ensureFreeRow(uid);
  await pool.query(
    `UPDATE free_counters SET free_hints_used = free_hints_used + 1 WHERE uid = $1`,
    [uid]
  );
}

/* ============================================================
   SESSIONS
============================================================ */

export async function startSession(uid: string) {
  await pool.query(
    `INSERT INTO sessions (uid) VALUES ($1)`,
    [uid]
  );
}

export async function pingSession(uid: string) {
  await pool.query(
    `UPDATE sessions SET last_ping = NOW() WHERE uid = $1`,
    [uid]
  );
}

export async function endSession(uid: string) {
  await pool.query(
    `DELETE FROM sessions WHERE uid = $1`,
    [uid]
  );
}

export async function touchUserOnline(uid: string) {
  await pingSession(uid);
}

/* ============================================================
   ADMIN
============================================================ */

export async function adminListUsers() {
  const res = await pool.query(`SELECT * FROM users`);
  return res.rows;
}

export async function adminGetUser(uid: string) {
  const res = await pool.query(
    `SELECT * FROM users WHERE uid = $1`,
    [uid]
  );
  return res.rows[0];
}

export async function adminDeleteUser(uid: string) {
  await pool.query(`DELETE FROM users WHERE uid = $1`, [uid]);
}

export async function adminGetStats() {
  const res = await pool.query(`
    SELECT
      COUNT(*) AS users,
      SUM(coins) AS total_coins
    FROM users
  `);
  return res.rows[0];
}

export async function adminListOnlineUsers() {
  const res = await pool.query(`SELECT * FROM sessions`);
  return res.rows;
}

export async function adminResetFreeCounters() {
  await pool.query(`DELETE FROM free_counters`);
}

export async function adminChartCoins() {
  const res = await pool.query(`
    SELECT DATE(created_at) d, SUM(coins) c
    FROM coin_ledger
    GROUP BY d
    ORDER BY d
  `);
  return res.rows;
}

export async function adminChartActiveUsers() {
  const res = await pool.query(`
    SELECT DATE(last_ping) d, COUNT(DISTINCT uid)
    FROM sessions
    GROUP BY d
    ORDER BY d
  `);
  return res.rows;
}

/* ============================================================
   🔁 LEGACY COMPATIBILITY LAYER (DO NOT REMOVE)
============================================================ */

/**
 * OLD skip logic wrapper
 * Used by index.ts
 */
export async function useSkip(uid: string) {
  // try free skip first
  await consumeFreeSkip(uid);

  // return user state as before
  const res = await pool.query(`SELECT * FROM users WHERE uid = $1`, [uid]);
  return {
    already: false,
    user: res.rows[0],
  };
}

/**
 * OLD hint logic wrapper
 */
export async function useHint(uid: string) {
  await consumeFreeHint(uid);

  const res = await pool.query(`SELECT * FROM users WHERE uid = $1`, [uid]);
  return {
    already: false,
    user: res.rows[0],
  };
}

/**
 * OLD reward wrapper
 */
export async function claimRewardLegacy(uid: string, coins: number) {
  await claimReward(uid, coins, "legacy");

  const res = await pool.query(`SELECT * FROM users WHERE uid = $1`, [uid]);
  return {
    already: false,
    user: res.rows[0],
  };
}

/**
 * OLD daily login wrapper
 */
export async function claimDailyLoginLegacy(uid: string) {
  await claimDailyLogin(uid);

  const res = await pool.query(`SELECT * FROM users WHERE uid = $1`, [uid]);
  return {
    already: false,
    user: res.rows[0],
  };
}

/**
 * OLD level complete wrapper
 */
export async function claimLevelCompleteLegacy(uid: string, level: number) {
  await claimLevelComplete(uid, level);

  const res = await pool.query(`SELECT * FROM users WHERE uid = $1`, [uid]);
  return {
    already: false,
    user: res.rows[0],
  };
}

/* ============================================================
   🔐 ADMIN AUTH PLACEHOLDER (FIXES BUILD)
============================================================ */

export function adminAuth(req: any, res: any, next: any) {
  // TEMP: allow all admin routes
  // Later we add real auth
  next();
}