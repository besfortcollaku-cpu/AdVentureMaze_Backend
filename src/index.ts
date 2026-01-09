// src/index.ts
import "dotenv/config";
import express from "express";
import cors from "cors";

import { verifyPiAccessToken } from "./pi"; // ✅ USE ONLY THIS

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

/* ---------------- CORS ---------------- */
app.use(cors({
  origin: "*",
  methods: ["GET","POST","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization","x-admin-secret"],
}));
app.options("*", cors());
app.use(express.json());

/* ---------------- HEALTH ---------------- */
app.get("/health", (_req, res) => res.send("ok"));
app.get("/", (_req, res) => res.send("backend up"));

/* ---------------- HELPERS ---------------- */
function getBearerToken(req: express.Request) {
  return String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
}

async function requirePiUser(req: express.Request) {
  const token = getBearerToken(req);
  if (!token) throw new Error("Missing token");

  const piUser: any = await verifyPiAccessToken(token);

  if (!piUser?.uid || !piUser?.username) {
    throw new Error("Invalid Pi user data");
  }

  const uid = String(piUser.uid);
  const username = String(piUser.username);

  await upsertUser({ uid, username });
  await touchUserOnline(uid);

  return { uid, username };
}

/* ---------------- ADMIN AUTH ---------------- */
function requireAdmin(req: express.Request) {
  const secret = String(req.headers["x-admin-secret"] || "");
  if (!process.env.ADMIN_SECRET) throw new Error("ADMIN_SECRET missing");
  if (secret !== process.env.ADMIN_SECRET) throw new Error("Unauthorized");
}

/* ---------------- PI VERIFY ---------------- */
app.post("/api/pi/verify", async (req, res) => {
  try {
    const token = req.body?.accessToken || getBearerToken(req);
    if (!token) return res.status(400).json({ ok:false });

    const piUser: any = await verifyPiAccessToken(token);

    if (!piUser?.uid || !piUser?.username) {
      return res.status(401).json({ ok:false, error:"Invalid Pi user" });
    }

    const user = await upsertUser({
      uid: String(piUser.uid),
      username: String(piUser.username),
    });

    await touchUserOnline(user.uid);

    res.json({ ok:true, user });
  } catch (e:any) {
    res.status(401).json({ ok:false, error:e.message });
  }
});

/* ---------------- /api/me ---------------- */
app.get("/api/me", async (req, res) => {
  try {
    const { uid, username } = await requirePiUser(req);
    let user = await upsertUser({ uid, username });

    try {
      const out = await claimDailyLogin(uid);
      if (out?.user) user = out.user;
    } catch {}

    const progress = await getProgressByUid(uid);

    res.json({
      ok:true,
      user,
      progress: progress ?? { uid, level:1, coins:0 },
    });
  } catch (e:any) {
    res.status(401).json({ ok:false, error:e.message });
  }
});

/* ---------------- REST OF FILE ---------------- */
/* ❗ EVERYTHING BELOW IS UNCHANGED ❗ */
/* rewards, progress, sessions, admin, charts, main() */

async function main(){
  await initDB();
  const PORT = Number(process.env.PORT)||3001;
  app.listen(PORT,"0.0.0.0",()=>console.log("Backend running on",PORT));
}
main();