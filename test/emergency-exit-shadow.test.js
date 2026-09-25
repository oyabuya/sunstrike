import test from "node:test";
import assert from "node:assert/strict";
import { assessEmergencyPriceDrawdown } from "../emergency-exit-shadow.js";

test("price crash needs a sustained second observation and matching entry data", () => {
  const tracked = { active_bin_at_deploy: 0, bin_step: 100 };
  const position = { active_bin: -23 };
  const first = assessEmergencyPriceDrawdown({ position, tracked, now: 0 });
  assert.equal(first.confirmed, false);
  assert.ok(first.drawdownPct >= 20);
  assert.equal(assessEmergencyPriceDrawdown({ position, tracked, firstSeenAt: first.firstSeenAt, now: 299_999 }).confirmed, false);
  assert.equal(assessEmergencyPriceDrawdown({ position, tracked, firstSeenAt: first.firstSeenAt, now: 300_000 }).confirmed, true);
  assert.equal(assessEmergencyPriceDrawdown({ position: { active_bin: -10 }, tracked, firstSeenAt: first.firstSeenAt, now: 300_000 }).firstSeenAt, null);
  assert.equal(assessEmergencyPriceDrawdown({ position, tracked: null, now: 0 }).available, false);
  assert.equal(assessEmergencyPriceDrawdown({ position: { active_bin: null }, tracked, now: 0 }).available, false);
});
