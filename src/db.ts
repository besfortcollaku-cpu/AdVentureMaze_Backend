// src/db.ts
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true"
    ? { rejectUnauthorized: false }
    : undefined,
});

/* =====================================================
   INIT
===================================================== */
export async function initDB() {
  await pool.query("SELECT 1");
}

/* =====================================================
   USERS
===================================================== */
export async function upsertUser({
  uid,
  username,
}: {
  uid: string;
  username: string;
}) {
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
  const { rows } = await pool.query(
    `
    UPDATE users
    SET coins = coins + $2, updated_at=NOW()
    WHERE uid=$1
    RETURNING *
  `,
    [uid, delta]
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

export async function setProgressByUid({
  uid,
  level,
  coins,
}: {
  uid: string;
  level: number;
  coins: number;
}) {
  await pool.query(
    `
    INSERT INTO progress (uid, level, coins, updated_at)
    VALUES ($1,$2,$3,NOW())
    ON CONFLICT (uid)
    DO UPDATE SET
      level = EXCLUDED.level,
      coins = EXCLUDED.coins,
      updated_at = NOW()
  `,
    [uid, level, coins]
  );
}

/* =====================================================
   REWARDS
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

  const user = await addCoins(uid, 10);
  return { user };
}

/* =====================================================
   SKIPS / HINTS
===================================================== */
export async function useSkip(uid: string) {
  const { rows } = await pool.query(
    `
    UPDATE users
    SET free_skips_used = free_skips_used + 1
    WHERE uid=$1
    RETURNING *
  `,
    [uid]
  );
  return { ok: true, user: rows[0] };
}

export async function useHint(uid: string) {
  const { rows } = await pool.query(
    `
    UPDATE users
    SET free_hints_used = free_hints_used + 1
    WHERE uid=$1
    RETURNING *
  `,
    [uid]
  );
  return { ok: true, user: rows[0] };
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
  uid,
  sessionId,
  userAgent,
  ip,
}: {
  uid: string;
  sessionId: string;
  userAgent: string;
  ip: string;
}) {
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
  order,
}: any) {
  const where = search
    ? `WHERE username ILIKE '%'||$1||'%' OR uid ILIKE '%'||$1||'%'`
    : "";

  const { rows } = await pool.query(
    `
    SELECT * FROM users
    ${where}
    ORDER BY updated_at DESC
    LIMIT $2 OFFSET $3
  `,
    search ? [search, limit, offset] : [limit, offset]
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

  return {
    users_total: Number(users.rows[0].count),
    coins_total: Number(coins.rows[0].sum || 0),
    online_now: Number(online.rows[0].count),
  };
}

export async function adminListOnlineUsers({
  minutes,
  limit,
  offset,
}: {
  minutes: number;
  limit: number;
  offset: number;
}) {
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