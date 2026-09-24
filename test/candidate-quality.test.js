import test from "node:test";
import assert from "node:assert/strict";
import { assessFreshActivity, assessTokenMaturity, estimateNetFeeScenario } from "../candidate-quality.js";

test("token maturity requires exact Jupiter mint, 12h age and Organic Score 80", () => {
  const pool = { base: { mint: "MINT" }, token_age_hours: 12 };
  const tokenInfo = { mint: "MINT", organic_score: 80 };
  assert.equal(assessTokenMaturity({ pool, tokenInfo }).pass, true);
  assert.equal(assessTokenMaturity({ pool: { ...pool, token_age_hours: 11.9 }, tokenInfo }).pass, false);
  assert.equal(assessTokenMaturity({ pool, tokenInfo: { ...tokenInfo, organic_score: 79 } }).pass, false);
  assert.equal(assessTokenMaturity({ pool, tokenInfo: { ...tokenInfo, mint: "OTHER" } }).pass, false);
  assert.equal(assessTokenMaturity({ pool: { ...pool, token_age_hours: 10_000 }, tokenInfo }).pass, true);
});

const screening = { minVolume: 500, minFeeActiveTvlRatio: 0.02 };
const pool = (volume, fee, extra = {}) => ({
  pool: "POOL", base: { mint: "MINT" }, volume_window: volume,
  fee_active_tvl_ratio: fee, active_tvl: 20_000, unique_traders: 10,
  ...extra,
});

test("fresh activity requires matching 5m and 1h identity and sustained activity", () => {
  const fiveMinutes = pool(700, 0.03);
  const oneHour = pool(8_400, 0.36);
  assert.equal(assessFreshActivity({ fiveMinutes, oneHour, screening }).pass, true);
  assert.match(assessFreshActivity({ fiveMinutes: pool(500, 0.02), oneHour: pool(24_000, 0.6), screening }).reason, /fallen below half/);
  assert.match(assessFreshActivity({ fiveMinutes, oneHour: pool(8_400, 0.36, { base: { mint: "OTHER" } }), screening }).reason, /identity/);
  assert.match(assessFreshActivity({ fiveMinutes: pool(null, 0.03), oneHour, screening }).reason, /missing/);
  assert.match(assessFreshActivity({ fiveMinutes: pool(700, 0.03, { unique_traders: 2 }), oneHour, screening }).reason, /distinct traders/);
});

test("net fee scenario exposes costs and inventory stress without claiming a forecast", () => {
  const estimate = estimateNetFeeScenario({ pool: { active_tvl: 20_000, fee_active_tvl_ratio: 0.1, discovery_timeframe: "5m" }, amountSol: 0.2, solPrice: 100 });
  assert.ok(estimate.estimated_fees_4h_usd > 0);
  assert.equal(estimate.estimated_costs_usd, 0.7);
  assert.equal(estimate.net_after_5pct_adverse_move_usd, Number((estimate.net_before_inventory_usd - 1).toFixed(3)));
  assert.equal(estimateNetFeeScenario({ pool: {}, amountSol: 0.2, solPrice: 100 }), null);
});
