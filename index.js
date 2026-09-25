import { switchRuntimeMode } from "./runtime-mode.js";
import "./load-env.js";
import { assertScreeningInputs } from "./screening-readiness.js";
import { scheduleInterval } from "./interval-task.js";
import cron from "node-cron";
import readline from "readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
import { agentLoop } from "./agent.js";
import { log, logAction } from "./logger.js";
import { getMyPositions, getActiveBin } from "./tools/dlmm.js";
import { getWalletBalances } from "./tools/wallet.js";
import { getTopCandidates, getVolumeTrend } from "./tools/screening.js";
import { config, reloadScreeningThresholds } from "./config.js";
import { chooseDeposit } from "./deposit-policy.js";
import { evolveThresholds, getCampaignPerformance, getPerformanceSummary } from "./lessons.js";
import { registerCronRestarter, executeTool } from "./tools/executor.js";
import { startPolling, stopPolling, sendMessage, sendHTML, notifyOutOfRange, isEnabled as telegramEnabled, createLiveMessage } from "./telegram.js";
import { parseTelegramCommand, telegramHelp, telegramReplyKeyboard } from "./telegram-commands.js";
import { formatWalletTokenMessages } from "./telegram-wallet-view.js";
import { generateBriefing } from "./briefing.js";
import { getLastBriefingDate, setLastBriefingDate, getTrackedPosition, setPositionInstruction, updatePnlAndCheckExits, queuePeakConfirmation, resolvePendingPeak, queueTrailingDropConfirmation, resolvePendingTrailingDrop } from "./state.js";
import { getActiveStrategy } from "./strategy-library.js";
import { recordPositionSnapshot, recallForPool, addPoolNote } from "./pool-memory.js";
import { checkSmartWalletsOnPool } from "./smart-wallets.js";
import { getTokenNarrative, getTokenInfo } from "./tools/token.js";
import { getPoolDetail } from "./tools/screening.js";
import { activityPerFiveMinutes, computeEvilPandaDeployPlan, formatEvilPandaDeployPlan } from "./evilpanda-policy.js";
import { estimateNetFeeScenario } from "./candidate-quality.js";
import { readOpenTokenStatus } from "./open-token-status.js";
import { assessEmergencyPriceDrawdown } from "./emergency-exit-shadow.js";
import { assessBelowRangeExit } from "./position-exit-policy.js";
import { recordJevShadow } from "./tools/jev-shadow.js";
import { scanJevMarket } from "./tools/jev-market.js";
import { checkPortfolioRisk } from "./portfolio-risk.js";
import { evaluateTokenRisk } from "./token-risk-policy.js";

log("startup", "DLMM LP Agent starting...");
log("startup", `Mode: ${process.env.DRY_RUN === "true" ? "DRY RUN" : "LIVE"}`);
log("startup", `Models: management=${config.llm.managementModel}, screening=${config.llm.screeningModel}, general=${config.llm.generalModel}`);

// ═══════════════════════════════════════════
//  CYCLE TIMERS
// ═══════════════════════════════════════════
const timers = {
  managementLastRun: null,
  screeningLastRun: null,
};

function nextRunIn(lastRun, intervalMin) {
  if (!lastRun) return intervalMin * 60;
  const elapsed = (Date.now() - lastRun) / 1000;
  return Math.max(0, intervalMin * 60 - elapsed);
}

function formatCountdown(seconds) {
  if (seconds <= 0) return "now";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function buildPrompt() {
  const mgmt = formatCountdown(nextRunIn(timers.managementLastRun, config.schedule.managementIntervalMin));
  const scrn = formatCountdown(nextRunIn(timers.screeningLastRun, config.schedule.screeningIntervalMin));
  return `[manage: ${mgmt} | screen: ${scrn}]\n> `;
}

// ═══════════════════════════════════════════
//  CRON DEFINITIONS
// ═══════════════════════════════════════════
let _cronTasks = [];
let _modeChanging = false;
let _pnlPollBusy = false;
const commandStartedAt = Math.floor(Date.now() / 1000);
let _managementBusy = false; // prevents overlapping management cycles
let _screeningBusy = false;  // prevents overlapping screening cycles
let _healthCheckBusy = false; // prevents overlapping health check cycles
let _jevMarketBusy = false;
let _screeningLastTriggered = 0; // epoch ms — prevents management from spamming screening
let _pollTriggeredAt = 0; // epoch ms — cooldown for poller-triggered management
const _peakConfirmTimers = new Map();
const _trailingDropConfirmTimers = new Map();
const _oorUpAttemptAt = new Map(); // positionAddress → last above-range close attempt
const _openTokenStatusCache = new Map(); // mint → { at, status }
const _emergencyShadowByPosition = new Map(); // position → { firstSeenAt, logged, notified, lastNotifyAttemptAt }
const _belowRangeCheckCache = new Map(); // positionAddress → { at, assessment }
let _lastRiskReadFailureAt = 0;
const TRAILING_PEAK_CONFIRM_DELAY_MS = 15_000;
const TRAILING_PEAK_CONFIRM_TOLERANCE = 0.85;
const TRAILING_DROP_CONFIRM_DELAY_MS = 15_000;
const TRAILING_DROP_CONFIRM_TOLERANCE_PCT = 1.0;

function computeAdaptiveTrailingDropPct(position, tracked) {
  const fee = Number(position?.fee_per_tvl_24h ?? tracked?.initial_fee_tvl_24h ?? tracked?.fee_tvl_ratio);
  const base = config.management.trailingDropPct;
  if (!Number.isFinite(fee)) return base;
  if (fee >= (config.management.highYieldTrailingFeePerTvl24h ?? 20)) {
    return Math.max(base ?? 0, config.management.highYieldTrailingDropPct ?? 2.0);
  }
  return base;
}

function computeAdaptiveOorWaitMinutes(position, tracked) {
  const fee = Number(position?.fee_per_tvl_24h ?? tracked?.initial_fee_tvl_24h ?? tracked?.fee_tvl_ratio);
  const base = config.management.outOfRangeWaitMinutes;
  if (!Number.isFinite(fee)) return base;
  if (fee >= (config.management.highYieldOorFeePerTvl24h ?? 15)) {
    return Math.max(base ?? 0, config.management.highYieldOorWaitMinutes ?? 90);
  }
  return base;
}

/** Strip <think>...</think> reasoning blocks that some models leak into output */
function stripThink(text) {
  if (!text) return text;
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function sanitizeUntrustedPromptText(text, maxLen = 500) {
  if (!text) return null;
  const cleaned = String(text)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[<>`]/g, "")
    .trim()
    .slice(0, maxLen);
  return cleaned ? JSON.stringify(cleaned) : null;
}

function schedulePeakConfirmation(positionAddress) {
  if (!positionAddress || _peakConfirmTimers.has(positionAddress)) return;

  const timer = setTimeout(async () => {
    _peakConfirmTimers.delete(positionAddress);
    try {
      const result = await getMyPositions({ force: true, silent: true }).catch(() => null);
      const position = result?.positions?.find((p) => p.position === positionAddress);
      resolvePendingPeak(positionAddress, position?.pnl_pct ?? null, TRAILING_PEAK_CONFIRM_TOLERANCE);
    } catch (error) {
      log("state_warn", `Peak confirmation failed for ${positionAddress}: ${error.message}`);
    }
  }, TRAILING_PEAK_CONFIRM_DELAY_MS);

  _peakConfirmTimers.set(positionAddress, timer);
}

function scheduleTrailingDropConfirmation(positionAddress, trailingDropPct) {
  if (!positionAddress || _trailingDropConfirmTimers.has(positionAddress)) return;

  const timer = setTimeout(async () => {
    _trailingDropConfirmTimers.delete(positionAddress);
    try {
      const result = await getMyPositions({ force: true, silent: true }).catch(() => null);
      const position = result?.positions?.find((p) => p.position === positionAddress);
      const resolved = resolvePendingTrailingDrop(
        positionAddress,
        position?.pnl_pct ?? null,
        trailingDropPct ?? config.management.trailingDropPct,
        TRAILING_DROP_CONFIRM_TOLERANCE_PCT,
      );
      if (resolved?.confirmed) {
        log("state", `[Trailing recheck] Confirmed trailing exit for ${positionAddress} — triggering management`);
        runManagementCycle({ silent: true }).catch((e) => log("cron_error", `Trailing recheck management failed: ${e.message}`));
      }
    } catch (error) {
      log("state_warn", `Trailing drop confirmation failed for ${positionAddress}: ${error.message}`);
    }
  }, TRAILING_DROP_CONFIRM_DELAY_MS);

  _trailingDropConfirmTimers.set(positionAddress, timer);
}

async function runBriefing() {
  log("cron", "Starting morning briefing");
  try {
    const briefing = await generateBriefing();
    if (telegramEnabled()) {
      await sendHTML(briefing);
    }
    setLastBriefingDate();
  } catch (error) {
    log("cron_error", `Morning briefing failed: ${error.message}`);
  }
}

/**
 * If the agent restarted after the 1:00 AM UTC cron window,
 * fire the briefing immediately on startup so it's never skipped.
 */
async function maybeRunMissedBriefing() {
  const todayUtc = new Date().toISOString().slice(0, 10);
  const lastSent = getLastBriefingDate();

  if (lastSent === todayUtc) return; // already sent today

  // Only fire if it's past the scheduled time (1:00 AM UTC)
  const nowUtc = new Date();
  const briefingHourUtc = 1;
  if (nowUtc.getUTCHours() < briefingHourUtc) return; // too early, cron will handle it

  log("cron", `Missed briefing detected (last sent: ${lastSent || "never"}) — sending now`);
  await runBriefing();
}

function stopCronJobs() {
  for (const task of _cronTasks) task.stop();
  if (_cronTasks._pnlPollInterval) clearInterval(_cronTasks._pnlPollInterval);
  _cronTasks = [];
}

async function refreshJevMarket() {
  if (_jevMarketBusy) return;
  _jevMarketBusy = true;
  try {
    await scanJevMarket();
  } finally {
    _jevMarketBusy = false;
  }
}

export async function runManagementCycle({ silent = false } = {}) {
  if (_modeChanging || _managementBusy) return null;
  _managementBusy = true;
  timers.managementLastRun = Date.now();
  log("cron", "Starting management cycle");
  let mgmtReport = null;
  let positions = [];
  let liveMessage = null;
  const screeningCooldownMs = 5 * 60 * 1000;

  try {
    if (!silent && telegramEnabled()) {
      liveMessage = await createLiveMessage("🔄 Management Cycle", "Evaluating positions...");
    }
    const livePositions = await getMyPositions({ force: true }).catch(() => null);
    positions = livePositions?.positions || [];

    if (positions.length === 0) {
      const screenDue = Date.now() - _screeningLastTriggered >= config.schedule.screeningIntervalMin * 60_000;
      mgmtReport = screenDue ? "No open positions. Triggering screening cycle." : "No open positions. Screening is on schedule.";
      if (screenDue) {
        log("cron", "No open positions — triggering due screening cycle");
        runScreeningCycle().catch((e) => log("cron_error", `Triggered screening failed: ${e.message}`));
      }
      return mgmtReport;
    }

    // Snapshot + load pool memory
    const positionData = positions.map((p) => {
      recordPositionSnapshot(p.pool, p);
      return { ...p, recall: recallForPool(p.pool) };
    });

    // Pre-fetch EvilPanda chart exit signals (RSI(2)+BB+MACD confluence) for all positions
    const chartSignalMap = new Map();
    if (process.env.GMGN_API_KEY) {
      try {
        const { getExitSignal } = await import("./tools/ohlcv.js");
        const signalResults = await Promise.allSettled(
          positionData.map(p => p.base_mint ? getExitSignal(p.base_mint) : Promise.resolve(null))
        );
        for (let i = 0; i < positionData.length; i++) {
          const r = signalResults[i];
          if (r.status === "fulfilled" && r.value) {
            chartSignalMap.set(positionData[i].position, r.value);
          }
        }
      } catch { /* chart signals are optional — never block management */ }
    }

    // JS trailing TP check
    const exitMap = new Map();
    for (const p of positionData) {
      if (!p.pnl_pct_suspicious && queuePeakConfirmation(p.position, p.pnl_pct)) {
        schedulePeakConfirmation(p.position);
      }
      const exit = updatePnlAndCheckExits(p.position, p, config.management);
      if (exit) {
        if (exit.action === "TRAILING_TP" && exit.needs_confirmation) {
          const trailingDropPctUsed = exit.trailing_drop_pct_used ?? computeAdaptiveTrailingDropPct(p, getTrackedPosition(p.position));
          if (queueTrailingDropConfirmation(p.position, exit.peak_pnl_pct, exit.current_pnl_pct, trailingDropPctUsed)) {
            scheduleTrailingDropConfirmation(p.position, trailingDropPctUsed);
          }
          continue;
        }
        exitMap.set(p.position, exit.reason);
        log("state", `Exit alert for ${p.pair}: ${exit.reason}`);
      }
    }

    // ── Deterministic rule checks (no LLM) ──────────────────────────
    // action: CLOSE | CLAIM | STAY | INSTRUCTION (needs LLM)
    const actionMap = new Map();
    for (const p of positionData) {
      // Hard exit — highest priority
      if (exitMap.has(p.position)) {
        actionMap.set(p.position, { action: "CLOSE", rule: "exit", reason: exitMap.get(p.position) });
        continue;
      }
      // Instruction-set — pass to LLM, can't parse in JS
      if (p.instruction) {
        actionMap.set(p.position, { action: "INSTRUCTION" });
        continue;
      }

      // Above-range positions stop earning fees: close on the first verified read.
      if (p.active_bin != null && p.upper_bin != null &&
          p.active_bin > p.upper_bin) {
        actionMap.set(p.position, { action: "CLOSE", rule: 3, reason: "above range" });
        continue;
      }
      // Claim rule (optional; disabled when minClaimAmount=null)
      if (config.management.minClaimAmount != null &&
          (p.unclaimed_fees_usd ?? 0) >= config.management.minClaimAmount) {
        actionMap.set(p.position, { action: "CLAIM" });
        continue;
      }
      actionMap.set(p.position, { action: "STAY" });
    }

    // ── Build JS report ──────────────────────────────────────────────
    const totalValue = positionData.reduce((s, p) => s + (p.total_value_usd ?? 0), 0);
    const totalUnclaimed = positionData.reduce((s, p) => s + (p.unclaimed_fees_usd ?? 0), 0);

    const reportLines = positionData.map((p) => {
      const act = actionMap.get(p.position);
      const inRange = p.in_range ? "🟢 IN" : `🔴 OOR ${p.minutes_out_of_range ?? 0}m`;
      const val = config.management.solMode ? `◎${p.total_value_usd ?? "?"}` : `$${p.total_value_usd ?? "?"}`;
      const unclaimed = config.management.solMode ? `◎${p.unclaimed_fees_usd ?? "?"}` : `$${p.unclaimed_fees_usd ?? "?"}`;
      const statusLabel = act.action === "INSTRUCTION" ? "HOLD (instruction)" : act.action;
      let line = `**${p.pair}** | Age: ${p.age_minutes ?? "?"}m | Val: ${val} | Unclaimed: ${unclaimed} | PnL: ${p.pnl_pct ?? "?"}% | Yield: ${p.fee_per_tvl_24h ?? "?"}% | ${inRange} | ${statusLabel}`;
      if (p.instruction) line += `\nNote: "${p.instruction}"`;
      if (act.action === "CLOSE" && act.rule === "exit") line += `\n⚡ Trailing TP: ${act.reason}`;
      if (act.action === "CLOSE" && act.rule && act.rule !== "exit") line += `\nRule ${act.rule}: ${act.reason}`;
      if (act.action === "CLAIM") line += `\n→ Claiming fees`;
      return line;
    });

    const needsAction = [...actionMap.values()].filter(a => a.action !== "STAY");
    const actionSummary = needsAction.length > 0
      ? needsAction.map(a => a.action === "INSTRUCTION" ? "EVAL instruction" : `${a.action}${a.reason ? ` (${a.reason})` : ""}`).join(", ")
      : "no action";

    const cur = config.management.solMode ? "◎" : "$";
    mgmtReport = reportLines.join("\n\n") +
      `\n\nSummary: 💼 ${positions.length} positions | ${cur}${totalValue.toFixed(4)} | fees: ${cur}${totalUnclaimed.toFixed(4)} | ${actionSummary}`;

    // ── Call LLM only if action needed ──────────────────────────────
    const actionPositions = positionData.filter(p => {
      const a = actionMap.get(p.position);
      return a.action !== "STAY";
    });

    if (actionPositions.length > 0) {
      log("cron", `Management: ${actionPositions.length} action(s) needed — invoking LLM [model: ${config.llm.managementModel}]`);

      const actionBlocks = actionPositions.map((p) => {
        const act = actionMap.get(p.position);
        const chartSig = chartSignalMap.get(p.position);
        return [
          `POSITION: ${p.pair} (${p.position})`,
          `  pool: ${p.pool}`,
          `  action: ${act.action}${act.rule && act.rule !== "exit" ? ` — Rule ${act.rule}: ${act.reason}` : ""}${act.rule === "exit" ? ` — ⚡ Trailing TP: ${act.reason}` : ""}`,
          `  pnl_pct: ${p.pnl_pct}% | unclaimed_fees: ${cur}${p.unclaimed_fees_usd} | value: ${cur}${p.total_value_usd} | fee_per_tvl_24h: ${p.fee_per_tvl_24h ?? "?"}%`,
          `  bins: lower=${p.lower_bin} upper=${p.upper_bin} active=${p.active_bin} | oor_minutes: ${p.minutes_out_of_range ?? 0}`,
          p.instruction ? `  instruction: "${p.instruction}"` : null,
          chartSig ? `  chart(15m): candle=${chartSig.is_green_candle ? "🟢GREEN" : "🔴RED"}(${chartSig.candle_body_pct > 0 ? "+" : ""}${chartSig.candle_body_pct}%) rsi2=${chartSig.rsi2} bb_above=${chartSig.bb_above_upper} macd_green=${chartSig.macd_first_green}${chartSig.bounce_pattern ? " BOUNCE_PATTERN" : ""}${chartSig.exit_signal ? " → EXIT WINDOW" : ""}` : null,
          chartSig?.rsi_history ? `  rsi_history(8): [${chartSig.rsi_history.join(", ")}] ${chartSig.rsi_history[chartSig.rsi_history.length - 1] > chartSig.rsi_history[0] ? "↗ rising" : chartSig.rsi_history[chartSig.rsi_history.length - 1] < chartSig.rsi_history[0] ? "↘ falling" : "→ flat"}` : null,
          chartSig?.last_candles ? `  candles(8): ${chartSig.last_candles.join(" ")}` : null,
          chartSig?.volume_trend ? `  volume_trend: ${chartSig.volume_trend}${chartSig.bb_distance_pct != null ? ` | dist_to_BB_lower: ${chartSig.bb_distance_pct}%` : ""}` : null,
          chartSig?.macd_trajectory ? `  macd_hist(5): [${chartSig.macd_trajectory.join(", ")}]` : null,
          chartSig?.dump_phase ? `  phase: ${chartSig.dump_phase} — ${chartSig.phase_description}` : null,
        ].filter(Boolean).join("\n");
      }).join("\n\n");

      const { content } = await agentLoop(`
MANAGEMENT ACTION REQUIRED — ${actionPositions.length} position(s)

${actionBlocks}

RULES:
- CLOSE: call close_position only — it handles fee claiming internally, do NOT call claim_fees first
- CLAIM: call claim_fees with position address
- INSTRUCTION: evaluate the instruction condition. If met → close_position. If not → HOLD, do nothing.
- ⚡ exit alerts: close immediately, no exceptions

Execute the required actions. Do NOT re-evaluate CLOSE/CLAIM — rules already applied. Just execute.
After executing, write a brief one-line result per position.
      `, config.llm.maxStepsManager, [], "MANAGER", config.llm.managementModel, config.llm.maxTokens, {
        onToolStart: async ({ name }) => { await liveMessage?.toolStart(name); },
        onToolFinish: async ({ name, result, success }) => { await liveMessage?.toolFinish(name, result, success); },
      });

      mgmtReport += `\n\n${content}`;
    } else {
      log("cron", "Management: all positions STAY — skipping LLM");
      await liveMessage?.note("No tool actions needed.");
    }

    // Trigger screening after management
    const afterPositions = await getMyPositions({ force: true }).catch(() => null);
    const afterCount = afterPositions?.positions?.length ?? 0;
    if (afterCount < config.risk.maxPositions && Date.now() - _screeningLastTriggered > screeningCooldownMs) {
      log("cron", `Post-management: ${afterCount}/${config.risk.maxPositions} positions — triggering screening`);
      runScreeningCycle().catch((e) => log("cron_error", `Triggered screening failed: ${e.message}`));
    }
  } catch (error) {
    log("cron_error", `Management cycle failed: ${error.message}`);
    mgmtReport = `Management cycle failed: ${error.message}`;
  } finally {
    _managementBusy = false;
    if (!silent && telegramEnabled()) {
      if (mgmtReport) {
        if (liveMessage) await liveMessage.finalize(stripThink(mgmtReport)).catch(() => {});
        else sendMessage(`🔄 Management Cycle\n\n${stripThink(mgmtReport)}`).catch(() => { });
      }
      for (const p of positions) {
        const tracked = getTrackedPosition(p.position);
        const adaptiveOorWaitMinutes = computeAdaptiveOorWaitMinutes(p, tracked);
        if (!p.in_range && p.minutes_out_of_range >= adaptiveOorWaitMinutes) {
          notifyOutOfRange({ pair: p.pair, minutesOOR: p.minutes_out_of_range }).catch(() => { });
        }
      }
    }
  }
  return mgmtReport;
}

export async function runScreeningCycle({ silent = false } = {}) {
  if (_modeChanging || _screeningBusy) {
    log("cron", "Screening skipped — previous cycle still running");
    return null;
  }
  _screeningBusy = true; // set immediately — prevents TOCTOU race with concurrent callers
  _screeningLastTriggered = Date.now();
  const shadowCycleId = `screen-${Date.now()}`;

  // Hard guards — don't even run the agent if preconditions aren't met
  let prePositions, preBalance;
  let deployAmount = 0;
  let deposit = null;
  let liveMessage = null;
  let screenReport = null;
  try {
    [prePositions, preBalance] = await Promise.all([getMyPositions({ force: true }), getWalletBalances()]);
    assertScreeningInputs(prePositions, preBalance);
    deposit = chooseDeposit(preBalance);
    deployAmount = deposit?.amount ?? 0;
    const isDryRun = process.env.DRY_RUN === "true";
    if (!isDryRun) {
      const riskStatus = checkPortfolioRisk({
        balance: preBalance,
        positions: prePositions,
        expectedWallet: process.env.SUNSTRIKE_LIVE_WALLET,
        risk: config.risk,
      });
      if (!riskStatus.allowed) {
        log("portfolio_risk", `Screening blocked: ${riskStatus.reason}${riskStatus.lpLossUsd != null ? `; LP loss $${riskStatus.lpLossUsd.toFixed(2)}` : ""}`);
        screenReport = `Screening blocked by portfolio risk policy: ${riskStatus.reason}.`;
        _screeningBusy = false;
        return screenReport;
      }
    }
    if (prePositions.total_positions >= config.risk.maxPositions) {
      log("cron", `Screening skipped — max positions reached (${prePositions.total_positions}/${config.risk.maxPositions})`);
      if (isDryRun) {
        const observed = await getTopCandidates({ limit: 10, cycleId: shadowCycleId, quote_mint: deposit?.mint });
        logAction({ tool: "screening_decision", args: { cycle_id: shadowCycleId }, result: {
          candidates: observed.candidates.map((pool) => ({ pool_address: pool.pool, score: pool.candidate_score })),
          choices: [], no_deploy: true, jev_status: "skipped_position_limit", luna_model: null,
          decision_status: "position_limit_observation",
        }, success: true });
        screenReport = `Screening observation: ${observed.total_eligible} preliminary candidate(s) from ${observed.total_screened} pools; deploy skipped — max positions reached (${prePositions.total_positions}/${config.risk.maxPositions}).`;
      } else {
        if (process.env.JEV_SHADOW_ENABLED === "true") log("screening", "Jev shadow skipped — position limit reached");
        screenReport = `Screening skipped — max positions reached (${prePositions.total_positions}/${config.risk.maxPositions}).`;
      }
      _screeningBusy = false;
      return screenReport;
    }
    if (!deposit) {
      screenReport = 'Screening blocked: need 0.2 SOL or 20 USDC plus SOL transaction reserve.';
      log("portfolio_risk", screenReport);
      _screeningBusy = false;
      return screenReport;
    }
    if (!isDryRun && preBalance.sol < deposit.requiredSol) {
      log("cron", `Screening skipped — insufficient SOL transaction reserve (${preBalance.sol.toFixed(3)} < ${deposit.requiredSol.toFixed(3)})`);
      screenReport = `Screening skipped — insufficient SOL transaction reserve (${preBalance.sol.toFixed(3)} < ${deposit.requiredSol.toFixed(3)}).`;
      _screeningBusy = false;
      return screenReport;
    }
  } catch (e) {
    log("cron_error", `Screening pre-check failed: ${e.message}`);
    screenReport = `Screening pre-check failed: ${e.message}`;
    _screeningBusy = false;
    return screenReport;
  }
  if (!silent && telegramEnabled()) {
    liveMessage = await createLiveMessage("🔍 Screening Cycle", "Scanning candidates...");
  }
  timers.screeningLastRun = Date.now();
  log("cron", `Starting screening cycle [model: ${config.llm.screeningModel}]`);
  try {
    // Reuse pre-fetched balance — no extra RPC call needed
    const currentBalance = preBalance;
    log("cron", `Computed deploy amount: ${deployAmount} ${deposit.symbol} (~$${deposit.amountUsd.toFixed(2)}; wallet: $${currentBalance.total_usd.toFixed(2)})`);

    // Load active strategy for display only. EvilPanda runtime policy computes deploy shape.
    const activeStrategy = getActiveStrategy();
    const strategyBlock = activeStrategy
      ? `ACTIVE STRATEGY (advisory): ${activeStrategy.name} — LP: ${activeStrategy.lp_strategy} | best for: ${activeStrategy.best_for}`
      : `No active strategy — EvilPanda runtime policy will compute the deploy shape.`;

    async function hydrateCandidates(rawPools, { label = "candidates" } = {}) {
      const hydrated = [];
      for (const rawPool of rawPools) {
        const pool = rawPool?.pool ? rawPool : await getPoolDetail({ pool_address: rawPool.pool_address || rawPool.pool }).catch(() => rawPool);
        const poolAddress = pool?.pool || pool?.pool_address || rawPool?.pool_address || rawPool?.pool;
        const mint = pool?.base?.mint || rawPool?.base?.mint || rawPool?.base_mint || null;
        const [smartWallets, narrative, tokenInfo] = await Promise.allSettled([
          poolAddress ? checkSmartWalletsOnPool({ pool_address: poolAddress }) : Promise.resolve(null),
          mint ? getTokenNarrative({ mint }) : Promise.resolve(null),
          mint ? getTokenInfo({ query: mint }) : Promise.resolve(null),
        ]);
        hydrated.push({
          pool,
          sw: smartWallets.status === "fulfilled" ? smartWallets.value : null,
          n: narrative.status === "fulfilled" ? narrative.value : null,
          ti: tokenInfo.status === "fulfilled"
            ? tokenInfo.value?.results?.find((item) => item.mint === mint) || null
            : null,
          mem: poolAddress ? recallForPool(poolAddress) : null,
          source: label,
        });
        await new Promise((r) => setTimeout(r, 150));
      }
      return hydrated;
    }

    // Discovery failures are failures, not evidence of an empty market.
    const topCandidates = await getTopCandidates({ limit: 10, cycleId: shadowCycleId, quote_mint: deposit.mint });
    let candidatePools = (topCandidates?.candidates || topCandidates?.pools || []).slice(0, 10);
    let earlyFilteredExamples = topCandidates?.filtered_examples || [];
    let candidateSource = topCandidates?.screening_profile || "strict";

    const allCandidates = await hydrateCandidates(candidatePools, { label: candidateSource });

    // Hard filters after token recon — block launchpads and excessive Jupiter bot holders
    const filteredOut = [];
    const applyPostReconFilters = (items) => items.filter(({ pool, ti }) => {
      const launchpad = ti?.launchpad ?? null;
      if (launchpad && config.screening.allowedLaunchpads?.length > 0 && !config.screening.allowedLaunchpads.includes(launchpad)) {
        log("screening", `Skipping ${pool.name} — launchpad ${launchpad} not in allow-list`);
        filteredOut.push({ name: pool.name, pool: pool.pool, mint: pool.base?.mint, reason: `launchpad ${launchpad} not in allow-list` });
        return false;
      }
      if (launchpad && config.screening.blockedLaunchpads.includes(launchpad)) {
        log("screening", `Skipping ${pool.name} — blocked launchpad (${launchpad})`);
        filteredOut.push({ name: pool.name, pool: pool.pool, mint: pool.base?.mint, reason: `blocked launchpad (${launchpad})` });
        return false;
      }
      if (config.screening.antiRugStrict) {
        const risk = evaluateTokenRisk({
          expectedMint: pool.base?.mint,
          poolMint: pool.base?.mint,
          tokenInfo: ti,
          okxAdvanced: pool.okx_advanced,
          okxRisk: pool.okx_risk,
          gmgnSecurity: pool.gmgn_security,
          gmgnInfo: pool.gmgn_info,
          screening: config.screening,
        });
        if (!risk.pass) {
          log("screening", `Post-recon risk gate: dropped ${pool.name} — ${risk.reason}`);
          filteredOut.push({ name: pool.name, pool: pool.pool, mint: pool.base?.mint, reason: risk.reason });
          return false;
        }
        pool.risk_metrics = risk.metrics;
      }
      return true;
    });
    let passing = applyPostReconFilters(allCandidates).filter(({ pool }) => pool.quote?.mint === deposit.mint);
    passing.sort((a, b) => {
      const estimate = (item) => estimateNetFeeScenario({ pool: item.pool, amountUsd: deposit.amountUsd, solPrice: currentBalance.sol_price });
      return (estimate(b)?.net_before_inventory_usd ?? -Infinity) - (estimate(a)?.net_before_inventory_usd ?? -Infinity);
    });

    logAction({ tool: "screening_candidates", args: { cycle_id: shadowCycleId }, result: {
      discovery: topCandidates.discovery,
      profile: candidateSource,
      activity_policy: topCandidates.activity_policy,
      rejected: [...(topCandidates.rejected || earlyFilteredExamples), ...filteredOut],
      shortlisted: passing.map(({ pool, ti }) => ({
        pool_address: pool.pool,
        name: pool.name,
        base_mint: pool.base?.mint ?? null,
        screening_score: pool.candidate_score ?? null,
        timeframe: pool.discovery_timeframe ?? null,
        fee_tvl_5m_pct: pool.activity_metrics?.fee_tvl_1h_per_5m_pct ?? activityPerFiveMinutes(pool.fee_active_tvl_ratio, pool.discovery_timeframe),
        volume_5m_usd: pool.activity_metrics?.volume_1h_per_5m_usd ?? activityPerFiveMinutes(pool.volume_window, pool.discovery_timeframe),
        activity_metrics: pool.activity_metrics ?? null,
        activity_cautions: pool.activity_cautions ?? [],
        active_tvl_usd: pool.active_tvl ?? null,
        organic_score: ti?.organic_score ?? pool.organic_score ?? null,
        token_age_hours: pool.token_age_hours ?? null,
        top10_holders_pct: ti?.audit?.top_holders_pct ?? null,
        bot_holders_pct: ti?.audit?.bot_holders_pct ?? null,
        net_scenario: estimateNetFeeScenario({ pool, amountUsd: deposit.amountUsd, solPrice: currentBalance.sol_price }),
      })),
    }, success: true });

    if (passing.length === 0) {
      if (process.env.JEV_SHADOW_ENABLED === "true") log("screening", "Jev shadow skipped — no candidates passed screening");
      logAction({ tool: "screening_decision", args: { cycle_id: shadowCycleId }, result: {
        candidates: [], choices: [], no_deploy: true,
        jev_status: "skipped_no_candidates", luna_model: null, luna_report: null,
        decision_status: "no_eligible_candidates",
      }, success: true });
      const combined = filteredOut.length > 0 ? filteredOut : earlyFilteredExamples;
      const combinedExamples = combined.slice(0, 3)
        .map((entry) => `- ${entry.name}: ${entry.reason}`)
        .join("\n");
      screenReport = combinedExamples
        ? `⛔ NO DEPLOY\n\nNo candidates passed screening.\nFiltered examples:\n${combinedExamples}`
        : `⛔ NO DEPLOY\n\nNo candidates passed screening. API matches: ${topCandidates.discovery?.api_matches ?? "unknown"}; fetched: ${topCandidates.discovery?.api_returned ?? "unknown"}; local filters passed: ${topCandidates.total_screened}; enriched candidates: ${candidatePools.length}.`;
      return screenReport;
    }

    // Pre-fetch active_bin + volume trends for all passing candidates in parallel
    const [activeBinResults, volumeTrendResults] = await Promise.all([
      Promise.allSettled(passing.map(({ pool }) => getActiveBin({ pool_address: pool.pool }))),
      Promise.allSettled(passing.map(({ pool }) => getVolumeTrend(pool.pool))),
    ]);

    // Join Jev measurements to Luna's real tool choice, without exposing Jev to the agent.
    const shadowScores = await recordJevShadow(passing.map((candidate, i) => ({
      ...candidate,
      volTrend: volumeTrendResults[i]?.status === "fulfilled" ? volumeTrendResults[i].value : null,
    })), fetch, shadowCycleId);
    // Trending scout scores use wider filters and older market snapshots.
    // Only this cycle's fully screened observations belong in Luna's shortlist.
    const jevByAddress = new Map((shadowScores ?? []).map((score) => [score.pool_address, score]));
    const shadowChoices = [];

    // Build compact candidate blocks
    const candidateBlocks = passing.map(({ pool, sw, n, ti, mem, source }, i) => {
      const botPct = ti?.audit?.bot_holders_pct ?? "?";
      const top10Pct = ti?.audit?.top_holders_pct ?? "?";
      const feesSol = ti?.global_fees_sol ?? "?";
      const launchpad = ti?.launchpad ?? null;
      const priceChange = ti?.stats_1h?.price_change;
      const netBuyers = ti?.stats_1h?.net_buyers;
      const activeBin = activeBinResults[i]?.status === "fulfilled" ? activeBinResults[i].value?.binId : null;
      const volTrend = volumeTrendResults[i]?.status === "fulfilled" ? volumeTrendResults[i].value : null;
      const deployPlan = computeEvilPandaDeployPlan({ volatility: pool.volatility, binStep: pool.bin_step });
      const candidateScore = pool.candidate_score ?? 0;
      const jev = jevByAddress.get(pool.pool);
      const feeRate5m = pool.activity_metrics?.fee_tvl_1h_per_5m_pct ?? activityPerFiveMinutes(pool.fee_active_tvl_ratio, pool.discovery_timeframe);
      const volumeRate5m = pool.activity_metrics?.volume_1h_per_5m_usd ?? activityPerFiveMinutes(pool.volume_window, pool.discovery_timeframe);
      const netScenario = estimateNetFeeScenario({ pool, amountUsd: deposit.amountUsd, solPrice: currentBalance.sol_price });

      // OKX signals
      const okxParts = [
        pool.risk_level     != null ? `risk=${pool.risk_level}`               : null,
        pool.bundle_pct     != null ? `bundle=${pool.bundle_pct}%`            : null,
        pool.sniper_pct     != null ? `sniper=${pool.sniper_pct}%`            : null,
        pool.suspicious_pct != null ? `suspicious=${pool.suspicious_pct}%`    : null,
        pool.new_wallet_pct != null ? `new_wallets=${pool.new_wallet_pct}%`   : null,
        pool.is_rugpull != null ? `rugpull=${pool.is_rugpull ? "YES" : "NO"}` : null,
        pool.is_wash != null ? `wash=${pool.is_wash ? "YES" : "NO"}` : null,
      ].filter(Boolean).join(", ");
      const okxUnavailable = !okxParts && pool.price_vs_ath_pct == null;

      const okxTags = [
        pool.smart_money_buy    ? "smart_money_buy"    : null,
        pool.kol_in_clusters    ? "kol_in_clusters"    : null,
        pool.dex_boost          ? "dex_boost"          : null,
        pool.dex_screener_paid  ? "dex_screener_paid"  : null,
        pool.dev_sold_all       ? "dev_sold_all(bullish)" : null,
      ].filter(Boolean).join(", ");

      // GMGN signals
      const gmgnParts = [
        pool.gmgn_top10        != null ? `top10=${(pool.gmgn_top10 * 100).toFixed(1)}%`      : null,
        pool.creator_hold_rate != null ? `creator_hold=${(pool.creator_hold_rate * 100).toFixed(1)}%` : null,
        pool.gmgn_bundler_pct  != null ? `bundler=${pool.gmgn_bundler_pct.toFixed(1)}%`      : null,
        pool.rat_trader_pct    != null ? `rat_trader=${pool.rat_trader_pct.toFixed(1)}%`     : null,
        pool.gmgn_smart_wallets != null ? `smart_wallets=${pool.gmgn_smart_wallets}`         : null,
        pool.gmgn_kol_count    != null ? `kols=${pool.gmgn_kol_count}`                       : null,
        pool.renounced_mint    != null ? `renounced=${pool.renounced_mint ? "yes" : "NO"}`   : null,
      ].filter(Boolean).join(", ");

      const block = [
        `POOL: ${pool.name} (${pool.pool})`,
        `  quote: ${deposit.symbol} (${deposit.mint})`,
        `  screening_score: ${candidateScore}`,
        jev ? `  jev_advisory_untrusted: fees=${jev.fees.score.toFixed(2)}/2 (${jev.fees.confidence.toFixed(2)} confidence), momentum=${jev.momentum.score.toFixed(2)}/2 (${jev.momentum.confidence.toFixed(2)} confidence), holder_risk=${jev.holder_risk.score.toFixed(2)}/2 (${jev.holder_risk.confidence.toFixed(2)} confidence; higher holder_risk means more concern` : null,
        `  metrics: timeframe=${pool.discovery_timeframe || config.screening.timeframe}, bin_step=${pool.bin_step}, fee_pct=${pool.fee_pct}%, fee_tvl=${pool.fee_active_tvl_ratio}, vol=$${pool.volume_window}, tvl=$${pool.active_tvl}, volatility=${pool.volatility}, mcap=$${pool.mcap}, organic=${pool.organic_score}${pool.token_age_hours != null ? `, age=${pool.token_age_hours}h` : ""}`,
        feeRate5m != null && volumeRate5m != null ? `  sustained_activity_1h_per_5m: fee_tvl=${feeRate5m.toFixed(4)}%, vol=$${volumeRate5m.toFixed(0)}` : null,
        pool.activity_metrics ? `  recent_activity: 30m_per_5m fee_tvl=${pool.activity_metrics.fee_tvl_30m_per_5m_pct?.toFixed(4) ?? "?"}%, vol=$${pool.activity_metrics.volume_30m_per_5m_usd?.toFixed(0) ?? "?"}; latest_5m fee_tvl=${pool.activity_metrics.fee_tvl_5m_pct ?? "?"}%, vol=$${pool.activity_metrics.volume_5m_usd ?? "?"}` : null,
        pool.activity_cautions?.length ? `  activity_cautions: ${pool.activity_cautions.join("; ")}` : null,
        netScenario ? `  net_scenario_untrusted: 4h fees ~$${netScenario.estimated_fees_4h_usd}, costs ~$${netScenario.estimated_costs_usd}, net before inventory ~$${netScenario.net_before_inventory_usd}, after 5% adverse move ~$${netScenario.net_after_5pct_adverse_move_usd} (uncalibrated; assumes steady fees and half proportional fee capture)` : null,
        `  audit: top10=${top10Pct}%, bots=${botPct}%, fees=${feesSol}SOL${launchpad ? `, launchpad=${launchpad}` : ""}`,
        okxParts ? `  okx: ${okxParts}` : okxUnavailable ? `  okx: unavailable` : null,
        okxTags  ? `  tags: ${okxTags}` : null,
        gmgnParts ? `  gmgn: ${gmgnParts}` : null,
        pool.st_direction ? `  supertrend: ${pool.st_direction}(${pool.st_pct_vs_price}%)${pool.st_entry_ok ? " ✓ entry_ok" : " ⚠ downtrend"}` : null,
        pool.price_vs_ath_pct != null ? `  ath: price_vs_ath=${pool.price_vs_ath_pct}%${pool.top_cluster_trend ? `, top_cluster=${pool.top_cluster_trend}` : ""}` : null,
        `  smart_wallets: ${sw?.in_pool?.length ?? 0} present${sw?.in_pool?.length ? ` → CONFIDENCE BOOST (${sw.in_pool.map(w => w.name).join(", ")})` : ""}`,
        source === "smart-wallet-fallback" ? `  source: smart-wallet fallback` : null,
        activeBin != null ? `  active_bin: ${activeBin}` : null,
        priceChange != null ? `  1h: price${priceChange >= 0 ? "+" : ""}${priceChange}%, net_buyers=${netBuyers ?? "?"}` : null,
        volTrend ? `  vol_trend: ${volTrend.direction} (${volTrend.trend_pct != null ? (volTrend.trend_pct >= 0 ? "+" : "") + volTrend.trend_pct + "%" : "n/a"} vs prev 6h), avg_6h=$${volTrend.last6h_avg_vol}` : null,
        `  recommended deploy: ${formatEvilPandaDeployPlan(deployPlan)}`,
        n?.narrative ? `  narrative_untrusted: ${sanitizeUntrustedPromptText(n.narrative, 500)}` : `  narrative_untrusted: none`,
        mem ? `  memory_untrusted: ${sanitizeUntrustedPromptText(mem, 500)}` : null,
      ].filter(Boolean).join("\n");

      return block;
    });

    const { content } = await agentLoop(`
SCREENING CYCLE
${strategyBlock}
Positions: ${prePositions.total_positions}/${config.risk.maxPositions} | SOL: ${currentBalance.sol.toFixed(3)} | USDC: ${currentBalance.usdc.toFixed(2)} | Deploy: ${deployAmount} ${deposit.symbol} (~$${deposit.amountUsd.toFixed(2)})

PRE-LOADED CANDIDATES (${passing.length} pools):
${candidateBlocks.join("\n\n")}

STEPS:
1. Pick the best candidate based on estimated net fee opportunity, current volume trend, risk evidence, then narrative and smart wallets as supporting signals. The net scenario is an uncalibrated ranking aid, not a profit forecast; inventory losses may exceed it.
   - Jev advisory scores are model opinions from supplied metrics. Check them against the raw data; they cannot override risk gates or authorize a deploy.
   - Rank by sustained_activity_1h_per_5m, then inspect the 30m direction and latest 5m cautions. Do not rank by raw totals across different windows.
   - Prefer pools with vol_trend=up or flat over vol_trend=down.
   - A pool with vol_trend=down and trend_pct < -50% is a red flag (momentum over).
2. Call deploy_position with the exact recommended_deploy values from the chosen pool:
   - pool_address: <pool address with ${deposit.symbol} quote>
   - amount_y: ${deployAmount} ${deposit.symbol} ← REQUIRED, always pass this exact value
   - amount_x: 0
   - strategy: use the candidate's recommended_deploy.strategy exactly
   - bins_below: use the candidate's recommended_deploy.bins_below exactly
   - bins_above: use the candidate's recommended_deploy.bins_above exactly
   - active_bin: use the pre-fetched value above
3. Report in this exact format (no tables, no extra sections):
   ${process.env.DRY_RUN === "true" ? "🧪 SIMULATED DEPLOY — no transaction sent" : "🚀 DEPLOYED"}

   <pool name>
   <pool address>

   ◎ ${deployAmount} ${deposit.symbol} (~$${deposit.amountUsd.toFixed(2)}) | <strategy> | bin <active_bin>
   Range: bin <active_bin - bins_below> → <active_bin>
   Downside buffer: <negative %>

   MARKET
   Fee/TVL: <x>%
   Volume: $<x> (<discovery timeframe>)
   TVL: $<x>
   Volatility: <x>
   Organic: <x>
   Mcap: $<x>
   Age: <x>h

   AUDIT
   Top10: <x>%
   Bots: <x>%
   Fees paid: <x> SOL
   Smart wallets: <names or none>

   RISK
   <If OKX advanced/risk data exists, list only the fields that actually exist: Risk level, Bundle, Sniper, Suspicious, ATH distance, Rugpull, Wash.>
   <If only rugpull/wash exist, list just those.>
   <If OKX enrichment is missing, write exactly: OKX: unavailable>

   WHY THIS WON
   <2-4 concise sentences on why this pool won, key risks, and why it still beat the alternatives>
4. If no pool qualifies, report in this exact format instead:
   ⛔ NO DEPLOY

   Cycle finished with no valid entry.

   BEST LOOKING CANDIDATE
   <name or none>

   WHY SKIPPED
   <2-4 concise sentences explaining why nothing was good enough>

   REJECTED
   <short flat list of top candidate names and why they were skipped>
IMPORTANT:
- Never write "unknown" for OKX. Use real values, omit missing fields, or write exactly "OKX: unavailable".
- Keep the whole report compact and highly scannable for Telegram.
      `, config.llm.maxStepsScreener, [], "SCREENER", config.llm.screeningModel, config.llm.maxTokens, {
        allowedDeployPoolAddresses: passing.map(({ pool }) => pool.pool),
        onToolStart: async ({ name }) => { await liveMessage?.toolStart(name); },
        onToolFinish: async ({ name, args, result, success }) => {
          if (name === "deploy_position") shadowChoices.push({ pool_address: args.pool_address ?? null, success, dry_run: result?.dry_run === true, blocked: result?.blocked === true });
          await liveMessage?.toolFinish(name, result, success);
        },
      });
    const simulatedDeploy = shadowChoices.some((choice) => choice.success && choice.dry_run);
    screenReport = process.env.DRY_RUN === "true" && simulatedDeploy
      ? content.replace(/🚀 DEPLOYED/g, "🧪 SIMULATED DEPLOY — no transaction sent")
      : process.env.DRY_RUN === "true" && /🚀 DEPLOYED|🧪 SIMULATED DEPLOY/i.test(content)
        ? "⛔ NO DEPLOY\n\nNo successful dry-run deploy_position was recorded. Check the action log."
        : content;
    {
      logAction({ tool: "screening_decision", args: { cycle_id: shadowCycleId }, result: {
        candidates: passing.map(({ pool }) => ({
          pool_address: pool.pool,
          base_mint: pool.base?.mint,
          score: pool.candidate_score,
          timeframe: pool.discovery_timeframe,
          fee_tvl_5m_pct: pool.activity_metrics?.fee_tvl_1h_per_5m_pct ?? activityPerFiveMinutes(pool.fee_active_tvl_ratio, pool.discovery_timeframe),
          volume_5m_usd: pool.activity_metrics?.volume_1h_per_5m_usd ?? activityPerFiveMinutes(pool.volume_window, pool.discovery_timeframe),
          activity_metrics: pool.activity_metrics ?? null,
          activity_cautions: pool.activity_cautions ?? [],
          net_scenario: estimateNetFeeScenario({ pool, amountUsd: deposit.amountUsd, solPrice: currentBalance.sol_price }),
        })),
        scored_addresses: shadowScores?.map((score) => score.pool_address) ?? [],
        jev_scores: shadowScores ?? [],
        jev_status: shadowScores ? "scored" : process.env.DRY_RUN !== "true" ? "disabled_live" :
          process.env.JEV_SHADOW_ENABLED !== "true" ? "disabled" :
          !process.env.OPENROUTER_API_KEY ? "missing_provider_key" : "failed",
        choices: shadowChoices,
        no_deploy: shadowChoices.length === 0,
        luna_model: config.llm.screeningModel,
        luna_report: stripThink(screenReport),
        decision_status: shadowChoices.some((choice) => choice.success) ? "deploy_tool_succeeded" : shadowChoices.length ? "deploy_tool_failed" : "no_deploy_selected",
      }, success: true });
    }
  } catch (error) {
    log("cron_error", `Screening cycle failed: ${error.message}`);
    screenReport = `Screening cycle failed: ${error.message}`;
    logAction({ tool: "screening_decision", args: { cycle_id: shadowCycleId }, result: {
      decision_status: "cycle_error", error: error.message, no_deploy: true,
    }, success: false });
  } finally {
    _screeningBusy = false;
    if (!silent && telegramEnabled()) {
      if (screenReport) {
        if (liveMessage) await liveMessage.finalize(stripThink(screenReport)).catch(() => {});
        else sendMessage(`🔍 Screening Cycle\n\n${stripThink(screenReport)}`).catch(() => { });
      }
    }
  }
  return screenReport;
}

export function startCronJobs() {
  stopCronJobs(); // stop any running tasks before (re)starting

  const mgmtTask = scheduleInterval(config.schedule.managementIntervalMin, async () => {
    if (_managementBusy) return;
    timers.managementLastRun = Date.now();
    await runManagementCycle();
  }, (error) => log("cron_error", `Management timer failed: ${error.message}`));

  const screenTask = scheduleInterval(config.schedule.screeningIntervalMin, () => runScreeningCycle(), (error) => log("cron_error", `Screening timer failed: ${error.message}`));

  const jevTask = scheduleInterval(15, refreshJevMarket, (error) => log("jev_market_warn", `Trending scan failed: ${error.message}`));
  refreshJevMarket().catch((error) => log("jev_market_warn", `Trending scan failed: ${error.message}`));

  const healthTask = scheduleInterval(config.schedule.healthCheckIntervalMin, async () => {
    if (_modeChanging || _healthCheckBusy) return;
    _healthCheckBusy = true;
    log("cron", "Starting health check");
    try {
      await agentLoop(`
HEALTH CHECK

Summarize the current portfolio health, total fees earned, and performance of all open positions. Recommend any high-level adjustments if needed.
      `, config.llm.maxStepsManager, [], "MANAGER", config.llm.managementModel);
    } catch (error) {
      log("cron_error", `Health check failed: ${error.message}`);
    } finally {
      _healthCheckBusy = false;
    }
  });

  // Morning Briefing at 8:00 AM UTC+7 (1:00 AM UTC)
  const briefingTask = cron.schedule(`0 1 * * *`, async () => {
    await runBriefing();
  }, { timezone: 'UTC' });

  // Every 6h — catch up if briefing was missed (agent restart, crash, etc.)
  const briefingWatchdog = cron.schedule(`0 */6 * * *`, async () => {
    await maybeRunMissedBriefing();
  }, { timezone: 'UTC' });

  // Thirty-second position monitor; refreshes token risk every five minutes.
  const pnlPollInterval = setInterval(async () => {
    if (_modeChanging || _managementBusy || _screeningBusy || _pnlPollBusy) return;
    _pnlPollBusy = true;
    let screenAfterClose = false;
    try {
      const [result, balance] = await Promise.all([
        getMyPositions({ force: true, silent: true }).catch(() => null),
        process.env.DRY_RUN === "true" ? Promise.resolve(null) : getWalletBalances().catch(() => null),
      ]);
      if (process.env.DRY_RUN !== "true") {
        const riskStatus = checkPortfolioRisk({
          balance,
          positions: result,
          expectedWallet: process.env.SUNSTRIKE_LIVE_WALLET,
          risk: config.risk,
        });
        if (!riskStatus.allowed && Date.now() - _lastRiskReadFailureAt >= 5 * 60_000) {
          _lastRiskReadFailureAt = Date.now();
          log("portfolio_risk_warn", `Risk snapshot unavailable; new entries remain blocked: ${riskStatus.reason}`);
        }
      }
      if (!result?.positions?.length) return;
      for (const p of result.positions) {
        let tokenStatus = { status: "unknown" };
        if (p.base_mint) {
          const cached = _openTokenStatusCache.get(p.base_mint);
          if (cached && Date.now() - cached.at < 5 * 60_000) tokenStatus = cached.status;
          else {
            tokenStatus = await readOpenTokenStatus(p.base_mint);
            _openTokenStatusCache.set(p.base_mint, { at: Date.now(), status: tokenStatus });
            logAction({ tool: "open_token_status", args: { mint: p.base_mint }, result: tokenStatus, success: true });
          }
        }
        const shadowPrior = _emergencyShadowByPosition.get(p.position);
        const shadow = assessEmergencyPriceDrawdown({ position: p, tracked: getTrackedPosition(p.position),
          firstSeenAt: shadowPrior?.firstSeenAt ?? null });
        if (shadow.firstSeenAt != null) {
          const shadowState = { firstSeenAt: shadow.firstSeenAt, logged: shadowPrior?.logged ?? false,
            notified: shadowPrior?.notified ?? false, lastNotifyAttemptAt: shadowPrior?.lastNotifyAttemptAt ?? 0 };
          if (shadow.confirmed && !shadowPrior?.logged) {
            logAction({ tool: "emergency_exit_shadow", args: { position: p.position, pool: p.pool }, result: {
              price_drawdown_from_entry_pct: Math.round(shadow.drawdownPct * 100) / 100,
              confirmation_minutes: 5, jupiter_organic_score: tokenStatus.jupiter_organic_score ?? null,
              organic_below_entry_floor: tokenStatus.organic_below_entry_floor ?? null,
              would_close: true, executed: false,
            }, success: true });
            shadowState.logged = true;
          }
          if (shadow.confirmed && telegramEnabled() && !shadowState.notified &&
              Date.now() - shadowState.lastNotifyAttemptAt >= 5 * 60_000) {
            shadowState.lastNotifyAttemptAt = Date.now();
            const sent = await sendMessage(`⚠️ PERINGATAN LP ${p.position}\nHarga turun ${shadow.drawdownPct.toFixed(1)}% dari entry selama ≥5 menit. Jupiter Score: ${tokenStatus.jupiter_organic_score ?? "tidak tersedia"}.\nPosisi TIDAK ditutup otomatis. Periksa /positions sebelum mengambil keputusan.`);
            shadowState.notified = sent?.ok === true;
            logAction({ tool: "emergency_exit_notification", args: { position: p.position }, result: {
              delivered: shadowState.notified, price_drawdown_from_entry_pct: Math.round(shadow.drawdownPct * 100) / 100,
            }, success: shadowState.notified });
          }
          _emergencyShadowByPosition.set(p.position, shadowState);
        } else _emergencyShadowByPosition.delete(p.position);
        let closeReason = null;
        if (tokenStatus.status === "critical") closeReason = `critical token risk: ${tokenStatus.reason}`;
        else if (p.active_bin != null && p.upper_bin != null && p.active_bin > p.upper_bin) closeReason = "price above LP range";
        else if (p.active_bin != null && p.lower_bin != null && p.active_bin < p.lower_bin &&
            (p.minutes_out_of_range ?? 0) >= 240) {
          const cached = _belowRangeCheckCache.get(p.position);
          let assessment;
          if (cached && Date.now() - cached.at < 5 * 60_000) assessment = cached.assessment;
          else {
            const [pool1h, volumeTrend] = await Promise.all([
              getPoolDetail({ pool_address: p.pool, timeframe: "1h" }).catch(() => null),
              getVolumeTrend(p.pool).catch(() => null),
            ]);
            assessment = assessBelowRangeExit({ position: p, tokenStatus, pool1h, volumeTrend, screening: config.screening });
            _belowRangeCheckCache.set(p.position, { at: Date.now(), assessment });
            logAction({ tool: "below_range_review", args: { position: p.position, pool: p.pool }, result: assessment, success: true });
          }
          if (assessment.close) closeReason = assessment.reason;
        }
        if (closeReason) {
          const lastAttempt = _oorUpAttemptAt.get(p.position) ?? 0;
          if (Date.now() - lastAttempt >= 60_000) {
            _oorUpAttemptAt.set(p.position, Date.now());
            const closed = await executeTool("close_position", { position_address: p.position, reason: closeReason });
            if (closed?.success === true) screenAfterClose = true;
            else log("position_exit_warn", `Close failed for ${p.position.slice(0, 8)}; retrying after cooldown`);
          }
          continue;
        }
        if (!p.pnl_pct_suspicious && queuePeakConfirmation(p.position, p.pnl_pct)) {
          schedulePeakConfirmation(p.position);
        }
        const exit = updatePnlAndCheckExits(p.position, p, config.management);
        if (exit) {
          if (exit.action === "TRAILING_TP" && exit.needs_confirmation) {
            const tracked = getTrackedPosition(p.position);
            const trailingDropPctUsed = exit.trailing_drop_pct_used ?? computeAdaptiveTrailingDropPct(p, tracked);
            if (queueTrailingDropConfirmation(p.position, exit.peak_pnl_pct, exit.current_pnl_pct, trailingDropPctUsed)) {
              scheduleTrailingDropConfirmation(p.position, trailingDropPctUsed);
            }
            continue;
          }
          const cooldownMs = config.schedule.managementIntervalMin * 60 * 1000;
          const sinceLastTrigger = Date.now() - _pollTriggeredAt;
          if (sinceLastTrigger >= cooldownMs) {
            _pollTriggeredAt = Date.now();
            log("state", `[PnL poll] Exit alert: ${p.pair} — ${exit.reason} — triggering management`);
            runManagementCycle({ silent: true }).catch((e) => log("cron_error", `Poll-triggered management failed: ${e.message}`));
          } else {
            log("state", `[PnL poll] Exit alert: ${p.pair} — ${exit.reason} — cooldown (${Math.round((cooldownMs - sinceLastTrigger) / 1000)}s left)`);
          }
          break;
        }
      }
    } finally {
      _pnlPollBusy = false;
      if (screenAfterClose) runScreeningCycle({ silent: true }).catch((error) => log("cron_error", `Post-close screening failed: ${error.message}`));
    }
  }, 30_000);

  _cronTasks = [mgmtTask, screenTask, jevTask, healthTask, briefingTask, briefingWatchdog];
  // Store interval ref so stopCronJobs can clear it
  _cronTasks._pnlPollInterval = pnlPollInterval;
  log("cron", `Cycles started — management every ${config.schedule.managementIntervalMin}m, screening every ${config.schedule.screeningIntervalMin}m`);
}

// ═══════════════════════════════════════════
//  GRACEFUL SHUTDOWN
// ═══════════════════════════════════════════
async function shutdown(signal) {
  log("shutdown", `Received ${signal}. Shutting down...`);
  stopPolling();
  const positions = await getMyPositions();
  log("shutdown", `Open positions at shutdown: ${positions.total_positions}`);
  process.exit(0);
}

if (isDirectRun) {
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

// ═══════════════════════════════════════════
//  FORMAT CANDIDATES TABLE
// ═══════════════════════════════════════════
function formatCandidates(candidates) {
  if (!candidates.length) return "  No eligible pools found right now.";

  const lines = candidates.map((p, i) => {
    const name = (p.name || "unknown").padEnd(20);
    const ftvl = `${p.fee_active_tvl_ratio ?? p.fee_tvl_ratio}%`.padStart(8);
    const vol = `$${((p.volume_window || 0) / 1000).toFixed(1)}k`.padStart(8);
    const active = `${p.active_pct}%`.padStart(6);
    const org = String(p.organic_score).padStart(4);
    return `  [${i + 1}]  ${name}  fee/aTVL:${ftvl}  vol:${vol}  in-range:${active}  organic:${org}`;
  });

  return [
    "  #   pool                  fee/aTVL     vol    in-range  organic",
    "  " + "─".repeat(68),
    ...lines,
  ].join("\n");
}

// ═══════════════════════════════════════════
//  INTERACTIVE REPL
// ═══════════════════════════════════════════
const isTTY = process.stdin.isTTY;
let cronStarted = false;
let busy = false;
const _telegramQueue = []; // queued messages received while agent was busy
const sessionHistory = []; // persists conversation across REPL turns
const MAX_HISTORY = 10;    // keep last 10 messages (5 exchanges) — saves ~500–1k tok per Telegram call
let _ttyInterface = null;

function appendHistory(userMsg, assistantMsg) {
  sessionHistory.push({ role: "user", content: userMsg });
  sessionHistory.push({ role: "assistant", content: assistantMsg });
  // Trim to last MAX_HISTORY messages
  if (sessionHistory.length > MAX_HISTORY) {
    sessionHistory.splice(0, sessionHistory.length - MAX_HISTORY);
  }
}

function refreshPrompt() {
  if (!_ttyInterface) return;
  _ttyInterface.setPrompt(buildPrompt());
  _ttyInterface.prompt(true);
}

async function drainTelegramQueue() {
  while (_telegramQueue.length > 0 && !_managementBusy && !_screeningBusy && !busy) {
    const queued = _telegramQueue.shift();
    await telegramHandler(queued);
  }
}

async function runTelegramShortcut(action) {
  busy = true;
  try { await action(); }
  catch (error) { await sendMessage(`Perintah gagal: ${error.message}`); }
  finally {
    busy = false;
    drainTelegramQueue().catch(() => {});
  }
}

async function telegramHandler(msg) {
  const text = msg?.text?.trim();
  if (!text) return;
  const command = parseTelegramCommand(text);
  const shortcutText = command ? `/${command.name}${command.args ? ` ${command.args}` : ""}` : text;
  if (command?.name === "help" && !command.args) {
    await sendMessage(telegramHelp(process.env.DRY_RUN === "true" ? "DRY_RUN" : "LIVE"), { reply_markup: telegramReplyKeyboard() });
    return;
  }
  if (["live", "dry_run", "mode"].includes(command?.name) && !command.args) {
    if (command.name === "mode") {
      await sendMessage(`Mode: ${process.env.DRY_RUN === "true" ? "DRY_RUN" : "LIVE"}. /dry_run atau /live. Restart mengikuti .env.`);
      return;
    }
    if (!Number.isFinite(msg.date) || msg.date < commandStartedAt || Date.now() / 1000 - msg.date > 120) {
      await sendMessage("Perintah mode kedaluwarsa. Kirim ulang /live atau /dry_run.");
      return;
    }
    if (_modeChanging || _managementBusy || _screeningBusy || _healthCheckBusy || _pnlPollBusy || busy) {
      await sendMessage("Bot sedang menjalankan operasi. Kirim ulang perintah mode setelah selesai.");
      return;
    }
    _modeChanging = true;
    try {
      await sendMessage(await switchRuntimeMode(command.name === "live" ? "LIVE" : "DRY_RUN"));
    } catch (error) {
      await sendMessage(`Mode tidak berubah: ${error.message}`);
    } finally {
      _modeChanging = false;
    }
    return;
  }
  if (_managementBusy || _screeningBusy || busy) {
    if (_telegramQueue.length < 5) {
      _telegramQueue.push(msg);
      sendMessage(`⏳ Queued (${_telegramQueue.length} in queue): "${text.slice(0, 60)}"`).catch(() => {});
    } else {
      sendMessage("Queue is full (5 messages). Wait for the agent to finish.").catch(() => {});
    }
    return;
  }

  if (["status", "check"].includes(command?.name) && !command.args) {
    await runTelegramShortcut(async () => {
      const [wallet, snapshot] = await Promise.all([getWalletBalances(), getMyPositions({ force: true })]);
      if (wallet?.error || snapshot?.error) throw new Error(wallet?.error || snapshot?.error);
      const lines = snapshot.positions.map((p, i) => `${i + 1}. ${p.pair}: ${p.in_range ? "IN" : "OOR"}, fee ${p.unclaimed_fees_usd ?? "?"}${config.management.solMode ? " SOL" : " USD"}`);
      await sendMessage(`☀️ Sunstrike · ${process.env.DRY_RUN === "true" ? "DRY_RUN" : "LIVE"}\n` +
        `Posisi: ${snapshot.total_positions}/${config.risk.maxPositions}\n` +
        `${lines.length ? lines.join("\n") : "Belum ada posisi terbuka."}\n` +
        `Siklus berikut: manajemen ${formatCountdown(nextRunIn(timers.managementLastRun, config.schedule.managementIntervalMin))}, screening ${formatCountdown(nextRunIn(timers.screeningLastRun, config.schedule.screeningIntervalMin))}.`);
      for (const page of formatWalletTokenMessages(wallet)) await sendMessage(page);
    });
    return;
  }

  if (["candidates", "refresh"].includes(command?.name) && !command.args) {
    await runTelegramShortcut(async () => {
      await sendMessage("🔎 Memperbarui kandidat LP (baca-saja)...");
      const result = await getTopCandidates({ limit: 50 });
      const lines = result.candidates.slice(0, 5).map((p, i) => `${i + 1}. ${p.name} (${p.pool?.slice(0, 8)}…) | umur ${p.token_age_hours ?? "?"}j | Jupiter ${p.token_info?.organic_score ?? "?"} | vol 1j $${p.activity_windows?.["1h"]?.volume_window ?? p.volume_window ?? "?"} | fee/TVL 1j ${p.activity_windows?.["1h"]?.fee_active_tvl_ratio ?? p.fee_active_tvl_ratio ?? "?"}%${p.activity_cautions?.length ? ` | ⚠ ${p.activity_cautions.join("; ")}` : ""}`);
      await sendMessage(`Kandidat: ${result.total_eligible} lolos dari ${result.total_screened} pool unik yang ditemukan setelah filter API. ${result.activity_policy === "sustained_1h_trial" ? "Uji DRY_RUN: 1j wajib; 30m/5m sinyal kehati-hatian." : "LIVE: gate aktivitas 5m tetap wajib."} Scan 5m/30m/1h/2h, maksimum 50 pool unik; angka ${result.total_screened} bukan batas scan.\n` +
        `${lines.length ? lines.join("\n") : "Tidak ada kandidat lolos saat ini."}${result.total_eligible > 5 ? `\n${result.total_eligible - 5} kandidat lain tercatat di action log.` : ""}\n` +
        `Ini daftar baca-saja. Tidak ada deploy.`);
      const rejected = result.rejected || [];
      for (let i = 0; i < rejected.length; i += 10) {
        const details = rejected.slice(i, i + 10).map((p, j) => `${i + j + 1}. ${String(p.name || "?").slice(0, 35)} (${p.pool?.slice(0, 8) || "?"}…): ${String(p.reason || "alasan tidak tersedia").slice(0, 140)}`);
        await sendMessage(`Ditolak (${i + 1}–${Math.min(i + 10, rejected.length)} dari ${rejected.length}):\n${details.join("\n")}`);
      }
    });
    return;
  }

  if (command?.name === "thresholds" && !command.args) {
    const s = config.screening;
    await sendMessage(`Ambang screening:\nUmur token ≥${s.minTokenAgeHours}j, tanpa batas maksimum; Jupiter Score ≥${s.minOrganic}\n` +
      `Volume ≥$${s.minVolume}/${s.timeframe}; fee/active TVL ≥${s.minFeeActiveTvlRatio}%; holder ≥${s.minHolders}; fee token ≥${s.minTokenFeesSol} SOL.\n` +
      `Posisi maksimal ${config.risk.maxPositions}: 0,2 SOL atau 20 USDC per LP. /evolve butuh 5 posisi tertutup.`);
    return;
  }

  if (command?.name === "evolve" && !command.args) {
    await runTelegramShortcut(async () => {
      const perf = getPerformanceSummary();
      if (!perf || perf.total_positions_closed < 5) {
        await sendMessage(`/evolve belum dijalankan: perlu 5 posisi tertutup; saat ini ${perf?.total_positions_closed ?? 0}.`);
        return;
      }
      const result = evolveThresholds(getCampaignPerformance(), config);
      if (!result || Object.keys(result.changes).length === 0) {
        await sendMessage("/evolve selesai: tidak ada perubahan ambang yang didukung data.");
        return;
      }
      reloadScreeningThresholds();
      await sendMessage(`/evolve selesai: ${Object.entries(result.changes).map(([key, value]) => `${key}=${value}`).join(", ")}. Batas keras pemilik tetap berlaku.`);
    });
    return;
  }

  if (command?.name === "briefing" && !command.args) {
    try {
      const briefing = await generateBriefing();
      await sendHTML(briefing);
    } catch (e) {
      await sendMessage(`Error: ${e.message}`).catch(() => {});
    }
    return;
  }

  if (command?.name === "positions" && !command.args) {
    try {
      const { positions, total_positions, error } = await getMyPositions({ force: true });
      if (error) throw new Error(error);
      if (total_positions === 0) { await sendMessage("No open positions."); return; }
      const cur = config.management.solMode ? "◎" : "$";
      const lines = positions.map((p, i) => {
        const pnl = p.pnl_usd >= 0 ? `+${cur}${p.pnl_usd}` : `-${cur}${Math.abs(p.pnl_usd)}`;
        const age = p.age_minutes != null ? `${p.age_minutes}m` : "?";
        const oor = !p.in_range ? " ⚠️OOR" : "";
        return `${i + 1}. ${p.pair} | ${cur}${p.total_value_usd} | PnL: ${pnl} | fees: ${cur}${p.unclaimed_fees_usd} | ${age}${oor}`;
      });
      await sendMessage(`📊 Open Positions (${total_positions}):\n\n${lines.join("\n")}\n\n/close <n> to close | /set <n> <note> to set instruction`);
    } catch (e) { await sendMessage(`Error: ${e.message}`).catch(() => {}); }
    return;
  }

  const closeMatch = shortcutText.match(/^\/close\s+(\d+)$/i);
  if (closeMatch) {
    await runTelegramShortcut(async () => {
      const idx = parseInt(closeMatch[1]) - 1;
      const { positions, error } = await getMyPositions({ force: true });
      if (error) throw new Error(error);
      if (idx < 0 || idx >= positions.length) { await sendMessage("Invalid number. Use /positions first."); return; }
      const pos = positions[idx];
      await sendMessage(`Closing ${pos.pair}...`);
      const result = await executeTool("close_position", { position_address: pos.position, reason: "manual Telegram /close" });
      if (result?.dry_run) {
        await sendMessage(`🧪 DRY_RUN: ${pos.pair} tidak ditutup; tidak ada transaksi.`);
      } else if (result?.success) {
        const closeTxs = result.close_txs?.length ? result.close_txs : result.txs;
        const claimNote = result.claim_txs?.length ? `\nClaim txs: ${result.claim_txs.join(", ")}` : "";
        await sendMessage(`✅ Closed ${pos.pair}\nPnL: ${config.management.solMode ? "◎" : "$"}${result.pnl_usd ?? "?"} | close txs: ${closeTxs?.join(", ") || "n/a"}${claimNote}${result.auto_swap_failed ? `\n⚠️ ${result.auto_swap_note}` : ""}`);
      } else {
        await sendMessage(`❌ Close failed: ${result?.reason || result?.error || "unknown error"}`);
      }
    });
    return;
  }

  const setMatch = shortcutText.match(/^\/set\s+(\d+)\s+(.+)$/i);
  if (setMatch) {
    await runTelegramShortcut(async () => {
      const idx = parseInt(setMatch[1]) - 1;
      const note = setMatch[2].trim();
      const { positions, error } = await getMyPositions({ force: true });
      if (error) throw new Error(error);
      if (idx < 0 || idx >= positions.length) { await sendMessage("Invalid number. Use /positions first."); return; }
      const pos = positions[idx];
      setPositionInstruction(pos.position, note);
      await sendMessage(`✅ Note set for ${pos.pair}:\n"${note}"`);
    });
    return;
  }

  if (command) {
    await sendMessage(`Perintah /${command.name} tidak dikenal atau argumennya salah. Kirim /help untuk daftar dan contoh.`);
    return;
  }

  busy = true;
  let liveMessage = null;
  try {
    log("telegram", `Incoming: ${text}`);
    const hasCloseIntent = /\bclose\b|\bsell\b|\bexit\b|\bwithdraw\b/i.test(text);
    const isDeployRequest = !hasCloseIntent && /\bdeploy\b|\bopen position\b|\blp into\b|\badd liquidity\b/i.test(text);
    const agentRole = isDeployRequest ? "SCREENER" : "GENERAL";
    const agentModel = agentRole === "SCREENER" ? config.llm.screeningModel : config.llm.generalModel;
    liveMessage = await createLiveMessage("🤖 Live Update", `Request: ${text.slice(0, 240)}`);
    const { content } = await agentLoop(text, config.llm.maxSteps, sessionHistory, agentRole, agentModel, null, {
      requireTool: true,
      interactive: true,
      onToolStart: async ({ name }) => { await liveMessage?.toolStart(name); },
      onToolFinish: async ({ name, result, success }) => { await liveMessage?.toolFinish(name, result, success); },
    });
    appendHistory(text, content);
    if (liveMessage) await liveMessage.finalize(stripThink(content));
    else await sendMessage(stripThink(content));
  } catch (e) {
    if (liveMessage) await liveMessage.fail(e.message).catch(() => {});
    else await sendMessage(`Error: ${e.message}`).catch(() => {});
  } finally {
    busy = false;
    refreshPrompt();
    drainTelegramQueue().catch(() => {});
  }
}

// Register restarter — when update_config changes intervals, running cron jobs get replaced
registerCronRestarter(() => { if (cronStarted) startCronJobs(); });

if (isDirectRun && isTTY) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: buildPrompt(),
  });
  _ttyInterface = rl;

  // Update prompt countdown every 10 seconds
  setInterval(() => {
    if (!busy) {
      rl.setPrompt(buildPrompt());
      rl.prompt(true); // true = preserve current line
    }
  }, 10_000);

  function launchCron() {
    if (!cronStarted) {
      cronStarted = true;
      // Seed timers so countdown starts from now
      timers.managementLastRun = Date.now();
      timers.screeningLastRun = Date.now();
      startCronJobs();
      console.log("Autonomous cycles are now running.\n");
      rl.setPrompt(buildPrompt());
      rl.prompt(true);
    }
  }

  async function runBusy(fn) {
    if (busy) { console.log("Agent is busy, please wait..."); rl.prompt(); return; }
    busy = true; rl.pause();
    try { await fn(); }
    catch (e) { console.error(`Error: ${e.message}`); }
    finally { busy = false; rl.setPrompt(buildPrompt()); rl.resume(); rl.prompt(); }
  }

  // ── Startup: show wallet + top candidates ──
  console.log(`
╔═══════════════════════════════════════════╗
║         DLMM LP Agent — Ready             ║
╚═══════════════════════════════════════════╝
`);

  console.log("Fetching wallet and top pool candidates...\n");

  busy = true;
  let startupCandidates = [];

  try {
    const [wallet, positions, { candidates, total_eligible, total_screened }] = await Promise.all([
      getWalletBalances(),
      getMyPositions({ force: true }),
      getTopCandidates({ limit: 5 }),
    ]);

    startupCandidates = candidates;

    console.log(wallet.error
      ? "Wallet:    balance unavailable (lookup failed; value is unknown)"
      : `Wallet:    ${wallet.sol} SOL  ($${wallet.sol_usd})  |  SOL price: $${wallet.sol_price}`);
    console.log(`Positions: ${positions.total_positions} open\n`);

    if (positions.total_positions > 0) {
      console.log("Open positions:");
      for (const p of positions.positions) {
        const status = p.in_range ? "in-range ✓" : "OUT OF RANGE ⚠";
        console.log(`  ${p.pair.padEnd(16)} ${status}  fees: $${p.unclaimed_fees_usd}`);
      }
      console.log();
    }

    console.log(`Top pools (${total_eligible} eligible from ${total_screened} screened):\n`);
    console.log(formatCandidates(candidates));

  } catch (e) {
    console.error(`Startup fetch failed: ${e.message}`);
  } finally {
    busy = false;
  }

  // Always start autonomous cycles on launch
  launchCron();
  maybeRunMissedBriefing().catch(() => { });

  startPolling(telegramHandler);

  console.log(`
Commands:
  1 / 2 / 3 ...  Deploy using the funded quote asset
  auto           Let the agent pick and deploy automatically
  /status        Refresh wallet + positions
  /candidates    Refresh top pool list
  /briefing      Show morning briefing (last 24h)
  /learn         Study top LPers from the best current pool and save lessons
  /learn <addr>  Study top LPers from a specific pool address
  /thresholds    Show current screening thresholds + performance stats
  /evolve        Manually trigger threshold evolution from performance data
  /stop          Shut down
`);

  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }

    // ── Number pick: deploy into pool N ─────
    const pick = parseInt(input);
    if (!isNaN(pick) && pick >= 1 && pick <= startupCandidates.length) {
      await runBusy(async () => {
        const pool = startupCandidates[pick - 1];
        console.log(`\nDeploying into ${pool.name} with the funded quote asset...\n`);
        const { content: reply } = await agentLoop(
          `Deploy into pool ${pool.pool} (${pool.name}) using current wallet policy: 0.2 SOL if funded, otherwise 20 USDC. Call get_active_bin then deploy_position. Report result.`,
          config.llm.maxStepsScreener,
          [],
          "SCREENER",
          config.llm.screeningModel
        );
        console.log(`\n${reply}\n`);
        launchCron();
      });
      return;
    }

    // ── auto: agent picks and deploys ───────
    if (input.toLowerCase() === "auto") {
      await runBusy(async () => {
        console.log("\nAgent is picking and deploying...\n");
        const { content: reply } = await agentLoop(
          `get_top_candidates for the funded quote asset, pick the best one, get_active_bin, deploy_position with 0.2 SOL if funded or 20 USDC otherwise. Execute now, don't ask.`,
          config.llm.maxStepsScreener,
          [],
          "SCREENER",
          config.llm.screeningModel
        );
        console.log(`\n${reply}\n`);
        launchCron();
      });
      return;
    }

    // ── go: start cron without deploying ────
    if (input.toLowerCase() === "go") {
      launchCron();
      rl.prompt();
      return;
    }

    // ── Slash commands ───────────────────────
    if (input === "/stop") { await shutdown("user command"); return; }

    if (input === "/status") {
      await runBusy(async () => {
        const [wallet, positions] = await Promise.all([getWalletBalances(), getMyPositions({ force: true })]);
        console.log(wallet.error
          ? "\nWallet: balance unavailable (lookup failed; value is unknown)"
          : `\nWallet: ${wallet.sol} SOL  ($${wallet.sol_usd})`);
        console.log(`Positions: ${positions.total_positions}`);
        for (const p of positions.positions) {
          const status = p.in_range ? "in-range ✓" : "OUT OF RANGE ⚠";
          console.log(`  ${p.pair.padEnd(16)} ${status}  fees: ${config.management.solMode ? "◎" : "$"}${p.unclaimed_fees_usd}`);
        }
        console.log();
      });
      return;
    }

    if (input === "/briefing") {
      await runBusy(async () => {
        const briefing = await generateBriefing();
        console.log(`\n${briefing.replace(/<[^>]*>/g, "")}\n`);
      });
      return;
    }

    if (input === "/candidates") {
      await runBusy(async () => {
        const { candidates, total_eligible, total_screened } = await getTopCandidates({ limit: 5 });
        startupCandidates = candidates;
        console.log(`\nTop pools (${total_eligible} eligible from ${total_screened} screened):\n`);
        console.log(formatCandidates(candidates));
        console.log();
      });
      return;
    }

    if (input === "/thresholds") {
      const s = config.screening;
      console.log("\nCurrent screening thresholds:");
      console.log(`  minFeeActiveTvlRatio: ${s.minFeeActiveTvlRatio}`);
      console.log(`  minOrganic:           ${s.minOrganic}`);
      console.log(`  minHolders:           ${s.minHolders}`);
      console.log(`  minTvl:               ${s.minTvl}`);
      console.log(`  maxTvl:               ${s.maxTvl}`);
      console.log(`  minVolume:            ${s.minVolume}`);
      console.log(`  minTokenFeesSol:      ${s.minTokenFeesSol}`);
      console.log(`  maxBundlePct:         ${s.maxBundlePct}`);
      console.log(`  maxBotHoldersPct:     ${s.maxBotHoldersPct}`);
      console.log(`  maxTop10Pct:          ${s.maxTop10Pct}`);
      console.log(`  timeframe:            ${s.timeframe}`);
      const perf = getPerformanceSummary();
      if (perf) {
        console.log(`\n  Based on ${perf.total_positions_closed} closed positions`);
        console.log(`  Win rate: ${perf.win_rate_pct}%  |  Avg PnL: ${perf.avg_pnl_pct}%`);
      } else {
        console.log("\n  No closed positions yet — thresholds are preset defaults.");
      }
      console.log();
      rl.prompt();
      return;
    }

    if (input.startsWith("/learn")) {
      await runBusy(async () => {
        const parts = input.split(" ");
        const poolArg = parts[1] || null;

        let poolsToStudy = [];

        if (poolArg) {
          poolsToStudy = [{ pool: poolArg, name: poolArg }];
        } else {
          // Fetch top 10 candidates across all eligible pools
          console.log("\nFetching top pool candidates to study...\n");
          const { candidates } = await getTopCandidates({ limit: 10 });
          if (!candidates.length) {
            console.log("No eligible pools found to study.\n");
            return;
          }
          poolsToStudy = candidates.map((c) => ({ pool: c.pool, name: c.name }));
        }

        console.log(`\nStudying top LPers across ${poolsToStudy.length} pools...\n`);
        for (const p of poolsToStudy) console.log(`  • ${p.name || p.pool}`);
        console.log();

        const poolList = poolsToStudy
          .map((p, i) => `${i + 1}. ${p.name} (${p.pool})`)
          .join("\n");

        const { content: reply } = await agentLoop(
          `Study top LPers across these ${poolsToStudy.length} pools by calling study_top_lpers for each:

${poolList}

For each pool, call study_top_lpers then move to the next. After studying all pools:
1. Identify patterns that appear across multiple pools (hold time, scalping vs holding, win rates).
2. Note pool-specific patterns where behaviour differs significantly.
3. Derive 4-8 concrete, actionable lessons using add_lesson. Prioritize cross-pool patterns — they're more reliable.
4. Summarize what you learned.

Focus on: hold duration, entry/exit timing, what win rates look like, whether scalpers or holders dominate.`,
          config.llm.maxSteps,
          [],
          "GENERAL",
          config.llm.generalModel
        );
        console.log(`\n${reply}\n`);
      });
      return;
    }

    if (input === "/evolve") {
      await runBusy(async () => {
        const perf = getPerformanceSummary();
        if (!perf || perf.total_positions_closed < 5) {
          const needed = 5 - (perf?.total_positions_closed || 0);
          console.log(`\nNeed at least 5 closed positions to evolve. ${needed} more needed.\n`);
          return;
        }
        const result = evolveThresholds(getCampaignPerformance(), config);
        if (!result || Object.keys(result.changes).length === 0) {
          console.log("\nNo threshold changes needed — current settings already match performance data.\n");
        } else {
          reloadScreeningThresholds();
          console.log("\nThresholds evolved:");
          for (const [key, val] of Object.entries(result.changes)) {
            console.log(`  ${key}: ${result.rationale[key]}`);
          }
          console.log("\nSaved to user-config.json. Applied immediately.\n");
        }
      });
      return;
    }

    // ── Free-form chat ───────────────────────
    await runBusy(async () => {
      log("user", input);
      const { content } = await agentLoop(input, config.llm.maxSteps, sessionHistory, "GENERAL", config.llm.generalModel, null, { requireTool: true });
      appendHistory(input, content);
      console.log(`\n${content}\n`);
    });
  });

  rl.on("close", () => shutdown("stdin closed"));

} else if (isDirectRun) {
  // Non-TTY: start immediately
  log("startup", "Non-TTY mode — starting cron cycles immediately.");
  startCronJobs();
  maybeRunMissedBriefing().catch(() => { });
  startPolling(telegramHandler);
  (async () => {
    busy = true;
    try {
      const startupStep3 = process.env.DRY_RUN === "true"
        ? `3. If funded, get_top_candidates then simulate the current wallet policy deposit.`
        : `3. If SOL >= ${config.management.minSolToOpen}, use 0.2 SOL; otherwise if USDC >= 20 and SOL transaction reserve is sufficient, use 20 USDC. Get matching candidates then deploy.`;
      await agentLoop(`
STARTUP CHECK
1. get_wallet_balance. 2. get_my_positions. ${startupStep3} 4. Report.
      `, config.llm.maxStepsScreener, [], "SCREENER", config.llm.screeningModel);
    } catch (e) {
      log("startup_error", e.message);
    } finally {
      busy = false;
      await drainTelegramQueue();
    }
  })();
}
