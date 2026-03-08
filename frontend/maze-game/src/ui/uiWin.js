// src/ui/uiWin.js
// Level Complete / Win popup UI
import "../css/win.css";
import { getTheme } from "../theme.js";
export function createWinPopup() {
  let onNext = null;
  let onWatchAd = null;

  // ---------------------------
  // HTML
  // ---------------------------
  const el = document.createElement("div");
  el.className = "overlay winOverlay hidden";

  el.innerHTML = `
    <div class="modal winModal">
      <div id="congratsBadge" class="badge">
  CONGRATS!
</div>
      <h2 class="title">Level Complete</h2>
      <div class="subtitle" id="winLevelText">You finished Level</div>


<div class="winCard">
      <button class="btn primary btnNext" id="nextLevelBtn">
        Next level
      </button>
</div>

      <button class="btn secondary" id="watchAdBtn">
        Watch Ad <span class="reward">+50</span> 🪙
      </button>

      <div class="tip">
        Tip: Watch ad gives +50 coins
      </div>
        </div>
    </div>
  `;

  document.body.appendChild(el);

  // ---------------------------
  // Elements
  // ---------------------------
  const levelText = el.querySelector("#winLevelText");
  const nextBtn = el.querySelector("#nextLevelBtn");
  const adBtn = el.querySelector("#watchAdBtn");

  // ---------------------------
  // Events
  // ---------------------------
  nextBtn.addEventListener("click", () => {
    hide();
    onNext?.();
  });

  adBtn.addEventListener("click", () => {
    onWatchAd?.();
  });

  // ---------------------------
  // API
  // ---------------------------
  function show({ levelNumber }) {
  const theme = getTheme();

  // reset theme classes
  el.classList.remove("theme-forest", "theme-lava", "theme-ice");

  // apply current theme
  el.classList.add(`theme-${theme}`);

  levelText.textContent = `You finished Level ${levelNumber}`;
  el.classList.remove("hidden");
}

  function hide() {
    el.classList.add("hidden");
  }

  function onNextLevel(cb) {
    onNext = cb;
  }

  function onWatchAdClick(cb) {
    onWatchAd = cb;
  }

  return {
    show,
    hide,
    onNextLevel,
    onWatchAdClick,
  };
}