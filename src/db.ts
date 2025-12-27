// src/db.ts
import Database from "better-sqlite3";

let db: Database.Database | null = null;

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
  // ✅ REWARD CLAIMS
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
  // ✅ PAYMENTS
  // ---------------------------
  db.exec(`
    CREATE TABLE IF NOT EXISTS payments (
      payment_id TEXT PRIMARY KEY,
      uid TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'created',
      txid TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_payments_uid ON payments(uid);
  `);

  // ---------------------------
  // ✅ MIGRATION
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
        created_at: string;
        updated_at: string;
      }
    | undefined;
}

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
   ✅ REWARDS
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
    const existing = d
      .prepare(`SELECT id FROM reward_claims WHERE nonce = ? LIMIT 1`)
      .get(nonce) as any;

    if (existing?.id) {
      return { ok: true, already: true, user: getUserByUid(uid) };
    }

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

    d.prepare(
      `INSERT INTO reward_claims (uid, type, nonce, amount, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
    ).run(uid, type, nonce, Math.trunc(amount));

    addCoins(uid, amount);

    return { ok: true, already: false, user: getUserByUid(uid) };
  });

  return tx();
}

/* =========================
   ✅ PAYMENTS
   ========================= */

export function upsertPaymentOwner({
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
  const d = getDB();

  const stmt = d.prepare(`
    INSERT INTO payments (payment_id, uid, status, txid, updated_at, created_at)
    VALUES (@payment_id, @uid, COALESCE(@status, 'created'), @txid, datetime('now'), datetime('now'))
    ON CONFLICT(payment_id) DO UPDATE SET
      uid = excluded.uid,
      status = COALESCE(excluded.status, payments.status),
      txid = COALESCE(excluded.txid, payments.txid),
      updated_at = datetime('now')
  `);

  stmt.run({
    payment_id: paymentId,
    uid,
    status: status || null,
    txid: txid ?? null,
  });

  return getPayment(paymentId);
}

export function getPayment(paymentId: string) {
  const d = getDB();
  return d
    .prepare(`SELECT * FROM payments WHERE payment_id = ? LIMIT 1`)
    .get(paymentId) as
    | {
        payment_id: string;
        uid: string;
        status: string;
        txid?: string | null;
        created_at: string;
        updated_at: string;
      }
    | undefined;
}

export function assertPaymentOwnedBy(paymentId: string, uid: string) {
  const p = getPayment(paymentId);
  if (!p) throw new Error("Unknown paymentId");
  if (p.uid !== uid) throw new Error("Payment does not belong to this user");
  return p;
}

export function setPaymentStatus(paymentId: string, status: string, txid?: string | null) {
  const d = getDB();
  d.prepare(
    `UPDATE payments
     SET status = ?, txid = COALESCE(?, txid), updated_at = datetime('now')
     WHERE payment_id = ?`
  ).run(status, txid ?? null, paymentId);

  return getPayment(paymentId);
}

/* =========================
   MIGRATION
   ========================= */

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
