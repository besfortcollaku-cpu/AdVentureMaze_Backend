// src/ui/uiLogin.js


let isLoggingIn = false;
let isDone = false; // 🔒 permanent lock after success
export function createLoginUI(root) {
  root.insertAdjacentHTML(
    "beforeend",
    `
    <div id="loginOverlay" class="overlay active">
      <div class="loginText">Tap to continue</div>
      <div class="login-spinner hidden" id="loginSpinner"></div>
    </div>
    `
  );

  const overlay = document.getElementById("loginOverlay");
  const textEl = overlay.querySelector(".loginText");
  const spinner = document.getElementById("loginSpinner");

  let loginHandler = null;
   

  function showSpinner() {
    spinner?.classList.remove("hidden");
  }

  function hideSpinner() {
  spinner?.classList.add("hidden");
}

  overlay.addEventListener("pointerdown", () => {
  if (isDone || isLoggingIn) return;
  isLoggingIn = true;
  loginHandler?.();
});
  return {
    show(text = "Tap to continue") {
      textEl.textContent = text;
      overlay.classList.add("active");
    },

    hide() {
  isDone = true;
  overlay.remove(); // 🔥 HARD REMOVE — nothing left to update
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