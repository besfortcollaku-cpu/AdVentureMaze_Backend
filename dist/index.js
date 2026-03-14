"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
process.on("unhandledRejection", (reason) => {
    console.error("UNHANDLED REJECTION:", reason);
});
process.on("uncaughtException", (err) => {
    console.error("UNCAUGHT EXCEPTION:", err);
});
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const db_1 = require("./db");
const app = (0, express_1.default)();
const ALLOW_INFERRED_MISSED_FOR_TEST = true;
/* ---------------- CORS ---------------- */
app.use((0, cors_1.default)({
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: [
        "Content-Type",
        "Authorization",
        "X-Admin-Secret"
    ]
}));
app.use(express_1.default.json());
/* ---------------- HEALTH ---------------- */
app.get("/health", (_req, res) => res.send("ok"));
app.get("/", (_req, res) => res.send("backend up"));
/* ---------------- /api/me ---------------- */
app.get("/api/me", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
        const { uid } = await requirePiUser(req);
        const userRes = await db_1.pool.query(`SELECT * FROM public.users WHERE uid = $1 LIMIT 1`, [uid]);
        const user = userRes.rows[0] ?? null;
        const progress = await (0, db_1.getProgressByUid)(uid);
        const today = new Date().toISOString().slice(0, 10);
        const lastClaim = user?.last_daily_claim_date
            ? new Date(user.last_daily_claim_date).toISOString().slice(0, 10)
            : null;
        const currentDay = Number(user?.daily_streak ?? 0) || 0;
        const claimPlan = user ? buildDailyClaimPlan(user) : null;
        const missedRowsRes = await db_1.pool.query(`SELECT day, is_recovered
   FROM daily_reward_missed_days
   WHERE uid = $1`, [uid]);
        const persistedMissedDays = missedRowsRes.rows
            .filter((r) => !r.is_recovered)
            .map((r) => Number(r.day))
            .filter((n) => Number.isInteger(n));
        const recoveredDays = missedRowsRes.rows
            .filter((r) => r.is_recovered)
            .map((r) => Number(r.day))
            .filter((n) => Number.isInteger(n));
        const testTodayDay = ALLOW_INFERRED_MISSED_FOR_TEST && user
            ? inferTodayDayFromLastClaim(user)
            : 0;
        const todayDay = user && claimPlan && !claimPlan.already
            ? Math.max(claimPlan.nextDay, testTodayDay)
            : 0;
        const derivedMissedDays = ALLOW_INFERRED_MISSED_FOR_TEST && user
            ? inferMissedDaysFromLastClaim(user).filter((day) => !recoveredDays.includes(day))
            : [];
        const missedDays = Array.from(new Set([...persistedMissedDays, ...derivedMissedDays])).filter((day) => !recoveredDays.includes(day));
        let dailyReward = {
            canClaim: false,
            day: 0,
            coins: 0,
            days: [],
            bonusState: "locked",
        };
        if (user && lastClaim !== today && todayDay > 0) {
            dailyReward.canClaim = true;
            dailyReward.day = todayDay;
            dailyReward.coins = dailyRewardCoinsForDay(todayDay);
        }
        for (let day = 1; day <= 7; day++) {
            let state = "upcoming";
            if (recoveredDays.includes(day)) {
                state = "recovered";
            }
            else if (missedDays.includes(day)) {
                state = "missed";
            }
            else if (day <= currentDay) {
                state = "claimed";
            }
            else if (day === todayDay && lastClaim !== today) {
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
                    // 🔹 paid balances (wallet)
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
    }
    catch (e) {
        res.status(401).json({ ok: false, error: e.message });
    }
});
app.get("/api/invite/me", async (req, res) => {
    try {
        const { uid } = await requirePiUser(req);
        const out = await (0, db_1.getInviteSummary)(uid);
        res.json({
            ok: true,
            ...out,
            invite_link: `https://pi-maze.com/?invite=${encodeURIComponent(out.invite_code)}`
        });
    }
    catch (e) {
        res.status(400).json({ ok: false, error: e.message });
    }
});
app.post("/api/invite/claim", async (req, res) => {
    try {
        const { uid } = await requirePiUser(req);
        const code = String(req.body?.code || "");
        const out = await (0, db_1.claimInviteCode)(uid, code);
        res.json(out);
    }
    catch (e) {
        const msg = String(e?.message || "unknown_error");
        const status = msg === "invite_code_invalid" ? 404 :
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
        const progressRes = await db_1.pool.query(`SELECT level FROM public.progress WHERE uid = $1 LIMIT 1`, [uid]);
        const currentSavedLevel = Number(progressRes.rows[0]?.level ?? 1);
        if (requestedLevel > currentSavedLevel + 1) {
            return res.status(403).json({ ok: false, error: "level_jump_blocked" });
        }
        const safeLevel = Math.max(currentSavedLevel, requestedLevel);
        // coins must come only from backend-owned users table
        const userRes = await db_1.pool.query(`SELECT coins FROM public.users WHERE uid = $1 LIMIT 1`, [uid]);
        const safeCoins = Number(userRes.rows[0]?.coins ?? 0);
        await (0, db_1.setProgressByUid)({
            uid,
            level: safeLevel,
            coins: safeCoins,
            paintedKeys,
            resume,
        });
        res.json({ ok: true, level: safeLevel, coins: safeCoins });
    }
    catch (e) {
        const message = e instanceof Error ? e.message : "Unknown error";
        res.status(400).json({ ok: false, error: message });
    }
});
/* ---------------- PROGRESS ---------------- */
const DAILY_REWARDS = [5, 7, 10, 15, 20, 30, 50];
function rewardForDay(day) {
    return DAILY_REWARDS[Math.min(day - 1, DAILY_REWARDS.length - 1)];
}
function isoDateUTC(input) {
    return new Date(input).toISOString().slice(0, 10);
}
function dayDiffFromIsoDate(lastIsoDate, now = new Date()) {
    const last = new Date(`${lastIsoDate}T00:00:00.000Z`);
    const today = new Date(`${isoDateUTC(now)}T00:00:00.000Z`);
    return Math.floor((today.getTime() - last.getTime()) / 86400000);
}
function inferMissedDaysFromLastClaim(user, now = new Date()) {
    const currentDay = Number(user?.daily_streak ?? 0) || 0;
    const lastClaimIso = user?.last_daily_claim_date
        ? isoDateUTC(user.last_daily_claim_date)
        : null;
    if (!lastClaimIso)
        return [];
    const diffDays = dayDiffFromIsoDate(lastClaimIso, now);
    if (diffDays <= 1)
        return [];
    const todayDayLegacy = Math.min(currentDay + Math.max(diffDays, 1), 7);
    const out = [];
    for (let d = currentDay + 1; d < todayDayLegacy; d++) {
        if (d >= 1 && d <= 7)
            out.push(d);
    }
    return out;
}
function inferTodayDayFromLastClaim(user, now = new Date()) {
    const currentDay = Number(user?.daily_streak ?? 0) || 0;
    const lastClaimIso = user?.last_daily_claim_date
        ? isoDateUTC(user.last_daily_claim_date)
        : null;
    if (!lastClaimIso)
        return 0;
    const diffDays = dayDiffFromIsoDate(lastClaimIso, now);
    if (diffDays <= 0)
        return 0;
    return Math.min(currentDay + Math.max(diffDays, 1), 7);
}
function buildDailyClaimPlan(user, now = new Date()) {
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
        await db_1.pool.query("BEGIN");
        const userRes = await db_1.pool.query(`SELECT uid, coins, daily_streak, last_daily_claim_date, mystery_box_pending
       FROM public.users
       WHERE uid = $1
       FOR UPDATE`, [uid]);
        const user = userRes.rows[0];
        if (!user || user.mystery_box_pending !== true) {
            await db_1.pool.query("ROLLBACK");
            throw new Error("not_available");
        }
        const reward = mysteryChestReward();
        await db_1.pool.query(`UPDATE public.users
       SET
         coins = coins + $1,
         daily_streak = 0,
         mystery_box_pending = FALSE,
         monthly_mystery_boxes_opened = COALESCE(monthly_mystery_boxes_opened,0) + 1,
         last_daily_claim_date = CURRENT_DATE
       WHERE uid = $2`, [reward, uid]);
        await db_1.pool.query(`DELETE FROM daily_reward_missed_days
       WHERE uid = $1`, [uid]);
        await db_1.pool.query("COMMIT");
        try {
            await (0, db_1.recalcAndStoreMonthlyRate)(uid);
        }
        catch { }
        const updated = await db_1.pool.query(`SELECT * FROM public.users WHERE uid = $1`, [uid]);
        res.json({
            ok: true,
            reward,
            user: updated.rows[0]
        });
    }
    catch (e) {
        await db_1.pool.query("ROLLBACK");
        res.status(400).json({ ok: false, error: e.message });
    }
});
app.post("/api/daily-reward/recover", async (req, res) => {
    try {
        const { uid } = await requirePiUser(req);
        await db_1.pool.query("BEGIN");
        // lock user row while updating coins
        const userRes = await db_1.pool.query(`SELECT uid, coins, daily_streak, last_daily_claim_date
       FROM public.users
       WHERE uid = $1
       FOR UPDATE`, [uid]);
        const user = userRes.rows[0];
        if (!user) {
            throw new Error("User not found");
        }
        const missedRes = await db_1.pool.query(`SELECT day
       FROM daily_reward_missed_days
       WHERE uid = $1 AND is_recovered = FALSE
       ORDER BY day ASC
       LIMIT 1`, [uid]);
        let missedDay = Number(missedRes.rows[0]?.day ?? 0);
        if ((!Number.isInteger(missedDay) || missedDay < 1 || missedDay > 7) &&
            ALLOW_INFERRED_MISSED_FOR_TEST) {
            missedDay = inferMissedDaysFromLastClaim(user)[0] ?? 0;
        }
        if (!Number.isInteger(missedDay) || missedDay < 1 || missedDay > 7) {
            await db_1.pool.query("ROLLBACK");
            return res.status(400).json({ ok: false, error: "no_missed_day" });
        }
        if (missedRes.rowCount && Number(missedRes.rows[0]?.day) === missedDay) {
            await db_1.pool.query(`UPDATE daily_reward_missed_days
         SET is_recovered = TRUE
         WHERE uid = $1 AND day = $2`, [uid, missedDay]);
        }
        else {
            await db_1.pool.query(`INSERT INTO daily_reward_missed_days (uid, day, is_recovered)
         VALUES ($1, $2, TRUE)
         ON CONFLICT (uid, day) DO UPDATE SET is_recovered = TRUE`, [uid, missedDay]);
        }
        const rewardCoins = dailyRewardCoinsForDay(missedDay);
        await db_1.pool.query(`UPDATE public.users
       SET coins = coins + $2
       WHERE uid = $1`, [uid, rewardCoins]);
        await db_1.pool.query("COMMIT");
        try {
            await (0, db_1.recalcAndStoreMonthlyRate)(uid);
        }
        catch { }
        const updatedRes = await db_1.pool.query(`SELECT * FROM public.users WHERE uid = $1`, [uid]);
        return res.json({
            ok: true,
            recoveredDay: missedDay,
            coinsAwarded: rewardCoins,
            user: updatedRes.rows[0],
        });
    }
    catch (e) {
        await db_1.pool.query("ROLLBACK");
        return res.status(400).json({ ok: false, error: e.message });
    }
});
app.post("/api/daily-reward/claim", async (req, res) => {
    try {
        const { uid } = await requirePiUser(req);
        await db_1.pool.query("BEGIN");
        const userRes = await db_1.pool.query(`SELECT uid, coins, daily_streak, last_daily_claim_date, mystery_box_pending
       FROM public.users
       WHERE uid = $1
       FOR UPDATE`, [uid]);
        const user = userRes.rows[0];
        if (!user) {
            throw new Error("User not found");
        }
        const plan = buildDailyClaimPlan(user);
        if (plan.already) {
            await db_1.pool.query("ROLLBACK");
            return res.json({ ok: true, already: true });
        }
        const inferredTodayDay = ALLOW_INFERRED_MISSED_FOR_TEST ? inferTodayDayFromLastClaim(user) : 0;
        const targetDay = Math.max(plan.nextDay, inferredTodayDay);
        const inferredMissed = ALLOW_INFERRED_MISSED_FOR_TEST ? inferMissedDaysFromLastClaim(user) : [];
        if (targetDay === 7 && inferredMissed.length > 0) {
            for (const missedDay of inferredMissed) {
                await db_1.pool.query(`INSERT INTO daily_reward_missed_days (uid, day, is_recovered)
           VALUES ($1, $2, FALSE)
           ON CONFLICT (uid, day) DO NOTHING`, [uid, missedDay]);
            }
        }
        if (targetDay === 1 && plan.resetCycle) {
            await db_1.pool.query(`DELETE FROM daily_reward_missed_days
         WHERE uid = $1`, [uid]);
        }
        let unresolvedMissedDays = [];
        if (targetDay === 7) {
            const unresolvedRes = await db_1.pool.query(`SELECT day
         FROM daily_reward_missed_days
         WHERE uid = $1 AND is_recovered = FALSE
         ORDER BY day ASC`, [uid]);
            unresolvedMissedDays = unresolvedRes.rows
                .map((r) => Number(r.day))
                .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
        }
        const rewardCoins = dailyRewardCoinsForDay(targetDay);
        const mysteryChestReady = targetDay === 7 && unresolvedMissedDays.length === 0;
        await db_1.pool.query(`UPDATE public.users
       SET coins = coins + $2,
           daily_streak = $3,
           monthly_login_days = COALESCE(monthly_login_days,0) + 1,
           last_daily_claim_date = CURRENT_DATE,
           mystery_box_pending = $4
       WHERE uid = $1`, [uid, rewardCoins, targetDay, mysteryChestReady]);
        await db_1.pool.query("COMMIT");
        try {
            await (0, db_1.recalcAndStoreMonthlyRate)(uid);
        }
        catch { }
        const updatedRes = await db_1.pool.query(`SELECT * FROM public.users WHERE uid = $1`, [uid]);
        return res.json({
            ok: true,
            day: targetDay,
            coinsAwarded: rewardCoins,
            mysteryChestReady,
            needsRecoveryDecision: targetDay === 7 && !mysteryChestReady,
            missedDay: targetDay === 7 && unresolvedMissedDays.length > 0
                ? {
                    day: unresolvedMissedDays[0],
                    coins: dailyRewardCoinsForDay(unresolvedMissedDays[0]),
                }
                : null,
            user: updatedRes.rows[0],
        });
    }
    catch (e) {
        await db_1.pool.query("ROLLBACK");
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
        await db_1.pool.query("BEGIN");
        const userRes = await db_1.pool.query(`SELECT uid, coins, daily_streak, last_daily_claim_date
       FROM public.users
       WHERE uid = $1
       FOR UPDATE`, [uid]);
        const user = userRes.rows[0];
        if (!user) {
            throw new Error("User not found");
        }
        const missedRes = await db_1.pool.query(`SELECT day, is_recovered
       FROM daily_reward_missed_days
       WHERE uid = $1 AND day = $2
       LIMIT 1`, [uid, day]);
        const missed = missedRes.rows[0];
        if (missed?.is_recovered) {
            await db_1.pool.query("ROLLBACK");
            return res.json({ ok: true, already: true });
        }
        if (!missed) {
            if (!ALLOW_INFERRED_MISSED_FOR_TEST) {
                await db_1.pool.query("ROLLBACK");
                return res.status(400).json({ ok: false, error: "no_missed_day" });
            }
            const inferredDays = inferMissedDaysFromLastClaim(user);
            if (!inferredDays.includes(day)) {
                await db_1.pool.query("ROLLBACK");
                return res.status(400).json({ ok: false, error: "no_missed_day" });
            }
            await db_1.pool.query(`INSERT INTO daily_reward_missed_days (uid, day, is_recovered)
         VALUES ($1, $2, TRUE)
         ON CONFLICT (uid, day) DO UPDATE SET is_recovered = TRUE`, [uid, day]);
        }
        else {
            await db_1.pool.query(`UPDATE daily_reward_missed_days
         SET is_recovered = TRUE
         WHERE uid = $1 AND day = $2`, [uid, day]);
        }
        const coins = dailyRewardCoinsForDay(day);
        await db_1.pool.query(`UPDATE public.users
       SET coins = coins + $1
       WHERE uid = $2`, [coins, uid]);
        let mysteryChestReady = false;
        const unresolvedRes = await db_1.pool.query(`SELECT 1
       FROM daily_reward_missed_days
       WHERE uid = $1 AND is_recovered = FALSE
       LIMIT 1`, [uid]);
        const unresolvedLeft = (unresolvedRes.rowCount ?? 0) > 0;
        const lastClaimIso = user?.last_daily_claim_date ? isoDateUTC(user.last_daily_claim_date) : null;
        const todayIso = isoDateUTC(new Date());
        if (!unresolvedLeft && Number(user?.daily_streak ?? 0) >= 7 && lastClaimIso === todayIso) {
            await db_1.pool.query(`UPDATE public.users
         SET mystery_box_pending = TRUE
         WHERE uid = $1`, [uid]);
            mysteryChestReady = true;
        }
        await db_1.pool.query("COMMIT");
        try {
            await (0, db_1.recalcAndStoreMonthlyRate)(uid);
        }
        catch { }
        const updated = await db_1.pool.query(`SELECT * FROM public.users WHERE uid = $1`, [uid]);
        res.json({
            ok: true,
            recoveredDay: day,
            coinsAwarded: coins,
            mysteryChestReady,
            user: updated.rows[0],
        });
    }
    catch (e) {
        await db_1.pool.query("ROLLBACK");
        res.status(400).json({ ok: false, error: e.message });
    }
});
app.post("/api/daily-reward/ignore-missed", async (req, res) => {
    try {
        const { uid } = await requirePiUser(req);
        await db_1.pool.query("BEGIN");
        await db_1.pool.query(`UPDATE public.users
       SET daily_streak = 0,
           mystery_box_pending = FALSE
       WHERE uid = $1`, [uid]);
        await db_1.pool.query(`DELETE FROM daily_reward_missed_days
       WHERE uid = $1`, [uid]);
        await db_1.pool.query("COMMIT");
        try {
            await (0, db_1.recalcAndStoreMonthlyRate)(uid);
        }
        catch { }
        const updated = await db_1.pool.query(`SELECT * FROM public.users WHERE uid = $1`, [uid]);
        res.json({ ok: true, user: updated.rows[0] });
    }
    catch (e) {
        await db_1.pool.query("ROLLBACK");
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
            return res.status(400).json({ ok: false, error: "Username must be 3–20 characters" });
        }
        // allow only letters, numbers, underscore
        if (!/^[a-zA-Z0-9_]+$/.test(username)) {
            return res.status(400).json({ ok: false, error: "Only letters, numbers and underscore allowed" });
        }
        // prevent duplicate usernames
        const existing = await db_1.pool.query(`SELECT uid FROM public.users WHERE LOWER(username)=LOWER($1) AND uid<>$2`, [username, uid]);
        if ((existing.rowCount ?? 0) > 0) {
            return res.status(400).json({ ok: false, error: "Username already taken" });
        }
        await db_1.pool.query(`UPDATE public.users SET username=$1 WHERE uid=$2`, [username, uid]);
        res.json({ ok: true, username });
    }
    catch (e) {
        res.status(401).json({ ok: false, error: e.message });
    }
});
/* ---------------- HELPERS ---------------- */
function mysteryChestReward() {
    const r = Math.random();
    if (r < 0.4)
        return 50;
    if (r < 0.7)
        return 100;
    if (r < 0.9)
        return 150;
    return 200;
}
function dailyRewardCoinsForDay(day) {
    const map = [5, 7, 10, 15, 20, 30, 50];
    return map[Math.max(0, Math.min(map.length - 1, day - 1))];
}
function nextDailyStreak(lastClaimDate, today) {
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
async function requirePiUser(req) {
    const token = getBearerToken(req);
    if (!token)
        throw new Error("Missing token");
    const piUser = await verifyPiAccessToken(token);
    const uid = String(piUser.uid);
    const username = String(piUser.username);
    await (0, db_1.upsertUser)({ uid, username });
    await (0, db_1.ensureMonthlyKey)(uid);
    // mark user online on ANY request
    await (0, db_1.touchUserOnline)(uid);
    return { uid, username };
}
function getBearerToken(req) {
    return String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
}
async function verifyPiAccessToken(accessToken) {
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
    }
    catch (err) {
        console.error("VERIFY ERROR:", err);
        throw err;
    }
    finally {
        clearTimeout(timeout);
    }
}
app.post("/api/consume", async (req, res) => {
    try {
        const { uid } = await requirePiUser(req);
        const { item, mode, nonce } = req.body || {};
        const out = await (0, db_1.consumeItem)(uid, item, mode, nonce);
        res.json(out);
    }
    catch (e) {
        res.status(400).json({ ok: false, error: e.message });
    }
});
/* ---------------- ADMIN AUTH ---------------- */
function requireAdmin(req) {
    const secret = String(req.headers["x-admin-secret"] || "");
    if (!process.env.ADMIN_SECRET)
        throw new Error("ADMIN_SECRET missing");
    if (secret !== process.env.ADMIN_SECRET)
        throw new Error("Unauthorized");
}
/* ---------------- PI VERIFY ---------------- */
app.post("/api/pi/verify", async (req, res) => {
    try {
        const token = req.body?.accessToken || getBearerToken(req);
        if (!token)
            return res.status(400).json({ ok: false });
        const piUser = await verifyPiAccessToken(token);
        const user = await (0, db_1.upsertUser)({
            uid: String(piUser.uid),
            username: String(piUser.username),
        });
        await (0, db_1.touchUserOnline)(user.uid);
        res.json({ ok: true, user });
    }
    catch (e) {
        res.status(401).json({ ok: false, error: e.message });
    }
});
app.post("/api/monthly/claim", async (req, res) => {
    try {
        const { uid } = await requirePiUser(req);
        const month = req.body?.month ? String(req.body.month) : undefined;
        // recalc before snapshot
        try {
            await (0, db_1.recalcAndStoreMonthlyRate)(uid);
        }
        catch { }
        const out = await (0, db_1.claimMonthlyRewards)(uid, { month });
        res.json(out);
    }
    catch (e) {
        res.status(400).json({ ok: false, error: e.message });
    }
});
/* ---------------- REWARDS ---------------- */
app.post("/api/rewards/ad-50", async (req, res) => {
    try {
        const { uid } = await requirePiUser(req);
        const nonce = String(req.body?.nonce || "");
        if (!nonce)
            return res.status(400).json({ ok: false });
        const out = await (0, db_1.claimReward)({
            uid,
            type: "ad_50",
            nonce,
            amount: 50,
            cooldownSeconds: 180,
        });
        res.json({ ok: true, already: !!out?.already, user: out?.user });
    }
    catch (e) {
        res.status(400).json({ ok: false, error: e.message });
    }
});
app.post("/api/rewards/level-complete", async (req, res) => {
    try {
        const { uid } = await requirePiUser(req);
        const level = Number(req.body?.level || 0);
        // security validation
        if (!Number.isInteger(level) || level < 1) {
            return res.status(400).json({ ok: false, error: "invalid_level" });
        }
        // anti-exploit: user may only claim reward for current reached level
        const progressRes = await db_1.pool.query(`SELECT level FROM public.progress WHERE uid = $1 LIMIT 1`, [uid]);
        const savedLevel = Number(progressRes.rows[0]?.level ?? 1);
        // allowed:
        // - exact current level
        // - previous levels already reached
        // blocked:
        // - future levels beyond current reached progress
        if (level > savedLevel) {
            return res.status(403).json({ ok: false, error: "level_not_reached" });
        }
        const out = await (0, db_1.claimLevelComplete)(uid, level);
        res.json({ ok: true, already: !!out?.already, user: out?.user });
    }
    catch (e) {
        res.status(400).json({ ok: false, error: e.message });
    }
});
app.post("/api/restart", async (req, res) => {
    try {
        const { uid } = await requirePiUser(req);
        const nonce = String(req.body?.nonce || "");
        const mode = String(req.body?.mode || "");
        await db_1.pool.query("BEGIN");
        const userRes = await db_1.pool.query(`SELECT restarts_balance, coins FROM public.users WHERE uid=$1 FOR UPDATE`, [uid]);
        const progressRes = await db_1.pool.query(`SELECT free_restarts_used FROM progress WHERE uid=$1 FOR UPDATE`, [uid]);
        const user = userRes.rows[0];
        const progress = progressRes.rows[0];
        if (!user || !progress) {
            throw new Error("User or progress not found");
        }
        const FREE_RESTART_LIMIT = 3;
        const RESTART_PRICE = 50;
        let usedFree = false;
        if ((progress.free_restarts_used ?? 0) < FREE_RESTART_LIMIT) {
            await db_1.pool.query(`UPDATE progress
         SET free_restarts_used = free_restarts_used + 1
         WHERE uid=$1`, [uid]);
            usedFree = true;
        }
        else if ((user.restarts_balance ?? 0) > 0) {
            await db_1.pool.query(`UPDATE public.users
         SET restarts_balance = restarts_balance - 1
         WHERE uid=$1`, [uid]);
        }
        else if (mode === "coins") {
            if ((user.coins ?? 0) < RESTART_PRICE) {
                throw new Error("Not enough coins");
            }
            await db_1.pool.query(`UPDATE public.users
         SET coins = coins - $1
         WHERE uid=$2`, [RESTART_PRICE, uid]);
        }
        else if (mode === "ad") {
            if (!nonce) {
                throw new Error("missing_nonce");
            }
            const reward = await (0, db_1.claimReward)({
                uid,
                type: "restart_ad",
                nonce,
                amount: 1,
                cooldownSeconds: 30,
            });
            if (reward?.already) {
                throw new Error("Ad already claimed");
            }
        }
        else {
            throw new Error("No restarts available");
        }
        await db_1.pool.query(`UPDATE public.users
       SET monthly_restarts_used = COALESCE(monthly_restarts_used,0) + 1
       WHERE uid=$1`, [uid]);
        await db_1.pool.query("COMMIT");
        try {
            await (0, db_1.recalcAndStoreMonthlyRate)(uid);
        }
        catch { }
        const updatedUser = await db_1.pool.query(`SELECT restarts_balance, coins FROM public.users WHERE uid=$1`, [uid]);
        const updatedProgress = await db_1.pool.query(`SELECT free_restarts_used FROM progress WHERE uid=$1`, [uid]);
        res.json({
            ok: true,
            free_restarts_used: updatedProgress.rows[0].free_restarts_used,
            restarts_balance: updatedUser.rows[0].restarts_balance,
            coins: updatedUser.rows[0].coins,
            usedFree,
        });
    }
    catch (e) {
        await db_1.pool.query("ROLLBACK");
        res.status(400).json({ ok: false, error: e.message });
    }
});
app.post("/api/rewards/daily-claim", async (req, res) => {
    try {
        const { uid } = await requirePiUser(req);
        await db_1.pool.query("BEGIN");
        const userRes = await db_1.pool.query(`SELECT uid, coins, daily_streak, last_daily_claim_date, mystery_box_pending
       FROM public.users
       WHERE uid = $1
       FOR UPDATE`, [uid]);
        const user = userRes.rows[0];
        if (!user) {
            throw new Error("user_not_found");
        }
        const plan = buildDailyClaimPlan(user);
        if (plan.already) {
            await db_1.pool.query("ROLLBACK");
            return res.json({ ok: true, already: true });
        }
        if (plan.resetCycle) {
            await db_1.pool.query(`DELETE FROM daily_reward_missed_days
         WHERE uid = $1`, [uid]);
        }
        const reward = dailyRewardCoinsForDay(plan.nextDay);
        await db_1.pool.query(`UPDATE public.users
       SET coins = coins + $1,
           daily_streak = $2,
           monthly_login_days = COALESCE(monthly_login_days,0) + 1,
           last_daily_claim_date = CURRENT_DATE,
           mystery_box_pending = CASE WHEN $2 = 7 THEN TRUE ELSE FALSE END
       WHERE uid = $3`, [reward, plan.nextDay, uid]);
        const updated = await db_1.pool.query(`SELECT coins, daily_streak, mystery_box_pending
       FROM public.users
       WHERE uid=$1`, [uid]);
        await db_1.pool.query("COMMIT");
        try {
            await (0, db_1.recalcAndStoreMonthlyRate)(uid);
        }
        catch { }
        res.json({
            ok: true,
            day: plan.nextDay,
            coins: reward,
            user: updated.rows[0],
        });
    }
    catch (e) {
        await db_1.pool.query("ROLLBACK");
        res.status(400).json({ ok: false, error: e.message });
    }
});
app.post("/api/skip", async (req, res) => {
    try {
        const { uid } = await requirePiUser(req);
        const nonce = String(req.body?.nonce || "");
        const mode = String(req.body?.mode || "");
        await db_1.pool.query("BEGIN");
        const userRes = await db_1.pool.query(`SELECT skips_balance, coins FROM public.users WHERE uid=$1 FOR UPDATE`, [uid]);
        const progressRes = await db_1.pool.query(`SELECT free_skips_used FROM progress WHERE uid=$1 FOR UPDATE`, [uid]);
        const user = userRes.rows[0];
        const progress = progressRes.rows[0];
        if (!user || !progress) {
            throw new Error("User or progress not found");
        }
        const FREE_SKIP_LIMIT = 3;
        const SKIP_PRICE = 50;
        let usedFree = false;
        if ((progress.free_skips_used ?? 0) < FREE_SKIP_LIMIT) {
            await db_1.pool.query(`UPDATE progress
         SET free_skips_used = free_skips_used + 1
         WHERE uid=$1`, [uid]);
            usedFree = true;
        }
        else if ((user.skips_balance ?? 0) > 0) {
            await db_1.pool.query(`UPDATE public.users
         SET skips_balance = skips_balance - 1
         WHERE uid=$1`, [uid]);
        }
        else if (mode === "coins") {
            if ((user.coins ?? 0) < SKIP_PRICE) {
                throw new Error("Not enough coins");
            }
            await db_1.pool.query(`UPDATE public.users
         SET coins = coins - $1
         WHERE uid=$2`, [SKIP_PRICE, uid]);
        }
        else if (mode === "ad") {
            if (!nonce) {
                throw new Error("missing_nonce");
            }
            const reward = await (0, db_1.claimReward)({
                uid,
                type: "skip_ad",
                nonce,
                amount: 1,
                cooldownSeconds: 30,
            });
            if (reward?.already) {
                throw new Error("Ad already claimed");
            }
        }
        else {
            throw new Error("No skips available");
        }
        await db_1.pool.query(`UPDATE public.users
       SET monthly_skips_used = COALESCE(monthly_skips_used,0) + 1
       WHERE uid=$1`, [uid]);
        await db_1.pool.query("COMMIT");
        try {
            await (0, db_1.recalcAndStoreMonthlyRate)(uid);
        }
        catch { }
        const updatedUser = await db_1.pool.query(`SELECT skips_balance, coins FROM public.users WHERE uid=$1`, [uid]);
        const updatedProgress = await db_1.pool.query(`SELECT free_skips_used FROM progress WHERE uid=$1`, [uid]);
        res.json({
            ok: true,
            free_skips_used: updatedProgress.rows[0].free_skips_used,
            skips_balance: updatedUser.rows[0].skips_balance,
            coins: updatedUser.rows[0].coins,
            usedFree,
        });
    }
    catch (e) {
        await db_1.pool.query("ROLLBACK");
        res.status(400).json({ ok: false, error: e.message });
    }
});
app.post("/api/hint", async (req, res) => {
    try {
        const { uid } = await requirePiUser(req);
        const nonce = String(req.body?.nonce || "");
        const mode = String(req.body?.mode || "");
        await db_1.pool.query("BEGIN");
        const userRes = await db_1.pool.query(`SELECT hints_balance, coins FROM public.users WHERE uid=$1 FOR UPDATE`, [uid]);
        const progressRes = await db_1.pool.query(`SELECT free_hints_used FROM progress WHERE uid=$1 FOR UPDATE`, [uid]);
        const user = userRes.rows[0];
        const progress = progressRes.rows[0];
        if (!user || !progress) {
            throw new Error("User or progress not found");
        }
        const FREE_HINT_LIMIT = 3;
        const HINT_PRICE = 50;
        let usedFree = false;
        if ((progress.free_hints_used ?? 0) < FREE_HINT_LIMIT) {
            await db_1.pool.query(`UPDATE progress
         SET free_hints_used = free_hints_used + 1
         WHERE uid=$1`, [uid]);
            usedFree = true;
        }
        else if ((user.hints_balance ?? 0) > 0) {
            await db_1.pool.query(`UPDATE public.users
         SET hints_balance = hints_balance - 1
         WHERE uid=$1`, [uid]);
        }
        else if (mode === "coins") {
            if ((user.coins ?? 0) < HINT_PRICE) {
                throw new Error("Not enough coins");
            }
            await db_1.pool.query(`UPDATE public.users
         SET coins = coins - $1
         WHERE uid=$2`, [HINT_PRICE, uid]);
        }
        else if (mode === "ad") {
            if (!nonce) {
                throw new Error("missing_nonce");
            }
            const reward = await (0, db_1.claimReward)({
                uid,
                type: "hint_ad",
                nonce,
                amount: 1,
                cooldownSeconds: 30,
            });
            if (reward?.already) {
                throw new Error("Ad already claimed");
            }
        }
        else {
            throw new Error("No hints available");
        }
        await db_1.pool.query(`UPDATE public.users
       SET monthly_hints_used = COALESCE(monthly_hints_used,0) + 1
       WHERE uid=$1`, [uid]);
        await db_1.pool.query("COMMIT");
        try {
            await (0, db_1.recalcAndStoreMonthlyRate)(uid);
        }
        catch { }
        const updatedUser = await db_1.pool.query(`SELECT hints_balance, coins FROM public.users WHERE uid=$1`, [uid]);
        const updatedProgress = await db_1.pool.query(`SELECT free_hints_used FROM progress WHERE uid=$1`, [uid]);
        res.json({
            ok: true,
            free_hints_used: updatedProgress.rows[0].free_hints_used,
            hints_balance: updatedUser.rows[0].hints_balance,
            coins: updatedUser.rows[0].coins,
            usedFree,
        });
    }
    catch (e) {
        await db_1.pool.query("ROLLBACK");
        res.status(400).json({ ok: false, error: e.message });
    }
});
/* ---------------- ADMIN: month close ---------------- */
app.post("/admin/month-close", async (req, res) => {
    try {
        requireAdmin(req);
        const month = req.body?.month ? String(req.body.month) : undefined;
        res.json(await (0, db_1.closeMonthAndResetCoins)({ month }));
    }
    catch (e) {
        res.status(401).json({ ok: false, error: e.message });
    }
});
/* ---------------- ADMIN: stats/online/users ---------------- */
app.get("/admin/stats", async (req, res) => {
    try {
        requireAdmin(req);
        const minutes = Number(req.query.minutes || 5);
        res.json({ ok: true, data: await (0, db_1.adminGetStats)({ onlineMinutes: minutes }) });
    }
    catch (e) {
        res.status(401).json({ ok: false, error: e.message });
    }
});
app.get("/admin/online", async (req, res) => {
    try {
        requireAdmin(req);
        res.json(await (0, db_1.adminListOnlineUsers)({
            minutes: Number(req.query.minutes || 5),
            limit: 50,
            offset: 0,
        }));
    }
    catch (e) {
        res.status(401).json({ ok: false, error: e.message });
    }
});
/* ✅ NEW: admin users list + detail (Fix 2) */
app.get("/admin/users", async (req, res) => {
    try {
        requireAdmin(req);
        const search = String(req.query.search || "");
        const limit = Math.max(1, Math.min(200, Number(req.query.limit || 25)));
        const offset = Math.max(0, Number(req.query.offset || 0));
        const order = String(req.query.order || "updated_at_desc");
        const out = await (0, db_1.adminListUsers)({ search, limit, offset });
        res.json(out);
    }
    catch (e) {
        res.status(401).json({ ok: false, error: e.message });
    }
});
app.get("/admin/users/:uid", async (req, res) => {
    try {
        requireAdmin(req);
        const data = await (0, db_1.adminGetUser)(String(req.params.uid));
        res.json({ ok: true, data });
    }
    catch (e) {
        res.status(401).json({ ok: false, error: e.message });
    }
});
/* ✅ NEW: charts endpoints (Step 1 – “A: last 7 days”) */
app.get("/admin/charts/coins", async (req, res) => {
    try {
        requireAdmin(req);
        const days = Number(req.query.days || 7);
        const rows = await (0, db_1.adminChartCoins)({ days });
        res.json({ ok: true, rows });
    }
    catch (e) {
        res.status(401).json({ ok: false, error: e.message });
    }
});
app.get("/admin/charts/active", async (req, res) => {
    try {
        requireAdmin(req);
        const days = Number(req.query.days || 7);
        const rows = await (0, db_1.adminChartActiveUsers)({ days });
        res.json({ ok: true, rows });
    }
    catch (e) {
        res.status(401).json({ ok: false, error: e.message });
    }
});
// ✅ ADMIN: delete user completely
app.delete("/admin/users/:uid", async (req, res) => {
    try {
        requireAdmin(req);
        await (0, db_1.adminDeleteUser)(req.params.uid);
        res.json({ ok: true });
    }
    catch (e) {
        res.status(401).json({ ok: false, error: e.message });
    }
});
/* ---------------- START ---------------- */
const PORT = Number(process.env.PORT) || 8080;
async function start() {
    try {
        await (0, db_1.initDB)();
        const info = await db_1.pool.query(`
      SELECT current_database(), inet_server_addr(), inet_server_port()
    `);
        app.listen(PORT, "0.0.0.0", () => {
        });
    }
    catch (err) {
        console.error("Startup failed:", err);
        process.exit(1);
    }
}
start();
