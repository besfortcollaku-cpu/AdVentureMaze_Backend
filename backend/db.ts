import Database from "better-sqlite3";

export const db = new Database("pimaze.sqlite");

db.exec(`
CREATE TABLE IF NOT EXISTS progress (
  username TEXT PRIMARY KEY,
  max_level INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inviter TEXT NOT NULL,
  invitee TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  rewarded_at TEXT,
  UNIQUE(invitee)
);
`);