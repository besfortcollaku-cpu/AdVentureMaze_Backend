console.log("BUILD VERSION TEST 123");
import "./css/dailyReward.css";
import { createDailyRewardPopup } from "./ui/uiDailyReward.js";
import "./css/ui.css";
import "./css/ads.css";
import { mountLevelsUI } from "./ui/uiLevels.js";
import { mountUI } from "./ui/ui.js";
import { loadProgress } from "./api/loadProgress.js";
import { createGame } from "./game/game.js";
import { ensurePiLogin, prestartPiLogin } from "./pi/piClient.js";
import { levels } from "./levels/index.js";
import { LEVEL_ROUTES } from "./hints/levelRoutes.js";
import { createWinPopup } from "./ui/uiWin.js";
import { createSkipPopup } from "./ui/uiSkip.js";
import { createHintPopup } from "./ui/uiHints.js";
import { createRestartPopup } from "./ui/uiRestarts.js";
// DEBUG: show fatal errors on mobile so buttons don't "do nothing"
window.addEventListener("error", (e) => {
  alert("JS ERROR: " + (e?.message || "unknown"));
});
window.addEventListener("unhandledrejection", (e) => {
  const msg = e?.reason?.message || String(e?.reason || "unknown");
  alert("PROMISE ERROR: " + msg);
});
const GUEST_PROGRESS_KEY = "guest_progress_v1";
const GUEST_MAX_LEVEL = 5;
let CURRENT_USER = null;
let AD_OVERLAY_ACTIVE = false;

Object.defineProperty(window, "__DEBUG_USER", {
  get() {
    return CURRENT_USER;
  }
});
let CURRENT_ACCESS_TOKEN = null;
let ui = null;
let game = null;
let HINT_ACTIVE_FOR_LEVEL = false;
let HINT_ROUTE = null;
let HINT_ROUTE_INDEX = 0;
let HINT_ROUTE_TIMER = null;

// hint system state
let HINT_RECALC_TIMER = null;
const BACKEND = "https://triumphant-gentleness-production.up.railway.app";
const FREE_SKIPS = 3;
const FREE_HINTS = 3;
const FREE_RESTARTS = 3;
let LOGIN_IN_PROGRESS = false;
// tutorial hint flag
const AUTO_HINT_SEEN_KEY = "auto_hint_seen_v1";
const AD_COOLDOWN_MS = 180_000;
const AD_LAST_CLAIM_KEY = "ad_last_claim_at_v1";
let adToastTimer = null;
const adPlayingStyle = document.createElement("style");
adPlayingStyle.textContent = `
  body.ad-playing #app {
    pointer-events: none !important;
  }

  body.ad-playing .ad-overlay,
  body.ad-playing .ad-overlay * {
    pointer-events: auto !important;
  }
`;
document.head.appendChild(adPlayingStyle);
function showAdCooldownToast(message) {
  let el = document.getElementById("adCooldownToast");

  if (!el) {
    el = document.createElement("div");
    el.id = "adCooldownToast";
    el.style.cssText = `
      position: fixed;
      left: 50%;
      bottom: 120px;
      transform: translateX(-50%);
      z-index: 99999;
      background: rgba(0,0,0,0.88);
      color: #fff;
      padding: 10px 14px;
      border-radius: 12px;
      font-size: 14px;
      line-height: 1.3;
      max-width: 80vw;
      text-align: center;
      box-shadow: 0 8px 24px rgba(0,0,0,0.35);
    `;
    document.body.appendChild(el);
  }

  el.textContent = message;
  el.style.display = "block";

  clearTimeout(adToastTimer);
  adToastTimer = setTimeout(() => {
    el.style.display = "none";
  }, 1800);
}

const AUTO_AD_COOLDOWN_MS = 180000;
const AUTO_AD_LAST_KEY = "auto_ad_last";

function shouldShowAutoAd() {
  const last = Number(localStorage.getItem(AUTO_AD_LAST_KEY) || 0);
  return Date.now() - last > AUTO_AD_COOLDOWN_MS;
}

function markAutoAdShown() {
  localStorage.setItem(AUTO_AD_LAST_KEY, Date.now());
}

function getRemainingAdCooldownMs() {
  const last = Number(localStorage.getItem(AD_LAST_CLAIM_KEY) || 0);
  const remaining = AD_COOLDOWN_MS - (Date.now() - last);
  return Math.max(0, remaining);
}

function markAdClaimedNow() {
  localStorage.setItem(AD_LAST_CLAIM_KEY, String(Date.now()));
}

function guardAdCooldownBeforeWatching() {
  const remaining = getRemainingAdCooldownMs();
  if (remaining <= 0) return true;

  const seconds = Math.ceil(remaining / 1000);
  showAdCooldownToast(`Ad available in ${seconds}s`);
  return false;
}

document.body.classList.add("login-loading");
document.body.classList.remove("login-loading");
// --- LOGIN LOADING OVERLAY (blocks UI until game is ready) ---
function ensureLoginLoadingOverlay() {
  let el = document.getElementById("loginLoadingOverlay");
  if (el) return el;

  el = document.createElement("div");
  el.id = "loginLoadingOverlay";
  el.style.position = "fixed";
  el.style.inset = "0";
  el.style.zIndex = "99999";
  el.style.display = "none";
  el.style.alignItems = "center";
  el.style.justifyContent = "center";
  el.style.background = "rgba(0,0,0,0.55)";
  el.innerHTML = `
    <div style="
      width:64px;height:64px;border-radius:50%;
      border:6px solid rgba(255,255,255,0.25);
      border-top-color: rgba(255,255,255,0.95);
      animation: spin 0.9s linear infinite;
    "></div>
  `;

  const style = document.createElement("style");
  style.textContent = `
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  `;
  document.head.appendChild(style);

  document.body.appendChild(el);
  return el;
}

function showLoginLoading() {
  const el = ensureLoginLoadingOverlay();
  el.style.display = "flex";

  // hide welcome overlay content (buttons/text) while loading
  document.body.classList.remove("welcome-visible");
}

function hideLoginLoading() {
  const el = document.getElementById("loginLoadingOverlay");
  if (el) el.style.display = "none";
}


document.addEventListener(
  "touchmove",
  (e) => {
    if (document.body.classList.contains("welcome-visible")) return;
    e.preventDefault();
  },
  { passive: false }
);

let levelIndex = 0;
let RESUME_ENABLED = false;
let RESUME_TILES = new Set();
let RESUME_POS = null;
let RESUME_SAVE_TIMER = null;
let LEVEL_START_KEY = null;

function normalizeToken(t) {
  return String(t || "").replace(/^Bearer\s+/i, "");
}
function applyUserPatch(patch) {
  if (!patch) return;

  const keepUid = CURRENT_USER?.uid;
  const keepName = CURRENT_USER?.username;

  CURRENT_USER = { ...CURRENT_USER, ...patch };

  // never allow identity to be wiped by partial backend patches
  if (!CURRENT_USER?.uid && keepUid) CURRENT_USER.uid = keepUid;
  if (!CURRENT_USER?.username && keepName) CURRENT_USER.username = keepName;

  // update header
  ui?.setUser?.(CURRENT_USER);
  ui?.setCoins?.(CURRENT_USER?.coins ?? 0);

  // 🔥 CRITICAL: refresh badges from DB values
  updateAllBadges();
}
function scheduleResumeSave(currentLevelNumber) {
  if (!CURRENT_ACCESS_TOKEN) return;
  if (!RESUME_ENABLED) return;
  if (RESUME_SAVE_TIMER) return;

  RESUME_SAVE_TIMER = setTimeout(() => {
    RESUME_SAVE_TIMER = null;

    const safeLevel = Math.max(
      Number(CURRENT_MAX_UNLOCKED_LEVEL || 1),
      Number(currentLevelNumber || 1)
    );
if (LEVEL_START_KEY) {
  RESUME_TILES.add(LEVEL_START_KEY);
}
    console.log(
      "SAVING RESUME",
      safeLevel,
      RESUME_TILES.size,
      RESUME_POS
    );
    
    if (!CURRENT_USER?.uid) return;

apiSetProgress({
  uid: CURRENT_USER.uid,
      level: safeLevel,
      paintedKeys: Array.from(RESUME_TILES),
      resume: RESUME_POS,
    }).catch(() => {});
  }, 700);
}
// Keep the Levels 1screen consistent (guest: localStorage, logged-in: backend)
let CURRENT_MAX_UNLOCKED_LEVEL = 1;

async function fetchAndSetCoins({ BACKEND, token, ui }) {
  if (!token) return;

  const res = await fetch(`${BACKEND}/api/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) return;

  const data = await res.json();
  ui.setCoins(data.coins ?? 0);
}

async function apiSetProgress({ uid, level, paintedKeys, resume } = {}) {
  if (!CURRENT_ACCESS_TOKEN) return null;

  const res = await fetch(`${BACKEND}/api/progress`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${normalizeToken(CURRENT_ACCESS_TOKEN)}`,
    },
    body: JSON.stringify({
      uid,
      level,
      paintedKeys,
      resume,
    }),
  });

  return res.json().catch(() => ({}));
}
async function apiClaimLevelComplete(levelNumber) {
  if (!CURRENT_ACCESS_TOKEN) return null;

  const res = await fetch(`${BACKEND}/api/rewards/level-complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${normalizeToken(CURRENT_ACCESS_TOKEN)}`,
    },
    body: JSON.stringify({
      level: levelNumber,
    }),
  });

  if (!res.ok) {
    return null; // never break gameplay
  }

  return res.json();
}

function updateBadge({ badgeId, left }) {
  const badge = document.getElementById(badgeId);
  if (!badge) return;

  if (left > 0) {
    badge.textContent = left;
    badge.classList.remove("hidden");
  } else {
    badge.textContent = "";
    badge.classList.add("hidden");
  }
}


async function apiSkip({ mode }) {
  const nonce = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  const res = await fetch(`${BACKEND}/api/skip`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${normalizeToken(CURRENT_ACCESS_TOKEN)}`,
    },
    body: JSON.stringify({ mode, nonce }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) throw new Error(data?.error || "Skip failed");
  return data;
}

async function apiHint({ mode }) {
  const nonce = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  const res = await fetch(`${BACKEND}/api/hint`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${normalizeToken(CURRENT_ACCESS_TOKEN)}`,
    },
    body: JSON.stringify({ mode, nonce }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) throw new Error(data?.error || "Hint failed");
  return data;
}

async function apiClaimAd50() {
  if (!CURRENT_ACCESS_TOKEN) {
    throw new Error("No access token");
  }

  const res = await fetch(`${BACKEND}/api/rewards/ad-50`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${normalizeToken(CURRENT_ACCESS_TOKEN)}`,
    },
    body: JSON.stringify({
      nonce: `${Date.now()}-${Math.random()}`,
    }),
  });

  if (!res.ok) {
    throw new Error("Ad reward failed");
  }

  return res.json();
}

async function loadMeAndSyncUI({ BACKEND, token, ui }) {
  const res = await fetch(`${BACKEND}/api/me`, {
  method: "GET",
  headers: {
    "Authorization": `Bearer ${normalizeToken(token)}`,
    "Content-Type": "application/json"
  },
});

  if (!res.ok) {
  console.warn("Failed /api/me", res.status);
  return { user: CURRENT_USER, progress: null };
}

  const me = await res.json();

  const user = me?.user || {};
  const progress = me?.progress || {};

  CURRENT_USER = {
  ...user,
  ...progress,

  uid: user.uid,
  username: user.username,

  // normalize everything
  coins: Number(user.coins ?? progress.coins ?? 0),

  restarts_balance: Number(user.restarts_balance ?? 0),
  skips_balance: Number(user.skips_balance ?? 0),
  hints_balance: Number(user.hints_balance ?? 0),

  free_restarts_used: Number(progress.free_restarts_used ?? 0),
  free_skips_used: Number(progress.free_skips_used ?? 0),
  free_hints_used: Number(progress.free_hints_used ?? 0),
};
  ui.setUser({
    ...CURRENT_USER,
    level: Number(progress.level || 1),
  });

  ui.setCoins(Number(user.coins ?? progress.coins ?? 0));
  
setTimeout(() => {
  updateAllBadges();
}, 0);
return me;
}

function updateAllBadges() {
  if (!CURRENT_USER) return;

  const FREE_SKIP_LIMIT = 3;
  const FREE_HINT_LIMIT = 3;
  const FREE_RESTART_LIMIT = 3;

  const freeSkipsLeft =
    FREE_SKIP_LIMIT - (CURRENT_USER.free_skips_used ?? 0);
  const freeHintsLeft =
    FREE_HINT_LIMIT - (CURRENT_USER.free_hints_used ?? 0);
  const freeRestartsLeft =
    FREE_RESTART_LIMIT - (CURRENT_USER.free_restarts_used ?? 0);

  const totalSkips =
    Math.max(0, freeSkipsLeft) +
    (CURRENT_USER.skips_balance ?? 0);

  const totalHints =
    Math.max(0, freeHintsLeft) +
    (CURRENT_USER.hints_balance ?? 0);

  const totalRestarts =
    Math.max(0, freeRestartsLeft) +
    (CURRENT_USER.restarts_balance ?? 0);

  ui?.setSkipsBadge?.(totalSkips);
  ui?.setHintsBadge?.(totalHints);
  ui?.setRestartsBadge?.(totalRestarts);
}


async function apiRestart({ mode }) {
  const nonce = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  const res = await fetch(`${BACKEND}/api/restart`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${normalizeToken(CURRENT_ACCESS_TOKEN)}`,
    },
    body: JSON.stringify({ mode, nonce }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) throw new Error(data?.error || "Restart failed");
  return data;
}
function freeRestartsLeft() {
  const used = Number(CURRENT_USER?.free_restarts_used || 0);
  return Math.max(0, FREE_RESTARTS - used);
}
function freeSkipsLeft() {
  const used = Number(CURRENT_USER?.free_skips_used || 0);
  return Math.max(0, FREE_SKIPS - used);
}

function freeHintsLeft() {
  const used = Number(CURRENT_USER?.free_hints_used || 0);
  return Math.max(0, FREE_HINTS - used);
}
function loadGuestProgress() {
  try {
    const raw = localStorage.getItem(GUEST_PROGRESS_KEY);
    if (!raw) return { maxLevel: 1 };
    return JSON.parse(raw);
  } catch (e) {
    return { maxLevel: 1 };
  }
}

function saveGuestProgress(maxLevel) {
  const capped = Math.min(maxLevel, GUEST_MAX_LEVEL);
  localStorage.setItem(
    GUEST_PROGRESS_KEY,
    JSON.stringify({ maxLevel: capped })
  );
}

async function boot() {
    // Ensure Pi SDK is initialized before login can happen
  try {
    if (window.Pi && !window.__PI_INITIALIZED__) {
      await window.Pi.init({ version: "2.0" });
      window.__PI_INITIALIZED__ = true;
      console.log("Pi SDK initialized");
    }
  } catch (e) {
    console.warn("Pi SDK init failed", e);
  }
    const storedToken = localStorage.getItem("pi_access_token");

if (storedToken) {
  try {
    CURRENT_ACCESS_TOKEN = normalizeToken(storedToken);

    // silently validate token with backend
    const me = await loadMeAndSyncUI({
      BACKEND,
      token: CURRENT_ACCESS_TOKEN,
      ui,
    });
if (me?.dailyReward?.canClaim) {
  dailyRewardPopup.show({
    day: me.dailyReward.day,
    coins: me.dailyReward.coins
  });
}
    if (!me?.user) {
      throw new Error("session_invalid");
    }

  } catch (e) {
    // token expired or invalid → clear session silently
    CURRENT_ACCESS_TOKEN = null;
    CURRENT_USER = null;
    localStorage.removeItem("pi_access_token");
  }
}

// never show a "logged-in" user until backend validates token
CURRENT_USER = null;
ui?.setUser?.({ username: "Guest", uid: null });
ui?.setCoins?.(0);
// 🔥 AUTO-HYDRATE USER IF TOKEN EXISTS

  const root = document.querySelector("#app");
  if (!root) {
    document.body.innerHTML = "<h1>#app not found</h1>";
    return;
  }
  // Mount UI
     ui = mountUI(root);
if (CURRENT_ACCESS_TOKEN) {
  try {
    const me = await loadMeAndSyncUI({
      BACKEND,
      token: CURRENT_ACCESS_TOKEN,
      ui,
    });

    if (me?.user) {
  document.body.classList.add("game-running");

  const unlocked = Number(me?.progress?.level || 1);
  CURRENT_MAX_UNLOCKED_LEVEL = Math.max(1, unlocked);
  levelsUI.setUnlocked?.(CURRENT_MAX_UNLOCKED_LEVEL);

  // enable resume for logged-in users
  RESUME_ENABLED = true;

  // restore saved path + position from backend
  const paintedKeys = me?.progress?.paintedKeys;
  const resume = me?.progress?.resume;

  RESUME_TILES = new Set(Array.isArray(paintedKeys) ? paintedKeys : []);
  RESUME_POS =
    resume && resume.x != null && resume.y != null
      ? { x: resume.x, y: resume.y }
      : null;

if (!game?.isRunning?.()) {
  game.start();
}

// go to the last unlocked level (where resume is stored)
goToLevel(CURRENT_MAX_UNLOCKED_LEVEL - 1);

// ✅ APPLY PROGRESS AFTER GAME IS RUNNING + LEVEL IS SET
setTimeout(() => {
  if (RESUME_TILES.size > 0 || RESUME_POS) {
    game.applyProgress({
      paintedKeys: Array.from(RESUME_TILES),
      player: RESUME_POS,
    });
  }
}, 0);

  updateAllBadges();
  document.body.classList.remove("welcome-visible");
  if (me?.dailyReward?.canClaim) {
  dailyRewardPopup.show({
    day: me.dailyReward.day,
    coins: me.dailyReward.coins,
  });
}
}
     else {
      throw new Error("Invalid session");
     }
  } catch (e) {
    console.warn("Token invalid during boot");
    CURRENT_ACCESS_TOKEN = null;
    CURRENT_USER = null;
    localStorage.removeItem("pi_access_token");
    document.body.classList.add("welcome-visible");
  }
}
// expose a prestart hook so ui.js can start Pi auth on touchstart (fixes 2-tap on mobile)
window.__maze = window.__maze || {};
window.__maze.prestartLogin = () => {
  try {
    // import at top:  import { ensurePiLogin, prestartPiLogin } from "./pi/piClient.js";
    prestartPiLogin(BACKEND);
  } catch {}
};

// Expose a tiny bridge for UI modules that don't have direct access to `ui`.
// (Used by the Levels screen to show "Login required" for locked guest levels.)
window.__maze = window.__maze || {};
window.__maze.guestMaxLevel = GUEST_MAX_LEVEL;
window.__maze.showLoginRequired = () => ui.showLoginRequired();
window.__maze.isLoggedIn = () => Boolean(CURRENT_ACCESS_TOKEN);

const winPopup = createWinPopup();
const skipPopup = createSkipPopup();
const hintPopup = createHintPopup();
const restartPopup = createRestartPopup();
const dailyRewardPopup = createDailyRewardPopup();
/* -------------------------------
   HINT ARROWS OVERLAY (animated)
-------------------------------- */
const hintStyle = document.createElement("style");
hintStyle.textContent = `
  #hintArrows {
    position: fixed;
    left: 50%;
    top: 52%;
    transform: translate(-50%, -50%);
    z-index: 99999;
    pointer-events: none;
    display: none;
  }
  #hintArrows .stack {
    position: relative;
    width: 64px;
    height: 220px;
    filter: drop-shadow(0 10px 16px rgba(0,0,0,0.35));
  }
  #hintArrows .chev {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    width: 0;
    height: 0;
    border-left: 16px solid transparent;
    border-right: 16px solid transparent;
    border-bottom: 22px solid rgba(255,255,255,0.92);
    opacity: 0;
    animation: hintPulse 1.2s linear infinite;
  }
  #hintArrows .chev:nth-child(1) { top: 170px; animation-delay: 0.00s; }
  #hintArrows .chev:nth-child(2) { top: 135px; animation-delay: 0.12s; }
  #hintArrows .chev:nth-child(3) { top: 100px; animation-delay: 0.24s; }
  #hintArrows .chev:nth-child(4) { top: 65px;  animation-delay: 0.36s; }
  #hintArrows .chev:nth-child(5) { top: 30px;  animation-delay: 0.48s; }

  @keyframes hintPulse {
    0%   { opacity: 0; transform: translateX(-50%) translateY(18px) scale(0.96); }
    35%  { opacity: 0.95; }
    70%  { opacity: 0.15; }
    100% { opacity: 0; transform: translateX(-50%) translateY(-18px) scale(1.04); }
  }

  /* rotate the whole stack for direction */
  #hintArrows.dir-up    { transform: translate(-50%, -50%) rotate(0deg); }
  #hintArrows.dir-right { transform: translate(-50%, -50%) rotate(90deg); }
  #hintArrows.dir-down  { transform: translate(-50%, -50%) rotate(180deg); }
  #hintArrows.dir-left  { transform: translate(-50%, -50%) rotate(270deg); }
`;
document.head.appendChild(hintStyle);

const hintArrowsEl = document.createElement("div");
hintArrowsEl.id = "hintArrows";
hintArrowsEl.innerHTML = `
  <div class="stack">
    <div class="chev"></div>
    <div class="chev"></div>
    <div class="chev"></div>
    <div class="chev"></div>
    <div class="chev"></div>
  </div>
`;
document.body.appendChild(hintArrowsEl);
function startRouteHintForLevel(levelNumber) {
  const route = LEVEL_ROUTES?.[levelNumber];

  // reset previous hint state/timers
  hideHintArrows();

  if (!Array.isArray(route) || route.length === 0) {
    return;
  }

  HINT_ACTIVE_FOR_LEVEL = true;
  HINT_ROUTE = route;
  HINT_ROUTE_INDEX = 0;

  // seed last player key to prevent instant auto-advance
  const st = game?.getState?.();
  if (st?.player) {
    HINT_LAST_PLAYER_KEY = `${st.player.x},${st.player.y}`;
  }

  showHintArrows(route[0]);
}

let HINT_LAST_PLAYER_KEY = null;
let HINT_MOVE_LOCK = false;
let HINT_STABLE_TIMER = null;

function advanceRouteStep() {
  if (!HINT_ACTIVE_FOR_LEVEL) return;
  if (!Array.isArray(HINT_ROUTE) || HINT_ROUTE.length === 0) return;

  const nextIndex = Math.min(HINT_ROUTE.length - 1, HINT_ROUTE_INDEX + 1);
  if (nextIndex !== HINT_ROUTE_INDEX) {
    HINT_ROUTE_INDEX = nextIndex;
    const dir = HINT_ROUTE[HINT_ROUTE_INDEX];
    if (dir) showHintArrows(dir);
  }
}
async function apiClaimDailyReward() {
  if (!CURRENT_ACCESS_TOKEN) return null;

  const res = await fetch(`${BACKEND}/api/daily-reward/claim`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${normalizeToken(CURRENT_ACCESS_TOKEN)}`,
    },
  });

  return res.json().catch(() => ({}));
}

function onAnyPaintDuringMove() {
  if (!HINT_ACTIVE_FOR_LEVEL) return;
  if (!Array.isArray(HINT_ROUTE) || HINT_ROUTE.length === 0) return;

  const st = game?.getState?.();
  if (!st?.player) return;

  const key = `${st.player.x},${st.player.y}`;

  // lock is released only after player position stays stable for a short time
  if (key !== HINT_LAST_PLAYER_KEY) {
    HINT_LAST_PLAYER_KEY = key;

    // first paint of a swipe: start lock
    if (!HINT_MOVE_LOCK) {
      HINT_MOVE_LOCK = true;
    }
  }

  clearTimeout(HINT_STABLE_TIMER);
  HINT_STABLE_TIMER = setTimeout(() => {
    HINT_MOVE_LOCK = false;
    advanceRouteStep();
  }, 160);
}


function scheduleHintRecalc() {
  if (!HINT_ACTIVE_FOR_LEVEL) return;
  if (!game?.getState) return;

  if (HINT_RECALC_TIMER) return;
  HINT_RECALC_TIMER = setTimeout(() => {
    HINT_RECALC_TIMER = null;
    if (!game?.getState) return;
    applySmartHintArrows(game);
  }, 80);
}
function showHintArrows(dir /* "up"|"down"|"left"|"right" */) {
  hintArrowsEl.classList.remove("dir-up","dir-down","dir-left","dir-right");
  hintArrowsEl.classList.add(`dir-${dir}`);
  hintArrowsEl.style.display = "block";
  HINT_ACTIVE_FOR_LEVEL = true;
}
function hideHintArrows() {
  hintArrowsEl.style.display = "none";
  HINT_ACTIVE_FOR_LEVEL = false;

  HINT_ROUTE = null;
  HINT_ROUTE_INDEX = 0;

  clearTimeout(HINT_ROUTE_TIMER);
  HINT_ROUTE_TIMER = null;

  clearTimeout(HINT_STABLE_TIMER);
  HINT_STABLE_TIMER = null;

  HINT_LAST_PLAYER_KEY = null;
  HINT_MOVE_LOCK = false;
}
/* -------------------------------
   SMART NEXT MOVE (best immediate)
-------------------------------- */
function _slideTargetAndNewPaintCount(state, dx, dy) {
  const sx = state.player.x;
  const sy = state.player.y;

  let x = sx;
  let y = sy;
  let newPaint = 0;

  while (true) {
    const nx = x + dx;
    const ny = y + dy;
    if (!state.isWalkable(nx, ny)) break;
    x = nx;
    y = ny;
    const k = `${x},${y}`;
    if (!state.painted.has(k)) newPaint++;
  }

  const dist = Math.abs(x - sx) + Math.abs(y - sy);
  return { dist, newPaint };
}

function getBestDirection(state) {
  const options = [
    { dir: "up", dx: 0, dy: -1 },
    { dir: "down", dx: 0, dy: 1 },
    { dir: "left", dx: -1, dy: 0 },
    { dir: "right", dx: 1, dy: 0 },
  ].map((d) => {
    const out = _slideTargetAndNewPaintCount(state, d.dx, d.dy);
    return { ...d, ...out };
  }).filter(o => o.dist > 0);

  if (!options.length) return null;

  options.sort((a, b) => {
    if (b.newPaint !== a.newPaint) return b.newPaint - a.newPaint;
    return b.dist - a.dist;
  });

  return options[0].dir;
}

function applySmartHintArrows(game) {
  const state = game?.getState?.();
  if (!state) return;
  const dir = getBestDirection(state);
  if (!dir) return;
  showHintArrows(dir);
}
// simple hint overlay (text)
const hintTextEl = document.createElement("div");
hintTextEl.id = "hintTextOverlay";
hintTextEl.style.cssText = `
  position: fixed;
  left: 50%;
  bottom: 110px;
  transform: translateX(-50%);
  max-width: min(92vw, 520px);
  background: rgba(0,0,0,0.82);
  color: #fff;
  padding: 12px 14px;
  border-radius: 14px;
  font-size: 14px;
  line-height: 1.35;
  z-index: 99999;
  display: none;
`;
document.body.appendChild(hintTextEl);

let hintTextTimer = null;
function showHintText(msg) {
  if (!msg) return;
  hintTextEl.textContent = String(msg);
  hintTextEl.style.display = "block";
  clearTimeout(hintTextTimer);
  hintTextTimer = setTimeout(() => {
    hintTextEl.style.display = "none";
  }, 4500);
}

function _slideTargetAndNewPaintCount(state, dx, dy) {
  const sx = state.player.x;
  const sy = state.player.y;

  let x = sx;
  let y = sy;

  let newPaint = 0;

  // move until wall, counting unpainted walkable tiles passed through
  while (true) {
    const nx = x + dx;
    const ny = y + dy;
    if (!state.isWalkable(nx, ny)) break;

    x = nx;
    y = ny;

    const k = `${x},${y}`;
    if (!state.painted.has(k)) newPaint++;
  }

  const dist = Math.abs(x - sx) + Math.abs(y - sy);
  return { tx: x, ty: y, dist, newPaint };
}

function getSmartHintFromState(state) {
  if (!state) return null;

  const dirs = [
    { name: "UP", dx: 0, dy: -1, arrow: "↑" },
    { name: "DOWN", dx: 0, dy: 1, arrow: "↓" },
    { name: "LEFT", dx: -1, dy: 0, arrow: "←" },
    { name: "RIGHT", dx: 1, dy: 0, arrow: "→" },
  ];

  const options = [];

  for (const d of dirs) {
    const out = _slideTargetAndNewPaintCount(state, d.dx, d.dy);

    // ignore “no movement”
    if (out.dist <= 0) continue;

    options.push({
      ...d,
      ...out,
    });
  }

  if (options.length === 0) return null;

  // Prefer: paints the most new tiles
  // Tie-break: longer slide distance (usually better reposition)
  options.sort((a, b) => {
    if (b.newPaint !== a.newPaint) return b.newPaint - a.newPaint;
    return b.dist - a.dist;
  });

  return options[0];
}

function showSmartHint(game) {
  const state = game?.getState?.();
  const best = getSmartHintFromState(state);

  if (!best) {
    showHintText("No hint available.");
    return;
  }

  // short, actionable hint
  showHintText(`Swipe ${best.name} ${best.arrow}`);
}



  function setLevel(i) {
    levelIndex = Math.max(0, Math.min(levels.length - 1, i));
    ui.setLevel(levelIndex + 1);
    game.setLevel(levels[levelIndex]);
  }

  function goNextLevel() {
    setLevel(levelIndex + 1);
  }

  // (level-complete reward is handled via global apiClaimLevelComplete)


const levelsUI = mountLevelsUI(root, { totalLevels: levels.length });  
ui.levelsBtn.addEventListener("click", () => {
  // keep levels UI in sync before opening
if (CURRENT_ACCESS_TOKEN) {
  // logged-in: NEVER apply guest cap
  levelsUI.setUnlocked?.(CURRENT_MAX_UNLOCKED_LEVEL || 1);
} else {
  const guestProgress = loadGuestProgress();
  const unlocked = Math.min(guestProgress.maxLevel || 1, GUEST_MAX_LEVEL);
  CURRENT_MAX_UNLOCKED_LEVEL = unlocked;
  levelsUI.setUnlocked?.(unlocked);
}

  levelsUI.open();
});

// Level select
levelsUI.onSelect((levelNumber) => {
  // Guest can only open levels 1..GUEST_MAX_LEVEL
  if (!CURRENT_ACCESS_TOKEN && levelNumber > GUEST_MAX_LEVEL) {
    ui.showLoginRequired();
    return;
  }
  goToLevel(levelNumber - 1);
});
  if (CURRENT_ACCESS_TOKEN) {
  document.body.classList.remove("welcome-visible");
} else {
  document.body.classList.add("welcome-visible");
  ui.showWelcome();
}
  if (!CURRENT_ACCESS_TOKEN) {
  // if guest is already running and on level 1, run tutorial hint once
  maybeAutoHintTutorial();
}

// Create game (DO NOT START)
  game = createGame({
  canvas: ui.canvas,
  level: levels[0],
  getCurrentUser: () => CURRENT_USER ?? { username: "guest", uid: null },

onTilePainted({ key, x, y }) {
if (HINT_ACTIVE_FOR_LEVEL) {
  onAnyPaintDuringMove();
}
  // resume save is logged-in only
  if (!CURRENT_ACCESS_TOKEN) return;
  if (!RESUME_ENABLED) return;

  RESUME_TILES.add(key);
  RESUME_POS = { x, y };

  scheduleResumeSave(levelIndex + 1);
},

  async onLevelComplete({ level }) {
      hideHintArrows();
HINT_ROUTE = null;
HINT_ROUTE_INDEX = 0;
HINT_ACTIVE_FOR_LEVEL = false;
RESUME_ENABLED = false;

    const completedLevel = level?.number ?? (levelIndex + 1);

    // ✅ server reward: +1 coin once per level
    // ✅ server reward: +1 coin once per level
afterLevelCompleteShowAdOrWin({
  levelNumber: completedLevel,
});

// ✅ server reward: +1 coin once per level
if (CURRENT_ACCESS_TOKEN) {
  (async () => {
    try {
      await apiClaimLevelComplete(completedLevel);

      // hard refresh from DB so later UI/state cannot overwrite it
      const me = await loadMeAndSyncUI({
        BACKEND,
        token: CURRENT_ACCESS_TOKEN,
        ui,
      });

      if (me?.user) {
        ui.setCoins(Number(me.user.coins ?? 0));
      }
    } catch (e) {}
  })();
}
    // ✅ logged-in: unlock next level in UI (old UNLOCKED_LEVEL behavior)
    // ✅ logged-in: unlock next level + SAVE progress (OLD LOGIC RESTORED)
if (CURRENT_ACCESS_TOKEN) {
  const nextUnlocked = Math.min(levels.length, completedLevel + 1);

  CURRENT_MAX_UNLOCKED_LEVEL = Math.max(
    CURRENT_MAX_UNLOCKED_LEVEL,
    nextUnlocked
  );

  setTimeout(() => levelsUI.setUnlocked?.(CURRENT_MAX_UNLOCKED_LEVEL), 0);

  // persist unlocked progress + CLEAR resume
  apiSetProgress({
      uid: CURRENT_USER.uid,
    level: nextUnlocked,
    paintedKeys: [],
    resume: null,
  }).catch(() => {});
}
    // 🟡 guest progress is local-only (levels 1..GUEST_MAX_LEVEL)
    if (!CURRENT_ACCESS_TOKEN) {
      const nextUnlock = Math.min(GUEST_MAX_LEVEL, completedLevel + 1);
      const current = loadGuestProgress();
      const newMax = Math.min(
        GUEST_MAX_LEVEL,
        Math.max(current?.maxLevel || 1, nextUnlock)
      );
      saveGuestProgress(newMax);
      CURRENT_MAX_UNLOCKED_LEVEL = newMax;
      // update Levels UI after popup has been mounted
      setTimeout(() => levelsUI.setUnlocked?.(newMax), 0);
    }
  },
});
function maybeAutoHintTutorial() {
  // no-op; tutorial is started directly inside ui.onGuestStart
}
function wipeResumeForCurrentLevel() {
  if (!CURRENT_ACCESS_TOKEN) return;

  RESUME_TILES = new Set();
  RESUME_POS = null;

  apiSetProgress({
    uid: CURRENT_USER.uid,
    level: CURRENT_MAX_UNLOCKED_LEVEL,
    paintedKeys: [],
    resume: null,
  }).catch(() => {});
}

function restartLevelForHint() {
  hideHintArrows();

  // clear saved in-level progress for logged-in users
  if (CURRENT_ACCESS_TOKEN) {
    wipeResumeForCurrentLevel();
  }


  // reset route-hint state so arrows start from step 1
  HINT_ROUTE = null;
  HINT_ROUTE_INDEX = 0;
  HINT_ACTIVE_FOR_LEVEL = false;
    // restart current level locally without consuming restart resource
  game.setLevel(levels[levelIndex]);

}
function goToLevel(nextIndex) {
    hideHintArrows();
HINT_ROUTE = null;
HINT_ROUTE_INDEX = 0;
HINT_ACTIVE_FOR_LEVEL = false;
RESUME_ENABLED = false;
  levelIndex = Math.max(0, Math.min(levels.length - 1, nextIndex));
  const lvl = levels[levelIndex];

  const selectedLevelNumber = levelIndex + 1;

  game.setLevel(lvl);
// ✅ Capture spawn tile AFTER level fully loads
setTimeout(() => {
  const p = game.getPlayer?.();
  if (p) {
    LEVEL_START_KEY = `${p.x},${p.y}`;
    console.log("LEVEL_START_KEY =", LEVEL_START_KEY);
  }
}, 50);
  ui.setLevel(selectedLevelNumber);

  // Only logged-in users can resume
  if (!CURRENT_ACCESS_TOKEN) return;

  RESUME_ENABLED = true;

  // Fetch latest progress from backend memory (already loaded in CURRENT_MAX_UNLOCKED_LEVEL flow)
  fetch(`${BACKEND}/api/me`, {
    headers: {
      Authorization: `Bearer ${normalizeToken(CURRENT_ACCESS_TOKEN)}`,
    },
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((me) => {
      const progress = me?.progress;
      if (!progress) return;

      // Only resume if this level matches saved level
      if (progress.level !== selectedLevelNumber) return;

      const paintedKeys = progress.paintedKeys;
      const resume = progress.resume;

      if (Array.isArray(paintedKeys) || resume) {
        RESUME_TILES = new Set(Array.isArray(paintedKeys) ? paintedKeys : []);
        RESUME_POS = resume ?? null;

        game.applyProgress({
          paintedKeys: Array.from(RESUME_TILES),
          player: RESUME_POS,
        });
      }
    })
    .catch(() => {});
}
function simulateInterstitialAd(onFinished) {
  simulateAd({
    onFinished,
    duration: 20,
    skipAfter: 5,
    buttonLabel: "Skip Ad",
    rewardReadyText: "✅ Ad Finished",
  });
}
function afterLevelCompleteShowAdOrWin({ levelNumber }) {
  // Optional: do not show auto ads on the first few levels
  if (levelNumber <= 2) {
    winPopup.show({ levelNumber });
    return;
  }

  // never stack a second ad on top of an existing one
  if (AD_OVERLAY_ACTIVE) {
    return;
  }

  if (shouldShowAutoAd()) {
    markAutoAdShown();

    simulateInterstitialAd(() => {
      winPopup.show({ levelNumber });
    });
  } else {
    winPopup.show({ levelNumber });
  }
}
function simulateAd({
  onFinished,
  duration = 10,
  skipAfter = 10,
  buttonLabel = "Close",
} = {}) {
  if (AD_OVERLAY_ACTIVE) return;
  AD_OVERLAY_ACTIVE = true;
  document.body.classList.add("ad-playing");

  let seconds = duration;
  let skipUnlock = skipAfter;
  let finished = false;

  const overlay = document.createElement("div");
  overlay.className = "ad-overlay";

  overlay.innerHTML = `
    <div class="ad-box">
      <div class="ad-video">
        🎮 Sponsored Ad
      </div>

      <div id="adCountdown">
        Ad ends in <b>${seconds}</b>s
      </div>

      <div class="ad-progress-container">
        <div id="adBar" class="ad-progress-bar"></div>
      </div>

      <button id="closeAdBtn" class="ad-close-btn" disabled>
        ${skipUnlock > 0 ? `${buttonLabel} in ${skipUnlock}s` : buttonLabel}
      </button>
    </div>
  `;

  document.body.appendChild(overlay);

  const countdownEl = overlay.querySelector("#adCountdown");
  const bar = overlay.querySelector("#adBar");
  const closeBtn = overlay.querySelector("#closeAdBtn");

  const total = duration;

  const interval = setInterval(() => {
    seconds -= 1;
    if (skipUnlock > 0) skipUnlock -= 1;

    countdownEl.innerHTML = `Ad ends in <b>${seconds}</b>s`;
    bar.style.width = `${((total - seconds) / total) * 100}%`;

    if (skipUnlock > 0) {
      closeBtn.textContent = `${buttonLabel} in ${skipUnlock}s`;
      closeBtn.disabled = true;
      closeBtn.classList.remove("enabled");
    } else {
      closeBtn.textContent = buttonLabel;
      closeBtn.disabled = false;
      closeBtn.classList.add("enabled");
    }

    if (seconds <= 0) {
      clearInterval(interval);
      finished = true;
      closeBtn.textContent = "Close";
      closeBtn.disabled = false;
      closeBtn.classList.add("enabled");
    }
  }, 1000);

  closeBtn.addEventListener("click", () => {
    if (!finished && skipUnlock > 0) return;
    document.body.removeChild(overlay);
    AD_OVERLAY_ACTIVE = false;
onFinished?.();
  });
}
async function grantRestartAdReward() {
  const out = await fetch(`${BACKEND}/api/restart`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${normalizeToken(CURRENT_ACCESS_TOKEN)}`,
    },
    body: JSON.stringify({
      mode: "ad",
      nonce: crypto.randomUUID(),
    }),
  }).then((r) => r.json());

  if (!out?.ok) return alert(out.error || "Restart failed");

  applyUserPatch({
    free_restarts_used: out.free_restarts_used,
    restarts_balance: out.restarts_balance,
  });

  updateAllBadges();
  wipeResumeForCurrentLevel();
  game.setLevel(levels[levelIndex]);
}

dailyRewardPopup.onClaim(async () => {
  const out = await apiClaimDailyReward();

  if (!out?.ok) {
    dailyRewardPopup.hide();
    return;
  }

  if (out?.user) {
    applyUserPatch(out.user);
    ui.setCoins(out.user.coins ?? 0);
  }

  dailyRewardPopup.hide();
});

function goNextLevel() {
  goToLevel(levelIndex + 1);
}
winPopup.onNextLevel(() => {
  const nextLevelNumber = levelIndex + 2; // levelIndex is 0-based

  // 🔒 Guest limit: require login after level 5
if (!CURRENT_ACCESS_TOKEN && nextLevelNumber > GUEST_MAX_LEVEL) {
    winPopup.hide();
    ui.showLoginRequired();
    return;
  }

  winPopup.hide();
  goNextLevel();
});
winPopup.onWatchAdClick(() => {
  if (!CURRENT_ACCESS_TOKEN) {
    ui.showLoginRequired();
    return;
  }

  if (!guardAdCooldownBeforeWatching()) {
    return;
  }
 simulateAd({
  onFinished: async () => {
    const nonce = crypto.randomUUID();

    const res = await fetch(`${BACKEND}/api/rewards/ad-50`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${normalizeToken(CURRENT_ACCESS_TOKEN)}`,
      },
      body: JSON.stringify({ nonce }),
    });

    const out = await res.json().catch(() => ({}));
    console.log("AD +50 RESPONSE", out);

    if (out?.already) {
      showAdCooldownToast("Ad already claimed. Please wait a few minutes.");
      return;
    }

    if (out?.user?.coins != null) {
      markAdClaimedNow();
      ui.setCoins(out.user.coins);
      applyUserPatch({ coins: out.user.coins });
    }

    winPopup.hide();
    goNextLevel();
  },
});
});

// ---- SKIP / HINT buttons (backend-powered) ----
ui.onSkipClick(async () => {
  if (!CURRENT_ACCESS_TOKEN) {
    ui.showLoginRequired();
    return;
  }

  try {
    const out = await apiSkip({ mode: "auto" });

    applyUserPatch({
  free_skips_used: out.free_skips_used,
  skips_balance: out.skips_balance,
  coins: out.coins,
});

    updateAllBadges();
    goNextLevel();
    return;

  } catch (e) {
    if (e.message === "No skips available") {
      skipPopup.open({
        coins: CURRENT_USER?.coins ?? 0,
        freeLeft: 0,
      });
      return;
    }

    console.error("Skip error:", e);
  }
});


skipPopup.onBuySkip(async () => {
  try {
    const out = await apiSkip({ mode: "coins" });

    applyUserPatch({
  free_skips_used: out.free_skips_used,
  skips_balance: out.skips_balance,
  coins: out.coins,
});

    updateAllBadges();
    skipPopup.hide();
    goNextLevel();

  } catch (e) {
    alert(e.message || "Skip failed");
  }
});


skipPopup.onWatchAdSkip(() => {
  if (!guardAdCooldownBeforeWatching()) {
    return;
  }

  simulateAd({
    onFinished: async () => {
      const out = await apiSkip({
        mode: "ad",
        nonce: crypto.randomUUID(),
      });

      if (!out?.ok) {
        showAdCooldownToast(out.error || "Skip failed");
        return;
      }

      markAdClaimedNow();

      applyUserPatch({
        free_skips_used: out.free_skips_used,
        skips_balance: out.skips_balance,
      });

      updateAllBadges();
      skipPopup.hide();
      goNextLevel();
    },
  });
});
ui.onHintClick(async () => {
  if (!CURRENT_ACCESS_TOKEN) {
    ui.showLoginRequired();
    return;
  }

  try {
    const out = await apiHint({ mode: "auto" });

    applyUserPatch({
      free_hints_used: out.free_hints_used,
      hints_balance: out.hints_balance,
      coins: out.coins,
    });

    updateAllBadges();

    restartLevelForHint();
    startRouteHintForLevel(levelIndex + 1);

    return;
  } catch (e) {
    if (e.message === "No hints available") {
      hintPopup.open({
        coins: CURRENT_USER?.coins ?? 0,
        freeLeft: 0,
      });
      return;
    }

    console.error("Hint error:", e);
  }
});

hintPopup.onBuyHint(async () => {
  try {
    const out = await apiHint({ mode: "coins" });

    applyUserPatch({
      free_hints_used: out.free_hints_used,
      hints_balance: out.hints_balance,
      coins: out.coins,
    });

    updateAllBadges();
    hintPopup.hide();

    restartLevelForHint();
    startRouteHintForLevel(levelIndex + 1);
  } catch (e) {
    alert(e.message || "Hint failed");
  }
});

hintPopup.onWatchAdHint(() => {
  if (!guardAdCooldownBeforeWatching()) {
    return;
  }

  simulateAd({
    onFinished: async () => {
      const out = await apiHint({
        mode: "ad",
        nonce: crypto.randomUUID(),
      });

      if (!out?.ok) {
        showAdCooldownToast(out.error || "Hint failed");
        return;
      }

      markAdClaimedNow();

      applyUserPatch({
        free_hints_used: out.free_hints_used,
        hints_balance: out.hints_balance,
      });

      updateAllBadges();
      hintPopup.hide();

      restartLevelForHint();
      startRouteHintForLevel(levelIndex + 1);
    },
  });
});

ui.onRestartClick(async () => {
  if (!CURRENT_ACCESS_TOKEN) {
    ui.showLoginRequired();
    return;
  }

  try {
    const out = await fetch(`${BACKEND}/api/restart`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${normalizeToken(CURRENT_ACCESS_TOKEN)}`,
      },
      body: JSON.stringify({
        mode: "auto",
        nonce: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      }),
    }).then((r) => r.json());

    if (!out?.ok) throw new Error(out?.error);

    applyUserPatch({
      free_restarts_used: out.free_restarts_used,
      restarts_balance: out.restarts_balance,
      coins: out.coins,
    });

    updateAllBadges();
    wipeResumeForCurrentLevel();
    game.setLevel(levels[levelIndex]);
    return;

  } catch (e) {
    if (e.message === "No restarts available") {
      restartPopup.open({
        coins: CURRENT_USER?.coins ?? 0,
        freeLeft: 0,
      });
      return;
    }

    console.error("Restart error:", e);
  }
});


restartPopup.onBuyRestart(async () => {
  try {
    const out = await fetch(`${BACKEND}/api/restart`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${normalizeToken(CURRENT_ACCESS_TOKEN)}`,
      },
      body: JSON.stringify({
        mode: "coins",
        nonce: crypto.randomUUID(),
      }),
    }).then((r) => r.json());

    if (!out?.ok) throw new Error(out?.error);

    applyUserPatch({
  free_restarts_used: out.free_restarts_used,
  restarts_balance: out.restarts_balance,
  coins: out.coins,
});

    updateAllBadges();
    wipeResumeForCurrentLevel();
    game.setLevel(levels[levelIndex]);
    restartPopup.hide();

  } catch (e) {
    alert(e.message || "Restart failed");
  }
});


restartPopup.onWatchAdRestart(() => {
  if (!guardAdCooldownBeforeWatching()) {
    return;
  }

  simulateAd({
    onFinished: async () => {
      const out = await fetch(`${BACKEND}/api/restart`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${normalizeToken(CURRENT_ACCESS_TOKEN)}`,
        },
        body: JSON.stringify({
          mode: "ad",
          nonce: crypto.randomUUID(),
        }),
      }).then(r => r.json());

      if (!out?.ok) {
        showAdCooldownToast(out.error || "Restart failed");
        return;
      }

      markAdClaimedNow();

      applyUserPatch({
        free_restarts_used: out.free_restarts_used,
        restarts_balance: out.restarts_balance,
        coins: out.coins,
      });

      updateAllBadges();
      wipeResumeForCurrentLevel();
      game.setLevel(levels[levelIndex]);
      restartPopup.hide();
    },
  });
});
  // ---- GUEST ----
ui.onGuestStart(() => {
  CURRENT_USER = { username: "Guest", uid: null };
  CURRENT_ACCESS_TOKEN = null;

  CURRENT_MAX_UNLOCKED_LEVEL = 1;

  setLevel(0);

  ui.setUser({
    ...CURRENT_USER,
    level: 1,
  });

  document.body.classList.add("game-running");
  ui.hideWelcome();

  if (!game.isRunning?.()) {
    game.start();
  }

  updateAllBadges();

  // tutorial hint: level 1 guest only, once
  if (localStorage.getItem(AUTO_HINT_SEEN_KEY) !== "1") {
    setTimeout(() => {
      if ((levelIndex + 1) !== 1) return;

      startRouteHintForLevel(1);
      localStorage.setItem(AUTO_HINT_SEEN_KEY, "1");
    }, 600);
  }
});
// ---- PI LOGIN ----

ui.onLoginClick(async (e) => {
  // fix "first tap does nothing" + prevent double taps
  e?.preventDefault?.();
  e?.stopPropagation?.();
  if (LOGIN_IN_PROGRESS) return;
  LOGIN_IN_PROGRESS = true;

  showLoginLoading();

  try {
    const result = await ensurePiLogin({
      BACKEND,
      ui,
      onLogin: ({ accessToken }) => {
        CURRENT_ACCESS_TOKEN = normalizeToken(accessToken);
        localStorage.setItem("pi_access_token", CURRENT_ACCESS_TOKEN);
      },
    });

    if (!CURRENT_ACCESS_TOKEN && result?.accessToken) {
      CURRENT_ACCESS_TOKEN = normalizeToken(result.accessToken);
    }

    if (!CURRENT_ACCESS_TOKEN) {
      hideLoginLoading();
      LOGIN_IN_PROGRESS = false;
      document.body.classList.remove("game-running");
      document.body.classList.add("welcome-visible");
      ui.showWelcome();
      return;
    }

    const me = await loadMeAndSyncUI({
      BACKEND,
      token: CURRENT_ACCESS_TOKEN,
      ui,
    });

    if (!me?.user) {
      hideLoginLoading();
      LOGIN_IN_PROGRESS = false;
      CURRENT_ACCESS_TOKEN = null;
      CURRENT_USER = null;
      localStorage.removeItem("pi_access_token");
      document.body.classList.remove("game-running");
      document.body.classList.add("welcome-visible");
      ui.showWelcome();
      return;
    }

    const unlockedLevel =
      me?.progress?.level ??
      me?.progress?.maxLevel ??
      me?.progress?.highestLevel ??
      1;

    const UNLOCKED_LEVEL = Math.max(1, Number(unlockedLevel) || 1);

    window.__maze.guestMaxLevel = Infinity;

    CURRENT_MAX_UNLOCKED_LEVEL = UNLOCKED_LEVEL;
    levelsUI.setUnlocked?.(UNLOCKED_LEVEL);

    ui.setUser({
      ...CURRENT_USER,
      level: CURRENT_MAX_UNLOCKED_LEVEL,
    });

    setLevel(Math.max(0, UNLOCKED_LEVEL - 1));

    RESUME_ENABLED = true;
    RESUME_TILES = new Set();
    RESUME_POS = null;

    const paintedKeys = me?.progress?.paintedKeys;
    const resume = me?.progress?.resume;

    if (Array.isArray(paintedKeys)) {
      for (const k of paintedKeys) RESUME_TILES.add(k);
    }
    if (resume && resume.x != null && resume.y != null) {
      RESUME_POS = { x: resume.x, y: resume.y };
    }

    document.body.classList.add("game-running");

    if (!game.isRunning?.()) game.start();

    ui.hideWelcome();
    document.body.classList.remove("welcome-visible");

    hideLoginLoading();
    updateAllBadges();
    LOGIN_IN_PROGRESS = false;
    
if (me?.dailyReward?.canClaim) {
  dailyRewardPopup.show({
    day: me.dailyReward.day,
    coins: me.dailyReward.coins,
  });
}

    if (RESUME_TILES.size > 0 || RESUME_POS) {
      setTimeout(() => {
        game.applyProgress({
          paintedKeys: Array.from(RESUME_TILES),
          player: RESUME_POS,
        });
      }, 0);
    }
  } catch (e) {
    hideLoginLoading();
    LOGIN_IN_PROGRESS = false;
    document.body.classList.remove("game-running");
    document.body.classList.add("welcome-visible");
    ui.showWelcome();
  }
});
}

boot();