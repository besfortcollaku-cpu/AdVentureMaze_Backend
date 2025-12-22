import "dotenv/config";

import express from "express";

import cors from "cors";

import { verifyPiAccessToken } from "./pi";

import { approvePiPayment, completePiPayment } from "./pi";

// payments hooks

const progressStore = new Map<string, any>(); // TEMP (later we use sqlite)



app.get("/progress", async (req, res) => {

  const username = String(req.query.username || "");

  if (!username) return res.status(400).json({ ok: false, error: "username required" });



  const data = progressStore.get(username) || { level: 1, coins: 0 };

  return res.json({ ok: true, data });

});



app.post("/progress", async (req, res) => {

  const { username, level, coins } = req.body;

  if (!username) return res.status(400).json({ ok: false, error: "username required" });



  progressStore.set(username, {

    level: Number(level || 1),

    coins: Number(coins || 0),

    updatedAt: Date.now(),

  });



  return res.json({ ok: true });

});
app.post("/payments/approve", async (req, res) => {

  try {

    // TODO: verify user auth here (same as /verify)

    const { paymentId } = req.body;

    // TODO: call Pi server approval API here (we’ll wire next)

    return res.json({ ok: true, paymentId, status: "approved_stub" });

  } catch (e: any) {

    return res.status(500).json({ ok: false, error: e.message });

  }

});



app.post("/payments/complete", async (req, res) => {

  try {

    const { paymentId, txid } = req.body;

    // TODO: call Pi complete API here (we’ll wire next)

    return res.json({ ok: true, paymentId, txid, status: "completed_stub" });

  } catch (e: any) {

    return res.status(500).json({ ok: false, error: e.message });

  }

});



const app = express();



app.use(cors({

  origin: "*",

  methods: ["GET", "POST", "OPTIONS"],

  allowedHeaders: ["Content-Type", "Authorization"],

}));

app.use(express.json());



app.get("/health", (_req, res) => res.status(200).send("ok"));

app.get("/", (_req, res) => res.send("backend up"));



/**

 * Verify Pi accessToken by calling Pi Platform /me.

 * This makes Pi the source of truth for user identity.

 */

app.post("/auth/pi/verify", async (req, res) => {

  try {

    const { accessToken } = req.body;

    if (!accessToken) return res.status(400).json({ error: "accessToken missing" });



    const user = await verifyPiAccessToken(accessToken);

    // You can create/find your user record in DB here if you want.



    return res.json({ ok: true, user });

  } catch (e: any) {

    return res.status(401).json({ ok: false, error: e?.message || String(e) });

  }

});



// Payments routes (your existing)

app.post("/pi/payments/approve", async (req, res) => {

  try {

    const { paymentId } = req.body;

    if (!paymentId) return res.status(400).json({ error: "paymentId missing" });

    await approvePiPayment(paymentId);

    return res.json({ ok: true });

  } catch (e: any) {

    return res.status(500).json({ error: e?.message || String(e) });

  }

});



app.post("/pi/payments/complete", async (req, res) => {

  try {

    const { paymentId, txid } = req.body;

    if (!paymentId || !txid) return res.status(400).json({ error: "paymentId/txid missing" });

    await completePiPayment(paymentId, txid);

    return res.json({ ok: true });

  } catch (e: any) {

    return res.status(500).json({ error: e?.message || String(e) });

  }

});



const PORT = Number(process.env.PORT) || 3001;

app.listen(PORT, "0.0.0.0", () => console.log("Backend running on", PORT));