// src/ui/ui.js last change

export function mountUI(app) {
  app.innerHTML = `
    <div class="phone">
      <div class="topbar">
        <div class="topRow">
          <div class="brand">
            <div class="logoBox" title="Adventure Maze">
              <img src="/logo.png" alt="Adventure Maze Logo" />
            </div>
            <div class="levelWrap">
                 <div class="levelNew">NEW!</div>
                 <div class="levelText">Adventure Maze</div>
            </div> 
          </div>
               <div class="coins" title="Coins">
                 <div class="coinDot"></div>
                 <div id="coinCount">0</div>
               </div>
          
          
     </div>     
        
        </div>
      <div class="iconRow">
        ${iconBtn("accountBtn", userAccountSVG(), "")}
        ${iconBtn("settingsBtn", gearSVG(), "")}
        ${iconBtn("controls", joystickSVG(), "")}
    </div>
    </div>
    </div>
    </div>
    <div class="boardWrap">
    <div class="boardFrame">
    <canvas id="game"></canvas>
    </div>
    </div>
    <div class="bottomBar">
    <button class="btn" id="hintBtn">
    <div class="btnIcon">🎬</div>
    <div>HINT</div>
    </button>
    <div class="pill">Swipe to move</div>
    <button class="btn" id="x3Btn">
    <div class="btnIcon">⏩</div>
    <div>×3</div>
    </button>
    </div>
    </div>

    <!-- Desktop block (used by Pi detection) -->
    <div class="desktopBlock" id="desktopBlock" style="display:none;">
    <div class="desktopCard">
    <h2>Mobile game</h2>
    <p>This Game is designed for Pi Network Browser Only!</p>
    </div>
    </div>



    <!-- ✅ LOGIN GATE (blocks game until Pi login) -->
    <div class="loginGate" id="loginGate" aria-hidden="true">
      <div class="loginGateCard">
        <div class="loginGateTitle">Login required</div>
        <div class="loginGateSub">
          Please login with Pi account to start playing. 
        </div>

        <button class="loginGateBtn" id="loginGateBtn">
          Login
        </button>

        <div class="loginGateError" id="loginGateError"></div>

        <div class="loginGateNote">
          Tip: open inside Pi Browser.
        </div>
      </div>
    </div>

    <!-- ✅ SETTINGS OVERLAY -->
    <div class="settingsOverlay" id="settingsOverlay" aria-hidden="true">
      <div class="settingsCard">
        <div class="settingsHeader">
          <div class="settingsTitle">Settings</div>
          <button class="settingsClose" id="settingsCloseBtn" aria-label="Close">✕</button>
        </div>

        <div class="settingsRow">
          <div class="settingsLeft">
            <div class="settingsLabel">Sound</div>
            <div class="settingsSub">Rolling + victory (no wall-hit sound)</div>
          </div>
          <label class="toggle">
            <input type="checkbox" id="soundToggle" />
            <span class="track"></span>
          </label>
        </div>

        <div class="settingsRow">
          <div class="settingsLeft">
            <div class="settingsLabel">Vibration</div>
            <div class="settingsSub">Small vibration when ball stops</div>
          </div>
          <label class="toggle">
            <input type="checkbox" id="vibrationToggle" />
            <span class="track"></span>
          </label>
        </div>

        <div class="settingsFoot">
          <div class="settingsNote">Changes are saved automatically.</div>
        </div>
      </div>
    </div>

    <!-- ✅ WIN POPUP -->
    <div class="winOverlay" id="winOverlay" aria-hidden="true">
      <div class="winCard">
        <div class="winSparkLayer"></div>

        <div class="winHeader">
          <div class="winBadge">CONGRATS!</div>
          <div class="winTitle">Level Complete</div>
          <div class="winSub" id="winSubText">You finished Level</div>
        </div>

        <div class="winMusic">
          <div class="winPulse"></div>
          <div class="winNote">♪</div>
          <div class="winMusicText">Victory vibes</div>
        </div>

        <div class="winRow">
          <button class="winBtnPrimary" id="winNextBtn">Next level</button>
          <button class="winBtnSecondary" id="winAdBtn">
            Watch Ad <span class="winPlus">+50</span>
            <span class="winCoinDot" aria-hidden="true"></span>
          </button>
        </div>

        <div class="winHint">Tip: Watch ad gives +50 coins</div>
      </div>
    </div>
    
    <!-- ✅ LEVEL SELECT POPUP -->
    <div class="levelSelectOverlay" id="levelSelectOverlay" aria-hidden="true">
      <div class="winCard">
        <div class="winHeader">
          <div class="winBadge">LEVELS</div>
          <div class="winTitle">Select Level</div>
        </div>

<div class="levelGrid" id="levelGrid"></div>

<div class="winRow">
<button class="winBtnSecondary" id="levelSelectClose">Close</button>
</div>
</div>
</div>
    
    <!-- ✅ FULLSCREEN WELCOME OVERLAY -->
<div class="welcomeOverlay" id="welcomeOverlay" aria-hidden="false">
  <div class="welcomeCard">
    <h1 class="welcomeTitle">Welcome to Adventure Maze</h1>
    <div class="loginWrap">
  <button class="iconBtnWide" id="loginBtn">
    <span id="loginBtnText">Login</span>
  </button>

  <div class="userPill" id="userPill">U:guest</div>

  <!-- ✅ NEW: TEST button (hidden by default) -->
  <button class="iconBtnWide" id="testBtn" style="display:none;">
    Tap To Play
  </button>

</div>
  `;

  // ✅ Inject UI styles (Login Gate + Settings + Win overlay + login wrap)
  const extra = document.createElement("style");
  extra.textContent = `
    .loginWrap{ display:flex; gap:10px; align-items:center; margin-left:auto; }
    .iconBtnWide{
      height:42px; padding:0 14px; border-radius:14px;
      border:1px solid rgba(255,255,255,.18);
      background: rgba(18,28,60,.55);
      color:#fff; font-weight:800; letter-spacing:.2px;
      cursor:pointer; white-space:nowrap;
    }
    .iconBtnWide:active{ transform: translateY(1px); }
    .iconBtnWide:disabled{ opacity:.6; cursor:not-allowed; transform:none; }
    .userPill{
      height:42px; display:flex; align-items:center;
      padding:0 12px; border-radius:14px;
      border:1px solid rgba(255,255,255,.12);
      background: rgba(0,0,0,.22);
      color: rgba(234,243,255,.9);
      font-weight:700; font-size:13px; white-space:nowrap;
    }
    @media (max-width: 420px){
      .loginWrap{ width:100%; justify-content:space-between; margin-left:0; }
      .iconBtnWide{ flex:1; }
      .userPill{ flex:1; justify-content:center; }
    }

    /* ✅ LOGIN GATE */
    .loginGate{
      position:fixed; inset:0; z-index:1000000;
      display:none; align-items:center; justify-content:center;
      padding:16px;
      background: radial-gradient(1100px 800px at 50% 15%, rgba(37,215,255,.18), rgba(0,0,0,.72));
      backdrop-filter: blur(10px);
    }
    .loginGate.show{ display:flex; }
    .loginGateCard{
      width:min(520px, 100%);
      border-radius:24px;
      border:1px solid rgba(37,215,255,.22);
      background: rgba(10,12,24,.92);
      box-shadow: 0 22px 80px rgba(0,0,0,.65);
      padding:18px;
      text-align:center;
      color: rgba(240,247,255,.95);
    }
    .loginGateTitle{
      font-size:22px;
      font-weight:950;
      letter-spacing:.3px;
    }
    .loginGateSub{
      margin-top:8px;
      font-size:13px;
      opacity:.82;
      line-height:1.35;
    }
    .loginGateBtn{
      margin-top:14px;
      width:100%;
      height:48px;
      border-radius:16px;
      border:1px solid rgba(37,215,255,.35);
      background: linear-gradient(180deg, rgba(37,215,255,.95), rgba(0,183,255,.85));
      color:#07111f;
      font-weight:950;
      cursor:pointer;
    }
    .loginGateBtn:active{ transform: translateY(1px); }
    .loginGateBtn:disabled{ opacity:.65; cursor:not-allowed; transform:none; }
    .loginGateError{
      margin-top:12px;
      font-size:12px;
      color: rgba(255,120,120,.95);
      min-height: 16px;
    }
    .loginGateNote{
      margin-top:10px;
      font-size:12px;
      opacity:.65;
    }

    /* SETTINGS */
    .settingsOverlay{
      position:fixed; inset:0; z-index:99999;
      display:none; align-items:center; justify-content:center;
      padding:16px;
      background: rgba(0,0,0,.45);
      backdrop-filter: blur(8px);
    }
    .settingsOverlay.show{ display:flex; }
    .settingsCard{
      width:min(520px, 100%);
      border-radius:22px;
      border:1px solid rgba(255,255,255,.12);
      background: rgba(10,14,30,.88);
      box-shadow: 0 18px 60px rgba(0,0,0,.55);
      padding:16px;
      color: rgba(240,247,255,.95);
    }
    .settingsHeader{
      display:flex; align-items:center; justify-content:space-between;
      margin-bottom:12px;
    }
    .settingsTitle{ font-size:18px; font-weight:900; letter-spacing:.3px; }
    .settingsClose{
      width:40px; height:40px; border-radius:14px;
      border:1px solid rgba(255,255,255,.14);
      background: rgba(255,255,255,.06);
      color:#fff; font-weight:900;
      cursor:pointer;
    }
    .settingsClose:active{ transform: translateY(1px); }
    .settingsRow{
      display:flex; align-items:center; justify-content:space-between;
      gap:12px;
      padding:12px 10px;
      border-radius:16px;
      background: rgba(255,255,255,.04);
      border:1px solid rgba(255,255,255,.08);
      margin-top:10px;
    }
    .settingsLeft{ display:flex; flex-direction:column; gap:3px; }
    .settingsLabel{ font-weight:900; font-size:14px; }
    .settingsSub{ opacity:.78; font-size:12px; line-height:1.25; }

    .toggle{ position:relative; width:52px; height:30px; display:inline-block; }
    .toggle input{ opacity:0; width:0; height:0; }
    .toggle .track{
      position:absolute; inset:0;
      background: rgba(255,255,255,.12);
      border:1px solid rgba(255,255,255,.14);
      border-radius:999px;
      transition: .15s ease;
    }
    .toggle .track::after{
      content:"";
      position:absolute;
      width:24px; height:24px;
      left:3px; top:2px;
      border-radius:50%;
      background: rgba(240,247,255,.95);
      box-shadow: 0 10px 18px rgba(0,0,0,.35);
      transition: .15s ease;
    }
    .toggle input:checked + .track{
      background: rgba(37,215,255,.25);
      border-color: rgba(37,215,255,.45);
    }
    .toggle input:checked + .track::after{
      transform: translateX(22px);
      background: #25d7ff;
    }

    .settingsFoot{ margin-top:12px; padding:8px 4px 0; }
    .settingsNote{ opacity:.7; font-size:12px; }

    /* WIN POPUP */
    .winOverlay{
      position:fixed; inset:0; z-index:99998;
      display:none;
      align-items:center; justify-content:center;
      padding:16px;
      background: rgba(0,0,0,.55);
      backdrop-filter: blur(10px);
    }
    .winOverlay.show{ display:flex; }
    .winCard{
      width:min(560px, 100%);
      border-radius:24px;
      border:1px solid rgba(37,215,255,.22);
      background: radial-gradient(900px 520px at 50% 10%, rgba(37,215,255,.18), rgba(10,12,24,.92));
      box-shadow: 0 22px 80px rgba(0,0,0,.65);
      padding:18px;
      position:relative;
      overflow:hidden;
    }
    .winSparkLayer{
      position:absolute; inset:-40px;
      background:
        radial-gradient(10px 10px at 10% 20%, rgba(255,255,255,.7), transparent 60%),
        radial-gradient(12px 12px at 80% 30%, rgba(37,215,255,.7), transparent 60%),
        radial-gradient(9px 9px at 35% 70%, rgba(255,204,51,.7), transparent 60%),
        radial-gradient(8px 8px at 65% 80%, rgba(255,255,255,.55), transparent 60%);
      opacity:.35;
      animation: sparks 1.6s linear infinite;
      pointer-events:none;
    }
    @keyframes sparks{
      0%{ transform: translateY(0); }
      100%{ transform: translateY(18px); }
    }
    .winHeader{ position:relative; z-index:2; display:flex; flex-direction:column; gap:6px; }
    .winBadge{
      align-self:flex-start;
      font-weight:950;
      font-size:12px;
      padding:6px 10px;
      border-radius:999px;
      background: linear-gradient(180deg, #ff4b3a, #d61e12);
      box-shadow: 0 12px 22px rgba(255,75,58,.25);
      border:1px solid rgba(255,255,255,.18);
    }
    .winTitle{ font-size:26px; font-weight:950; letter-spacing:.3px; }
    .winSub{ opacity:.82; font-size:13px; }

    .winMusic{
      position:relative; z-index:2;
      margin-top:14px;
      display:flex; align-items:center; gap:10px;
      padding:10px 12px;
      border-radius:18px;
      background: rgba(255,255,255,.06);
      border:1px solid rgba(255,255,255,.10);
    }
    .winPulse{
      width:34px; height:34px; border-radius:50%;
      background: rgba(37,215,255,.22);
      border:1px solid rgba(37,215,255,.35);
      animation: pulse 1.1s ease-in-out infinite;
    }
    @keyframes pulse{
      0%,100%{ transform: scale(1); opacity:.75; }
      50%{ transform: scale(1.08); opacity:1; }
    }
    .winNote{ font-weight:950; font-size:18px; }
    .winMusicText{ font-weight:900; opacity:.85; }

    .winRow{ position:relative; z-index:2; display:flex; gap:10px; margin-top:16px; flex-wrap:wrap; }
    .winBtnPrimary, .winBtnSecondary{
      height:46px;
      border-radius:16px;
      border:1px solid rgba(255,255,255,.14);
      font-weight:950;
      cursor:pointer;
      padding:0 14px;
    }
    .winBtnPrimary{
      flex:1;
      background: linear-gradient(180deg, rgba(37,215,255,.95), rgba(0,183,255,.85));
      color:#061020;
      border-color: rgba(37,215,255,.55);
    }
    .winBtnSecondary{
      flex:1;
      background: rgba(255,255,255,.06);
      color: rgba(240,247,255,.95);
    }
    .winBtnPrimary:active, .winBtnSecondary:active{ transform: translateY(1px); }
    .winPlus{ margin-left:6px; font-weight:950; color:#ffcc33; }
    .winCoinDot{
      display:inline-block;
      width:14px; height:14px;
      border-radius:50%;
      margin-left:8px;
      background: radial-gradient(circle at 30% 30%, #fff6c2, #ffcc33 55%, #d39a00);
      vertical-align:-2px;
      box-shadow: 0 8px 16px rgba(255,204,51,.18);
    }
    .winHint{ position:relative; z-index:2; margin-top:12px; font-size:12px; opacity:.75; }
  `;
  document.head.appendChild(extra);

  // ---------------------------
  // Elements
  // ---------------------------
  const coinCountEl = document.getElementById("coinCount");

  // Header login UI
  const loginBtn = document.getElementById("loginBtn");
  const loginBtnText = document.getElementById("loginBtnText");
  const userPill = document.getElementById("userPill");

  // Login gate
  const loginGate = document.getElementById("loginGate");
  const loginGateBtn = document.getElementById("loginGateBtn");
  const loginGateError = document.getElementById("loginGateError");

  // Settings
  const settingsBtn = document.getElementById("settingsBtn");
  const settingsOverlay = document.getElementById("settingsOverlay");
  const settingsCloseBtn = document.getElementById("settingsCloseBtn");
  const soundToggle = document.getElementById("soundToggle");
  const vibrationToggle = document.getElementById("vibrationToggle");

  // Win popup
  const winOverlay = document.getElementById("winOverlay");
  const winSubText = document.getElementById("winSubText");
  const winNextBtn = document.getElementById("winNextBtn");
  const winAdBtn = document.getElementById("winAdBtn");
  
  const welcomeOverlay = document.getElementById("welcomeOverlay");
  
  // Level select
  const levelSelectOverlay = document.getElementById("levelSelectOverlay");
  const levelGrid = document.getElementById("levelGrid");
  const levelSelectClose = document.getElementById("levelSelectClose");

  let levelSelectHandler = null;

  // ✅ FIXED (single correct implementation)
  function showLevelSelect({ totalLevels, isCompleted, currentLevel }) {
    if (!levelGrid || !levelSelectOverlay) return;

    levelGrid.innerHTML = "";

    for (let i = 1; i <= totalLevels; i++) {
      const btn = document.createElement("button");

      const completed =
        typeof isCompleted === "function"
          ? isCompleted(i)
          : false;

      const isCurrent = i === currentLevel;

      btn.className =
        "levelBtn" +
        (completed ? "" : " locked") +
        (isCurrent ? " current" : "");

      btn.textContent = completed ? `✔ Level ${i}` : `🔒 ${i}`;

      if (completed) {
        btn.addEventListener("click", () => {
          hideLevelSelect();
          levelSelectHandler?.(i - 1);
        });
      }

      levelGrid.appendChild(btn);
    }

    levelSelectOverlay.classList.add("show");
    levelSelectOverlay.setAttribute("aria-hidden", "false");
  }

  function hideLevelSelect() {
    levelSelectOverlay?.classList.remove("show");
    levelSelectOverlay?.setAttribute("aria-hidden", "true");
  }

  levelSelectClose?.addEventListener("click", hideLevelSelect);
  levelSelectOverlay?.addEventListener("click", (e) => {
    if (e.target === levelSelectOverlay) hideLevelSelect();
  });
function hideWelcome() {
  if (!welcomeOverlay) return;

  welcomeOverlay.style.display = "none";
  welcomeOverlay.setAttribute("aria-hidden", "true");
}


  // ---------------------------
  // State + handlers
  // ---------------------------
  let soundHandler = null;
  let vibrationHandler = null;

  let winNextHandler = null;
  let winAdHandler = null;

  // ✅ first user gesture (for WebAudio unlock on mobile)
  let firstGestureHandler = null;
  window.addEventListener(
    "pointerdown",
    () => {
      firstGestureHandler?.();
      firstGestureHandler = null;
    },
    { once: true }
  );

  // ✅ login gate click
  let loginGateClickHandler = null;
  loginGateBtn?.addEventListener("click", () => loginGateClickHandler?.());

  function setCoins(n) {
    if (coinCountEl) coinCountEl.textContent = String(n ?? 0);
  }

  // ---------------------------
  // Login Gate API
  // ---------------------------
  function showLoginGate() {
    if (!loginGate) return;
    loginGate.classList.add("show");
    loginGate.setAttribute("aria-hidden", "false");
    showLoginError(""); // clear
    setGateLoading(false);
  }

  function hideLoginGate() {
    if (!loginGate) return;
    loginGate.classList.remove("show");
    loginGate.setAttribute("aria-hidden", "true");
    showLoginError("");
    setGateLoading(false);
  }

  function showLoginError(msg) {
    if (!loginGateError) return;
    loginGateError.textContent = msg ? String(msg) : "";
  }

  function setGateLoading(isLoading) {
    if (!loginGateBtn) return;
    loginGateBtn.disabled = !!isLoading;
    loginGateBtn.textContent = isLoading ? "Logging in..." : "Login with Pi";
  }

  // ensurePiLogin calls this
  function onLoginClick(fn) {
    loginGateClickHandler = async () => {
      try {
        setGateLoading(true);
        await fn();
      } finally {
        setGateLoading(false);
      }
    };
  }

  // allow header button to trigger the same login flow
  loginBtn?.addEventListener("click", () => {
    showLoginGate();
    loginGateClickHandler?.();
  });

  function setUser(user) {
  const name = user?.username || "guest";

  // update text
  if (userPill) userPill.textContent = `User: ${name}`;
  if (loginBtnText) {
    loginBtnText.textContent =
      name === "guest" ? "Login with Pi" : "Logged in ✅";
  }

  // ✅ NEW: toggle buttons after login
  const testBtn = document.getElementById("testBtn");

  testBtn?.addEventListener("click", () => {
  hideWelcome();

  
});

  if (name !== "guest") {
    // logged in
    loginBtn?.style.setProperty("display", "none");
    userPill?.style.setProperty("display", "none");
    if (testBtn) testBtn.style.display = "inline-flex";
  } else {
    // logged out / guest
    loginBtn?.style.setProperty("display", "inline-flex");
    userPill?.style.setProperty("display", "inline-flex");
    if (testBtn) testBtn.style.display = "none";
  }
}

  // ---------------------------
  // Settings
  // ---------------------------
  function openSettings() {
    if (!settingsOverlay) return;
    settingsOverlay.classList.add("show");
    settingsOverlay.setAttribute("aria-hidden", "false");
  }

  function closeSettings() {
    if (!settingsOverlay) return;
    settingsOverlay.classList.remove("show");
    settingsOverlay.setAttribute("aria-hidden", "true");
  }

  settingsBtn?.addEventListener("click", openSettings);
  settingsCloseBtn?.addEventListener("click", closeSettings);
  settingsOverlay?.addEventListener("click", (e) => {
    if (e.target === settingsOverlay) closeSettings();
  });

  soundToggle?.addEventListener("change", () => {
    soundHandler?.(!!soundToggle.checked);
  });

  vibrationToggle?.addEventListener("change", () => {
    vibrationHandler?.(!!vibrationToggle.checked);
  });

  // ---------------------------
  // Win popup
  // ---------------------------
  winNextBtn?.addEventListener("click", () => winNextHandler?.());
  winAdBtn?.addEventListener("click", () => winAdHandler?.());

  function showWinPopup({ levelNumber, isLastLevel } = {}) {
    if (winSubText) {
      winSubText.textContent = isLastLevel
        ? `You finished the last level!`
        : `You finished Level ${levelNumber}`;
    }

    if (winNextBtn) winNextBtn.textContent = isLastLevel ? "Restart" : "Next level";

    if (winOverlay) {
      winOverlay.classList.add("show");
      winOverlay.setAttribute("aria-hidden", "false");
    }
  }

  function hideWinPopup() {
    if (!winOverlay) return;
    winOverlay.classList.remove("show");
    winOverlay.setAttribute("aria-hidden", "true");
  }

  function setSoundEnabled(v) {
    if (soundToggle) soundToggle.checked = !!v;
  }

  function setVibrationEnabled(v) {
    if (vibrationToggle) vibrationToggle.checked = !!v;
  }

  return {
    hideWelcome,
    onHint(fn) { hintHandler = fn; },
    onSkip(fn) { skipHandler = fn; },
    canvas: document.getElementById("game"),

    // header login UI
    loginBtn,
    loginBtnText,
    userPill,

    setCoins,

    // ✅ audio unlock hook
    onFirstUserGesture(fn) {
      firstGestureHandler = fn;
    },

    // ✅ login gate methods for ensurePiLogin()
    showLoginGate,
    hideLoginGate,
    showLoginError,
    onLoginClick,
    setUser,

    // Settings API
    setSoundEnabled,
    setVibrationEnabled,
    onSoundToggle(fn) {
      soundHandler = fn;
    },
    onVibrationToggle(fn) {
      vibrationHandler = fn;
    },

    // Win popup API (✅ kept only once)
    showWinPopup,
    hideWinPopup,
    onWinNext(fn) {
      winNextHandler = fn;
    },
    onWinAd(fn) {
      winAdHandler = fn;
    },

    // ✅ Level select API
    showLevelSelect,
    hideLevelSelect,
    onLevelSelect(fn) {
    levelSelectHandler = fn;
    },
  };
}

/* ---------------- UI helpers ---------------- */
function iconBtn(id, svg, badgeText) {
  return `
    <button class="iconBtn" id="${id}">
      ${badgeText ? `<div class="badgeNew">${badgeText}</div>` : ""}
      ${svg}
    </button>
  `;
}

/* --- SVG functions --- */

function userAccountSVG() {
  return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <!-- Head -->
    <path d="M9 8.5c0-1.9 1.6-3.5 3-3.5s3 1.6 3 3.5-1.6 3.3-3 3.3-3-1.4-3-3.3Z"
      stroke="rgba(234,243,255,.9)"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"/>

    <!-- Body -->
    <path d="M5.5 19c0-3.1 2.5-5.6 5.6-5.6h1.8c3.1 0 5.6 2.5 5.6 5.6"
      stroke="rgba(234,243,255,.75)"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"/>

    <!-- Accent (active user) -->
    <path d="M10 14.6h4"
      stroke="rgba(37,215,255,.95)"
      stroke-width="2.2"
      stroke-linecap="round"/>
  </svg>`;
}
function gearSVG() {
  return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z" stroke="rgba(234,243,255,.95)" stroke-width="1.8"/>
    <path d="M19 13.2v-2.4l-2.1-.5a7.5 7.5 0 0 0-.6-1.4l1.2-1.8-1.7-1.7-1.8 1.2c-.5-.25-1-.45-1.5-.6L12.8 3h-2.4l-.5 2.1c-.5.15-1 .35-1.4.6L6.7 4.5 5 6.2l1.2 1.8c-.25.45-.45.95-.6 1.45L3.5 10.8v2.4l2.1.5c.15.5.35 1 .6 1.4L5 16.9l1.7 1.7 1.8-1.2c.45.25.95.45 1.45.6l.5 2.1h2.4l.5-2.1c.5-.15 1-.35 1.4-.6l1.8 1.2 1.7-1.7-1.2-1.8c.25-.45.45-.95.6-1.45L19 13.2Z" stroke="rgba(234,243,255,.75)" stroke-width="1.6" stroke-linejoin="round"/>
  </svg>`;
}

function joystickSVG() {
return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <!-- Level 1 -->
    <path d="M4 18h16" stroke="rgba(234,243,255,.75)" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M4 18h6" stroke="rgba(37,215,255,.95)" stroke-width="2.2" stroke-linecap="round"/>

    <!-- Level 2 -->
    <path d="M6 13h12" stroke="rgba(234,243,255,.75)" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M6 13h5" stroke="rgba(37,215,255,.95)" stroke-width="2.2" stroke-linecap="round"/>

    <!-- Level 3 -->
    <path d="M8 8h8" stroke="rgba(234,243,255,.75)" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M8 8h4" stroke="rgba(37,215,255,.95)" stroke-width="2.2" stroke-linecap="round"/>
  </svg>`;

}



