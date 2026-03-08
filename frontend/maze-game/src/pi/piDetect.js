// src/pi/piDetect.js



function hasDevOverride() {

  const params = new URLSearchParams(window.location.search);

  return params.get("dev") === "true";

}



// src/pi/piDetect.js

// ✅ reliable detection: Pi injects window.Pi.authenticate()
function isPiBrowser() {
  try {
    return !!(window.Pi && typeof window.Pi.authenticate === "function");
  } catch {
    return false;
  }
}

// allow ?dev=true to bypass
export async function enforcePiEnvironment({ desktopBlockEl } = {}) {
  const params = new URLSearchParams(window.location.search);
  const dev = params.get("dev") === "true";

  // Pi sometimes injects window.Pi slightly after load → retry up to ~2s
  let ok = dev || isPiBrowser();

  if (!ok) {
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 100));
      if (isPiBrowser()) {
        ok = true;
        break;
      }
    }
  }

  if (desktopBlockEl) {
    if (ok) {
      desktopBlockEl.classList.remove("show");
      desktopBlockEl.style.display = "none";
    } else {
      desktopBlockEl.classList.add("show");
      desktopBlockEl.style.display = "block";
    }
  }

  return { ok, reason: ok ? "ok" : "not_pi_browser" };
}



function hardBlockInputs() {

  const stop = (e) => {

    e.preventDefault();

    e.stopPropagation();

    e.stopImmediatePropagation?.();

    return false;

  };



  // Block pointer/touch/mouse

  const pointerEvents = [

    "pointerdown", "pointermove", "pointerup",

    "mousedown", "mousemove", "mouseup",

    "touchstart", "touchmove", "touchend",

    "click", "dblclick", "contextmenu",

    "wheel",

  ];



  // Capture phase so we stop events BEFORE app gets them

  pointerEvents.forEach((ev) =>

    window.addEventListener(ev, stop, { capture: true, passive: false })

  );



  // Block keyboard

  window.addEventListener("keydown", stop, true);

  window.addEventListener("keyup", stop, true);



  // Stop scrolling

  document.documentElement.style.overflow = "hidden";

  document.body.style.overflow = "hidden";

}




