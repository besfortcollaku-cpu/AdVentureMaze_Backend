import "dotenv/config";
import express from "express";
import cors from "cors";
import { approvePiPayment, completePiPayment } from "./pi";

const app = express();

/* middleware */
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json());

/* routes */
app.get("/health", (_req, res) => {
  res.status(200).send("ok");
});

app.get("/", (_req, res) => {
  res.send("PiMaze backend running");
});

app.post("/pi/payments/approve", async (req, res) => {
  try {
    const { paymentId } = req.body;
    if (!paymentId) return res.status(400).json({ error: "paymentId missing" });

    await approvePiPayment(paymentId);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

app.post("/pi/payments/complete", async (req, res) => {
  try {
    const { paymentId, txid } = req.body;
    if (!paymentId || !txid) {
      return res.status(400).json({ error: "paymentId/txid missing" });
    }

    await completePiPayment(paymentId, txid);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

/* 🚨 ONLY ONE LISTEN — AT THE END */
const PORT = Number(process.env.PORT) || 3001;
app.listen(PORT, "0.0.0.0", () => {
  console.log("Backend running on", PORT);
});