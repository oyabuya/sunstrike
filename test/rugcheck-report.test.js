import test from "node:test";
import assert from "node:assert/strict";
import { parseRugCheckReport } from "../tools/dexscreener-rugcheck.js";

const mint = "EXPECTED_MINT";

test("RugCheck compares only the normalised risk score", () => {
  const report = parseRugCheckReport({ token: { mint }, score: 3200, score_normalised: 12, risks: [] }, mint);
  assert.equal(report.risk_score, 12);
  assert.equal(report.risk_score_raw, 3200);
  assert.equal(report.risk_level, "safe");
  assert.equal(parseRugCheckReport({ token: { mint }, score: 3200 }, mint).risk_level, "unknown");
  assert.equal(parseRugCheckReport({ token: { mint }, score_normalised: 3200 }, mint).risk_level, "unknown");
});

test("missing authority and holder fields remain unknown", () => {
  const report = parseRugCheckReport({ token: { mint } }, mint);
  assert.equal(report.mint_authority_disabled, null);
  assert.equal(report.freeze_authority_disabled, null);
  assert.equal(report.lp_locked, null);
  assert.equal(report.lp_lock_entries_present, null);
  assert.equal(report.top_10_holder_pct, null);
  assert.equal(report.transfer_fee_pct, null);
});

test("explicit null authority is disabled; address is enabled", () => {
  const report = parseRugCheckReport({ token: { mint, mintAuthority: null, freezeAuthority: "AUTH" } }, mint);
  assert.equal(report.mint_authority_disabled, true);
  assert.equal(report.freeze_authority_disabled, false);
  assert.equal(report.freeze_authority, "AUTH");
});

test("RugCheck refuses a mismatched mint and reserves rugged for explicit flag", () => {
  assert.match(parseRugCheckReport({ token: { mint: "OTHER" } }, mint).error, /mismatched/);
  assert.equal(parseRugCheckReport({ token: { mint }, score_normalised: 90 }, mint).risk_level, "danger");
  assert.equal(parseRugCheckReport({ token: { mint }, rugged: true }, mint).risk_level, "rugged");
  assert.equal(parseRugCheckReport({ token: { mint }, risks: [{ level: "critical" }] }, mint).risk_level, "danger");
});
