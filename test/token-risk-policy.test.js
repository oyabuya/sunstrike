import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateTokenRisk } from "../token-risk-policy.js";

const input = () => ({
  expectedMint: "MINT",
  poolMint: "MINT",
  tokenInfo: { mint: "MINT", audit: { mint_disabled: true, freeze_disabled: true, top_holders_pct: "20", bot_holders_pct: "10" } },
  okxAdvanced: { risk_level: 2, top10_pct: 22, dev_holding_pct: 1, bundle_pct: 30, tags: [] },
  okxRisk: { is_rugpull: false, is_wash: false },
  gmgnSecurity: { top_10_holder_rate: 0.25, renounced_mint: true, is_honeypot: false },
  gmgnInfo: { creator_hold_rate: 0.03, dev_hold_rate: 0.04, bundler_pct: 35, rat_trader_pct: 25 },
  screening: { maxTop10Pct: 30, maxBotHoldersPct: 30, maxDevHoldPct: 5, maxBundlePct: 60, maxRatTraderPct: 30 },
});

test("shared risk policy passes complete data and uses the most conservative provider value", () => {
  const result = evaluateTokenRisk(input());
  assert.equal(result.pass, true);
  assert.equal(result.metrics.top10_pct, 25);
  assert.equal(result.metrics.dev_hold_pct, 4);
});

test("creator rates are fractional and converted to percent before the 5% limit", () => {
  const candidate = input();
  candidate.gmgnInfo.creator_hold_rate = 0.06;
  assert.match(evaluateTokenRisk(candidate).reason, /creator\/developer holding 6\.0% exceeds 5%/);
});

test("missing, unsafe, or mismatched risk evidence fails closed", () => {
  const missingRat = input();
  delete missingRat.gmgnInfo.rat_trader_pct;
  assert.match(evaluateTokenRisk(missingRat).reason, /rat-trader concentration is unknown/);

  const unknownWash = input();
  unknownWash.okxRisk.is_wash = null;
  assert.match(evaluateTokenRisk(unknownWash).reason, /analysis is incomplete/);

  const mintMismatch = input();
  mintMismatch.poolMint = "OTHER";
  assert.match(evaluateTokenRisk(mintMismatch).reason, /does not match/);
});

test("a bad flag from any source rejects a candidate even when another source says safe", () => {
  const candidate = input();
  candidate.okxAdvanced.tags = ["honeypot"];
  assert.match(evaluateTokenRisk(candidate).reason, /honeypot/);
});

test("invalid operator thresholds fail closed rather than disabling comparisons", () => {
  const candidate = input();
  candidate.screening.maxTop10Pct = Number.NaN;
  assert.match(evaluateTokenRisk(candidate).reason, /threshold is invalid/);
});
