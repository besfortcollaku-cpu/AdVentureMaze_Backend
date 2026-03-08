// src/ui/uiSkipPopup.js
// Skip level popup UI (free / coins / ad)

export function createSkipPopup() {
  let onFree = null;
  let onBuy = null;
  let onWatchAd = null;

  // ---------------------------
  // HTML
  // ---------------------------
  const el = document.createElement("div");
  el.className = "overlay skipOverlay hidden";

  el.innerHTML = `
    <div class="modal skipModal">
      <h2 class="title">Skip Level?</h2>
      <div class="subtitle">Choose how you want to skip</div>

      <button class="btn primary" id="skipFreeBtn">
        Free Skip <span class="count">(x3)</span>
      </button>

      <button class="btn secondary" id="skipBuyBtn">
        Skip Level <span class="cost">-50 🪙</span>
      </button>

      <button class="btn ghost" id="skipAdBtn">
        Watch Ad (Free)
      </button>

      <button class="btn closeBtn" id="skipCloseBtn">
        Cancel
      </button>
    </div>
  `;

  document.body.appendChild(el);

  // ---------------------------
  // Elements
  // ---------------------------
  const freeBtn = el.querySelector("#skipFreeBtn");
  const buyBtn = el.querySelector("#skipBuyBtn");
  const adBtn = el.querySelector("#skipAdBtn");
  const closeBtn = el.querySelector("#skipCloseBtn");
  const freeCountEl = el.querySelector(".count");

  // ---------------------------
  // Events
  // ---------------------------
  freeBtn.addEventListener("click", () => {
    hide();
    onFree?.();
  });

  buyBtn.addEventListener("click", () => {
    hide();
    onBuy?.();
  });

  adBtn.addEventListener("click", () => {
    hide();
    onWatchAd?.();
  });

  closeBtn.addEventListener("click", hide);

  // ---------------------------
  // API
  // ---------------------------
  function show({ freeLeft = 0 }) {
    freeCountEl.textContent = `(x${freeLeft})`;
    freeBtn.disabled = freeLeft <= 0;
    el.classList.remove("hidden");
  }

  function hide() {
    el.classList.add("hidden");
  }

  function onFreeSkip(cb) {
    onFree = cb;
  }

  function onBuySkip(cb) {
    onBuy = cb;
  }

  function onWatchAdSkip(cb) {
    onWatchAd = cb;
  }

  return {
    show,
    hide,
    onFreeSkip,
    onBuySkip,
    onWatchAdSkip,
  };
}