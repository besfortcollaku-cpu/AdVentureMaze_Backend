// src/ui/ui.js

let loginGateHandler = null;
let welcomeContinueHandler = null;
let firstGestureHandler = null;

export function mountUI(app) {
  app.innerHTML = `
    <div class="phone">
      <div id="bootOverlay" class="bootOverlay">
        <div class="spinner"></div>
        <div id="bootText">Tap to continue</div>
      </div>

      <div class="topbar">
        <div class="title">Adventure Maze</div>
        <div class="coins"><span id="coinCount">0</span></div>
      </div>

      <canvas id="gameCanvas"></canvas>

      <div id="welcomeScreen" class="welcomeScreen hidden">
        <h1>Welcome</h1>
        <p>Guide the ball through the maze.<br/>Tap anywhere to start</p>
      </div>

      <div id="winPopup" class="winPopup hidden">
        <button id="winNextBtn">Next</button>
      </div>
    </div>
  `;

  const canvas = document.getElementById("gameCanvas");
  const bootOverlay = document.getElementById("bootOverlay");
  const bootText = document.getElementById("bootText");
  const welcomeScreen = document.getElementById("welcomeScreen");
  const winPopup = document.getElementById("winPopup");

  // 🔴 TAP TO LOGIN
  bootOverlay.addEventListener("click", () => {
    if (firstGestureHandler) firstGestureHandler();
    if (loginGateHandler) loginGateHandler();
  });

  // 🔴 TAP TO START GAME
  welcomeScreen.addEventListener("click", () => {
    if (welcomeContinueHandler) welcomeContinueHandler();
  });

  return {
    canvas,

    showBootOverlay(text = "Tap to continue") {
      bootText.textContent = text;
      bootOverlay.classList.remove("hidden");
    },

    hideBootOverlay() {
      bootOverlay.classList.add("hidden");
    },

    showWelcomeScreen() {
      welcomeScreen.classList.remove("hidden");
    },

    hideWelcomeScreen() {
      welcomeScreen.classList.add("hidden");
    },

    setCoins(v) {
      document.getElementById("coinCount").textContent = v;
    },

    showWinPopup() {
      winPopup.classList.remove("hidden");
    },

    hideWinPopup() {
      winPopup.classList.add("hidden");
    },

    onLoginGateClick(fn) {
      loginGateHandler = fn;
    },

    onWelcomeContinue(fn) {
      welcomeContinueHandler = fn;
    },

    onFirstUserGesture(fn) {
      firstGestureHandler = fn;
    },

    onWinNext(fn) {
      document.getElementById("winNextBtn").onclick = fn;
    },

    setSoundEnabled() {},
    setVibrationEnabled() {},
    setUser() {},
  };
}