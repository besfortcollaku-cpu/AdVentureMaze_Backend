process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});
import "dotenv/config";
import express from "express";
import cors from "cors";

import {
  initDB,
  upsertUser,
  getProgressByUid,
  setProgressByUid,
  consumeItem,
  SpendMode,
  claimReward,
  claimDailyLogin,
  claimLevelComplete,
  useSkip,
  useHint, 
  pool,
  getFreeSkipsLeft,
  getFreeHintsLeft,
  closeMonthAndResetCoins,
  ensureMonthlyKey,
claimMonthlyRewards,
recalcAndStoreMonthlyRate,

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
  // ✅ charts1
  adminChartCoins,
  adminChartActiveUsers,
} from "./db";


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
res.set("Cache-Control", "no-store");
  try {
    const { uid } = await requirePiUser(req);

    const { rows } = await pool.query(
  `SELECT * FROM public.users WHERE uid=$1`,
  [uid]
);
const user = rows[0] ?? null;

    const progress = await getProgressByUid(uid);

res.json({
  ok: true,

  user: user
    ? {
        uid: user.uid,
        username: user.username,
        coins: user.coins,

        // 🔹 paid balances (wallet)
        skips_balance: user.skips_balance ?? 0,
        hints_balance: user.hints_balance ?? 0,
        restarts_balance: user.restarts_balance ?? 0,
        free_skips_used: user.free_skips_used ?? 0,
free_hints_used: user.free_hints_used ?? 0,
free_restarts_used: user.free_restarts_used ?? 0,

        monthly_final_rate: user.monthly_final_rate ?? 50,
        monthly_rate_breakdown: user.monthly_rate_breakdown ?? {},
        monthly_coins_earned: user.monthly_coins_earned ?? 0,
        monthly_login_days: user.monthly_login_days ?? 0,
        monthly_levels_completed: user.monthly_levels_completed ?? 0,
        monthly_skips_used: user.monthly_skips_used ?? 0,
        monthly_hints_used: user.monthly_hints_used ?? 0,
        monthly_restarts_used: user.monthly_restarts_used ?? 0,
        monthly_ads_watched: user.monthly_ads_watched ?? 0,
        monthly_valid_invites: user.monthly_valid_invites ?? 0,
      }
    : null,

  progress: progress
    ? {
        uid: progress.uid,
        level: progress.level,
        coins: progress.coins,
      }
    : null,
});  } catch (e: any) {
    res.status(401).json({ ok: false, error: e.message });
  }
});

app.post("/api/progress", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);
    const { level, coins, paintedKeys, resume } = req.body;

    await pool.query(
      `
      INSERT INTO progress (uid, level, coins, painted_keys, resume)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (uid)
      DO UPDATE SET
        level = EXCLUDED.level,
        coins = EXCLUDED.coins,
        painted_keys = EXCLUDED.painted_keys,
        resume = EXCLUDED.resume,
        updated_at = NOW()
      `,
      [uid, level, coins, paintedKeys, resume]
    );

    res.json({ ok: true });
  } catch (e) {
  const message = e instanceof Error ? e.message : "Unknown error";
  res.status(400).json({ ok: false, error: message });
}
});
app.patch("/api/user/username", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);
    const { username } = req.body;

    if (!username || username.length < 3 || username.length > 20) {
      return res.status(400).json({ ok: false, error: "Invalid username" });
    }

    await pool.query(
      `UPDATE public.users SET username=$1 WHERE uid=$2`,
      [username, uid]
    );

    res.json({ ok: true });
  } catch (e: any) {
    res.status(401).json({ ok: false, error: e.message });
  }
});
/* ---------------- PROGRESS ---------------- */
app.patch("/api/user/username", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);
    let { username } = req.body;

    if (typeof username !== "string") {
      return res.status(400).json({ ok: false, error: "Invalid username" });
    }

    username = username.trim();

    if (username.length < 3 || username.length > 20) {
      return res.status(400).json({ ok: false, error: "Username must be 3–20 characters" });
    }

    // allow only letters, numbers, underscore
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({ ok: false, error: "Only letters, numbers and underscore allowed" });
    }

    // prevent duplicate usernames
    const existing = await pool.query(
      `SELECT uid FROM public.users WHERE LOWER(username)=LOWER($1) AND uid<>$2`,
      [username, uid]
    );

    if ((existing.rowCount ?? 0) > 0) {
      return res.status(400).json({ ok: false, error: "Username already taken" });
    }

    await pool.query(
      `UPDATE public.users SET username=$1 WHERE uid=$2`,
      [username, uid]
    );

    res.json({ ok: true, username });

  } catch (e: any) {
    res.status(401).json({ ok: false, error: e.message });
  }
});
/* ---------------- HELPERS ---------------- */
async function requirePiUser(req: express.Request) {
  const token = getBearerToken(req);
  if (!token) throw new Error("Missing token");

  const piUser: any = await verifyPiAccessToken(token);
  const uid = String(piUser.uid);
  const username = String(piUser.username);

await upsertUser({ uid, username });

await ensureMonthlyKey(uid);

// mark user online on ANY request
await touchUserOnline(uid);

return { uid, username };
}
function getBearerToken(req: express.Request) {
  return String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
}

async function verifyPiAccessToken(accessToken: string) {
  console.log("---- VERIFY PI TOKEN ----");
  console.log("TOKEN:", accessToken);
  console.log("TOKEN LENGTH:", accessToken?.length);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const r = await fetch("https://api.minepi.com/v2/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });

    console.log("PI STATUS:", r.status);

    const text = await r.text();
    console.log("PI RAW RESPONSE:", text);

    if (!r.ok) {
      throw new Error("Invalid Pi access token");
    }

    return JSON.parse(text);
  } catch (err) {
    console.error("VERIFY ERROR:", err);
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}


app.post("/api/consume", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);
    const { item, mode, nonce } = req.body || {};

    const out = await consumeItem(uid, item, mode as SpendMode, nonce);
    res.json(out);
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

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


app.post("/api/monthly/claim", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);
    const month = req.body?.month ? String(req.body.month) : undefined;

    // recalc before snapshot
    await recalcAndStoreMonthlyRate(uid);

    const out = await claimMonthlyRewards(uid, { month });
res.json(out);
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/* ---------------- REWARDS ---------------- */
app.post("/api/rewards/ad-50", async (req,res)=>{
console.log("HEADERS", req.headers.authorization);
console.log("AD +50 HIT", {
  hasUser: !!req.user,
  uid: req.user?.uid,
});  try{
    const { uid } = await requirePiUser(req);
    const nonce = String(req.body?.nonce||"");
    if(!nonce) return res.status(400).json({ok:false});

    const out = await claimReward({
      uid,
      type:"ad_50",
      nonce,
      amount:50,
      cooldownSeconds:30,
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
app.post("/api/restart", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);

    await pool.query("BEGIN");

    const userRes = await pool.query(
      `SELECT restarts_balance FROM public.users WHERE uid=$1 FOR UPDATE`,
      [uid]
    );

    const progressRes = await pool.query(
      `SELECT free_restarts_used FROM progress WHERE uid=$1 FOR UPDATE`,
      [uid]
    );

    const user = userRes.rows[0];
    const progress = progressRes.rows[0];

    if (!user || !progress) {
      throw new Error("User or progress not found");
    }

    const FREE_RESTART_LIMIT = 3;
    let usedFree = false;

    if ((progress.free_restarts_used ?? 0) < FREE_RESTART_LIMIT) {
      await pool.query(
        `UPDATE progress
         SET free_restarts_used = free_restarts_used + 1
         WHERE uid=$1`,
        [uid]
      );
      usedFree = true;
    }
    else if ((user.restarts_balance ?? 0) > 0) {
      await pool.query(
        `UPDATE public.users
         SET restarts_balance = restarts_balance - 1
         WHERE uid=$1`,
        [uid]
      );
    }
    else {
      throw new Error("No restarts available");
    }

    await pool.query("COMMIT");

    const updatedUser = await pool.query(
      `SELECT restarts_balance FROM public.users WHERE uid=$1`,
      [uid]
    );

    const updatedProgress = await pool.query(
      `SELECT free_restarts_used FROM progress WHERE uid=$1`,
      [uid]
    );

    res.json({
      ok: true,
      free_restarts_used: updatedProgress.rows[0].free_restarts_used,
      restarts_balance: updatedUser.rows[0].restarts_balance,
      usedFree
    });

  } catch (e: any) {
    await pool.query("ROLLBACK");
    res.status(400).json({ ok: false, error: e.message });
  }
});
app.post("/api/skip", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);

    await pool.query("BEGIN");

    // Lock user + progress rows
    const userRes = await pool.query(
      `SELECT skips_balance FROM public.users WHERE uid=$1 FOR UPDATE`,
      [uid]
    );
    const progressRes = await pool.query(
      `SELECT free_skips_used FROM progress WHERE uid=$1 FOR UPDATE`,
      [uid]
    );

    const user = userRes.rows[0];
    const progress = progressRes.rows[0];

    if (!user || !progress) {
      throw new Error("User or progress not found");
    }

    const FREE_SKIP_LIMIT = 3;

    let usedFree = false;

    if ((progress.free_skips_used ?? 0) < FREE_SKIP_LIMIT) {
      // consume free
      await pool.query(
        `UPDATE progress
         SET free_skips_used = free_skips_used + 1
         WHERE uid=$1`,
        [uid]
      );
      usedFree = true;
    } 
    else if ((user.skips_balance ?? 0) > 0) {
      // consume paid
      await pool.query(
        `UPDATE public.users
         SET skips_balance = skips_balance - 1
         WHERE uid=$1`,
        [uid]
      );
    } 
    else {
      throw new Error("No skips available");
    }

    await pool.query("COMMIT");

    // return fresh values
    const updatedUser = await pool.query(
      `SELECT skips_balance FROM public.users WHERE uid=$1`,
      [uid]
    );
    const updatedProgress = await pool.query(
      `SELECT free_skips_used FROM progress WHERE uid=$1`,
      [uid]
    );

    res.json({
      ok: true,
      free_skips_used: updatedProgress.rows[0].free_skips_used,
      skips_balance: updatedUser.rows[0].skips_balance,
      usedFree
    });

  } catch (e: any) {
    await pool.query("ROLLBACK");
    res.status(400).json({ ok: false, error: e.message });
  }
});
app.post("/api/hint", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);

    await pool.query("BEGIN");

    const userRes = await pool.query(
      `SELECT hints_balance FROM public.users WHERE uid=$1 FOR UPDATE`,
      [uid]
    );

    const progressRes = await pool.query(
      `SELECT free_hints_used FROM progress WHERE uid=$1 FOR UPDATE`,
      [uid]
    );

    const user = userRes.rows[0];
    const progress = progressRes.rows[0];

    if (!user || !progress) {
      throw new Error("User or progress not found");
    }

    const FREE_HINT_LIMIT = 3;
    let usedFree = false;

    if ((progress.free_hints_used ?? 0) < FREE_HINT_LIMIT) {
      await pool.query(
        `UPDATE progress
         SET free_hints_used = free_hints_used + 1
         WHERE uid=$1`,
        [uid]
      );
      usedFree = true;
    }
    else if ((user.hints_balance ?? 0) > 0) {
      await pool.query(
        `UPDATE public.users
         SET hints_balance = hints_balance - 1
         WHERE uid=$1`,
        [uid]
      );
    }
    else {
      throw new Error("No hints available");
    }

    await pool.query("COMMIT");

    const updatedUser = await pool.query(
      `SELECT hints_balance FROM public.users WHERE uid=$1`,
      [uid]
    );

    const updatedProgress = await pool.query(
      `SELECT free_hints_used FROM progress WHERE uid=$1`,
      [uid]
    );

    res.json({
      ok: true,
      free_hints_used: updatedProgress.rows[0].free_hints_used,
      hints_balance: updatedUser.rows[0].hints_balance,
      usedFree
    });

  } catch (e: any) {
    await pool.query("ROLLBACK");
    res.status(400).json({ ok: false, error: e.message });
  }
});
/* ---------------- ADMIN: month close ---------------- */
app.post("/admin/month-close", async (req,res)=>{
  try{
    requireAdmin(req);
    const month = req.body?.month ? String(req.body.month) : undefined;
    res.json(await closeMonthAndResetCoins({ month }));
  }catch(e:any){
    res.status(401).json({ok:false,error:e.message});
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

async function start() {
  try {
    await initDB();
    console.log("Database initialized");

    const info = await pool.query(`
      SELECT current_database(), inet_server_addr(), inet_server_port()
    `);
    console.log("DB INFO:", info.rows);

    app.listen(PORT, "0.0.0.0", () => {
      console.log("Backend listening on", PORT);
    });

  } catch (err) {
    console.error("Startup failed:", err);
    process.exit(1);
  }
}

start();