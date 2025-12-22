import axios from "axios";



const PI_API_BASE = process.env.PI_API_BASE || "https://api.minepi.com";



export async function verifyPiAccessToken(accessToken: string) {

  // This calls Pi Platform /me with the user token

  // and returns trusted user identity data.

  const res = await axios.get(`${PI_API_BASE}/v2/me`, {

    headers: {

      Authorization: `Bearer ${accessToken}`,

    },

    timeout: 10000,

  });



  // res.data example includes uid, username, etc (source of truth)

  return res.data;

}