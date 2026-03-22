"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lookupIpRisk = lookupIpRisk;
const NEUTRAL_RESULT = {
    is_vpn: false,
    country: null,
    isp: null,
    asn: null,
    riskScore: 0,
};
function pickIp(rawIp) {
    const ip = String(rawIp || "").trim().replace(/^::ffff:/, "");
    return ip || null;
}
function asBool(v) {
    if (typeof v === "boolean")
        return v;
    const s = String(v ?? "").toLowerCase();
    return s === "1" || s === "true" || s === "yes";
}
function asNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}
async function lookupIpRisk(ip, userAgent) {
    const safeIp = pickIp(ip);
    if (!safeIp)
        return { ...NEUTRAL_RESULT };
    const provider = String(process.env.IP_RISK_PROVIDER || "").trim().toLowerCase();
    if (!provider)
        return { ...NEUTRAL_RESULT };
    try {
        if (provider === "ipqualityscore") {
            const apiKey = String(process.env.IPQUALITYSCORE_API_KEY || "").trim();
            if (!apiKey)
                return { ...NEUTRAL_RESULT };
            const fetchFn = globalThis.fetch;
            if (typeof fetchFn !== "function")
                return { ...NEUTRAL_RESULT };
            const url = `https://ipqualityscore.com/api/json/ip/${encodeURIComponent(apiKey)}/${encodeURIComponent(safeIp)}?strictness=1&allow_public_access_points=true${userAgent ? `&user_agent=${encodeURIComponent(userAgent)}` : ""}`;
            const res = await fetchFn(url, { method: "GET" });
            if (!res || !res.ok)
                return { ...NEUTRAL_RESULT };
            const data = await res.json().catch(() => null);
            if (!data || typeof data !== "object")
                return { ...NEUTRAL_RESULT };
            return {
                is_vpn: asBool(data.vpn) || asBool(data.proxy) || asBool(data.tor),
                country: String(data.country_code || data.country || "").trim() || null,
                isp: String(data.ISP || data.isp || "").trim() || null,
                asn: String(data.ASN || data.asn || "").trim() || null,
                riskScore: asNumber(data.fraud_score),
            };
        }
    }
    catch {
        // fail-open: do not fail gameplay/reward flow on provider issues
    }
    return { ...NEUTRAL_RESULT };
}
