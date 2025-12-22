import "dotenv/config";

import express from "express";

import cors from "cors";

import { verifyPiAccessToken } from "./piAuth";

import { approvePiPayment, completePiPayment } from "./pi";



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