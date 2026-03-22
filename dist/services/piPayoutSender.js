"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSendingWalletAvailableBalancePi = getSendingWalletAvailableBalancePi;
exports.sendPiPayout = sendPiPayout;
function parseOptionalNumber(raw) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
}
async function getSendingWalletAvailableBalancePi() {
    const configured = parseOptionalNumber(process.env.SENDING_WALLET_AVAILABLE_PI) ??
        parseOptionalNumber(process.env.PAYOUT_TREASURY_AVAILABLE_PI);
    if (configured !== null)
        return configured;
    // Real balance lookup adapter is intentionally isolated and can be added later.
    return null;
}
async function sendPiPayout(input) {
    if (process.env.PAYOUT_SIMULATE_SUCCESS === "true") {
        return {
            ok: true,
            txid: `sim-${input.idempotencyKey}`,
            externalStatus: "simulated_confirmed",
            raw: { mode: "simulation" },
        };
    }
    if (process.env.PI_PAYOUT_ADAPTER_ENABLED !== "true") {
        return {
            ok: false,
            error: "adapter_not_configured",
            raw: { reason: "PI_PAYOUT_ADAPTER_ENABLED_false" },
        };
    }
    // Keep adapter integration isolated. Hook your real server-side sending-wallet implementation here.
    // Never expose keys to client code.
    throw new Error("real_payout_adapter_not_configured");
}
