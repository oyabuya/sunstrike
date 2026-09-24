import test from "node:test";
import assert from "node:assert/strict";
import { assessEntryActivity, assessFreshActivity, assessSustainedActivity, assessTokenMaturity, estimateNetFeeScenario } from "../candidate-quality.js";

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

test("1h activity is required while 30m and 5m declines are advisory", () => {
  const oneHour = pool(8_400, 0.36);
  const thirtyMinutes = pool(3_000, 0.12);
  const fiveMinutes = pool(0, 0, { unique_traders: 2, price_change_pct: -6 });
  const result = assessSustainedActivity({ fiveMinutes, thirtyMinutes, oneHour, screening });
  assert.equal(result.pass, true);
  assert.equal(result.metrics.volume_1h_per_5m_usd, 700);
  assert.match(result.cautions.join(" "), /30m activity|5m activity/);
  assert.match(result.cautions.join(" "), /price fell/);
  assert.equal(assessSustainedActivity({ thirtyMinutes, oneHour, screening }).pass, true);
  assert.match(assessSustainedActivity({ thirtyMinutes, oneHour, screening }).cautions.join(" "), /5m snapshot missing/);
  assert.match(assessSustainedActivity({ fiveMinutes, thirtyMinutes, oneHour: pool(5_000, 0.12), screening }).reason, /1h activity/);
  assert.match(assessSustainedActivity({ fiveMinutes, thirtyMinutes: null, oneHour, screening }).cautions.join(" "), /30m snapshot missing/);
  assert.match(assessSustainedActivity({ fiveMinutes, thirtyMinutes: pool(3_000, 0.12, { base: { mint: "OTHER" } }), oneHour, screening }).cautions.join(" "), /30m snapshot missing/);
  assert.equal(assessFreshActivity({ fiveMinutes: pool(0, 0), oneHour, screening }).pass, false);
  assert.equal(assessEntryActivity({ fiveMinutes, thirtyMinutes, oneHour, screening }, true).pass, true);
  assert.equal(assessEntryActivity({ fiveMinutes, thirtyMinutes, oneHour, screening }, false).pass, false);
});

test("net fee scenario exposes costs and inventory stress without claiming a forecast", () => {
  const estimate = estimateNetFeeScenario({ pool: { active_tvl: 20_000, fee_active_tvl_ratio: 0.1, discovery_timeframe: "5m" }, amountSol: 0.2, solPrice: 100 });
  assert.ok(estimate.estimated_fees_4h_usd > 0);
  assert.equal(estimate.estimated_costs_usd, 0.7);
  assert.equal(estimate.net_after_5pct_adverse_move_usd, Number((estimate.net_before_inventory_usd - 1).toFixed(3)));
  assert.equal(estimateNetFeeScenario({ pool: {}, amountSol: 0.2, solPrice: 100 }), null);
});
