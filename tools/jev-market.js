import { discoverPools } from "./screening.js";
import { recordJevShadow } from "./jev-shadow.js";
import { log } from "../logger.js";

// Advisory discovery only. These wider market filters never enter deploy screening.
const MARKET_OVERRIDES = {
  minMcap: 0, maxMcap: 1_000_000_000,
  minHolders: 0, minVolume: 0, minTvl: 0, maxTvl: 1_000_000_000,
  minBinStep: 1, maxBinStep: 1_000,
  minFeeActiveTvlRatio: 0, minOrganic: 0,
  minTokenAgeHours: null, maxTokenAgeHours: null,
};

export async function scanJevMarket({ discover = discoverPools, score = recordJevShadow } = {}) {
  if (process.env.DRY_RUN !== "true" || process.env.JEV_SHADOW_ENABLED !== "true" || !process.env.OPENROUTER_API_KEY) return null;
  const windows = ["5m", "1h"];
  const results = await Promise.allSettled(windows.map((timeframe) =>
    discover({ page_size: 20, overrides: { ...MARKET_OVERRIDES, timeframe, category: "trending" } })
  ));
  const pools = new Map();
  for (let i = 0; i < results.length; i++) {
    if (results[i].status !== "fulfilled") {
      log("jev_market_warn", `${windows[i]} trending discovery unavailable`);
      continue;
    }
    for (const pool of results[i].value.pools ?? []) {
      if (pool?.pool && !pools.has(pool.pool)) pools.set(pool.pool, { ...pool, discovery_timeframe: windows[i] });
    }
  }
  if (!pools.size) {
    log("jev_market", "No trending pools available for Jev");
    return null;
  }
  const candidates = [...pools.values()]
    .sort((a, b) => {
      const rate = (pool) => (Number(pool.volume_window) || 0) / (pool.discovery_timeframe === "1h" ? 12 : 1);
      return rate(b) - rate(a);
    })
    .slice(0, 5)
    .map((pool) => ({ pool }));
  const scores = await score(candidates, fetch, `market-${Date.now()}`);
  if (scores) log("jev_market", `Scored ${scores.length} trending pool(s) for advisory use`);
  return scores ? { at: Date.now(), scores } : null;
}
