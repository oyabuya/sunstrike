import { log, logAction } from "../logger.js";
import { activityPerFiveMinutes } from "../evilpanda-policy.js";

const ENDPOINT = "https://openrouter.ai/api/alpha/decisions";
const MODEL = "typesafe/jev-1.13";

function finite(value) {
  const n = Number(value);
  return value == null || !Number.isFinite(n) ? null : n;
}

export function buildJevShadowRequest(candidates) {
  const pools = candidates.slice(0, 5).map(({ pool, ti, volTrend }, i) => ({
    id: `p${i}`,
    pool_address: pool.pool,
    discovery_timeframe: pool.discovery_timeframe ?? null,
    fee_active_tvl_ratio: finite(pool.fee_active_tvl_ratio),
    fee_active_tvl_ratio_5m_avg: activityPerFiveMinutes(pool.fee_active_tvl_ratio, pool.discovery_timeframe),
    volume_window_usd: finite(pool.volume_window),
    volume_5m_avg_usd: activityPerFiveMinutes(pool.volume_window, pool.discovery_timeframe),
    active_tvl_usd: finite(pool.active_tvl),
    volatility: finite(pool.volatility),
    organic_score: finite(pool.organic_score),
    token_age_hours: finite(pool.token_age_hours),
    price_change_1h_pct: finite(ti?.stats_1h?.price_change),
    price_change_window_pct: finite(pool.price_change_pct),
    volume_change_window_pct: finite(pool.volume_change_pct),
    fee_change_window_pct: finite(pool.fee_change_pct),
    unique_traders: finite(pool.unique_traders),
    holders: finite(pool.holders),
    volume_trend_pct: finite(volTrend?.trend_pct),
    supertrend: pool.st_direction ?? null,
    top10_holders_pct: finite(ti?.audit?.top_holders_pct),
    bot_holders_pct: finite(ti?.audit?.bot_holders_pct),
    bundler_pct: finite(pool.gmgn_bundler_pct ?? pool.bundle_pct),
    candidate_score: finite(pool.candidate_score),
  }));
  const questions = {};
  for (const p of pools) {
    questions[`${p.id}_fees`] = {
      type: "score",
      instructions: `For ${p.id}, how strong is observed fee activity relative to active TVL? Compare the 5m average across windows, and treat longer-window averages as uncertain about current activity. Use only supplied metrics; missing data is uncertain.`,
      criteria: [
        "Weak or unavailable fee evidence relative to active TVL",
        "Some fee activity, but the evidence is mixed or incomplete",
        "Strong observed fee activity relative to active TVL",
      ],
    };
    questions[`${p.id}_momentum`] = {
      type: "score",
      instructions: `For ${p.id}, how favorable is current entry momentum? Use only supplied trend and price metrics; missing data is uncertain.`,
      criteria: [
        "Clear adverse price or volume trend",
        "Mixed, flat, or insufficient momentum evidence",
        "Price and volume evidence supports current upward momentum",
      ],
    };
    questions[`${p.id}_holder_risk`] = {
      type: "score",
      instructions: `For ${p.id}, how concerning is token holder concentration or bot/bundler activity? Missing data is uncertain, not safe.`,
      criteria: [
        "Low concern supported by holder, bot, and bundler evidence",
        "Mixed or incomplete concentration and bot evidence",
        "High concern from concentration, bot, or bundler evidence",
      ],
    };
  }
  return { model: MODEL, state: { pools }, questions };
}

export async function recordJevShadow(candidates, fetcher = fetch, cycleId = null) {
  if (process.env.DRY_RUN !== "true" || process.env.JEV_SHADOW_ENABLED !== "true" || !process.env.OPENROUTER_API_KEY || !candidates.length) return null;
  const request = buildJevShadowRequest(candidates);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetcher(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Jev HTTP ${response.status}`);
    const data = await response.json();
    const scores = request.state.pools.map(({ id, pool_address, candidate_score }) => {
      const read = (dimension) => {
        const answer = data.answers?.[`${id}_${dimension}`];
        if (answer?.type !== "score" || !Number.isFinite(answer.score) || answer.score < 0 || answer.score > 2 || !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1) {
          throw new Error(`Invalid Jev answer for ${id}_${dimension}`);
        }
        return { score: answer.score, confidence: answer.confidence };
      };
      return { pool_address, candidate_score, fees: read("fees"), momentum: read("momentum"), holder_risk: read("holder_risk") };
    });
    logAction({ tool: "jev_shadow", args: { cycle_id: cycleId, model: MODEL, pools: request.state.pools }, result: { scores, served_model: data.model ?? null, input_tokens: data.usage?.input_tokens ?? null, cost_usd: data.usage?.cost ?? null }, success: true });
    return scores;
  } catch (error) {
    // Do not log provider text: it may echo the request or credentials.
    const reason = error.name === "AbortError" ? "timeout" : /^Jev HTTP \d+$/.test(error.message) ? error.message : "invalid_response_or_network_error";
    logAction({ tool: "jev_shadow", args: { cycle_id: cycleId, model: MODEL, pool_addresses: request.state.pools.map((p) => p.pool_address) }, result: { error: reason }, success: false });
    return null;
  } finally {
    clearTimeout(timer);
  }
}
