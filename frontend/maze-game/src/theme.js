let theme = localStorage.getItem("theme") || "ice";

const listeners = new Set();
function applyBodyThemeClass(value) {
  document.body.classList.remove(
    "theme-ice",
    "theme-forest",
    "theme-lava"
  );

  document.body.classList.add(`theme-${value}`);
}

export function getTheme() {
  return theme;
}

export function setTheme(nextTheme) {
  if (theme === nextTheme) return;

  theme = nextTheme;
  localStorage.setItem("theme", theme);

  applyBodyThemeClass(theme);

  listeners.forEach((fn) => fn(theme));
}

export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

applyBodyThemeClass(theme);