// src/ui/uiGameShell.js
// Game Shell ONLY: phone frame, top bar, canvas, bottom controls

export function mountGameShell(root) {
  // ---------------------------
  // HTML
  // ---------------------------
  root.innerHTML = `
    <div class="phone gameShell">
      <div class="topbar">
        <div class="topRow">
          <div class="brand">
            <div class="logoBox" title="Adventure Maze">
              <img src="/logo.png" alt="Adventure Maze Logo" />
            </div>
          </div>

          <div class="levelWrap">
            <div class="levelText" id="levelText">Level</div>
          </div>

          <div class="coins" title="Coins">
            <div class="coinDot"></div>
            <div id="coinCount">0</div>
          </div>
        </div>

        <div class="iconRow">
          <button id="settingsBtn" class="iconBtn" aria-label="Settings">
            ⚙️
          </button>
          <button id="controls" class="iconBtn" aria-label="Levels">
            🎮
          </button>
        </div>
      </div>

      <div class="boardWrap">
        <canvas id="game"></canvas>
      </div>

      <div class="bottomBar">
        <button id="hintBtn" class="actionBtn">
          Hint
        </button>

        <button id="skipBtn" class="actionBtn">
          Skip
        </button>
      </div>
    </div>
  `;

  // ---------------------------
  // DOM refs
  // ---------------------------
  const canvas = root.querySelector("#game");
  const coinCountEl = root.querySelector("#coinCount");
  const levelTextEl = root.querySelector("#levelText");

  // ---------------------------
  // Public API
  // ---------------------------
  function setCoins(value) {
    if (coinCountEl) coinCountEl.textContent = String(value);
  }

  function setLevelText(text) {
    if (levelTextEl) levelTextEl.textContent = text;
  }

  return {
    // elements
    canvas,

    // UI setters
    setCoins,
    setLevelText,

    // raw buttons (logic wired in main.js)
    hintBtn: root.querySelector("#hintBtn"),
    skipBtn: root.querySelector("#skipBtn"),
    settingsBtn: root.querySelector("#settingsBtn"),
    controlsBtn: root.querySelector("#controls"),
  };
}