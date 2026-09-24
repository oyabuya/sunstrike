import { discoverPools, getPoolDetail, getTopCandidates } from "./screening.js";
import {
  getActiveBin,
  deployPosition,
  getMyPositions,
  getWalletPositions,
  getPositionPnl,
  claimFees,
  closePosition,
  searchPools,
} from "./dlmm.js";
import { getWalletBalances, swapToken } from "./wallet.js";
import { studyTopLPers } from "./study.js";
import { addLesson, clearAllLessons, clearPerformance, removeLessonsByKeyword, getPerformanceHistory, pinLesson, unpinLesson, listLessons } from "../lessons.js";
import { setPositionInstruction } from "../state.js";

import { getPoolMemory, addPoolNote } from "../pool-memory.js";
import { addStrategy, listStrategies, getStrategy, setActiveStrategy, removeStrategy } from "../strategy-library.js";
import { addToBlacklist, removeFromBlacklist, listBlacklist } from "../token-blacklist.js";
import { blockDev, unblockDev, listBlockedDevs } from "../dev-blocklist.js";
import { addSmartWallet, removeSmartWallet, listSmartWallets, checkSmartWalletsOnPool, autoDiscoverSmartWallets, getSmartWalletCandidatePools } from "../smart-wallets.js";
import { getTokenInfo, getTokenHolders, getTokenNarrative } from "./token.js";
import { getTrendingTokens, getDexScreenerPairs, getRugCheckReport } from "./dexscreener-rugcheck.js";
import { config, reloadScreeningThresholds } from "../config.js";
import { evaluateTokenRisk } from "../token-risk-policy.js";
import { assessFreshActivity, assessTokenMaturity } from "../candidate-quality.js";
import { checkPortfolioRisk, validateNewPosition } from "../portfolio-risk.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync, spawn } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_CONFIG_PATH = path.join(__dirname, "../user-config.json");
import { log, logAction } from "../logger.js";
import { notifyDeploy, notifyClose, notifySwap } from "../telegram.js";

// Registered by index.js so update_config can restart cron jobs when intervals change
let _cronRestarter = null;
export function registerCronRestarter(fn) { _cronRestarter = fn; }

function computeAdaptiveManagementInterval(volatility) {
  const v = Number(volatility);
  if (!Number.isFinite(v)) return null;
  if (v >= (config.schedule.highVolatilityCutoff ?? 5)) return config.schedule.highVolManagementIntervalMin ?? 5;
  if (v >= (config.schedule.midVolatilityCutoff ?? 2)) return config.schedule.midVolManagementIntervalMin ?? 8;
  return config.schedule.lowVolManagementIntervalMin ?? 15;
}

// Map tool names to implementations
const toolMap = {
  discover_pools: discoverPools,
  get_top_candidates: getTopCandidates,
  get_pool_detail: getPoolDetail,
  get_position_pnl: getPositionPnl,
  get_active_bin: getActiveBin,
  deploy_position: deployPosition,
  get_my_positions: getMyPositions,
  get_wallet_positions: getWalletPositions,
  search_pools: searchPools,
  get_token_info: getTokenInfo,
  get_token_holders: getTokenHolders,
  get_token_narrative: getTokenNarrative,
  add_smart_wallet: addSmartWallet,
  remove_smart_wallet: removeSmartWallet,
  list_smart_wallets: listSmartWallets,
  check_smart_wallets_on_pool: checkSmartWalletsOnPool,
  get_smart_wallet_pools: getSmartWalletCandidatePools,
  claim_fees: claimFees,
  close_position: closePosition,
  get_wallet_balance: getWalletBalances,
  swap_token: swapToken,
  get_top_lpers: studyTopLPers,
  study_top_lpers: studyTopLPers,
  set_position_note: ({ position_address, instruction }) => {
    const ok = setPositionInstruction(position_address, instruction || null);
    if (!ok) return { error: `Position ${position_address} not found in state` };
    return { saved: true, position: position_address, instruction: instruction || null };
  },
  self_update: async () => {
    try {
      const result = execSync("git pull", { cwd: process.cwd(), encoding: "utf8" }).trim();
      if (result.includes("Already up to date")) {
        return { success: true, updated: false, message: "Already up to date — no restart needed." };
      }
      // Delay restart so this tool response (and Telegram message) gets sent first
      setTimeout(() => {
        const child = spawn(process.execPath, process.argv.slice(1), {
          detached: true,
          stdio: "inherit",
          cwd: process.cwd(),
        });
        child.unref();
        process.exit(0);
      }, 3000);
      return { success: true, updated: true, message: `Updated! Restarting in 3s...\n${result}` };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },
  get_performance_history: getPerformanceHistory,
  add_strategy:        addStrategy,
  list_strategies:     listStrategies,
  get_strategy:        getStrategy,
  set_active_strategy: setActiveStrategy,
  remove_strategy:     removeStrategy,
  get_pool_memory: getPoolMemory,
  add_pool_note: addPoolNote,
  add_to_blacklist: addToBlacklist,
  remove_from_blacklist: removeFromBlacklist,
  list_blacklist: listBlacklist,
  block_deployer: blockDev,
  unblock_deployer: unblockDev,
  list_blocked_deployers: listBlockedDevs,
  get_trending_tokens: getTrendingTokens,
  get_dexscreener_pairs: getDexScreenerPairs,
  get_rugcheck_report: getRugCheckReport,
  add_lesson: ({ rule, tags, pinned, role }) => {
    addLesson(rule, tags || [], { pinned: !!pinned, role: role || null });
    return { saved: true, rule, pinned: !!pinned, role: role || "all" };
  },
  pin_lesson:   ({ id }) => pinLesson(id),
  unpin_lesson: ({ id }) => unpinLesson(id),
  list_lessons: ({ role, pinned, tag, limit } = {}) => listLessons({ role, pinned, tag, limit }),
  clear_lessons: ({ mode, keyword }) => {
    if (mode === "all") {
      const n = clearAllLessons();
      log("lessons", `Cleared all ${n} lessons`);
      return { cleared: n, mode: "all" };
    }
    if (mode === "performance") {
      const n = clearPerformance();
      log("lessons", `Cleared ${n} performance records`);
      return { cleared: n, mode: "performance" };
    }
    if (mode === "keyword") {
      if (!keyword) return { error: "keyword required for mode=keyword" };
      const n = removeLessonsByKeyword(keyword);
      log("lessons", `Cleared ${n} lessons matching "${keyword}"`);
      return { cleared: n, mode: "keyword", keyword };
    }
    return { error: "invalid mode" };
  },
  update_config: ({ changes, reason = "" }) => {
    // Capital and anti-rug limits are owner policy, never agent-tunable.
    // A model response or Telegram prompt must not loosen them at runtime.
    const OWNER_ONLY_KEYS = new Set([
      "stoplosspct", "maxpositions", "maxdeployamount", "deployamountsol",
      "positionsizepct", "gasreserve", "minsoltoopen", "autocompoundenabled",
      "autocompoundmode", "antirugstrict", "requirerenouncedmint",
      "mintokenfeessol", "maxbundlepct", "maxtop10pct", "maxrattraderpct",
      "maxdevholdpct", "maxbotholderspct", "minorganic", "mintokenagehours",
      "maxtokenagehours", "takeprofitfeepct", "trailingtakeprofit", "minfeepertvl24h",
    ]);
    if (Object.keys(changes || {}).some((key) => OWNER_ONLY_KEYS.has(key.toLowerCase()))) {
      return { success: false, reason: "Capital and safety limits can only be changed by the owner in local configuration." };
    }
    // Flat key → config section mapping (covers everything in config.js)
    const CONFIG_MAP = {
      // screening
      minFeeActiveTvlRatio: ["screening", "minFeeActiveTvlRatio"],
      minTvl: ["screening", "minTvl"],
      maxTvl: ["screening", "maxTvl"],
      minVolume: ["screening", "minVolume"],
      minOrganic: ["screening", "minOrganic"],
      minHolders: ["screening", "minHolders"],
      minMcap: ["screening", "minMcap"],
      maxMcap: ["screening", "maxMcap"],
      minBinStep: ["screening", "minBinStep"],
      maxBinStep: ["screening", "maxBinStep"],
      timeframe: ["screening", "timeframe"],
      category: ["screening", "category"],
      minTokenFeesSol: ["screening", "minTokenFeesSol"],
      maxBundlePct:     ["screening", "maxBundlePct"],
      maxBotHoldersPct: ["screening", "maxBotHoldersPct"],
      maxTop10Pct: ["screening", "maxTop10Pct"],
      maxRatTraderPct: ["screening", "maxRatTraderPct"],
      requireRenouncedMint: ["screening", "requireRenouncedMint"],
      antiRugStrict: ["screening", "antiRugStrict"],
      minTokenAgeHours: ["screening", "minTokenAgeHours"],
      maxTokenAgeHours: ["screening", "maxTokenAgeHours"],
 athFilterPct: ["screening", "athFilterPct"],
  minVolChangePct: ["screening", "minVolChangePct"],
  maxVolatility: ["screening", "maxVolatility"],
  minFeePerTvl24h: ["management", "minFeePerTvl24h"],
      minAgeBeforeYieldCheck: ["management", "minAgeBeforeYieldCheck"],
      minAgeBeforeClose: ["management", "minAgeBeforeClose"],
      // management
      minClaimAmount: ["management", "minClaimAmount"],
      autoSwapAfterClaim: ["management", "autoSwapAfterClaim"],
      outOfRangeBinsToClose: ["management", "outOfRangeBinsToClose"],
outOfRangeWaitMinutes: ["management", "outOfRangeWaitMinutes"],
  oorCooldownTriggerCount: ["management", "oorCooldownTriggerCount"],
  oorCooldownHours: ["management", "oorCooldownHours"],
  poolCooldownHours: ["management", "poolCooldownHours"],
  minVolumeToRebalance: ["management", "minVolumeToRebalance"],
      stopLossPct: ["management", "stopLossPct"],
      takeProfitFeePct: ["management", "takeProfitFeePct"],
      trailingTakeProfit: ["management", "trailingTakeProfit"],
      trailingTriggerPct: ["management", "trailingTriggerPct"],
      trailingDropPct: ["management", "trailingDropPct"],
      solMode: ["management", "solMode"],
      minSolToOpen: ["management", "minSolToOpen"],
      deployAmountSol: ["management", "deployAmountSol"],
      gasReserve: ["management", "gasReserve"],
      positionSizePct: ["management", "positionSizePct"],
      autoCompoundEnabled: ["management", "autoCompoundEnabled"],
      autoCompoundMode: ["management", "autoCompoundMode"],
      autoCompoundStartBalanceSol: ["management", "autoCompoundStartBalanceSol"],
      autoCompoundBalanceStepSol: ["management", "autoCompoundBalanceStepSol"],
      autoCompoundDeployStepSol: ["management", "autoCompoundDeployStepSol"],
      // risk
      maxPositions: ["risk", "maxPositions"],
      maxDeployAmount: ["risk", "maxDeployAmount"],
      // schedule
      managementIntervalMin: ["schedule", "managementIntervalMin"],
      screeningIntervalMin: ["schedule", "screeningIntervalMin"],
      highVolatilityCutoff: ["schedule", "highVolatilityCutoff"],
      midVolatilityCutoff: ["schedule", "midVolatilityCutoff"],
      highVolManagementIntervalMin: ["schedule", "highVolManagementIntervalMin"],
      midVolManagementIntervalMin: ["schedule", "midVolManagementIntervalMin"],
      lowVolManagementIntervalMin: ["schedule", "lowVolManagementIntervalMin"],
      // models
      managementModel: ["llm", "managementModel"],
      screeningModel: ["llm", "screeningModel"],
      generalModel: ["llm", "generalModel"],
      // strategy
      binsBelow: ["strategy", "binsBelow"],
      // adaptive management
      highYieldTrailingFeePerTvl24h: ["management", "highYieldTrailingFeePerTvl24h"],
      highYieldTrailingDropPct: ["management", "highYieldTrailingDropPct"],
      highYieldOorFeePerTvl24h: ["management", "highYieldOorFeePerTvl24h"],
      highYieldOorWaitMinutes: ["management", "highYieldOorWaitMinutes"],
      highVolumeFeeThresholdUsdPerHour: ["management", "highVolumeFeeThresholdUsdPerHour"],
      highVolumeMinFeePerTvl24h: ["management", "highVolumeMinFeePerTvl24h"],
    };

    const applied = {};
    const unknown = [];

    // Build case-insensitive lookup
    const CONFIG_MAP_LOWER = Object.fromEntries(
      Object.entries(CONFIG_MAP).map(([k, v]) => [k.toLowerCase(), [k, v]])
    );

    for (const [key, val] of Object.entries(changes)) {
      const match = CONFIG_MAP[key] ? [key, CONFIG_MAP[key]] : CONFIG_MAP_LOWER[key.toLowerCase()];
      if (!match) { unknown.push(key); continue; }
      applied[match[0]] = val;
    }

    if (Object.keys(applied).length === 0) {
      log("config", `update_config failed — unknown keys: ${JSON.stringify(unknown)}, raw changes: ${JSON.stringify(changes)}`);
      return { success: false, unknown, reason };
    }

    // Validate numeric bounds before applying — prevents LLM from setting nonsensical values
    const NUMERIC_BOUNDS = {
      stopLossPct:          { min: -99, max: -0.1 },
      takeProfitFeePct:     { min: 0.5, max: 999 },
      maxPositions:         { min: 1, max: 20 },
      maxDeployAmount:      { min: 0.01, max: 1000 },
      deployAmountSol:      { min: 0.01, max: 100 },
      gasReserve:           { min: 0.01, max: 2 },
      positionSizePct:      { min: 0.01, max: 1 },
      minFeeActiveTvlRatio: { min: 0.001, max: 50 },
      maxBundlePct:         { min: 0, max: 100 },
      maxTop10Pct:          { min: 0, max: 100 },
      minVolume:            { min: 0, max: 1_000_000 },
      minTvl:               { min: 0, max: 10_000_000 },
      maxTvl:               { min: 100, max: 100_000_000 },
      outOfRangeWaitMinutes: { min: 5, max: 1440 },
      minAgeBeforeYieldCheck: { min: 15, max: 1440 },
      minAgeBeforeClose:     { min: 15, max: 1440 },
      managementIntervalMin: { min: 1, max: 1440 },
      screeningIntervalMin:  { min: 5, max: 1440 },
    };
    for (const key of Object.keys(applied)) {
      const bounds = NUMERIC_BOUNDS[key];
      if (!bounds) continue;
      let val = applied[key];
      if (typeof val === "string" && !isNaN(Number(val))) val = applied[key] = Number(val);
      if (typeof val === "number" && (val < bounds.min || val > bounds.max)) {
        log("config", `update_config: rejected ${key}=${val} — out of safe bounds [${bounds.min}, ${bounds.max}]`);
        delete applied[key];
      }
    }
    if (Object.keys(applied).length === 0) {
      return { success: false, reason: "All changes rejected by range validation", unknown, applied: {} };
    }

    // Apply to live config immediately
    for (const [key, val] of Object.entries(applied)) {
      const [section, field] = CONFIG_MAP[key];
      const before = config[section][field];
      config[section][field] = val;
      log("config", `update_config: config.${section}.${field} ${before} → ${val} (verify: ${config[section][field]})`);
    }

    // Persist to user-config.json
    let userConfig = {};
    if (fs.existsSync(USER_CONFIG_PATH)) {
      try { userConfig = JSON.parse(fs.readFileSync(USER_CONFIG_PATH, "utf8")); } catch { /**/ }
    }
    Object.assign(userConfig, applied);
    userConfig._lastAgentTune = new Date().toISOString();
    fs.writeFileSync(USER_CONFIG_PATH, JSON.stringify(userConfig, null, 2));

    // Restart cron jobs if intervals changed
    const intervalChanged = applied.managementIntervalMin != null || applied.screeningIntervalMin != null;
    if (intervalChanged && _cronRestarter) {
      _cronRestarter();
      log("config", `Cron restarted — management: ${config.schedule.managementIntervalMin}m, screening: ${config.schedule.screeningIntervalMin}m`);
    }

    // Save as a lesson — but skip ephemeral per-deploy interval changes
    // (managementIntervalMin / screeningIntervalMin change every deploy based on volatility;
    //  the rule is already in the system prompt, storing it 75+ times is pure noise)
    const lessonsKeys = Object.keys(applied).filter(
      k => k !== "managementIntervalMin" && k !== "screeningIntervalMin"
    );
    if (lessonsKeys.length > 0) {
      const summary = lessonsKeys.map(k => `${k}=${applied[k]}`).join(", ");
      addLesson(`[SELF-TUNED] Changed ${summary} — ${reason}`, ["self_tune", "config_change"]);
    }

    log("config", `Agent self-tuned: ${JSON.stringify(applied)} — ${reason}`);
    return { success: true, applied, unknown, reason };
  },
};

// Tools that modify on-chain state (need extra safety checks)
const WRITE_TOOLS = new Set([
  "deploy_position",
  "claim_fees",
  "close_position",
  "swap_token",
]);
const PROTECTED_TOOLS = new Set([
  ...WRITE_TOOLS,
  "self_update",
]);
let writeQueue = Promise.resolve();

/**
 * Execute a tool call with safety checks and logging.
 */
export async function executeTool(name, args) {
  name = String(name).replace(/<.*$/, "").trim();
  if (!PROTECTED_TOOLS.has(name)) return executeToolNow(name, args);
  const result = writeQueue.then(() => executeToolNow(name, args));
  writeQueue = result.catch(() => {});
  return result;
}

async function executeToolNow(name, args) {
  const startTime = Date.now();

  // Strip model artifacts like "<|channel|>commentary" appended to tool names
  name = name.replace(/<.*$/, "").trim();

  // ─── Validate tool exists ─────────────────
  const fn = toolMap[name];
  if (!fn) {
    const error = `Unknown tool: ${name}`;
    log("error", error);
    return { error };
  }

  // ─── Pre-execution safety checks ──────────
  if (PROTECTED_TOOLS.has(name)) {
    const safetyCheck = await runSafetyChecks(name, args);
    if (!safetyCheck.pass) {
      log("safety_block", `${name} blocked: ${safetyCheck.reason}`);
      return {
        blocked: true,
        reason: safetyCheck.reason,
      };
    }
  }

  // ─── Execute ──────────────────────────────
  try {
    const result = await fn(args);
    const duration = Date.now() - startTime;
    const success = result?.success !== false && !result?.error;

    logAction({
      tool: name,
      args,
      result: summarizeResult(result),
      duration_ms: duration,
      success,
    });

    if (success && !result?.dry_run) {
      if (name === "swap_token" && result.tx) {
        notifySwap({ inputSymbol: args.input_mint?.slice(0, 8), outputSymbol: args.output_mint === "So11111111111111111111111111111111111111112" || args.output_mint === "SOL" ? "SOL" : args.output_mint?.slice(0, 8), amountIn: result.amount_in, amountOut: result.amount_out, tx: result.tx }).catch(() => {});
      } else if (name === "deploy_position") {
        notifyDeploy({ pair: result.pool_name || args.pool_name || args.pool_address?.slice(0, 8), amountSol: args.amount_y ?? args.amount_sol ?? 0, position: result.position, tx: result.txs?.[0] ?? result.tx, priceRange: result.price_range, binStep: result.bin_step, baseFee: result.base_fee }).catch(() => {});
        const adaptiveInterval = computeAdaptiveManagementInterval(result?.volatility ?? args?.volatility);
        if (adaptiveInterval != null && adaptiveInterval !== config.schedule.managementIntervalMin) {
          toolMap.update_config({
            changes: { managementIntervalMin: adaptiveInterval },
            reason: `Auto interval by volatility=${result?.volatility ?? args?.volatility} after deploy`,
          });
        }
        // Auto-discover smart wallets from this pool — background, never blocks
        const _discoverPool = result.pool || args.pool_address;
        const _discoverName = result.pool_name || args.pool_name || "";
        if (_discoverPool) {
          autoDiscoverSmartWallets(_discoverPool, _discoverName)
            .then(r => { if (r.added > 0) log("smart_wallets", `Post-deploy discovery: +${r.added} new LP wallet(s) from ${_discoverName || _discoverPool.slice(0,8)}`); })
            .catch(e => log("smart_wallets", `Post-deploy discovery failed (non-critical): ${e.message}`));
        }
      } else if (name === "close_position") {
        notifyClose({ pair: result.pool_name || args.position_address?.slice(0, 8), pnlUsd: result.pnl_usd ?? 0, pnlPct: result.pnl_pct ?? 0 }).catch(() => {});
        // Note low-yield closes in pool memory so screener avoids redeploying
        if (args.reason && args.reason.toLowerCase().includes("yield")) {
          const poolAddr = result.pool || args.pool_address;
          if (poolAddr) addPoolNote({ pool_address: poolAddr, note: `Closed: low yield (fee/TVL below threshold) at ${new Date().toISOString().slice(0,10)}` }).catch?.(() => {});
        }
        // Auto-swap base token back to SOL unless user said to hold
        if (!args.skip_swap && result.base_mint) {
          try {
            const balances = await getWalletBalances({});
            if (balances?.error) throw new Error("wallet balance lookup failed; swap amount is unknown");
            const token = balances.tokens?.find(t => t.mint === result.base_mint);
            if (token && token.usd >= 0.10) {
              log("executor", `Auto-swapping ${token.symbol || result.base_mint.slice(0, 8)} ($${token.usd.toFixed(2)}) back to SOL`);
              const swapResult = await swapToken({ input_mint: result.base_mint, output_mint: "SOL", amount: token.balance });
              // Tell the model the swap already happened so it doesn't call swap_token again
              result.auto_swapped = true;
              result.auto_swap_note = `Base token already auto-swapped back to SOL (${token.symbol || result.base_mint.slice(0, 8)} → SOL). Do NOT call swap_token again.`;
              if (swapResult?.amount_out) result.sol_received = swapResult.amount_out;
            }
          } catch (e) {
            log("executor_warn", `Auto-swap after close failed: ${e.message}`);
            result.auto_swap_failed = true;
            result.auto_swap_note = `Auto-swap failed (${e.message}). Call swap_token manually to convert ${result.base_mint?.slice(0, 8)} back to SOL.`;
          }
        }
      } else if (name === "claim_fees" && config.management.autoSwapAfterClaim && result.base_mint) {
        try {
          const balances = await getWalletBalances({});
          if (balances?.error) throw new Error("wallet balance lookup failed; swap amount is unknown");
          const token = balances.tokens?.find(t => t.mint === result.base_mint);
          if (token && token.usd >= 0.10) {
            log("executor", `Auto-swapping claimed ${token.symbol || result.base_mint.slice(0, 8)} ($${token.usd.toFixed(2)}) back to SOL`);
            await swapToken({ input_mint: result.base_mint, output_mint: "SOL", amount: token.balance });
          }
        } catch (e) {
          log("executor_warn", `Auto-swap after claim failed: ${e.message}`);
        }
      }
    }

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;

    logAction({
      tool: name,
      args,
      error: error.message,
      duration_ms: duration,
      success: false,
    });

    // Return error to LLM so it can decide what to do
    return {
      error: error.message,
      tool: name,
    };
  }
}

/**
 * Run safety checks before executing write operations.
 */
async function runSafetyChecks(name, args) {
  switch (name) {
    case "deploy_position": {
      // Reject pools with bin_step out of configured range
      const minStep = config.screening.minBinStep;
      const maxStep = config.screening.maxBinStep;
      if (args.bin_step != null && (args.bin_step < minStep || args.bin_step > maxStep)) {
        return {
          pass: false,
          reason: `bin_step ${args.bin_step} is outside the allowed range of [${minStep}-${maxStep}].`,
        };
      }

      // Check position count limit + duplicate pool guard — force fresh scan to avoid stale cache
      const [positions, balance] = await Promise.all([
        getMyPositions({ force: true }),
        getWalletBalances(),
      ]);
      if ((positions?.error || !Array.isArray(positions?.positions) || !Number.isInteger(positions?.total_positions))) {
        return { pass: false, reason: "Deploy blocked: open positions could not be verified." };
      }
      if (positions.total_positions >= config.risk.maxPositions) {
        return {
          pass: false,
          reason: `Max positions (${config.risk.maxPositions}) reached. Close a position first.`,
        };
      }
      const alreadyInPool = positions.positions.some(
        (p) => p.pool === args.pool_address
      );
      if (alreadyInPool) {
        return {
          pass: false,
          reason: `Already have an open position in pool ${args.pool_address}. Cannot open duplicate.`,
        };
      }

      let poolData = null;
      let oneHourPool = null;
      try {
        [poolData, oneHourPool] = await Promise.all([
          getPoolDetail({ pool_address: args.pool_address, timeframe: "5m" }),
          getPoolDetail({ pool_address: args.pool_address, timeframe: "1h" }),
        ]);
      } catch (error) {
        return { pass: false, reason: `Deploy blocked: current pool metadata could not be verified (${error.message}).` };
      }
      if (poolData?.pool !== args.pool_address || oneHourPool?.pool !== args.pool_address) {
        return { pass: false, reason: "Deploy blocked: fresh activity belongs to a different pool." };
      }
      const activity = assessFreshActivity({ fiveMinutes: poolData, oneHour: oneHourPool, screening: config.screening });
      if (!activity.pass) return { pass: false, reason: `Deploy blocked: ${activity.reason}.` };
      if ((!poolData?.quote?.mint || !poolData?.base?.mint)) {
        return { pass: false, reason: "Deploy blocked: current pool and token mints could not be verified." };
      }
      const poolMint = poolData.base.mint;
      if (args.base_mint && args.base_mint !== poolMint) {
        return { pass: false, reason: "Deploy blocked: supplied base mint does not match the pool's current base mint." };
      }
      if (poolData.quote.mint !== config.tokens.SOL) {
        return { pass: false, reason: "Deploy blocked: only SOL-quoted pools are supported by the approved risk policy." };
      }
      if (positions.positions.some((p) => p.base_mint === poolMint)) {
        return { pass: false, reason: "Already holding this pool's base token in another position." };
      }

      // Final anti-rug preflight gate (strict mode), applies to ALL deploy paths.
      if (!config.screening.antiRugStrict) {
        return { pass: false, reason: "Deploy blocked: antiRugStrict must be enabled for the live risk policy." };
      }
      let adv, okxRisk, tokenInfo, gmgnSecurity, gmgnInfo;
      try {
        const [{ getAdvancedInfo, getRiskFlags }, { getGmgnSecurity, getGmgnInfo }] = await Promise.all([
          import("./okx.js"), import("./gmgn.js"),
        ]);
        const results = await Promise.allSettled([
          getAdvancedInfo(poolMint), getRiskFlags(poolMint), getTokenInfo({ query: poolMint }),
          getGmgnSecurity(poolMint), getGmgnInfo(poolMint),
        ]);
        adv = results[0].status === "fulfilled" ? results[0].value : null;
        okxRisk = results[1].status === "fulfilled" ? results[1].value : null;
        const tokenResponse = results[2].status === "fulfilled" ? results[2].value : null;
        tokenInfo = tokenResponse?.results?.find((token) => token.mint === poolMint) || null;
        gmgnSecurity = results[3].status === "fulfilled" ? results[3].value : null;
        gmgnInfo = results[4].status === "fulfilled" ? results[4].value : null;
      } catch {
        // Fail closed below; provider failures are unknown risk, not safe risk.
      }
      const riskResult = evaluateTokenRisk({
        expectedMint: args.base_mint || poolMint,
        poolMint,
        tokenInfo,
        okxAdvanced: adv,
        okxRisk,
        gmgnSecurity,
        gmgnInfo,
        screening: config.screening,
      });
      if (!riskResult.pass) return { pass: false, reason: `Deploy blocked: ${riskResult.reason}.` };
      const maturity = assessTokenMaturity({ pool: poolData, tokenInfo });
      if (!maturity.pass) return { pass: false, reason: `Deploy blocked: ${maturity.reason}.` };

      const minFeesSol = config.screening.minTokenFeesSol ?? 50;
      const feesSol = Number(tokenInfo?.global_fees_sol);
      if (!Number.isFinite(feesSol)) return { pass: false, reason: "Deploy blocked: current global token fees are unknown." };
      if (feesSol < minFeesSol) {
        return { pass: false, reason: `Deploy blocked: global token fees ${feesSol} SOL are below the ${minFeesSol} SOL limit.` };
      }
      if (args.fees_sol != null && args.fees_sol < minFeesSol) {
        return {
          pass: false,
          reason: `Deploy blocked: global_fees_sol ${args.fees_sol} SOL is below minimum (${minFeesSol} SOL). Token has insufficient on-chain fee activity — likely bundled or scam.`,
        };
      }

      // Warn (but don't block) if pool has 0 open positions — binArrays may be uninitialized.
      // The definitive check is done on-chain inside deployPosition() in dlmm.js.
      try {
        if (!poolData) poolData = await getPoolDetail({ pool_address: args.pool_address });
        if (poolData?.open_positions != null && poolData.open_positions === 0) {
          log("executor", `⚠️  Pool ${args.pool_address.slice(0, 8)} has 0 open positions — on-chain binArray check will run before deploy.`);
        }
      } catch {
        // non-blocking
      }

      // Check amount limits
      const amountY = args.amount_y ?? args.amount_sol ?? 0;
      if (amountY <= 0) {
        return {
          pass: false,
          reason: `Must provide a positive SOL amount (amount_y).`,
        };
      }

      if (config.risk.maxPositions !== 2) {
        return { pass: false, reason: "Deploy blocked: the approved policy permits at most two open positions." };
      }
      if (Math.abs(amountY - config.management.deployAmountSol) > 0.000001) {
        return { pass: false, reason: `Deploy blocked: the approved position size is ${config.management.deployAmountSol} SOL.` };
      }
      if ((args.strategy ?? config.strategy.strategy) !== "spot") {
        return { pass: false, reason: "Deploy blocked: the approved canary baseline requires the Spot strategy." };
      }
      if ((args.amount_x ?? 0) !== 0) {
        return { pass: false, reason: "Deploy blocked: only a single SOL-side deposit is allowed by the canary policy." };
      }
      const minDeploy = 0.01;
      if (amountY < minDeploy) {
        return {
          pass: false,
          reason: `Amount ${amountY} SOL is below the minimum deploy amount (${minDeploy} SOL). Use at least ${minDeploy} SOL.`,
        };
      }
      if (amountY > config.risk.maxDeployAmount) {
        return {
          pass: false,
          reason: `SOL amount ${amountY} exceeds maximum allowed per position (${config.risk.maxDeployAmount}).`,
        };
      }

      // Check USD budget, portfolio loss state, and SOL operating reserve.
      // Includes binArrayRentBuffer: Meteora charges ~0.075 SOL non-refundable rent per binArray
      // account when a position uses bin ranges that have never been created before.
      // A typical position spans 1-2 binArrays → buffer = 0.15 SOL to avoid unexpected failures.
      if (balance?.error || !Number.isFinite(balance.sol) || !Number.isFinite(balance.sol_price) || balance.sol_price <= 0) {
        return { pass: false, reason: "Deploy blocked: SOL balance and USD price could not be verified." };
      }
      const exposureUsd = positions.positions.reduce((sum, p) => {
        const value = p.total_value_true_usd;
        const fees = p.unclaimed_fees_true_usd;
        return sum + (Number.isFinite(value) ? value : 0) + (Number.isFinite(fees) ? fees : 0);
      }, 0);
      let riskStatus = null;
      if (process.env.DRY_RUN !== "true") {
        riskStatus = checkPortfolioRisk({
          balance,
          positions,
          expectedWallet: process.env.SUNSTRIKE_LIVE_WALLET,
          risk: config.risk,
        });
        if (!riskStatus.allowed) return { pass: false, reason: `Deploy blocked: ${riskStatus.reason}.` };
      }
      const usdCheck = validateNewPosition({
        amountSol: amountY,
        solPrice: balance.sol_price,
        walletUsd: balance.total_usd,
        currentExposureUsd: riskStatus?.snapshot?.open_exposure_usd ?? exposureUsd,
        risk: config.risk,
      });
      if (!usdCheck.pass) return { pass: false, reason: `Deploy blocked: ${usdCheck.reason}.` };
      const gasReserve = config.management.gasReserve;
      const binArrayBuffer = config.management.binArrayRentBuffer ?? 0.15;
      const minRequired = amountY + gasReserve + binArrayBuffer;
      if (balance.sol < minRequired) {
        return { pass: false, reason: `Insufficient SOL: have ${balance.sol.toFixed(3)} SOL, need ${minRequired.toFixed(3)} SOL including deploy and fee/rent reserve.` };
      }
      args.initial_value_usd = usdCheck.amountUsd;

      return { pass: true };
    }

    case "swap_token": {
      // Basic check — prevent swapping when DRY_RUN is true
      // (handled inside swapToken itself, but belt-and-suspenders)
      return { pass: true };
    }

    case "self_update": {
      if (process.env.ALLOW_SELF_UPDATE !== "true") {
        return {
          pass: false,
          reason: "self_update is disabled by default. Set ALLOW_SELF_UPDATE=true locally if you really want to enable it.",
        };
      }
      if (!process.stdin.isTTY) {
        return {
          pass: false,
          reason: "self_update is only allowed from a local interactive TTY session, not from Telegram or background automation.",
        };
      }
      return { pass: true };
    }

    default:
      return { pass: true };
  }
}

/**
 * Summarize a result for logging (truncate large responses).
 */
function summarizeResult(result) {
  const str = JSON.stringify(result);
  if (str.length > 1000) {
    return str.slice(0, 1000) + "...(truncated)";
  }
  return result;
}
