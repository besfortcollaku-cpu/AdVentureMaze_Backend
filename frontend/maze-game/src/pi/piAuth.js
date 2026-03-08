/**
 * Pi Auth helper
 * - Requires Pi Browser
 * - Supports sandbox (?dev=true or pages.dev)
 * - Verifies token with backend
 */

export function isPiBrowser() {
  if (typeof window !== "undefined" && window.Pi) return true;

  const ua = (navigator.userAgent || "").toLowerCase();
  if (ua.includes("pibrowser")) return true;

  return false;
}

function isDevSandbox() {
  try {
    const url = new URL(window.location.href);

    // explicit sandbox flag
    if (url.searchParams.get("dev") === "true") return true;

    // pages.dev = sandbox by default
    if (window.location.hostname.includes("pages.dev")) return true;

    return false;
  } catch {
    return false;
  }
}

export async function piLoginAndVerify(BACKEND) {
  if (!isPiBrowser()) {
    throw new Error("Pi Browser required");
  }

  if (!window.Pi) {
    throw new Error("Pi SDK not available");
  }

  const sandbox = isDevSandbox();

  // ✅ SAFE INIT (sandbox aware)
  try {
    window.Pi.init({
      version: "2.0",
      sandbox,
    });
  } catch {
    // already initialized
  }

  // ✅ AUTHENTICATE
  const auth = await window.Pi.authenticate(["username"], (payment) => {
    console.log("Incomplete payment:", payment);
  });

  if (!auth?.accessToken) {
    throw new Error("Pi did not return accessToken");
  }

  // ✅ BACKEND VERIFY
  const base = BACKEND.replace(/\/$/, "");
  const res = await fetch(`${base}/api/pi/verify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.accessToken}`,
    },
    body: JSON.stringify({ accessToken: auth.accessToken }),
  });

  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {}

  if (!res.ok || !data?.ok) {
    throw new Error(
      data?.error || `Backend verify failed (${res.status})`
    );
  }

  return {
    auth,
    verifiedUser: data.user,
  };
}