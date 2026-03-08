const BASE_URL = ""; 
// empty = same origin
// if backend is elsewhere, put full URL here

async function request(path, options = {}) {
  const res = await fetch(BASE_URL + path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "API error");
  }

  return res.json();
}

/* ================= USER ================= */

export function apiMe() {
  return request("/api/me");
}

/* ================= SKIP ================= */

export function apiSkip(mode, nonce) {
  return request("/api/skip", {
    method: "POST",
    body: JSON.stringify({ mode, nonce })
  });
}

/* ================= HINT ================= */

export function apiHint(mode, nonce) {
  return request("/api/hint", {
    method: "POST",
    body: JSON.stringify({ mode, nonce })
  });
}