// backend index.ts
import express from "express";
import fetch from "node-fetch";
import { db } from "./db";

const app = express();
app.use(express.json());

app.get("/api/health", (_, res) => {
  res.json({ ok: true });
});

app.post("/api/pi/verify", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token =
      authHeader.replace("Bearer ", "") || req.body?.accessToken;

    if (!token) {
      return res.status(401).json({ ok: false, error: "Missing accessToken" });
    }

    const piRes = await fetch("https://api.minepi.com/v2/me", {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!piRes.ok) {
      return res.status(401).json({ ok: false, error: "Invalid Pi token" });
    }

    const piUser = await piRes.json();
    const { uid, username } = piUser;

    const user = db
      .prepare(
        `
        INSERT INTO users (uid, username)
        VALUES (?, ?)
        ON CONFLICT(uid) DO UPDATE SET username=excluded.username
        RETURNING uid, username
      `
      )
      .get(uid, username);

    res.json({ ok: true, user });
  } catch (e) {
    console.error("pi verify error", e);
    res.status(500).json({ ok: false, error: "pi verify failed" });
  }
});

app.get("/api/me", (req, res) => {
  const auth = req.headers.authorization || "";
  const token = auth.replace("Bearer ", "");

  if (!token) {
    return res.status(401).json({ ok: false });
  }

  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64").toString()
    );

    const user = db
      .prepare("SELECT uid, username FROM users WHERE uid = ?")
      .get(payload.uid);

    if (!user) {
      return res.status(401).json({ ok: false });
    }

    res.json({ ok: true, user });
  } catch {
    res.status(401).json({ ok: false });
  }
});

export default app;
