// src/main.js
import "./style.css";

import { mountUI } from "./ui/ui.js";
import { enforcePiEnvironment } from "./pi/piDetect.js";
import { initPi } from "./pi/piInit.js";
import { ensurePiLogin } from "./pi/piClient.js";

import { createGame } from "./game/game.js";
import { levels } from "./levels/index.js";

import { getSettings, setSetting, subscribeSettings } from "./settings.js";
import { ensureAudioUnlocked, stopRollSound } from "./game/rollSound.js";

const BACKEND = "https://adventuremaze.onrender.com";

let CURRENT_USER = { username: "guest", uid: null };
let CURRENT_ACCESS_TOKEN = null;

let levelIndex = 0;
let game = null;
let ui = null;

// local cache synced from /api/me
let COINS = 0;

// prevent double reward per completion
let rewardedThisLevel = false;

// ---------------------------
// Backend helpers
// ---------------------------
function authHeaders() {
  if (!CURRENT_ACCESS_TOKEN) {
    throw new Error("Missing access token. Please login again.");
  }
  return {
    Authorization: `Bearer ${CURRENT_ACCESS_TOKEN}`,
  };
}

function uuid() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

// ✅ UX delay helper (5s default)
function delay(ms = 5000) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ✅ read response safely (JSON or text)
async function readRes(res) {
  const txt = await res.text().catch(() => "");
  let data = {};
  try {
    data = txt ? JSON.parse(txt) : {};
  } catch {
    data = {};
  }
  return { txt, data };
}

function normalizeErr(e) {
  return e?.message || String(e);
}

function handleAuthExpiredIfNeeded(msg) {
  if (msg.includes("(HTTP 401)") || msg.toLowerCase().includes("invalid pi token")) {
    alert("Session expired. Please login again.");
    return true;
  }
  return false;
}

async function apiGetMe() {
  const res = await fetch(`${BACKEND}/api/me`, { headers: { ...authHeaders() } });
  const { data } = await readRes(res);
  if (!res.ok || !data?.ok) {
    throw new Error(`${data?.error || "api/me failed"} (HTTP ${res.status})`);
  }
  return data;
}

async function apiSetProgress({ uid, level, coins }) {
  const res = await fetch(`${BACKEND}/progress`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ uid, level, coins }),
  });

  const { data } = await readRes(res);
  if (!res.ok || !data?.ok) {
    throw new Error(`${data?.error || "progress save failed"} (HTTP ${res.status})`);
  }
  return data;
}

async function apiClaimLevelComplete(levelNumber) {
  const res = await fetch(`${BACKEND}/api/rewards/level-complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ level: levelNumber }),
  });

  const { data } = await readRes(res);
  if (!res.ok || !data?.ok) {
    throw new Error(`${data?.error || "level-complete failed"} (HTTP ${res.status})`);
  }
  return data; // { ok, already, user }
}

async function apiAd50() {
  const res = await fetch(`${BACKEND}/api/rewards/ad-50`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ nonce: `ad50:${CURRENT_USER.uid}:${uuid()}` }),
  });

  const { data } = await readRes(res);
  if (!res.ok || !data?.ok) {
    throw new Error(`${data?.error || "ad-50 failed"} (HTTP ${res.status})`);
  }
  return data;
}

async function apiSkip() {
  const res = await fetch(`${BACKEND}/api/skip`, {
    method: "POST",
    headers: { ...authHeaders() },
  });

  const { data } = await readRes(res);
  if (!res.ok || !data?.ok) {
    throw new Error(`${data?.error || "skip failed"} (HTTP ${res.status})`);
  }
  return data;
}

async function apiHint() {
  const res = await fetch(`${BACKEND}/api/hint`, {
    method: "POST",
    headers: { ...authHeaders() },
  });

  const { data } = await readRes(res);
  if (!res.ok || !data?.ok) {
    throw new Error(`${data?.error || "hint failed"} (HTTP ${res.status})`);
  }
  return data;
}

function clampLevelIndex(i) {
  if (i < 0) return 0;
  if (i >= levels.length) return 0;
  return i;
}

// ---------------------------
// Boot
// ---------------------------
async function boot() {
  ui = mountUI(document.querySelector("#app"));


// Level select via joystick icon
document.getElementById("controls")?.addEventListener("click", () => {
  ui.showLevelSelect({
  totalLevels: levels.length,
  currentLevel: levelIndex + 1,
  isCompleted: (lvl) => lvl < UNLOCKED_LEVEL,
});
});

ui.onLevelSelect((selectedIndex) => {
  levelIndex = clampLevelIndex(selectedIndex);
  rewardedThisLevel = true; // prevent reward on replay
  game.setLevel(levels[levelIndex]);
});
  // unlock audio after first gesture
  ui.onFirstUserGesture(() => ensureAudioUnlocked());

  // settings
  const s0 = getSettings();
  ui.setSoundEnabled(s0.sound);
  ui.setVibrationEnabled(s0.vibration);

  ui.onSoundToggle((v) => {
    setSetting("sound", v);
    if (!v) stopRollSound();
  });
  ui.onVibrationToggle((v) => setSetting("vibration", v));

  subscribeSettings((s) => {
    ui.setSoundEnabled(s.sound);
    ui.setVibrationEnabled(s.vibration);
    if (!s.sound) stopRollSound();
  });

  // Pi environment
  const env = await enforcePiEnvironment({
    desktopBlockEl: document.getElementById("desktopBlock"),
  });
  if (!env.ok) return;

  // init Pi SDK
  initPi();

  // login
  const loginRes = await ensurePiLogin({
    BACKEND,
    ui,
    onLogin: ({ user, accessToken }) => {
      CURRENT_USER = user;
      CURRENT_ACCESS_TOKEN = accessToken;

      if (ui?.userPill) ui.userPill.textContent = `${user.username}`;
      if (ui?.loginBtnText) ui.loginBtnText.textContent = "✅";
    },
  });

  if (!loginRes?.ok) return;

  // load server state
  let me;
  try {
    me = await apiGetMe();
  } catch (e) {
    const msg = normalizeErr(e);
    if (!handleAuthExpiredIfNeeded(msg)) alert("Failed to load profile: " + msg);
    return;
  }

  const serverUser = me.user;
  const serverProgress = me.progress;

  CURRENT_USER = { username: serverUser.username, uid: serverUser.uid };

  COINS = Number(serverUser.coins || 0);
  ui.setCoins(COINS);

  const savedLevel = Number(serverProgress?.level || 1);
  levelIndex = clampLevelIndex(savedLevel - 1);
  
  const UNLOCKED_LEVEL = savedLevel;

  // WIN popup actions
  ui.onWinNext(async () => {
    ui.hideWinPopup();
    await goNextLevel();
  });

  // ✅ Watch Ad: wait 5s then call backend
  ui.onWinAd(async () => {
    try {
      ui.showToast?.("Watching ad…");
      await delay(5000);

      const out = await apiAd50();
      COINS = Number(out?.user?.coins ?? COINS);
      ui.setCoins(COINS);

      ui.showToast?.("Reward granted +50");
    } catch (e) {
      const msg = normalizeErr(e);
      if (!handleAuthExpiredIfNeeded(msg)) {
        alert("Ad reward failed: " + msg);
      }
    }

    ui.hideWinPopup();
    await goNextLevel();
  });

  // ✅ Hook Skip / Hint buttons
  document.getElementById("x3Btn")?.addEventListener("click", async () => {
    if (!CURRENT_USER?.uid) return;

    try {
      ui.showToast?.("Processing skip…");
      await delay(5000);

      const out = await apiSkip();
      COINS = Number(out?.user?.coins ?? COINS);
      ui.setCoins(COINS);

      ui.showToast?.(out?.mode === "free" ? "Free skip used" : "Skip used (-50 coins)");

      await goNextLevel();
    } catch (e) {
      const msg = normalizeErr(e);
      if (!handleAuthExpiredIfNeeded(msg)) alert(msg);
    }
  });

  document.getElementById("hintBtn")?.addEventListener("click", async () => {
    if (!CURRENT_USER?.uid) return;

    try {
      ui.showToast?.("Loading hint…");
      await delay(5000);

      const out = await apiHint();
      COINS = Number(out?.user?.coins ?? COINS);
      ui.setCoins(COINS);

      const mode = out?.mode === "free" ? "Free hint used" : "Paid hint (-50)";
      ui.showToast?.(`${mode}. Free hints left: ${out?.freeLeft ?? 0}`);
    } catch (e) {
      const msg = normalizeErr(e);
      if (!handleAuthExpiredIfNeeded(msg)) alert(msg);
    }
  });

  // create game
  const firstLevel = levels[levelIndex];
  rewardedThisLevel = false;

  game = createGame({
    BACKEND,
    canvas: ui.canvas,
    getCurrentUser: () => CURRENT_USER,
    level: firstLevel,
    onLevelComplete,
  });

  game.start();
}

// ---------------------------
// Level flow
// ---------------------------
function onLevelComplete() {
  const isLastLevel = levelIndex >= levels.length - 1;

  // ✅ claim +1 once per level completion
  if (!rewardedThisLevel) {
    rewardedThisLevel = true;
    (async () => {
      try {
        const out = await apiClaimLevelComplete(levelIndex + 1);
        COINS = Number(out?.user?.coins ?? COINS);
        ui.setCoins(COINS);
      } catch (e) {
        console.warn("level reward failed:", e);
      }
    })();
  }

  // save progress (next unlocked level)
  const nextLevelNumber = isLastLevel ? 1 : levelIndex + 2;
  (async () => {
    try {
      await apiSetProgress({
        uid: CURRENT_USER.uid,
        level: nextLevelNumber,
        coins: COINS,
      });
    } catch (e) {
      console.warn("progress save failed:", e);
    }
  })();

  ui.showWinPopup({
    levelNumber: levelIndex + 1,
    isLastLevel,
  });
}

async function goNextLevel() {
  const next = levelIndex + 1;

  if (next >= levels.length) {
    levelIndex = 0;
  } else {
    levelIndex = next;
  }

  rewardedThisLevel = false;

  game.setLevel(levels[levelIndex]);

  // best-effort save current progress level
  try {
    await apiSetProgress({
      uid: CURRENT_USER.uid,
      level: levelIndex + 1,
      coins: COINS,
    });
  } catch (e) {
    console.warn("progress save failed:", e);
  }
}

boot();