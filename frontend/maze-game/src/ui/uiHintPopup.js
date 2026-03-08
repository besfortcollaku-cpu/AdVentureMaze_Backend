// src/ui/uiHintPopup.js
// Hint popup UI (free / coins / ad)

export function createHintPopup() {
  let onFree = null;
  let onBuy = null;
  let onWatchAd = null;

  // ---------------------------
  // HTML
  // ---------------------------
  const el = document.createElement("div");
  el.className = "overlay hintOverlay hidden";

  el.innerHTML = `
    <div class="modal hintModal">
      <h2 class="title">Need a Hint?</h2>
      <div class="subtitle">Choose how you want to unlock it</div>

      <button class="btn primary" id="hintFreeBtn">
        Free Hint <span class="count">(x3)</span>
      </button>

      <button class="btn secondary" id="hintBuyBtn">
        Buy Hint <span class="cost">-50 🪙</span>
      </button>

      <button class="btn ghost" id="hintAdBtn">
        Watch Ad (Free)
      </button>

      <button class="btn closeBtn" id="hintCloseBtn">
        Cancel
      </button>
    </div>
  `;

  document.body.appendChild(el);

  // ---------------------------
  // Elements
  // ---------------------------
  const freeBtn = el.querySelector("#hintFreeBtn");
  const buyBtn = el.querySelector("#hintBuyBtn");
  const adBtn = el.querySelector("#hintAdBtn");
  const closeBtn = el.querySelector("#hintCloseBtn");
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

  function onFreeHint(cb) {
    onFree = cb;
  }

  function onBuyHint(cb) {
    onBuy = cb;
  }

  function onWatchAdHint(cb) {
    onWatchAd = cb;
  }

  return {
    show,
    hide,
    onFreeHint,
    onBuyHint,
    onWatchAdHint,
  };
}