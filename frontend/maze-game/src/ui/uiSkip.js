import "../css/skip.css";
export function createSkipPopup() {
  const el = document.createElement("div");
  el.className = "popup hidden";
  el.innerHTML = `
    <div class="popup-card">
      <h3>Skip Level</h3>
      <button id="freeSkipBtn">Free Skip</button>
      <button id="buySkipBtn">Buy Skip</button>
      <button id="watchAdSkipBtn">Watch Ad</button>
      <button id="closeSkipBtn">Close</button>
    </div>
  `;
  document.body.appendChild(el);

  const api = {
    show({ freeLeft } = {}) {
      el.classList.remove("hidden");
    },
    hide() {
      el.classList.add("hidden");
    },

    // 🔥 CRITICAL FIX
    open(opts) {
      this.show(opts);
    },

    onFreeSkip(cb) {
      el.querySelector("#freeSkipBtn").onclick = cb;
    },
    onBuySkip(cb) {
      el.querySelector("#buySkipBtn").onclick = cb;
    },
    onWatchAdSkip(cb) {
      el.querySelector("#watchAdSkipBtn").onclick = cb;
    },
  };

  el.querySelector("#closeSkipBtn").onclick = () => api.hide();

  return api;
}