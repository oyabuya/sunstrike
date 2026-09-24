import test from "node:test";
import assert from "node:assert/strict";
import { activityPerFiveMinutes, activityWindowMultiplier, scoreEvilPandaCandidate } from "../evilpanda-policy.js";

test("cross-window activity uses the same five-minute basis", () => {
  for (const timeframe of ["5m", "30m", "1h", "2h"]) {
    const factor = activityWindowMultiplier(timeframe);
    assert.equal(activityPerFiveMinutes(500 * factor, timeframe), 500);
    assert.equal(activityPerFiveMinutes(0.02 * factor, timeframe), 0.02);
  }
  assert.equal(activityPerFiveMinutes(null, "5m"), null);
  assert.equal(activityPerFiveMinutes(100, "unknown"), null);
});

test("identical activity rates receive identical screening scores", () => {
  const base = { volume_window: 60_000, fee_active_tvl_ratio: 0.1, volatility: 2 };
  const fiveMinutes = scoreEvilPandaCandidate({ ...base, discovery_timeframe: "5m" });
  const oneHour = scoreEvilPandaCandidate({
    ...base,
    volume_window: base.volume_window * 12,
    fee_active_tvl_ratio: base.fee_active_tvl_ratio * 12,
    discovery_timeframe: "1h",
  });
  assert.equal(oneHour, fiveMinutes);
});
