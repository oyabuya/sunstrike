import { activityPerFiveMinutes } from "./evilpanda-policy.js";

export function assessTokenMaturity({ pool, tokenInfo }) {
  if (!pool?.base?.mint || tokenInfo?.mint !== pool.base.mint) {
    return { pass: false, reason: "matching Jupiter token data unavailable" };
  }
  const ageHours = Number(pool.token_age_hours);
  const organicScore = Number(tokenInfo.organic_score);
  if (pool.token_age_hours == null || !Number.isFinite(ageHours) || ageHours < 12) {
    return { pass: false, reason: "token age is unknown or below 12 hours" };
  }
  if (tokenInfo.organic_score == null || !Number.isFinite(organicScore) || organicScore < 80) {
    return { pass: false, reason: "Jupiter Organic Score is unknown or below 80" };
  }
  return { pass: true, age_hours: ageHours, jupiter_organic_score: organicScore };
}

function validPositive(value) {
  return value != null && Number.isFinite(Number(value)) && Number(value) > 0;
}

export function assessSustainedActivity({ fiveMinutes, thirtyMinutes, oneHour, screening }) {
  if (!Number.isFinite(screening?.minVolume) || screening.minVolume <= 0 ||
      !Number.isFinite(screening?.minFeeActiveTvlRatio) || screening.minFeeActiveTvlRatio <= 0) {
    return { pass: false, reason: "activity thresholds are invalid" };
  }
  if (!oneHour?.pool || !oneHour.base?.mint) {
    return { pass: false, reason: "fresh 1h pool identity is missing" };
  }
  const validThirty = thirtyMinutes?.pool === oneHour.pool && thirtyMinutes.base?.mint === oneHour.base.mint;
  const validFive = fiveMinutes?.pool === oneHour.pool && fiveMinutes.base?.mint === oneHour.base.mint;
  const volume30mPer5m = activityPerFiveMinutes(validThirty ? thirtyMinutes.volume_window : null, "30m");
  const volume1hPer5m = activityPerFiveMinutes(oneHour.volume_window, "1h");
  const fee30mPer5m = activityPerFiveMinutes(validThirty ? thirtyMinutes.fee_active_tvl_ratio : null, "30m");
  const fee1hPer5m = activityPerFiveMinutes(oneHour.fee_active_tvl_ratio, "1h");
  if (![oneHour.volume_window, oneHour.fee_active_tvl_ratio, oneHour.active_tvl].every(validPositive)) {
    return { pass: false, reason: "fresh 1h volume, fee, or active TVL evidence is missing" };
  }
  const metrics = { volume_5m_usd: validFive ? fiveMinutes.volume_window : null,
    volume_30m_per_5m_usd: volume30mPer5m, volume_1h_per_5m_usd: volume1hPer5m,
    fee_tvl_5m_pct: validFive ? fiveMinutes.fee_active_tvl_ratio : null,
    fee_tvl_30m_per_5m_pct: fee30mPer5m, fee_tvl_1h_per_5m_pct: fee1hPer5m };
  if (volume1hPer5m < screening.minVolume || fee1hPer5m < screening.minFeeActiveTvlRatio) {
    return { pass: false, reason: "1h activity is below the configured 5m-equivalent floor", metrics };
  }
  const cautions = [];
  if (!validThirty ||
      !validPositive(thirtyMinutes.volume_window) || !validPositive(thirtyMinutes.fee_active_tvl_ratio)) {
    cautions.push("30m snapshot missing, mismatched, or incomplete");
  } else if (volume30mPer5m < volume1hPer5m * 0.5 || fee30mPer5m < fee1hPer5m * 0.5) {
    cautions.push("30m activity below half the 1h average");
  }
  if (!validFive) {
    cautions.push("5m snapshot missing or mismatched");
  } else {
    const volume5m = Number(fiveMinutes.volume_window);
    const fee5m = Number(fiveMinutes.fee_active_tvl_ratio);
    if (!Number.isFinite(volume5m) || !Number.isFinite(fee5m)) cautions.push("5m volume or fee evidence missing");
    else if (volume5m < volume1hPer5m * 0.25 || fee5m < fee1hPer5m * 0.25) {
      cautions.push("5m activity below a quarter of the 1h average");
    }
    if (fiveMinutes.unique_traders != null && Number(fiveMinutes.unique_traders) < 5) {
      cautions.push("fewer than five distinct traders in the latest 5m window");
    }
    if (fiveMinutes.price_change_pct != null && Number(fiveMinutes.price_change_pct) <= -5) {
      cautions.push("price fell at least 5% in the latest 5m window");
    }
  }
  return { pass: true, metrics, cautions };
}

// Approved LIVE policy remains unchanged while the 1h-based policy is tested in DRY_RUN.
export function assessFreshActivity({ fiveMinutes, oneHour, screening }) {
  if (!Number.isFinite(screening?.minVolume) || screening.minVolume <= 0 ||
      !Number.isFinite(screening?.minFeeActiveTvlRatio) || screening.minFeeActiveTvlRatio <= 0) {
    return { pass: false, reason: "activity thresholds are invalid" };
  }
  if (!fiveMinutes?.pool || !oneHour?.pool || fiveMinutes.pool !== oneHour.pool ||
      fiveMinutes.base?.mint !== oneHour.base?.mint || !fiveMinutes.base?.mint) {
    return { pass: false, reason: "fresh 5m/1h pool identity is missing or inconsistent" };
  }
  const volume5m = Number(fiveMinutes.volume_window);
  const volume1hPer5m = activityPerFiveMinutes(oneHour.volume_window, "1h");
  const fee5m = Number(fiveMinutes.fee_active_tvl_ratio);
  const fee1hPer5m = activityPerFiveMinutes(oneHour.fee_active_tvl_ratio, "1h");
  if (![fiveMinutes.volume_window, oneHour.volume_window, fiveMinutes.fee_active_tvl_ratio,
    oneHour.fee_active_tvl_ratio, fiveMinutes.active_tvl].every(validPositive)) {
    return { pass: false, reason: "fresh volume, fee, or active TVL evidence is missing" };
  }
  const metrics = { volume_5m_usd: volume5m, volume_1h_per_5m_usd: volume1hPer5m,
    fee_tvl_5m_pct: fee5m, fee_tvl_1h_per_5m_pct: fee1hPer5m };
  if (volume5m < screening.minVolume || fee5m < screening.minFeeActiveTvlRatio ||
      volume1hPer5m < screening.minVolume || fee1hPer5m < screening.minFeeActiveTvlRatio) {
    return { pass: false, reason: "fresh activity is below the configured 5m-equivalent floor", metrics };
  }
  if (volume5m < volume1hPer5m * 0.5 || fee5m < fee1hPer5m * 0.5) {
    return { pass: false, reason: "current 5m activity has fallen below half the 1h average", metrics };
  }
  if (fiveMinutes.unique_traders != null && Number(fiveMinutes.unique_traders) < 5) {
    return { pass: false, reason: "fewer than five distinct traders in the latest 5m window", metrics };
  }
  if (fiveMinutes.price_change_pct != null && Number(fiveMinutes.price_change_pct) <= -5) {
    return { pass: false, reason: "price fell at least 5% in the latest 5m window", metrics };
  }
  return { pass: true, metrics, cautions: [] };
}

export function assessEntryActivity(snapshots, dryRun = process.env.DRY_RUN === "true") {
  return dryRun ? assessSustainedActivity(snapshots) : assessFreshActivity(snapshots);
}

// An intentionally conservative, uncalibrated ranking scenario. It assumes
// four hours of unchanged fees, half of the proportional fee share reaching
// this position, 1% round-trip swap friction and 0.005 SOL network costs.
// Inventory PnL is shown separately as a 5% adverse-price stress case.
export function estimateNetFeeScenario({ pool, amountSol, amountUsd: explicitAmountUsd, solPrice }) {
  const amountUsd = explicitAmountUsd ?? amountSol * solPrice;
  const activity = process.env.DRY_RUN === "true" ? pool?.activity_windows?.["1h"] ?? pool : pool;
  const activeTvl = Number(activity?.active_tvl);
  const feeRate5m = activityPerFiveMinutes(activity?.fee_active_tvl_ratio, activity === pool ? pool?.discovery_timeframe : "1h");
  if (![amountUsd, solPrice, activeTvl, feeRate5m].every(Number.isFinite) ||
      amountUsd <= 0 || solPrice <= 0 || activeTvl <= 0 || feeRate5m <= 0) return null;
  const poolFees5mUsd = activeTvl * feeRate5m / 100;
  const feeShare = amountUsd / (activeTvl + amountUsd);
  const estimatedFees4hUsd = poolFees5mUsd * 48 * feeShare * 0.5;
  const estimatedCostsUsd = amountUsd * 0.01 + solPrice * 0.005;
  const netBeforeInventoryUsd = estimatedFees4hUsd - estimatedCostsUsd;
  return {
    estimated_fees_4h_usd: Number(estimatedFees4hUsd.toFixed(3)),
    estimated_costs_usd: Number(estimatedCostsUsd.toFixed(3)),
    net_before_inventory_usd: Number(netBeforeInventoryUsd.toFixed(3)),
    net_after_5pct_adverse_move_usd: Number((netBeforeInventoryUsd - amountUsd * 0.05).toFixed(3)),
  };
}
