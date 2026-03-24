"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSendingWalletAvailableBalancePi = getSendingWalletAvailableBalancePi;
exports.sendPiPayout = sendPiPayout;
const runtime_1 = require("../config/runtime");
async function getSendingWalletAvailableBalancePi() {
    const configured = runtime_1.runtimeConfig.payout.sendingWalletAvailablePi ??
        runtime_1.runtimeConfig.payout.payoutTreasuryAvailablePi;
    if (configured !== null)
        return configured;
    // Real balance lookup adapter is intentionally isolated and can be added later.
    return null;
}
async function sendPiPayout(input) {
    if (runtime_1.runtimeConfig.payout.simulateSuccess) {
        return {
            ok: true,
            txid: `sim-${input.idempotencyKey}`,
            externalStatus: "simulated_confirmed",
            raw: { mode: "simulation" },
        };
    }
    if (!runtime_1.runtimeConfig.payout.adapterEnabled) {
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
