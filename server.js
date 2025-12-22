Const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// VERY SIMPLE storage for now (later: database)
const users = {}; // { username: { pointsThisWeek: number, pointsToday: number, lastDay: "YYYY-MM-DD" } }

function todayKey() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

// TODO: Replace this with real Pi Platform verification using adId (recommended by Pi) 4
async function verifyAdIdWithPi(adId) {
  // For Step 6 testing: accept any non-empty adId
  return typeof adId === "string" && adId.length > 5;
}

app.post("/ads/claim", async (req, res) => {
  const { username, adId } = req.body;
  if (!username || !adId) return res.status(400).json({ ok: false, error: "Missing username/adId" });

  // Daily cap: 30 points/day (your rule)
  const day = todayKey();
  users[username] ||= { pointsThisWeek: 0, pointsToday: 0, lastDay: day };

  if (users[username].lastDay !== day) {
    users[username].lastDay = day;
    users[username].pointsToday = 0;
  }

  if (users[username].pointsToday >= 30) {
    return res.json({ ok: false, capped: true, pointsToday: users[username].pointsToday, pointsThisWeek: users[username].pointsThisWeek });
  }

  const valid = await verifyAdIdWithPi(adId);
  if (!valid) return res.status(401).json({ ok: false, error: "Invalid adId" });

  users[username].pointsToday += 1;
  users[username].pointsThisWeek += 1;

  return res.json({
    ok: true,
    pointsToday: users[username].pointsToday,
    pointsThisWeek: users[username].pointsThisWeek,
  });
});

app.get("/points/:username", (req, res) => {
  const u = users[req.params.username];
  res.json({ ok: true, pointsThisWeek: u?.pointsThisWeek || 0, pointsToday: u?.pointsToday || 0 });
});

app.listen(5050, () => console.log("Backend running on http://localhost:5050"));