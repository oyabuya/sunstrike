function number(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function percent(value, fractional = false) {
  const n = number(value);
  if (n == null || n < 0) return null;
  const pct = fractional ? n * 100 : n;
  return pct <= 100 ? pct : null;
}

function maximumKnown(values) {
  const known = values.filter((v) => v != null);
  return known.length ? Math.max(...known) : null;
}

function limit(value, fallback, hardMaximum) {
  if (value == null) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(n, hardMaximum);
}

/** Shared fail-closed token risk gate for discovery and final deploy preflight. */
export function evaluateTokenRisk({
  expectedMint,
  poolMint,
  tokenInfo,
  okxAdvanced,
  okxRisk,
  gmgnSecurity,
  gmgnInfo,
  screening,
}) {
  if (!expectedMint || !poolMint || expectedMint !== poolMint) {
    return { pass: false, reason: "pool base mint does not match the risk-checked mint" };
  }
  if (!tokenInfo || tokenInfo.mint !== poolMint) {
    return { pass: false, reason: "matching token audit data is unavailable" };
  }

  const maxTop10 = limit(screening?.maxTop10Pct, 30, 30);
  const maxBots = limit(screening?.maxBotHoldersPct, 30, 30);
  const maxDev = limit(screening?.maxDevHoldPct, 5, 5);
  const maxBundle = limit(screening?.maxBundlePct, 60, 60);
  const maxRat = limit(screening?.maxRatTraderPct, 30, 30);
  if ([maxTop10, maxBots, maxDev, maxBundle, maxRat].some((v) => v == null)) {
    return { pass: false, reason: "configured token-risk threshold is invalid" };
  }

  const audit = tokenInfo.audit;
  if (!audit || audit.mint_disabled !== true || audit.freeze_disabled !== true) {
    return { pass: false, reason: "mint/freeze authority audit is missing or unsafe" };
  }

  const top10 = maximumKnown([
    percent(audit.top_holders_pct),
    percent(okxAdvanced?.top10_pct),
    percent(gmgnSecurity?.top_10_holder_rate, true),
  ]);
  if (top10 == null) return { pass: false, reason: "top-10 holder concentration is unknown" };
  if (top10 > maxTop10) return { pass: false, reason: `top-10 holder concentration ${top10.toFixed(1)}% exceeds ${maxTop10}%` };

  const bots = percent(audit.bot_holders_pct);
  if (bots == null) return { pass: false, reason: "bot-holder concentration is unknown" };
  if (bots > maxBots) return { pass: false, reason: `bot-holder concentration ${bots.toFixed(1)}% exceeds ${maxBots}%` };

  const devHold = maximumKnown([
    percent(okxAdvanced?.dev_holding_pct),
    percent(gmgnInfo?.creator_hold_rate, true),
    percent(gmgnInfo?.dev_hold_rate, true),
  ]);
  if (devHold != null && devHold > maxDev) return { pass: false, reason: `creator/developer holding ${devHold.toFixed(1)}% exceeds ${maxDev}%` };

  const bundle = maximumKnown([
    percent(okxAdvanced?.bundle_pct),
    percent(gmgnInfo?.bundler_pct),
  ]);
  if (bundle != null && bundle > maxBundle) return { pass: false, reason: `bundler concentration ${bundle.toFixed(1)}% exceeds ${maxBundle}%` };

  const ratTraders = percent(gmgnInfo?.rat_trader_pct);
  if (ratTraders != null && ratTraders > maxRat) return { pass: false, reason: `rat-trader concentration ${ratTraders.toFixed(1)}% exceeds ${maxRat}%` };

  const honeypotStatuses = [
    typeof gmgnSecurity?.is_honeypot === "boolean" ? gmgnSecurity.is_honeypot : null,
    Array.isArray(okxAdvanced?.tags) ? okxAdvanced.tags.includes("honeypot") : null,
  ].filter((v) => v != null);
  if (honeypotStatuses.some(Boolean)) return { pass: false, reason: "token is flagged as a honeypot" };

  if (screening?.requireRenouncedMint !== false && gmgnSecurity?.renounced_mint === false) {
    return { pass: false, reason: "mint authority is not renounced" };
  }

  if (okxRisk?.is_rugpull === true) return { pass: false, reason: "OKX flags liquidity-removal risk" };
  if (okxRisk?.is_wash === true) return { pass: false, reason: "OKX flags wash trading" };

  const riskLevel = number(okxAdvanced?.risk_level);
  if (riskLevel != null && riskLevel >= 4) return { pass: false, reason: `OKX risk level ${riskLevel} is above the allowed range` };

  return { pass: true, metrics: { top10_pct: top10, bot_holders_pct: bots, dev_hold_pct: devHold, bundler_pct: bundle, rat_trader_pct: ratTraders, okx_risk_level: riskLevel } };
}
