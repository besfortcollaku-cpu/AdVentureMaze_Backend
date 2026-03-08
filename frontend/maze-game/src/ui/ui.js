import { mountAccountUI } from "./uiAccount.js";
import { mountSettingsUI } from "./uiSettings.js";
import { mountThemeUI } from "./uiTheme.js";
import { getTheme, onThemeChange } from "../theme.js";
// NOTE: Hint/Skip popups are now controlled from src/main.js so
// they can call the backend (free/coins/ad) and update the game.
import { mountLevelsUI } from "./uiLevels.js"; 
export function mountUI(root) {
  root.innerHTML = `
    <div id="app" class="app">
      <header class="top">
        <h1 class="level">Level 1</h1>
    <div class="icons">
  <button class="icon" id="accountBtn">${ICONS.account}</button>
  <button class="icon" id="settingsBtn">${ICONS.settings}</button>
  <button class="icon" id="levelsBtn">${ICONS.levels}</button>
  <button class="icon" id="themeBtn">${ICONS.theme}</button>

  <div class="btn-wrapper">
    <button id="restartBtn" class="icon">${ICONS.restart}</button>
    <span class="badge hidden" id="restartCount"></span>
  </div>
</div>
        <div class="coins">
          <span id="userName" class="userName">Guest</span>
          🪙 <span id="coinCount">0</span>
        </div>
      </header>

      <div class="board">
        <canvas id="game"></canvas>
      </div>

      <footer class="bottom">
<div class="btn-wrapper">
  <button id="hintBtn" class="icon">${ICONS.hint}</button>
  <span class="badge hidden" id="hintCount"></span>
</div>

<span>Swipe to move</span>

<div class="btn-wrapper">
  <button id="skipBtn" class="icon">${ICONS.skip}</button>
  <span class="badge hidden" id="skipCount"></span>
</div>
      </footer>

      <div class="ad">Ad Banner</div>
    </div>
     `;
    
    // ===== WELCOME OVERLAY =====
const welcome = document.createElement("div");
welcome.id = "welcomeOverlay";
welcome.className = "welcomeOverlay";

welcome.innerHTML = `
  <div class="welcomeCard">
    <h1>Welcome to AdVenture Maze</h1>
    <button id="loginBtn" class="startBtn secondary">Login with Pi</button>
    <button id="guestBtn" class="startBtn">Play as Guest</button>
  </div>
`;

document.body.appendChild(welcome);
    // ===== Login Required Overlay =====
const loginRequiredOverlay = document.createElement("div");
loginRequiredOverlay.className = "login-required-overlay hidden";

loginRequiredOverlay.innerHTML = `
  <div class="login-required-card">
    <h2>Login required</h2>
    <p>You need to login to use this feature.</p>

    <div class="login-required-actions">
      <button class="login-btn">Login</button>
      <button class="cancel-btn">Stay Guest</button>
    </div>
  </div>
`;

root.appendChild(loginRequiredOverlay);

const loginReqLoginBtn =
  loginRequiredOverlay.querySelector(".login-btn");
const loginReqCancelBtn =
  loginRequiredOverlay.querySelector(".cancel-btn");

loginReqCancelBtn.onclick = () => {
  loginRequiredOverlay.classList.add("hidden");
};

loginReqLoginBtn.onclick = () => {
  // close login-required popup
  loginRequiredOverlay.classList.add("hidden");

  // FORCE welcome overlay exactly like app start
  welcome.style.display = "flex";
  document.body.classList.add("welcome-visible");
  document.body.classList.remove("game-running");
};


// ----- CORE ELEMENTS -----
const canvas = root.querySelector("#game");
const guestBtn = document.body.querySelector("#guestBtn");
const loginBtn = document.body.querySelector("#loginBtn");
const levelsBtn = root.querySelector("#levelsBtn");
const accountBtn = root.querySelector("#accountBtn");
const themeBtn = root.querySelector("#themeBtn");
const settingsBtn = root.querySelector("#settingsBtn");
const restartBtn = root.querySelector("#restartBtn");
const hintBtn = root.querySelector("#hintBtn");
const skipBtn = root.querySelector("#skipBtn");
  // ----- ACCOUNT UI -----
const accountUI = mountAccountUI(root);

accountBtn.addEventListener("click", () => {
  if (window.__maze?.isLoggedIn?.()) {
    accountUI.show();
  } else {
    window.__maze?.showLoginRequired?.();
  }
});

  // ----- SETTINGS UI -----
  const settingsUI = mountSettingsUI(root);
  settingsBtn.addEventListener("click", () => {
    settingsUI.open();
  });

// ----- THEME UI -----
const themeUI = mountThemeUI(root);
function applyTheme(theme) {
  document.body.classList.remove("theme-ice", "theme-forest", "theme-lava");

  if (theme === "forest") {
    document.body.classList.add("theme-forest");
  } else if (theme === "lava") {
    document.body.classList.add("theme-lava");
  } else {
    // default
    document.body.classList.add("theme-ice");
  }
}

// initial apply
applyTheme(getTheme());

// react to changes
onThemeChange(applyTheme);

themeBtn.addEventListener("click", () => {
  themeUI.open();
});
  // Hint/Skip clicks are wired up by main.js

  // ----- HANDLERS -----
  let guestHandler = null;
  let loginHandler = null;
let onHintClick = () => {};
let onSkipClick = () => {};

let onRestartClick = () => {};
restartBtn.addEventListener("click", () => onRestartClick());

hintBtn.addEventListener("click", () => onHintClick());
skipBtn.addEventListener("click", () => onSkipClick());

  guestBtn.addEventListener("click", () => {
    guestHandler?.();
  });

// Mobile webviews often require touchend to count as the "activation" tap.
loginBtn.style.touchAction = "manipulation";
loginBtn.style.cursor = "pointer";
loginBtn.style.userSelect = "none";
loginBtn.style.webkitUserSelect = "none";
loginBtn.style.webkitTapHighlightColor = "transparent";

let _loginHandled = false;

loginBtn.addEventListener(
  "touchend",
  (e) => {
    _loginHandled = true;
    e.preventDefault();
    e.stopPropagation();

    // start Pi auth in the first real activation gesture
    window.__maze?.prestartLogin?.();

    loginHandler?.(e);
  },
  { passive: false }
);

loginBtn.addEventListener("click", (e) => {
  // ignore the follow-up synthetic click after touchend
  if (_loginHandled) {
    _loginHandled = false;
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  loginHandler?.(e);
});
  


  // ----- iOS EDGE GUARDS -----
  const leftGuard = document.createElement("div");
  leftGuard.className = "edge-guard left";

  const rightGuard = document.createElement("div");
  rightGuard.className = "edge-guard right";

  document.body.appendChild(leftGuard);
  document.body.appendChild(rightGuard);

  // ----- PUBLIC API -----
  return {
      
      
      showLoginRequired() {
  loginRequiredOverlay.classList.remove("hidden");
},
hideLoginRequired() {
  loginRequiredOverlay.classList.add("hidden");
},
    canvas,
    levelsBtn,
    hintBtn,
    themeBtn,
    skipBtn,
    onHintClick(fn) {
    onHintClick = fn;
  },
  onRestartClick(fn) {
  onRestartClick = fn;
},

  onSkipClick(fn) {
    onSkipClick = fn;
  },
    showLoginGate() {
  this.showWelcome();
},
hideLoginGate() {
  this.hideWelcome();
},

showLoginError(msg) {
  alert(msg); // TEMP – replace later with UI label
},

    showWelcome() {
      document.body.classList.remove("game-running");
      document.body.classList.add("welcome-visible");
      welcome.style.display = "flex";
    },

    hideWelcome() {
      document.body.classList.remove("welcome-visible");
      welcome.style.display = "none";
    },

    onLoginClick(cb) {
      loginHandler = cb;
    },
triggerLogin() {
  loginHandler?.();
},
    onGuestStart(cb) {
      guestHandler = cb;
    },

    onFirstUserGesture(cb) {
      const handler = () => {
        window.removeEventListener("pointerdown", handler);
        cb?.();
      };
      window.addEventListener("pointerdown", handler);
    },

    // ---- DATA BINDINGS ----
    setUser(user) {
      const el = document.getElementById("userName");
      if (el) el.textContent = (user && (user.username || user.uid)) || "Guest";
      accountUI.setUser(user);
    },

    setCoins(count) {
      const coinEl = document.getElementById("coinCount");
      if (coinEl) coinEl.textContent = count ?? 0;
      accountUI.setCoins(count);
    },

setHintsBadge(count) {
  const el = document.getElementById("hintCount");
  if (!el) return;

  const n = Number(count) || 0;

  if (n > 0) {
    el.textContent = String(n);
    el.classList.remove("hidden");
  } else {
    el.textContent = "";
    el.classList.add("hidden");
  }
},

setSkipsBadge(count) {
  const el = document.getElementById("skipCount");
  if (!el) return;

  const n = Number(count) || 0;

  if (n > 0) {
    el.textContent = String(n);
    el.classList.remove("hidden");
  } else {
    el.textContent = "";
    el.classList.add("hidden");
  }
},

setRestartsBadge(count) {
  const el = document.getElementById("restartCount");
  if (!el) return;

  const n = Number(count) || 0;

  if (n > 0) {
    el.textContent = String(n);
    el.classList.remove("hidden");
  } else {
    el.textContent = "";
    el.classList.add("hidden");
  }
},
    // ---- STUBS (KEEP) ----
    setLevel(levelNumber) {
      const el = root.querySelector(".top .level");
      if (el) el.textContent = `Level ${levelNumber}`;
    },
  };
}


/* ---------------- SVG ICONS ---------------- */

function iconSVG(path, strokeWidth = 1.8) {
  return `
    <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true">
      <path d="${path}" fill="none" stroke="currentColor" stroke-width="${strokeWidth}"
        stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
}

const ICONS = {
  account: iconSVG("M12 12c2.8 0 5-2.2 5-5s-2.2-5-5-5-5 2.2-5 5 2.2 5 5 5Zm0 2c-4 0-8 2-8 5v1h16v-1c0-3-4-5-8-5"),
  settings: iconSVG("M12 15.2a3.2 3.2 0 1 0 0-6.4a3.2 3.2 0 0 0 0 6.4Zm9-3.2-2-.6a7 7 0 0 0-.6-1.4l1.2-1.8-1.7-1.7-1.8 1.2c-.4-.2-.9-.4-1.4-.6L13 3h-2l-.6 2.1c-.5.1-1 .3-1.4.6L7.2 4.5 5.5 6.2l1.2 1.8c-.2.4-.4.9-.6 1.4L4 12l2.1.6c.1.5.3 1 .6 1.4l-1.2 1.8 1.7 1.7 1.8-1.2c.4.2.9.4 1.4.6L11 21h2l.6-2.1c.5-.1 1-.3 1.4-.6l1.8 1.2 1.7-1.7-1.2-1.8c.2-.4.4-.9.6-1.4L21 12Z", 1.6),
  levels: iconSVG("M5 6h14M5 12h14M5 18h14"),
  theme: iconSVG("M12 3a9 9 0 1 0 9 9c0-.6-.5-1-1-1h-3a2 2 0 0 1-2-2V6a3 3 0 0 0-3-3Z"),
  restart: iconSVG("M12 5v3l4-4-4-4v3a9 9 0 1 0 9 9h-2a7 7 0 1 1-7-7Z"),
  hint: iconSVG("M12 3a6 6 0 0 0-3 11.2V17h6v-2.8A6 6 0 0 0 12 3Zm-1 17h2v2h-2Z"),
  skip: iconSVG("M5 4l8 8-8 8V4Zm10 0h2v16h-2V4Z")
};