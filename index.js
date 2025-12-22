"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const pi_1 = require("./pi");
const app = (0, express_1.default)();
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log("Backend running on", PORT));
app.use((0, cors_1.default)({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express_1.default.json());
app.get("/", (req, res) => res.send("PiMaze backend runing"));
app.post("/pi/payments/approve", async (req, res) => {
    try {
        const { paymentId } = req.body;
        if (!paymentId)
            return res.status(400).json({ error: "paymentId missing" });
        await (0, pi_1.approvePiPayment)(paymentId);
        return res.json({ ok: true });
    }
    catch (e) {
        return res.status(500).json({ error: e?.message || String(e) });
    }
});
app.post("/pi/payments/complete", async (req, res) => {
    try {
        const { paymentId, txid } = req.body;
        if (!paymentId || !txid)
            return res.status(400).json({ error: "paymentId/txid missing" });
        await (0, pi_1.completePiPayment)(paymentId, txid);
        return res.json({ ok: true });
    }
    catch (e) {
        return res.status(500).json({ error: e?.message || String(e) });
    }
});
const port = Number(process.env.PORT || 4000);
app.listen(port, () => console.log(`Backend running on ${port}`));
//# sourceMappingURL=index.js.map