import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true"
    ? { rejectUnauthorized: false }
    : undefined,
});

/* =====================================================
   INIT  (✅ Fix 1: auto-create core tables incl. sessions)
===================================================== */
export async function initDB() {
  await pool.query("SELECT 1");
  // create minimal tables if they don't exist
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
   USERS
===================================================== */
function currentMonthKey() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`; // e.g. 2026-01
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
  const { rows } = await pool.query(
    `
    UPDATE users
    SET coins = COALESCE(coins,0) + $2, updated_at=NOW()
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
  uid, level, coins,
}: { uid: string; level: number; coins: number; }) {
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

  const user = await addCoins(uid, 1);
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

      function currentMonth() {
      const d = new Date();
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      }
      export async function trackAdView(
      uid: string,
      kind: "coins" | "skips" | "hints"
      ) {
      const month = currentMonth();

      await pool.query(
      `
      INSERT INTO user_ads (uid, month)
      VALUES ($1, $2)
      ON CONFLICT (uid, month)
      DO NOTHING
      `,
      [uid, month]
      );

      const column =kind === "coins"
      ? "ads_for_coins"
      : kind === "skips"
      ? "ads_for_skips"
      : "ads_for_hints";

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
  const month = currentMonth();

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
  const nonce = `coin-ad-${currentMonth()}-${ads.ads_for_coins}`;

  return await claimReward({
    uid,
    type: "ad",
    nonce,
    amount: coins,
    cooldownSeconds: 0,
  });
}