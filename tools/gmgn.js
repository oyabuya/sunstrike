/**
 * GMGN CLI wrapper — token security & info via gmgn-cli.
 *
 * Requires:
 *   - GMGN_API_KEY in .env
 *   - gmgn-cli installed globally: npm install -g gmgn-cli
 *
 * Two functions exposed:
 *   getGmgnSecurity(mint) → renounced_mint, top_10_holder_rate, is_honeypot
 *   getGmgnInfo(mint)     → creator_hold_rate, smart_wallets, bundler_pct, rat_trader_pct
 */

import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const TIMEOUT_MS = 8_000;

// ─── In-memory TTL cache (5 min) ────────────────────────────────────────────
const _cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1_000;

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

// ─── Internal CLI runner ─────────────────────────────────────────────────────
async function gmgnCli(subcmd) {
  const key = process.env.GMGN_API_KEY;
  if (!key) return null;
  try {
    const { stdout } = await execAsync(
      `gmgn-cli ${subcmd} --raw`,
      { env: { ...process.env, GMGN_API_KEY: key }, timeout: TIMEOUT_MS }
    );
    return JSON.parse(stdout.trim());
  } catch {
    return null;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Token security from GMGN.
 * Useful for: renounced status, top-10 concentration, honeypot check.
 *
 * @returns {{ top_10_holder_rate, renounced_mint, renounced_freeze, is_honeypot } | null}
 */
export async function getGmgnSecurity(mint) {
  const key = `sec:${mint}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  const d = await gmgnCli(`token security --chain sol --address ${mint}`);
  if (!d) return cacheSet(key, null);

  return cacheSet(key, {
    top_10_holder_rate: d.top_10_holder_rate != null ? parseFloat(d.top_10_holder_rate) : null,
    renounced_mint:     d.renounced_mint     ?? null,
    renounced_freeze:   d.renounced_freeze_account ?? null,
    is_honeypot:        d.is_honeypot        ?? null,
  });
}

/**
 * Token info: creator/dev holding, smart money presence, bundler & rat trader exposure.
 * Proxies for EvilPanda signals: dev dump risk, organic interest, insider danger.
 *
 * @returns {{ creator_hold_rate, dev_hold_rate, bundler_pct, rat_trader_pct, smart_wallets, renowned_wallets } | null}
 */
export async function getGmgnInfo(mint) {
  const key = `info:${mint}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  const d = await gmgnCli(`token info --chain sol --address ${mint}`);
  if (!d) return cacheSet(key, null);

  const stat = d.stat             || {};
  const wt   = d.wallet_tags_stat || {};

  return cacheSet(key, {
    creator_hold_rate:  stat.creator_hold_rate               != null ? parseFloat(stat.creator_hold_rate)               : null,
    dev_hold_rate:      stat.dev_team_hold_rate               != null ? parseFloat(stat.dev_team_hold_rate)               : null,
    bundler_pct:        stat.top_bundler_trader_percentage    != null ? parseFloat(stat.top_bundler_trader_percentage)    : null,
    rat_trader_pct:     stat.top_rat_trader_percentage        != null ? parseFloat(stat.top_rat_trader_percentage)        : null,
    smart_wallets:      wt.smart_wallets   ?? null,
    renowned_wallets:   wt.renowned_wallets ?? null,
  });
}
