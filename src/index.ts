import express from "express";
import cors from "cors";
import { initDB, upsertUser } from "./db";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5050;

// init database ONCE
const db = initDB();

/**
 * POST /api/pi/verify
 */
app.post("/api/pi/verify", async (req, res) => {
  try {
    const accessToken =
      req.body?.accessToken ||
      req.headers.authorization?.replace("Bearer ", "");

    if (!accessToken) {
      return res.status(400).json({ ok: false, error: "Missing access token" });
    }

    // Node 18+ built-in fetch
    const piRes = await fetch("https://api.minepi.com/v2/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!piRes.ok) {
      return res.status(401).json({ ok: false, error: "Invalid Pi token" });
    }

    const piUser: any = await piRes.json();
    const { uid, username } = piUser;

    if (!uid || !username) {
      return res.status(400).json({ ok: false, error: "Invalid Pi user data" });
    }

    // ✅ use your existing DB logic
    const user = upsertUser({ uid, username });

    return res.json({ ok: true, user });
  } catch (err) {
    console.error("PI VERIFY ERROR:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

/**
 * GET /api/me
 */
app.get("/api/me", async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ ok: false });

    const piRes = await fetch("https://api.minepi.com/v2/me", {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!piRes.ok) return res.status(401).json({ ok: false });

    const piUser: any = await piRes.json();

    return res.json({
      ok: true,
      user: {
        uid: piUser.uid,
        username: piUser.username,
      },
    });
  } catch {
    return res.status(500).json({ ok: false });
  }
});

app.listen(PORT, () => {
  console.log(`✅ PiMaze backend running on port ${PORT}`);
});