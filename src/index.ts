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
  DAILY_REWARD_COINS,
  FREE_HINTS_PER_ACCOUNT,
  FREE_RESTARTS_PER_ACCOUNT,
  FREE_SKIPS_PER_ACCOUNT,
  HINT_MC_COST,
  RESTART_MC_COST,
  SKIP_MC_COST,
  getAdRewardCoinsForDailyCount,
  getDailyRewardCoinsForDay,
  getMysteryChestRewardFromRoll,
} from "./config/economy";
import { runtimeConfig } from "./config/runtime";

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
  closeMonthlyPayoutCycle,
  adminPreviewSettlement,
  adminGetSettlementStatus,
  generatePayoutJobs,
  adminListPayoutJobs,
  adminListPayoutCycles,
  adminGetPayoutSnapshotSummary,
  adminGetPayoutRuntimeConfig,
  adminSetPayoutSimulationMode,
  adminSyncPayoutSimulationModeFromDb,
  adminListPayoutSnapshots,
  adminListPayoutTransferLogs,
  adminRetryFailedPayouts,
  adminResolvePayoutJob,
  adminUpdatePayoutJobStatus,
  adminRequeueFailedPayoutJob,
  runPayoutWorkerBatch,
  ensureMonthlyKey,
  claimMonthlyRewards,
  recalcAndStoreMonthlyRate,
  syncMcBalanceFromLegacyCoins,
  resetDailyRPIfNeeded,
  trackRewardedAdActivity,
  incrementDailyUserStats,
  getDailyLeaderboard,
  getDailyLeaderboardMe,
  getMonthlyLeaderboard,
  getMonthlyLeaderboardMe,
  getDailyLeaderboardRaw,
  snapshotDailyLeaderboardRewards,
  getDailyLeaderboardRewardMe,
  claimDailyLeaderboardReward,
  adminGetDailyLeaderboardRewardRaw,
  resetDailyAdCounters,
  ensureInviteCode,
  getInviteSummary,
  claimInviteCode,

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
  adminSetUserPayoutLock,
  adminSetUserSuspicious,
  adminSetUserManualReview,
  adminSetUserTestFlag,
  adminReevaluateUserFraud,
  adminAdjustUserEconomy,
  adminResetUserState,
  // âœ… charts1
  adminChartCoins,
  adminChartActiveUsers,
} from "./db";


const app = express();
const ALLOW_INFERRED_MISSED_FOR_TEST = true;

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

const invitedUsersRes = await pool.query(
  `SELECT COALESCE(u.username, ui.invitee_uid) AS label
   FROM public.user_invites ui
   LEFT JOIN public.users u ON u.uid = ui.invitee_uid
   WHERE ui.inviter_uid = $1
   ORDER BY ui.created_at DESC
   LIMIT 200`,
  [uid]
);
const invitedUsernames = invitedUsersRes.rows
  .map((r: any) => String(r.label || "").trim())
  .filter(Boolean);

const invitedByNameRes = user?.invited_by_uid
  ? await pool.query(`SELECT username FROM public.users WHERE uid = $1 LIMIT 1`, [user.invited_by_uid])
  : { rows: [] as any[] };
const invitedByName = String(invitedByNameRes.rows?.[0]?.username || user?.invited_by_uid || "").trim() || null;



const today = new Date().toISOString().slice(0, 10);

const lastClaim = user?.last_daily_claim_date
  ? new Date(user.last_daily_claim_date).toISOString().slice(0, 10)
  : null;

const currentDay = Number(user?.daily_streak ?? 0) || 0;
const claimPlan = user ? buildDailyClaimPlan(user) : null;

const missedRowsRes = await pool.query(
  `SELECT day, is_recovered
   FROM daily_reward_missed_days
   WHERE uid = $1`,
  [uid]
);

const monthlyLeaderboardMe = await getMonthlyLeaderboardMe(uid);

const persistedMissedDays = missedRowsRes.rows
  .filter((r: any) => !r.is_recovered)
  .map((r: any) => Number(r.day))
  .filter((n: number) => Number.isInteger(n));

const recoveredDays = missedRowsRes.rows
  .filter((r: any) => r.is_recovered)
  .map((r: any) => Number(r.day))
  .filter((n: number) => Number.isInteger(n));

const testTodayDay =
  ALLOW_INFERRED_MISSED_FOR_TEST && user
    ? inferTodayDayFromLastClaim(user)
    : 0;

const todayDay = user && claimPlan && !claimPlan.already
  ? Math.max(claimPlan.nextDay, testTodayDay)
  : 0;

const derivedMissedDays: number[] =
  ALLOW_INFERRED_MISSED_FOR_TEST && user
    ? inferMissedDaysFromLastClaim(user).filter(
        (day) => !recoveredDays.includes(day)
      )
    : [];


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

      user: user
        ? {
            uid: user.uid,
            username: user.username,
            coins: user.mc_balance ?? user.coins ?? 0,
            legacy_coins: user.coins ?? 0,
            mc_balance: user.mc_balance ?? user.coins ?? 0,
            score: user.rp_score ?? 0,
            rp_score: user.rp_score ?? 0,
            daily_rp: user.daily_rp ?? 0,
            rpScore: user.rp_score ?? 0,
            dailyRp: user.daily_rp ?? 0,
            currentRank: monthlyLeaderboardMe?.currentRank ?? null,
            projectedTierName: monthlyLeaderboardMe?.projectedTierName ?? null,
            projectedTierLabel: monthlyLeaderboardMe?.projectedTierLabel ?? null,
            nextTierName: monthlyLeaderboardMe?.nextTierName ?? null,
            rpNeededForNextTier: monthlyLeaderboardMe?.rpNeededForNextTier ?? null,
            last_rp_reset: user.last_rp_reset ?? null,

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
            monthly_surprise_boxes_opened: user.monthly_surprise_boxes_opened ?? 0,
            monthly_mystery_boxes_opened: user.monthly_mystery_boxes_opened ?? 0,
            monthly_valid_invites: user.monthly_valid_invites ?? 0,
            lifetime_valid_invites: user.lifetime_valid_invites ?? 0,
            invite_code: user.invite_code ?? null,
            invited_by_uid: user.invited_by_uid ?? null,
            invited_by_name: invitedByName,
            invited_usernames: invitedUsernames,
            pi_wallet_identifier: user.pi_wallet_identifier ?? null,
            wallet_verified: Boolean(user.wallet_verified),
            wallet_last_updated_at: user.wallet_last_updated_at ?? null,          }
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
function validatePiWalletInput(raw: unknown): { ok: true; wallet: string } | { ok: false; error: string } {
  const compact = String(raw || "").replace(/[\r\n]+/g, " ").trim();

  if (!compact) return { ok: false, error: "invalid_wallet_required" };

  const words = compact.split(/\s+/).filter(Boolean);
  if (words.length >= 12) return { ok: false, error: "invalid_wallet_secret_like" };

  if (compact.includes(" ")) return { ok: false, error: "invalid_wallet_format" };

  const upper = compact.toUpperCase();

  const hasSecretKeywords = /(seed|mnemonic|private|secret|phrase)/i.test(compact);
  const alpha = compact.replace(/[^a-zA-Z]/g, "");
  const lower = compact.replace(/[^a-z]/g, "");
  const lowerHeavy = alpha.length >= 20 && (lower.length / alpha.length) >= 0.75;
  const randomLongNoPrefix = upper.length >= 40 && !upper.startsWith("G");
  if (hasSecretKeywords || lowerHeavy || randomLongNoPrefix) {
    return { ok: false, error: "invalid_wallet_secret_like" };
  }

  if (upper.length < 20 || upper.length > 100) {
    return { ok: false, error: "invalid_wallet_format" };
  }

  if (!/^[A-Z0-9]+$/.test(upper)) {
    return { ok: false, error: "invalid_wallet_format" };
  }

  if (!upper.startsWith("G")) {
    return { ok: false, error: "invalid_wallet_prefix" };
  }

  return { ok: true, wallet: upper };
}
app.post("/api/user/set-wallet", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);

    const walletCheck = validatePiWalletInput(req.body?.wallet);
    if (!walletCheck.ok) {
      return res.status(400).json({ ok: false, error: walletCheck.error });
    }
    const wallet = walletCheck.wallet;

    const duplicateRes = await pool.query(
      `SELECT uid FROM public.users
        WHERE pi_wallet_identifier = $1
          AND uid <> $2
        LIMIT 1`,
      [wallet, uid]
    );

    await pool.query(
      `UPDATE public.users
          SET pi_wallet_identifier = $1,
              wallet_verified = TRUE,
              wallet_last_updated_at = NOW(),
              updated_at = NOW()
        WHERE uid = $2`,
      [wallet, uid]
    );

    const sameWalletCountRes = await pool.query(
      `SELECT COUNT(*)::int AS c
         FROM public.users
        WHERE pi_wallet_identifier = $1`,
      [wallet]
    );

    const sameWalletCount = Number(sameWalletCountRes.rows[0]?.c || 0);
    if (sameWalletCount >= 3) {
      await pool.query(
        `UPDATE public.users
            SET suspicious = TRUE,
                updated_at = NOW()
          WHERE pi_wallet_identifier = $1`,
        [wallet]
      );
    }

    res.json({
      duplicate_in_use: (duplicateRes.rowCount || 0) > 0,
      suspicious_wallet_cluster: sameWalletCount >= 3,
    });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e?.message || "set_wallet_failed" });
  }
});

app.get("/api/invite/me", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);
    const out = await getInviteSummary(uid);

    res.json({
      ...out,
      invite_link: `https://pi-maze.com/?invite=${encodeURIComponent(out.invite_code)}`
    });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post("/api/invite/claim", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);
    const code = String(req.body?.code || "");
    const out = await claimInviteCode(uid, code);

    res.json(out);
  } catch (e: any) {
    const msg = String(e?.message || "unknown_error");
    const status =
      msg === "invite_code_invalid" ? 404 :
      msg === "invite_already_claimed" ? 409 :
      msg === "cannot_invite_self" ? 400 : 400;

    res.status(status).json({ ok: false, error: msg });
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


const DAILY_REWARDS = [...DAILY_REWARD_COINS];

function rewardForDay(day:number){
  return getDailyRewardCoinsForDay(day);
}

function isoDateUTC(input: Date | string) {
  return new Date(input).toISOString().slice(0, 10);
}

function nextUtcDayStartMs(now = new Date()) {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0);
}

function dayDiffFromIsoDate(lastIsoDate: string, now = new Date()) {
  const last = new Date(`${lastIsoDate}T00:00:00.000Z`);
  const today = new Date(`${isoDateUTC(now)}T00:00:00.000Z`);
  return Math.floor((today.getTime() - last.getTime()) / 86400000);
}

function inferMissedDaysFromLastClaim(user: any, now = new Date()) {
  const currentDay = Number(user?.daily_streak ?? 0) || 0;
  const lastClaimIso = user?.last_daily_claim_date
    ? isoDateUTC(user.last_daily_claim_date)
    : null;

  if (!lastClaimIso) return [] as number[];

  const diffDays = dayDiffFromIsoDate(lastClaimIso, now);
  if (diffDays <= 1) return [] as number[];

  const todayDayLegacy = Math.min(currentDay + Math.max(diffDays, 1), 7);
  const out: number[] = [];

  for (let d = currentDay + 1; d < todayDayLegacy; d++) {
    if (d >= 1 && d <= 7) out.push(d);
  }

  return out;
}

function inferTodayDayFromLastClaim(user: any, now = new Date()) {
  const currentDay = Number(user?.daily_streak ?? 0) || 0;
  const lastClaimIso = user?.last_daily_claim_date
    ? isoDateUTC(user.last_daily_claim_date)
    : null;

  if (!lastClaimIso) return 0;

  const diffDays = dayDiffFromIsoDate(lastClaimIso, now);
  if (diffDays <= 0) return 0;

  return Math.min(currentDay + Math.max(diffDays, 1), 7);
}

function buildDailyClaimPlan(user: any, now = new Date()) {
  const currentStreak = Number(user?.daily_streak ?? 0) || 0;
  const lastClaimIso = user?.last_daily_claim_date
    ? isoDateUTC(user.last_daily_claim_date)
    : null;

  if (!lastClaimIso) {
    return { already: false, nextDay: 1, resetCycle: false };
  }

  const diffDays = dayDiffFromIsoDate(lastClaimIso, now);

  if (diffDays <= 0) {
    return { already: true, nextDay: 0, resetCycle: false };
  }

  if (diffDays === 1) {
    return {
      already: false,
      nextDay: Math.min(currentStreak + 1, 7),
      resetCycle: false,
    };
  }

  return { already: false, nextDay: 1, resetCycle: true };
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
         monthly_mystery_boxes_opened = COALESCE(monthly_mystery_boxes_opened,0) + 1,
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
    try { await incrementDailyUserStats(uid, { coinsEarned: reward }); } catch {}
    try { await recalcAndStoreMonthlyRate(uid); } catch {}

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
});
app.post("/api/daily-reward/recover", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);

    await pool.query("BEGIN");

    // lock user row while updating coins
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

    const missedRes = await pool.query(
      `SELECT day
       FROM daily_reward_missed_days
       WHERE uid = $1 AND is_recovered = FALSE
       ORDER BY day ASC
       LIMIT 1`,
      [uid]
    );

    let missedDay = Number(missedRes.rows[0]?.day ?? 0);
    if (
      (!Number.isInteger(missedDay) || missedDay < 1 || missedDay > 7) &&
      ALLOW_INFERRED_MISSED_FOR_TEST
    ) {
      missedDay = inferMissedDaysFromLastClaim(user)[0] ?? 0;
    }

    if (!Number.isInteger(missedDay) || missedDay < 1 || missedDay > 7) {
      await pool.query("ROLLBACK");
      return res.status(400).json({ ok: false, error: "no_missed_day" });
    }

    if (missedRes.rowCount && Number(missedRes.rows[0]?.day) === missedDay) {
      await pool.query(
        `UPDATE daily_reward_missed_days
         SET is_recovered = TRUE
         WHERE uid = $1 AND day = $2`,
        [uid, missedDay]
      );
    } else {
      await pool.query(
        `INSERT INTO daily_reward_missed_days (uid, day, is_recovered)
         VALUES ($1, $2, TRUE)
         ON CONFLICT (uid, day) DO UPDATE SET is_recovered = TRUE`,
        [uid, missedDay]
      );
    }

    const rewardCoins = dailyRewardCoinsForDay(missedDay);

    await pool.query(
      `UPDATE public.users
       SET coins = coins + $2
       WHERE uid = $1`,
      [uid, rewardCoins]
    );

    await pool.query("COMMIT");
    try { await incrementDailyUserStats(uid, { coinsEarned: rewardCoins, adsWatched: 1 }); } catch {}
    try { await recalcAndStoreMonthlyRate(uid); } catch {}

    const updatedRes = await pool.query(
      `SELECT * FROM public.users WHERE uid = $1`,
      [uid]
    );

    return res.json({
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

    const plan = buildDailyClaimPlan(user);

    if (plan.already) {
      await pool.query("ROLLBACK");
      return res.json({ ok: true, already: true });
    }

    const inferredTodayDay =
      ALLOW_INFERRED_MISSED_FOR_TEST ? inferTodayDayFromLastClaim(user) : 0;

    const targetDay = Math.max(plan.nextDay, inferredTodayDay);
    const inferredMissed =
      ALLOW_INFERRED_MISSED_FOR_TEST ? inferMissedDaysFromLastClaim(user) : [];

    if (targetDay === 7 && inferredMissed.length > 0) {
      for (const missedDay of inferredMissed) {
        await pool.query(
          `INSERT INTO daily_reward_missed_days (uid, day, is_recovered)
           VALUES ($1, $2, FALSE)
           ON CONFLICT (uid, day) DO NOTHING`,
          [uid, missedDay]
        );
      }
    }

    if (targetDay === 1 && plan.resetCycle) {
      await pool.query(
        `DELETE FROM daily_reward_missed_days
         WHERE uid = $1`,
        [uid]
      );
    }

    let unresolvedMissedDays: number[] = [];

    if (targetDay === 7) {
      const unresolvedRes = await pool.query(
        `SELECT day
         FROM daily_reward_missed_days
         WHERE uid = $1 AND is_recovered = FALSE
         ORDER BY day ASC`,
        [uid]
      );

      unresolvedMissedDays = unresolvedRes.rows
        .map((r: any) => Number(r.day))
        .filter((n: number) => Number.isInteger(n) && n >= 1 && n <= 7);
    }

    const rewardCoins = dailyRewardCoinsForDay(targetDay);
    const mysteryChestReady = targetDay === 7 && unresolvedMissedDays.length === 0;

    await pool.query(
      `UPDATE public.users
       SET coins = coins + $2,
           daily_streak = $3,
           monthly_login_days = COALESCE(monthly_login_days,0) + 1,
           last_daily_claim_date = CURRENT_DATE,
           mystery_box_pending = $4
       WHERE uid = $1`,
      [uid, rewardCoins, targetDay, mysteryChestReady]
    );

    await pool.query("COMMIT");
    try { await incrementDailyUserStats(uid, { coinsEarned: rewardCoins }); } catch {}
    try { await recalcAndStoreMonthlyRate(uid); } catch {}

    const updatedRes = await pool.query(
      `SELECT * FROM public.users WHERE uid = $1`,
      [uid]
    );

    return res.json({
      ok: true,
      day: targetDay,
      coinsAwarded: rewardCoins,
      mysteryChestReady,
      needsRecoveryDecision: targetDay === 7 && !mysteryChestReady,
      missedDay:
        targetDay === 7 && unresolvedMissedDays.length > 0
          ? {
              day: unresolvedMissedDays[0],
              coins: dailyRewardCoinsForDay(unresolvedMissedDays[0]),
            }
          : null,
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
      if (!ALLOW_INFERRED_MISSED_FOR_TEST) {
        await pool.query("ROLLBACK");
        return res.status(400).json({ ok: false, error: "no_missed_day" });
      }

      const inferredDays = inferMissedDaysFromLastClaim(user);
      if (!inferredDays.includes(day)) {
        await pool.query("ROLLBACK");
        return res.status(400).json({ ok: false, error: "no_missed_day" });
      }

      await pool.query(
        `INSERT INTO daily_reward_missed_days (uid, day, is_recovered)
         VALUES ($1, $2, TRUE)
         ON CONFLICT (uid, day) DO UPDATE SET is_recovered = TRUE`,
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

    let mysteryChestReady = false;

    const unresolvedRes = await pool.query(
      `SELECT 1
       FROM daily_reward_missed_days
       WHERE uid = $1 AND is_recovered = FALSE
       LIMIT 1`,
      [uid]
    );

    const unresolvedLeft = (unresolvedRes.rowCount ?? 0) > 0;
    const lastClaimIso = user?.last_daily_claim_date ? isoDateUTC(user.last_daily_claim_date) : null;
    const todayIso = isoDateUTC(new Date());

    if (!unresolvedLeft && Number(user?.daily_streak ?? 0) >= 7 && lastClaimIso === todayIso) {
      await pool.query(
        `UPDATE public.users
         SET mystery_box_pending = TRUE
         WHERE uid = $1`,
        [uid]
      );
      mysteryChestReady = true;
    }

    await pool.query("COMMIT");
    try { await incrementDailyUserStats(uid, { coinsEarned: coins, adsWatched: 1 }); } catch {}
    try { await recalcAndStoreMonthlyRate(uid); } catch {}

    const updated = await pool.query(
      `SELECT * FROM public.users WHERE uid = $1`,
      [uid]
    );

    res.json({
      ok: true,
      recoveredDay: day,
      coinsAwarded: coins,
      mysteryChestReady,
      user: updated.rows[0],
    });
  } catch (e: any) {
    await pool.query("ROLLBACK");
    res.status(400).json({ ok: false, error: e.message });
  }
});
app.post("/api/daily-reward/ignore-missed", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);

    await pool.query("BEGIN");

    await pool.query(
      `UPDATE public.users
       SET daily_streak = 0,
           mystery_box_pending = FALSE
       WHERE uid = $1`,
      [uid]
    );

    await pool.query(
      `DELETE FROM daily_reward_missed_days
       WHERE uid = $1`,
      [uid]
    );

    await pool.query("COMMIT");
    try { await recalcAndStoreMonthlyRate(uid); } catch {}

    const updated = await pool.query(
      `SELECT * FROM public.users WHERE uid = $1`,
      [uid]
    );

    res.json({ ok: true, user: updated.rows[0] });
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
  return getMysteryChestRewardFromRoll(Math.random());
}
function dailyRewardCoinsForDay(day: number) {
  return getDailyRewardCoinsForDay(day);
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
await ensureInviteCode(uid);
await syncMcBalanceFromLegacyCoins(uid);
await resetDailyRPIfNeeded(uid);

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
  if (!runtimeConfig.admin.secret) throw new Error("ADMIN_SECRET missing");
  if (secret !== runtimeConfig.admin.secret) throw new Error("Unauthorized");
}

function requireAdminSettlementEnabled() {
  if (!runtimeConfig.admin.settlementEnabled) {
    throw new Error("admin_settlement_disabled");
  }
}


function requestIp(req: express.Request) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const realIp = String(req.headers["x-real-ip"] || "").trim();
  const candidate = forwarded || realIp || req.ip || "";
  return candidate.replace(/^::ffff:/, "");
}

function headerValue(req: express.Request, key: string): string | null {
  const v = req.headers[key.toLowerCase() as keyof typeof req.headers] as any;
  if (Array.isArray(v)) return String(v[0] || "").trim() || null;
  const s = String(v || "").trim();
  return s || null;
}

function boolHeader(req: express.Request, key: string): boolean {
  const v = (headerValue(req, key) || "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function getAdRequestMeta(req: express.Request) {
  return {
    ip: requestIp(req) || null,
    user_agent: headerValue(req, "user-agent") || null,
    country: headerValue(req, "cf-ipcountry") || headerValue(req, "x-country") || null,
    asn: headerValue(req, "x-asn") || null,
    isp: headerValue(req, "x-isp") || null,
    is_vpn: boolHeader(req, "x-vpn") || boolHeader(req, "x-ip-vpn"),
  };
}

function getAdRewardCoins(adsWatchedToday: number) {
  return getAdRewardCoinsForDailyCount(adsWatchedToday);
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
    try { await recalcAndStoreMonthlyRate(uid); } catch {}

    const out = await claimMonthlyRewards(uid, { month });
res.json(out);
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.get("/api/leaderboard", async (req, res) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;
    const out = await getMonthlyLeaderboard({ limit, offset });
    res.json(out);
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.get("/api/leaderboard/me", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);
    const out = await getMonthlyLeaderboardMe(uid);
    res.json(out);
  } catch (e: any) {
    res.status(401).json({ ok: false, error: e.message });
  }
});

app.get("/api/leaderboard/monthly", async (req, res) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;
    const out = await getMonthlyLeaderboard({ limit, offset });
    res.json(out);
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.get("/api/leaderboard/monthly/me", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);
    const out = await getMonthlyLeaderboardMe(uid);
    res.json(out);
  } catch (e: any) {
    res.status(401).json({ ok: false, error: e.message });
  }
});

app.get("/api/leaderboard/daily", async (req, res) => {
  try {
    const out = await getDailyLeaderboard(20);
    const serverTimeMs = Date.now();
    const nextDailyResetAtMs = nextUtcDayStartMs(new Date(serverTimeMs));
    res.json({ ok: true, rows: out.rows || [], server_time_ms: serverTimeMs, next_daily_reset_at_ms: nextDailyResetAtMs });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.get("/api/leaderboard/daily/me", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);
    const out = await getDailyLeaderboardMe(uid);
    const serverTimeMs = Date.now();
    const nextDailyResetAtMs = nextUtcDayStartMs(new Date(serverTimeMs));
    res.json({ ok: true, row: out.row, server_time_ms: serverTimeMs, next_daily_reset_at_ms: nextDailyResetAtMs });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e.message });
  }
});


app.get("/api/leaderboard/daily-reward/me", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);
    const out = await getDailyLeaderboardRewardMe(uid);
    res.json(out);
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post("/api/leaderboard/daily-reward/claim", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);
    const out = await claimDailyLeaderboardReward(uid);
    if (!out?.ok) {
      return res.status(400).json(out);
    }
    res.json(out);
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post("/admin/leaderboard/daily-reward/snapshot", async (req, res) => {
  try {
    requireAdmin(req);
    const dateKey = req.query.date ? String(req.query.date) : (req.body?.date ? String(req.body.date) : null);
    const out = await snapshotDailyLeaderboardRewards({ dateKey });
    res.json(out);
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.get("/admin/leaderboard/daily-reward/raw", async (req, res) => {
  try {
    requireAdmin(req);
    const dateKey = req.query.date ? String(req.query.date) : null;
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    const out = await adminGetDailyLeaderboardRewardRaw({ dateKey, limit });
    res.json(out);
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.get("/admin/leaderboard/daily/raw", async (req, res) => {
  try {
    requireAdmin(req);
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    const out = await getDailyLeaderboardRaw(limit);
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

    const levelRes = await pool.query(`SELECT level FROM public.progress WHERE uid = $1 LIMIT 1`, [uid]);
    const levelBefore = Number(levelRes.rows[0]?.level || 1);
    const adStateRes = await pool.query(`SELECT ads_watched_today FROM public.users WHERE uid = $1 LIMIT 1`, [uid]);
    const adsWatchedToday = Number(adStateRes.rows[0]?.ads_watched_today || 0);
    const rewardCoins = getAdRewardCoins(adsWatchedToday);

    const out = await claimReward({
      uid,
      type:"ad_50",
      nonce,
      amount:rewardCoins,
      cooldownSeconds:180,
    });

    if (!out?.already) {
      try {
        await trackRewardedAdActivity({
          uid,
          ...getAdRequestMeta(req),
          ad_type: "ad_50",
          level_before: levelBefore,
          level_after: levelBefore,
        });
      } catch {}
    }

    res.json({ ok:true, already:!!out?.already, rewardCoins, user:out?.user });
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

    const usedHint = req.body?.usedHint === true;
    const usedSkip = req.body?.usedSkip === true;

    const out = await claimLevelComplete(uid, level, { usedHint, usedSkip });

    res.json({ ok:true, already:!!out?.already, user:out?.user, rewards: out?.rewards || null });

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
      `SELECT restarts_balance, mc_balance, rp_score, daily_rp, ads_watched_today FROM public.users WHERE uid=$1 FOR UPDATE`,
      [uid]
    );

    const progressRes = await pool.query(
      `SELECT free_restarts_used, level FROM progress WHERE uid=$1 FOR UPDATE`,
      [uid]
    );

    const user = userRes.rows[0];
    const progress = progressRes.rows[0];

    if (!user || !progress) {
      throw new Error("User or progress not found");
    }

    const FREE_RESTART_LIMIT = FREE_RESTARTS_PER_ACCOUNT;
    const RESTART_PRICE = RESTART_MC_COST;

    let usedFree = false;
    let usedAd = false;
    const adLevelBefore = Number(progress?.level ?? 1);
    const rewardCoins = getAdRewardCoins(Number(user?.ads_watched_today || 0));

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
      const spendRes = await pool.query(
        `UPDATE public.users
         SET mc_balance = COALESCE(mc_balance, 0) - $1
         WHERE uid = $2 AND COALESCE(mc_balance, 0) >= $1
         RETURNING mc_balance, rp_score, daily_rp`,
        [RESTART_PRICE, uid]
      );

      if (!(spendRes.rowCount ?? 0)) {
        throw new Error("NOT_ENOUGH_COINS");
      }

    } else if (mode === "ad") {
      if (!nonce) {
        throw new Error("missing_nonce");
      }

      const reward = await claimReward({
        uid,
        type: "restart_ad",
        nonce,
        amount: rewardCoins,
        cooldownSeconds: 30,
      });

      if (reward?.already) {
        throw new Error("Ad reward already used");
      }
      usedAd = true;

    } else {
      throw new Error("No restarts available");
    }

    await pool.query(
      `UPDATE public.users
       SET monthly_restarts_used = COALESCE(monthly_restarts_used,0) + 1
       WHERE uid=$1`,
      [uid]
    );

    await pool.query("COMMIT");
    try { await recalcAndStoreMonthlyRate(uid); } catch {}
    if (usedAd) {
      try {
        await trackRewardedAdActivity({
          uid,
          ...getAdRequestMeta(req),
          ad_type: "restart_ad",
          level_before: adLevelBefore,
          level_after: adLevelBefore,
        });
      } catch {}
    }

    const updatedUser = await pool.query(
      `SELECT restarts_balance, mc_balance, rp_score, daily_rp FROM public.users WHERE uid=$1`,
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
      coins: updatedUser.rows[0].mc_balance,
      mcBalance: updatedUser.rows[0].mc_balance,
      rpScore: updatedUser.rows[0].rp_score,
      dailyRp: updatedUser.rows[0].daily_rp,
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
      `SELECT uid, coins, daily_streak, last_daily_claim_date, mystery_box_pending
       FROM public.users
       WHERE uid = $1
       FOR UPDATE`,
      [uid]
    );

    const user = userRes.rows[0];
    if (!user) {
      throw new Error("user_not_found");
    }

    const plan = buildDailyClaimPlan(user);

    if (plan.already) {
      await pool.query("ROLLBACK");
      return res.json({ ok: true, already: true });
    }

    if (plan.resetCycle) {
      await pool.query(
        `DELETE FROM daily_reward_missed_days
         WHERE uid = $1`,
        [uid]
      );
    }

    const reward = dailyRewardCoinsForDay(plan.nextDay);

    await pool.query(
      `UPDATE public.users
       SET coins = coins + $1,
           daily_streak = $2,
           monthly_login_days = COALESCE(monthly_login_days,0) + 1,
           last_daily_claim_date = CURRENT_DATE,
           mystery_box_pending = CASE WHEN $2 = 7 THEN TRUE ELSE FALSE END
       WHERE uid = $3`,
      [reward, plan.nextDay, uid]
    );

    const updated = await pool.query(
      `SELECT coins, daily_streak, mystery_box_pending
       FROM public.users
       WHERE uid=$1`,
      [uid]
    );

    await pool.query("COMMIT");
    try { await incrementDailyUserStats(uid, { coinsEarned: reward }); } catch {}
    try { await recalcAndStoreMonthlyRate(uid); } catch {}

    res.json({
      day: plan.nextDay,
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
      `SELECT skips_balance, mc_balance, rp_score, daily_rp, ads_watched_today FROM public.users WHERE uid=$1 FOR UPDATE`,
      [uid]
    );
    const progressRes = await pool.query(
      `SELECT free_skips_used, level FROM progress WHERE uid=$1 FOR UPDATE`,
      [uid]
    );

    const user = userRes.rows[0];
    const progress = progressRes.rows[0];

    if (!user || !progress) {
      throw new Error("User or progress not found");
    }

    const FREE_SKIP_LIMIT = FREE_SKIPS_PER_ACCOUNT;
    const SKIP_PRICE = SKIP_MC_COST;

    let usedFree = false;
    let usedAd = false;
    const adLevelBefore = Number(progress?.level ?? 1);
    const rewardCoins = getAdRewardCoins(Number(user?.ads_watched_today || 0));

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
      const spendRes = await pool.query(
        `UPDATE public.users
         SET mc_balance = COALESCE(mc_balance, 0) - $1
         WHERE uid = $2 AND COALESCE(mc_balance, 0) >= $1
         RETURNING mc_balance, rp_score, daily_rp`,
        [SKIP_PRICE, uid]
      );

      if (!(spendRes.rowCount ?? 0)) {
        throw new Error("NOT_ENOUGH_COINS");
      }

    } else if (mode === "ad") {
      if (!nonce) {
        throw new Error("missing_nonce");
      }

      const reward = await claimReward({
        uid,
        type: "skip_ad",
        nonce,
        amount: rewardCoins,
        cooldownSeconds: 30,
      });

      if (reward?.already) {
        throw new Error("Ad reward already used");
      }
      usedAd = true;

    } else {
      throw new Error("No skips available");
    }

    await pool.query(
      `UPDATE public.users
       SET monthly_skips_used = COALESCE(monthly_skips_used,0) + 1
       WHERE uid=$1`,
      [uid]
    );

    await pool.query("COMMIT");
    try { await recalcAndStoreMonthlyRate(uid); } catch {}
    if (usedAd) {
      try {
        await trackRewardedAdActivity({
          uid,
          ...getAdRequestMeta(req),
          ad_type: "skip_ad",
          level_before: adLevelBefore,
          level_after: adLevelBefore,
        });
      } catch {}
    }

    const updatedUser = await pool.query(
      `SELECT skips_balance, mc_balance, rp_score, daily_rp FROM public.users WHERE uid=$1`,
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
      coins: updatedUser.rows[0].mc_balance,
      mcBalance: updatedUser.rows[0].mc_balance,
      rpScore: updatedUser.rows[0].rp_score,
      dailyRp: updatedUser.rows[0].daily_rp,
      usedFree,
    });

  } catch (e: any) {
    await pool.query("ROLLBACK");
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post("/api/hint", async (req, res) => {
  try {
    const { uid } = await requirePiUser(req);
    const nonce = String(req.body?.nonce || "");
    const mode = String(req.body?.mode || "");

    await pool.query("BEGIN");

    const userRes = await pool.query(
      `SELECT hints_balance, mc_balance, rp_score, daily_rp, ads_watched_today FROM public.users WHERE uid=$1 FOR UPDATE`,
      [uid]
    );

    const progressRes = await pool.query(
      `SELECT free_hints_used, level FROM progress WHERE uid=$1 FOR UPDATE`,
      [uid]
    );

    const user = userRes.rows[0];
    const progress = progressRes.rows[0];

    if (!user || !progress) {
      throw new Error("User or progress not found");
    }

    const FREE_HINT_LIMIT = FREE_HINTS_PER_ACCOUNT;
    const HINT_PRICE = HINT_MC_COST;

    let usedFree = false;
    let usedAd = false;
    const adLevelBefore = Number(progress?.level ?? 1);
    const rewardCoins = getAdRewardCoins(Number(user?.ads_watched_today || 0));

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
      const spendRes = await pool.query(
        `UPDATE public.users
         SET mc_balance = COALESCE(mc_balance, 0) - $1
         WHERE uid = $2 AND COALESCE(mc_balance, 0) >= $1
         RETURNING mc_balance, rp_score, daily_rp`,
        [HINT_PRICE, uid]
      );

      if (!(spendRes.rowCount ?? 0)) {
        throw new Error("NOT_ENOUGH_COINS");
      }

    } else if (mode === "ad") {
      if (!nonce) {
        throw new Error("missing_nonce");
      }

      const reward = await claimReward({
        uid,
        type: "hint_ad",
        nonce,
        amount: rewardCoins,
        cooldownSeconds: 30,
      });

      if (reward?.already) {
        throw new Error("Ad reward already used");
      }
      usedAd = true;

    } else {
      throw new Error("No hints available");
    }

    await pool.query(
      `UPDATE public.users
       SET monthly_hints_used = COALESCE(monthly_hints_used,0) + 1
       WHERE uid=$1`,
      [uid]
    );

    await pool.query("COMMIT");
    try { await recalcAndStoreMonthlyRate(uid); } catch {}
    if (usedAd) {
      try {
        await trackRewardedAdActivity({
          uid,
          ...getAdRequestMeta(req),
          ad_type: "hint_ad",
          level_before: adLevelBefore,
          level_after: adLevelBefore,
        });
      } catch {}
    }

    const updatedUser = await pool.query(
      `SELECT hints_balance, mc_balance, rp_score, daily_rp FROM public.users WHERE uid=$1`,
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
      coins: updatedUser.rows[0].mc_balance,
      mcBalance: updatedUser.rows[0].mc_balance,
      rpScore: updatedUser.rows[0].rp_score,
      dailyRp: updatedUser.rows[0].daily_rp,
      usedFree,
    });

  } catch (e: any) {
    await pool.query("ROLLBACK");
    res.status(400).json({ ok: false, error: e.message });
  }
});

/* ---------------- ADMIN: month close ---------------- */
app.get("/admin/settlement/preview", async (req,res)=>{
  try{
    requireAdmin(req);
    requireAdminSettlementEnabled();
    const monthKey = req.query.month_key ? String(req.query.month_key) : undefined;
    const out = await adminPreviewSettlement({ monthKey });
    res.json(out);
  }catch(e:any){
    res.status(400).json({ok:false,error:e.message});
  }
});

app.get("/admin/settlement/status", async (req,res)=>{
  try{
    requireAdmin(req);
    const monthKey = req.query.month_key ? String(req.query.month_key) : undefined;
    const out = await adminGetSettlementStatus({ monthKey });
    res.json(out);
  }catch(e:any){
    res.status(400).json({ok:false,error:e.message});
  }
});

app.post("/admin/month-close", async (req,res)=>{
  try{
    requireAdmin(req);
    requireAdminSettlementEnabled();
    const monthKey = req.body?.month_key ? String(req.body.month_key) : undefined;
    const conversionRateLocked = Number(req.body?.conversion_rate_locked);
    const minPayoutThresholdPi = Number(req.body?.min_payout_threshold_pi ?? 0);

    const out = await closeMonthlyPayoutCycle({
      monthKey,
      conversionRateLocked,
      minPayoutThresholdPi,
    });

    res.json(out);
  }catch(e:any){
    res.status(400).json({ok:false,error:e.message});
  }
});

app.post("/admin/payouts/generate", async (req,res)=>{
  try{
    requireAdmin(req);
    const cycleId = req.body?.cycle_id ? Number(req.body.cycle_id) : undefined;
    const monthKey = req.body?.month_key ? String(req.body.month_key) : undefined;
    const out = await generatePayoutJobs({ cycleId, monthKey });
    res.json(out);
  }catch(e:any){
    res.status(400).json({ ok:false, error:e.message });
  }
});

app.get("/admin/payouts/jobs", async (req,res)=>{
  try{
    requireAdmin(req);
    const cycleId = req.query.cycle_id ? Number(req.query.cycle_id) : undefined;
    const monthKey = req.query.month_key ? String(req.query.month_key) : undefined;
    const status = req.query.status ? String(req.query.status) : undefined;
    const uidSearch = req.query.uid ? String(req.query.uid) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;

    const out = await adminListPayoutJobs({
      cycleId,
      monthKey,
      status: status as any,
      uidSearch,
      limit,
      offset,
    });

    res.json(out);
  }catch(e:any){
    res.status(400).json({ ok:false, error:e.message });
  }
});


app.get("/admin/payouts/cycles", async (req,res)=>{
  try{
    requireAdmin(req);
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const out = await adminListPayoutCycles({ limit });
    res.json(out);
  }catch(e:any){
    res.status(400).json({ ok:false, error:e.message });
  }
});

app.get("/admin/payouts/summary", async (req,res)=>{
  try{
    requireAdmin(req);
    const cycleId = req.query.cycle_id ? Number(req.query.cycle_id) : undefined;
    const monthKey = req.query.month_key ? String(req.query.month_key) : undefined;
    const out = await adminGetPayoutSnapshotSummary({ cycleId, monthKey });
    res.json(out);
  }catch(e:any){
    res.status(400).json({ ok:false, error:e.message });
  }
});

app.get("/admin/payouts/config", async (req,res)=>{
  try{
    requireAdmin(req);
    const out = await adminGetPayoutRuntimeConfig();
    res.json(out);
  }catch(e:any){
    res.status(400).json({ ok:false, error:e.message });
  }
});

app.post("/admin/payouts/config/simulation", async (req,res)=>{
  try{
    requireAdmin(req);
    const enabled = String(req.body?.enabled || "").toLowerCase();
    const out = await adminSetPayoutSimulationMode(enabled === "true" || enabled === "1");
    res.json(out);
  }catch(e:any){
    res.status(400).json({ ok:false, error:e.message });
  }
});

app.get("/admin/payouts/snapshots", async (req,res)=>{
  try{
    requireAdmin(req);
    const cycleId = req.query.cycle_id ? Number(req.query.cycle_id) : undefined;
    const monthKey = req.query.month_key ? String(req.query.month_key) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;
    const out = await adminListPayoutSnapshots({ cycleId, monthKey, limit, offset });
    res.json(out);
  }catch(e:any){
    res.status(400).json({ ok:false, error:e.message });
  }
});

app.post("/admin/payouts/retry", async (req,res)=>{
  try{
    requireAdmin(req);
    const monthKey = req.body?.month_key ? String(req.body.month_key) : undefined;
    const out = await adminRetryFailedPayouts({ monthKey });
    res.json(out);
  }catch(e:any){
    res.status(400).json({ ok:false, error:e.message });
  }
});

app.post("/admin/payouts/requeue", async (req,res)=>{
  try{
    requireAdmin(req);
    const jobId = Number(req.body?.job_id || 0);
    const out = await adminRequeueFailedPayoutJob(jobId);
    res.json(out);
  }catch(e:any){
    res.status(400).json({ ok:false, error:e.message });
  }
});

app.post("/admin/payouts/jobs/:id/resolve", async (req,res)=>{
  try{
    requireAdmin(req);
    const jobId = Number(req.params.id);
    const out = await adminResolvePayoutJob(jobId);
    res.json(out);
  }catch(e:any){
    res.status(400).json({ ok:false, error:e.message });
  }
});
app.post("/admin/payouts/jobs/:id/status", async (req,res)=>{
  try{
    requireAdmin(req);
    const jobId = Number(req.params.id);
    const status = String(req.body?.status || "");
    const txid = req.body?.txid ? String(req.body.txid) : undefined;
    const errorMessage = req.body?.error_message ? String(req.body.error_message) : undefined;

    const out = await adminUpdatePayoutJobStatus({
      jobId,
      status: status as any,
      txid,
      errorMessage,
    });

    res.json(out);
  }catch(e:any){
    res.status(400).json({ ok:false, error:e.message });
  }
});

app.get("/admin/payouts/jobs/:id/logs", async (req,res)=>{
  try{
    requireAdmin(req);
    const jobId = Number(req.params.id);
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const out = await adminListPayoutTransferLogs(jobId, limit);
    res.json(out);
  }catch(e:any){
    res.status(400).json({ ok:false, error:e.message });
  }
});

app.post("/admin/payouts/jobs/:id/requeue", async (req,res)=>{
  try{
    requireAdmin(req);
    const jobId = Number(req.params.id);
    const out = await adminRequeueFailedPayoutJob(jobId);
    res.json(out);
  }catch(e:any){
    res.status(400).json({ ok:false, error:e.message });
  }
});

app.post("/admin/payouts/worker/run", async (req,res)=>{
  try{
    requireAdmin(req);
    await adminSyncPayoutSimulationModeFromDb();
    const limit = req.body?.limit ? Number(req.body.limit) : undefined;
    const out = await runPayoutWorkerBatch({ limit });
    res.json(out);
  }catch(e:any){
    res.status(400).json({ ok:false, error:e.message });
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
    const suspiciousOnly = String(req.query.suspicious || "") === "1";
    const vpnOnly = String(req.query.vpn || "") === "1";
    const manualReviewOnly = String(req.query.manual_review || "") === "1";
    const payoutLockedOnly = String(req.query.payout_locked || "") === "1";
    const out = await adminListUsers({
      search,
      limit,
      offset,
      order,
      suspiciousOnly,
      vpnOnly,
      manualReviewOnly,
      payoutLockedOnly,
    });
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

app.post("/admin/users/:uid/payout-unlock", async (req,res)=>{
  try{
    requireAdmin(req);
    const out = await adminSetUserPayoutLock(String(req.params.uid), false);
    res.json(out);
  }catch(e:any){
    res.status(400).json({ ok:false, error:e.message });
  }
});

app.post("/admin/users/:uid/suspicious-clear", async (req,res)=>{
  try{
    requireAdmin(req);
    const out = await adminSetUserSuspicious(String(req.params.uid), false);
    res.json(out);
  }catch(e:any){
    res.status(400).json({ ok:false, error:e.message });
  }
});

app.post("/admin/users/:uid/manual-review", async (req,res)=>{
  try{
    requireAdmin(req);
    const enabled = String(req.body?.enabled || "1") !== "0";
    const out = await adminSetUserManualReview(String(req.params.uid), enabled);
    res.json(out);
  }catch(e:any){
    res.status(400).json({ ok:false, error:e.message });
  }
});

app.post("/admin/set-test-user", async (req,res)=>{
  try{
    requireAdmin(req);
    const uid = String(req.body?.uid || "").trim();
    if (!uid) throw new Error("missing_uid");
    if (typeof req.body?.isTestUser !== "boolean") throw new Error("missing_is_test_user");
    const out = await adminSetUserTestFlag(uid, Boolean(req.body.isTestUser));
    res.json(out);
  }catch(e:any){
    res.status(400).json({ ok:false, error:e.message });
  }
});

app.post("/admin/users/:uid/fraud-recompute", async (req,res)=>{
  try{
    requireAdmin(req);
    const out = await adminReevaluateUserFraud(String(req.params.uid));
    res.json(out);
  }catch(e:any){
    res.status(400).json({ ok:false, error:e.message });
  }
});

app.post("/admin/reset-user", async (req,res)=>{
  try{
    requireAdmin(req);
    const uid = String(req.body?.uid || "").trim();
    const reason = String(req.body?.reason || "").trim();
    if (!uid) throw new Error("missing_uid");
    if (!reason) throw new Error("missing_reason");
    const out = await adminResetUserState({
      uid,
      reason,
      adminIdentity: null,
    });
    res.json(out);
  }catch(e:any){
    res.status(400).json({ ok:false, error:e.message });
  }
});

app.post("/admin/users/:uid/economy-adjust", async (req,res)=>{
  try{
    requireAdmin(req);
    const out = await adminAdjustUserEconomy({
      uid: String(req.params.uid),
      target: String(req.body?.target || ""),
      operation: String(req.body?.operation || ""),
      amount: Number(req.body?.amount),
      reason: String(req.body?.reason || ""),
      adminIdentity: null,
    });
    res.json(out);
  }catch(e:any){
    res.status(400).json({ ok:false, error:e.message });
  }
});

app.post("/admin/users/:uid/coins/add", async (req,res)=>{
  try{
    requireAdmin(req);
    const delta = Number(req.body?.delta);
    if (!Number.isFinite(delta) || delta === 0) throw new Error("invalid_adjustment_amount");
    const out = await adminAdjustUserEconomy({
      uid: String(req.params.uid),
      target: "coins",
      operation: delta >= 0 ? "add" : "sub",
      amount: Math.abs(Math.trunc(delta)),
      reason: String(req.body?.reason || "legacy_admin_coins_add"),
      adminIdentity: null,
    });
    res.json(out);
  }catch(e:any){
    res.status(400).json({ ok:false, error:e.message });
  }
});

app.post("/admin/users/:uid/coins/set", async (req,res)=>{
  try{
    requireAdmin(req);
    const coins = Number(req.body?.coins);
    const out = await adminAdjustUserEconomy({
      uid: String(req.params.uid),
      target: "coins",
      operation: "set",
      amount: Math.trunc(coins),
      reason: String(req.body?.reason || "legacy_admin_coins_set"),
      adminIdentity: null,
    });
    res.json(out);
  }catch(e:any){
    res.status(400).json({ ok:false, error:e.message });
  }
});

app.post("/admin/users/:uid/coins/reset", async (req,res)=>{
  try{
    requireAdmin(req);
    const out = await adminAdjustUserEconomy({
      uid: String(req.params.uid),
      target: "coins",
      operation: "set",
      amount: 0,
      reason: String(req.body?.reason || "legacy_admin_coins_reset"),
      adminIdentity: null,
    });
    res.json(out);
  }catch(e:any){
    res.status(400).json({ ok:false, error:e.message });
  }
});

app.post("/admin/users/:uid/score/add", async (req,res)=>{
  try{
    requireAdmin(req);
    const delta = Number(req.body?.delta);
    if (!Number.isFinite(delta) || delta === 0) throw new Error("invalid_adjustment_amount");
    const out = await adminAdjustUserEconomy({
      uid: String(req.params.uid),
      target: "score",
      operation: delta >= 0 ? "add" : "sub",
      amount: Math.abs(Math.trunc(delta)),
      reason: String(req.body?.reason || ""),
      adminIdentity: null,
    });
    res.json(out);
  }catch(e:any){
    res.status(400).json({ ok:false, error:e.message });
  }
});

app.post("/admin/users/:uid/score/set", async (req,res)=>{
  try{
    requireAdmin(req);
    const score = Number(req.body?.score);
    const out = await adminAdjustUserEconomy({
      uid: String(req.params.uid),
      target: "score",
      operation: "set",
      amount: Math.trunc(score),
      reason: String(req.body?.reason || ""),
      adminIdentity: null,
    });
    res.json(out);
  }catch(e:any){
    res.status(400).json({ ok:false, error:e.message });
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
let lastAdResetDate = "";

async function maybeRunDailyAdReset() {
  const today = new Date().toISOString().slice(0, 10);
  if (today === lastAdResetDate) return;

  try {
    await resetDailyAdCounters();
    lastAdResetDate = today;
  } catch (e) {
    console.error("daily_ad_reset_failed", e);
  }
}
const PORT = runtimeConfig.server.port;

async function start() {
  try {
    await initDB();
    await maybeRunDailyAdReset();
    const info = await pool.query(`
      SELECT current_database(), inet_server_addr(), inet_server_port()
    `);
    setInterval(() => { void maybeRunDailyAdReset(); }, 60 * 60 * 1000);

    app.listen(PORT, "0.0.0.0", () => {
     
    });

  } catch (err) {
    console.error("Startup failed:", err);
    process.exit(1);
  }
}

start();













































