export function assessEmergencyPriceDrawdown({ position, tracked, firstSeenAt = null, now = Date.now() }) {
  const entryBin = Number(tracked?.active_bin_at_deploy);
  const currentBin = Number(position?.active_bin);
  const binStep = Number(tracked?.bin_step);
  if (tracked?.active_bin_at_deploy == null || position?.active_bin == null ||
      !Number.isInteger(entryBin) || !Number.isInteger(currentBin) ||
      !Number.isFinite(binStep) || binStep <= 0) {
    return { available: false, firstSeenAt: null, confirmed: false };
  }
  const drawdownPct = (1 - Math.pow(1 + binStep / 10_000, currentBin - entryBin)) * 100;
  if (!Number.isFinite(drawdownPct) || drawdownPct < 20) {
    return { available: true, drawdownPct, firstSeenAt: null, confirmed: false };
  }
  const startedAt = Number.isFinite(firstSeenAt) ? firstSeenAt : now;
  return { available: true, drawdownPct, firstSeenAt: startedAt,
    confirmed: now - startedAt >= 5 * 60_000 };
}
