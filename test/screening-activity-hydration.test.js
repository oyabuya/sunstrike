import test from "node:test";
import assert from "node:assert/strict";
import { hydrateActivityWindows } from "../tools/screening.js";
import { assessFreshActivity } from "../candidate-quality.js";

test("missing discovery timeframe is checked against exact pool detail", async () => {
  const fiveMinutes = { pool: "POOL", base: { mint: "MINT" }, volume_window: 700,
    fee_active_tvl_ratio: 0.03, active_tvl: 20_000, unique_traders: 10 };
  const oneHour = { ...fiveMinutes, volume_window: 8_400, fee_active_tvl_ratio: 0.36 };
  const pool = { ...fiveMinutes, activity_windows: { "5m": fiveMinutes } };
  const calls = [];
  await hydrateActivityWindows([pool], async (args) => { calls.push(args); return oneHour; });
  assert.deepEqual(calls, [{ pool_address: "POOL", timeframe: "1h" }]);
  assert.equal(assessFreshActivity({ fiveMinutes: pool.activity_windows["5m"],
    oneHour: pool.activity_windows["1h"],
    screening: { minVolume: 500, minFeeActiveTvlRatio: 0.02 } }).pass, true);
});

test("unavailable or mismatched exact detail remains rejected", async () => {
  const pool = { pool: "POOL", base: { mint: "MINT" }, activity_windows: {} };
  await hydrateActivityWindows([pool], async ({ timeframe }) => {
    if (timeframe === "5m") throw Error("unavailable");
    return { pool: "POOL", base: { mint: "OTHER" } };
  });
  assert.deepEqual(pool.activity_windows, {});
});
