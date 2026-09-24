import test from "node:test";
import assert from "node:assert/strict";
import { scanJevMarket } from "../tools/jev-market.js";

test("Jev market scan reads trending windows independently of deploy eligibility", async () => {
  const old = { dry: process.env.DRY_RUN, enabled: process.env.JEV_SHADOW_ENABLED, key: process.env.OPENROUTER_API_KEY };
  try {
    process.env.DRY_RUN = "true";
    process.env.JEV_SHADOW_ENABLED = "true";
    process.env.OPENROUTER_API_KEY = "test";
    const calls = [];
    const discover = async ({ page_size, overrides }) => {
      calls.push({ page_size, overrides });
      return { pools: overrides.timeframe === "5m"
        ? [{ pool: "pool-a", volume_window: 100 }, { pool: "pool-b", volume_window: 500 }]
        : [{ pool: "pool-a", volume_window: 300 }, { pool: "pool-c", volume_window: 2400 }] };
    };
    const score = async (candidates, _fetcher, cycleId) => {
      assert.match(cycleId, /^market-/);
      assert.deepEqual(candidates.map(({ pool }) => pool.pool), ["pool-b", "pool-c", "pool-a"]);
      return [{ pool_address: "pool-b", fees: { score: 1, confidence: 1 } }];
    };
    const result = await scanJevMarket({ discover, score });
    assert.equal(result.scores.length, 1);
    assert.deepEqual(calls.map(({ overrides }) => overrides.timeframe), ["5m", "1h"]);
    assert.ok(calls.every(({ page_size, overrides }) => page_size === 20 && overrides.category === "trending" && overrides.minVolume === 0));
    process.env.DRY_RUN = "false";
    assert.equal(await scanJevMarket({ discover: () => { throw new Error("live scan forbidden"); }, score }), null);
  } finally {
    for (const [name, value] of Object.entries({ DRY_RUN: old.dry, JEV_SHADOW_ENABLED: old.enabled, OPENROUTER_API_KEY: old.key })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
