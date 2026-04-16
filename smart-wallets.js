import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { log } from "./logger.js";

// ─── Auto-discovery config ────────────────────────────────────────────────────
const AUTO_DISCOVER_MIN_WIN_RATE   = 0.65;   // LPAgent: 65% LP win rate
const AUTO_DISCOVER_MIN_ROI        = 0.05;   // LPAgent: 5% ROI minimum
const AUTO_DISCOVER_LIMIT          = 10;     // top N LPers to study per pool
const GMGN_MIN_REALIZED_PROFIT_USD = 50;     // GMGN fallback: min $50 realized profit
const GMGN_SMART_TAGS = new Set(["smart_degen", "kol", "renowned", "TOP10", "KOL"]);
const GMGN_HOLDER_LIMIT = 100;               // GMGN returns max 100 holders

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WALLETS_PATH = path.join(__dirname, "smart-wallets.json");

function loadWallets() {
  if (!fs.existsSync(WALLETS_PATH)) return { wallets: [] };
  try {
    return JSON.parse(fs.readFileSync(WALLETS_PATH, "utf8"));
  } catch {
    return { wallets: [] };
  }
}

function saveWallets(data) {
  fs.writeFileSync(WALLETS_PATH, JSON.stringify(data, null, 2));
}

const SOLANA_PUBKEY_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function addSmartWallet({ name, address, category = "alpha", type = "lp" }) {
  if (!SOLANA_PUBKEY_RE.test(address)) {
    return { success: false, error: "Invalid Solana address format" };
  }
  const data = loadWallets();
  const existing = data.wallets.find((w) => w.address === address);
  if (existing) {
    return { success: false, error: `Already tracked as "${existing.name}"` };
  }
  data.wallets.push({ name, address, category, type, addedAt: new Date().toISOString() });
  saveWallets(data);
  log("smart_wallets", `Added wallet: ${name} (${category}, type=${type})`);
  return { success: true, wallet: { name, address, category, type } };
}

export function removeSmartWallet({ address }) {
  const data = loadWallets();
  const wallet = data.wallets.find((w) => w.address === address);
  if (!wallet) return { success: false, error: "Wallet not found" };
  data.wallets = data.wallets.filter((w) => w.address !== address);
  saveWallets(data);
  log("smart_wallets", `Removed wallet: ${wallet.name}`);
  return { success: true, removed: wallet.name };
}

export function listSmartWallets() {
  const { wallets } = loadWallets();
  return { total: wallets.length, wallets };
}

/**
 * Auto-discover top LPers from a pool and add them as smart wallets.
 *
 * Triggered automatically after:
 *   1. Successful deploy_position — we learn who the best LPers are in our pool
 *   2. Screening when smart_money signal present — we track who's actively LP-ing
 *
 * Criteria (conservative — only genuinely skilled LPers):
 *   - win_rate >= 65%
 *   - roi >= 5%
 *   - total_lp >= 3 (not a one-off)
 *
 * Requires LPAGENT_API_KEY. If not set, skips silently.
 * Always runs in background — never blocks the calling operation.
 *
 * @param {string} poolAddress  Meteora pool address
 * @param {string} poolName     Pool display name (e.g. "BULL/SOL") — used for wallet label
 * @returns {{ added: number, skipped: number, total_studied: number }}
 */
export async function autoDiscoverSmartWallets(poolAddress, poolName = "", baseMint = null) {
  const label = poolName || poolAddress.slice(0, 8);

  // ── PRIMARY: LPAgent (LP performance rankings) ──────────────────────────────
  if (process.env.LPAGENT_API_KEY) {
    return _discoverViaLpAgent(poolAddress, poolName);
  }

  // ── FALLBACK: GMGN token holders (top traders with PnL) ─────────────────────
  // When LPAgent is unavailable, discover profitable wallets from GMGN.
  // These are token traders (not LP-specific), stored as type="holder".
  // They serve as smart money signals across pools with the same base token.
  if (process.env.GMGN_API_KEY) {
    // Need base token mint — try to fetch from pool data if not provided
    let mint = baseMint;
    if (!mint) {
      try {
        const { getPoolDetail } = await import("./tools/screening.js");
        const pool = await getPoolDetail({ pool_address: poolAddress });
        mint = pool?.base?.mint ?? null;
      } catch { /* pool detail unavailable — skip */ }
    }
    if (!mint) {
      log("smart_wallets", `GMGN fallback skipped for ${label}: base mint unavailable`);
      return { added: 0, skipped: 0, total_studied: 0, source: "none" };
    }
    return _discoverViaGmgn(mint, poolName);
  }

  log("smart_wallets", `Auto-discover skipped for ${label}: no LPAGENT_API_KEY or GMGN_API_KEY`);
  return { added: 0, skipped: 0, total_studied: 0 };
}

// ─── LPAgent path ────────────────────────────────────────────────────────────
async function _discoverViaLpAgent(poolAddress, poolName) {
  const label = poolName || poolAddress.slice(0, 8);
  try {
    const { studyTopLPers } = await import("./tools/study.js");
    const result = await studyTopLPers({ pool_address: poolAddress, limit: AUTO_DISCOVER_LIMIT });

    if (!result.lpers?.length) {
      log("smart_wallets", `LPAgent discover: no credible LPers in ${label}`);
      return { added: 0, skipped: 0, total_studied: 0, source: "lpagent", reason: result.message };
    }

    let added = 0, skipped = 0;
    const pairLabel = (poolName.split("/")[0] || poolAddress.slice(0, 6)).toUpperCase();

    for (const lper of result.lpers) {
      const s = lper.summary;
      const winRate = parseFloat(s.win_rate) / 100;
      const roi     = parseFloat(s.roi)      / 100;
      if (winRate < AUTO_DISCOVER_MIN_WIN_RATE || roi < AUTO_DISCOVER_MIN_ROI) { skipped++; continue; }

      const name = `LP-${lper.owner.slice(0, 6)}-${pairLabel}`;
      const r = addSmartWallet({ name, address: lper.owner, category: "auto", type: "lp" });
      if (r.success) {
        added++;
        log("smart_wallets", `LPAgent +${name}: win=${s.win_rate} roi=${s.roi} hold=${s.avg_hold_hours}h`);
      } else { skipped++; }
    }

    if (added > 0) log("smart_wallets", `LPAgent discover ${label}: +${added} LP wallets`);
    return { added, skipped, total_studied: result.lpers.length, source: "lpagent" };
  } catch (e) {
    log("smart_wallets", `LPAgent discover error (${label}): ${e.message}`);
    return { added: 0, skipped: 0, total_studied: 0, source: "lpagent", error: e.message };
  }
}

// ─── GMGN fallback path ───────────────────────────────────────────────────────
async function _discoverViaGmgn(baseMint, poolName) {
  const label = poolName || baseMint.slice(0, 8);
  try {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    const { stdout } = await execAsync(
      `gmgn-cli token holders --chain sol --address ${baseMint} --raw`,
      { env: { ...process.env, GMGN_API_KEY: process.env.GMGN_API_KEY }, timeout: 10_000 }
    );

    const data   = JSON.parse(stdout.trim());
    const holders = data?.list ?? (Array.isArray(data) ? data : []);

    if (!holders.length) {
      log("smart_wallets", `GMGN discover: no holders returned for ${label}`);
      return { added: 0, skipped: 0, total_studied: 0, source: "gmgn" };
    }

    let added = 0, skipped = 0;
    const pairLabel = (poolName.split("/")[0] || baseMint.slice(0, 6)).toUpperCase();

    for (const h of holders.slice(0, GMGN_HOLDER_LIMIT)) {
      const address = h.address;
      if (!address || !SOLANA_PUBKEY_RE.test(address)) { skipped++; continue; }

      const realizedProfit = parseFloat(h.realized_profit ?? 0);
      const tagV2          = h.wallet_tag_v2 ?? "";
      const tags           = Array.isArray(h.tags) ? h.tags : [];
      const isSmartTagged  = GMGN_SMART_TAGS.has(tagV2) || tags.some(t => GMGN_SMART_TAGS.has(t));

      // Filter: meaningful profit AND (smart-tagged OR very profitable)
      const isQualified = realizedProfit >= GMGN_MIN_REALIZED_PROFIT_USD &&
                          (isSmartTagged || realizedProfit >= 200);
      if (!isQualified) { skipped++; continue; }

      const name = `SW-${address.slice(0, 6)}-${pairLabel}`;
      const r = addSmartWallet({
        name,
        address,
        category: "gmgn-auto",
        type:     "holder",   // token trader, not confirmed LP provider
      });
      if (r.success) {
        added++;
        log("smart_wallets", `GMGN +${name}: profit=$${realizedProfit.toFixed(0)} tag=${tagV2}`);
      } else { skipped++; }
    }

    if (added > 0) log("smart_wallets", `GMGN discover ${label}: +${added} holder wallets (${skipped} skipped)`);
    return { added, skipped, total_studied: holders.length, source: "gmgn" };
  } catch (e) {
    log("smart_wallets", `GMGN discover error (${label}): ${e.message}`);
    return { added: 0, skipped: 0, total_studied: 0, source: "gmgn", error: e.message };
  }
}

// Cache wallet positions for 5 minutes to avoid hammering RPC
const _cache = new Map(); // address -> { positions, fetchedAt }
const CACHE_TTL = 5 * 60 * 1000;

/**
 * Reverse tracking — scan ALL lp-type smart wallets and surface pools
 * where multiple wallets are actively LP-ing.
 *
 * This is the inverse of checkSmartWalletsOnPool: instead of asking
 * "are my smart wallets in THIS pool?", we ask "which pools are my
 * smart wallets currently in?"
 *
 * Returns pools ranked by smart wallet concentration.
 * minWallets=2 means at least 2 tracked wallets must be in the pool.
 *
 * @param {number} minWallets - Minimum smart wallets required in a pool (default 2)
 * @returns {{ pools: Array, total_wallets_checked: number }}
 */
export async function getSmartWalletCandidatePools({ min_wallets = 2 } = {}) {
  const { wallets: allWallets } = loadWallets();
  const lpWallets = allWallets.filter((w) => !w.type || w.type === "lp");

  if (lpWallets.length === 0) {
    return { pools: [], total_wallets_checked: 0, signal: "No lp-type wallets tracked" };
  }

  const { getWalletPositions } = await import("./tools/dlmm.js");

  // Fetch positions for all wallets in parallel (with cache)
  const results = await Promise.all(
    lpWallets.map(async (wallet) => {
      try {
        const cached = _cache.get(wallet.address);
        if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
          return { wallet, positions: cached.positions };
        }
        const { positions } = await getWalletPositions({ wallet_address: wallet.address });
        const pos = positions || [];
        _cache.set(wallet.address, { positions: pos, fetchedAt: Date.now() });
        return { wallet, positions: pos };
      } catch {
        return { wallet, positions: [] };
      }
    })
  );

  // Aggregate by pool
  const poolMap = new Map(); // pool_address -> { wallets: [], pool_name, base_mint }
  for (const { wallet, positions } of results) {
    for (const pos of positions) {
      if (!pos.pool) continue;
      if (!poolMap.has(pos.pool)) {
        poolMap.set(pos.pool, {
          pool_address: pos.pool,
          pool_name:    pos.pair_name || pos.pool_name || pos.pool.slice(0, 8),
          base_mint:    pos.base_mint || null,
          wallets:      [],
        });
      }
      poolMap.get(pos.pool).wallets.push({
        name:     wallet.name,
        category: wallet.category,
        address:  wallet.address,
      });
    }
  }

  // Filter by minWallets, sort by concentration desc
  const qualifying = Array.from(poolMap.values())
    .filter((p) => p.wallets.length >= min_wallets)
    .sort((a, b) => b.wallets.length - a.wallets.length);

  return {
    pools: qualifying.map((p) => ({
      pool_address:  p.pool_address,
      pool_name:     p.pool_name,
      base_mint:     p.base_mint,
      wallet_count:  p.wallets.length,
      wallets:       p.wallets.map((w) => w.name),
      signal:        `${p.wallets.length} smart wallet(s) actively LP-ing here`,
    })),
    total_wallets_checked: lpWallets.length,
    signal: qualifying.length > 0
      ? `Found ${qualifying.length} pool(s) with ≥${min_wallets} smart wallets active`
      : `No pools found with ≥${min_wallets} smart wallets — all tracked wallets idle or in different pools`,
  };
}

export async function checkSmartWalletsOnPool({ pool_address }) {
  const { wallets: allWallets } = loadWallets();
  // Only check LP-type wallets — holder wallets don't have positions
  const wallets = allWallets.filter((w) => !w.type || w.type === "lp");
  if (wallets.length === 0) {
    return {
      pool: pool_address,
      tracked_wallets: 0,
      in_pool: [],
      confidence_boost: false,
      signal: "No smart wallets tracked yet — neutral signal",
    };
  }

  const { getWalletPositions } = await import("./tools/dlmm.js");

  const results = await Promise.all(
    wallets.map(async (wallet) => {
      try {
        const cached = _cache.get(wallet.address);
        if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
          return { wallet, positions: cached.positions };
        }
        const { positions } = await getWalletPositions({ wallet_address: wallet.address });
        _cache.set(wallet.address, { positions: positions || [], fetchedAt: Date.now() });
        return { wallet, positions: positions || [] };
      } catch {
        return { wallet, positions: [] };
      }
    })
  );

  const inPool = results
    .filter((r) => r.positions.some((p) => p.pool === pool_address))
    .map((r) => ({ name: r.wallet.name, category: r.wallet.category, address: r.wallet.address }));

  return {
    pool: pool_address,
    tracked_wallets: wallets.length,
    in_pool: inPool,
    confidence_boost: inPool.length > 0,
    signal: inPool.length > 0
      ? `${inPool.length}/${wallets.length} smart wallet(s) are in this pool: ${inPool.map((w) => w.name).join(", ")} — STRONG signal`
      : `0/${wallets.length} smart wallets in this pool — neutral, rely on fundamentals`,
  };
}
