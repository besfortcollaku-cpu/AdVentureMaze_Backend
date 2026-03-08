// uiHints.js
import "../css/hints.css";

export function mountHintsUI(root) {
  const el = document.createElement("div");
  el.id = "hintsOverlay";
  el.className = "hintsOverlay hidden";

  el.innerHTML = `
    <div class="hintsCard">
      <h2>Hints</h2>

      <button class="hintOption" id="freeHintBtn">
        ❓ Free Hint <span class="count" id="freeHintCount">x3</span>
      </button>

      <button class="hintOption">
        🪙 Get 1 Hint – 50 coins
      </button>

      <button class="hintOption">
        📺 Watch ad – Get 1 Hint
      </button>

      <button class="closeBtn" id="closeHintsBtn">Close</button>
    </div>
  `;

  root.appendChild(el);

  const freeHintCountEl = el.querySelector("#freeHintCount");
  const freeHintBtn = el.querySelector("#freeHintBtn");
  const closeBtn = el.querySelector("#closeHintsBtn");

  let freeHints = 3;

  function sync() {
    freeHintCountEl.textContent = `x${freeHints}`;
    freeHintBtn.disabled = freeHints <= 0;
    freeHintBtn.classList.toggle("disabled", freeHints <= 0);
  }

  closeBtn.addEventListener("click", () => {
    el.classList.add("hidden");
  });

  sync();

  return {
    open() {
      el.classList.remove("hidden");
    },
    close() {
      el.classList.add("hidden");
    },
    setFreeHints(n) {
      freeHints = n ?? 0;
      sync();
    },
    useFreeHint() {
      if (freeHints > 0) {
        freeHints--;
        sync();
        return true;
      }
      return false;
    },
    getFreeHints() {
      return freeHints;
    },
  };
}