
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import Database from "better-sqlite3";

const app = express();
app.use(cors());
app.use(express.json());

const db = new Database("pimaze.sqlite");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE,
  username TEXT UNIQUE,
  coins INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS progress (
  uid TEXT PRIMARY KEY,
  level INTEGER DEFAULT 1,
  coins INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);
`);

function getUserByUid(uid) {
  return db.prepare("SELECT * FROM users WHERE uid=?").get(uid);
}

function upsertUser(uid, username) {
  db.prepare(`
    INSERT INTO users (uid, username)
    VALUES (?, ?)
    ON CONFLICT(uid) DO UPDATE SET username=excluded.username
  `).run(uid, username);

  return getUserByUid(uid);
}

app.post("/api/pi/verify", async (req, res) => {
  try {
    const auth = req.headers.authorization || "";
    const accessToken = auth.replace("Bearer ", "");

    if (!accessToken) {
      return res.status(401).json({ ok: false, error: "Missing access token" });
    }

    const piRes = await fetch("https://api.minepi.com/v2/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!piRes.ok) {
      return res.status(401).json({ ok: false, error: "Pi token invalid" });
    }

    const piUser = await piRes.json();
    const user = upsertUser(piUser.uid, piUser.username);

    res.json({ ok: true, user });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/me", (req, res) => {
  const user = db.prepare("SELECT * FROM users ORDER BY id DESC LIMIT 1").get();
  const progress = user
    ? db.prepare("SELECT * FROM progress WHERE uid=?").get(user.uid)
    : null;

  res.json({ ok: true, user, progress });
});

const PORT = process.env.PORT || 5050;
app.listen(PORT, () => console.log("Backend running on", PORT));
