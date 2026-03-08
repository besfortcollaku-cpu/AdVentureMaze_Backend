// src/game/engine.js
import { render } from "./render.js";
import { updateMovement } from "./movement.js";

let running = false;

export function startEngine(state, ctx) {
  if (running) return; // prevent double loops
  running = true;

  function loop(now) {
    // update movement/animation state
    updateMovement(state, now);

    // draw everything
    render(state, ctx, now);

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}

export function stopEngine() {
  // simple stop flag (optional)
  running = false;
}