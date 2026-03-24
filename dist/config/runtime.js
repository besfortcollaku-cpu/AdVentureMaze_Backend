"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runtimeConfig = void 0;
exports.setPayoutSimulationMode = setPayoutSimulationMode;
function parseBoolean(value, fallback) {
    if (value == null || value === "")
        return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized))
        return true;
    if (["0", "false", "no", "off"].includes(normalized))
        return false;
    return fallback;
}
function parseNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}
function parseOptionalNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}
exports.runtimeConfig = {
    server: {
        port: Math.max(1, Math.floor(parseNumber(process.env.PORT, 8080))),
    },
    database: {
        url: process.env.DATABASE_URL,
        ssl: parseBoolean(process.env.DATABASE_SSL, false),
    },
    admin: {
        secret: String(process.env.ADMIN_SECRET || "").trim(),
        settlementEnabled: parseBoolean(process.env.ADMIN_SETTLEMENT_ENABLED, true),
    },
    economy: {
        defaultEconomyVersion: Math.max(1, Math.floor(parseNumber(process.env.DEFAULT_ECONOMY_VERSION, 1))),
        monthlyPiPool: parseNumber(process.env.MONTHLY_PI_POOL, 300),
    },
    payout: {
        simulateSuccess: parseBoolean(process.env.PAYOUT_SIMULATE_SUCCESS, false),
        adapterEnabled: parseBoolean(process.env.PI_PAYOUT_ADAPTER_ENABLED, false),
        sendingWalletAvailablePi: parseOptionalNumber(process.env.SENDING_WALLET_AVAILABLE_PI),
        payoutTreasuryAvailablePi: parseOptionalNumber(process.env.PAYOUT_TREASURY_AVAILABLE_PI),
    },
    ipRisk: {
        provider: String(process.env.IP_RISK_PROVIDER || "").trim().toLowerCase(),
        ipqualityscoreApiKey: String(process.env.IPQUALITYSCORE_API_KEY || "").trim(),
    },
};
function setPayoutSimulationMode(enabled) {
    exports.runtimeConfig.payout.simulateSuccess = Boolean(enabled);
}
