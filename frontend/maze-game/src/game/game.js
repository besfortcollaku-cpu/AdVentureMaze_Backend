// src/game/game.js Last change
import { createGameState } from "./state.js";
import { createMovement } from "./movement.js";
import { createRenderer } from "./render.js";

export function createGame({ canvas, level, onLevelComplete, onTilePainted }) {
  let state = createGameState(level);
  let renderer = createRenderer({ canvas, state });

  let completed = false;

  let movement = createMovement({
    state,
    onTilePainted,
    onMoveFinished: () => {
      if (!completed && state.isComplete()) {
        completed = true;
        onLevelComplete?.({ level: state.level, state });
      }
    },
  });

  function requestMove(dx, dy) {
    if (completed) return;
    movement.startMove(dx, dy);
  }

  // ---------------------------
  // Input
  // ---------------------------
  let controller = null;

  function bindInputsOnce() {
    if (controller) return;
    controller = new AbortController();
    const sig = controller.signal;

    // desktop keys (testing)
    window.addEventListener(
      "keydown",
      (e) => {
        if (completed) return;
        if (e.key === "ArrowUp") requestMove(0, -1);
        if (e.key === "ArrowDown") requestMove(0, 1);
        if (e.key === "ArrowLeft") requestMove(-1, 0);
        if (e.key === "ArrowRight") requestMove(1, 0);
      },
      { signal: sig }
    );

    // swipe controls
    let touchStartX = 0;
    let touchStartY = 0;

    canvas.addEventListener(
      "touchstart",
      (e) => {
        const t = e.touches[0];
        touchStartX = t.clientX;
        touchStartY = t.clientY;
      },
      { passive: true, signal: sig }
    );

    canvas.addEventListener(
      "touchend",
      (e) => {
        if (completed) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - touchStartX;
        const dy = t.clientY - touchStartY;

        const ax = Math.abs(dx);
        const ay = Math.abs(dy);
        if (Math.max(ax, ay) < 14) return;

        if (ax > ay) requestMove(dx > 0 ? 1 : -1, 0);
        else requestMove(0, dy > 0 ? 1 : -1);
      },
      { passive: true, signal: sig }
    );

    window.addEventListener("resize", () => renderer.resize(), { signal: sig });
  }

  // ---------------------------
  // Loop
  // ---------------------------
  let rafId = null;

  function loop(now) {
    movement.update(now);
    const p = movement.getAnimatedPlayer(now);
    renderer.render(p);
    rafId = requestAnimationFrame(loop);
  }

  function startLoop() {
    if (rafId) return;
    renderer.resize();
    rafId = requestAnimationFrame(loop);
  }

  // ---------------------------
  // ✅ Level switching (NO reload)
  // ---------------------------
  function setLevel(nextLevel) {
    // stop movement instantly
    completed = false;

    // rebuild state/movement/renderer with the new level
    state = createGameState(nextLevel);

    // IMPORTANT: keep same canvas but rebuild renderer/movement to use new state
    renderer = createRenderer({ canvas, state });

    movement = createMovement({
      state,
      onTilePainted,
      onMoveFinished: () => {
        if (!completed && state.isComplete()) {
          completed = true;
          onLevelComplete?.({ level: state.level, state });
        }
      },
    });

    // resize and render 1 frame immediately
    renderer.resize();
    const p = movement.getAnimatedPlayer(performance.now());
    renderer.render(p);
  }
function applyProgress({ paintedKeys, player } = {}) {
    if (!paintedKeys && !player) return;

    // restore painted tiles
    if (Array.isArray(paintedKeys)) {
      const next = new Set();
      for (const k of paintedKeys) {
        if (typeof k !== "string") continue;
        const parts = k.split(",");
        if (parts.length !== 2) continue;
        const x = Number(parts[0]);
        const y = Number(parts[1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (!state.isWalkable(x, y)) continue;
        next.add(`${x},${y}`);
      }
      state.painted = next;
    }

    // restore player position (safe)
    if (player && Number.isFinite(player.x) && Number.isFinite(player.y)) {
      if (state.isWalkable(player.x, player.y)) {
        state.player.x = player.x;
        state.player.y = player.y;
      }
    }

    // always ensure start is painted
    if (state.isWalkable(state.player.x, state.player.y)) {
      state.paint(state.player.x, state.player.y);
    }

    // render immediately
    renderer.resize();
    const p = movement.getAnimatedPlayer(performance.now());
    renderer.render(p);
  }
  return {
    applyProgress,
    start() {
      bindInputsOnce();
      startLoop();
    },
    setLevel,
    stop() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      if (controller) controller.abort();
      controller = null;
    },
    getState() {
      return state;
    },
  };
}