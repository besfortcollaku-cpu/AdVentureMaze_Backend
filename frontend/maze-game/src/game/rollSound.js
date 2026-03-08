// src/game/rollSound.js
// Clean, stable WebAudio rolling sound (mobile-safe)

let audioCtx = null;
let unlocked = false;

let rollSource = null;
let rollGain = null;
let rollFilter = null;

/* -------------------------------------------------- */
/* Audio unlock – MUST be called from user gesture */
/* -------------------------------------------------- */
export function unlockAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }

  unlocked = true;
}

/* -------------------------------------------------- */
/* Internal helper */
/* -------------------------------------------------- */
function getCtx() {
  if (!unlocked || !audioCtx) return null;
  return audioCtx;
}

/* -------------------------------------------------- */
/* Start rolling sound */
/* -------------------------------------------------- */
export function startRollSound(intensity = 1) {
  const ctx = getCtx();
  if (!ctx) return;

  stopRollSound();

  // noise buffer
  const size = ctx.sampleRate;
  const buffer = ctx.createBuffer(1, size, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < size; i++) {
    data[i] = (Math.random() * 2 - 1) * 0.35;
  }

  rollSource = ctx.createBufferSource();
  rollSource.buffer = buffer;
  rollSource.loop = true;

  rollFilter = ctx.createBiquadFilter();
  rollFilter.type = "lowpass";

  rollGain = ctx.createGain();
  rollGain.gain.value = 0.0001;

  rollSource.connect(rollFilter);
  rollFilter.connect(rollGain);
  rollGain.connect(ctx.destination);

  rollSource.start();

  updateRollSound(intensity);

  // fade in
  rollGain.gain.linearRampToValueAtTime(
    0.12,
    ctx.currentTime + 0.12
  );
}

/* -------------------------------------------------- */
/* Update rolling sound */
/* -------------------------------------------------- */
export function updateRollSound(intensity = 1) {
  if (!rollFilter || !rollGain) return;

  const ctx = getCtx();
  if (!ctx) return;

  const s = Math.max(0, Math.min(3, intensity));

  rollFilter.frequency.setTargetAtTime(
    260 + s * 320,
    ctx.currentTime,
    0.05
  );

  rollGain.gain.setTargetAtTime(
    0.06 + s * 0.06,
    ctx.currentTime,
    0.05
  );
}

/* -------------------------------------------------- */
/* Stop rolling sound */
/* -------------------------------------------------- */
export function stopRollSound() {
  const ctx = getCtx();
  if (!ctx || !rollGain) return;

  try {
    rollGain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.03);

    setTimeout(() => {
      try { rollSource?.stop(); } catch {}
      try { rollSource?.disconnect(); } catch {}

      rollSource = null;
      rollGain = null;
      rollFilter = null;
    }, 80);
  } catch {
    rollSource = null;
    rollGain = null;
    rollFilter = null;
  }
}