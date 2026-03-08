// src/ui/uiSettings.js
// Settings popup UI (Sound / Vibration)

export function createSettingsUI() {
  let onSoundChange = null;
  let onVibrationChange = null;

  // ---------------------------
  // HTML
  // ---------------------------
  const el = document.createElement("div");
  el.className = "overlay settingsOverlay hidden";

  el.innerHTML = `
    <div class="modal settingsModal">
      <div class="settingsHeader">
        <h2>Settings</h2>
        <button class="closeBtn">✕</button>
      </div>

      <div class="settingItem">
        <div>
          <div class="title">Sound</div>
          <div class="desc">Rolling + victory (no wall-hit sound)</div>
        </div>
        <label class="switch">
          <input type="checkbox" id="soundToggle">
          <span class="slider"></span>
        </label>
      </div>

      <div class="settingItem">
        <div>
          <div class="title">Vibration</div>
          <div class="desc">Small vibration when ball stops</div>
        </div>
        <label class="switch">
          <input type="checkbox" id="vibrationToggle">
          <span class="slider"></span>
        </label>
      </div>

      <div class="settingsFooter">
        Changes are saved automatically.
      </div>
    </div>
  `;

  document.body.appendChild(el);

  // ---------------------------
  // Elements
  // ---------------------------
  const closeBtn = el.querySelector(".closeBtn");
  const soundToggle = el.querySelector("#soundToggle");
  const vibrationToggle = el.querySelector("#vibrationToggle");

  // ---------------------------
  // Events
  // ---------------------------
  closeBtn.addEventListener("click", hide);

  soundToggle.addEventListener("change", () => {
    onSoundChange?.(soundToggle.checked);
  });

  vibrationToggle.addEventListener("change", () => {
    onVibrationChange?.(vibrationToggle.checked);
  });

  // ---------------------------
  // API
  // ---------------------------
  function show() {
    el.classList.remove("hidden");
  }

  function hide() {
    el.classList.add("hidden");
  }

  function setSoundEnabled(val) {
    soundToggle.checked = !!val;
  }

  function setVibrationEnabled(val) {
    vibrationToggle.checked = !!val;
  }

  function onSoundToggle(cb) {
    onSoundChange = cb;
  }

  function onVibrationToggle(cb) {
    onVibrationChange = cb;
  }

  return {
    show,
    hide,
    setSoundEnabled,
    setVibrationEnabled,
    onSoundToggle,
    onVibrationToggle,
  };
}
