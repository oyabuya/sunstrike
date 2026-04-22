import { config } from "./config.js";

const DEFAULT_BINS_ABOVE = 10;

export function computeEvilPandaDeployPlan({ volatility = null, binStep = null } = {}) {
  const v = Number(volatility);
  const step = Number(binStep);
  const safeVol = Number.isFinite(v) && v > 0 ? v : 0;
  const safeStep = Number.isFinite(step) && step > 0 ? step : 80;

  let binsBelow = Math.round((100 + (safeVol / 5) * 50) / (safeStep / 100));
  if (safeStep >= 50) binsBelow = Math.round(binsBelow * 1.2);
  binsBelow = Math.min(300, Math.max(20, binsBelow));

  const downsidePct = Number((binsBelow * safeStep / 100).toFixed(1));

  return {
    strategy: "spot",
    bins_below: binsBelow,
    bins_above: DEFAULT_BINS_ABOVE,
    total_bins: binsBelow + DEFAULT_BINS_ABOVE,
    downside_buffer_pct: downsidePct,
  };
}

export function formatEvilPandaDeployPlan(plan) {
  if (!plan) return "strategy=spot, bins_below=auto, bins_above=10";
  return `strategy=${plan.strategy}, bins_below=${plan.bins_below}, bins_above=${plan.bins_above}, downside_buffer=${plan.downside_buffer_pct}%`;
}

export function scoreEvilPandaCandidate(pool = {}) {
  let score = 0;
  const fee = Number(pool.fee_active_tvl_ratio);
  const volume = Number(pool.volume_window);
  const vol = Number(pool.volatility);
  const smartWallets = Number(pool.gmgn_smart_wallets);
  const top10 = pool.gmgn_top10 != null ? Number(pool.gmgn_top10) * 100 : null;
  const bundler = pool.gmgn_bundler_pct != null ? Number(pool.gmgn_bundler_pct) : null;
  const ath = pool.price_vs_ath_pct != null ? Number(pool.price_vs_ath_pct) : null;

  if (Number.isFinite(fee)) {
    if (fee >= 0.2) score += 26;
    else if (fee >= 0.1) score += 20;
    else if (fee >= 0.05) score += 12;
    else score -= 8;
  }

  if (Number.isFinite(volume)) {
    if (volume >= 1_000_000) score += 14;
    else if (volume >= 250_000) score += 10;
    else if (volume >= 50_000) score += 4;
  }

  if (pool.smart_money_buy) score += 10;
  if (pool.kol_in_clusters) score += 6;
  if (Number.isFinite(smartWallets) && smartWallets > 0) score += Math.min(8, smartWallets * 2);
  if (pool.dev_sold_all) score += 6;

  if (pool.st_direction === "up") score += 8;
  else if (pool.st_direction === "down") score -= 8;

  if (pool.bundle_pct != null) {
    const bundle = Number(pool.bundle_pct);
    if (bundle <= 40) score += 5;
    else if (bundle <= 60) score -= 2;
    else score -= 10;
  } else if (pool.gmgn_bundler_pct != null) {
    if (pool.gmgn_bundler_pct <= 40) score += 5;
    else if (pool.gmgn_bundler_pct <= 60) score -= 2;
    else score -= 10;
  }

  if (top10 != null) {
    if (top10 <= 20) score += 6;
    else if (top10 <= 30) score += 2;
    else score -= 10;
  }

  if (ath != null) {
    if (ath <= 65) score += 5;
    else if (ath <= 80) score += 2;
    else score -= 6;
  }

  if (Number.isFinite(vol)) {
    if (vol <= 2) score += 2;
    else if (vol <= 4) score += 4;
    else score -= 2;
  }

  if (pool.bundler_caution_flag) score -= 2;
  if (pool.st_caution_flag) score -= 4;
  if (pool.vol_trend_caution_flag) score -= 3;
  if (pool.cto_flagged_okx || pool.cto_flagged_dexscreener) score -= 1;
  if (pool.is_rugpull === true) score -= 25;
  if (pool.is_wash === true) score -= 25;
  if (pool.gmgn_honeypot === true) score -= 50;

  return score;
}

export function getRelaxedEvilPandaOverrides(screening = config.screening) {
  return {
    minVolume: Math.max(25_000, Math.floor((screening?.minVolume ?? 1_000_000) * 0.15)),
    minFeeActiveTvlRatio: Math.max(0.015, Number((screening?.minFeeActiveTvlRatio ?? 0.05) * 0.4)),
    minTokenAgeHours: Math.min(screening?.minTokenAgeHours ?? 12, 3),
    maxTokenAgeHours: Math.max(screening?.maxTokenAgeHours ?? 72, 168),
    maxVolatility: Math.max(screening?.maxVolatility ?? 4, 6.5),
    minVolChangePct: 0,
  };
}

export function getEvilPandaThresholds(screening = config.screening) {
  return {
    maxDevHoldPct: Math.max(screening?.maxDevHoldPct ?? 5, 5),
    maxTop10Pct: Math.max(screening?.maxTop10Pct ?? 30, 45),
    maxRatTraderPct: Math.max(screening?.maxRatTraderPct ?? 30, 30),
    maxBundlerSoftPct: 45,
    maxBundlerHardPct: 70,
    minVolumeTrendPct: 10,
    severeVolumeTrendPct: -50,
  };
}
