import { getTokenInfo } from "./tools/token.js";
import { getRiskFlags } from "./tools/okx.js";

function metric(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function classifyOpenTokenStatus({ mint, token, risk }) {
  if (!mint) return { status: "unknown", reason: "token mint unavailable" };
  const critical = [];
  if (risk?.is_rugpull === true) critical.push("liquidity-removal risk flagged");
  if (token?.mint === mint) {
    if (token.audit?.mint_disabled === false) critical.push("mint authority enabled");
    if (token.audit?.freeze_disabled === false) critical.push("freeze authority enabled");
    if (Array.isArray(token.tags) && token.tags.some((tag) => String(tag).toLowerCase().includes("honeypot"))) critical.push("honeypot flagged");
  }
  if (critical.length) return { status: "critical", reason: critical.join(", ") };
  if (token?.mint !== mint) return { status: "unknown", reason: "matching token audit unavailable" };

  const priceChange1h = metric(token.stats_1h?.price_change);
  const organicScore = metric(token.organic_score);
  const netBuyers1h = metric(token.stats_1h?.net_buyers);
  const buyVolume1h = metric(token.stats_1h?.buy_vol);
  const sellVolume1h = metric(token.stats_1h?.sell_vol);
  const sellingPressure = priceChange1h != null && priceChange1h <= -10 &&
    netBuyers1h != null && netBuyers1h < 0 && buyVolume1h != null && sellVolume1h != null &&
    sellVolume1h > buyVolume1h * 2;
  return {
    status: sellingPressure ? "selling_pressure" : "no_critical_flag_observed",
    reason: sellingPressure ? "1h price, net buyers and sell volume all deteriorated" : null,
    price_change_1h_pct: priceChange1h,
    jupiter_organic_score: organicScore,
    organic_below_entry_floor: organicScore != null ? organicScore < 80 : null,
    net_buyers_1h: netBuyers1h,
    risk_level: metric(token.risk_level ?? risk?.risk_level),
    wash_flag: risk?.is_wash ?? null,
  };
}

export async function readOpenTokenStatus(mint, {
  tokenReader = getTokenInfo,
  riskReader = getRiskFlags,
} = {}) {
  const [tokenResult, riskResult] = await Promise.allSettled([
    tokenReader({ query: mint }), riskReader(mint),
  ]);
  const token = tokenResult.status === "fulfilled"
    ? tokenResult.value?.results?.find((item) => item.mint === mint) : null;
  const risk = riskResult.status === "fulfilled" ? riskResult.value : null;
  return { ...classifyOpenTokenStatus({ mint, token, risk }), observed_at: new Date().toISOString(),
    jupiter_available: !!token, okx_available: !!risk };
}
