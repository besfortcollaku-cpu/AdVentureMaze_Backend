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
    try {
        const { uid, username } = await requirePiUser(req);
        let user = await (0, db_1.upsertUser)({ uid, username });
        try {
            const out = await (0, db_1.claimDailyLogin)(uid);
            if (out?.user)
                user = out.user;
        }
        catch { }
        const progress = await (0, db_1.getProgressByUid)(uid);
        res.json({
            ok: true,
            user,
            progress: progress ?? { uid, level: 1, coins: 0 },
        });
    }
    catch (e) {
        res.status(401).json({ ok: false, error: e.message });
    }
});
/* ---------------- PROGRESS ---------------- */
app.get("/progress", async (req, res) => {
    const uid = String(req.query.uid || "");
    const p = await (0, db_1.getProgressByUid)(uid);
    res.json({ ok: true, data: p ?? { uid, level: 1, coins: 0 } });
});
app.post("/progress", async (req, res) => {
    await requirePiUser(req);
    const { uid, level, coins } = req.body;
    await (0, db_1.setProgressByUid)({ uid, level, coins });
    res.json({ ok: true });
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
        if (!r.ok) {
            throw new Error("Invalid Pi access token");
        }
        return await r.json();
    }
    finally {
        clearTimeout(timeout);
    }
}
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
            cooldownSeconds: 0,
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
app.post("/api/skip", async (req, res) => {
    try {
        const { uid } = await requirePiUser(req);
        res.json(await (0, db_1.useSkip)(uid));
    }
    catch (e) {
        res.status(400).json({ ok: false, error: e.message });
    }
});
app.post("/api/hint", async (req, res) => {
    try {
        const { uid } = await requirePiUser(req);
        res.json(await (0, db_1.useHint)(uid));
    }
    catch (e) {
        res.status(400).json({ ok: false, error: e.message });
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
