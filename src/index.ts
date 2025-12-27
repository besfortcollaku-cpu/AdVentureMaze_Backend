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

  // ✅ rewards / utility
  claimReward,
  claimDailyLogin,
  claimLevelComplete,
  useSkip,
  useHint,
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
// - ✅ Auto-claims DAILY LOGIN (+5) once per day
// - Returns user + progress
// =======================================================

app.get("/api/me", async (req, res) => {
  try {
    const { uid, username } = await requirePiUser(req);

    // Create/update user
    let user = upsertUser({ uid, username });

    // ✅ Daily login (+5) once per UTC day (idempotent via nonce)
    try {
      const out = claimDailyLogin(uid);
      if (out?.ok && out?.user) user = out.user;
    } catch {
      // ignore (already claimed or other minor error)
    }

    // Load progress (default if none)
    const p = getProgressByUid(uid);

    // ✅ Coins source of truth is users.coins (progress.coins can drift; don't return it)
    const progress = p
      ? { uid, level: p.level, updated_at: p.updated_at }
      : { uid, level: 1, updated_at: null };

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
//
// All reward endpoints require Authorization: Bearer <Pi accessToken>
// We always resolve uid by verifying token with Pi (source of truth).
//

// (Optional) explicit daily login claim (you can call /api/me and it auto-claims)
app.post("/api/rewards/daily-login", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);
    const out = claimDailyLogin(uid);
    return res.json({
      ok: true,
      already: !!out?.already,
      user: out?.user,
    });
  } catch (e: any) {
    return res.status(401).json({ ok: false, error: e?.message || String(e) });
  }
});

// Level complete +1 coin (idempotent per uid+level)
app.post("/api/rewards/level-complete", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);

    const level = Number(req.body?.level || 0);
    if (!level) {
      return res.status(400).json({ ok: false, error: "level required" });
    }

    const out = claimLevelComplete(uid, level);
    return res.json({ ok: true, already: !!out?.already, user: out?.user });
  } catch (e: any) {
    const msg = e?.message || String(e);
    // auth-ish errors -> 401, otherwise 500
    const lower = String(msg).toLowerCase();
    const code =
      lower.includes("bearer") || lower.includes("token") || lower.includes("unauthorized")
        ? 401
        : 500;

    return res.status(code).json({ ok: false, error: msg });
  }
});

// Watch ad voluntarily +50 (idempotent via nonce)
app.post("/api/rewards/ad-50", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);
    const nonce = String(req.body?.nonce || "").trim();
    if (!nonce) {
      return res.status(400).json({ ok: false, error: "nonce required" });
    }

    const out = claimReward({
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

// Skip: 3 free lifetime, then -50 coins (server enforced)
// If you want "watch ad to skip", call /api/rewards/skip-ad with nonce.
app.post("/api/skip", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);
    const out = useSkip(uid);
    return res.json(out);
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || String(e) });
  }
});

// Hint: 3 free lifetime, then -50 coins (server enforced)
// If you want "watch ad to hint", call /api/rewards/hint-ad with nonce.
app.post("/api/hint", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);
    const out = useHint(uid);
    return res.json(out);
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || String(e) });
  }
});

// Optional: watch-ad alternatives (no coin cost). We still store an idempotent claim to prevent spam.
app.post("/api/rewards/skip-ad", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);
    const nonce = String(req.body?.nonce || "").trim();
    if (!nonce) {
      return res.status(400).json({ ok: false, error: "nonce required" });
    }

    const out = claimReward({
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
    if (!nonce) {
      return res.status(400).json({ ok: false, error: "nonce required" });
    }

    const out = claimReward({
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
// ✅ USERS
// =======================================================

app.get("/api/users/by-uid", (req, res) => {
  const uid = String(req.query.uid || "").trim();
  if (!uid) return res.status(400).json({ ok: false, error: "uid required" });

  const user = getUserByUid(uid);
  if (!user) return res.status(404).json({ ok: false, error: "not found" });

  return res.json({ ok: true, user });
});

// ✅ coin add/subtract by uid (AUTH REQUIRED + ONLY SELF)
// NOTE: keep for debug if you want, but this prevents anyone modifying other users.
app.post("/api/users/coins", async (req, res) => {
  try {
    const { uid: authedUid } = await requirePiUser(req);

    const { uid, delta } = req.body || {};
    if (!uid) return res.status(400).json({ ok: false, error: "uid required" });

    if (String(uid) !== String(authedUid)) {
      return res.status(403).json({ ok: false, error: "forbidden" });
    }

    const updated = addCoins(String(uid), Number(delta || 0));
    return res.json({ ok: true, user: updated });
  } catch (e: any) {
    return res.status(401).json({ ok: false, error: e?.message || String(e) });
  }
});

// =======================================================
// ✅ PROGRESS (UID ONLY)
// =======================================================
//
// GET  /progress?uid=...
// POST /progress { uid, level, coins }
//
// NOTE: coins here is legacy; prefer users.coins. Keep endpoint for compatibility.
//

app.get("/progress", (req, res) => {
  const uid = String(req.query.uid || "").trim();
  if (!uid) return res.status(400).json({ ok: false, error: "uid required" });

  const row = getProgressByUid(uid);

  const data = row
    ? { uid, level: row.level, coins: row.coins }
    : { uid, level: 1, coins: 0 };

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
