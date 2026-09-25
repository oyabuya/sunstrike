import { config } from "../config.js";
import { isBlacklisted } from "../token-blacklist.js";
import { isDevBlocked, getBlockedDevs } from "../dev-blocklist.js";
import { log, logAction } from "../logger.js";
import { isBaseMintOnCooldown, isPoolOnCooldown } from "../pool-memory.js";
import { scoreEvilPandaCandidate, getEvilPandaThresholds, activityWindowMultiplier } from "../evilpanda-policy.js";
import { evaluateTokenRisk } from "../token-risk-policy.js";
import { assessEntryActivity, assessTokenMaturity } from "../candidate-quality.js";
import { getTokenInfo } from "./token.js";
import { Connection, PublicKey } from "@solana/web3.js";

const FETCH_TIMEOUT_MS = 15_000;

// ─── Wash-trading session cache ──────────────────────────────────────────────
// Mints confirmed as wash-trading by OKX are cached for 6h.
// On subsequent cycles they are filtered BEFORE OKX enrichment, saving API calls.
const _washFlaggedMints = new Map(); // mint → flaggedAtMs
const WASH_FLAG_TTL_MS  = 6 * 60 * 60 * 1_000; // 6 hours

function isWashCached(mint) {
  if (!mint) return false;
  const ts = _washFlaggedMints.get(mint);
  if (!ts) return false;
  if (Date.now() - ts > WASH_FLAG_TTL_MS) {
    _washFlaggedMints.delete(mint);
    return false;
  }
  return true;
}

function markWashFlagged(mint) {
  if (mint) _washFlaggedMints.set(mint, Date.now());
}
async function ftch(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try { return await fetch(url, { ...opts, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

const DATAPI_JUP = "https://datapi.jup.ag/v1";

const POOL_DISCOVERY_BASE = "https://pool-discovery-api.datapi.meteora.ag";
const DLMM_ANALYTICS_BASE = "https://dlmm.datapi.meteora.ag";
const DLMM_PROGRAM_ID = new PublicKey("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo");

async function verifiedDlmmPools(pools, filteredOut) {
  if (!pools.length) return pools;
  if (!process.env.RPC_URL) throw new Error("RPC_URL required to verify discovered DLMM pools");
  const candidates = pools.flatMap((pool) => {
    try { return [{ pool, address: new PublicKey(pool.pool) }]; }
    catch {
      pushFilteredReason(filteredOut, pool, "invalid pool address");
      return [];
    }
  });
  if (!candidates.length) return [];
  const accounts = await new Connection(process.env.RPC_URL, "confirmed")
    .getMultipleAccountsInfo(candidates.map(({ address }) => address), "confirmed");
  return candidates.filter(({ pool }, index) => {
    if (accounts[index]?.owner.equals(DLMM_PROGRAM_ID)) return true;
    pushFilteredReason(filteredOut, pool, "pool account missing or not owned by Meteora DLMM");
    log("screening", `Discarded unverified DLMM pool ${pool.pool?.slice(0, 8)}`);
    return false;
  }).map(({ pool }) => pool);
}

// ─── Tematic keyword blacklist (EvilPanda — coins to avoid) ─────────────────
// Political figures, celebrity coins, justice/narrative scams — all tend to
// slow-rug without warning. Hard filter, no override.
const TEMATIC_TERMS = [
  // Political figures
  "trump", "elon", "musk", "barron", "baron", "melania", "biden", "obama",
  "harris", "zelensky", "netanyahu", "kim jong", "putin", "modi",
  // Celebrity coins
  "kanye", "kardashian", "bieber", "taylor swift",
  // Justice / narrative scams
  "justice for", "iryna", "rip ",
].map(t => t.toLowerCase());

function isThematic(name, symbol) {
  const text = `${(name || "")} ${(symbol || "")}`.toLowerCase();
  return TEMATIC_TERMS.some(t => text.includes(t));
}

// ─── DexScreener CTO cache (refreshed every 10 min) ─────────────────────────
// Community Takeover coins: new devs collect creator fees while dumping chart.
let _ctoMints    = new Set();
let _ctoLastFetch = 0;

async function getCtoMints() {
  if (Date.now() - _ctoLastFetch < 10 * 60 * 1_000) return _ctoMints;
  try {
    const res = await ftch("https://api.dexscreener.com/community-takeovers/latest/v1");
    if (!res.ok) return _ctoMints;
    const list = await res.json();
    _ctoMints = new Set(
      (Array.isArray(list) ? list : [])
        .filter(t => t.chainId === "solana")
        .map(t => t.tokenAddress)
    );
    _ctoLastFetch = Date.now();
    log("screening", `CTO cache refreshed: ${_ctoMints.size} CTO tokens on Solana`);
  } catch {
    // keep previous cache on network error
  }
  return _ctoMints;
}

/**
 * Fetch hourly volume for the last 12h and return a trend signal.
 * trend_pct > 0 = volume growing, < 0 = shrinking.
 * Returns null if data is insufficient (pool too new / all zeros).
 */
export async function getVolumeTrend(poolAddress) {
  try {
    const url = `${DLMM_ANALYTICS_BASE}/pools/${poolAddress}/volume/history?timeframe=1h&limit=12`;
    const res = await ftch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const buckets = json?.data ?? [];
    if (buckets.length < 4) return null;

    const half = Math.floor(buckets.length / 2);
    const older = buckets.slice(0, half).reduce((s, b) => s + (b.volume || 0), 0);
    const recent = buckets.slice(half).reduce((s, b) => s + (b.volume || 0), 0);

    if (older < 100 && recent < 100) return null; // no meaningful data

    const trend_pct = older > 0
      ? parseFloat(((recent - older) / older * 100).toFixed(1))
      : null;

    const last6h_avg = parseFloat((recent / half).toFixed(0));
    return {
      trend_pct,
      last6h_avg_vol: last6h_avg,
      direction: trend_pct == null ? "unknown"
        : trend_pct > 20  ? "up"
        : trend_pct < -30 ? "down"
        : "flat",
    };
  } catch {
    return null;
  }
}



/**
 * Fetch pools from the Meteora Pool Discovery API.
 * Returns condensed data optimized for LLM consumption (saves tokens).
 */
export function buildDiscoveryFilters(s = config.screening, now = Date.now()) {
  return [
    "base_token_has_critical_warnings=false",
    "quote_token_has_critical_warnings=false",
    "base_token_has_high_single_ownership=false",
    "pool_type=dlmm",
    `base_token_market_cap>=${s.minMcap}`,
    `base_token_market_cap<=${s.maxMcap}`,
    `base_token_holders>=${s.minHolders}`,
    `volume>=${s.minVolume}`,
    `tvl>=${s.minTvl}`,
    `tvl<=${s.maxTvl}`,
    `dlmm_bin_step>=${s.minBinStep}`,
    `dlmm_bin_step<=${s.maxBinStep}`,
    `fee_active_tvl_ratio>=${s.minFeeActiveTvlRatio}`,
    `base_token_organic_score>=${s.minOrganic}`,
    "quote_token_organic_score>=60",
    s.minTokenAgeHours != null ? `base_token_created_at<=${now - s.minTokenAgeHours * 3_600_000}` : null,
    s.maxTokenAgeHours != null ? `base_token_created_at>=${now - s.maxTokenAgeHours * 3_600_000}` : null,
  ].filter(Boolean);
}

export async function discoverPools({
  page_size = 50,
  overrides = {},
} = {}) {
  const s = { ...config.screening, ...overrides };
  // SOL mint — used for post-filter (not API query — API may not support quote_token_mint parameter)
  const SOL_MINT = config.tokens.SOL;

  const filters = buildDiscoveryFilters(s).join("&&");

  const url = `${POOL_DISCOVERY_BASE}/pools?` +
    `page_size=${page_size}` +
    `&filter_by=${encodeURIComponent(filters)}` +
    `&timeframe=${s.timeframe}` +
    `&category=${s.category}`;

  const res = await ftch(url);

  if (!res.ok) {
    throw new Error(`Pool Discovery API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();

  if (!Array.isArray(data.data)) throw new Error("Pool Discovery API returned invalid pool data");
  const condensed = data.data.map(condensePool);

  // Hard-filter blacklisted tokens and blocked deployers (what pool discovery already gave us)
  let pools = condensed.filter((p) => {
    if (isBlacklisted(p.base?.mint)) {
      log("blacklist", `Filtered blacklisted token ${p.base?.symbol} (${p.base?.mint?.slice(0, 8)}) in pool ${p.name}`);
      return false;
    }
    if (p.dev && isDevBlocked(p.dev)) {
      log("dev_blocklist", `Filtered blocked deployer ${p.dev?.slice(0, 8)} token ${p.base?.symbol} in pool ${p.name}`);
      return false;
    }
    return true;
  });

  // SOL-quote filter — only keep pools where quote token is SOL (wallet holds SOL only)
  // Done as post-filter (not API query) because quote_token_mint is not a supported API param.
  const beforeSolFilter = pools.length;
  pools = pools.filter((p) => {
    if (p.quote?.mint && p.quote.mint !== SOL_MINT) {
      log("screening", `SOL-filter: dropped ${p.name} — quote token is not SOL (${p.quote.mint?.slice(0,8)})`);
      return false;
    }
    return true;
  });
  if (pools.length < beforeSolFilter)
    log("screening", `SOL-filter removed ${beforeSolFilter - pools.length} non-SOL pool(s)`);

  // Wash-trading cache — skip mints already confirmed as wash-trading (OKX) within 6h
  const beforeWashCache = pools.length;
  pools = pools.filter((p) => {
    if (isWashCached(p.base?.mint)) {
      log("screening", `Wash-cache: skipped ${p.name} (flagged within 6h)`);
      return false;
    }
    return true;
  });
  if (pools.length < beforeWashCache)
    log("screening", `Wash-cache filtered ${beforeWashCache - pools.length} pool(s) — OKX call saved`);

  // Tematic keyword blacklist — political/celebrity/justice coins (EvilPanda)
  const beforeTematic = pools.length;
  pools = pools.filter((p) => {
    if (isThematic(p.name, p.base?.symbol)) {
      log("screening", `Tematic filter: dropped ${p.base?.symbol} — political/celebrity/narrative coin`);
      return false;
    }
    return true;
  });
  if (pools.length < beforeTematic)
    log("screening", `Tematic filter removed ${beforeTematic - pools.length} pool(s)`);

  // CTO enrichment — Community Takeover coins (soft flag for LLM evaluation)
  const ctoMints = await getCtoMints();
  for (let i = 0; i < pools.length; i++) {
    if (pools[i].base?.mint && ctoMints.has(pools[i].base.mint)) {
      pools[i].cto_flagged_dexscreener = true;
      log("screening", `CTO detected on ${pools[i].name} — soft flag for LLM (not rejected)`);
    }
  }

  const filtered = condensed.length - pools.length;
  if (filtered > 0) log("blacklist", `Filtered ${filtered} pool(s) with blacklisted tokens/devs`);

  // If pool discovery didn't supply dev field, batch-fetch from Jupiter for any pools
  // where dev is null — but only if the dev blocklist is non-empty (avoid useless calls)
  const blockedDevs = getBlockedDevs();
  if (Object.keys(blockedDevs).length > 0) {
    const missingDev = pools.filter((p) => !p.dev && p.base?.mint);
    if (missingDev.length > 0) {
      const devResults = await Promise.allSettled(
        missingDev.map((p) =>
          ftch(`${DATAPI_JUP}/assets/search?query=${p.base.mint}`)
            .then((r) => r.ok ? r.json() : null)
            .then((d) => {
              const t = Array.isArray(d) ? d[0] : d;
              return { pool: p.pool, dev: t?.dev || null };
            })
            .catch(() => ({ pool: p.pool, dev: null }))
        )
      );
      const devMap = {};
      for (const r of devResults) {
        if (r.status === "fulfilled") devMap[r.value.pool] = r.value.dev;
      }
      pools = pools.filter((p) => {
        const dev = devMap[p.pool];
        if (dev) p.dev = dev; // enrich in-place
        if (dev && isDevBlocked(dev)) {
          log("dev_blocklist", `Filtered blocked deployer (jup) ${dev.slice(0, 8)} token ${p.base?.symbol}`);
          return false;
        }
        return true;
      });
    }
  }

  return {
    total: data.total,
    api_returned: condensed.length,
    pools,
  };
}

/**
 * Returns eligible pools for the agent to evaluate and pick from.
 * Hard filters applied in code, agent decides which to deploy into.
 */
export async function getTopCandidates({ limit = 10, cycleId = null } = {}) {
  const { config } = await import("../config.js");
  const s = config.screening;
  // Discovery supports 5m, 30m, 1h, 2h (but rejects 15m). Sample each
  // window so one nonempty 5m result does not hide stronger sustained pools.
  const timeframes = s.timeframe === "5m" ? ["5m", "30m", "1h", "2h"] : [s.timeframe];
  const results = await Promise.allSettled(timeframes.map((timeframe) =>
    discoverPools({ page_size: 50, overrides: {
      timeframe,
      // Configured 5m floors should represent the same activity rate in every window.
      ...(s.timeframe === "5m" ? {
        minVolume: s.minVolume * activityWindowMultiplier(timeframe),
        minFeeActiveTvlRatio: s.minFeeActiveTvlRatio * activityWindowMultiplier(timeframe),
      } : {}),
    } })
  ));
  const successful = results.flatMap((result, i) => {
    if (result.status === "fulfilled") return [{ timeframe: timeframes[i], ...result.value }];
    log("screening", `${timeframes[i]} discovery unavailable: ${result.reason.message}`);
    return [];
  });
  if (!successful.length) throw new Error("Pool Discovery unavailable across all configured timeframes");
  const windowSnapshots = new Map();
  for (const result of successful) {
    for (const pool of result.pools) {
      if (!pool?.pool) continue;
      const snapshots = windowSnapshots.get(pool.pool) ?? {};
      snapshots[result.timeframe] = pool;
      windowSnapshots.set(pool.pool, snapshots);
    }
  }
  const poolsByAddress = new Map();
  // Round-robin keeps the existing 50-pool enrichment bound while giving
  // every activity window a chance to contribute candidates.
  for (let i = 0; i < 50 && poolsByAddress.size < 50; i++) {
    for (const result of successful) {
      const pool = result.pools[i];
      if (!pool) continue;
      if (!poolsByAddress.has(pool.pool) && poolsByAddress.size < 50) poolsByAddress.set(pool.pool, {
        ...pool, discovery_timeframe: result.timeframe,
        discovery_timeframes: Object.keys(windowSnapshots.get(pool.pool) ?? {}),
        activity_windows: windowSnapshots.get(pool.pool),
      });
    }
  }
  const discovery = {
    pools: [...poolsByAddress.values()],
    total: successful.reduce((sum, result) => sum + (Number(result.total) || 0), 0),
    api_returned: successful.reduce((sum, result) => sum + (Number(result.api_returned) || 0), 0),
  };
  const screeningProfile = successful.map((result) => result.timeframe).join("+");
  log("screening", `Discovery ${screeningProfile}: ${discovery.pools.length} unique pools`);
  const { pools } = discovery;
  const filteredOut = [];
  let totalScreened = pools.length;
  if (s.timeframe === "5m") await hydrateActivityWindows(pools);
  const activityPools = s.timeframe === "5m" ? pools.filter((pool) => {
    const sustainedTrial = process.env.DRY_RUN === "true";
    const snapshots = {
      fiveMinutes: pool.activity_windows?.["5m"],
      thirtyMinutes: pool.activity_windows?.["30m"],
      oneHour: pool.activity_windows?.["1h"],
      screening: s,
    };
    const activity = assessEntryActivity(snapshots);
    if (activity.pass) {
      if (sustainedTrial) {
        pool.activity_metrics = activity.metrics;
        pool.activity_cautions = activity.cautions;
      }
      return true;
    }
    pushFilteredReason(filteredOut, pool, activity.reason);
    return false;
  }) : pools;
  const onchainPools = await verifiedDlmmPools(activityPools, filteredOut);

  // Exclude pools where the wallet already has an open position
  const { getMyPositions } = await import("./dlmm.js");
  const { positions } = await getMyPositions();
  const occupiedPools = new Set(positions.map((p) => p.pool));
  const occupiedMints = new Set(positions.map((p) => p.base_mint).filter(Boolean));

  const buildBaseEligible = (poolList) => poolList
    .filter((p) => {
      if (occupiedPools.has(p.pool)) {
        pushFilteredReason(filteredOut, p, "already have an open position in this pool");
        return false;
      }
      if (occupiedMints.has(p.base?.mint)) {
        pushFilteredReason(filteredOut, p, "already holding this base token in another pool");
        return false;
      }
      if (isPoolOnCooldown(p.pool)) {
        log("screening", `Filtered cooldown pool ${p.name} (${p.pool.slice(0, 8)})`);
        pushFilteredReason(filteredOut, p, "pool cooldown active");
        return false;
      }
      if (isBaseMintOnCooldown(p.base?.mint)) {
        log("screening", `Filtered cooldown token ${p.base?.symbol} (${p.base?.mint?.slice(0, 8)})`);
        pushFilteredReason(filteredOut, p, "token cooldown active");
        return false;
      }
      return true;
    });

  let eligible = buildBaseEligible(onchainPools);
  const evilPandaThresholds = getEvilPandaThresholds(s);
  const {
    maxDevHoldPct,
    maxTop10Pct,
    maxRatTraderPct,
    maxBundlerSoftPct,
    maxBundlerHardPct,
    minVolumeTrendPct,
    severeVolumeTrendPct,
  } = evilPandaThresholds;

  // An empty strict result is valid. Alternative discovery must not bypass hard filters.


  if (s.avoidPvpSymbols && eligible.length > 0) {
    await enrichPvpRisk(eligible);
    if (s.blockPvpSymbols) {
      const before = eligible.length;
      const pvpRemoved = eligible.filter((p) => p.is_pvp);
      pvpRemoved.forEach((p) => pushFilteredReason(filteredOut, p, "PVP hard filter"));
      eligible.splice(0, eligible.length, ...eligible.filter((p) => !p.is_pvp));
      if (eligible.length < before) {
        log("screening", `PVP hard filter removed ${before - eligible.length} pool(s)`);
      }
    }
  }
  // Enrich with GMGN data — creator hold rate, smart wallets, bundler/rat trader exposure
  // Runs in parallel with OKX enrichment below; failures are soft (null = skip).
  if (eligible.length > 0 && process.env.GMGN_API_KEY) {
    const { getGmgnSecurity, getGmgnInfo } = await import("./gmgn.js");
    const gmgnResults = await Promise.allSettled(
      eligible.map(async (p) => {
        if (!p.base?.mint) return { sec: null, info: null };
        const [sec, info] = await Promise.allSettled([
          getGmgnSecurity(p.base.mint),
          getGmgnInfo(p.base.mint),
        ]);
        return {
          sec:  sec.status  === "fulfilled" ? sec.value  : null,
          info: info.status === "fulfilled" ? info.value : null,
        };
      })
    );
    for (let i = 0; i < eligible.length; i++) {
      const r = gmgnResults[i];
      if (r.status !== "fulfilled") continue;
      const { sec, info } = r.value;
      if (sec) {
        eligible[i].gmgn_security = sec;
        if (sec.top_10_holder_rate != null) eligible[i].gmgn_top10     = sec.top_10_holder_rate;
        if (sec.renounced_mint     != null) eligible[i].renounced_mint  = sec.renounced_mint;
        if (sec.is_honeypot        != null) eligible[i].gmgn_honeypot   = sec.is_honeypot;
      }
      if (info) {
        eligible[i].gmgn_info = info;
        if (info.creator_hold_rate != null) eligible[i].creator_hold_rate = info.creator_hold_rate;
        if (info.dev_hold_rate     != null) eligible[i].dev_hold_rate      = info.dev_hold_rate;
        if (info.bundler_pct       != null) eligible[i].gmgn_bundler_pct   = info.bundler_pct;
        if (info.rat_trader_pct    != null) eligible[i].rat_trader_pct     = info.rat_trader_pct;
        if (info.smart_wallets     != null) eligible[i].gmgn_smart_wallets = info.smart_wallets;
        if (info.renowned_wallets  != null) eligible[i].gmgn_kol_count     = info.renowned_wallets;
      }
    }

    // Honeypot hard filter (GMGN confirms)
    eligible.splice(0, eligible.length, ...eligible.filter((p) => {
      if (p.gmgn_honeypot === true) {
        log("screening", `GMGN honeypot filter: dropped ${p.name}`);
        pushFilteredReason(filteredOut, p, "GMGN honeypot confirmed");
        return false;
      }
      return true;
    }));

    // Dev/creator holding hard filter — dev holding > 5% = danger (EvilPanda: even 1% is red flag)
    // We use 5% as hard cutoff; 1-5% is flagged in prompt as caution.
    const maxDevHold = maxDevHoldPct;
    eligible.splice(0, eligible.length, ...eligible.filter((p) => {
      const hold = p.creator_hold_rate ?? p.dev_hold_rate;
      if (hold != null && hold * 100 > maxDevHold) {
        log("screening", `Dev hold filter: dropped ${p.name} — creator/dev holds ${(hold * 100).toFixed(1)}%`);
        pushFilteredReason(filteredOut, p, `dev/creator holds ${(hold * 100).toFixed(1)}% > ${maxDevHold}% limit`);
        return false;
      }
      return true;
    }));

    // Renounced mint hard filter (strict mode) — if data says not renounced, reject.
  if (s.antiRugStrict && s.requireRenouncedMint) {
      eligible.splice(0, eligible.length, ...eligible.filter((p) => {
        if (p.renounced_mint === false) {
          log("screening", `Renounced filter: dropped ${p.name} — renounced_mint=false`);
          pushFilteredReason(filteredOut, p, "renounced_mint=false");
          return false;
        }
        return true;
      }));
    }

    // Concentration hard filter (strict mode) — GMGN top10 holder share.
    if (s.antiRugStrict) {
      const maxTop10 = maxTop10Pct;
      eligible.splice(0, eligible.length, ...eligible.filter((p) => {
        const top10Pct = p.gmgn_top10 != null ? p.gmgn_top10 * 100 : null;
        if (top10Pct != null && top10Pct > maxTop10) {
          log("screening", `Top10 filter: dropped ${p.name} — top10 ${top10Pct.toFixed(1)}% > ${maxTop10}%`);
          pushFilteredReason(filteredOut, p, `top10 ${top10Pct.toFixed(1)}% > ${maxTop10}%`);
          return false;
        }
        return true;
      }));
    }

    // Rat trader hard filter (strict mode) — insider extraction pattern.
    if (s.antiRugStrict) {
      const maxRatTrader = maxRatTraderPct;
      eligible.splice(0, eligible.length, ...eligible.filter((p) => {
        if (p.rat_trader_pct != null && p.rat_trader_pct > maxRatTrader) {
          log("screening", `Rat trader filter: dropped ${p.name} — ${p.rat_trader_pct}% > ${maxRatTrader}%`);
          pushFilteredReason(filteredOut, p, `rat_trader ${p.rat_trader_pct}% > ${maxRatTrader}%`);
          return false;
        }
        return true;
      }));
    }
  }

    // Bundler soft filter: < 40% GREEN, 40-60% YELLOW, > 60% RED (hard skip)
  if (eligible.length > 0 && process.env.GMGN_API_KEY) {
    const maxBundlerSoft = maxBundlerSoftPct;
    const maxBundlerHard = maxBundlerHardPct;
    
    for (let i = eligible.length - 1; i >= 0; i--) {
      const bundler = eligible[i].gmgn_bundler_pct ?? 0;
      
      if (bundler > maxBundlerHard) {
        log("screening", `Bundler hard filter: dropped ${eligible[i].name} — ${bundler}% > ${maxBundlerHard}%`);
        pushFilteredReason(filteredOut, eligible[i], `bundler ${bundler}% exceeds hard cap ${maxBundlerHard}%`);
        eligible.splice(i, 1);
      } else if (bundler > maxBundlerSoft && bundler <= maxBundlerHard) {
        eligible[i].bundler_caution_flag = true;
        log("screening", `⚠️ Bundler yellow flag: ${eligible[i].name} has ${bundler}% (LLM to verify organic >= 70%)`);
      }
    }
  }

  // SuperTrend entry signal (EvilPanda: enter ONLY when price is ABOVE SuperTrend)
  // HARD FILTER — EvilPanda rule: never open in downtrend.
  // direction='up' = confirmed uptrend = valid entry window
  // direction='down' = downtrend = skip, wait for Supertrend flip
  if (eligible.length > 0 && process.env.GMGN_API_KEY) {
    const { getEntrySignal } = await import("./ohlcv.js");
    const stResults = await Promise.allSettled(
      eligible.map(p => p.base?.mint ? getEntrySignal(p.base.mint) : Promise.resolve(null))
    );
    for (let i = 0; i < eligible.length; i++) {
      const r = stResults[i];
      if (r.status !== "fulfilled" || !r.value) continue;
      eligible[i].st_direction    = r.value.st_direction;
      eligible[i].st_pct_vs_price = r.value.st_pct_vs_price;
      eligible[i].st_entry_ok     = r.value.entry_ok;
    }

    // EvilPanda signal: downtrend is a penalty, not a hard reject.
    const beforeSt = eligible.length;
    for (const p of eligible) {
      if (p.st_direction === "down") {
        p.st_caution_flag = true;
        log("screening", `SuperTrend caution: ${p.name} — downtrend (price ${p.st_pct_vs_price?.toFixed(1) ?? "?"}% below ST)`);
      }
    }
    if (eligible.length < beforeSt) log("screening", `SuperTrend signal applied to ${beforeSt - eligible.length} pool(s)`);
  }

  // Enrich with OKX data — advanced info (risk/bundle/sniper) + ATH price (no API key required)
  if (eligible.length > 0) {
    const { getAdvancedInfo, getPriceInfo, getClusterList, getRiskFlags } = await import("./okx.js");
    const okxResults = await Promise.allSettled(
      eligible.map(async (p) => {
        if (!p.base?.mint) return { adv: null, price: null, clusters: [], risk: null, token: null };
        const [adv, price, clusters, risk, token] = await Promise.allSettled([
          getAdvancedInfo(p.base.mint),
          getPriceInfo(p.base.mint),
          getClusterList(p.base.mint),
          getRiskFlags(p.base.mint),
          getTokenInfo({ query: p.base.mint }),
        ]);

        const mintShort = p.base.mint.slice(0, 8);
        if (adv.status !== "fulfilled")      log("okx", `advanced-info unavailable for ${p.name} (${mintShort})`);
        if (price.status !== "fulfilled")    log("okx", `price-info unavailable for ${p.name} (${mintShort})`);
        if (clusters.status !== "fulfilled") log("okx", `cluster-list unavailable for ${p.name} (${mintShort})`);
        if (risk.status !== "fulfilled")     log("okx", `risk-check unavailable for ${p.name} (${mintShort})`);

        return {
          adv: adv.status === "fulfilled" ? adv.value : null,
          price: price.status === "fulfilled" ? price.value : null,
          clusters: clusters.status === "fulfilled" ? clusters.value : [],
          risk: risk.status === "fulfilled" ? risk.value : null,
          token: token.status === "fulfilled" ? token.value : null,
        };
      })
    );
    for (let i = 0; i < eligible.length; i++) {
      const r = okxResults[i];
      if (r.status !== "fulfilled") continue;
      const { adv, price, clusters, risk } = r.value;
      eligible[i].okx_advanced = adv;
      eligible[i].okx_risk = risk;
      const tokenInfo = r.value.token?.results?.find((token) => token.mint === eligible[i].base?.mint) || null;
      eligible[i].token_info = tokenInfo;
      if (adv) {
        eligible[i].risk_level      = adv.risk_level;
        eligible[i].bundle_pct      = adv.bundle_pct;
        eligible[i].dev_holding_pct = adv.dev_holding_pct;
        eligible[i].sniper_pct      = adv.sniper_pct;
        eligible[i].suspicious_pct  = adv.suspicious_pct;
        eligible[i].smart_money_buy = adv.smart_money_buy;
        eligible[i].dev_sold_all    = adv.dev_sold_all;
        eligible[i].dex_boost       = adv.dex_boost;
        eligible[i].dex_screener_paid = adv.dex_screener_paid;
        if (adv.is_cto != null) eligible[i].is_cto = adv.is_cto;
        if (adv.creator && !eligible[i].dev) eligible[i].dev = adv.creator;
      }
      if (risk) {
        eligible[i].is_rugpull = risk.is_rugpull;
        eligible[i].is_wash    = risk.is_wash;
      }
      if (price) {
        eligible[i].price_vs_ath_pct = price.price_vs_ath_pct;
        eligible[i].ath              = price.ath;
      }
      if (clusters?.length) {
        // Surface KOL presence and top cluster trend for LLM
        eligible[i].kol_in_clusters      = clusters.some((c) => c.has_kol);
        eligible[i].top_cluster_trend    = clusters[0]?.trend ?? null;      // buy|sell|neutral
        eligible[i].top_cluster_hold_pct = clusters[0]?.holding_pct ?? null;
      }
    }
    if (s.antiRugStrict) {
      eligible.splice(0, eligible.length, ...eligible.filter((pool) => {
        const maturity = assessTokenMaturity({ pool, tokenInfo: pool.token_info });
        if (!maturity.pass) {
          pushFilteredReason(filteredOut, pool, maturity.reason);
          return false;
        }
        const result = evaluateTokenRisk({
          expectedMint: pool.base?.mint,
          poolMint: pool.base?.mint,
          tokenInfo: pool.token_info,
          okxAdvanced: pool.okx_advanced,
          okxRisk: pool.okx_risk,
          gmgnSecurity: pool.gmgn_security,
          gmgnInfo: pool.gmgn_info,
          screening: s,
        });
        if (!result.pass) {
          log("screening", `Risk gate: dropped ${pool.name} — ${result.reason}`);
          pushFilteredReason(filteredOut, pool, result.reason);
          return false;
        }
        pool.risk_metrics = result.metrics;
        return true;
      }));
    }
    // Wash trading hard filter — fake volume = misleading fee yield
    // Flagged mints are cached for 6h so future cycles skip OKX enrichment entirely.
    eligible.splice(0, eligible.length, ...eligible.filter((p) => {
      if (p.is_wash) {
        log("screening", `Risk filter: dropped ${p.name} — wash trading flagged`);
        markWashFlagged(p.base?.mint);
        pushFilteredReason(filteredOut, p, "wash trading flagged");
        return false;
      }
      return true;
    }));

    // Rugpull hard filter (strict mode) — never deploy if explicitly flagged.
    if (s.antiRugStrict) {
      eligible.splice(0, eligible.length, ...eligible.filter((p) => {
        if (p.is_rugpull === true) {
          log("screening", `Risk filter: dropped ${p.name} — rugpull flagged`);
          pushFilteredReason(filteredOut, p, "rugpull flagged");
          return false;
        }
        return true;
      }));
    }

    // CTO soft signal via OKX tags — allow for LLM evaluation with caution flag
    for (let i = 0; i < eligible.length; i++) {
      if (eligible[i].is_cto) {
        eligible[i].cto_flagged_okx = true;
        log("screening", `OKX CTO tag on ${eligible[i].name} — soft flag (LLM to evaluate)`);
      }
    }

    // ATH filter — drop pools where price is too close to ATH
    const athFilter = s.athFilterPct;
    if (athFilter != null) {
      const threshold = 100 + athFilter; // e.g. -20 → threshold = 80 (price must be <= 80% of ATH)
      const before = eligible.length;
      eligible.splice(0, eligible.length, ...eligible.filter((p) => {
        if (p.price_vs_ath_pct == null) return true; // no data → don't filter
        if (p.price_vs_ath_pct > threshold) {
          log("screening", `ATH filter: dropped ${p.name} — ${p.price_vs_ath_pct}% of ATH (limit: ${threshold}%)`);
          pushFilteredReason(filteredOut, p, `${p.price_vs_ath_pct}% of ATH > ${threshold}% limit`);
          return false;
        }
return true;
    }));
    if (eligible.length < before) log("screening", `ATH filter removed ${before - eligible.length} pool(s)`);
  }

  // Volume trend filter — skip pools where volume is not trending up
  // Requires volume 1h > 20% vs 24h avg (filter young/mid-vol tokens without momentum)
  const minVolChange = s.minVolChangePct;
  if (minVolChange != null) {
    // Fetch volume trends for all eligible pools in parallel
    const trendResults = await Promise.allSettled(
      eligible.map(p => getVolumeTrend(p.pool))
    );
    const before = eligible.length;
    eligible = eligible.filter((p, i) => {
      const trend = trendResults[i].status === "fulfilled" ? trendResults[i].value : null;
      // No data = pass (don't filter on insufficient data), else require trend_pct >= minVolChange
      if (trend == null || trend.trend_pct == null) return true;
      if (trend.trend_pct < severeVolumeTrendPct) {
        log("screening", `Vol trend filter: dropped ${p.name} — trend_pct ${trend.trend_pct}% < ${severeVolumeTrendPct}% severe decline`);
        pushFilteredReason(filteredOut, p, `volume trend ${trend.trend_pct}% < ${severeVolumeTrendPct}% severe decline`);
        return false;
      }
      if (trend.trend_pct < minVolChange) {
        p.vol_trend_caution_flag = true;
        log("screening", `Vol trend caution: ${p.name} — trend_pct ${trend.trend_pct}% < ${minVolChange}% required`);
      }
      return true;
    });
    if (eligible.length < before) log("screening", `Vol trend filter removed ${before - eligible.length} pool(s)`);
}

  // Drop any pools whose creator is on the dev blocklist (caught via advanced-info)
  const before = eligible.length;
    const filtered = eligible.filter((p) => {
      if (p.dev && isDevBlocked(p.dev)) {
        log("dev_blocklist", `Filtered blocked deployer (okx) ${p.dev.slice(0, 8)} token ${p.base?.symbol}`);
        pushFilteredReason(filteredOut, p, "blocked deployer");
        return false;
      }
      return true;
    });
    eligible.splice(0, eligible.length, ...filtered);
    if (eligible.length < before) log("dev_blocklist", `Filtered ${before - eligible.length} pool(s) via OKX creator check`);

    // Auto-discover smart wallets from pools with strong smart money signals.
    // Background only — never delays screening result.
    // Trigger condition: OKX confirms smart_money_buy OR KOL is in top clusters.
    if (process.env.LPAGENT_API_KEY && eligible.length > 0) {
      const smartMoneyPools = eligible.filter(p =>
        p.smart_money_buy === true || p.kol_in_clusters === true
      );
      if (smartMoneyPools.length > 0) {
        const { autoDiscoverSmartWallets } = await import("../smart-wallets.js");
        Promise.allSettled(
          smartMoneyPools.slice(0, 1).map(p =>
            autoDiscoverSmartWallets(p.pool, p.name, p.base?.mint)
              .then(r => { if (r.added > 0) log("smart_wallets", `Screening discovery (${r.source}): +${r.added} wallet(s) from ${p.name}`); })
          )
        ).catch(() => {});
      }
    }
  }

  eligible = eligible
    .map((p) => ({ ...p, candidate_score: scoreEvilPandaCandidate(p) }))
    .sort((a, b) => (b.candidate_score ?? 0) - (a.candidate_score ?? 0))
    .slice(0, limit);

  const activityPolicy = process.env.DRY_RUN === "true" ? "sustained_1h_trial" : "strict_5m_live";
  logAction({ tool: "screening_funnel", args: { profile: screeningProfile, cycle_id: cycleId, activity_policy: activityPolicy }, result: {
    discovered: totalScreened,
    eligible: eligible.map((p) => ({ pool_address: p.pool, name: p.name, base_mint: p.base?.mint,
      score: p.candidate_score, jupiter_organic_score: p.token_info?.organic_score ?? null,
      activity_metrics: p.activity_metrics ?? null, activity_cautions: p.activity_cautions ?? [] })),
    rejected: filteredOut.map(({ name, pool, mint, reason }) => ({ name, pool, mint, reason })),
  }, success: true });

  return {
    candidates: eligible,
    total_eligible: eligible.length,
    total_screened: totalScreened,
    discovery: { api_matches: discovery.total, api_returned: discovery.api_returned, local_passed: onchainPools.length },
    filtered_examples: filteredOut.slice(0, 3),
    rejected: filteredOut,
    screening_profile: screeningProfile,
    activity_policy: activityPolicy,
  };
}

// Discovery pages are independently ranked per timeframe. A missing entry in
// one page is not evidence that the pool lacks activity in that timeframe.
// Fetch the exact pool before applying the existing fail-closed activity gate.
export async function hydrateActivityWindows(pools, loadDetail = getPoolDetail) {
  const missing = pools.flatMap((pool) => ["5m", "30m", "1h"]
    .filter((timeframe) => !pool.activity_windows?.[timeframe])
    .map((timeframe) => ({ pool, timeframe })));
  for (let i = 0; i < missing.length; i += 5) {
    await Promise.all(missing.slice(i, i + 5).map(async ({ pool, timeframe }) => {
      try {
        const detail = await loadDetail({ pool_address: pool.pool, timeframe });
        if (detail.pool !== pool.pool || detail.base?.mint !== pool.base?.mint) return;
        pool.activity_windows ??= {};
        pool.activity_windows[timeframe] = detail;
      } catch (error) {
        log("screening", `${timeframe} detail unavailable for ${pool.pool}: ${error.message}`);
      }
    }));
  }
}

/**
 * Get full raw details for a specific pool.
 * Fetches top 50 pools from discovery API and finds the matching address.
 * Returns the full unfiltered API object (all fields, not condensed).
 */
export async function getPoolDetail({ pool_address, timeframe = "5m" }) {
  const url = `${POOL_DISCOVERY_BASE}/pools?` +
    `page_size=1` +
    `&filter_by=${encodeURIComponent(`pool_address=${pool_address}`)}` +
    `&timeframe=${timeframe}`;

  const res = await ftch(url);

  if (!res.ok) {
    throw new Error(`Pool detail API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const pool = (data.data || [])[0];

  if (!pool) {
    throw new Error(`Pool ${pool_address} not found`);
  }

  return condensePool(pool);
}

/**
 * Condense a pool object for LLM consumption.
 * Raw API returns ~100+ fields per pool. The LLM only needs ~20.
 */
function condensePool(p) {
  return {
    pool: p.pool_address,
    name: p.name,
    base: {
      symbol: p.token_x?.symbol,
      mint: p.token_x?.address,
      organic: Math.round(p.token_x?.organic_score || 0),
      warnings: p.token_x?.warnings?.length || 0,
    },
    quote: {
      symbol: p.token_y?.symbol,
      mint: p.token_y?.address,
    },
    pool_type: p.pool_type,
    bin_step: p.dlmm_params?.bin_step || null,
    fee_pct: p.fee_pct,

    // Core metrics (the numbers that matter)
    active_tvl: round(p.active_tvl),
    fee_window: round(p.fee),
    volume_window: round(p.volume),
    // API sometimes returns 0 for fee_active_tvl_ratio on short timeframes — compute from raw values as fallback
    fee_active_tvl_ratio: p.fee_active_tvl_ratio > 0
      ? fix(p.fee_active_tvl_ratio, 4)
      : (p.active_tvl > 0 ? fix((p.fee / p.active_tvl) * 100, 4) : 0),
    volatility: fix(p.volatility, 2),


    // Token health
    holders: p.base_token_holders,
    mcap: round(p.token_x?.market_cap),
    organic_score: Math.round(p.token_x?.organic_score || 0),
    token_age_hours: p.token_x?.created_at
      ? Math.floor((Date.now() - p.token_x.created_at) / 3_600_000)
      : null,
    dev: p.token_x?.dev || null,

    // Position health
    active_positions: p.active_positions,
    active_pct: fix(p.active_positions_pct, 1),
    open_positions: p.open_positions,

    // Price action
    price: p.pool_price,
    price_change_pct: fix(p.pool_price_change_pct, 1),
    price_trend: p.price_trend,
    min_price: p.min_price,
    max_price: p.max_price,

    // Activity trends
    volume_change_pct: fix(p.volume_change_pct, 1),
    fee_change_pct: fix(p.fee_change_pct, 1),
    swap_count: p.swap_count,
    unique_traders: p.unique_traders,
  };
}

function round(n) {
  return n != null ? Math.round(n) : null;
}

function fix(n, decimals) {
  return n != null ? Number(n.toFixed(decimals)) : null;
}

function pushFilteredReason(list, pool, reason) {
  if (!list || !pool) return;
  list.push({
    name: pool.name || `${pool.base?.symbol || "?"}-${pool.quote?.symbol || "?"}`,
    pool: pool.pool,
    mint: pool.base?.mint,
    reason,
  });
}
