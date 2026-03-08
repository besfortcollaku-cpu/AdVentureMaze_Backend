// src/settings.js

let settings = {
  sound: localStorage.getItem("sound") !== "off",
  vibration: localStorage.getItem("vibration") !== "off",
  gyro: localStorage.getItem("gyro") === "on",
};

const listeners = new Set();

export function getSettings() {
  return settings;
}

export function setSettings(patch) {
  settings = { ...settings, ...patch };

  // persist
  if ("sound" in patch)
    localStorage.setItem("sound", patch.sound ? "on" : "off");
  if ("vibration" in patch)
    localStorage.setItem("vibration", patch.vibration ? "on" : "off");
  if ("gyro" in patch)
    localStorage.setItem("gyro", patch.gyro ? "on" : "off");

  // notify listeners
  listeners.forEach((fn) => fn(settings));
}

export function onSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}