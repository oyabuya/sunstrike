import test from "node:test";
import assert from "node:assert/strict";
import { buildJevShadowRequest, recordJevShadow } from "../tools/jev-shadow.js";

const candidate = {
  pool: { pool: "example-pool", candidate_score: 42, fee_active_tvl_ratio: 0.1, volume_window: 200000, active_tvl: 50000, volatility: 2, organic_score: 75, st_direction: "up" },
  ti: { audit: { top_holders_pct: 12, bot_holders_pct: 5 } },
  volTrend: { trend_pct: 20 },
};

test("Jev receives only bounded candidate metrics and separate score questions", () => {
  const request = buildJevShadowRequest(Array(7).fill(candidate));
  assert.equal(request.model, "typesafe/jev-1.13");
  assert.equal(request.state.pools.length, 5);
  assert.equal(Object.keys(request.questions).length, 15);
  assert.equal(request.state.pools[0].candidate_score, 42);
  assert.equal(request.state.pools[0].volume_trend_pct, 20);
  assert.equal(request.state.pools[0].narrative, undefined);
});

test("Jev shadow never calls provider outside explicitly enabled dry run", async () => {
  const old = { dry: process.env.DRY_RUN, enabled: process.env.JEV_SHADOW_ENABLED, key: process.env.OPENROUTER_API_KEY };
  const fail = () => { throw new Error("provider should not be called"); };
  try {
    process.env.DRY_RUN = "false";
    process.env.JEV_SHADOW_ENABLED = "true";
    process.env.OPENROUTER_API_KEY = "test";
    assert.equal(await recordJevShadow([candidate], fail), null);
    process.env.DRY_RUN = "true";
    process.env.JEV_SHADOW_ENABLED = "false";
    assert.equal(await recordJevShadow([candidate], fail), null);
  } finally {
    for (const [name, value] of Object.entries({ DRY_RUN: old.dry, JEV_SHADOW_ENABLED: old.enabled, OPENROUTER_API_KEY: old.key })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
