// src/index.ts
import "dotenv/config";
import express from "express";
import cors from "cors";

import {
  initDB,
  upsertUser,
  getUserByUid,
  addCoins,
  setCoins,
  getProgressByUid,
  setProgressByUid,
  claimReward,
  claimDailyLogin,
  claimLevelComplete,
  startSession,
  pingSession,
  endSession,
  touchUserOnline,
  adminListUsers,
  adminGetUser,
  adminGetStats,
} from "./db";

const app = express();

/* ============== MIDDLEWARE ============== */
app.use(cors({ origin: "*", allowedHeaders: ["Content-Type", "Authorization", "x-admin-secret"] }));
app.use(express.json());

/* ============== HELPERS ============== */
function requireAdmin(req: express.Request) {
  if (req.headers["x-admin-secret"] !== process.env.ADMIN_SECRET) {
    throw new Error("Unauthorized");
  }
}

/* ============== ADMIN ROUTES ============== */
app.get("/admin/users", async (req, res) => {
  try {
    requireAdmin(req);
    res.json(await adminListUsers({
      search: req.query.search,
      limit: Number(req.query.limit || 25),
      offset: Number(req.query.offset || 0),
    }));
  } catch (e:any) {
    res.status(401).json({ ok:false, error: e.message });
  }
});

app.get("/admin/users/:uid", async (req, res) => {
  try {
    requireAdmin(req);
    res.json({ ok:true, data: await adminGetUser(req.params.uid) });
  } catch (e:any) {
    res.status(401).json({ ok:false, error: e.message });
  }
});

app.post("/admin/users/:uid/coins/add", async (req, res) => {
  requireAdmin(req);
  res.json({ ok:true, user: await addCoins(req.params.uid, Number(req.body.delta)) });
});

app.post("/admin/users/:uid/coins/set", async (req, res) => {
  requireAdmin(req);
  res.json({ ok:true, user: await setCoins(req.params.uid, Number(req.body.coins)) });
});

app.post("/admin/users/:uid/coins/reset", async (req, res) => {
  requireAdmin(req);
  res.json({ ok:true, user: await setCoins(req.params.uid, 0) });
});

app.get("/admin/stats", async (req, res) => {
  requireAdmin(req);
  res.json({ ok:true, data: await adminGetStats({ onlineMinutes: 5 }) });
});

/* ============== START ============== */
(async () => {
  await initDB();
  app.listen(process.env.PORT || 3001, () =>
    console.log("Backend running")
  );
})();