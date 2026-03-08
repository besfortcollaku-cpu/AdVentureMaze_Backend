// uiLevels.js
import "../css/levels.css";

export function mountLevelsUI(root, { totalLevels } = {}) {
  // ----- DOM -----
  const overlay = document.createElement("div");
  overlay.id = "levelsOverlay";
  overlay.className = "levelsOverlay";

  overlay.innerHTML = `
    <div class="levelsCard">
      <div class="levelsHeader">
        <span class="badge">LEVELS</span>
        <h2>Select Level</h2>
      </div>

      <div class="levelsGrid" id="levelsGrid"></div>

      <button class="closeBtn" id="levelsClose">Close</button>
    </div>
  `;

  root.appendChild(overlay);

  const grid = overlay.querySelector("#levelsGrid");
  // ----- TOUCH DRAG SCROLL -----
let startY = 0;
let startScroll = 0;

overlay.addEventListener("touchstart", (e) => {
  startY = e.touches[0].clientY;
  startScroll = grid.scrollTop;
}, { passive: true });

overlay.addEventListener("touchmove", (e) => {
  const currentY = e.touches[0].clientY;
  const delta = startY - currentY;

  grid.scrollTop = startScroll + delta;
}, { passive: true });
  const closeBtn = overlay.querySelector("#levelsClose");

  // ----- STATE -----
  // ----- STATE -----
  let maxUnlocked = 1;
  let selectHandler = null;

  const TOTAL_LEVELS = Number(totalLevels || 0) || 20;

  // ----- BUILD GRID ONCE -----
  const levelButtons = [];

  for (let i = 1; i <= TOTAL_LEVELS; i++) {
    const btn = document.createElement("button");
    btn.className = "levelBtn";
    btn.dataset.level = i;

    btn.innerHTML = `
      <span class="icon"></span>
      <span class="label">${i}</span>
    `;

    btn.addEventListener("click", () => {
      if (btn.classList.contains("locked")) {
        // If guest taps a locked level above the guest limit, show login-required.
        const maze = window.__maze;
        const guestMax = Number(maze?.guestMaxLevel || 0);
        const isLoggedIn = maze?.isLoggedIn?.() === true;
        if (!isLoggedIn && guestMax > 0 && i > guestMax) {
          maze?.showLoginRequired?.();
        }
        return;
      }
      selectHandler?.(i);
      close();
    });

    grid.appendChild(btn);
    levelButtons.push(btn);
  }

  // ----- RENDER STATES -----
  function render() {
    levelButtons.forEach((btn) => {
      const level = Number(btn.dataset.level);
      btn.classList.remove("locked", "completed", "unlocked");

      const icon = btn.querySelector(".icon");

      if (level < maxUnlocked) {
        btn.classList.add("completed");
        icon.innerHTML = btn.classList.contains("locked") ? "🔒" : "✔";
      } else if (level === maxUnlocked) {
        btn.classList.add("unlocked");
        icon.textContent = "";
      } else {
        btn.classList.add("locked");
      }
    });
  }

  // ----- OPEN / CLOSE -----
  function open() {
    document.body.classList.add("overlay-open");
    overlay.style.display = "flex";
  }

  function close() {
    document.body.classList.remove("overlay-open");
    overlay.style.display = "none";
  }

  closeBtn.addEventListener("click", close);

  // ----- PUBLIC API -----
  return {
    open,
    close,

    setUnlocked(level) {
      maxUnlocked = Math.max(1, level || 1);
      render();
    },

    onSelect(cb) {
      selectHandler = cb;
    },
  };
}