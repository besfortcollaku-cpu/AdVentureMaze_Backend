import { runtimeConfig } from "../config/runtime";

export type SendPiPayoutInput = {
  uid: string;
  walletIdentifier: string;
  amountPi: number;
  idempotencyKey: string;
};

export type SendPiPayoutResult = {
  ok: boolean;
  txid?: string;
  externalStatus?: string;
  error?: string;
  raw?: any;
};

export async function getSendingWalletAvailableBalancePi(): Promise<number | null> {
  const configured =
    runtimeConfig.payout.sendingWalletAvailablePi ??
    runtimeConfig.payout.payoutTreasuryAvailablePi;

  if (configured !== null) return configured;

  // Real balance lookup adapter is intentionally isolated and can be added later.
  return null;
}

export async function sendPiPayout(input: SendPiPayoutInput): Promise<SendPiPayoutResult> {
  if (runtimeConfig.payout.simulateSuccess) {
    return {
      ok: true,
      txid: `sim-${input.idempotencyKey}`,
      externalStatus: "simulated_confirmed",
      raw: { mode: "simulation" },
    };
  }

  if (!runtimeConfig.payout.adapterEnabled) {
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
