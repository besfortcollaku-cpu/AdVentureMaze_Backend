import "../css/hints.css";

export function createHintPopup() {
  const el = document.createElement("div");
  el.className = "popup hidden";
  el.innerHTML = `
    <div class="popup-card">
      <h3>Hint</h3>
      <button id="freeHintBtn">Free Hint</button>
      <button id="buyHintBtn">Buy Hint</button>
      <button id="watchAdHintBtn">Watch Ad</button>
      <button id="closeHintBtn">Close</button>
    </div>
  `;
  document.body.appendChild(el);

  const api = {
    show({ coins = 0, freeLeft = 0 } = {}) {
  el.classList.remove("hidden");

  const freeBtn = el.querySelector("#freeHintBtn");
  const buyBtn = el.querySelector("#buyHintBtn");
  const adBtn = el.querySelector("#watchAdHintBtn");

  // Free hint button
  if (freeBtn) {
    if (freeLeft > 0) {
      freeBtn.disabled = false;
      freeBtn.textContent = `Free Hint (${freeLeft} left)`;
    } else {
      freeBtn.disabled = true;
      freeBtn.textContent = "No free hints";
    }
  }

  // Buy hint (50 coins)
  if (buyBtn) {
    if (coins < 50) {
      buyBtn.disabled = true;
      buyBtn.textContent = "Not enough coins";
    } else {
      buyBtn.disabled = false;
      buyBtn.textContent = "Hint (50 coins)";
    }
  }

  // Watch ad is always available (frontend decides)
  if (adBtn) {
    adBtn.disabled = false;
    adBtn.textContent = "Watch Ad";
  }
},
    hide() {
      el.classList.add("hidden");
    },

    // 🔥 CRITICAL FIX
    open(opts) {
      this.show(opts);
    },

    onFreeHint(cb) {
      el.querySelector("#freeHintBtn").onclick = cb;
    },
    onBuyHint(cb) {
      el.querySelector("#buyHintBtn").onclick = cb;
    },
    onWatchAdHint(cb) {
      el.querySelector("#watchAdHintBtn").onclick = cb;
    },
  };

  el.querySelector("#closeHintBtn").onclick = () => api.hide();

  return api;
}