// src/db.ts
import Database from "better-sqlite3";

let db: Database.Database | null = null;

// ✅ Lifetime freebies (not per month)
const FREE_SKIPS = 3;
const FREE_HINTS = 3;

export function initDB() {
  if (db) return db;

  db = new Database("data.sqlite");

  // ---------------------------
  // USERS
  // ---------------------------
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uid TEXT UNIQUE,
      username TEXT UNIQUE,
      coins INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_users_uid ON users(uid);
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
  `);

  // ✅ Add new columns to users table (safe migration)
  ensureUserColumns();

  // ---------------------------
  // PROGRESS (UID)
  // ---------------------------
  db.exec(`
    CREATE TABLE IF NOT EXISTS progress (
      uid TEXT PRIMARY KEY,
      level INTEGER NOT NULL DEFAULT 1,
      coins INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_progress_uid ON progress(uid);
  `);

  // ---------------------------
  // ✅ REWARD CLAIMS (idempotency via nonce UNIQUE)
  // - daily_login, ad_50, skip_ad, hint_ad, ...
  // ---------------------------
  db.exec(`
    CREATE TABLE IF NOT EXISTS reward_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uid TEXT NOT NULL,
      type TEXT NOT NULL,
      nonce TEXT NOT NULL UNIQUE,
      amount INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_reward_claims_uid_type_time
    ON reward_claims(uid, type, created_at);
  `);

  // ---------------------------
  // ✅ LEVEL REWARDS (level complete +1 once per uid+level)
  // ---------------------------
  db.exec(`
    CREATE TABLE IF NOT EXISTS level_rewards (
      uid TEXT NOT NULL,
      level INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY(uid, level)
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_level_rewards_uid ON level_rewards(uid);
  `);

  // ---------------------------
  // ✅ PAYMENTS (track paymentId ownership)
  // ---------------------------
  db.exec(`
    CREATE TABLE IF NOT EXISTS payments (
      payment_id TEXT PRIMARY KEY,
      uid TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'created',  -- created/approved/completed
      txid TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_payments_uid ON payments(uid);
  `);

  // ---------------------------
  // ✅ MONTHLY PAYOUTS LEDGER (for Pi conversion later)
  // - prevents paying twice per month
  // - after you really pay user => reset coins in users
  // ---------------------------
  db.exec(`
    CREATE TABLE IF NOT EXISTS monthly_payouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uid TEXT NOT NULL,
      month TEXT NOT NULL,                 -- e.g. "2026-01"
      coins INTEGER NOT NULL,
      pi_amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'created', -- created/processing/sent/failed
      txid TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(uid, month)
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_monthly_payouts_uid_month
    ON monthly_payouts(uid, month);
  `);

  // ---------------------------
  // ✅ MIGRATION (old progress(username...) -> progress(uid...))
  // ---------------------------
  migrateLegacyProgress();

  return db;
}

function getDB() {
  if (!db) initDB();
  return db!;
}

/* =========================
   USERS API
   ========================= */

export function upsertUser({ uid, username }: { uid: string; username: string }) {
  const d = getDB();

  const existingByUsername = getUserByUsername(username);
  if (existingByUsername && existingByUsername.uid && existingByUsername.uid !== uid) {
    throw new Error("Username already linked to another account.");
  }

  const stmt = d.prepare(`
    INSERT INTO users (uid, username, coins, created_at, updated_at)
    VALUES (@uid, @username, 0, datetime('now'), datetime('now'))
    ON CONFLICT(uid) DO UPDATE SET
      username = excluded.username,
      updated_at = datetime('now')
  `);

  stmt.run({ uid, username });
  return getUserByUid(uid);
}

export function getUserByUid(uid: string) {
  const d = getDB();
  const stmt = d.prepare(`SELECT * FROM users WHERE uid = ? LIMIT 1`);
  return stmt.get(uid) as
    | {
        id: number;
        uid: string;
        username: string;
        coins: number;
        free_skips_used?: number;
        free_hints_used?: number;
        last_payout_month?: string | null;
        created_at: string;
        updated_at: string;
      }
    | undefined;
}

export function getUserByUsername(username: string) {
  const d = getDB();
  const stmt = d.prepare(`SELECT * FROM users WHERE username = ? LIMIT 1`);
  return stmt.get(username) as
    | {
        id: number;
        uid: string;
        username: string;
        coins: number;
        free_skips_used?: number;
        free_hints_used?: number;
        last_payout_month?: string | null;
        created_at: string;
        updated_at: string;
      }
    | undefined;
}

// Adds/subtracts coins, never below 0
export function addCoins(uid: string, delta: number) {
  const d = getDB();

  const user = getUserByUid(uid);
  if (!user) throw new Error("User not found");

  const stmt = d.prepare(`
    UPDATE users
    SET coins = CASE
      WHEN coins + @delta < 0 THEN 0
      ELSE coins + @delta
    END,
    updated_at = datetime('now')
    WHERE uid = @uid
  `);

  stmt.run({ uid, delta: Math.trunc(delta) });
  return getUserByUid(uid);
}

/* =========================
   PROGRESS API (UID BASED)
   ========================= */

export function setProgressByUid({
  uid,
  level,
  coins,
}: {
  uid: string;
  level: number;
  coins: number;
}) {
  const d = getDB();

  const stmt = d.prepare(`
    INSERT INTO progress (uid, level, coins, updated_at)
    VALUES (@uid, @level, @coins, datetime('now'))
    ON CONFLICT(uid) DO UPDATE SET
      level = excluded.level,
      coins = excluded.coins,
      updated_at = datetime('now')
  `);

  stmt.run({
    uid,
    level: Math.max(1, Math.trunc(level || 1)),
    coins: Math.max(0, Math.trunc(coins || 0)),
  });
}

export function getProgressByUid(uid: string) {
  const d = getDB();
  const stmt = d.prepare(`SELECT * FROM progress WHERE uid = ? LIMIT 1`);
  return stmt.get(uid) as
    | { uid: string; level: number; coins: number; updated_at: string }
    | undefined;
}

/* =========================
   ✅ REWARDS (server-side)
   ========================= */

export function claimReward({
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
  const d = getDB();
  const user = getUserByUid(uid);
  if (!user) throw new Error("User not found");

  const tx = d.transaction(() => {
    // 1) Idempotency
    const existing = d
      .prepare(`SELECT id FROM reward_claims WHERE nonce = ? LIMIT 1`)
      .get(nonce) as any;

    if (existing?.id) {
      return { ok: true, already: true, user: getUserByUid(uid) };
    }

    // 2) Cooldown (per uid+type)
    const last = d
      .prepare(
        `SELECT created_at FROM reward_claims
         WHERE uid = ? AND type = ?
         ORDER BY datetime(created_at) DESC
         LIMIT 1`
      )
      .get(uid, type) as any;

    if (last?.created_at) {
      const lastMs = Date.parse(last.created_at + "Z");
      const nowMs = Date.now();
      const diff = (nowMs - lastMs) / 1000;
      if (diff < cooldownSeconds) {
        throw new Error(`Cooldown: wait ${Math.ceil(cooldownSeconds - diff)}s`);
      }
    }

    // 3) Insert claim
    d.prepare(
      `INSERT INTO reward_claims (uid, type, nonce, amount, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
    ).run(uid, type, nonce, Math.trunc(amount));

    // 4) Apply coins
    addCoins(uid, amount);

    return { ok: true, already: false, user: getUserByUid(uid) };
  });

  return tx();
}

/**
 * Daily login +5 coins once per day (UTC).
 * nonce is deterministic => only once/day.
 */
export function claimDailyLogin(uid: string, dayKey?: string) {
  const key = dayKey || getDayKeyUTC(); // e.g. "2025-12-27"
  const nonce = `daily:${uid}:${key}`;
  return claimReward({
    uid,
    type: "daily_login",
    nonce,
    amount: 5,
    cooldownSeconds: 0,
  });
}

/**
 * Level complete +1 coin, only once per uid+level.
 */
export function claimLevelComplete(uid: string, level: number) {
  const d = getDB();
  const user = getUserByUid(uid);
  if (!user) throw new Error("User not found");

  const lvl = Math.max(1, Math.trunc(level || 1));

  const tx = d.transaction(() => {
    const already = d
      .prepare(`SELECT 1 FROM level_rewards WHERE uid = ? AND level = ? LIMIT 1`)
      .get(uid, lvl) as any;

    if (already) {
      return { ok: true, already: true, user: getUserByUid(uid) };
    }

    d.prepare(
      `INSERT INTO level_rewards (uid, level, created_at)
       VALUES (?, ?, datetime('now'))`
    ).run(uid, lvl);

    addCoins(uid, 1);

    return { ok: true, already: false, user: getUserByUid(uid) };
  });

  return tx();
}

/* =========================
   ✅ SKIP / HINT (3 free lifetime then -50)
   ========================= */

export function useSkip(uid: string) {
  const d = getDB();
  const user = getUserByUid(uid);
  if (!user) throw new Error("User not found");

  const used = Number(user.free_skips_used || 0);

  if (used < FREE_SKIPS) {
    d.prepare(
      `UPDATE users
       SET free_skips_used = free_skips_used + 1,
           updated_at = datetime('now')
       WHERE uid = ?`
    ).run(uid);

    return {
      ok: true,
      mode: "free",
      freeLeft: FREE_SKIPS - (used + 1),
      user: getUserByUid(uid),
    };
  }

  if ((user.coins || 0) < 50) {
    throw new Error("Not enough coins for skip (need 50) or watch an ad.");
  }

  addCoins(uid, -50);

  return {
    ok: true,
    mode: "coins",
    freeLeft: 0,
    user: getUserByUid(uid),
  };
}

export function useHint(uid: string) {
  const d = getDB();
  const user = getUserByUid(uid);
  if (!user) throw new Error("User not found");

  const used = Number(user.free_hints_used || 0);

  if (used < FREE_HINTS) {
    d.prepare(
      `UPDATE users
       SET free_hints_used = free_hints_used + 1,
           updated_at = datetime('now')
       WHERE uid = ?`
    ).run(uid);

    return {
      ok: true,
      mode: "free",
      freeLeft: FREE_HINTS - (used + 1),
      user: getUserByUid(uid),
    };
  }

  if ((user.coins || 0) < 50) {
    throw new Error("Not enough coins for hint (need 50) or watch an ad.");
  }

  addCoins(uid, -50);

  return {
    ok: true,
    mode: "coins",
    freeLeft: 0,
    user: getUserByUid(uid),
  };
}

/* =========================
   ✅ MONTHLY PAYOUT HELPERS (for later Pi conversion)
   ========================= */

export function getCurrentMonthKeyUTC() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function createMonthlyPayout(uid: string, month = getCurrentMonthKeyUTC(), piAmount = 0) {
  const d = getDB();
  const user = getUserByUid(uid);
  if (!user) throw new Error("User not found");

  const coins = Number(user.coins || 0);

  const stmt = d.prepare(`
    INSERT INTO monthly_payouts (uid, month, coins, pi_amount, status, created_at, updated_at)
    VALUES (@uid, @month, @coins, @pi_amount, 'created', datetime('now'), datetime('now'))
    ON CONFLICT(uid, month) DO NOTHING
  `);

  stmt.run({ uid, month, coins, pi_amount: piAmount });

  return d
    .prepare(`SELECT * FROM monthly_payouts WHERE uid = ? AND month = ? LIMIT 1`)
    .get(uid, month) as any;
}

/**
 * After payout is confirmed SENT, reset coins to 0 (current month from 0).
 */
export function resetUserCoinsAfterPayout(uid: string, month = getCurrentMonthKeyUTC()) {
  const d = getDB();
  d.prepare(
    `UPDATE users
     SET coins = 0,
         last_payout_month = ?,
         updated_at = datetime('now')
     WHERE uid = ?`
  ).run(month, uid);

  return getUserByUid(uid);
}

/* =========================
   ✅ MIGRATION HELPERS
   ========================= */

function ensureUserColumns() {
  const d = getDB();
  const cols = d.prepare(`PRAGMA table_info(users)`).all() as any[];
  const has = (name: string) => cols.some((c) => c.name === name);

  if (!has("free_skips_used")) {
    d.exec(`ALTER TABLE users ADD COLUMN free_skips_used INTEGER NOT NULL DEFAULT 0;`);
  }

  if (!has("free_hints_used")) {
    d.exec(`ALTER TABLE users ADD COLUMN free_hints_used INTEGER NOT NULL DEFAULT 0;`);
  }

  if (!has("last_payout_month")) {
    d.exec(`ALTER TABLE users ADD COLUMN last_payout_month TEXT;`);
  }
}

function hasTable(name: string) {
  const d = getDB();
  const row = d
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(name);
  return !!row;
}

function hasColumn(table: string, col: string) {
  const d = getDB();
  const cols = d.prepare(`PRAGMA table_info(${table})`).all() as any[];
  return cols.some((c) => c.name === col);
}

function migrateLegacyProgress() {
  const d = getDB();

  if (!hasTable("progress")) return;
  if (hasColumn("progress", "uid")) return;

  d.exec(`ALTER TABLE progress RENAME TO progress_legacy;`);

  d.exec(`
    CREATE TABLE IF NOT EXISTS progress (
      uid TEXT PRIMARY KEY,
      level INTEGER NOT NULL DEFAULT 1,
      coins INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  d.exec(`CREATE INDEX IF NOT EXISTS idx_progress_uid ON progress(uid);`);

  const legacyRows = d
    .prepare(`SELECT username, level, coins, updated_at FROM progress_legacy`)
    .all() as any[];

  const insert = d.prepare(`
    INSERT INTO progress (uid, level, coins, updated_at)
    VALUES (@uid, @level, @coins, COALESCE(@updated_at, datetime('now')))
    ON CONFLICT(uid) DO UPDATE SET
      level = excluded.level,
      coins = excluded.coins,
      updated_at = excluded.updated_at
  `);

  const findUidByUsername = d.prepare(
    `SELECT uid FROM users WHERE username = ? LIMIT 1`
  );

  const tx = d.transaction(() => {
    for (const r of legacyRows) {
      const username = String(r.username || "");
      let uid = username;

      const mapped = findUidByUsername.get(username) as any;
      if (mapped?.uid) uid = mapped.uid;

      insert.run({
        uid,
        level: Math.max(1, Math.trunc(r.level || 1)),
        coins: Math.max(0, Math.trunc(r.coins || 0)),
        updated_at: r.updated_at,
      });
    }
  });

  tx();
}

function getDayKeyUTC() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
