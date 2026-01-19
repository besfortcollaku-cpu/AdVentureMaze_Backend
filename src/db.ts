// src/db.ts
// Database schema + helpers for Adventure Maze
// Coins, Ads, Skips, Hints, Monthly tracking

import { Pool } from "pg";
import crypto from "crypto";

// ---------------------------
// DB CONNECTION
// ---------------------------
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ---------------------------
// HELPERS
// ---------------------------
function uuid() {
  return crypto.randomUUID();
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ---------------------------
// USERS
// ---------------------------
export async function ensureUser({ uid, username }: { uid: string; username: string }) {
  await pool.query(
    `
    INSERT INTO users (uid, username, coins, created_at)
    VALUES ($1, $2, 0, NOW())
    ON CONFLICT (uid) DO NOTHING
    `,
    [uid, username]
  );
}

// ---------------------------
// MONTHLY STATE
// ---------------------------
export async function getMonthlyState(uid: string) {
  const month = currentMonth();

  const res = await pool.query(
    `
    INSERT INTO user_monthly_state (
      uid,
      month,
      free_skips_left,
      free_hints_left,
      ads_watched_for_coins,
      ads_watched_for_actions
    )
    VALUES ($1, $2, 3, 3, 0, 0)
    ON CONFLICT (uid, month)
    DO UPDATE SET uid = EXCLUDED.uid
    RETURNING *
    `,
    [uid, month]
  );

  return res.rows[0];
}

// ---------------------------
// COIN LEDGER (IMMUTABLE)
// ---------------------------
export async function addCoinEvent({
  uid,
  type,
  amount,
  meta = {},
}: {
  uid: string;
  type:
    | "daily_login"
    | "level_complete"
    | "ad_reward"
    | "skip_purchase"
    | "hint_purchase"
    | "monthly_conversion";
  amount: number;
  meta?: any;
}) {
  await pool.query(
    `
    INSERT INTO coin_events (id, uid, type, amount, meta, created_at)
    VALUES ($1, $2, $3, $4, $5, NOW())
    `,
    [uuid(), uid, type, amount, meta]
  );

  await pool.query(
    `
    UPDATE users
    SET coins = coins + $1
    WHERE uid = $2
    `,
    [amount, uid]
  );
}

// ---------------------------
// ADS
// ---------------------------
export async function registerAdWatch({
  uid,
  adType,
}: {
  uid: string;
  adType: "coins" | "skip" | "hint";
}) {
  const month = currentMonth();

  const state = await getMonthlyState(uid);

  let reward = 0;

  if (adType === "coins") {
    const index = state.ads_watched_for_coins;
    reward = Math.max(50 - index, 2);

    await pool.query(
      `
      UPDATE user_monthly_state
      SET ads_watched_for_coins = ads_watched_for_coins + 1
      WHERE uid = $1 AND month = $2
      `,
      [uid, month]
    );

    await addCoinEvent({
      uid,
      type: "ad_reward",
      amount: reward,
      meta: { adIndex: index + 1 },
    });
  } else {
    // skip / hint ads give NO coins
    await pool.query(
      `
      UPDATE user_monthly_state
      SET ads_watched_for_actions = ads_watched_for_actions + 1
      WHERE uid = $1 AND month = $2
      `,
      [uid, month]
    );
  }

  await pool.query(
    `
    INSERT INTO ad_events (id, uid, ad_type, reward_amount, created_at)
    VALUES ($1, $2, $3, $4, NOW())
    `,
    [uuid(), uid, adType, reward]
  );

  return reward;
}

// ---------------------------
// DAILY LOGIN
// ---------------------------
export async function rewardDailyLogin(uid: string) {
  await addCoinEvent({
    uid,
    type: "daily_login",
    amount: 5,
  });
}

// ---------------------------
// LEVEL COMPLETE
// ---------------------------
export async function rewardLevelComplete(uid: string, level: number) {
  await addCoinEvent({
    uid,
    type: "level_complete",
    amount: 1,
    meta: { level },
  });
}

// ---------------------------
// SKIP / HINT USAGE
// ---------------------------
export async function useSkip(uid: string) {
  const state = await getMonthlyState(uid);

  if (state.free_skips_left > 0) {
    await pool.query(
      `
      UPDATE user_monthly_state
      SET free_skips_left = free_skips_left - 1
      WHERE uid = $1 AND month = $2
      `,
      [uid, currentMonth()]
    );
    return { mode: "free" };
  }

  // paid
  await addCoinEvent({
    uid,
    type: "skip_purchase",
    amount: -50,
  });

  return { mode: "paid" };
}

export async function useHint(uid: string) {
  const state = await getMonthlyState(uid);

  if (state.free_hints_left > 0) {
    await pool.query(
      `
      UPDATE user_monthly_state
      SET free_hints_left = free_hints_left - 1
      WHERE uid = $1 AND month = $2
      `,
      [uid, currentMonth()]
    );
    return { mode: "free" };
  }

  await addCoinEvent({
    uid,
    type: "hint_purchase",
    amount: -50,
  });

  return { mode: "paid" };
}

// ---------------------------
// MONTHLY PI CONVERSION (LOGIC ONLY)
// ---------------------------
export async function convertMonthlyCoinsToPi(uid: string) {
  const res = await pool.query(
    `
    SELECT coins FROM users WHERE uid = $1
    `,
    [uid]
  );

  const coins = Number(res.rows[0]?.coins || 0);
  if (coins <= 0) return 0;

  // conversion logic handled elsewhere
  await addCoinEvent({
    uid,
    type: "monthly_conversion",
    amount: -coins,
  });

  return coins;
}