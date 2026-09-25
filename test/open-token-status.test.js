import test from "node:test";
import assert from "node:assert/strict";
import { classifyOpenTokenStatus, readOpenTokenStatus } from "../open-token-status.js";

const token = { mint: "MINT", organic_score: 75, audit: { mint_disabled: true, freeze_disabled: true },
  stats_1h: { price_change: "-20", net_buyers: -5, buy_vol: "100", sell_vol: "300" } };

test("selling pressure alone does not claim a rug", () => {
  const status = classifyOpenTokenStatus({ mint: "MINT", token, risk: null });
  assert.equal(status.status, "selling_pressure");
  assert.equal(status.jupiter_organic_score, 75);
  assert.equal(status.organic_below_entry_floor, true);
  assert.equal(classifyOpenTokenStatus({ mint: "MINT", token: { ...token, stats_1h: { price_change: "-20" } }, risk: null }).status, "no_critical_flag_observed");
});

test("explicit rug or unsafe authority is critical; absent audit is unknown", async () => {
  assert.equal(classifyOpenTokenStatus({ mint: "MINT", token, risk: { is_rugpull: true } }).status, "critical");
  assert.equal(classifyOpenTokenStatus({ mint: "MINT", token: { ...token, audit: { freeze_disabled: false } }, risk: null }).status, "critical");
  assert.equal(classifyOpenTokenStatus({ mint: "MINT", token: null, risk: { is_rugpull: false } }).status, "unknown");
  const result = await readOpenTokenStatus("MINT", {
    tokenReader: async () => ({ results: [token] }),
    riskReader: async () => { throw new Error("unavailable"); },
  });
  assert.equal(result.status, "selling_pressure");
  assert.equal(result.okx_available, false);
});
