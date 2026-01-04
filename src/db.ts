// src/db.ts
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true"
    ? { rejectUnauthorized: false }
    : undefined,
});

/* ================= INIT ================= */
export async function initDB() {
  await pool.query("SELECT 1");
}

/* ================= USERS ================= */
export async function upsertUser({ uid, username }: { uid: string; username: string }) {
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
  const { rows } = await pool.query(`SELECT * FROM users WHERE uid=$1`, [uid]);
  return rows[0] || null;
}

export async function addCoins(uid: string, delta: number) {
  const { rows } = await pool.query(
    `UPDATE users SET coins = coins + $2 WHERE uid=$1 RETURNING *`,
    [uid, delta]
  );
  return rows[0];
}

export async function setCoins(uid: string, coins: number) {
  const { rows } = await pool.query(
    `UPDATE users SET coins=$2 WHERE uid=$1 RETURNING *`,
    [uid, coins]
  );
  return rows[0];
}

/* ================= PROGRESS ================= */
export async function getProgressByUid(uid: string) {
  const { rows } = await pool.query(`SELECT * FROM progress WHERE uid=$1`, [uid]);
  return rows[0] || null;
}

export async function setProgressByUid({ uid, level, coins }: any) {
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

/* ================= REWARDS ================= */
export async function claimReward({ uid, type, nonce, amount }: any) {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM reward_claims WHERE uid=$1 AND nonce=$2`,
    [uid, nonce]
  );
  if (rowCount) return { already: true };

  await pool.query(
    `INSERT INTO reward_claims (uid,type,nonce,amount,created_at)
     VALUES ($1,$2,$3,$4,NOW())`,
    [uid, type, nonce, amount]
  );

  return { user: await addCoins(uid, amount) };
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
    `INSERT INTO reward_claims (uid,type,amount,created_at)
     VALUES ($1,'daily_login',5,NOW())`,
    [uid]
  );
  return { user: await addCoins(uid, 5) };
}

export async function claimLevelComplete(uid: string, level: number) {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM level_rewards WHERE uid=$1 AND level=$2`,
    [uid, level]
  );
  if (rowCount) return { already: true };

  await pool.query(
    `INSERT INTO level_rewards (uid,level,created_at)
     VALUES ($1,$2,NOW())`,
    [uid, level]
  );
  return { user: await addCoins(uid, 10) };
}

/* ================= SESSIONS ================= */
export async function touchUserOnline(uid: string) {
  await pool.query(
    `
    INSERT INTO sessions (uid, session_id, last_seen_at)
    VALUES ($1,'auto',NOW())
    ON CONFLICT (uid) DO UPDATE SET last_seen_at=NOW()
    `,
    [uid]
  );
}

export async function startSession({ uid, sessionId, userAgent, ip }: any) {
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
    `UPDATE sessions SET last_seen_at=NOW() WHERE uid=$1 RETURNING *`,
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

/* ================= ADMIN ================= */
export async function adminListUsers({ search, limit, offset }: any) {
  if (search) {
    const { rows } = await pool.query(
      `
      SELECT * FROM users
      WHERE username ILIKE '%'||$1||'%' OR uid ILIKE '%'||$1||'%'
      ORDER BY updated_at DESC
      LIMIT $2 OFFSET $3
      `,
      [search, limit, offset]
    );
    const { rows: c } = await pool.query(
      `
      SELECT COUNT(*) FROM users
      WHERE username ILIKE '%'||$1||'%' OR uid ILIKE '%'||$1||'%'
      `,
      [search]
    );
    return { rows, count: Number(c[0].count) };
  }

  const { rows } = await pool.query(
    `SELECT * FROM users ORDER BY updated_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  const { rows: c } = await pool.query(`SELECT COUNT(*) FROM users`);
  return { rows, count: Number(c[0].count) };
}

export async function adminGetUser(uid: string) {
  return {
    user: await getUserByUid(uid),
    progress: await getProgressByUid(uid),
  };
}

export async function adminGetStats({ onlineMinutes }: any) {
  const users = await pool.query(`SELECT COUNT(*) FROM users`);
  const coins = await pool.query(`SELECT SUM(coins) FROM users`);
  const online = await pool.query(
    `SELECT COUNT(*) FROM sessions WHERE last_seen_at > NOW() - ($1 || ' minutes')::interval`,
    [onlineMinutes]
  );

  return {
    users_total: Number(users.rows[0].count),
    coins_total: Number(coins.rows[0].sum || 0),
    online_now: Number(online.rows[0].count),
  };
}