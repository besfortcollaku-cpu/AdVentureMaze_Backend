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
  // âœ… charts1
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

    const userRes = await pool.query(
      `SELECT * FROM public.users WHERE uid = $1 LIMIT 1`,
      [uid]
    );
const user = userRes.rows[0] ?? null;
const progress = await getProgressByUid(uid);

const today = new Date().toISOString().slice(0, 10);

const lastClaim = user?.last_daily_claim_date
  ? new Date(user.last_daily_claim_date).toISOString().slice(0, 10)
  : null;

const currentDay = Number(user?.daily_streak ?? 0) || 0;

let diffDays = 0;
if (user?.last_daily_claim_date) {
  const last = new Date(user.last_daily_claim_date);
  const now = new Date();

  diffDays = Math.floor(
    (now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24)
  );
}

const missedRowsRes = await pool.query(
  `SELECT day, is_recovered
   FROM daily_reward_missed_days
   WHERE uid = $1`,
  [uid]
);

const persistedMissedDays = missedRowsRes.rows
  .filter((r: any) => !r.is_recovered)
  .map((r: any) => Number(r.day))
  .filter((n: number) => Number.isInteger(n));

const recoveredDays = missedRowsRes.rows
  .filter((r: any) => r.is_recovered)
  .map((r: any) => Number(r.day))
  .filter((n: number) => Number.isInteger(n));

let todayDay = 0;

if (user && lastClaim !== today) {
  if (!lastClaim) {
    todayDay = Math.min(currentDay + 1, 7);
  } else {
    todayDay = Math.min(currentDay + Math.max(diffDays, 1), 7);
  }
}

const derivedMissedDays: number[] = [];

if (todayDay > 0) {
  for (let day = currentDay + 1; day < todayDay; day++) {
    if (day >= 1 && day <= 7 && !recoveredDays.includes(day)) {
      derivedMissedDays.push(day);
    }
  }
}

const missedDays = Array.from(
  new Set([...persistedMissedDays, ...derivedMissedDays])
).filter((day) => !recoveredDays.includes(day));

let dailyReward = {
  canClaim: false,
  day: 0,
  coins: 0,
  days: [] as Array<{
    day: number;
    coins: number;
    state: "claimed" | "today" | "missed" | "recovered" | "upcoming";
  }>,
  bonusState: "locked" as "locked" | "available" | "claimed",
};

if (user && lastClaim !== today && todayDay > 0) {
  dailyReward.canClaim = true;
  dailyReward.day = todayDay;
  dailyReward.coins = dailyRewardCoinsForDay(todayDay);
}

for (let day = 1; day <= 7; day++) {
  let state: "claimed" | "today" | "missed" | "recovered" | "upcoming" = "upcoming";

  if (recoveredDays.includes(day)) {
    state = "recovered";
  } else if (missedDays.includes(day)) {
    state = "missed";
  } else if (day <= currentDay) {
    state = "claimed";
  } else if (day === todayDay && lastClaim !== today) {
    state = "today";
  }

  dailyReward.days.push({
    day,
    coins: dailyRewardCoinsForDay(day),
    state,
  });
}

let mysteryChest = false;

if (user?.mystery_box_pending === true) {
  mysteryChest = true;
  dailyReward.bonusState = "available";
}

let missedDay = null;
const firstRecoverableMissedDay = missedDays[0] ?? null;

if (firstRecoverableMissedDay) {
  missedDay = {
    day: firstRecoverableMissedDay,
    coins: dailyRewardCoinsForDay(firstRecoverableMissedDay),
  };
}
    res.json({
      ok: true,

      user: user
        ? {
            uid: user.uid,
            username: user.username,
            coins: user.coins,

            // ðŸ”¹ paid balances (wallet)
            restarts_balance: user.restarts_balance ?? 0,
            skips_balance: user.skips_balance ?? 0,
            hints_balance: user.hints_balance ?? 0,
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
            free_skips_used: progress.free_skips_used ?? 0,
            free_hints_used: progress.free_hints_used ?? 0,
            free_restarts_used: progress.free_restarts_used ?? 0,
            paintedKeys: progress.painted_keys ?? [],
            resume: progress.resume ?? null,
          }
        : null,
      dailyReward,
      missedDay,
      mysteryChest,
    });
  } catch (e: any) {
    res.status(401).json({ ok: false, error: e.message });
  }
});
app.post("/api/progress", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);

    const requestedLevel = Number(req.body?.level ?? 1);
    const paintedKeys = req.body?.paintedKeys ?? null;
    const resume = req.body?.resume ?? null;

    if (!Number.isInteger(requestedLevel) || requestedLevel < 1) {
      return res.status(400).json({ ok: false, error: "invalid_level" });
    }

    const progressRes = await pool.query(
      `SELECT level FROM public.progress WHERE uid = $1 LIMIT 1`,
      [uid]
    );

    const currentSavedLevel = Number(progressRes.rows[0]?.level ?? 1);

    if (requestedLevel > currentSavedLevel + 1) {
      return res.status(403).json({ ok: false, error: "level_jump_blocked" });
    }

    const safeLevel = Math.max(currentSavedLevel, requestedLevel);

    // coins must come only from backend-owned users table
    const userRes = await pool.query(
      `SELECT coins FROM public.users WHERE uid = $1 LIMIT 1`,
      [uid]
    );

    const safeCoins = Number(userRes.rows[0]?.coins ?? 0);

    await setProgressByUid({
      uid,
      level: safeLevel,
      coins: safeCoins,
      paintedKeys,
      resume,
    });

    res.json({ ok: true, level: safeLevel, coins: safeCoins });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    res.status(400).json({ ok: false, error: message });
  }
});
/* ---------------- PROGRESS ---------------- */


const DAILY_REWARDS = [5,7,10,15,20,30,50];

function rewardForDay(day:number){
  return DAILY_REWARDS[Math.min(day-1, DAILY_REWARDS.length-1)];
}

app.post("/api/rewards/mystery-chest", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);

    await pool.query("BEGIN");

    const userRes = await pool.query(
      `SELECT uid, coins, daily_streak, last_daily_claim_date, mystery_box_pending
       FROM public.users
       WHERE uid = $1
       FOR UPDATE`,
      [uid]
    );

    const user = userRes.rows[0];

    if (!user || user.mystery_box_pending !== true) {
      await pool.query("ROLLBACK");
      throw new Error("not_available");
    }

    const reward = mysteryChestReward();

    await pool.query(
      `UPDATE public.users
       SET
         coins = coins + $1,
         daily_streak = 0,
         mystery_box_pending = FALSE,
         last_daily_claim_date = CURRENT_DATE
       WHERE uid = $2`,
      [reward, uid]
    );

    await pool.query(
      `DELETE FROM daily_reward_missed_days
       WHERE uid = $1`,
      [uid]
    );

    await pool.query("COMMIT");

    const updated = await pool.query(
      `SELECT * FROM public.users WHERE uid = $1`,
      [uid]
    );

    res.json({
      ok: true,
      reward,
      user: updated.rows[0]
    });
  } catch (e: any) {
    await pool.query("ROLLBACK");
    res.status(400).json({ ok: false, error: e.message });
  }
});app.post("/api/daily-reward/recover", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);

    await pool.query("BEGIN");

    const userRes = await pool.query(
      `SELECT uid, coins, daily_streak, last_daily_claim_date
       FROM public.users
       WHERE uid = $1
       FOR UPDATE`,
      [uid]
    );

    const user = userRes.rows[0];
    if (!user) {
      throw new Error("User not found");
    }

    if (!user.last_daily_claim_date) {
      await pool.query("ROLLBACK");
      return res.status(400).json({ ok: false, error: "no_missed_day" });
    }

    const last = new Date(user.last_daily_claim_date);
    const now = new Date();

    const diffDays = Math.floor(
      (now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (diffDays <= 1) {
      await pool.query("ROLLBACK");
      return res.status(400).json({ ok: false, error: "no_missed_day" });
    }

    const currentStreak = Number(user.daily_streak ?? 0) || 0;
    const missedDay = Math.min(currentStreak + 1, 7);
    const rewardCoins = dailyRewardCoinsForDay(missedDay);

    const cycleAnchor = new Date(user.last_daily_claim_date)
      .toISOString()
      .slice(0, 10);

    const existingRecovery = await pool.query(
      `SELECT 1
       FROM daily_reward_recoveries
       WHERE uid = $1 AND day = $2 AND cycle_anchor = $3
       LIMIT 1`,
      [uid, missedDay, cycleAnchor]
    );

    if (existingRecovery.rowCount) {
      await pool.query("ROLLBACK");
      return res.json({ ok: true, already: true });
    }

    await pool.query(
      `INSERT INTO daily_reward_recoveries (uid, day, cycle_anchor)
       VALUES ($1, $2, $3)`,
      [uid, missedDay, cycleAnchor]
    );

    await pool.query(
      `UPDATE public.users
       SET coins = coins + $2
       WHERE uid = $1`,
      [uid, rewardCoins]
    );

    await pool.query("COMMIT");

    const updatedRes = await pool.query(
      `SELECT * FROM public.users WHERE uid = $1`,
      [uid]
    );

    return res.json({
      ok: true,
      recoveredDay: missedDay,
      coinsAwarded: rewardCoins,
      user: updatedRes.rows[0],
    });
  } catch (e: any) {
    await pool.query("ROLLBACK");
    return res.status(400).json({ ok: false, error: e.message });
  }
});
app.post("/api/daily-reward/claim", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);

    await pool.query("BEGIN");

    const userRes = await pool.query(
      `SELECT uid, coins, daily_streak, last_daily_claim_date, mystery_box_pending
       FROM public.users
       WHERE uid = $1
       FOR UPDATE`,
      [uid]
    );

    const user = userRes.rows[0];
    if (!user) {
      throw new Error("User not found");
    }

    const today = new Date().toISOString().slice(0, 10);

    const lastClaim = user.last_daily_claim_date
      ? new Date(user.last_daily_claim_date).toISOString().slice(0, 10)
      : null;

    if (lastClaim === today) {
      await pool.query("ROLLBACK");
      return res.json({ ok: true, already: true });
    }

    const currentDay = Number(user.daily_streak ?? 0) || 0;

    let diffDays = 0;
    if (user.last_daily_claim_date) {
      const last = new Date(user.last_daily_claim_date);
      const now = new Date();

      diffDays = Math.floor(
        (now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24)
      );
    }

    let todayDay = 0;

    if (!lastClaim) {
      todayDay = Math.min(currentDay + 1, 7);
    } else {
      todayDay = Math.min(currentDay + Math.max(diffDays, 1), 7);
    }

    const missedCount = Math.max(diffDays - 1, 0);

    for (let i = 1; i <= missedCount; i++) {
      const missed = currentDay + i;
      if (missed >= 1 && missed < todayDay && missed <= 7) {
        await pool.query(
          `INSERT INTO daily_reward_missed_days (uid, day, is_recovered)
           VALUES ($1, $2, FALSE)
           ON CONFLICT (uid, day) DO NOTHING`,
          [uid, missed]
        );
      }
    }

    const rewardCoins = dailyRewardCoinsForDay(todayDay);

    if (todayDay === 7) {
      const missedCheckRes = await pool.query(
        `SELECT 1
         FROM daily_reward_missed_days
         WHERE uid = $1
         LIMIT 1`,
        [uid]
      );

      const perfectCycle = missedCheckRes.rowCount === 0;

      if (perfectCycle) {
        await pool.query(
          `
          UPDATE public.users
          SET
            coins = coins + $2,
            daily_streak = 7,
            last_daily_claim_date = CURRENT_DATE,
            mystery_box_pending = TRUE
          WHERE uid = $1
          `,
          [uid, rewardCoins]
        );
      } else {
        await pool.query(
          `
          UPDATE public.users
          SET
            coins = coins + $2,
            daily_streak = 0,
            last_daily_claim_date = CURRENT_DATE,
            mystery_box_pending = FALSE
          WHERE uid = $1
          `,
          [uid, rewardCoins]
        );

        await pool.query(
          `DELETE FROM daily_reward_missed_days
           WHERE uid = $1`,
          [uid]
        );
      }
    } else {
      await pool.query(
        `
        UPDATE public.users
        SET
          coins = coins + $2,
          daily_streak = $3,
          last_daily_claim_date = CURRENT_DATE,
          mystery_box_pending = FALSE
        WHERE uid = $1
        `,
        [uid, rewardCoins, todayDay]
      );
    }

    await pool.query("COMMIT");

    const updatedRes = await pool.query(
      `SELECT * FROM public.users WHERE uid = $1`,
      [uid]
    );

    return res.json({
      ok: true,
      day: todayDay,
      coinsAwarded: rewardCoins,
      user: updatedRes.rows[0],
    });
  } catch (e: any) {
    await pool.query("ROLLBACK");
    return res.status(400).json({ ok: false, error: e.message });
  }
});
app.post("/api/rewards/recover-day", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);
    const day = Number(req.body?.day || 0);

    if (!Number.isInteger(day) || day < 1 || day > 7) {
      throw new Error("invalid_day");
    }

    await pool.query("BEGIN");

    const userRes = await pool.query(
      `SELECT uid, coins, daily_streak, last_daily_claim_date
       FROM public.users
       WHERE uid = $1
       FOR UPDATE`,
      [uid]
    );

    const user = userRes.rows[0];
    if (!user) {
      throw new Error("User not found");
    }

    const currentDay = Number(user.daily_streak ?? 0) || 0;

    const lastClaim = user.last_daily_claim_date
      ? new Date(user.last_daily_claim_date).toISOString().slice(0, 10)
      : null;

    if (!lastClaim) {
      await pool.query("ROLLBACK");
      return res.status(400).json({ ok: false, error: "no_missed_day" });
    }

    const last = new Date(user.last_daily_claim_date);
    const now = new Date();

    const diffDays = Math.floor(
      (now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24)
    );

    const todayDay = Math.min(currentDay + Math.max(diffDays, 1), 7);

    const allowedMissedDays: number[] = [];
    for (let d = currentDay + 1; d < todayDay; d++) {
      if (d >= 1 && d <= 7) {
        allowedMissedDays.push(d);
      }
    }

    if (!allowedMissedDays.includes(day)) {
      await pool.query("ROLLBACK");
      return res.status(400).json({ ok: false, error: "no_missed_day" });
    }

    const missedRes = await pool.query(
      `SELECT day, is_recovered
       FROM daily_reward_missed_days
       WHERE uid = $1 AND day = $2
       LIMIT 1`,
      [uid, day]
    );

    const missed = missedRes.rows[0];

    if (missed?.is_recovered) {
      await pool.query("ROLLBACK");
      return res.json({ ok: true, already: true });
    }

    if (!missed) {
      await pool.query(
        `INSERT INTO daily_reward_missed_days (uid, day, is_recovered)
         VALUES ($1, $2, TRUE)`,
        [uid, day]
      );
    } else {
      await pool.query(
        `UPDATE daily_reward_missed_days
         SET is_recovered = TRUE
         WHERE uid = $1 AND day = $2`,
        [uid, day]
      );
    }

    const coins = dailyRewardCoinsForDay(day);

    await pool.query(
      `UPDATE public.users
       SET coins = coins + $1
       WHERE uid = $2`,
      [coins, uid]
    );

    await pool.query("COMMIT");

    const updated = await pool.query(
      `SELECT * FROM public.users WHERE uid = $1`,
      [uid]
    );

    res.json({
      ok: true,
      recoveredDay: day,
      coinsAwarded: coins,
      user: updated.rows[0],
    });
  } catch (e: any) {
    await pool.query("ROLLBACK");
    res.status(400).json({ ok: false, error: e.message });
  }
});
app.patch("/api/user/username", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);
    let { username } = req.body;

    if (typeof username !== "string") {
      return res.status(400).json({ ok: false, error: "Invalid username" });
    }

    username = username.trim();

    if (username.length < 3 || username.length > 20) {
      return res.status(400).json({ ok: false, error: "Username must be 3â€“20 characters" });
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
function mysteryChestReward() {

  const r = Math.random();

  if (r < 0.4) return 50;
  if (r < 0.7) return 100;
  if (r < 0.9) return 150;
  return 200;

}
function dailyRewardCoinsForDay(day: number) {
  const map = [5, 7, 10, 15, 20, 30, 50];
  return map[Math.max(0, Math.min(map.length - 1, day - 1))];
}

function nextDailyStreak(lastClaimDate: string | null, today: Date) {
  const todayStr = today.toISOString().slice(0, 10);

  if (!lastClaimDate) {
    return { canClaim: true, day: 1, todayStr };
  }

  const last = new Date(lastClaimDate + "T00:00:00.000Z");
  const diffDays = Math.floor((today.getTime() - last.getTime()) / 86400000);

  if (diffDays <= 0) {
    return { canClaim: false, day: 0, todayStr };
  }

  if (diffDays === 1) {
    return { canClaim: true, continueStreak: true, todayStr };
  }

  return { canClaim: true, resetStreak: true, todayStr };
}
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const r = await fetch("https://api.minepi.com/v2/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });

    const text = await r.text();
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
  try{
    const { uid } = await requirePiUser(req);
    const nonce = String(req.body?.nonce||"");
    if(!nonce) return res.status(400).json({ok:false});

    const out = await claimReward({
      uid,
      type:"ad_50",
      nonce,
      amount:50,
      cooldownSeconds:180,
    });

    res.json({ ok:true, already:!!out?.already, user:out?.user });
  }catch(e:any){
    res.status(400).json({ok:false,error:e.message});
  }
});

app.post("/api/rewards/level-complete", async (req,res)=>{
  try{
    const { uid } = await requirePiUser(req);
    const level = Number(req.body?.level || 0);

    // security validation
    if (!Number.isInteger(level) || level < 1) {
      return res.status(400).json({ ok:false, error:"invalid_level" });
    }

    // anti-exploit: user may only claim reward for current reached level
    const progressRes = await pool.query(
      `SELECT level FROM public.progress WHERE uid = $1 LIMIT 1`,
      [uid]
    );

    const savedLevel = Number(progressRes.rows[0]?.level ?? 1);

    // allowed:
    // - exact current level
    // - previous levels already reached
    // blocked:
    // - future levels beyond current reached progress
    if (level > savedLevel) {
      return res.status(403).json({ ok:false, error:"level_not_reached" });
    }

    const out = await claimLevelComplete(uid, level);

    res.json({ ok:true, already:!!out?.already, user:out?.user });

  }catch(e:any){
    res.status(400).json({ok:false,error:e.message});
  }
})
app.post("/api/restart", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);
    const nonce = String(req.body?.nonce || "");
    const mode = String(req.body?.mode || "");

    await pool.query("BEGIN");

    const userRes = await pool.query(
      `SELECT restarts_balance, coins FROM public.users WHERE uid=$1 FOR UPDATE`,
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
    const RESTART_PRICE = 50;

    let usedFree = false;

    if ((progress.free_restarts_used ?? 0) < FREE_RESTART_LIMIT) {
      await pool.query(
        `UPDATE progress
         SET free_restarts_used = free_restarts_used + 1
         WHERE uid=$1`,
        [uid]
      );

      usedFree = true;

    } else if ((user.restarts_balance ?? 0) > 0) {
      await pool.query(
        `UPDATE public.users
         SET restarts_balance = restarts_balance - 1
         WHERE uid=$1`,
        [uid]
      );

    } else if (mode === "coins") {
      if ((user.coins ?? 0) < RESTART_PRICE) {
        throw new Error("Not enough coins");
      }

      await pool.query(
        `UPDATE public.users
         SET coins = coins - $1
         WHERE uid=$2`,
        [RESTART_PRICE, uid]
      );

    } else if (mode === "ad") {
      if (!nonce) {
        throw new Error("missing_nonce");
      }

      const reward = await claimReward({
        uid,
        type: "restart_ad",
        nonce,
        amount: 1,
        cooldownSeconds: 30,
      });

      if (reward?.already) {
        throw new Error("Ad already claimed");
      }

    } else {
      throw new Error("No restarts available");
    }

    await pool.query("COMMIT");

    const updatedUser = await pool.query(
      `SELECT restarts_balance, coins FROM public.users WHERE uid=$1`,
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
      coins: updatedUser.rows[0].coins,
      usedFree,
    });

  } catch (e: any) {
    await pool.query("ROLLBACK");
    res.status(400).json({ ok: false, error: e.message });
  }
});
app.post("/api/rewards/daily-claim", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);

    await pool.query("BEGIN");

const userRes = await pool.query(
  `SELECT coins, daily_streak, last_daily_claim_date
   FROM public.users
   WHERE uid=$1
   FOR UPDATE`,
  [uid]
);

    const user = userRes.rows[0];

    if (!user) {
      throw new Error("user_not_found");
    }

    const today = new Date().toISOString().slice(0,10);

const lastClaim = user.last_daily_claim_date
  ? new Date(user.last_daily_claim_date).toISOString().slice(0,10)
  : null;

if (lastClaim === today) {
  return res.json({
    ok: true,
    already: true,
  });
}
    const nextDay = Math.min((user.daily_streak ?? 0) + 1, 7);
    const reward = dailyRewardCoinsForDay(nextDay);

    await pool.query(
      `UPDATE public.users
       SET coins = coins + $1,
           daily_streak = $2,
           last_daily_claim_date = $3
       WHERE uid = $4`,
      [reward, nextDay, today, uid]
    );

    const updated = await pool.query(
      `SELECT coins, daily_streak
       FROM public.users
       WHERE uid=$1`,
      [uid]
    );

    await pool.query("COMMIT");

res.json({
  ok: true,
  day: nextDay,
  coins: reward,
  user: updated.rows[0],
});

} catch (e: any) {
  await pool.query("ROLLBACK");
  res.status(400).json({ ok: false, error: e.message });
}
});

app.post("/api/skip", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);
    const nonce = String(req.body?.nonce || "");
    const mode = String(req.body?.mode || "");

    await pool.query("BEGIN");

    const userRes = await pool.query(
      `SELECT skips_balance, coins FROM public.users WHERE uid=$1 FOR UPDATE`,
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
    const SKIP_PRICE = 50;

    let usedFree = false;

    if ((progress.free_skips_used ?? 0) < FREE_SKIP_LIMIT) {
      await pool.query(
        `UPDATE progress
         SET free_skips_used = free_skips_used + 1
         WHERE uid=$1`,
        [uid]
      );

      usedFree = true;

    } else if ((user.skips_balance ?? 0) > 0) {
      await pool.query(
        `UPDATE public.users
         SET skips_balance = skips_balance - 1
         WHERE uid=$1`,
        [uid]
      );

    } else if (mode === "coins") {
      if ((user.coins ?? 0) < SKIP_PRICE) {
        throw new Error("Not enough coins");
      }

      await pool.query(
        `UPDATE public.users
         SET coins = coins - $1
         WHERE uid=$2`,
        [SKIP_PRICE, uid]
      );

    } else if (mode === "ad") {
      if (!nonce) {
        throw new Error("missing_nonce");
      }

      const reward = await claimReward({
        uid,
        type: "skip_ad",
        nonce,
        amount: 1,
        cooldownSeconds: 30,
      });

      if (reward?.already) {
        throw new Error("Ad already claimed");
      }

    } else {
      throw new Error("No skips available");
    }

    await pool.query("COMMIT");

    const updatedUser = await pool.query(
      `SELECT skips_balance, coins FROM public.users WHERE uid=$1`,
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
      coins: updatedUser.rows[0].coins,
      usedFree,
    });

  } catch (e: any) {
    await pool.query("ROLLBACK");
    res.status(400).json({ ok: false, error: e.message });
  }
});app.post("/api/hint", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);
    const nonce = String(req.body?.nonce || "");
    const mode = String(req.body?.mode || "");

    await pool.query("BEGIN");

    const userRes = await pool.query(
      `SELECT hints_balance, coins FROM public.users WHERE uid=$1 FOR UPDATE`,
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
    const HINT_PRICE = 50;

    let usedFree = false;

    if ((progress.free_hints_used ?? 0) < FREE_HINT_LIMIT) {
      await pool.query(
        `UPDATE progress
         SET free_hints_used = free_hints_used + 1
         WHERE uid=$1`,
        [uid]
      );

      usedFree = true;

    } else if ((user.hints_balance ?? 0) > 0) {
      await pool.query(
        `UPDATE public.users
         SET hints_balance = hints_balance - 1
         WHERE uid=$1`,
        [uid]
      );

    } else if (mode === "coins") {
      if ((user.coins ?? 0) < HINT_PRICE) {
        throw new Error("Not enough coins");
      }

      await pool.query(
        `UPDATE public.users
         SET coins = coins - $1
         WHERE uid=$2`,
        [HINT_PRICE, uid]
      );

    } else if (mode === "ad") {
      if (!nonce) {
        throw new Error("missing_nonce");
      }

      const reward = await claimReward({
        uid,
        type: "hint_ad",
        nonce,
        amount: 1,
        cooldownSeconds: 30,
      });

      if (reward?.already) {
        throw new Error("Ad already claimed");
      }

    } else {
      throw new Error("No hints available");
    }

    await pool.query("COMMIT");

    const updatedUser = await pool.query(
      `SELECT hints_balance, coins FROM public.users WHERE uid=$1`,
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
      coins: updatedUser.rows[0].coins,
      usedFree,
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

/* âœ… NEW: admin users list + detail (Fix 2) */
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

/* âœ… NEW: charts endpoints (Step 1 â€“ â€œA: last 7 daysâ€) */
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


// âœ… ADMIN: delete user completely
app.delete("/admin/users/:uid", async (req, res) => {
  try {
    requireAdmin(req);

    
    
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
    const info = await pool.query(`
      SELECT current_database(), inet_server_addr(), inet_server_port()
    `);
    app.listen(PORT, "0.0.0.0", () => {
     
    });

  } catch (err) {
    console.error("Startup failed:", err);
    process.exit(1);
  }
}

start();
