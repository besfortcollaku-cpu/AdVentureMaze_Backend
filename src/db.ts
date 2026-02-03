import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL === "true"
      ? { rejectUnauthorized: false }
      : undefined,
});
import {
  initDB,
  upsertUser,
  getUserByUid,
  getProgressByUid,
  setProgressByUid,
  claimCoinAd,
  adminGetStats,
  adminListOnline,
  adminResetProgress,
  adminChartCoins,
  adminChartActive,
} from "./db";

// ===============================
// ADMIN – SAFE EXPORTS (REQUIRED)
// ===============================

export async function adminChartCoins() {
  return [];
}

export async function adminChartActiveUsers() {
  return [];
}

export async function claimCoinAd(
  uid: string,
  amount: number,
  cooldownSeconds: number
) {
  return claimReward({
    uid,
    type: "ad_50",
    nonce: "ad-50",
    amount,
    cooldownSeconds,
  });
}
/* =====================================================
   INIT
===================================================== */
export async function initDB() {
  await pool.query(`SELECT 1`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      uid TEXT PRIMARY KEY,
      username TEXT,
      coins INT DEFAULT 0,
      free_skips_used INT DEFAULT 0,
      free_hints_used INT DEFAULT 0,
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS progress (
      uid TEXT PRIMARY KEY,
      level INT DEFAULT 1,
      coins INT DEFAULT 0,
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS reward_claims (
      uid TEXT NOT NULL,
      type TEXT NOT NULL,
      nonce TEXT,
      amount INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS level_rewards (
      uid TEXT NOT NULL,
      level INT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      uid TEXT PRIMARY KEY,
      session_id TEXT,
      user_agent TEXT,
      ip TEXT,
      started_at TIMESTAMP,
      last_seen_at TIMESTAMP NOT NULL
    );
  `);
}

/* =====================================================
   USERS
===================================================== */
export async function upsertUser(uid: string, username: string) {
  const { rows } = await pool.query(
    `
    INSERT INTO users (uid, username, updated_at)
    VALUES ($1,$2,NOW())
    ON CONFLICT (uid)
    DO UPDATE SET username = EXCLUDED.username, updated_at = NOW()
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

export async function addCoins(uid: string, amount: number) {
  const { rows } = await pool.query(
    `
    UPDATE users
    SET coins = coins + $2, updated_at = NOW()
    WHERE uid = $1
    RETURNING *
    `,
    [uid, amount]
  );
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

export async function setProgressByUid(
  uid: string,
  level: number,
  coins: number
) {
  await pool.query(
    `
    INSERT INTO progress (uid, level, coins, updated_at)
    VALUES ($1,$2,$3,NOW())
    ON CONFLICT (uid)
    DO UPDATE SET level=$2, coins=$3, updated_at=NOW()
    `,
    [uid, level, coins]
  );
}

/* =====================================================
   REWARDS (SINGLE SOURCE OF TRUTH)
===================================================== */
export async function claimReward({
  uid,
  type,
  nonce,
  amount,
  cooldownSeconds,
}: {
  uid: string;
  type: string;
  nonce: string;
  amount: number;
  cooldownSeconds: number;
}) {
  const { rows } = await pool.query(
    `
    SELECT created_at
    FROM reward_claims
    WHERE uid=$1 AND type=$2
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [uid, type]
  );

  if (rows.length) {
    const last = new Date(rows[0].created_at).getTime();
    const diff = Math.floor((Date.now() - last) / 1000);

    if (diff < cooldownSeconds) {
      return {
        already: true,
        wait: cooldownSeconds - diff,
      };
    }
  }

  await pool.query(
    `
    INSERT INTO reward_claims (uid, type, nonce, amount)
    VALUES ($1,$2,$3,$4)
    `,
    [uid, type, nonce, amount]
  );

  const user = await addCoins(uid, amount);

  return { already: false, user };
}

/* =====================================================
   LEVEL COMPLETE
===================================================== */
export async function claimLevelComplete(uid: string, level: number) {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM level_rewards WHERE uid=$1 AND level=$2`,
    [uid, level]
  );

  if (rowCount) return { already: true };

  await pool.query(
    `
    INSERT INTO level_rewards (uid, level)
    VALUES ($1,$2)
    `,
    [uid, level]
  );

  const user = await addCoins(uid, 1);
  return { user };
}

/* =====================================================
   SESSIONS
===================================================== */
export async function startSession(
  uid: string,
  sessionId: string,
  userAgent: string,
  ip: string
) {
  const { rows } = await pool.query(
    `
    INSERT INTO sessions (uid, session_id, user_agent, ip, started_at, last_seen_at)
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
  await pool.query(
    `UPDATE sessions SET last_seen_at=NOW() WHERE uid=$1`,
    [uid]
  );
}

export async function endSession(uid: string) {
  await pool.query(`DELETE FROM sessions WHERE uid=$1`, [uid]);
}