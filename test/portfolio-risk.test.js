import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildPortfolioSnapshot,
  checkPortfolioRisk,
  initializePortfolioRiskState,
  markExternalCostAccountingIncomplete,
  recordExternalModelCost,
  validateNewPosition,
} from "../portfolio-risk.js";

const risk = {
  maxPositions: 1,
  capitalBudgetUsd: 100,
  maxCumulativeLossUsd: 20,
  maxPositionUsd: 20,
  maxConcurrentExposureUsd: 20,
  minimumLiquidReserveUsd: 15,
};
const fresh = (totalUsd, positions = []) => {
  const observed_at = new Date().toISOString();
  return {
    balance: { wallet: "DEDICATED", total_usd: totalUsd, sol: 1, sol_price: 100, observed_at },
    positions: { wallet: "DEDICATED", total_positions: positions.length, positions, observed_at },
  };
};

test("portfolio equity includes wallet, LP principal and unclaimed fees; unknown LP value blocks", () => {
  const { balance, positions } = fresh(90, [{ total_value_true_usd: 8, unclaimed_fees_true_usd: 2 }]);
  assert.equal(buildPortfolioSnapshot(balance, positions).equity_usd, 100);
  positions.positions[0].unclaimed_fees_true_usd = null;
  assert.throws(() => buildPortfolioSnapshot(balance, positions), /unknown USD value/);
});

test("the $20 loss breaker latches across checks and restart via durable state", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sunstrike-risk-"));
  const statePath = path.join(dir, "portfolio-risk.json");
  const initial = fresh(100);
  initializePortfolioRiskState({ ...initial, expectedWallet: "DEDICATED", risk, statePath });
  assert.equal(checkPortfolioRisk({ ...initial, expectedWallet: "DEDICATED", risk, statePath }).allowed, true);

  const oldMode = process.env.DRY_RUN;
  process.env.DRY_RUN = "false";
  recordExternalModelCost(2, "test-model", { expectedWallet: "DEDICATED", baselineUsd: 100, statePath });
  process.env.DRY_RUN = oldMode ?? "true";

  const loss = fresh(79);
  const first = checkPortfolioRisk({ ...loss, expectedWallet: "DEDICATED", risk, statePath });
  assert.equal(first.tripped, true);
  assert.equal(first.lpLossUsd, 21);
  const recovered = fresh(99);
  const afterRestart = checkPortfolioRisk({ ...recovered, expectedWallet: "DEDICATED", risk, statePath });
  assert.equal(afterRestart.tripped, true);
  assert.match(fs.readFileSync(statePath, "utf8"), /"tripped": true/);
  fs.rmSync(statePath);
  const missingState = checkPortfolioRisk({ ...recovered, expectedWallet: "DEDICATED", risk, statePath });
  assert.equal(missingState.allowed, false);
  assert.match(missingState.reason, /state is missing/);
  assert.equal(fs.existsSync(statePath), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("metered model costs stay outside the LP capital and loss cap", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sunstrike-risk-net-"));
  const statePath = path.join(dir, "portfolio-risk.json");
  const starting = fresh(100);
  initializePortfolioRiskState({ ...starting, expectedWallet: "DEDICATED", risk, statePath });
  const oldMode = process.env.DRY_RUN;
  process.env.DRY_RUN = "false";
  recordExternalModelCost(15, "test-model", { expectedWallet: "DEDICATED", baselineUsd: 100, statePath });
  if (oldMode == null) delete process.env.DRY_RUN;
  else process.env.DRY_RUN = oldMode;
  const result = checkPortfolioRisk({ ...starting, expectedWallet: "DEDICATED", risk, statePath });
  assert.equal(result.lpLossUsd, 0);
  assert.equal(result.allowed, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("missing risk state blocks instead of resetting loss history", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sunstrike-risk-missing-"));
  const statePath = path.join(dir, "portfolio-risk.json");
  const sample = fresh(100);
  const result = checkPortfolioRisk({ ...sample, expectedWallet: "DEDICATED", risk, statePath });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /state is missing/);
  assert.equal(fs.existsSync(statePath), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("unknown model cost accounting does not latch the LP loss breaker", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sunstrike-risk-costs-"));
  const statePath = path.join(dir, "portfolio-risk.json");
  const sample = fresh(100);
  initializePortfolioRiskState({ ...sample, expectedWallet: "DEDICATED", risk, statePath });
  const oldMode = process.env.DRY_RUN;
  process.env.DRY_RUN = "false";
  markExternalCostAccountingIncomplete("test-model", { expectedWallet: "DEDICATED", baselineUsd: 100, statePath });
  if (oldMode == null) delete process.env.DRY_RUN;
  else process.env.DRY_RUN = oldMode;

  const result = checkPortfolioRisk({ ...sample, expectedWallet: "DEDICATED", risk, statePath });
  assert.equal(result.allowed, true);
  assert.equal(result.state.tripped, false);
  assert.equal(result.lpLossUsd, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("provider costs over a month do not reduce LP capital or trip the LP breaker", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sunstrike-risk-provider-costs-"));
  const statePath = path.join(dir, "portfolio-risk.json");
  const startAt = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const initial = fresh(100);
  initial.balance.observed_at = new Date(startAt).toISOString();
  initial.positions.observed_at = new Date(startAt).toISOString();
  initializePortfolioRiskState({ ...initial, expectedWallet: "DEDICATED", risk, statePath, now: startAt });
  const legacyState = JSON.parse(fs.readFileSync(statePath, "utf8"));
  legacyState.other_api_costs_usd_per_month = 25;
  legacyState.external_costs_usd = 25;
  legacyState.external_cost_accounting_complete = false;
  legacyState.last_other_api_cost_accrual_at = new Date(startAt).toISOString();
  fs.writeFileSync(statePath, JSON.stringify(legacyState));

  const current = fresh(100);
  const result = checkPortfolioRisk({ ...current, expectedWallet: "DEDICATED", risk, statePath });
  assert.equal(result.state.tripped, false);
  assert.equal(result.lpLossUsd, 0);
  assert.equal(result.allowed, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("wrong wallet, stale snapshot and concurrent policy changes block live entries", () => {
  const sample = fresh(100);
  assert.equal(checkPortfolioRisk({ ...sample, expectedWallet: "OTHER", risk }).allowed, false);

  const stale = fresh(100);
  stale.balance.observed_at = new Date(Date.now() - 120_000).toISOString();
  assert.match(checkPortfolioRisk({ ...stale, expectedWallet: "DEDICATED", risk }).reason, /consistent recent snapshot/);

  const mismatched = fresh(100);
  mismatched.positions.wallet = "OTHER";
  assert.throws(() => buildPortfolioSnapshot(mismatched.balance, mismatched.positions), /different wallets/);

  assert.equal(checkPortfolioRisk({ ...sample, expectedWallet: "DEDICATED", risk: { ...risk, maxPositions: 2 } }).allowed, false);
});

test("USD sizing enforces per-position cap and leaves liquid reserve", () => {
  assert.equal(validateNewPosition({ amountSol: 0.2, solPrice: 100, walletUsd: 100, risk }).pass, true);
  assert.equal(validateNewPosition({ amountSol: 0.21, solPrice: 100, walletUsd: 100, risk }).pass, false);
  assert.match(validateNewPosition({ amountSol: 0.2, solPrice: 100, walletUsd: 30, risk }).reason, /liquid reserve/);
});
