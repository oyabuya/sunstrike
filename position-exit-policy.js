import { activityPerFiveMinutes } from "./evilpanda-policy.js";

export function assessBelowRangeExit({ position, tokenStatus, pool1h, volumeTrend, screening, waitMinutes = 240 }) {
  const activeBin = Number(position?.active_bin);
  const lowerBin = Number(position?.lower_bin);
  if (!Number.isInteger(activeBin) || !Number.isInteger(lowerBin) ||
      activeBin >= lowerBin || (position.minutes_out_of_range ?? 0) < waitMinutes) {
    return { close: false, reason: "below-range wait not complete" };
  }
  if (pool1h?.pool !== position.pool || !Number.isFinite(screening?.minVolume) ||
      !Number.isFinite(screening?.minFeeActiveTvlRatio)) {
    return { close: false, reason: "current pool activity unavailable" };
  }
  const volumeRate = activityPerFiveMinutes(pool1h.volume_window, "1h");
  const feeRate = activityPerFiveMinutes(pool1h.fee_active_tvl_ratio, "1h");
  if (volumeRate == null || feeRate == null) return { close: false, reason: "current pool activity unavailable" };
  if (volumeRate < screening.minVolume * 0.25 && feeRate < screening.minFeeActiveTvlRatio * 0.25) {
    return { close: true, reason: "below range for 4h with volume and fees below one-quarter of entry floors" };
  }
  if (tokenStatus?.status === "selling_pressure" && volumeTrend?.trend_pct <= -50 &&
      feeRate < screening.minFeeActiveTvlRatio) {
    return { close: true, reason: "below range for 4h with selling pressure, falling volume, and weak fees" };
  }
  return { close: false, reason: "activity or recovery case remains plausible" };
}
