
import "../css/settings.css";
import { getSettings, setSetting, subscribeSettings } from "../settings.js";




export function mountSettingsUI(root) {
  const el = document.createElement("div");
  el.id = "settingsOverlay";
  el.className = "settings-overlay hidden";

  el.innerHTML = `
<div class="settings-backdrop"></div>
    <div class="settings-card">
      <div class="settings-header">
        <h2>Settings</h2>
        <button class="close-btn">✕</button>
      </div>

      <div class="settings-item">
        <div>
          <strong>Sound</strong>
          <div class="desc">Rolling + victory (no wall-hit sound)</div>
        </div>
        <label class="switch">
          <input type="checkbox" id="soundToggle">
          <span class="slider"></span>
        </label>
      </div>

      <div class="settings-item">
        <div>
          <strong>Vibration</strong>
          <div class="desc">Small vibration when ball stops</div>
        </div>
        <label class="switch">
          <input type="checkbox" id="vibrationToggle">
          <span class="slider"></span>
        </label>
      </div>
      <div class="settings-item">
  <div>
    <strong>Gyroscope</strong>
    <div class="desc">Tilt phone to move ball</div>
  </div>
  <label class="switch">
    <input type="checkbox" id="gyroToggle">
    <span class="slider"></span>
  </label>
</div>

      <!-- FUTURE -->
      <div class="settings-item disabled">
        <div>
          <strong>Background music</strong>
          <div class="desc">Coming soon</div>
        </div>
        <label class="switch">
          <input type="checkbox" disabled>
          <span class="slider"></span>
        </label>
      </div>

      <p class="settings-hint">Changes are saved automatically.</p>
    </div>
  `;

  root.appendChild(el);
const gyroToggle = el.querySelector("#gyroToggle");
  const soundToggle = el.querySelector("#soundToggle");
  const vibrationToggle = el.querySelector("#vibrationToggle");

  // ---- LOAD SAVED SETTINGS ----
  gyroToggle.checked = localStorage.getItem("gyro") === "on";
  // ---- SAVE ON CHANGE ----
  gyroToggle.addEventListener("change", () => {
  localStorage.setItem("gyro", gyroToggle.checked ? "on" : "off");
});
  

// ---- LOAD (from src/settings.js) ----
const s0 = getSettings();
soundToggle.checked = !!s0.sound;
vibrationToggle.checked = !!s0.vibration;

// keep UI in sync if settings change elsewhere
subscribeSettings((s) => {
  soundToggle.checked = !!s.sound;
  vibrationToggle.checked = !!s.vibration;
});

// ---- SAVE ON CHANGE (to src/settings.js) ----
soundToggle.addEventListener("change", async () => {
  const checked = soundToggle.checked;

  // store
  setSetting("sound", checked);

  // 🔑 IMPORTANT: only try unlock when turning sound ON
  if (checked) {
    await ensureAudioUnlocked();
  }
});

vibrationToggle.addEventListener("change", () => {
  setSetting("vibration", vibrationToggle.checked);
});


  // ---- OPEN / CLOSE ----
  el.querySelector(".close-btn").onclick = close;
  el.querySelector(".settings-backdrop").onclick = close;

  function open() {
    el.classList.remove("hidden");
    document.body.classList.add("modal-open");
  }

  function close() {
    el.classList.add("hidden");
    document.body.classList.remove("modal-open");
  }

  return { open, close };
}