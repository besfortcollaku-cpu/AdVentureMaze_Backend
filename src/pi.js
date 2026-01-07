// backend-pi.js
import express from "express";
import fetch from "node-fetch";

const router = express.Router();

// IMPORTANT: set this in Render env vars
// PI_API_KEY = your Pi App Secret
const PI_API_KEY = process.env.PI_API_KEY;

// ---------------------------
// POST /api/pi/verify
// ---------------------------
router.post("/api/pi/verify", async (req, res) => {
  try {
    const accessToken =
      req.body?.accessToken ||
      req.headers?.authorization?.replace("Bearer ", "");

    if (!accessToken) {
      return res.status(400).json({
        ok: false,
        error: "Missing Pi access token",
      });
    }

    if (!PI_API_KEY) {
      return res.status(500).json({
        ok: false,
        error: "Server misconfigured (PI_API_KEY missing)",
      });
    }

    // ---------------------------
    // Verify token with Pi Platform
    // ---------------------------
    const piRes = await fetch(
      "https://api.minepi.com/v2/me",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-Pi-Api-Key": PI_API_KEY,
        },
      }
    );

    if (!piRes.ok) {
      const txt = await piRes.text();
      return res.status(401).json({
        ok: false,
        error: "Invalid Pi token",
        detail: txt,
      });
    }

    const piUser = await piRes.json();

    // ---------------------------
    // Normalize user
    // ---------------------------
    const user = {
      uid: piUser.uid,
      username: piUser.username,
    };

    // ---------------------------
    // Respond in frontend-expected format
    // ---------------------------
    return res.json({
      ok: true,
      user,
      accessToken, // frontend expects this
    });
  } catch (err) {
    console.error("Pi verify error:", err);
    return res.status(500).json({
      ok: false,
      error: "Pi verification failed",
    });
  }
});

export default router;