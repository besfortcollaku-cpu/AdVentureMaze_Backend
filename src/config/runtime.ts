function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value == null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parseNumber(value: string | undefined, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseOptionalNumber(value: string | undefined) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

type RuntimeConfig = {
  server: {
    port: number;
  };
  database: {
    url: string | undefined;
    ssl: boolean;
  };
  admin: {
    secret: string;
    settlementEnabled: boolean;
  };
  economy: {
    defaultEconomyVersion: number;
    monthlyPiPool: number;
  };
  payout: {
    simulateSuccess: boolean;
    adapterEnabled: boolean;
    sendingWalletAvailablePi: number | null;
    payoutTreasuryAvailablePi: number | null;
  };
  ipRisk: {
    provider: string;
    ipqualityscoreApiKey: string;
  };
};

export const runtimeConfig: RuntimeConfig = {
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

export function setPayoutSimulationMode(enabled: boolean) {
  runtimeConfig.payout.simulateSuccess = Boolean(enabled);
}
