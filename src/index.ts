import express from "express";


import "dotenv/config";
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

  // sessions / admin
  adminListUsers,
  adminGetUser,
  adminDeleteUser,
  startSession,
  pingSession,
  endSession,
  touchUserOnline,
  adminGetStats,
  adminListOnlineUsers,
  adminResetFreeCounters,
  // ✅ charts
  adminChartCoins,
  adminChartActiveUsers,
}from "./db";

const app = express();

/* ---------------- CORS ---------------- */
app.use(cors({
  origin: true,
  credentials: true,
  methods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Admin-Secret"
  ]
}));

app.use(express.json())

/* ---------------- HEALTH ---------------- */
app.get("/health", (_req, res) => res.send("ok"));
app.get("/", (_req, res) => res.send("backend up"));

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
      ok: true,
      user,
      progress: progress ?? { uid, level: 1, coins: 0 },
    });
  } catch (e: any) {
    res.status(401).json({ ok: false, error: e.message });
  }
});


/* ---------------- PROGRESS ---------------- */
app.get("/progress", async (req,res)=>{
  const uid = String(req.query.uid||"");
  const p = await getProgressByUid(uid);
  res.json({ ok:true, data:p ?? {uid,level:1,coins:0} });
});

app.post("/progress", async (req,res)=>{
  await requirePiUser(req);
  const { uid, level, coins } = req.body;
  await setProgressByUid({ uid, level, coins });
  res.json({ ok:true });
});

/* ---------------- HELPERS ---------------- */
async function requirePiUser(req: express.Request) {
  const token = getBearerToken(req);
  if (!token) throw new Error("Missing token");

  const piUser: any = await verifyPiAccessToken(token);
  const uid = String(piUser.uid);
  const username = String(piUser.username);

  await upsertUser({ uid, username });

  // mark user online on ANY request
  await touchUserOnline(uid);

  return { uid, username };
}

function getBearerToken(req: express.Request) {
  return String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
}

async function verifyPiAccessToken(accessToken: string) {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 3000);

  const r = await fetch("https://api.minepi.com/v2/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: controller.signal,
  });

  if (!r.ok) {
    throw new Error("Invalid Pi token");
  }

  return await r.json();
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


/* ---------------- REWARDS ---------------- */
app.post("/api/rewards/ad-50", async (req,res)=>{
  try{
    const { uid } = await requirePiUser(req);
    const nonce = String(req.body?.nonce||"");
    if(!nonce) return res.status(400).json({ok:false});

    const out = await claimReward({
      uid,
      type:"ad_50",
      nonce,
      amount:50,
      cooldownSeconds:0,
    });

    res.json({ ok:true, already:!!out?.already, user:out?.user });
  }catch(e:any){
    res.status(400).json({ok:false,error:e.message});
  }
});

app.post("/api/rewards/level-complete", async (req,res)=>{
  try{
    const { uid } = await requirePiUser(req);
    const level = Number(req.body?.level||0);
    const out = await claimLevelComplete(uid, level);
    res.json({ ok:true, already:!!out?.already, user:out?.user });
  }catch(e:any){
    res.status(400).json({ok:false,error:e.message});
  }
});

app.post("/api/skip", async (req,res)=>{
  try{
    const { uid } = await requirePiUser(req);
    res.json(await useSkip(uid));
  }catch(e:any){
    res.status(400).json({ok:false,error:e.message});
  }
});

app.post("/api/hint", async (req,res)=>{
  try{
    const { uid } = await requirePiUser(req);
    res.json(await useHint(uid));
  }catch(e:any){
    res.status(400).json({ok:false,error:e.message});
  }
});




/* ---------------- ADMIN: stats/online/users ---------------- */
app.get("/admin/stats", async (req,res)=>{
  try{
    requireAdmin(req);
    const minutes = Number(req.query.minutes||5);
    res.json({ ok:true, data: await adminGetStats({ onlineMinutes:minutes }) });
  }catch(e:any){
    res.status(401).json({ok:false,error:e.message});
  }
});

app.get("/admin/online", async (req,res)=>{
  try{
    requireAdmin(req);
    res.json(await adminListOnlineUsers({
      minutes:Number(req.query.minutes||5),
      limit:50,
      offset:0,
    }));
  }catch(e:any){
    res.status(401).json({ok:false,error:e.message});
  }
});

/* ✅ NEW: admin users list + detail (Fix 2) */
app.get("/admin/users", async (req,res)=>{
  try{
    requireAdmin(req);
    const search = String(req.query.search || "");
    const limit  = Math.max(1, Math.min(200, Number(req.query.limit || 25)));
    const offset = Math.max(0, Number(req.query.offset || 0));
    const order  = String(req.query.order || "updated_at_desc");
    const out = await adminListUsers({ search, limit, offset });
    res.json(out);
  }catch(e:any){
    res.status(401).json({ ok:false, error:e.message });
  }
});

app.get("/admin/users/:uid", async (req,res)=>{
  try{
    requireAdmin(req);
    const data = await adminGetUser(String(req.params.uid));
    res.json({ ok:true, data });
  }catch(e:any){
    res.status(401).json({ ok:false, error:e.message });
  }
});

/* ✅ NEW: charts endpoints (Step 1 – “A: last 7 days”) */
app.get("/admin/charts/coins", async (req,res)=>{
  try{
    requireAdmin(req);
    const days = Number(req.query.days || 7);
    const rows = await adminChartCoins({ days });
    res.json({ ok:true, rows });
  }catch(e:any){
    res.status(401).json({ ok:false, error:e.message });
  }
});

app.get("/admin/charts/active", async (req,res)=>{
  try{
    requireAdmin(req);
    const days = Number(req.query.days || 7);
    const rows = await adminChartActiveUsers({ days });
    res.json({ ok:true, rows });
  }catch(e:any){
    res.status(401).json({ ok:false, error:e.message });
  }
});


// ✅ ADMIN: delete user completely
app.delete("/admin/users/:uid", async (req, res) => {
  try {
    requireAdmin(req);

    console.log("[ADMIN DELETE] HIT", req.params.uid);
    await adminDeleteUser(req.params.uid);
    res.json({ ok: true });

  } catch (e: any) {
    res.status(401).json({ ok: false, error: e.message });
  }
});

/* ---------------- START ---------------- */
const PORT = Number(process.env.PORT) || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log("Backend listening on", PORT);
});

// init DB AFTER server start (non-blocking)
initDB()
  .then(() => console.log("Database initialized"))
  .catch(err => console.error("DB init failed:", err));
  };