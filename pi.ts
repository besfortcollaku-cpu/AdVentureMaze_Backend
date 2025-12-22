import axios from "axios";

/**
 * Pi Network API base
 */
const PI_API_BASE = process.env.PI_API_BASE || "https://api.minepi.com";

/**
 * Required API key (server side)
 */
const PI_API_KEY = process.env.PI_API_KEY;

if (!PI_API_KEY) {
  throw new Error("PI_API_KEY missing in .env");
}

/**
 * Axios client for Pi API
 */
export const pi = axios.create({
  baseURL: PI_API_BASE,
  headers: {
    Authorization: `Key ${PI_API_KEY}`,
    "Content-Type": "application/json",
  },
  timeout: 10000,
});

/**
 * Approve a Pi payment
 */
export async function approvePiPayment(paymentId: string) {
  await pi.post(`/v2/payments/${paymentId}/approve`, {});
}

/**
 * Complete a Pi payment
 */
export async function completePiPayment(paymentId: string, txid: string) {
  await pi.post(`/v2/payments/${paymentId}/complete`, { txid });
}