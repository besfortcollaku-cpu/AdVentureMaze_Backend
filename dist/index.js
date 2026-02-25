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
        const { rows } = await db_1.pool.query(`SELECT * FROM users WHERE uid=$1`, [uid]);
        const user = rows[0] ?? null;
        const progress = await (0, db_1.getProgressByUid)(uid);
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
        });
    }
    catch (e) {
        res.status(401).json({ ok: false, error: e.message });
    }
});
app.post("/api/progress", async (req, res) => {
    try {
        const { uid } = await requirePiUser(req);
        const { level, coins, paintedKeys, resume } = req.body;
        await db_1.pool.query(`
      INSERT INTO progress (uid, level, coins, painted_keys, resume)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (uid)
      DO UPDATE SET
        level = EXCLUDED.level,
        coins = EXCLUDED.coins,
        painted_keys = EXCLUDED.painted_keys,
        resume = EXCLUDED.resume,
        updated_at = NOW()
      `, [uid, level, coins, paintedKeys, resume]);
        res.json({ ok: true });
    }
    catch (e) {
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
        await db_1.pool.query(`UPDATE users SET username=$1 WHERE uid=$2`, [username, uid]);
        res.json({ ok: true });
    }
    catch (e) {
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
        const existing = await db_1.pool.query(`SELECT uid FROM users WHERE LOWER(username)=LOWER($1) AND uid<>$2`, [username, uid]);
        if ((existing.rowCount ?? 0) > 0) {
            return res.status(400).json({ ok: false, error: "Username already taken" });
        }
        await db_1.pool.query(`UPDATE users SET username=$1 WHERE uid=$2`, [username, uid]);
        res.json({ ok: true, username });
    }
    catch (e) {
        res.status(401).json({ ok: false, error: e.message });
    }
});
/* ---------------- HELPERS ---------------- */
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
        await (0, db_1.recalcAndStoreMonthlyRate)(uid);
        const out = await (0, db_1.claimMonthlyRewards)(uid, { month });
        res.json(out);
    }
    catch (e) {
        res.status(400).json({ ok: false, error: e.message });
    }
});
/* ---------------- REWARDS ---------------- */
app.post("/api/rewards/ad-50", async (req, res) => {
    console.log("HEADERS", req.headers.authorization);
    console.log("AD +50 HIT", {
        hasUser: !!req.user,
        uid: req.user?.uid,
    });
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
            cooldownSeconds: 30,
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
        await db_1.pool.query("BEGIN");
        const userRes = await db_1.pool.query(`SELECT restarts_balance FROM users WHERE uid=$1 FOR UPDATE`, [uid]);
        const progressRes = await db_1.pool.query(`SELECT free_restarts_used FROM progress WHERE uid=$1 FOR UPDATE`, [uid]);
        const user = userRes.rows[0];
        const progress = progressRes.rows[0];
        if (!user || !progress) {
            throw new Error("User or progress not found");
        }
        const FREE_RESTART_LIMIT = 3;
        let usedFree = false;
        if ((progress.free_restarts_used ?? 0) < FREE_RESTART_LIMIT) {
            await db_1.pool.query(`UPDATE progress
         SET free_restarts_used = free_restarts_used + 1
         WHERE uid=$1`, [uid]);
            usedFree = true;
        }
        else if ((user.restarts_balance ?? 0) > 0) {
            await db_1.pool.query(`UPDATE users
         SET restarts_balance = restarts_balance - 1
         WHERE uid=$1`, [uid]);
        }
        else {
            throw new Error("No restarts available");
        }
        await db_1.pool.query("COMMIT");
        const updatedUser = await db_1.pool.query(`SELECT restarts_balance FROM users WHERE uid=$1`, [uid]);
        const updatedProgress = await db_1.pool.query(`SELECT free_restarts_used FROM progress WHERE uid=$1`, [uid]);
        res.json({
            ok: true,
            free_restarts_used: updatedProgress.rows[0].free_restarts_used,
            restarts_balance: updatedUser.rows[0].restarts_balance,
            usedFree
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
        await db_1.pool.query("BEGIN");
        // Lock user + progress rows
        const userRes = await db_1.pool.query(`SELECT skips_balance FROM users WHERE uid=$1 FOR UPDATE`, [uid]);
        const progressRes = await db_1.pool.query(`SELECT free_skips_used FROM progress WHERE uid=$1 FOR UPDATE`, [uid]);
        const user = userRes.rows[0];
        const progress = progressRes.rows[0];
        if (!user || !progress) {
            throw new Error("User or progress not found");
        }
        const FREE_SKIP_LIMIT = 3;
        let usedFree = false;
        if ((progress.free_skips_used ?? 0) < FREE_SKIP_LIMIT) {
            // consume free
            await db_1.pool.query(`UPDATE progress
         SET free_skips_used = free_skips_used + 1
         WHERE uid=$1`, [uid]);
            usedFree = true;
        }
        else if ((user.skips_balance ?? 0) > 0) {
            // consume paid
            await db_1.pool.query(`UPDATE users
         SET skips_balance = skips_balance - 1
         WHERE uid=$1`, [uid]);
        }
        else {
            throw new Error("No skips available");
        }
        await db_1.pool.query("COMMIT");
        // return fresh values
        const updatedUser = await db_1.pool.query(`SELECT skips_balance FROM users WHERE uid=$1`, [uid]);
        const updatedProgress = await db_1.pool.query(`SELECT free_skips_used FROM progress WHERE uid=$1`, [uid]);
        res.json({
            ok: true,
            free_skips_used: updatedProgress.rows[0].free_skips_used,
            skips_balance: updatedUser.rows[0].skips_balance,
            usedFree
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
        await db_1.pool.query("BEGIN");
        const userRes = await db_1.pool.query(`SELECT hints_balance FROM users WHERE uid=$1 FOR UPDATE`, [uid]);
        const progressRes = await db_1.pool.query(`SELECT free_hints_used FROM progress WHERE uid=$1 FOR UPDATE`, [uid]);
        const user = userRes.rows[0];
        const progress = progressRes.rows[0];
        if (!user || !progress) {
            throw new Error("User or progress not found");
        }
        const FREE_HINT_LIMIT = 3;
        let usedFree = false;
        if ((progress.free_hints_used ?? 0) < FREE_HINT_LIMIT) {
            await db_1.pool.query(`UPDATE progress
         SET free_hints_used = free_hints_used + 1
         WHERE uid=$1`, [uid]);
            usedFree = true;
        }
        else if ((user.hints_balance ?? 0) > 0) {
            await db_1.pool.query(`UPDATE users
         SET hints_balance = hints_balance - 1
         WHERE uid=$1`, [uid]);
        }
        else {
            throw new Error("No hints available");
        }
        await db_1.pool.query("COMMIT");
        const updatedUser = await db_1.pool.query(`SELECT hints_balance FROM users WHERE uid=$1`, [uid]);
        const updatedProgress = await db_1.pool.query(`SELECT free_hints_used FROM progress WHERE uid=$1`, [uid]);
        res.json({
            ok: true,
            free_hints_used: updatedProgress.rows[0].free_hints_used,
            hints_balance: updatedUser.rows[0].hints_balance,
            usedFree
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
        console.log("[ADMIN DELETE] HIT", req.params.uid);
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
        console.log("Database initialized");
        app.listen(PORT, "0.0.0.0", () => {
            console.log("Backend listening on", PORT);
        });
    }
    catch (err) {
        console.error("Startup failed:", err);
        process.exit(1);
    }
}
start();
