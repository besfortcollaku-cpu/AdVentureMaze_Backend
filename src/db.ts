// src/db.ts

//

// Postgres version of your SQLite DB layer.

// Requires: npm i pg

// Env: DATABASE_URL (Render Postgres "Internal Database URL")

//

// Keeps the same exported function names + behavior you already use in src/index.ts.

import { Pool, PoolClient } from "pg";

// ✅ Lifetime freebies (not per month)

const FREE_SKIPS = 3;

const FREE_HINTS = 3;

let pool: Pool | null = null;

function getPool() {

if (!pool) {

const url = process.env.DATABASE_URL;

if (!url) {

  throw new Error("Missing DATABASE_URL env var (Render Postgres connection string).");

}

pool = new Pool({

  connectionString: url,

  // Render internal connections typically work without SSL.

  // If you ever use External URL, you may need SSL settings:

  // ssl: { rejectUnauthorized: false },

});

}

return pool;

}

// Run schema creation once on boot (idempotent)

export async function initDB() {

const p = getPool();

const client = await p.connect();

try {

await client.query("BEGIN");

await ensureSchema(client);

await client.query("COMMIT");

} catch (e) {

try { await client.query("ROLLBACK"); } catch {}

throw e;

} finally {

client.release();

}

return p;

}

/* =========================

SCHEMA

========================= */

async function ensureSchema(c: PoolClient) {

// USERS

await c.query(`

CREATE TABLE IF NOT EXISTS users (

  id BIGSERIAL PRIMARY KEY,

  uid TEXT UNIQUE,

  username TEXT UNIQUE,

  coins INTEGER NOT NULL DEFAULT 0,

  free_skips_used INTEGER NOT NULL DEFAULT 0,

  free_hints_used INTEGER NOT NULL DEFAULT 0,

  last_payout_month TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

);

`);

await c.query(CREATE INDEX IF NOT EXISTS idx_users_uid ON users(uid););

await c.query(CREATE INDEX IF NOT EXISTS idx_users_username ON users(username););

// PROGRESS (UID)

await c.query(`

CREATE TABLE IF NOT EXISTS progress (

  uid TEXT PRIMARY KEY,

  level INTEGER NOT NULL DEFAULT 1,

  coins INTEGER NOT NULL DEFAULT 0,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

);

`);

await c.query(CREATE INDEX IF NOT EXISTS idx_progress_uid ON progress(uid););

// REWARD CLAIMS (idempotency via nonce UNIQUE)

await c.query(`

CREATE TABLE IF NOT EXISTS reward_claims (

  id BIGSERIAL PRIMARY KEY,

  uid TEXT NOT NULL,

  type TEXT NOT NULL,

  nonce TEXT NOT NULL UNIQUE,

  amount INTEGER NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

);

`);

await c.query(`

CREATE INDEX IF NOT EXISTS idx_reward_claims_uid_type_time

ON reward_claims(uid, type, created_at);

`);

// LEVEL REWARDS (level complete +1 once per uid+level)

await c.query(`

CREATE TABLE IF NOT EXISTS level_rewards (

  uid TEXT NOT NULL,

  level INTEGER NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY(uid, level)

);

`);

await c.query(CREATE INDEX IF NOT EXISTS idx_level_rewards_uid ON level_rewards(uid););

// PAYMENTS

await c.query(`

CREATE TABLE IF NOT EXISTS payments (

  payment_id TEXT PRIMARY KEY,

  uid TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'created',

  txid TEXT,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

);

`);

await c.query(CREATE INDEX IF NOT EXISTS idx_payments_uid ON payments(uid););

// USER SESSIONS (online tracking)

await c.query(`

CREATE TABLE IF NOT EXISTS user_sessions (

id BIGSERIAL PRIMARY KEY,

uid TEXT NOT NULL,

session_id TEXT NOT NULL,

user_agent TEXT,

ip TEXT,

started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

ended_at TIMESTAMPTZ,

UNIQUE(uid, session_id)

);

`);

await c.query(CREATE INDEX IF NOT EXISTS idx_user_sessions_uid ON user_sessions(uid););

await c.query(CREATE INDEX IF NOT EXISTS idx_user_sessions_last_seen ON user_sessions(last_seen_at););

// MONTHLY PAYOUTS LEDGER

await c.query(`

CREATE TABLE IF NOT EXISTS monthly_payouts (

  id BIGSERIAL PRIMARY KEY,

  uid TEXT NOT NULL,

  month TEXT NOT NULL,                 -- e.g. "2026-01"

  coins INTEGER NOT NULL,

  pi_amount DOUBLE PRECISION NOT NULL DEFAULT 0,

  status TEXT NOT NULL DEFAULT 'created', -- created/processing/sent/failed

  txid TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(uid, month)

);

`);

await c.query(`

CREATE INDEX IF NOT EXISTS idx_monthly_payouts_uid_month

ON monthly_payouts(uid, month);

`);

}

/* =========================

USERS API

========================= */

export async function upsertUser({ uid, username }: { uid: string; username: string }) {

const p = getPool();

const client = await p.connect();

try {

await client.query("BEGIN");



// protect against username collision with another uid

const existingByUsername = await getUserByUsername(username, client);

if (existingByUsername?.uid && existingByUsername.uid !== uid) {

  throw new Error("Username already linked to another account.");

}



// Upsert by uid

await client.query(

  `

  INSERT INTO users (uid, username, coins, created_at, updated_at)

  VALUES ($1, $2, 0, NOW(), NOW())

  ON CONFLICT (uid) DO UPDATE SET

    username = EXCLUDED.username,

    updated_at = NOW()

  `,

  [uid, username]

);



const user = await getUserByUid(uid, client);



await client.query("COMMIT");

return user;

} catch (e) {

try { await client.query("ROLLBACK"); } catch {}

throw e;

} finally {

client.release();

}

}

export async function getUserByUid(uid: string, client?: PoolClient) {

const run = async (c: PoolClient) => {

const r = await c.query(`SELECT * FROM users WHERE uid = $1 LIMIT 1`, [uid]);

return (r.rows[0] || undefined) as

  | {

      id: number;

      uid: string;

      username: string;

      coins: number;

      free_skips_used: number;

      free_hints_used: number;

      last_payout_month: string | null;

      created_at: string;

      updated_at: string;

    }

  | undefined;

};

if (client) return run(client);

const p = getPool();

const c = await p.connect();

try {

return await run(c);

} finally {

c.release();

}

}

export async function getUserByUsername(username: string, client?: PoolClient) {

const run = async (c: PoolClient) => {

const r = await c.query(`SELECT * FROM users WHERE username = $1 LIMIT 1`, [username]);

return (r.rows[0] || undefined) as

  | {

      id: number;

      uid: string;

      username: string;

      coins: number;

      free_skips_used: number;

      free_hints_used: number;

      last_payout_month: string | null;

      created_at: string;

      updated_at: string;

    }

  | undefined;

};

if (client) return run(client);

const p = getPool();

const c = await p.connect();

try {

return await run(c);

} finally {

c.release();

}

}

// Adds/subtracts coins, never below 0

export async function addCoins(uid: string, delta: number, client?: PoolClient) {

const d = Math.trunc(delta || 0);

const run = async (c: PoolClient) => {

const user = await getUserByUid(uid, c);

if (!user) throw new Error("User not found");



const r = await c.query(

  `

  UPDATE users

  SET coins = GREATEST(0, coins + $2),

      updated_at = NOW()

  WHERE uid = $1

  RETURNING *

  `,

  [uid, d]

);



return (r.rows[0] || undefined) as typeof user | undefined;

};

if (client) return run(client);

const p = getPool();

const c = await p.connect();

try {

return await run(c);

} finally {

c.release();

}

}

/* =========================

PROGRESS API (UID BASED)

========================= */

export async function setProgressByUid({

uid,

level,

coins,

}: {

uid: string;

level: number;

coins: number;

}) {

const p = getPool();

const c = await p.connect();

try {

const lvl = Math.max(1, Math.trunc(level || 1));

const cns = Math.max(0, Math.trunc(coins || 0));



await c.query(

  `

  INSERT INTO progress (uid, level, coins, updated_at)

  VALUES ($1, $2, $3, NOW())

  ON CONFLICT (uid) DO UPDATE SET

    level = EXCLUDED.level,

    coins = EXCLUDED.coins,

    updated_at = NOW()

  `,

  [uid, lvl, cns]

);

} finally {

c.release();

}

}

export async function getProgressByUid(uid: string) {

const p = getPool();

const c = await p.connect();

try {

const r = await c.query(`SELECT * FROM progress WHERE uid = $1 LIMIT 1`, [uid]);

const row = r.rows[0];

return (row || undefined) as

  | { uid: string; level: number; coins: number; updated_at: string }

  | undefined;

} finally {

c.release();

}

}

/* =========================

✅ REWARDS (server-side)

========================= */

export async function claimReward({

uid,

type,

nonce,

amount,

cooldownSeconds = 20,

}: {

uid: string;

type: string;

nonce: string;

amount: number;

cooldownSeconds?: number;

}) {

const p = getPool();

const c = await p.connect();

try {

await c.query("BEGIN");



const user = await getUserByUid(uid, c);

if (!user) throw new Error("User not found");



// 1) Idempotency: if nonce already exists -> already claimed

const existing = await c.query(

  `SELECT id FROM reward_claims WHERE nonce = $1 LIMIT 1`,

  [nonce]

);

if (existing.rows[0]?.id) {

  await c.query("COMMIT");

  return { ok: true, already: true, user: await getUserByUid(uid, c) };

}



// 2) Cooldown check (per uid+type)

if ((cooldownSeconds || 0) > 0) {

  const last = await c.query(

    `

    SELECT created_at FROM reward_claims

    WHERE uid = $1 AND type = $2

    ORDER BY created_at DESC

    LIMIT 1

    `,

    [uid, type]

  );



  const lastAt: Date | undefined = last.rows[0]?.created_at;

  if (lastAt) {

    const diffSeconds = (Date.now() - new Date(lastAt).getTime()) / 1000;

    if (diffSeconds < cooldownSeconds) {

      throw new Error(`Cooldown: wait ${Math.ceil(cooldownSeconds - diffSeconds)}s`);

    }

  }

}



// 3) Insert claim

await c.query(

  `

  INSERT INTO reward_claims (uid, type, nonce, amount, created_at)

  VALUES ($1, $2, $3, $4, NOW())

  `,

  [uid, type, nonce, Math.trunc(amount || 0)]

);



// 4) Apply coins

const updatedUser = await addCoins(uid, Math.trunc(amount || 0), c);



await c.query("COMMIT");

return { ok: true, already: false, user: updatedUser };

} catch (e) {

try { await c.query("ROLLBACK"); } catch {}

throw e;

} finally {

c.release();

}

}

/**

Daily login +5 coins once per day (UTC).

nonce is deterministic => only once/day.


*/

export async function claimDailyLogin(uid: string, dayKey?: string) {

const key = dayKey || getDayKeyUTC(); // e.g. "2025-12-27"

const nonce = daily:${uid}:${key};

return claimReward({

uid,

type: "daily_login",

nonce,

amount: 5,

cooldownSeconds: 0,

});

}

/**

Level complete +1 coin, only once per uid+level.


*/

export async function claimLevelComplete(uid: string, level: number) {

const lvl = Math.max(1, Math.trunc(level || 1));

const p = getPool();

const c = await p.connect();

try {

await c.query("BEGIN");



const user = await getUserByUid(uid, c);

if (!user) throw new Error("User not found");



const already = await c.query(

  `SELECT 1 FROM level_rewards WHERE uid = $1 AND level = $2 LIMIT 1`,

  [uid, lvl]

);

if (already.rows[0]) {

  await c.query("COMMIT");

  return { ok: true, already: true, user: await getUserByUid(uid, c) };

}



await c.query(

  `INSERT INTO level_rewards (uid, level, created_at) VALUES ($1, $2, NOW())`,

  [uid, lvl]

);



const updatedUser = await addCoins(uid, 1, c);



await c.query("COMMIT");

return { ok: true, already: false, user: updatedUser };

} catch (e) {

try { await c.query("ROLLBACK"); } catch {}

throw e;

} finally {

c.release();

}

}

/* =========================

✅ SKIP / HINT (3 free lifetime then -50)

========================= */

export async function useSkip(uid: string) {

const p = getPool();

const c = await p.connect();

try {

await c.query("BEGIN");



const user = await getUserByUid(uid, c);

if (!user) throw new Error("User not found");



const used = Number(user.free_skips_used || 0);



if (used < FREE_SKIPS) {

  const r = await c.query(

    `

    UPDATE users

    SET free_skips_used = free_skips_used + 1,

        updated_at = NOW()

    WHERE uid = $1

    RETURNING *

    `,

    [uid]

  );



  await c.query("COMMIT");

  return {

    ok: true,

    mode: "free",

    freeLeft: FREE_SKIPS - (used + 1),

    user: r.rows[0],

  };

}



if ((user.coins || 0) < 50) {

  throw new Error("Not enough coins for skip (need 50) or watch an ad.");

}



const updatedUser = await addCoins(uid, -50, c);



await c.query("COMMIT");

return {

  ok: true,

  mode: "coins",

  freeLeft: 0,

  user: updatedUser,

};

} catch (e) {

try { await c.query("ROLLBACK"); } catch {}

throw e;

} finally {

c.release();

}

}

export async function useHint(uid: string) {

const p = getPool();

const c = await p.connect();

try {

await c.query("BEGIN");



const user = await getUserByUid(uid, c);

if (!user) throw new Error("User not found");



const used = Number(user.free_hints_used || 0);



if (used < FREE_HINTS) {

  const r = await c.query(

    `

    UPDATE users

    SET free_hints_used = free_hints_used + 1,

        updated_at = NOW()

    WHERE uid = $1

    RETURNING *

    `,

    [uid]

  );



  await c.query("COMMIT");

  return {

    ok: true,

    mode: "free",

    freeLeft: FREE_HINTS - (used + 1),

    user: r.rows[0],

  };

}



if ((user.coins || 0) < 50) {

  throw new Error("Not enough coins for hint (need 50) or watch an ad.");

}



const updatedUser = await addCoins(uid, -50, c);



await c.query("COMMIT");

return {

  ok: true,

  mode: "coins",

  freeLeft: 0,

  user: updatedUser,

};

} catch (e) {

try { await c.query("ROLLBACK"); } catch {}

throw e;

} finally {

c.release();

}

}

/* =========================

✅ MONTHLY PAYOUT HELPERS (for later Pi conversion)

========================= */

export function getCurrentMonthKeyUTC() {

const d = new Date();

const y = d.getUTCFullYear();

const m = String(d.getUTCMonth() + 1).padStart(2, "0");

return ${y}-${m};

}

export async function createMonthlyPayout(

uid: string,

month = getCurrentMonthKeyUTC(),

piAmount = 0

) {

const p = getPool();

const c = await p.connect();

try {

await c.query("BEGIN");



const user = await getUserByUid(uid, c);

if (!user) throw new Error("User not found");



const coins = Number(user.coins || 0);



await c.query(

  `

  INSERT INTO monthly_payouts (uid, month, coins, pi_amount, status, created_at, updated_at)

  VALUES ($1, $2, $3, $4, 'created', NOW(), NOW())

  ON CONFLICT (uid, month) DO NOTHING

  `,

  [uid, month, coins, Number(piAmount || 0)]

);



const row = await c.query(

  `SELECT * FROM monthly_payouts WHERE uid = $1 AND month = $2 LIMIT 1`,

  [uid, month]

);



await c.query("COMMIT");

return row.rows[0] || null;

} catch (e) {

try { await c.query("ROLLBACK"); } catch {}

throw e;

} finally {

c.release();

}

}

/**

After payout is confirmed SENT, reset coins to 0 (current month from 0).


*/

export async function resetUserCoinsAfterPayout(

uid: string,

month = getCurrentMonthKeyUTC()

) {

const p = getPool();

const c = await p.connect();

try {

const r = await c.query(

  `

  UPDATE users

  SET coins = 0,

      last_payout_month = $2,

      updated_at = NOW()

  WHERE uid = $1

  RETURNING *

  `,

  [uid, month]

);



return r.rows[0] || undefined;

} finally {

c.release();

}

}

/* =========================

PAYMENTS TRACKING

========================= */

export async function upsertPaymentOwner({

paymentId,

uid,

status,

txid,

}: {

paymentId: string;

uid: string;

status?: string;

txid?: string | null;

}) {

const p = getPool();

const c = await p.connect();

try {

const r = await c.query(

  `

  INSERT INTO payments (payment_id, uid, status, txid, updated_at, created_at)

  VALUES ($1, $2, COALESCE($3, 'created'), $4, NOW(), NOW())

  ON CONFLICT (payment_id) DO UPDATE SET

    uid = EXCLUDED.uid,

    status = COALESCE(EXCLUDED.status, payments.status),

    txid = COALESCE(EXCLUDED.txid, payments.txid),

    updated_at = NOW()

  RETURNING *

  `,

  [paymentId, uid, status || null, txid ?? null]

);

return r.rows[0] || undefined;

} finally {

c.release();

}

}

export async function getPayment(paymentId: string) {

const p = getPool();

const c = await p.connect();

try {

const r = await c.query(

  `SELECT * FROM payments WHERE payment_id = $1 LIMIT 1`,

  [paymentId]

);

return r.rows[0] || undefined;

} finally {

c.release();

}

}

export async function assertPaymentOwnedBy(paymentId: string, uid: string) {

const p = await getPayment(paymentId);

if (!p) throw new Error("Unknown paymentId");

if (p.uid !== uid) throw new Error("Payment does not belong to this user");

return p;

}

export async function setPaymentStatus(paymentId: string, status: string, txid?: string | null) {

const p = getPool();

const c = await p.connect();

try {

const r = await c.query(

  `

  UPDATE payments

  SET status = $2,

      txid = COALESCE($3, txid),

      updated_at = NOW()

  WHERE payment_id = $1

  RETURNING *

  `,

  [paymentId, status, txid ?? null]

);

return r.rows[0] || undefined;

} finally {

c.release();

}

}

/* =========================

✅ SESSIONS (ONLINE USERS)

========================= */

export async function startSession({

uid,

sessionId,

userAgent,

ip,

}: {

uid: string;

sessionId: string;

userAgent?: string | null;

ip?: string | null;

}) {

const p = getPool();

const c = await p.connect();

try {

const r = await c.query(

  `

  INSERT INTO user_sessions (uid, session_id, user_agent, ip, started_at, last_seen_at, ended_at)

  VALUES ($1, $2, $3, $4, NOW(), NOW(), NULL)

  ON CONFLICT (uid, session_id) DO UPDATE SET

    user_agent = COALESCE(EXCLUDED.user_agent, user_sessions.user_agent),

    ip = COALESCE(EXCLUDED.ip, user_sessions.ip),

    last_seen_at = NOW(),

    ended_at = NULL

  RETURNING *

  `,

  [uid, sessionId, userAgent ?? null, ip ?? null]

);

return r.rows[0] || undefined;

} finally {

c.release();

}

}

export async function pingSession(uid: string, sessionId: string) {

const p = getPool();

const c = await p.connect();

try {

const r = await c.query(

  `

  UPDATE user_sessions

  SET last_seen_at = NOW()

  WHERE uid = $1 AND session_id = $2 AND ended_at IS NULL

  RETURNING *

  `,

  [uid, sessionId]

);

return r.rows[0] || undefined;

} finally {

c.release();

}

}

export async function endSession(uid: string, sessionId: string) {

const p = getPool();

const c = await p.connect();

try {

const r = await c.query(

  `

  UPDATE user_sessions

  SET ended_at = NOW(),

      last_seen_at = NOW()

  WHERE uid = $1 AND session_id = $2 AND ended_at IS NULL

  RETURNING *

  `,

  [uid, sessionId]

);

return r.rows[0] || undefined;

} finally {

c.release();

}

}

export async function adminListOnlineUsers({

minutes = 5,

limit = 50,

offset = 0,

}: {

minutes?: number;

limit?: number;

offset?: number;

} = {}) {

const p = getPool();

const c = await p.connect();

try {

const r = await c.query(

  `

  SELECT u.uid, u.username, u.coins, s.session_id, s.last_seen_at, s.started_at, s.user_agent

  FROM user_sessions s

  JOIN users u ON u.uid = s.uid

  WHERE s.ended_at IS NULL

    AND s.last_seen_at >= NOW() - ($1 || ' minutes')::interval

  ORDER BY s.last_seen_at DESC

  LIMIT $2 OFFSET $3

  `,

  [Math.max(1, Math.trunc(minutes || 5)), Math.max(1, Math.trunc(limit || 50)), Math.max(0, Math.trunc(offset || 0))]

);



const c2 = await c.query(

  `

  SELECT COUNT(*)::int AS count

  FROM user_sessions

  WHERE ended_at IS NULL

    AND last_seen_at >= NOW() - ($1 || ' minutes')::interval

  `,

  [Math.max(1, Math.trunc(minutes || 5))]

);



return { rows: r.rows, count: c2.rows[0]?.count ?? 0 };

} finally {

c.release();

}

}

/* =========================

✅ ADMIN QUERIES (for admin panel)

========================= */

export async function adminListUsers({

search = "",

limit = 50,

offset = 0,

order = "updated_at_desc",

}: {

search?: string;

limit?: number;

offset?: number;

order?: "updated_at_desc" | "coins_desc" | "created_at_desc";

} = {}) {

const p = getPool();

const c = await p.connect();

try {

const q = String(search || "").trim();

const lim = Math.max(1, Math.min(200, Math.trunc(limit || 50)));

const off = Math.max(0, Math.trunc(offset || 0));



const where = q ? "WHERE (u.username ILIKE $1 OR u.uid ILIKE $1)" : "";

const params = q ? [`%${q}%`, lim, off] : [lim, off];



const orderSql =

  order === "coins_desc"

    ? "ORDER BY u.coins DESC, u.updated_at DESC"

    : order === "created_at_desc"

    ? "ORDER BY u.created_at DESC"

    : "ORDER BY u.updated_at DESC";



const sql = q

  ? `

    SELECT u.uid, u.username, u.coins, u.free_skips_used, u.free_hints_used, u.last_payout_month, u.created_at, u.updated_at

    FROM users u

    ${where}

    ${orderSql}

    LIMIT $2 OFFSET $3

  `

  : `

    SELECT u.uid, u.username, u.coins, u.free_skips_used, u.free_hints_used, u.last_payout_month, u.created_at, u.updated_at

    FROM users u

    ${orderSql}

    LIMIT $1 OFFSET $2

  `;



const r = await c.query(sql, params);



const countSql = q

  ? `SELECT COUNT(*)::int AS count FROM users u ${where}`

  : `SELECT COUNT(*)::int AS count FROM users u`;



const countParams = q ? [`%${q}%`] : [];

const cr = await c.query(countSql, countParams);



return { rows: r.rows, count: cr.rows[0]?.count ?? 0 };

} finally {

c.release();

}

}

export async function adminGetUser(uid: string) {

const p = getPool();

const c = await p.connect();

try {

const user = await getUserByUid(uid, c);

if (!user) return undefined;



const pr = await c.query(`SELECT * FROM progress WHERE uid = $1 LIMIT 1`, [uid]);

const progress = pr.rows[0] || null;



const ad50 = await c.query(

  `SELECT COUNT(*)::int AS count, COALESCE(SUM(amount),0)::int AS sum

   FROM reward_claims WHERE uid=$1 AND type='ad_50'`,

  [uid]

);

const daily = await c.query(

  `SELECT COUNT(*)::int AS count, COALESCE(SUM(amount),0)::int AS sum

   FROM reward_claims WHERE uid=$1 AND type='daily_login'`,

  [uid]

);

const lvl = await c.query(

  `SELECT COUNT(*)::int AS count FROM level_rewards WHERE uid=$1`,

  [uid]

);

const skipAd = await c.query(

  `SELECT COUNT(*)::int AS count FROM reward_claims WHERE uid=$1 AND type='skip_ad'`,

  [uid]

);

const hintAd = await c.query(

  `SELECT COUNT(*)::int AS count FROM reward_claims WHERE uid=$1 AND type='hint_ad'`,

  [uid]

);



const lastSession = await c.query(

  `SELECT session_id, last_seen_at, started_at, ended_at, user_agent

   FROM user_sessions WHERE uid=$1

   ORDER BY last_seen_at DESC LIMIT 1`,

  [uid]

);



return {

  user,

  progress,

  stats: {

    daily_login_count: daily.rows[0]?.count ?? 0,

    daily_login_sum: daily.rows[0]?.sum ?? 0,

    ad50_count: ad50.rows[0]?.count ?? 0,

    ad50_sum: ad50.rows[0]?.sum ?? 0,

    level_complete_count: lvl.rows[0]?.count ?? 0,

    skip_ad_count: skipAd.rows[0]?.count ?? 0,

    hint_ad_count: hintAd.rows[0]?.count ?? 0,

  },

  last_session: lastSession.rows[0] || null,

};

} finally {

c.release();

}

}

export async function adminGetStats({ onlineMinutes = 5 }: { onlineMinutes?: number } = {}) {

const p = getPool();

const c = await p.connect();

try {

const users = await c.query(`SELECT COUNT(*)::int AS count, COALESCE(SUM(coins),0)::bigint AS coins_sum FROM users`);

const rewards = await c.query(

  `

  SELECT

    SUM(CASE WHEN type='ad_50' THEN 1 ELSE 0 END)::int AS ad50_count,

    SUM(CASE WHEN type='ad_50' THEN amount ELSE 0 END)::int AS ad50_sum,

    SUM(CASE WHEN type='daily_login' THEN 1 ELSE 0 END)::int AS daily_count,

    SUM(CASE WHEN type='daily_login' THEN amount ELSE 0 END)::int AS daily_sum,

    SUM(CASE WHEN type='skip_ad' THEN 1 ELSE 0 END)::int AS skip_ad_count,

    SUM(CASE WHEN type='hint_ad' THEN 1 ELSE 0 END)::int AS hint_ad_count

  FROM reward_claims

  `

);

const levels = await c.query(`SELECT COUNT(*)::int AS count FROM level_rewards`);

const payouts = await c.query(

  `

  SELECT

    SUM(CASE WHEN status='created' THEN 1 ELSE 0 END)::int AS created,

    SUM(CASE WHEN status='processing' THEN 1 ELSE 0 END)::int AS processing,

    SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END)::int AS sent,

    SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END)::int AS failed

  FROM monthly_payouts

  `

);

const online = await c.query(

  `

  SELECT COUNT(*)::int AS count

  FROM user_sessions

  WHERE ended_at IS NULL

    AND last_seen_at >= NOW() - ($1 || ' minutes')::interval

  `,

  [Math.max(1, Math.trunc(onlineMinutes || 5))]

);



return {

  users_total: users.rows[0]?.count ?? 0,

  coins_total: int(users.rows[0]?.coins_sum),

  daily_login_count: rewards.rows[0]?.daily_count ?? 0,

  daily_login_sum: rewards.rows[0]?.daily_sum ?? 0,

  ad50_count: rewards.rows[0]?.ad50_count ?? 0,

  ad50_sum: rewards.rows[0]?.ad50_sum ?? 0,

  skip_ad_count: rewards.rows[0]?.skip_ad_count ?? 0,

  hint_ad_count: rewards.rows[0]?.hint_ad_count ?? 0,

  level_complete_count: levels.rows[0]?.count ?? 0,

  payouts: payouts.rows[0] || { created: 0, processing: 0, sent: 0, failed: 0 },

  online_now: online.rows[0]?.count ?? 0,

};

} finally {

c.release();

}

}

function int(v: any) {

if (v === null || v === undefined) return 0;

if (typeof v === "bigint") return Number(v);

const n = Number(v);

return Number.isFinite(n) ? n : 0;

}

/* =========================

UTIL

========================= */

function getDayKeyUTC() {

const d = new Date();

const y = d.getUTCFullYear();

const m = String(d.getUTCMonth() + 1).padStart(2, "0");

const day = String(d.getUTCDate()).padStart(2, "0");

return ${y}-${m}-${day};

}