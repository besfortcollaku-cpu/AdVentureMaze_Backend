import { piLoginAndVerify } from "./piAuth.js";

/**
 * ensurePiLogin
 *
 * Guarantees:
 * - Returns { ok: true, accessToken } on success
 * - Sets frontend login state via onLogin callback
 * - Works for BOTH fresh login and already-logged-in users
 */
export async function ensurePiLogin({ BACKEND, ui, onLogin }) {
  // prevent double execution
  if (ensurePiLogin._running) {
    return { ok: false };
  }
  ensurePiLogin._running = true;

  try {
    // 🔹 FORCE Pi login flow
    // (Pi SDK decides whether popup is needed)
    ui?.showLoginGate?.();

    const result = await (ensurePiLogin._prestarted || piLoginAndVerify(BACKEND));

    // piAuth.js returns: { auth, verifiedUser }
    const accessToken = result?.auth?.accessToken;
    const user = result?.verifiedUser;

    if (!accessToken || !user) {
      ui?.hideLoginGate?.();
      return { ok: false };
    }

    // 🔹 Propagate login state to frontend
    onLogin?.({
      user,
      accessToken,
    });

    ui?.setUser?.(user);
    ui?.hideLoginGate?.();

    // 🔹 IMPORTANT: always return token
    return {
      ok: true,
      accessToken,
    };
} catch (err) {
    console.error("ensurePiLogin error", err);
    ui?.hideLoginGate?.();
    return { ok: false };
} finally {
    ensurePiLogin._running = false;
    ensurePiLogin._prestarted = null;
  }
}
// Prestart Pi auth inside the first user gesture (touchstart) to avoid 2-tap on mobile webviews.
export function prestartPiLogin(BACKEND) {
  if (ensurePiLogin._prestarted) return ensurePiLogin._prestarted;
  ensurePiLogin._prestarted = piLoginAndVerify(BACKEND);
  return ensurePiLogin._prestarted;
}