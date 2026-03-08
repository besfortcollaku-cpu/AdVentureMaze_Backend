// src/ui/uiLogin.js
export function createLoginUI(root) {
  root.insertAdjacentHTML(
    "beforeend",
    `
    <div id="loginOverlay" class="overlay active">
      <div class="spinner"></div>
      <div class="loginText">Tap to continue</div>
      <div class="login-spinner hidden" id="loginSpinner"></div>
    </div>
    `
  );

  const overlay = document.getElementById("loginOverlay");
  const textEl = overlay.querySelector(".loginText");
  const spinner = document.getElementById("loginSpinner");
  
  function showSpinner() {
  spinner?.classList.remove("hidden");
}

function hideSpinner() {
  spinner?.classList.add("hidden");
}

  let loginHandler = null;

  overlay.addEventListener("pointerdown", () => {
    loginHandler?.();
  });

  return {
    show(text = "Tap to continue") {
      textEl.textContent = text;
      overlay.classList.add("active");
    },

    hide() {
      overlay.classList.remove("active");
    },
    

    setText(text) {
      textEl.textContent = text;
    },
    showSpinner,
    hideSpinner,

    onLogin(fn) {
      loginHandler = fn;
    },
  };
}