import fetch from "node-fetch";

const PI_API_BASE = "https://api.minepi.com";
const PI_API_KEY = process.env.PI_API_KEY || "";

export type PiAuthResult = {
  accessToken: string;
  user: {
    username: string;
    uid?: string;
  };
};

/**
 * Verifies Pi access token and returns normalized user data
 */
export async function verifyPiAccessToken(accessToken: string): Promise<PiAuthResult> {
  if (!PI_API_KEY) {
    throw new Error("Missing PI_API_KEY env var on backend");
  }

  if (!accessToken) {
    throw new Error("Missing Pi access token");
  }

  const res = await fetch(`${PI_API_BASE}/v2/me`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-API-Key": PI_API_KEY,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Pi verify failed: ${res.status} ${txt}`);
  }

  const data = await res.json();

  // Pi response format: { user: { username, uid, ... } }
  if (!data || !data.user || !data.user.username) {
    throw new Error("Invalid Pi user response");
  }

  return {
    accessToken,
    user: {
      username: data.user.username,
      uid: data.user.uid,
    },
  };
}