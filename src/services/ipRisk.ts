export type IpRiskLookupResult = {
  is_vpn: boolean;
  country: string | null;
  isp: string | null;
  asn: string | null;
  riskScore: number;
};

const NEUTRAL_RESULT: IpRiskLookupResult = {
  is_vpn: false,
  country: null,
  isp: null,
  asn: null,
  riskScore: 0,
};

function pickIp(rawIp: string | null | undefined) {
  const ip = String(rawIp || "").trim().replace(/^::ffff:/, "");
  return ip || null;
}

function asBool(v: any) {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

function asNumber(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function lookupIpRisk(ip: string | null | undefined, userAgent?: string | null): Promise<IpRiskLookupResult> {
  const safeIp = pickIp(ip);
  if (!safeIp) return { ...NEUTRAL_RESULT };

  const provider = String(process.env.IP_RISK_PROVIDER || "").trim().toLowerCase();
  if (!provider) return { ...NEUTRAL_RESULT };

  try {
    if (provider === "ipqualityscore") {
      const apiKey = String(process.env.IPQUALITYSCORE_API_KEY || "").trim();
      if (!apiKey) return { ...NEUTRAL_RESULT };

      const fetchFn: any = (globalThis as any).fetch;
      if (typeof fetchFn !== "function") return { ...NEUTRAL_RESULT };

      const url = `https://ipqualityscore.com/api/json/ip/${encodeURIComponent(apiKey)}/${encodeURIComponent(safeIp)}?strictness=1&allow_public_access_points=true${userAgent ? `&user_agent=${encodeURIComponent(userAgent)}` : ""}`;
      const res = await fetchFn(url, { method: "GET" });
      if (!res || !res.ok) return { ...NEUTRAL_RESULT };

      const data = await res.json().catch(() => null);
      if (!data || typeof data !== "object") return { ...NEUTRAL_RESULT };

      return {
        is_vpn: asBool((data as any).vpn) || asBool((data as any).proxy) || asBool((data as any).tor),
        country: String((data as any).country_code || (data as any).country || "").trim() || null,
        isp: String((data as any).ISP || (data as any).isp || "").trim() || null,
        asn: String((data as any).ASN || (data as any).asn || "").trim() || null,
        riskScore: asNumber((data as any).fraud_score),
      };
    }
  } catch {
    // fail-open: do not fail gameplay/reward flow on provider issues
  }

  return { ...NEUTRAL_RESULT };
}
