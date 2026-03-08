// src/settings.js
// Simple persistent settings (localStorage)

const KEY = "maze_settings_v1";

const DEFAULTS = {
  sound: true,
  vibration: true,
};

let cache = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(next) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {}

  listeners.forEach((fn) => {
    try {
      fn({ ...cache });
    } catch {}
  });
}

export function getSettings() {
  return { ...cache };
}

export function setSetting(key, value) {
  const next = { ...cache, [key]: !!value };
  save(next);
}

export function subscribeSettings(fn) {
  listeners.add(fn);
  // emit current immediately
  try {
    fn(getSettings());
  } catch {}
  return () => listeners.delete(fn);
}