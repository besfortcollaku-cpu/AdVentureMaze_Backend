// src/ui/uiWelcome.js
import "../css/welcome.css";

export function mountWelcomeUI(root, user) {
  root.insertAdjacentHTML(
    "beforeend",
    `
    <div id="welcomeOverlay" class="overlay welcome-overlay">
      <div class="welcome-content">
        <h1 class="welcome-title"></h1>
        <p class="welcome-subtitle">
          Solve mazes, earn coins, convert to Pi.
        </p>
        <p class="welcome-cta">Tap anywhere to start</p>
      </div>
    </div>
    `
  );

  const overlay = document.getElementById("welcomeOverlay");
  const titleEl = overlay.querySelector(".welcome-title");

  let startHandler = null;
  let isHidden = false;

  // ✅ Personalize welcome text
  const username = user?.username || "Player";
  titleEl.textContent =
    user?.isNew === true
      ? `Welcome, ${username}!`
      : `Welcome back, ${username}!`;

  function show() {
    overlay.classList.add("active");
    overlay.style.pointerEvents = "auto";
    isHidden = false;
  }

  function hide() {
    if (isHidden) return;
    isHidden = true;

    overlay.classList.remove("active");
    overlay.classList.add("fade-out");

    // 🔥 fully disable after animation
    setTimeout(() => {
      overlay.style.pointerEvents = "none";
      overlay.remove();
    }, 300);
  }

  // ✅ Tap anywhere
  overlay.addEventListener("pointerdown", () => {
    hide();
    startHandler?.();
  });

  return {
    show,
    hide,

    onStart(fn) {
      startHandler = fn;
    },
  };
}
