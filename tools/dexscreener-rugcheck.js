/**
 * Trending tokens (GMGN) + DexScreener pairs + RugCheck security.
 *
 * GMGN market trending — requires GMGN_API_KEY + gmgn-cli.
 * DexScreener pairs — cross-DEX liquidity validation, free, no key.
 * RugCheck — token security audit, free, no key.
 */

import { exec } from "child_process";
import { promisify } from "util";
import { log } from "../logger.js";

const execAsync = promisify(exec);
const CLI_TIMEOUT_MS = 10_000;
const FETCH_TIMEOUT_MS = 10_000;

async function ftch(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try { return await fetch(url, { ...opts, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

// ─── In-memory TTL cache ─────────────────────────────────────────────────────
const _cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1_000; // 5 min

function cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) { _cache.delete(key); return undefined; }
  return entry.value;
}
function cacheSet(key, value) {
  _cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

// ─── GMGN Market Trending ────────────────────────────────────────────────────

/**
 * Get trending tokens from GMGN market data.
 * Requires GMGN_API_KEY and gmgn-cli installed globally.
 *
 * @param {Object} opts
 * @param {number} opts.limit - Max results (default 20)
 * @param {string} opts.interval - Time interval: 1m / 5m / 1h / 6h / 24h (default 24h)
 * @param {string} opts.orderBy - Sort field: volume / swaps / marketcap / holder_count / price / change1h (default volume)
 * @returns {{ tokens: Array<{mint, symbol, name, price, change1h, change6h, change24h, volume24h, marketcap, holder_count, swaps, dex}> }}
 */
export async function getTrendingTokens({ limit = 20, interval = "24h", orderBy = "volume" } = {}) {
  const key = `gmgn:trending:${interval}:${orderBy}:${limit}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  const apiKey = process.env.GMGN_API_KEY;
  if (!apiKey) {
    return cacheSet(key, {
      tokens: [],
      error: "GMGN_API_KEY not set — trending tokens unavailable",
    });
  }

  try {
    const { stdout } = await execAsync(
      `gmgn-cli market trending --chain sol --interval ${interval} --order-by ${orderBy} --direction desc --limit ${Math.min(limit, 100)} --raw`,
      { env: { ...process.env, GMGN_API_KEY: apiKey }, timeout: CLI_TIMEOUT_MS }
    );
    const data = JSON.parse(stdout.trim());
    const list = Array.isArray(data?.data?.rank) ? data.data.rank :
                 Array.isArray(data?.data) ? data.data :
                 Array.isArray(data) ? data : [];

    const tokens = list.slice(0, Math.min(limit, 100)).map((t) => ({
      mint: t.address || t.token_address || t.mint || "",
      symbol: t.symbol || "",
      name: t.name || "",
      price: t.price != null ? parseFloat(t.price) : null,
      change_1h: t.price_change_percent1h != null ? parseFloat(t.price_change_percent1h) : null,
      change_6h: t.price_change_percent6h != null ? parseFloat(t.price_change_percent6h) : null,
      change_24h: t.price_change_percent != null ? parseFloat(t.price_change_percent) : null,
      volume_24h: t.volume != null ? parseFloat(t.volume) : null,
      marketcap: t.market_cap != null ? parseFloat(t.market_cap) : (t.mcap != null ? parseFloat(t.mcap) : null),
      holder_count: t.holder_count ?? t.holders ?? null,
      swaps: t.swaps ?? t.txns ?? null,
      liquidity: t.liquidity != null ? parseFloat(t.liquidity) : null,
      dex: t.platform || t.dex || "",
      renounced: t.renounced ?? null,
      freeze_disabled: t.freeze_disabled ?? t.frozen != null ? !t.frozen : null,
    }));

    log("gmgn-trending", `${tokens.length} tokens (interval=${interval}, orderBy=${orderBy})`);
    return cacheSet(key, { tokens });
  } catch (e) {
    log("gmgn-trending", `Error: ${e.message}`);
    return cacheSet(key, { tokens: [], error: e.message });
  }
}

// ─── DexScreener Pairs ───────────────────────────────────────────────────────

/**
 * Get all DEX trading pairs for a token mint from DexScreener.
 * Shows pairs across multiple DEXes — useful for cross-DEX liquidity validation.
 * Free endpoint, no API key required.
 *
 * @param {string} mint - Token mint address
 * @returns {{ pairs: Array<{dex, pairAddress, price, liquidity, volume24h, priceChange24h}> }}
 */
export async function getDexScreenerPairs({ mint }) {
  if (!mint) return { pairs: [], error: "mint is required" };

  const key = `dexscreener:pairs:${mint}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  try {
    const res = await ftch(`https://api.dexscreener.com/latest/dex/tokens/solana/${mint}`);
    if (!res.ok) {
      return cacheSet(key, { pairs: [], error: `HTTP ${res.status}` });
    }
    const data = await res.json();
    const pairs = Array.isArray(data?.pairs) ? data.pairs : [];

    if (pairs.length === 0) {
      // Fallback: try the pairs endpoint format
      const res2 = await ftch(`https://api.dexscreener.com/latest/dex/pairs/solana/${mint}`);
      if (res2.ok) {
        const data2 = await res2.json();
        const pairs2 = Array.isArray(data2?.pairs) ? data2.pairs : [];
        if (pairs2.length > 0) {
          return cacheSet(key, _mapDexScreenerPairs(mint, pairs2));
        }
      }
      return cacheSet(key, { mint, pair_count: 0, pairs: [], message: "No DEX pairs found on DexScreener" });
    }

    return cacheSet(key, _mapDexScreenerPairs(mint, pairs));
  } catch (e) {
    log("dexscreener", `Pairs fetch error for ${mint.slice(0, 8)}: ${e.message}`);
    return cacheSet(key, { pairs: [], error: e.message });
  }
}

function _mapDexScreenerPairs(mint, pairs) {
  const mapped = pairs.slice(0, 20).map((p) => ({
    dex: p.dexId || "",
    pair_address: p.pairAddress || "",
    price: p.priceUsd ? parseFloat(p.priceUsd) : null,
    liquidity: p.liquidity?.usd != null ? parseFloat(p.liquidity.usd) : null,
    volume_24h: Number(p.volume?.h24 || 0),
    price_change_24h: p.priceChange?.h24 != null ? parseFloat(p.priceChange.h24) : null,
    buys_24h: p.txns?.h24?.buys || 0,
    sells_24h: p.txns?.h24?.sells || 0,
    base_token: p.baseToken?.symbol || "",
    quote_token: p.quoteToken?.symbol || "",
  }));

  // Summary: total liquidity and volume across all DEXes
  const totalLiquidity = mapped.reduce((s, p) => s + (p.liquidity || 0), 0);
  const totalVolume = mapped.reduce((s, p) => s + (p.volume_24h || 0), 0);
  const dexList = [...new Set(mapped.map(p => p.dex))];

  return {
    mint,
    pair_count: mapped.length,
    total_liquidity: parseFloat(totalLiquidity.toFixed(2)),
    total_volume_24h: parseFloat(totalVolume.toFixed(2)),
    dexes: dexList,
    pairs: mapped,
  };
}

// ─── RugCheck ────────────────────────────────────────────────────────────────

/**
 * Get token security audit report from RugCheck.xyz.
 * Checks: mint authority, freeze authority, LP lock/burn, top holders,
 * supply distribution, risk score, insider networks.
 * Free API — no key required.
 *
 * @param {string} mint - Token mint address
 * @returns {{ mint, risk_score, risk_level, mint_authority_disabled, freeze_authority_disabled, lp_locked, top_holders, warnings }}
 */
export async function getRugCheckReport({ mint }) {
  if (!mint) return { error: "mint is required" };

  const key = `rugcheck:${mint}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  try {
    const res = await ftch(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`);
    if (!res.ok) {
      log("rugcheck", `API error for ${mint.slice(0, 8)}: ${res.status}`);
      return cacheSet(key, { mint, error: `HTTP ${res.status}`, risk_level: "unknown" });
    }
    const data = await res.json();

    // RugCheck response: score (lower = safer), risks array, topHolders
    const score = data.score ?? data.score_normalised ?? null;
    const risks = Array.isArray(data.risks) ? data.risks : [];
    const topHolders = Array.isArray(data.topHolders) ? data.topHolders : [];
    const token = data.token || {};
    const tokenMeta = data.tokenMeta || {};
    const lockers = data.lockers || {};
    const rugged = data.rugged ?? false;

    // Risk level derivation from score
    let riskLevel = "ok";
    if (score != null) {
      if (score >= 80) riskLevel = "danger";
      else if (score >= 50) riskLevel = "warning";
      else if (score >= 20) riskLevel = "caution";
      else riskLevel = "safe";
    }
    if (rugged) riskLevel = "rugged";
    if (risks.some(r => /critical|severe|danger/i.test(r.level || r.type || r.name || ""))) {
      riskLevel = "danger";
    }

    // Mint/freeze authority
    const mintAuth = data.mintAuthority ?? token.mintAuthority ?? null;
    const freezeAuth = data.freezeAuthority ?? token.freezeAuthority ?? null;
    const mintDisabled = mintAuth === null || mintAuth === undefined ||
                         String(mintAuth).toLowerCase() === "null";
    const freezeDisabled = freezeAuth === null || freezeAuth === undefined ||
                           String(freezeAuth).toLowerCase() === "null";

    // LP lock detection
    const lockerEntries = Object.entries(lockers);
    const lpLocked = lockerEntries.length > 0;
    const lpLockDetails = lockerEntries.map(([addr, info]) => ({
      locker: addr,
      amount: info.amount ?? info.lockedAmount ?? null,
      lock_type: info.type ?? info.lockType ?? null,
      expires: info.lockExpiry ?? info.unlockTime ?? null,
    }));

    // Top holder concentration (exclude pools/programs)
    const excludePattern = /pool|raydium|orca|meteora|jupiter|program|vault|authority|market|lending|dex/i;
    const realHolders = topHolders.filter(h =>
      !excludePattern.test((h.name || h.label || h.tag || h.type || "").toLowerCase())
    );
    const top10Pct = realHolders.slice(0, 10).reduce(
      (sum, h) => sum + (Number(h.percentage) || Number(h.pct) || 0), 0
    );

    // Mapped risks/warnings
    const warnings = risks.slice(0, 15).map(r => ({
      level: r.level || r.severity || "info",
      name: r.name || r.type || "",
      description: r.description || r.message || "",
      value: r.value ?? null,
    }));

    // Total market liquidity across all markets
    const totalMarketLiquidity = data.totalMarketLiquidity ?? null;

    const result = {
      mint,
      name: tokenMeta.name ?? data.name ?? "",
      symbol: tokenMeta.symbol ?? data.symbol ?? "",
      rugged,
      risk_score: score != null ? Number(score) : null,
      risk_level: riskLevel,
      mint_authority_disabled: mintDisabled,
      freeze_authority_disabled: freezeDisabled,
      mint_authority: mintDisabled ? null : mintAuth,
      freeze_authority: freezeDisabled ? null : freezeAuth,
      lp_locked: lpLocked,
      lp_lock_details: lpLockDetails.length > 0 ? lpLockDetails : null,
      total_market_liquidity: totalMarketLiquidity != null ? parseFloat(totalMarketLiquidity) : null,
      total_holders: data.totalHolders ?? null,
      top_10_holder_pct: parseFloat(top10Pct.toFixed(2)),
      decimals: token.decimals ?? tokenMeta.decimals ?? null,
      transfer_fee_pct: data.transferFee?.pct ?? 0,
      risk_count: risks.length,
      risks: warnings,
      price: data.price ?? null,
    };

    log("rugcheck", `Report ${mint.slice(0, 8)}: risk=${riskLevel}, score=${score}, risks=${risks.length}`);
    return cacheSet(key, result);
  } catch (e) {
    log("rugcheck", `Fetch error for ${mint.slice(0, 8)}: ${e.message}`);
    return cacheSet(key, { mint, error: e.message, risk_level: "unknown" });
  }
}
