// src/pi.ts

import fetch from "node-fetch";



const PI_API_BASE = "https://api.minepi.com";

const PI_API_KEY = process.env.PI_API_KEY || "";



export type PiAuthResult = {

  accessToken: string;

  user: { username: string; uid?: string };

};



export async function verifyPiAccessToken(accessToken: string) {

  if (!PI_API_KEY) {

    throw new Error("Missing PI_API_KEY env var on backend");

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

  // Pi returns something like: { user: { username, uid, ... } }

  return data;

}