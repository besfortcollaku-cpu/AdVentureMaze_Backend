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

const corsOptions: cors.CorsOptions = {
  origin: "*", // you can restrict later
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "x-admin-secret",
  ],
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
    throw new Error(`Invalid Pi token (${piRes.status})`);
  }

  return piRes.json(); // { uid, username }
}

async function requirePiUser(req: express.Request) {
  const token = getBearerToken(req);
  if (!token) throw new Error("Missing Authorization Bearer token");

  const piUser = await verifyPiAccessToken(token);

  if (!piUser?.uid || !piUser?.username) {
    throw new Error("Pi user missing uid/username");
  }

  return {
    uid: String(piUser.uid),
    username: String(piUser.username),
    accessToken: token,
  };
}

// =======================================================
// ADMIN AUTH
// =======================================================

function requireAdmin(req: express.Request) {
  const secret = String(req.headers["x-admin-secret"] || "");
  const expected = String(process.env.ADMIN_SECRET || "");

  if (!expected) throw new Error("ADMIN_SECRET not configured");
  if (secret !== expected) throw new Error("Unauthorized (admin)");
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

    const piUser = await verifyPiAccessToken(token);

    const user = await upsertUser({
      uid: String(piUser.uid),
      username: String(piUser.username),
    });

    res.json({ ok: true, user });
  } catch (e: any) {
    res.status(401).json({ ok: false, error: e.message });
  }
}

app.post("/api/pi/verify", handlePiVerify);
app.post("/auth/pi/verify", handlePiVerify);

// =======================================================
// /api/me
// =======================================================

app.get("/api/me", async (req, res) => {
  try {
    const { uid, username } = await requirePiUser(req);

    let user = await upsertUser({ uid, username });

    try {
      const out = await claimDailyLogin(uid);
      if (out?.user) user = out.user;
    } catch {}

    const p = await getProgressByUid(uid);

    res.json({
      ok: true,
      user,
      progress: p ?? { uid, level: 1, coins: 0 },
    });
  } catch (e: any) {
    res.status(401).json({ ok: false, error: e.message });
  }
});

// =======================================================
// ADMIN API
// =======================================================

app.get("/admin/stats", async (req, res) => {
  try {
    requireAdmin(req);
    const minutes = Number(req.query.minutes || 5);
    const data = await adminGetStats({ onlineMinutes: minutes });
    res.json({ ok: true, data });
  } catch (e: any) {
    res.status(401).json({ ok: false, error: e.message });
  }
});

app.get("/admin/users", async (req, res) => {
  try {
    requireAdmin(req);
    const out = await adminListUsers({
      search: String(req.query.search || ""),
      limit: Number(req.query.limit || 50),
      offset: Number(req.query.offset || 0),
      order: String(req.query.order || "updated_at_desc") as any,
    });
    res.json({ ok: true, ...out });
  } catch (e: any) {
    res.status(401).json({ ok: false, error: e.message });
  }
});

app.get("/admin/online", async (req, res) => {
  try {
    requireAdmin(req);
    const out = await adminListOnlineUsers({
      minutes: Number(req.query.minutes || 5),
      limit: Number(req.query.limit || 50),
      offset: Number(req.query.offset || 0),
    });
    res.json({ ok: true, ...out });
  } catch (e: any) {
    res.status(401).json({ ok: false, error: e.message });
  }
});

// ---------------------------
// Start
// ---------------------------
async function main() {
  await initDB();
  const PORT = Number(process.env.PORT) || 3001;
  app.listen(PORT, "0.0.0.0", () =>
    console.log("Backend running on", PORT)
  );
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});