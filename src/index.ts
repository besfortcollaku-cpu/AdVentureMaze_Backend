// src/index.ts (Postgres-ready)
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

  // ✅ rewards / utility
  claimReward,
  claimDailyLogin,
  claimLevelComplete,
  useSkip,
  useHint,

  // ✅ admin / sessions
  startSession,
  pingSession,
  endSession,
  adminListUsers,
  adminGetUser,
  adminGetStats,
  adminListOnlineUsers,
} from "./db";

// ---------------------------
// App + middleware
// ---------------------------
const app = express();
app.use(
  cors({
    origin: "*", // later you can restrict to your admin domain
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-admin-secret"
    ],
  })
);

app.use(express.json());

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
// ✅ ADMIN auth (simple shared secret)
// - Send header: x-admin-secret: <ADMIN_SECRET>
// - Set env ADMIN_SECRET on Render
// =======================================================

function requireAdmin(req: express.Request) {
  const secret = String(req.headers["x-admin-secret"] || "");
  const expected = String(process.env.ADMIN_SECRET || "");
  if (!expected) throw new Error("ADMIN_SECRET not configured on server");
  if (!secret || secret !== expected) throw new Error("Unauthorized (admin)");
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

    const user = await upsertUser({
      uid: String(uid),
      username: String(username),
    });

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
// =======================================================

app.get("/api/me", async (req, res) => {
  try {
    const { uid, username } = await requirePiUser(req);

    // Create/update user
    let user = await upsertUser({ uid, username });

    // ✅ Daily login (+5) once per UTC day (idempotent via nonce)
    try {
      const out = await claimDailyLogin(uid);
      if (out?.ok && out?.user) user = out.user;
    } catch {
      // ignore
    }

    // Load progress (default if none)
    const p = await getProgressByUid(uid);
    const progress = p
      ? { uid, level: p.level, coins: p.coins, updated_at: p.updated_at }
      : { uid, level: 1, coins: 0, updated_at: null };

    return res.json({
      ok: true,
      user: {
        uid: user?.uid,
        username: user?.username,
        coins: user?.coins ?? 0,
        free_skips_used: user?.free_skips_used ?? 0,
        free_hints_used: user?.free_hints_used ?? 0,
        last_payout_month: user?.last_payout_month ?? null,
      },
      progress,
    });
  } catch (e: any) {
    return res.status(401).json({ ok: false, error: e?.message || String(e) });
  }
});

// =======================================================
// ✅ REWARDS API
// =======================================================

app.post("/api/rewards/daily-login", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);
    const out = await claimDailyLogin(uid);
    return res.json({
      ok: true,
      already: !!out?.already,
      user: out?.user,
    });
  } catch (e: any) {
    return res.status(401).json({ ok: false, error: e?.message || String(e) });
  }
});

app.post("/api/rewards/level-complete", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);
    const level = Number(req.body?.level || 0);
    if (!level)
      return res.status(400).json({ ok: false, error: "level required" });

    const out = await claimLevelComplete(uid, level);
    return res.json({ ok: true, already: !!out?.already, user: out?.user });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || String(e) });
  }
});

app.post("/api/rewards/ad-50", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);
    const nonce = String(req.body?.nonce || "").trim();
    if (!nonce)
      return res.status(400).json({ ok: false, error: "nonce required" });

    const out = await claimReward({
      uid,
      type: "ad_50",
      nonce,
      amount: 50,
      cooldownSeconds: 0,
    });

    return res.json({ ok: true, already: !!out?.already, user: out?.user });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || String(e) });
  }
});

app.post("/api/skip", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);
    const out = await useSkip(uid);
    return res.json(out);
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || String(e) });
  }
});

app.post("/api/hint", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);
    const out = await useHint(uid);
    return res.json(out);
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || String(e) });
  }
});

app.post("/api/rewards/skip-ad", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);
    const nonce = String(req.body?.nonce || "").trim();
    if (!nonce)
      return res.status(400).json({ ok: false, error: "nonce required" });

    const out = await claimReward({
      uid,
      type: "skip_ad",
      nonce,
      amount: 0,
      cooldownSeconds: 0,
    });

    return res.json({ ok: true, already: !!out?.already });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || String(e) });
  }
});

app.post("/api/rewards/hint-ad", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);
    const nonce = String(req.body?.nonce || "").trim();
    if (!nonce)
      return res.status(400).json({ ok: false, error: "nonce required" });

    const out = await claimReward({
      uid,
      type: "hint_ad",
      nonce,
      amount: 0,
      cooldownSeconds: 0,
    });

    return res.json({ ok: true, already: !!out?.already });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || String(e) });
  }
});

// =======================================================
// ✅ SESSIONS (client can call; used by admin online view)
// =======================================================

app.post("/api/session/start", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);
    const sessionId = String(req.body?.sessionId || "").trim();
    if (!sessionId)
      return res.status(400).json({ ok: false, error: "sessionId required" });

    const userAgent = String(req.headers["user-agent"] || "");
    const ip = String(
      req.headers["x-forwarded-for"] || req.socket.remoteAddress || ""
    );

    const row = await startSession({ uid, sessionId, userAgent, ip });
    return res.json({ ok: true, session: row });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || String(e) });
  }
});

app.post("/api/session/ping", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);
    const sessionId = String(req.body?.sessionId || "").trim();
    if (!sessionId)
      return res.status(400).json({ ok: false, error: "sessionId required" });

    const row = await pingSession(uid, sessionId);
    return res.json({ ok: true, session: row });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || String(e) });
  }
});

app.post("/api/session/end", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);
    const sessionId = String(req.body?.sessionId || "").trim();
    if (!sessionId)
      return res.status(400).json({ ok: false, error: "sessionId required" });

    const row = await endSession(uid, sessionId);
    return res.json({ ok: true, session: row });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || String(e) });
  }
});

// =======================================================
// ✅ ADMIN API (protected by x-admin-secret)
// =======================================================

app.get("/admin/stats", async (req, res) => {
  try {
    requireAdmin(req);
    const minutes = Number(req.query.minutes || 5);
    const out = await adminGetStats({ onlineMinutes: minutes });
    return res.json({ ok: true, data: out });
  } catch (e: any) {
    return res.status(401).json({ ok: false, error: e?.message || String(e) });
  }
});

app.get("/admin/users", async (req, res) => {
  try {
    requireAdmin(req);
    const search = String(req.query.search || "");
    const limit = Number(req.query.limit || 50);
    const offset = Number(req.query.offset || 0);
    const order = String(req.query.order || "updated_at_desc") as any;
    const out = await adminListUsers({ search, limit, offset, order });
    return res.json({ ok: true, ...out });
  } catch (e: any) {
    return res.status(401).json({ ok: false, error: e?.message || String(e) });
  }
});

app.get("/admin/users/:uid", async (req, res) => {
  try {
    requireAdmin(req);
    const uid = String(req.params.uid || "").trim();
    if (!uid) return res.status(400).json({ ok: false, error: "uid required" });

    const out = await adminGetUser(uid);
    if (!out) return res.status(404).json({ ok: false, error: "not found" });
    return res.json({ ok: true, data: out });
  } catch (e: any) {
    return res.status(401).json({ ok: false, error: e?.message || String(e) });
  }
});

app.get("/admin/online", async (req, res) => {
  try {
    requireAdmin(req);
    const minutes = Number(req.query.minutes || 5);
    const limit = Number(req.query.limit || 50);
    const offset = Number(req.query.offset || 0);
    const out = await adminListOnlineUsers({ minutes, limit, offset });
    return res.json({ ok: true, ...out });
  } catch (e: any) {
    return res.status(401).json({ ok: false, error: e?.message || String(e) });
  }
});

// =======================================================
// ✅ USERS
// =======================================================

app.get("/api/users/by-uid", async (req, res) => {
  const uid = String(req.query.uid || "").trim();
  if (!uid) return res.status(400).json({ ok: false, error: "uid required" });

  const user = await getUserByUid(uid);
  if (!user) return res.status(404).json({ ok: false, error: "not found" });

  return res.json({ ok: true, user });
});

app.post("/api/users/coins", async (req, res) => {
  try {
    const { uid, delta } = req.body || {};
    if (!uid) return res.status(400).json({ ok: false, error: "uid required" });

    const updated = await addCoins(String(uid), Number(delta || 0));
    return res.json({ ok: true, user: updated });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// =======================================================
// ✅ PROGRESS (UID ONLY)
// =======================================================

app.get("/progress", async (req, res) => {
  const uid = String(req.query.uid || "").trim();
  if (!uid) return res.status(400).json({ ok: false, error: "uid required" });

  const row = await getProgressByUid(uid);

  const data = row
    ? { uid, level: row.level, coins: row.coins }
    : { uid, level: 1, coins: 0 };

  return res.json({ ok: true, data });
});

app.post("/progress", async (req, res) => {
  const { uid, level, coins } = req.body || {};
  if (!uid) return res.status(400).json({ ok: false, error: "uid required" });

  await setProgressByUid({
    uid: String(uid),
    level: Number(level || 1),
    coins: Number(coins || 0),
  });

  return res.json({ ok: true });
});

// ---------------------------
// Start (ensure DB is ready first)
// ---------------------------
async function main() {
  await initDB();

  const PORT = Number(process.env.PORT) || 3001;
  app.listen(PORT, "0.0.0.0", () => console.log("Backend running on", PORT));
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
```0