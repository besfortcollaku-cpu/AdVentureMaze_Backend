// src/index.ts
import "dotenv/config";

import express from "express";
import cors from "cors";

import {
  initDB,
  upsertUser,
  getUserByUid,
  addCoins,
  getProgressByUid,
  setProgressByUid,
} from "./db";

// ---------------------------
// App + middleware
// ---------------------------
const app = express();

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

// init sqlite ONCE
initDB();

// ---------------------------
// Health
// ---------------------------
app.get("/health", (_req, res) => res.status(200).send("ok"));
app.get("/", (_req, res) => res.send("backend up"));

// =======================================================
// Helpers: auth token extraction + Pi verify
// =======================================================

function getBearerToken(req: express.Request) {
  const headerToken = String(req.headers.authorization || "").replace(
    /^Bearer\s+/i,
    ""
  );
  return headerToken || "";
}

async function verifyPiAccessToken(accessToken: string) {
  // Node 18+ has global fetch. If you run older Node, upgrade or polyfill.
  const piRes = await fetch("https://api.minepi.com/v2/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!piRes.ok) {
    const txt = await piRes.text().catch(() => "");
    throw new Error(
      `Invalid Pi token (${piRes.status}): ${txt || "unauthorized"}`
    );
  }

  const piUser: any = await piRes.json();
  return piUser; // expected { uid, username, ... }
}

async function requirePiUser(req: express.Request) {
  const token = getBearerToken(req);
  if (!token) throw new Error("Missing Authorization Bearer token");

  const piUser = await verifyPiAccessToken(token);

  const uid = piUser?.uid;
  const username = piUser?.username;

  if (!uid || !username) {
    throw new Error("Pi user missing uid/username");
  }

  return { uid: String(uid), username: String(username), accessToken: token };
}

// =======================================================
// ✅ PI VERIFY (single source of truth)
// =======================================================

async function handlePiVerify(req: express.Request, res: express.Response) {
  try {
    const bodyToken = req.body?.accessToken;
    const headerToken = getBearerToken(req);

    const accessToken = bodyToken || headerToken;
    if (!accessToken) {
      return res.status(400).json({ ok: false, error: "accessToken missing" });
    }

    const piUser = await verifyPiAccessToken(accessToken);

    const uid = piUser?.uid;
    const username = piUser?.username;

    if (!uid || !username) {
      return res
        .status(401)
        .json({ ok: false, error: "Pi user missing uid/username" });
    }

    const user = upsertUser({ uid: String(uid), username: String(username) });

    return res.json({ ok: true, user });
  } catch (e: any) {
    return res.status(401).json({ ok: false, error: e?.message || String(e) });
  }
}

// Support both paths (frontend may call either)
app.post("/api/pi/verify", handlePiVerify);
app.post("/auth/pi/verify", handlePiVerify);

// =======================================================
// ✅ /api/me
// - Requires Authorization: Bearer <Pi accessToken>
// - Verifies token with Pi
// - Upserts user
// - Returns user + progress
// =======================================================

app.get("/api/me", async (req, res) => {
  try {
    const { uid, username } = await requirePiUser(req);

    // Create/update user
    const user = upsertUser({ uid, username });

    // Load progress (default if none)
    const p = getProgressByUid(uid);
    const progress = p
      ? { uid, level: p.level, coins: p.coins, updated_at: p.updated_at }
      : { uid, level: 1, coins: 0, updated_at: null };

    return res.json({
      ok: true,
      user: {
        uid: user?.uid,
        username: user?.username,
        coins: user?.coins ?? 0,
      },
      progress,
    });
  } catch (e: any) {
    return res.status(401).json({ ok: false, error: e?.message || String(e) });
  }
});

// =======================================================
// ✅ USERS
// =======================================================

app.get("/api/users/by-uid", (req, res) => {
  const uid = String(req.query.uid || "").trim();
  if (!uid) return res.status(400).json({ ok: false, error: "uid required" });

  const user = getUserByUid(uid);
  if (!user) return res.status(404).json({ ok: false, error: "not found" });

  return res.json({ ok: true, user });
});

app.post("/api/users/coins", (req, res) => {
  try {
    const { uid, delta } = req.body || {};
    if (!uid) return res.status(400).json({ ok: false, error: "uid required" });

    const updated = addCoins(String(uid), Number(delta || 0));
    return res.json({ ok: true, user: updated });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// =======================================================
// ✅ PROGRESS (UID ONLY)
// =======================================================
//
// GET  /progress?uid=...
// POST /progress { uid, level, coins }
//

app.get("/progress", (req, res) => {
  const uid = String(req.query.uid || "").trim();
  if (!uid) return res.status(400).json({ ok: false, error: "uid required" });

  const row = getProgressByUid(uid);

  const data = row ? { uid, level: row.level, coins: row.coins } : { uid, level: 1, coins: 0 };

  return res.json({ ok: true, data });
});

app.post("/progress", (req, res) => {
  const { uid, level, coins } = req.body || {};
  if (!uid) return res.status(400).json({ ok: false, error: "uid required" });

  setProgressByUid({
    uid: String(uid),
    level: Number(level || 1),
    coins: Number(coins || 0),
  });

  return res.json({ ok: true });
});

// ---------------------------
const PORT = Number(process.env.PORT) || 3001;
app.listen(PORT, "0.0.0.0", () => console.log("Backend running on", PORT));
