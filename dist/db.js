"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONSUMABLES = exports.HINT_COST_COINS = exports.SKIP_COST_COINS = exports.RESTART_COST_COINS = exports.FREE_HINTS_PER_ACCOUNT = exports.FREE_SKIPS_PER_ACCOUNT = exports.FREE_RESTARTS_PER_ACCOUNT = exports.pool = void 0;
exports.useNonce = useNonce;
exports.consumeItem = consumeItem;
exports.initDB = initDB;
exports.getFreeSkipsLeft = getFreeSkipsLeft;
exports.getFreeHintsLeft = getFreeHintsLeft;
exports.ensureMonthlyKey = ensureMonthlyKey;
exports.monthKeyForDate = monthKeyForDate;
exports.closeMonthAndResetCoins = closeMonthAndResetCoins;
exports.ensureUserAdsRow = ensureUserAdsRow;
exports.upsertUser = upsertUser;
exports.getUserByUid = getUserByUid;
exports.addCoins = addCoins;
exports.spendCoins = spendCoins;
exports.getProgressByUid = getProgressByUid;
exports.setProgressByUid = setProgressByUid;
exports.claimReward = claimReward;
exports.claimDailyLogin = claimDailyLogin;
exports.claimLevelComplete = claimLevelComplete;
exports.useRestarts = useRestarts;
exports.useSkip = useSkip;
exports.useHint = useHint;
exports.touchUserOnline = touchUserOnline;
exports.startSession = startSession;
exports.pingSession = pingSession;
exports.endSession = endSession;
exports.adminListUsers = adminListUsers;
exports.adminGetUser = adminGetUser;
exports.adminResetFreeCounters = adminResetFreeCounters;
exports.adminDeleteUser = adminDeleteUser;
exports.adminGetStats = adminGetStats;
exports.adminListOnlineUsers = adminListOnlineUsers;
exports.adminChartCoins = adminChartCoins;
exports.adminChartActiveUsers = adminChartActiveUsers;
exports.trackAdView = trackAdView;
exports.getMonthlyAds = getMonthlyAds;
exports.claimCoinAd = claimCoinAd;
exports.getCompletedLevels = getCompletedLevels;
exports.calcMonthlyRate = calcMonthlyRate;
exports.recalcAndStoreMonthlyRate = recalcAndStoreMonthlyRate;
exports.claimMonthlyRewards = claimMonthlyRewards;
exports.ensureInviteCode = ensureInviteCode;
exports.getInviteSummary = getInviteSummary;
exports.claimInviteCode = claimInviteCode;
const pg_1 = require("pg");
console.log("Backend v2.0.1");
exports.pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "true"
        ? { rejectUnauthorized: false }
        : undefined,
});
/* =====================================================
   INIT  (✅ Fix 1: auto-create core tables incl. sessions)
===================================================== */
async function useNonce(uid, nonce) {
    if (!nonce)
        throw new Error("missing_nonce");
    try {
        await exports.pool.query(`INSERT INTO reward_nonces (nonce, uid) VALUES ($1,$2)`, [nonce, uid]);
    }
    catch (e) {
        if (e.code === "23505") {
            throw new Error("nonce_reused");
        }
        throw e;
    }
}
async function consumeItem(uid, item, mode, nonce) {
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
async function initDB() {
    await exports.pool.query("SELECT 1");
    // --- core tables ---
    await exports.pool.query(`
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
    await exports.pool.query(`
    ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS last_daily_login DATE
  `);
    // invite/referral tracking
    await exports.pool.query(`
    ALTER TABLE public.users
      ADD COLUMN IF NOT EXISTS invite_code TEXT,
      ADD COLUMN IF NOT EXISTS invited_by_uid TEXT,
      ADD COLUMN IF NOT EXISTS invited_at TIMESTAMP
  `);
    await exports.pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_invite_code_unique
    ON public.users (invite_code)
    WHERE invite_code IS NOT NULL
  `);
    await exports.pool.query(`
    CREATE TABLE IF NOT EXISTS public.user_invites (
      invitee_uid TEXT PRIMARY KEY,
      inviter_uid TEXT NOT NULL,
      invite_code TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
    await exports.pool.query(`
    CREATE INDEX IF NOT EXISTS user_invites_inviter_idx
    ON public.user_invites (inviter_uid)
  `);
    // --- upgrades for existing DBs (safe to run every boot) ---
    await exports.pool.query(`
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
    await exports.pool.query(`
    ALTER TABLE public.users
      ADD COLUMN IF NOT EXISTS restarts_balance INT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS skips_balance INT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS hints_balance INT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS daily_streak INT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS last_daily_claim_date DATE,
      ADD COLUMN IF NOT EXISTS lifetime_coins_earned INT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS lifetime_coins_spent INT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS lifetime_levels_completed INT DEFAULT 0;
  `);
    await exports.pool.query(`
    CREATE TABLE IF NOT EXISTS progress (
      uid TEXT PRIMARY KEY,
      level INT DEFAULT 1,
      coins INT DEFAULT 0,
      painted_keys JSONB DEFAULT '[]'::jsonb,
      resume JSONB DEFAULT NULL,
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
    await exports.pool.query(`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS mystery_box_pending BOOLEAN NOT NULL DEFAULT FALSE`);
    await exports.pool.query(`
    CREATE TABLE IF NOT EXISTS reward_claims (
      uid TEXT NOT NULL,
      type TEXT NOT NULL,
      nonce TEXT,
      amount INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
    await exports.pool.query(`
    CREATE TABLE IF NOT EXISTS reward_nonces (
      nonce TEXT PRIMARY KEY,
      uid TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
    await exports.pool.query(`
    CREATE TABLE IF NOT EXISTS daily_reward_missed_days (
      uid TEXT NOT NULL,
      day INT NOT NULL,
      is_recovered BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (uid, day)
    );
  `);
    await exports.pool.query(`
    CREATE TABLE IF NOT EXISTS daily_reward_recoveries (
      uid TEXT NOT NULL,
      day INT NOT NULL,
      cycle_anchor TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (uid, day, cycle_anchor)
    );
  `);
    await exports.pool.query(`
  CREATE TABLE IF NOT EXISTS public.level_rewards (
    uid TEXT NOT NULL,
    level INT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  );
`);
    await exports.pool.query(`
  CREATE UNIQUE INDEX IF NOT EXISTS level_rewards_uid_level_unique
  ON public.level_rewards (uid, level)
`);
    await exports.pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      uid TEXT PRIMARY KEY,
      session_id TEXT,
      user_agent TEXT,
      ip TEXT,
      started_at TIMESTAMP,
      last_seen_at TIMESTAMP NOT NULL
    );
  `);
    await exports.pool.query(`
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
    await exports.pool.query(`
    CREATE TABLE IF NOT EXISTS user_ads (
      uid TEXT NOT NULL,
      month TEXT NOT NULL,
      ads_for_coins INT DEFAULT 0,
      ads_for_skips INT DEFAULT 0,
      ads_for_hints INT DEFAULT 0,
      PRIMARY KEY (uid, month)
    );
  `);
    await exports.pool.query(`
    ALTER TABLE user_ads
    ADD COLUMN IF NOT EXISTS ads_for_restarts INT DEFAULT 0
  `);
}
/* =====================================================
   CONSTANTS
===================================================== */
exports.FREE_RESTARTS_PER_ACCOUNT = 3;
exports.FREE_SKIPS_PER_ACCOUNT = 3;
exports.FREE_HINTS_PER_ACCOUNT = 3;
exports.RESTART_COST_COINS = 50;
exports.SKIP_COST_COINS = 50;
exports.HINT_COST_COINS = 50;
exports.CONSUMABLES = {
    restart: { coinCost: 50, freeLimit: 3 },
    skip: { coinCost: 50, freeLimit: 3 },
    hint: { coinCost: 50, freeLimit: 3 },
};
function getFreeSkipsLeft(u) {
    const used = Number(u?.free_skips_used || 0);
    return Math.max(0, exports.FREE_SKIPS_PER_ACCOUNT - used);
}
function getFreeHintsLeft(u) {
    const used = Number(u?.free_hints_used || 0);
    return Math.max(0, exports.FREE_HINTS_PER_ACCOUNT - used);
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
async function ensureMonthlyKey(uid) {
    const mk = currentMonthKey();
    // ensure column exists even on old DBs
    await exports.pool.query(`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS monthly_key TEXT;`);
    const { rows } = await exports.pool.query(`SELECT monthly_key FROM public.users WHERE uid=$1`, [uid]);
    const existing = rows?.[0]?.monthly_key ? String(rows[0].monthly_key) : "";
    if (existing !== mk) {
        await exports.pool.query(`UPDATE public.users
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
       WHERE uid=$1`, [uid, mk]);
    }
}
function monthKeyForDate(d) {
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
async function closeMonthAndResetCoins(opts) {
    const month = String(opts?.month || currentMonthKey());
    // Use a transaction to avoid partial resets
    const client = await exports.pool.connect();
    try {
        await client.query("BEGIN");
        const { rows } = await client.query(`SELECT uid, COALESCE(coins,0)::int AS coins
       FROM public.users
       WHERE COALESCE(coins,0) <> 0
       FOR UPDATE`);
        for (const r of rows) {
            const uid = String(r.uid);
            const coins = Number(r.coins || 0);
            // insert payout row once per (uid,month)
            await client.query(`INSERT INTO monthly_payouts (uid, month, coins_collected, status, created_at)
         VALUES ($1,$2,$3,'pending',NOW())
         ON CONFLICT (uid, month) DO NOTHING`, [uid, month, coins]);
            // reset coins (idempotent)
            await client.query(`UPDATE public.users
         SET coins = 0,
             coins_month = $2,
             updated_at = NOW()
         WHERE uid = $1`, [uid, month]);
        }
        await client.query("COMMIT");
        return {
            ok: true,
            month,
            users_reset: rows.length,
            total_coins_reset: rows.reduce((s, r) => s + Number(r.coins || 0), 0),
        };
    }
    catch (e) {
        await client.query("ROLLBACK");
        throw e;
    }
    finally {
        client.release();
    }
}
async function ensureUserAdsRow(uid) {
    const month = currentMonthKey();
    await exports.pool.query(`
    INSERT INTO user_ads (uid, month)
    VALUES ($1, $2)
    ON CONFLICT (uid, month) DO NOTHING
    `, [uid, month]);
    return { uid, month };
}
async function upsertUser({ uid, username, }) {
    const { rows } = await exports.pool.query(`
    INSERT INTO public.users (uid, username, updated_at)
    VALUES ($1,$2,NOW())
    ON CONFLICT (uid)
    DO UPDATE SET
      username = EXCLUDED.username,
      updated_at = NOW()
    RETURNING *
  `, [uid, username]);
    return rows[0];
}
async function getUserByUid(uid) {
    const { rows } = await exports.pool.query(`SELECT * FROM public.users WHERE uid=$1`, [uid]);
    return rows[0] || null;
}
async function addCoins(uid, delta) {
    const d = Number(delta || 0);
    const { rows } = await exports.pool.query(`
    UPDATE public.users
    SET
      coins = COALESCE(coins,0) + $2,
      monthly_coins_earned = COALESCE(monthly_coins_earned,0) + GREATEST($2,0),
      lifetime_coins_earned = COALESCE(lifetime_coins_earned,0) + GREATEST($2,0),
      updated_at=NOW()
    WHERE uid=$1
    RETURNING *
  `, [uid, d]);
    return rows[0];
}
async function spendCoins(uid, amount) {
    const a = Math.abs(Number(amount || 0));
    if (!a)
        throw new Error("Amount required");
    const { rows } = await exports.pool.query(`
    UPDATE public.users
SET
  coins = COALESCE(coins,0) - $2,
  lifetime_coins_spent = COALESCE(lifetime_coins_spent,0) + $2,
  updated_at=NOW()
      WHERE uid=$1 AND COALESCE(coins,0) >= $2
      RETURNING *
    `, [uid, a]);
    if (!rows.length) {
        throw new Error("Not enough coins");
    }
    return rows[0];
}
/* =====================================================
   PROGRESS
===================================================== */
async function getProgressByUid(uid) {
    const { rows } = await exports.pool.query(`SELECT * FROM progress WHERE uid=$1`, [uid]);
    return rows[0] || null;
}
async function setProgressByUid({ uid, level, coins, paintedKeys, resume, }) {
    await exports.pool.query(`
    INSERT INTO progress (uid, level, coins, painted_keys, resume)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (uid)
    DO UPDATE SET
      level = GREATEST(progress.level, EXCLUDED.level),
      coins = EXCLUDED.coins,
      painted_keys = COALESCE($4::jsonb, progress.painted_keys),
      resume = $5,
      updated_at = NOW()
    `, [
        uid,
        level ?? 1,
        coins ?? 0,
        paintedKeys ? JSON.stringify(paintedKeys) : null,
        resume ? JSON.stringify(resume) : null,
    ]);
}
/* =====================================================
   REWARDS
===================================================== */
async function claimReward({ uid, type, nonce, amount, cooldownSeconds, }) {
    if (!nonce) {
        throw new Error("missing_nonce");
    }
    // 1) block exact replay of same request
    const nonceRes = await exports.pool.query(`SELECT 1 FROM reward_claims WHERE uid=$1 AND nonce=$2 LIMIT 1`, [uid, nonce]);
    if ((nonceRes.rowCount ?? 0) > 0) {
        return { already: true };
    }
    // 2) block same reward type inside cooldown window
    if (cooldownSeconds > 0) {
        const cooldownRes = await exports.pool.query(`
      SELECT 1
      FROM reward_claims
      WHERE uid = $1
        AND type = $2
        AND created_at > NOW() - ($3 * INTERVAL '1 second')
      LIMIT 1
      `, [uid, type, cooldownSeconds]);
        if ((cooldownRes.rowCount ?? 0) > 0) {
            return { already: true, cooldown: true };
        }
    }
    // 3) record claim
    await exports.pool.query(`
    INSERT INTO reward_claims (uid, type, nonce, amount, created_at)
    VALUES ($1, $2, $3, $4, NOW())
    `, [uid, type, nonce, amount]);
    // 4) grant coins
    const user = await addCoins(uid, amount);
    if (type === "ad_50" || type === "ad") {
        await exports.pool.query(`UPDATE public.users
       SET monthly_ads_watched = COALESCE(monthly_ads_watched,0) + 1,
           monthly_surprise_boxes_opened = COALESCE(monthly_surprise_boxes_opened,0) + 1
       WHERE uid=$1`, [uid]);
        await recalcAndStoreMonthlyRate(uid);
    }
    return { user };
}
async function claimDailyLogin(uid) {
    const { rowCount } = await exports.pool.query(`
    SELECT 1 FROM reward_claims
    WHERE uid=$1 AND type='daily_login'
      AND created_at::date = CURRENT_DATE
  `, [uid]);
    if (rowCount)
        return { already: true };
    await exports.pool.query(`
    INSERT INTO reward_claims (uid,type,amount,created_at)
    VALUES ($1,'daily_login',5,NOW())
  `, [uid]);
    const user = await addCoins(uid, 5);
    await exports.pool.query(`UPDATE public.users SET monthly_login_days = COALESCE(monthly_login_days,0) + 1 WHERE uid=$1`, [uid]);
    await recalcAndStoreMonthlyRate(uid);
    return { user };
}
async function claimLevelComplete(uid, level) {
    if (!Number.isInteger(level) || level < 1) {
        throw new Error("invalid_level");
    }
    const insert = await exports.pool.query(`
    INSERT INTO public.level_rewards (uid, level, created_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (uid, level) DO NOTHING
    `, [uid, level]);
    // if already claimed, do not add coin
    if ((insert.rowCount ?? 0) === 0)
        return { already: true };
    const user = await addCoins(uid, 1);
    await exports.pool.query(`
    UPDATE public.users
    SET
      monthly_levels_completed = COALESCE(monthly_levels_completed,0) + 1,
      lifetime_levels_completed = COALESCE(lifetime_levels_completed,0) + 1
    WHERE uid=$1
    `, [uid]);
    await recalcAndStoreMonthlyRate(uid);
    return { user };
}
/* =====================================================
  RESTARTS / SKIPS / HINTS
===================================================== */
async function useRestarts(uid, mode, nonce) {
    const user = await getUserByUid(uid);
    if (!user)
        throw new Error("User not found");
    // ---- FREE ----
    if (mode === "free") {
        if (user.free_restarts_used >= 3) {
            return { ok: false, error: "NO_FREE_RESTARTS" };
        }
        const { rows } = await exports.pool.query(`UPDATE public.users
     SET free_restarts_used = free_restarts_used + 1,
         updated_at = NOW()
     WHERE uid = $1
     RETURNING *`, [uid]);
        return { ok: true, user: rows[0] };
    }
    // ---- COINS ----
    if (mode === "coins") {
        const u = await spendCoins(uid, exports.RESTART_COST_COINS);
        await exports.pool.query(`INSERT INTO reward_claims (uid,type,amount,created_at)
       VALUES ($1,'restart_coin',-$2,NOW())`, [uid, exports.RESTART_COST_COINS]);
        return { ok: true, user: u };
    }
}
async function useSkip(uid, mode, nonce) {
    const user = await getUserByUid(uid);
    if (!user)
        throw new Error("User not found");
    // ---- FREE ----
    if (mode === "free") {
        if (user.free_skips_used >= 3) {
            return { ok: false, error: "NO_FREE_SKIPS" };
        }
        const { rows } = await exports.pool.query(`UPDATE public.users
       SET free_skips_used = free_skips_used + 1,
           updated_at = NOW()
       WHERE uid=$1
       RETURNING *`, [uid]);
        await exports.pool.query(`
    UPDATE public.users
    SET monthly_skips_used = COALESCE(monthly_skips_used,0) + 1
    WHERE uid=$1
    `, [uid]);
        await recalcAndStoreMonthlyRate(uid);
        return { ok: true, user: rows[0] };
    }
    // ---- COINS ----
    if (mode === "coins") {
        const u = await spendCoins(uid, exports.SKIP_COST_COINS);
        await exports.pool.query(`INSERT INTO reward_claims (uid,type,amount,created_at)
       VALUES ($1,'skip_coin',-$2,NOW())`, [uid, exports.SKIP_COST_COINS]);
        await exports.pool.query(`
    UPDATE public.users
    SET monthly_skips_used = COALESCE(monthly_skips_used,0) + 1
    WHERE uid=$1
    `, [uid]);
        await recalcAndStoreMonthlyRate(uid);
        return { ok: true, user: u };
    }
    // ---- AD ----
    if (mode === "ad") {
        if (!nonce)
            throw new Error("Missing nonce");
        const already = await exports.pool.query(`SELECT 1 FROM reward_claims
       WHERE uid=$1 AND type='skip_ad' AND nonce=$2`, [uid, nonce]);
        if (already.rowCount) {
            return { ok: true, already: true, user };
        }
        await exports.pool.query(`INSERT INTO reward_claims (uid,type,nonce,amount,created_at)
       VALUES ($1,'skip_ad',$2,0,NOW())`, [uid, nonce]);
        await trackAdView(uid, "skips");
        await exports.pool.query(`
    UPDATE public.users
    SET
      monthly_skips_used = COALESCE(monthly_skips_used,0) + 1,
      monthly_ads_watched = COALESCE(monthly_ads_watched,0) + 1
    WHERE uid=$1
    `, [uid]);
        await recalcAndStoreMonthlyRate(uid);
        return { ok: true, user };
    }
    throw new Error("INVALID_SKIP_MODE");
}
async function useHint(uid, mode, nonce) {
    const user = await getUserByUid(uid);
    if (!user)
        throw new Error("User not found");
    if (mode === "free") {
        if (getFreeHintsLeft(user) <= 0)
            throw new Error("No free hints left");
        const { rows } = await exports.pool.query(`UPDATE public.users
       SET free_hints_used = COALESCE(free_hints_used,0) + 1,
           updated_at=NOW()
       WHERE uid=$1
       RETURNING *`, [uid]);
        return { ok: true, user: rows[0] };
    }
    if (mode === "coins") {
        const u = await spendCoins(uid, exports.HINT_COST_COINS);
        await exports.pool.query(`INSERT INTO reward_claims (uid,type,amount,created_at)
       VALUES ($1,'hint_coin',-$2,NOW())`, [uid, exports.HINT_COST_COINS]);
        return { ok: true, user: u };
    }
    // mode === "ad"
    if (!nonce)
        throw new Error("Missing nonce");
    const already = await exports.pool.query(`SELECT 1 FROM reward_claims WHERE uid=$1 AND type='hint_ad' AND nonce=$2`, [uid, nonce]);
    if (already.rowCount)
        return { ok: true, already: true, user };
    await exports.pool.query(`INSERT INTO reward_claims (uid,type,nonce,amount,created_at)
     VALUES ($1,'hint_ad',$2,0,NOW())`, [uid, nonce]);
    await trackAdView(uid, "hints");
    return { ok: true, user };
}
/* =====================================================
   ONLINE / SESSIONS
===================================================== */
async function touchUserOnline(uid) {
    await exports.pool.query(`
    INSERT INTO sessions (uid, session_id, last_seen_at)
    VALUES ($1,'auto',NOW())
    ON CONFLICT (uid)
    DO UPDATE SET last_seen_at=NOW()
  `, [uid]);
}
async function startSession({ uid, sessionId, userAgent, ip, }) {
    const { rows } = await exports.pool.query(`
    INSERT INTO sessions (uid,session_id,user_agent,ip,started_at,last_seen_at)
    VALUES ($1,$2,$3,$4,NOW(),NOW())
    ON CONFLICT (uid)
    DO UPDATE SET last_seen_at=NOW(), session_id=$2
    RETURNING *
  `, [uid, sessionId, userAgent, ip]);
    return rows[0];
}
async function pingSession(uid) {
    const { rows } = await exports.pool.query(`
    UPDATE sessions
    SET last_seen_at=NOW()
    WHERE uid=$1
    RETURNING *
  `, [uid]);
    return rows[0];
}
async function endSession(uid) {
    const { rows } = await exports.pool.query(`DELETE FROM sessions WHERE uid=$1 RETURNING *`, [uid]);
    return rows[0];
}
/* =====================================================
   ADMIN
===================================================== */
async function adminListUsers({ search, limit, offset, }) {
    if (search) {
        const { rows } = await exports.pool.query(`
      SELECT *
      FROM public.users
      WHERE username ILIKE '%' || $1 || '%'
         OR uid ILIKE '%' || $1 || '%'
      ORDER BY updated_at DESC
      LIMIT $2 OFFSET $3
    `, [search, limit, offset]);
        const { rows: c } = await exports.pool.query(`
      SELECT COUNT(*)
      FROM public.users
      WHERE username ILIKE '%' || $1 || '%'
         OR uid ILIKE '%' || $1 || '%'
    `, [search]);
        return { rows, count: Number(c[0].count) };
    }
    // ✅ no search
    const { rows } = await exports.pool.query(`
    SELECT *
    FROM public.users
    ORDER BY updated_at DESC
    LIMIT $1 OFFSET $2
  `, [limit, offset]);
    const { rows: c } = await exports.pool.query(`SELECT COUNT(*) FROM public.users`);
    return { rows, count: Number(c[0].count) };
}
async function adminGetUser(uid) {
    const user = await getUserByUid(uid);
    const progress = await getProgressByUid(uid);
    const { rows: stats } = await exports.pool.query(`SELECT type,COUNT(*) FROM reward_claims WHERE uid=$1 GROUP BY type`, [uid]);
    const { rows: session } = await exports.pool.query(`SELECT * FROM sessions WHERE uid=$1`, [uid]);
    return {
        user,
        progress,
        stats,
        last_session: session[0] || null,
    };
}
async function adminResetFreeCounters(uid) {
    const { rows } = await exports.pool.query(`
    UPDATE public.users
    SET free_skips_used=0, free_hints_used=0
    WHERE uid=$1
    RETURNING *
  `, [uid]);
    return rows[0];
}
async function adminDeleteUser(uid) {
    // delete user
    await exports.pool.query(`DELETE FROM public.users WHERE uid = $1`, [uid]);
    // delete progress
    await exports.pool.query(`DELETE FROM progress WHERE uid = $1`, [uid]);
    // delete sessions
    await exports.pool.query(`DELETE FROM sessions WHERE uid = $1`, [uid]);
    return { ok: true };
}
async function adminGetStats({ onlineMinutes }) {
    const users = await exports.pool.query(`SELECT COUNT(*) FROM public.users`);
    const coins = await exports.pool.query(`SELECT SUM(coins) FROM public.users`);
    const online = await exports.pool.query(`
    SELECT COUNT(*) FROM sessions
    WHERE last_seen_at > NOW() - ($1 || ' minutes')::interval
  `, [onlineMinutes]);
    const ad50 = await exports.pool.query(`SELECT COUNT(*) FROM reward_claims WHERE type='ad_50'`);
    const daily = await exports.pool.query(`SELECT COUNT(*) FROM reward_claims WHERE type='daily_login'`);
    const levels = await exports.pool.query(`SELECT COUNT(*) FROM level_rewards`);
    return {
        users_total: Number(users.rows[0].count),
        coins_total: Number(coins.rows[0].sum || 0),
        online_now: Number(online.rows[0].count),
        ad50_count: Number(ad50.rows[0].count),
        daily_login_count: Number(daily.rows[0].count),
        level_complete_count: Number(levels.rows[0].count),
    };
}
async function adminListOnlineUsers({ minutes, limit, offset, }) {
    const { rows } = await exports.pool.query(`
    SELECT u.uid,u.username,u.coins,
           s.last_seen_at,s.started_at,s.user_agent
    FROM sessions s
    JOIN public.users u ON u.uid=s.uid
    WHERE s.last_seen_at > NOW() - ($1 || ' minutes')::interval
    ORDER BY s.last_seen_at DESC
    LIMIT $2 OFFSET $3
  `, [minutes, limit, offset]);
    return { rows, count: rows.length };
}
/* ============================
   Charts (Step 1 – 7 days default)
============================ */
async function adminChartCoins({ days }) {
    const d = Math.max(1, Math.min(90, Number(days || 7)));
    const { rows } = await exports.pool.query(`
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
  `, [d]);
    return rows.map(r => ({ day: r.day, coins: Number(r.coins) }));
}
async function adminChartActiveUsers({ days }) {
    const d = Math.max(1, Math.min(90, Number(days || 7)));
    const { rows } = await exports.pool.query(`
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
      `, [d]);
    return rows.map(r => ({ day: r.day, active_users: Number(r.active_users) }));
}
async function trackAdView(uid, kind) {
    const month = currentMonthKey();
    await exports.pool.query(`
      INSERT INTO user_ads (uid, month)
      VALUES ($1, $2)
      ON CONFLICT (uid, month)
      DO NOTHING
      `, [uid, month]);
    const column = kind === "coins"
        ? "ads_for_coins"
        : kind === "skips"
            ? "ads_for_skips"
            : kind === "hints"
                ? "ads_for_hints"
                : "ads_for_restarts";
    await exports.pool.query(`
      UPDATE user_ads
      SET ${column} = ${column} + 1
      WHERE uid = $1 AND month = $2
      `, [uid, month]);
}
async function getMonthlyAds(uid) {
    const month = currentMonthKey();
    const { rows } = await exports.pool.query(`
    SELECT
      ads_for_coins,
      ads_for_skips,
      ads_for_hints
    FROM user_ads
    WHERE uid = $1 AND month = $2
    `, [uid, month]);
    if (!rows.length) {
        return {
            ads_for_coins: 0,
            ads_for_skips: 0,
            ads_for_hints: 0,
        };
    }
    return rows[0];
}
function coinRewardForAd(adsForCoinsThisMonth) {
    const reward = 50 - adsForCoinsThisMonth;
    return Math.max(reward, 2);
}
async function claimCoinAd(uid) {
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
async function getCompletedLevels(uid) {
    const { rows } = await exports.pool.query(`SELECT level FROM level_rewards WHERE uid=$1`, [uid]);
    return rows.map(r => r.level);
}
function prevMonthKey() {
    const d = new Date();
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1; // 1..12
    const prev = new Date(Date.UTC(y, m - 2, 1)); // previous month
    return monthKeyForDate(prev);
}
function calcMonthlyRate(u) {
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
    const usageMonthly = (skipsUsed > 0 ? 1 : 0) +
        (hintsUsed > 0 ? 1 : 0) +
        (restartsUsed > 0 ? 1 : 0); // +1% each type, max +3%
    // Levels bonus is monthly-capped at +10%, reaching cap at 200 completed levels.
    const levelsMonthly = Math.min(10, Math.floor(Math.max(0, levelsCompleted) / 20)); // +1% per 20 levels
    const surpriseMonthly = Math.min(10, Math.floor(Math.max(0, surpriseBoxesOpened) / 20)); // 200/month => +10%
    const mysteryMonthly = mysteryBoxesOpened >= 1 ? 5 : 0; // 1/month => +5%
    const breakdown = {
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
    const rate = Math.min(100, base +
        invitesPersistent +
        loginMonthly +
        usageMonthly +
        levelsMonthly +
        surpriseMonthly +
        mysteryMonthly);
    return { rate, breakdown };
}
async function recalcAndStoreMonthlyRate(uid) {
    const { rows } = await exports.pool.query(`SELECT * FROM public.users WHERE uid=$1`, [uid]);
    const u = rows[0];
    if (!u)
        throw new Error("User not found");
    const out = calcMonthlyRate(u);
    const { rows: updated } = await exports.pool.query(`
    UPDATE public.users
    SET
      monthly_rate_breakdown = $2::jsonb,
      monthly_final_rate = $3,
      updated_at = NOW()
    WHERE uid=$1
    RETURNING *
    `, [uid, JSON.stringify(out.breakdown), out.rate]);
    return { user: updated[0], breakdown: out.breakdown, rate: out.rate };
}
async function claimMonthlyRewards(uid, opts) {
    const month = String(opts?.month || prevMonthKey());
    const client = await exports.pool.connect();
    try {
        await client.query("BEGIN");
        // lock user
        const { rows } = await client.query(`SELECT * FROM public.users WHERE uid=$1 FOR UPDATE`, [uid]);
        const u = rows[0];
        if (!u)
            throw new Error("User not found");
        // snapshot coins + rate
        const coinsCollected = Number(u.coins || 0);
        const rate = Math.max(0, Math.min(100, Number(u.monthly_final_rate || 50)));
        // create payout row once
        await client.query(`
      INSERT INTO monthly_payouts (uid, month, coins_collected, pi_amount, status, created_at)
      VALUES ($1,$2,$3,NULL,'pending',NOW())
      ON CONFLICT (uid, month) DO NOTHING
      `, [uid, month, coinsCollected]);
        // reset coins + monthly stats
        await client.query(`
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
      `, [uid, currentMonthKey()]);
        await client.query("COMMIT");
        return {
            ok: true,
            month,
            coins_collected: coinsCollected,
            rate_snapshot: rate,
        };
    }
    catch (e) {
        await client.query("ROLLBACK");
        throw e;
    }
    finally {
        client.release();
    }
}
function normalizeInviteCode(input) {
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
async function ensureInviteCode(uid) {
    const existing = await exports.pool.query(`SELECT invite_code FROM public.users WHERE uid=$1 LIMIT 1`, [uid]);
    const current = String(existing.rows[0]?.invite_code || "").trim();
    if (current)
        return current;
    for (let i = 0; i < 10; i++) {
        const code = makeInviteCode();
        try {
            const updated = await exports.pool.query(`
        UPDATE public.users
        SET invite_code = $2,
            updated_at = NOW()
        WHERE uid = $1
          AND (invite_code IS NULL OR invite_code = '')
        RETURNING invite_code
        `, [uid, code]);
            const got = String(updated.rows[0]?.invite_code || "").trim();
            if (got)
                return got;
            const recheck = await exports.pool.query(`SELECT invite_code FROM public.users WHERE uid=$1 LIMIT 1`, [uid]);
            const maybe = String(recheck.rows[0]?.invite_code || "").trim();
            if (maybe)
                return maybe;
        }
        catch (e) {
            if (e?.code !== "23505")
                throw e;
        }
    }
    throw new Error("invite_code_generation_failed");
}
async function getInviteSummary(uid) {
    const code = await ensureInviteCode(uid);
    const me = await exports.pool.query(`SELECT invited_by_uid FROM public.users WHERE uid=$1 LIMIT 1`, [uid]);
    const countRes = await exports.pool.query(`SELECT COUNT(*)::int AS count FROM public.user_invites WHERE inviter_uid=$1`, [uid]);
    const listRes = await exports.pool.query(`
    SELECT ui.invitee_uid, u.username, ui.created_at
    FROM public.user_invites ui
    LEFT JOIN public.users u ON u.uid = ui.invitee_uid
    WHERE ui.inviter_uid = $1
    ORDER BY ui.created_at DESC
    LIMIT 200
    `, [uid]);
    return {
        invite_code: code,
        invited_by_uid: me.rows[0]?.invited_by_uid || null,
        invited_count: Number(countRes.rows[0]?.count || 0),
        invited_users: listRes.rows,
    };
}
async function claimInviteCode(inviteeUid, rawCode) {
    const inviteCode = normalizeInviteCode(rawCode);
    if (!inviteCode)
        throw new Error("invite_code_required");
    const client = await exports.pool.connect();
    try {
        await client.query("BEGIN");
        const inviteeRes = await client.query(`SELECT uid, invited_by_uid FROM public.users WHERE uid=$1 FOR UPDATE`, [inviteeUid]);
        const invitee = inviteeRes.rows[0];
        if (!invitee)
            throw new Error("invitee_not_found");
        if (invitee.invited_by_uid) {
            throw new Error("invite_already_claimed");
        }
        const inviterRes = await client.query(`SELECT uid FROM public.users WHERE invite_code=$1 LIMIT 1`, [inviteCode]);
        const inviterUid = String(inviterRes.rows[0]?.uid || "");
        if (!inviterUid)
            throw new Error("invite_code_invalid");
        if (inviterUid === inviteeUid) {
            throw new Error("cannot_invite_self");
        }
        await client.query(`
      INSERT INTO public.user_invites (invitee_uid, inviter_uid, invite_code, created_at)
      VALUES ($1,$2,$3,NOW())
      `, [inviteeUid, inviterUid, inviteCode]);
        await client.query(`
      UPDATE public.users
      SET invited_by_uid = $2,
          invited_at = NOW(),
          updated_at = NOW()
      WHERE uid = $1
      `, [inviteeUid, inviterUid]);
        await client.query(`
      UPDATE public.users
      SET monthly_valid_invites = COALESCE(monthly_valid_invites,0) + 1,
          lifetime_valid_invites = COALESCE(lifetime_valid_invites,0) + 1,
          updated_at = NOW()
      WHERE uid = $1
      `, [inviterUid]);
        await client.query("COMMIT");
        await recalcAndStoreMonthlyRate(inviterUid);
        return {
            ok: true,
            inviter_uid: inviterUid,
            invite_code: inviteCode,
        };
    }
    catch (e) {
        await client.query("ROLLBACK");
        throw e;
    }
    finally {
        client.release();
    }
}
