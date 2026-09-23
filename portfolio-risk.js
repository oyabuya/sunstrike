import fs from "node:fs";
import path from "node:path";

const DEFAULT_STATE_PATH = path.resolve(process.env.SUNSTRIKE_PORTFOLIO_STATE_PATH || "./portfolio-risk.json");
const AVERAGE_MONTH_MS = 365.25 / 12 * 24 * 60 * 60 * 1000;

function accrueOtherApiCosts(state, now) {
  const lastAccrued = Date.parse(state.last_other_api_cost_accrual_at || "");
  if (!Number.isFinite(lastAccrued)) throw new Error("portfolio risk state has invalid provider-cost accrual time");
  if (now <= lastAccrued) return;
  state.external_costs_usd += state.other_api_costs_usd_per_month * (now - lastAccrued) / AVERAGE_MONTH_MS;
  state.last_other_api_cost_accrual_at = new Date(now).toISOString();
}

function writeState(state, statePath) {
  const target = statePath || DEFAULT_STATE_PATH;
  const directory = path.dirname(target);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  const fd = fs.openSync(temporary, "w", 0o600);
  try {
    fs.fchmodSync(fd, 0o600);
    fs.writeFileSync(fd, JSON.stringify(state, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporary, target);
}

function readState({ wallet, baselineUsd, otherApiCostsUsdPerMonth, statePath }) {
  const target = statePath || DEFAULT_STATE_PATH;
  if (!fs.existsSync(target)) {
    throw new Error("portfolio risk state is missing; initialize it from a fresh read-only wallet snapshot");
  }
  const state = JSON.parse(fs.readFileSync(target, "utf8"));
  if (state?.version !== 1 || state.wallet !== wallet || state.baseline_usd !== baselineUsd ||
      state.other_api_costs_usd_per_month !== otherApiCostsUsdPerMonth ||
      !Number.isFinite(state.external_costs_usd) || state.external_costs_usd < 0 ||
      typeof state.external_cost_accounting_complete !== "boolean" ||
      typeof state.tripped !== "boolean" || !Number.isFinite(Date.parse(state.created_at || "")) ||
      !Number.isFinite(Date.parse(state.last_other_api_cost_accrual_at || "")) ||
      state.initial_snapshot?.wallet !== wallet || !Number.isFinite(state.initial_snapshot?.equity_usd) ||
      state.initial_snapshot?.positions !== 0) {
    throw new Error("portfolio risk state is invalid or belongs to another wallet/policy");
  }
  return state;
}

export function initializePortfolioRiskState({ balance, positions, expectedWallet, risk, statePath, now = Date.now() }) {
  if (!expectedWallet || balance?.wallet !== expectedWallet) {
    throw new Error("risk state initialization wallet does not match the explicitly configured dedicated wallet");
  }
  const { capitalBudgetUsd, maxCumulativeLossUsd, maxPositionUsd, maxConcurrentExposureUsd, minimumLiquidReserveUsd, maxPositions, otherApiCostsUsdPerMonth } = risk || {};
  if (maxPositions !== 1 || ![capitalBudgetUsd, maxCumulativeLossUsd, maxPositionUsd, maxConcurrentExposureUsd, minimumLiquidReserveUsd].every(Number.isFinite) ||
      !Number.isFinite(otherApiCostsUsdPerMonth) || otherApiCostsUsdPerMonth < 0 ||
      capitalBudgetUsd <= 0 || maxCumulativeLossUsd <= 0 || maxPositionUsd <= 0 || maxConcurrentExposureUsd <= 0 || minimumLiquidReserveUsd < 0) {
    throw new Error("live USD risk policy is invalid");
  }
  const target = statePath || DEFAULT_STATE_PATH;
  if (fs.existsSync(target)) throw new Error("portfolio risk state already exists; refusing to reset or overwrite its loss history");
  const snapshot = buildPortfolioSnapshot(balance, positions, now);
  if (!Number.isFinite(otherApiCostsUsdPerMonth) || otherApiCostsUsdPerMonth < 0) {
    throw new Error("monthly non-LLM API cost budget is missing or invalid");
  }
  if (snapshot.positions !== 0) throw new Error("risk state must be initialized with no open LP positions");
  if (snapshot.equity_usd > capitalBudgetUsd + 0.01) throw new Error("initial equity exceeds the approved capital budget");
  if (capitalBudgetUsd - snapshot.equity_usd >= maxCumulativeLossUsd) {
    throw new Error("initial equity is already at or below the portfolio loss limit");
  }
  const state = {
    version: 1,
    wallet: expectedWallet,
    baseline_usd: capitalBudgetUsd,
    other_api_costs_usd_per_month: otherApiCostsUsdPerMonth,
    external_costs_usd: 0,
    external_cost_accounting_complete: true,
    tripped: false,
    created_at: new Date(now).toISOString(),
    last_other_api_cost_accrual_at: new Date(now).toISOString(),
    initial_snapshot: snapshot,
    last_snapshot: { ...snapshot, external_costs_usd: 0, net_loss_usd: Math.max(0, capitalBudgetUsd - snapshot.equity_usd) },
    last_liquidation_attempt_at: null,
  };
  writeState(state, target);
  return state;
}

export function buildPortfolioSnapshot(balance, positions, now = Date.now()) {
  if (balance?.error || !balance?.wallet || !Number.isFinite(balance.total_usd) || balance.total_usd < 0) {
    throw new Error("wallet USD value could not be verified");
  }
  if (positions?.error || !Array.isArray(positions?.positions) ||
      positions.total_positions !== positions.positions.length) {
    throw new Error("open positions could not be verified");
  }
  if (positions.wallet !== balance.wallet) {
    throw new Error("wallet and LP positions were read from different wallets");
  }
  const balanceAt = Date.parse(balance.observed_at || "");
  const positionsAt = Date.parse(positions.observed_at || "");
  if (!Number.isFinite(balanceAt) || !Number.isFinite(positionsAt) || Math.abs(balanceAt - positionsAt) > 60_000 ||
      Math.abs(now - balanceAt) > 60_000 || Math.abs(now - positionsAt) > 60_000) {
    throw new Error("wallet and LP values are not from a consistent recent snapshot");
  }

  let lpValueUsd = 0;
  for (const position of positions.positions) {
    const value = position.total_value_true_usd;
    const fees = position.unclaimed_fees_true_usd;
    if (!Number.isFinite(value) || value < 0 || !Number.isFinite(fees) || fees < 0) {
      throw new Error("one or more LP positions have unknown USD value or fees");
    }
    lpValueUsd += value + fees;
  }
  return {
    wallet: balance.wallet,
    observed_at: new Date(Math.max(balanceAt, positionsAt)).toISOString(),
    wallet_value_usd: balance.total_usd,
    lp_value_usd: lpValueUsd,
    equity_usd: balance.total_usd + lpValueUsd,
    open_exposure_usd: lpValueUsd,
    positions: positions.total_positions,
  };
}

export function checkPortfolioRisk({ balance, positions, expectedWallet, risk, statePath, now = Date.now() }) {
  if (process.env.SUNSTRIKE_EXTERNAL_COST_ACCOUNTING_BROKEN === "true") {
    return { allowed: false, tripped: true, netLossUsd: null, reason: "external cost accounting failed in this process" };
  }
  if (!expectedWallet || balance?.wallet !== expectedWallet) {
    return { allowed: false, reason: "live wallet does not match the explicitly configured dedicated wallet" };
  }
  const { capitalBudgetUsd, maxCumulativeLossUsd, maxPositionUsd, maxConcurrentExposureUsd, minimumLiquidReserveUsd, maxPositions, otherApiCostsUsdPerMonth } = risk || {};
  if (maxPositions !== 1 || ![capitalBudgetUsd, maxCumulativeLossUsd, maxPositionUsd, maxConcurrentExposureUsd, minimumLiquidReserveUsd].every(Number.isFinite) ||
      !Number.isFinite(otherApiCostsUsdPerMonth) || otherApiCostsUsdPerMonth < 0 ||
      capitalBudgetUsd <= 0 || maxCumulativeLossUsd <= 0 || maxPositionUsd <= 0 || maxConcurrentExposureUsd <= 0 || minimumLiquidReserveUsd < 0) {
    return { allowed: false, reason: "live USD risk policy is invalid" };
  }

  let snapshot;
  let state;
  try {
    snapshot = buildPortfolioSnapshot(balance, positions, now);
    state = readState({ wallet: expectedWallet, baselineUsd: capitalBudgetUsd, otherApiCostsUsdPerMonth, statePath });
    accrueOtherApiCosts(state, now);
  } catch (error) {
    return { allowed: false, reason: error.message };
  }
  if (state.external_cost_accounting_complete !== true) {
    if (!state.tripped) {
      state.tripped = true;
      state.tripped_at = new Date(now).toISOString();
      state.trip_reason = "external model/API costs could not be reconciled";
    }
    state.last_snapshot = { ...snapshot, external_costs_usd: state.external_costs_usd, net_loss_usd: null };
    writeState(state, statePath);
    return { allowed: false, tripped: true, snapshot, netLossUsd: null, state, reason: "external model/API costs could not be reconciled" };
  }

  const netLossUsd = Math.max(0, capitalBudgetUsd + state.external_costs_usd - snapshot.equity_usd);
  if (!state.tripped && netLossUsd >= maxCumulativeLossUsd) {
    state.tripped = true;
    state.tripped_at = new Date(now).toISOString();
    state.trip_reason = "cumulative portfolio loss reached the configured limit";
  }
  state.last_snapshot = { ...snapshot, external_costs_usd: state.external_costs_usd, net_loss_usd: netLossUsd };
  writeState(state, statePath);

  if (state.tripped) {
    return { allowed: false, tripped: true, snapshot, netLossUsd, state, reason: "portfolio loss circuit breaker is latched" };
  }
  if (snapshot.equity_usd > capitalBudgetUsd + 0.01) {
    return { allowed: false, snapshot, netLossUsd, reason: "portfolio equity exceeds the approved $100 capital budget" };
  }
  if (snapshot.open_exposure_usd > maxConcurrentExposureUsd + 0.01) {
    return { allowed: false, snapshot, netLossUsd, reason: "current LP exposure exceeds the approved concurrent exposure limit" };
  }
  return { allowed: true, snapshot, netLossUsd, state };
}

export function validateNewPosition({ amountSol, solPrice, walletUsd, currentExposureUsd = 0, risk }) {
  const { maxPositionUsd, maxConcurrentExposureUsd, minimumLiquidReserveUsd } = risk || {};
  if (!Number.isFinite(amountSol) || amountSol <= 0 || !Number.isFinite(solPrice) || solPrice <= 0 ||
      !Number.isFinite(walletUsd) || walletUsd < 0 || !Number.isFinite(currentExposureUsd) || currentExposureUsd < 0) {
    return { pass: false, reason: "USD position sizing data is missing or invalid" };
  }
  const amountUsd = amountSol * solPrice;
  if (amountUsd > maxPositionUsd + 0.01) return { pass: false, reason: `position size $${amountUsd.toFixed(2)} exceeds the $${maxPositionUsd} per-position limit` };
  if (currentExposureUsd + amountUsd > maxConcurrentExposureUsd + 0.01) {
    return { pass: false, reason: `position would exceed the $${maxConcurrentExposureUsd} concurrent exposure limit` };
  }
  if (walletUsd - amountUsd < minimumLiquidReserveUsd) {
    return { pass: false, reason: `entry would leave less than the $${minimumLiquidReserveUsd} liquid reserve` };
  }
  return { pass: true, amountUsd };
}

export function recordExternalModelCost(costUsd, model, { expectedWallet = process.env.SUNSTRIKE_LIVE_WALLET, baselineUsd = 100, otherApiCostsUsdPerMonth = Number(process.env.SUNSTRIKE_OTHER_API_COSTS_USD_PER_MONTH), statePath } = {}) {
  if (process.env.DRY_RUN === "true") return;
  const target = statePath || DEFAULT_STATE_PATH;
  if (!expectedWallet || !Number.isFinite(costUsd) || costUsd < 0) {
    markExternalCostAccountingIncomplete(model, { expectedWallet, baselineUsd, statePath: target });
    return;
  }
  const state = readState({ wallet: expectedWallet, baselineUsd, otherApiCostsUsdPerMonth, statePath: target });
  accrueOtherApiCosts(state, Date.now());
  state.external_costs_usd += costUsd;
  state.last_external_cost = { model, amount_usd: costUsd, at: new Date().toISOString() };
  state.external_cost_accounting_complete = state.external_cost_accounting_complete !== false;
  writeState(state, target);
}

export function markExternalCostAccountingIncomplete(model, { expectedWallet = process.env.SUNSTRIKE_LIVE_WALLET, baselineUsd = 100, otherApiCostsUsdPerMonth = Number(process.env.SUNSTRIKE_OTHER_API_COSTS_USD_PER_MONTH), statePath } = {}) {
  if (process.env.DRY_RUN === "true") return;
  if (!expectedWallet) return;
  const target = statePath || DEFAULT_STATE_PATH;
  const state = readState({ wallet: expectedWallet, baselineUsd, otherApiCostsUsdPerMonth, statePath: target });
  accrueOtherApiCosts(state, Date.now());
  state.external_cost_accounting_complete = false;
  state.unmetered_model = model || "unknown";
  state.last_external_cost_at = new Date().toISOString();
  writeState(state, target);
}

export function markLiquidationAttempt({ statePath, at = new Date().toISOString() } = {}) {
  const target = statePath || DEFAULT_STATE_PATH;
  if (!fs.existsSync(target)) return;
  const state = JSON.parse(fs.readFileSync(target, "utf8"));
  state.last_liquidation_attempt_at = at;
  writeState(state, target);
}
