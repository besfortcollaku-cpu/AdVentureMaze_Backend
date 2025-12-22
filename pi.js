"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pi = void 0;
exports.approvePiPayment = approvePiPayment;
exports.completePiPayment = completePiPayment;
const axios_1 = __importDefault(require("axios"));
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
exports.pi = axios_1.default.create({
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
async function approvePiPayment(paymentId) {
    await exports.pi.post(`/v2/payments/${paymentId}/approve`, {});
}
/**
 * Complete a Pi payment
 */
async function completePiPayment(paymentId, txid) {
    await exports.pi.post(`/v2/payments/${paymentId}/complete`, { txid });
}
//# sourceMappingURL=pi.js.map