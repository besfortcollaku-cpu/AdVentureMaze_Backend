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

  // rewards / utility
  claimReward,
  claimDailyLogin,
  claimLevelComplete,
  useSkip,
  useHint,

  // admin / sessions
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

/**
 * ✅ CORS (fix preflight + allow custom header x-admin-secret)
 * NOTE: For security, you should later replace "*" with your domains:
 * - https://adventuremaze1.pages.dev
 * - https://adm-341.pages.dev
 */
const corsOptions: cors.CorsOptions = {
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-admin-secret"],
  credentials: false,
  maxAge: 86400,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // ✅ IMPORTANT FOR PREFLIGHT
app.use(express.json());

// ---------------------------
// Health
// ---------------------------
app.get("/health", (_req, res) => res.status(200).send("ok"));
app.get("/", (_req, res) => res.send("backend up"));

// =======================================================
// Helpers
// =======================================================

function getBearerToken(req: express.Request) {
  return String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
}

async function verifyPiAccessToken(accessToken: string) {
  const piRes = await fetch("https://api.minepi.com/v2/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!piRes.ok) {
    const txt = await piRes.text().catch(() => "");
    throw new Error(`Invalid Pi token (${piRes.status}): ${txt || "unauthorized"}`);
  }

  return piRes.json(); // { uid, username }
}

async function requirePiUser(req: express.Request) {
  const token = getBearerToken(req);
  if (!token) throw new Error("Missing Authorization Bearer token");

  const piUser: any = await verifyPiAccessToken(token);

  if (!piUser?.uid || !piUser?.username) {
    throw new Error("Pi user missing uid/username");
  }

  return {
    uid: String(piUser.uid),
    username: String(piUser.username),
    accessToken: token,
  };
}

function asInt(v: any, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

// =======================================================
// ADMIN AUTH
// =======================================================

function requireAdmin(req: express.Request) {
  const secret = String(req.headers["x-admin-secret"] || "");
  const expected = String(process.env.ADMIN_SECRET || "");

  if (!expected) throw new Error("ADMIN_SECRET not configured");
  if (!secret || secret !== expected) throw new Error("Unauthorized (admin)");
}

// =======================================================
// PI VERIFY
// =======================================================

async function handlePiVerify(req: express.Request, res: express.Response) {
  try {
    const token = req.body?.accessToken || getBearerToken(req);
    if (!token) {
      return res.status(400).json({ ok: false, error: "accessToken missing" });
    }

    const piUser: any = await verifyPiAccessToken(token);

    const user = await upsertUser({
      uid: String(piUser.uid),
      username: String(piUser.username),
    });

    return res.json({ ok: true, user });
  } catch (e: any) {
    return res.status(401).json({ ok: false, error: e?.message || String(e) });
  }
}

app.post("/api/pi/verify", handlePiVerify);
app.post("/auth/pi/verify", handlePiVerify);

// =======================================================
// /api/me  (sync user + daily login + progress)
// =======================================================

app.get("/api/me", async (req, res) => {
  try {
    const { uid, username } = await requirePiUser(req);

    // upsert user
    let user = await upsertUser({ uid, username });

    // daily login (+5 once/day)
    try {
      const out = await claimDailyLogin(uid);
      if (out?.user) user = out.user;
    } catch {
      // ignore
    }

    const p = await getProgressByUid(uid);

    return res.json({
      ok: true,
      user: {
        uid: user.uid,
        username: user.username,
        coins: user.coins ?? 0,
        free_skips_used: user.free_skips_used ?? 0,
        free_hints_used: user.free_hints_used ?? 0,
        last_payout_month: user.last_payout_month ?? null,
      },
      progress:
        p ?? {
          uid,
          level: 1,
          coins: 0,
          updated_at: null,
        },
    });
  } catch (e: any) {
    return res.status(401).json({ ok: false, error: e?.message || String(e) });
  }
});

// =======================================================
// ✅ REWARDS API (FIXES 404)
// =======================================================

app.post("/api/rewards/ad-50", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);
    const nonce = String(req.body?.nonce || "").trim();
    if (!nonce) return res.status(400).json({ ok: false, error: "nonce required" });

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

app.post("/api/rewards/level-complete", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);
    const level = asInt(req.body?.level, 0);
    if (!level) return res.status(400).json({ ok: false, error: "level required" });

    const out = await claimLevelComplete(uid, level);
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

app.post("/api/rewards/daily-login", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);
    const out = await claimDailyLogin(uid);
    return res.json({ ok: true, already: !!out?.already, user: out?.user });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || String(e) });
  }
});

// =======================================================
// ✅ PROGRESS (frontend uses POST /progress)
// =======================================================

app.get("/progress", async (req, res) => {
  try {
    const uid = String(req.query.uid || "").trim();
    if (!uid) return res.status(400).json({ ok: false, error: "uid required" });

    const row = await getProgressByUid(uid);
    const data = row ? { uid, level: row.level, coins: row.coins } : { uid, level: 1, coins: 0 };
    return res.json({ ok: true, data });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.post("/progress", async (req, res) => {
  try {
    await requirePiUser(req);

    const { uid, level, coins } = req.body || {};
    if (!uid) return res.status(400).json({ ok: false, error: "uid required" });

    await setProgressByUid({
      uid: String(uid),
      level: asInt(level, 1),
      coins: Math.max(0, asInt(coins, 0)),
    });

    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || String(e) });
  }
});

// =======================================================
// (Optional) Users helper endpoints
// =======================================================

app.get("/api/users/by-uid", async (req, res) => {
  try {
    const uid = String(req.query.uid || "").trim();
    if (!uid) return res.status(400).json({ ok: false, error: "uid required" });

    const user = await getUserByUid(uid);
    if (!user) return res.status(404).json({ ok: false, error: "not found" });

    return res.json({ ok: true, user });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.post("/api/users/coins", async (req, res) => {
  try {
    requireAdmin(req);

    const { uid, delta } = req.body || {};
    if (!uid) return res.status(400).json({ ok: false, error: "uid required" });

    const updated = await addCoins(String(uid), asInt(delta, 0));
    return res.json({ ok: true, user: updated });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || String(e) });
  }
});

// =======================================================
// ✅ SESSIONS
// =======================================================

app.post("/api/session/start", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);
    const sessionId = String(req.body?.sessionId || "").trim();
    if (!sessionId) return res.status(400).json({ ok: false, error: "sessionId required" });

    const userAgent = String(req.headers["user-agent"] || "");
    const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "");

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
    if (!sessionId) return res.status(400).json({ ok: false, error: "sessionId required" });

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
    if (!sessionId) return res.status(400).json({ ok: false, error: "sessionId required" });

    const row = await endSession(uid, sessionId);
    return res.json({ ok: true, session: row });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || String(e) });
  }
});

// =======================================================
// ✅ ADMIN API
// =======================================================

app.get("/admin/stats", async (req, res) => {
  try {
    requireAdmin(req);
    const minutes = asInt(req.query.minutes, 5);
    const data = await adminGetStats({ onlineMinutes: minutes });
    return res.json({ ok: true, data });
  } catch (e: any) {
    return res.status(401).json({ ok: false, error: e?.message || String(e) });
  }
});

app.get("/admin/users", async (req, res) => {
  try {
    requireAdmin(req);
    const out = await adminListUsers({
      search: String(req.query.search || ""),
      limit: asInt(req.query.limit, 50),
      offset: asInt(req.query.offset, 0),
      order: String(req.query.order || "updated_at_desc") as any,
    });
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

/**
 * ✅ NEW: Admin coins add/sub (used by Admin UI)
 * POST /admin/users/:uid/coins/add  { delta }
 */
app.post("/admin/users/:uid/coins/add", async (req, res) => {
  try {
    requireAdmin(req);
    const uid = String(req.params.uid || "").trim();
    if (!uid) return res.status(400).json({ ok: false, error: "uid required" });

    const delta = asInt(req.body?.delta, 0);
    if (delta === 0) return res.status(400).json({ ok: false, error: "delta required" });

    const updated = await addCoins(uid, delta);
    return res.json({ ok: true, user: updated });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || String(e) });
  }
});

/**
 * ✅ NEW: Admin set coins exact (used by Admin UI)
 * POST /admin/users/:uid/coins/set  { coins }
 */
app.post("/admin/users/:uid/coins/set", async (req, res) => {
  try {
    requireAdmin(req);
    const uid = String(req.params.uid || "").trim();
    if (!uid) return res.status(400).json({ ok: false, error: "uid required" });

    const coins = asInt(req.body?.coins, -1);
    if (coins < 0) return res.status(400).json({ ok: false, error: "coins must be >= 0" });

    const user = await getUserByUid(uid);
    if (!user) return res.status(404).json({ ok: false, error: "user not found" });

    const delta = coins - asInt(user.coins, 0);
    const updated = await addCoins(uid, delta);
    return res.json({ ok: true, user: updated });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || String(e) });
  }
});

/**
 * ✅ NEW: Admin reset coins to 0 (used by Admin UI)
 * POST /admin/users/:uid/coins/reset  {}
 */
app.post("/admin/users/:uid/coins/reset", async (req, res) => {
  try {
    requireAdmin(req);
    const uid = String(req.params.uid || "").trim();
    if (!uid) return res.status(400).json({ ok: false, error: "uid required" });

    const user = await getUserByUid(uid);
    if (!user) return res.status(404).json({ ok: false, error: "user not found" });

    const delta = 0 - asInt(user.coins, 0);
    const updated = await addCoins(uid, delta);
    return res.json({ ok: true, user: updated });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || String(e) });
  }
});

/**
 * ✅ NEW: Reset free skips/hints counters (used by Admin UI)
 * POST /admin/users/:uid/reset-free  {}
 *
 * This requires a helper in db.ts.
 * If you don't have it, add it (I show you below).
 */
app.post("/admin/users/:uid/reset-free", async (req, res) => {
  try {
    requireAdmin(req);
    const uid = String(req.params.uid || "").trim();
    if (!uid) return res.status(400).json({ ok: false, error: "uid required" });

    // --- IMPORTANT ---
    // Your db.ts currently does NOT export a function for this.
    // We'll do it safely here using addCoins? No: we need an UPDATE query.
    // So: call a small inline SQL via a new db helper.
    // If you prefer, paste db.ts and I’ll add the helper there too.

    const p = await getUserByUid(uid);
    if (!p) return res.status(404).json({ ok: false, error: "user not found" });

    // Quick fallback: re-upsert username does not reset counters.
    // So we must return an error if helper not implemented.
    return res.status(500).json({
      ok: false,
      error:
        "reset-free endpoint needs DB helper. Add a db.ts function to reset free_skips_used/free_hints_used to 0.",
    });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || String(e) });
  }
});

app.get("/admin/online", async (req, res) => {
  try {
    requireAdmin(req);
    const out = await adminListOnlineUsers({
      minutes: asInt(req.query.minutes, 5),
      limit: asInt(req.query.limit, 50),
      offset: asInt(req.query.offset, 0),
    });
    return res.json({ ok: true, ...out });
  } catch (e: any) {
    return res.status(401).json({ ok: false, error: e?.message || String(e) });
  }
});

// ---------------------------
// Start
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