import test from "node:test";
import assert from "node:assert/strict";
import { assessBelowRangeExit } from "../position-exit-policy.js";

const position = { pool: "POOL", active_bin: 90, lower_bin: 100, minutes_out_of_range: 241 };
const screening = { minVolume: 500, minFeeActiveTvlRatio: 0.02 };

test("below-range drawdown alone does not close; sustained inactivity does", () => {
  assert.equal(assessBelowRangeExit({ position, screening, pool1h: { pool: "POOL", volume_window: 500, fee_active_tvl_ratio: 0.01 } }).close, true);
  assert.equal(assessBelowRangeExit({ position, screening, pool1h: { pool: "POOL", volume_window: 20_000, fee_active_tvl_ratio: 0.5 } }).close, false);
  assert.equal(assessBelowRangeExit({ position: { ...position, minutes_out_of_range: 30 }, screening, pool1h: { pool: "POOL", volume_window: 0, fee_active_tvl_ratio: 0 } }).close, false);
});

test("multiple deterioration signals can close after four hours", () => {
  const result = assessBelowRangeExit({ position, screening, tokenStatus: { status: "selling_pressure" },
    volumeTrend: { trend_pct: -60 }, pool1h: { pool: "POOL", volume_window: 10_000, fee_active_tvl_ratio: 0.12 } });
  assert.equal(result.close, true);
  assert.equal(assessBelowRangeExit({ position, screening, tokenStatus: { status: "unknown" },
    volumeTrend: { trend_pct: -60 }, pool1h: { pool: "POOL", volume_window: 10_000, fee_active_tvl_ratio: 0.12 } }).close, false);
});
