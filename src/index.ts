import "dotenv/config";
import express from "express";
import cors from "cors";

import {
  initDB,
  upsertUser,
  getProgressByUid,
  setProgressByUid,
  claimReward,
  claimDailyLogin,
  claimLevelComplete,
  useSkip,
  useHint,
  startSession,
  pingSession,
  endSession,
  touchUserOnline,
  adminListUsers,
  adminGetUser,
  adminGetStats,
  adminListOnlineUsers,
  adminResetFreeCounters,
  adminChartCoins,
  adminChartActiveUsers,
} from "./db";

const app = express();

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-admin-secret"],
  })
);
app.use(express.json());

app.get("/health", (_req, res) => res.send("ok"));
app.get("/", (_req, res) => res.send("backend up"));

function getBearerToken(req: express.Request) {
  return String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
}

async function verifyPiAccessToken(token: string) {
  const r = await fetch("https://api.minepi.com/v2/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error("Invalid Pi token");
  return r.json();
}

async function requirePiUser(req: express.Request) {
  const token = getBearerToken(req);
  if (!token) throw new Error("Missing token");
  const pi: any = await verifyPiAccessToken(token);
  await upsertUser({ uid: pi.uid, username: pi.username });
  await touchUserOnline(pi.uid);
  return { uid: pi.uid };
}

function requireAdmin(req: express.Request) {
  if (req.headers["x-admin-secret"] !== process.env.ADMIN_SECRET)
    throw new Error("Unauthorized");
}

/* ================= API ================= */

app.post("/api/pi/verify", async (req, res) => {
  try {
    // frontend sends accessToken in body AND Authorization header
    const token =
      req.body?.accessToken ||
      String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");

    if (!token) throw new Error("Missing accessToken");

    const pi: any = await verifyPiAccessToken(token);

    // Create/update user in DB
    await upsertUser({ uid: pi.uid, username: pi.username });
    await touchUserOnline(pi.uid);

    res.json({
      ok: true,
      user: { uid: pi.uid, username: pi.username },
    });
  } catch (e: any) {
    res.status(401).json({ ok: false, error: e.message });
  }
});

app.get("/api/me", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);
    await claimDailyLogin(uid);
    const progress = await getProgressByUid(uid);
    res.json({ ok: true, progress });
  } catch (e: any) {
    res.status(401).json({ ok: false, error: e.message });
  }
});

app.post("/api/rewards/ad-50", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);
    const out = await claimReward({
      uid,
      type: "ad_50",
      nonce: req.body.nonce,
      amount: 50,
    });
    res.json({ ok: true, ...out });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post("/api/rewards/level-complete", async (req, res) => {
  const { uid } = await requirePiUser(req);
  res.json(await claimLevelComplete(uid, Number(req.body.level)));
});

app.post("/api/skip", async (req, res) => {
  const { uid } = await requirePiUser(req);
  res.json(await useSkip(uid));
});

app.post("/api/hint", async (req, res) => {
  const { uid } = await requirePiUser(req);
  res.json(await useHint(uid));
});

app.post("/api/session/start", async (req, res) => {
  const { uid } = await requirePiUser(req);
  res.json(
    await startSession({
      uid,
      sessionId: req.body.sessionId,
      userAgent: req.headers["user-agent"] || "",
      ip: String(req.socket.remoteAddress),
    })
  );
});

app.post("/api/session/ping", async (req, res) => {
  const { uid } = await requirePiUser(req);
  res.json(await pingSession(uid));
});

app.post("/api/session/end", async (req, res) => {
  const { uid } = await requirePiUser(req);
  res.json(await endSession(uid));
});

/* ================= ADMIN ================= */

app.get("/admin/users", async (req, res) => {
  try {
    requireAdmin(req);
    const out = await adminListUsers({
      search: String(req.query.search || ""),
      limit: 50,
      offset: Number(req.query.offset || 0),
    });
    res.json({ ok: true, ...out });
  } catch (e: any) {
    res.status(401).json({ ok: false, error: e.message });
  }
});

app.get("/admin/users/:uid", async (req, res) => {
  requireAdmin(req);
  res.json({ ok: true, data: await adminGetUser(req.params.uid) });
});

app.post("/admin/users/:uid/reset-free", async (req, res) => {
  requireAdmin(req);
  res.json({ ok: true, user: await adminResetFreeCounters(req.params.uid) });
});

app.get("/admin/stats", async (req, res) => {
  requireAdmin(req);
  res.json({
    ok: true,
    data: await adminGetStats({ onlineMinutes: 5 }),
  });
});

app.get("/admin/online", async (req, res) => {
  requireAdmin(req);
  res.json(await adminListOnlineUsers({ minutes: 5, limit: 50, offset: 0 }));
});

app.get("/admin/charts/coins", async (req, res) => {
  requireAdmin(req);
  res.json(await adminChartCoins({ days: 7 }));
});

app.get("/admin/charts/active-users", async (req, res) => {
  requireAdmin(req);
  res.json(await adminChartActiveUsers({ days: 7 }));
});

/* ================= START ================= */

(async () => {
  await initDB();
  app.listen(process.env.PORT || 3001, () =>
    console.log("Backend running")
  );
})();