/**
 * OHLCV via GMGN CLI + EvilPanda technical indicators.
 *
 * Entry signal  (SCREENER) : SuperTrend(10, 3) on 15m candles
 *   → open position only when price is ABOVE SuperTrend (uptrend confirmed)
 *
 * Exit signals  (MANAGER)  : RSI(2) + Bollinger Bands(20, 2) + MACD(12, 26, 9) on 15m candles
 *   → exit when RSI(2) > 90 AND (price closes above BB upper OR MACD first green histogram)
 *   → "Always exit on a GREEN candle" — EvilPanda PDF 3/4/5
 *
 * Requires: GMGN_API_KEY in env, gmgn-cli installed globally.
 */

import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// ─── Cache (3 min — candles age quickly) ─────────────────────────────────────
const _cache = new Map();
const CACHE_TTL_MS = 3 * 60 * 1_000;
const TIMEOUT_MS  = 10_000;

function cacheGet(key) {
  const e = _cache.get(key);
  if (!e) return undefined;
  if (Date.now() > e.expiresAt) { _cache.delete(key); return undefined; }
  return e.value;
}
function cacheSet(key, value) {
  _cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

// ─── Candle fetch ─────────────────────────────────────────────────────────────

/**
 * Fetch OHLCV candles from GMGN CLI.
 * @returns {Array<{time,open,high,low,close,volume}>|null}
 */
export async function fetchCandles(mint, resolution = "15m", limit = 60) {
  const key = `candles:${mint}:${resolution}:${limit}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  const apiKey = process.env.GMGN_API_KEY;
  if (!apiKey) return cacheSet(key, null);

  try {
    const { stdout } = await execAsync(
      `gmgn-cli market kline --chain sol --address ${mint} --resolution ${resolution} --raw`,
      { env: { ...process.env, GMGN_API_KEY: apiKey }, timeout: TIMEOUT_MS }
    );
    const d = JSON.parse(stdout.trim());
    const candles = (d?.list ?? []).map(c => ({
      time:   c.time,
      open:   parseFloat(c.open),
      high:   parseFloat(c.high),
      low:    parseFloat(c.low),
      close:  parseFloat(c.close),
      volume: parseFloat(c.volume),
    })).filter(c => !isNaN(c.close) && c.close > 0);

    return cacheSet(key, candles.length >= 3 ? candles : null);
  } catch {
    return cacheSet(key, null);
  }
}

// ─── Indicator calculations ───────────────────────────────────────────────────

/**
 * Wilder's RMA (Rolling Moving Average) — same as TradingView uses for ATR/SuperTrend.
 */
function rma(values, period) {
  if (values.length < period) return [];
  const result = [];
  let val = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(val);
  for (let i = period; i < values.length; i++) {
    val = (val * (period - 1) + values[i]) / period;
    result.push(val);
  }
  return result; // result[0] corresponds to values[period-1]
}

/**
 * Exponential Moving Average — standard EMA (TradingView style).
 */
function ema(values, period) {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  let val = values[0];
  const result = [val];
  for (let i = 1; i < values.length; i++) {
    val = values[i] * k + val * (1 - k);
    result.push(val);
  }
  return result;
}

/**
 * SuperTrend(period=10, multiplier=3) — EvilPanda's entry signal.
 *
 * @returns {{ direction: 'up'|'down', value: number, price: number, pct_vs_st: string } | null}
 *
 * direction='up'  → price is ABOVE SuperTrend = valid entry window (EvilPanda)
 * direction='down' → price is BELOW SuperTrend = downtrend, avoid opening new position
 */
export function calcSuperTrend(candles, period = 10, multiplier = 3) {
  if (!candles || candles.length < period + 5) return null;

  // True Range
  const tr = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const pc = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
  });

  // ATR via Wilder's RMA
  const atrArr = rma(tr, period);
  // atrArr[0] = ATR at candle[period-1]; atrArr[k] = ATR at candle[period-1+k]
  const startIdx = period - 1; // first candle with valid ATR

  let finalUpper = null;
  let finalLower = null;
  let trend = null; // 1 = up, -1 = down

  for (let i = startIdx; i < candles.length; i++) {
    const atr    = atrArr[i - startIdx];
    const hl2    = (candles[i].high + candles[i].low) / 2;
    const close  = candles[i].close;
    const pClose = i > 0 ? candles[i - 1].close : close;

    const basicUpper = hl2 + multiplier * atr;
    const basicLower = hl2 - multiplier * atr;

    // Adjust bands: only tighten, never widen (prevents whipsaws)
    const newFinalUpper = (finalUpper === null || basicUpper < finalUpper || pClose > finalUpper)
      ? basicUpper : finalUpper;
    const newFinalLower = (finalLower === null || basicLower > finalLower || pClose < finalLower)
      ? basicLower : finalLower;

    // Determine trend direction
    if (trend === null) {
      trend = close > newFinalLower ? 1 : -1;
    } else if (trend === 1 && close < newFinalLower) {
      trend = -1;
    } else if (trend === -1 && close > newFinalUpper) {
      trend = 1;
    }

    finalUpper = newFinalUpper;
    finalLower = newFinalLower;
  }

  if (trend === null) return null;

  const lastClose = candles[candles.length - 1].close;
  const stValue   = trend === 1 ? finalLower : finalUpper;
  const pctVsSt   = stValue > 0 ? ((lastClose - stValue) / stValue * 100).toFixed(1) : null;

  return {
    direction: trend === 1 ? "up" : "down",
    value:     stValue,
    price:     lastClose,
    pct_vs_st: pctVsSt, // positive = price above ST; negative = price below ST
  };
}

/**
 * RSI(period) — EvilPanda uses RSI(2) with upper limit 90 for exit signal.
 * RSI(2) spikes above 90 = strong momentum bounce = optimal exit timing.
 *
 * @returns {number|null} RSI value 0–100
 */
export function calcRsi(candles, period = 2) {
  if (!candles || candles.length < period + 2) return null;

  const closes = candles.map(c => c.close);
  let avgGain = 0, avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) avgGain += diff;
    else           avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;

  // Wilder's smoothing for remaining candles
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff >= 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff <  0 ? -diff : 0)) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/**
 * Bollinger Bands(period=20, stdMult=2).
 * EvilPanda exit: price closes ABOVE upper band = overextended = sell.
 *
 * @returns {{ upper, middle, lower, price, above_upper: boolean } | null}
 */
export function calcBB(candles, period = 20, stdMult = 2) {
  if (!candles || candles.length < period) return null;

  const recent = candles.slice(-period).map(c => c.close);
  const mean   = recent.reduce((a, b) => a + b, 0) / period;
  const variance = recent.reduce((s, x) => s + (x - mean) ** 2, 0) / period;
  const stddev   = Math.sqrt(variance);

  const upper = mean + stdMult * stddev;
  const lower = mean - stdMult * stddev;
  const price = candles[candles.length - 1].close;

  return { upper, middle: mean, lower, price, above_upper: price > upper };
}

/**
 * MACD(fast=12, slow=26, signal=9).
 * EvilPanda exit: first GREEN histogram bar after negative = momentum turning.
 *
 * @returns {{ histogram_last: number, first_green: boolean } | null}
 */
export function calcMACD(candles, fast = 12, slow = 26, signalPeriod = 9) {
  if (!candles || candles.length < slow + signalPeriod + 2) return null;

  const closes    = candles.map(c => c.close);
  const fastEma   = ema(closes, fast);
  const slowEma   = ema(closes, slow);

  // MACD line — align arrays (slow EMA starts later conceptually but EMA is seeded from index 0)
  // In practice both EMAs cover the same length; we just compute MACD = fastEMA - slowEMA
  const macdLine  = fastEma.map((v, i) => v - slowEma[i]);

  // Signal line = EMA(signalPeriod) of MACD line
  const signalLine = ema(macdLine, signalPeriod);

  // Histogram = MACD line - signal line
  const histogram = macdLine.map((v, i) => v - signalLine[i]);

  if (histogram.length < 2) return null;

  const last = histogram[histogram.length - 1];
  const prev = histogram[histogram.length - 2];

  return {
    histogram_last: last,
    first_green: prev < 0 && last >= 0, // first green bar = momentum flip
  };
}

// ─── Convenience wrappers ─────────────────────────────────────────────────────

/**
 * Entry signal for SCREENER.
 * EvilPanda: enter only when price is above SuperTrend (uptrend confirmed).
 *
 * @returns {{ st_direction, st_pct_vs_price, entry_ok: boolean } | null}
 */
export async function getEntrySignal(mint) {
  const candles = await fetchCandles(mint, "15m", 60);
  if (!candles) return null;

  const st = calcSuperTrend(candles);
  if (!st) return null;

  return {
    st_direction:    st.direction,
    st_pct_vs_price: st.pct_vs_st,
    entry_ok:        st.direction === "up", // price above ST = confirmed uptrend
  };
}

/**
 * RSI history — returns last `count` RSI(2) values to show trajectory.
 * Rising RSI from oversold = bounce forming; falling RSI = dump still active.
 *
 * @returns {number[]|null} Array of RSI values (oldest → newest)
 */
export function calcRsiHistory(candles, period = 2, count = 8) {
  if (!candles || candles.length < period + count + 2) return null;
  const result = [];
  for (let i = 0; i < count; i++) {
    const slice = candles.slice(0, -(count - 1 - i));
    if (slice.length < period + 2) continue;
    const val = calcRsi(slice, period);
    if (val != null) result.push(parseFloat(val.toFixed(1)));
  }
  return result.length >= 2 ? result : null;
}

/**
 * MACD histogram trajectory — returns last `count` histogram values.
 * Values rising from negative = momentum recovering toward flip.
 *
 * @returns {number[]|null} Array of histogram values (oldest → newest)
 */
export function calcMACDTrajectory(candles, count = 5, fast = 12, slow = 26, signalPeriod = 9) {
  if (!candles || candles.length < slow + signalPeriod + 2) return null;

  const closes = candles.map(c => c.close);
  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);
  const macdLine = fastEma.map((v, i) => v - slowEma[i]);
  const signalLine = ema(macdLine, signalPeriod);
  const histogram = macdLine.map((v, i) => v - signalLine[i]);

  if (histogram.length < count) return null;
  return histogram.slice(-count).map(v => parseFloat(v.toExponential(3)));
}

/**
 * Assess the current dump/bounce phase from indicator trajectory.
 *
 * This does NOT predict bounce — it describes where we are in the cycle
 * so the agent can HOLD patiently (dump phases) or EXIT (bounce confirmed).
 *
 * Phases:
 *   early_dump     — RSI falling, red candles, volume high → just started
 *   mid_dump       — RSI oversold (<30), red candles persist → accumulate fees
 *   late_dump      — RSI oversold, candle bodies shrinking, volume declining → selling exhaustion
 *   bounce_forming — RSI rising from oversold, mixed candles → momentum shifting
 *   bounce_confirmed — RSI > 70, green candles → bounce happening (watch for exit)
 *   exit_window    — RSI > 90 + confluence → EvilPanda says EXIT
 *   sideways       — RSI 30-70, mixed candles → fee accumulation, hold
 *   uptrend        — RSI > 70, sustained green candles → post-bounce, hold for trailing
 *
 * @returns {{ phase: string, description: string } | null}
 */
function assessDumpPhase(candles, rsiHistory, macdTrajectory, rsi2, bb, macd) {
  if (!candles || candles.length < 4 || !rsiHistory) return null;

  const last8 = candles.slice(-8);
  const greenCount = last8.filter(c => c.close > c.open).length;
  const redCount = last8.length - greenCount;

  // Candle body magnitudes (absolute %) — shrinking bodies = exhaustion
  const bodies = last8.map(c => Math.abs((c.close - c.open) / c.open * 100));
  const avgBodyFirst4 = bodies.slice(0, 4).reduce((a, b) => a + b, 0) / 4;
  const avgBodyLast4 = bodies.slice(-4).reduce((a, b) => a + b, 0) / 4;
  const bodiesShrinking = avgBodyLast4 < avgBodyFirst4 * 0.6;

  // Volume trend: compare last 4 vs previous 4
  const volumes = last8.map(c => c.volume || 0);
  const avgVolFirst4 = volumes.slice(0, 4).reduce((a, b) => a + b, 0) / 4;
  const avgVolLast4 = volumes.slice(-4).reduce((a, b) => a + b, 0) / 4;
  const volumeDeclining = avgVolFirst4 > 0 && avgVolLast4 < avgVolFirst4 * 0.7;

  // RSI trajectory
  const rsiFirst = rsiHistory[0];
  const rsiLast = rsiHistory[rsiHistory.length - 1];
  const rsiRising = rsiLast > rsiFirst + 10;
  const rsiFalling = rsiLast < rsiFirst - 10;
  const rsiOversold = rsiLast < 30;
  const rsiExtremelyOversold = rsiLast < 15;

  // BB distance
  const bbLowerDist = bb?.lower ? ((candles[candles.length - 1].close - bb.lower) / bb.lower * 100) : null;
  const nearBBLower = bbLowerDist != null && bbLowerDist < 3;

  // MACD trajectory
  const macdRecovering = macdTrajectory && macdTrajectory.length >= 3
    && macdTrajectory[macdTrajectory.length - 1] > macdTrajectory[0];

  // ── Phase assessment (ordered by priority) ───────────────────────

  // Exit window: EvilPanda confluence
  const exitConfluence = rsi2 > 90 && ((bb?.above_upper || macd?.first_green) && candles[candles.length - 1].close > candles[candles.length - 1].open);
  if (exitConfluence) return { phase: "exit_window", description: "RSI>90 + confluence + green candle — EXIT NOW per EvilPanda" };

  // Bounce confirmed: strong green momentum
  if (rsiLast > 70 && greenCount >= 5 && rsiRising) return { phase: "bounce_confirmed", description: "Strong green momentum — watch for exit window (RSI>90)" };

  // Bounce forming: RSI rising from oversold, mixed candles, volume declining
  if (rsiRising && (rsiFirst < 40 || rsiOversold) && volumeDeclining) return { phase: "bounce_forming", description: "RSI rising from oversold, volume declining — momentum shifting, hold for exit signal" };

  // Late dump: extremely oversold, bodies shrinking, volume declining
  if (rsiOversold && bodiesShrinking && volumeDeclining) return { phase: "late_dump", description: "Selling exhaustion — RSI oversold, candle bodies shrinking, volume fading. Bounce may come soon." };

  // Mid dump: oversold, red candles dominant
  if (rsiOversold && redCount >= 5) return { phase: "mid_dump", description: "Active dump — RSI oversold, red candles. Collect fees, hold for bounce." };

  // Early dump: RSI falling, fresh red candles, volume still high
  if (rsiFalling && redCount >= 3 && !volumeDeclining) return { phase: "early_dump", description: "Dump just started — RSI falling, volume high. Hold, fees will accumulate." };

  // Uptrend: sustained green
  if (rsiLast > 60 && greenCount >= 6) return { phase: "uptrend", description: "Post-bounce uptrend — hold for fee accumulation or trailing exit." };

  // Sideways: no strong direction
  return { phase: "sideways", description: "No strong trend — fee accumulation phase. Hold." };
}

/**
 * Exit signal for MANAGER (EvilPanda confluence rule) — WITH TREND ANALYSIS.
 *
 * Returns enriched data including indicator history, volume/candle trends,
 * and dump phase assessment. Agent uses this to:
 *   - HOLD patiently during dump phases (early/mid/late)
 *   - EXIT only on CHART_SIGNAL confluence (exit_window)
 *   - CUT only when indicators confirm pool is broken (RSI stuck, volume dead, accelerating dump for hours)
 *
 * EvilPanda: "Don't predict bounce — wait for confluence. Use data to confirm the cycle, not to overthink."
 *
 * @returns {{
 *   rsi2, bb_above_upper, macd_first_green, is_green_candle, candle_body_pct,
 *   bounce_pattern, full_exit_signal, exit_signal, summary,
 *   rsi_history, last_candles, volume_trend, bb_distance_pct, macd_trajectory,
 *   dump_phase, phase_description
 * } | null}
 */
export async function getExitSignal(mint) {
  const candles = await fetchCandles(mint, "15m", 60);
  if (!candles || candles.length < 2) return null;

  const rsi  = calcRsi(candles, 2);
  const bb   = calcBB(candles, 20, 2);
  const macd = calcMACD(candles);

  if (rsi == null) return null;

  // ── Trend data ───────────────────────────────────────────────────
  const rsiHistory      = calcRsiHistory(candles, 2, 8);
  const macdTrajectory  = calcMACDTrajectory(candles, 5);

  // Last 8 candle summaries for trajectory visibility
  const last8 = candles.slice(-8);
  const lastCandles = last8.map(c => {
    const bodyPct = ((c.close - c.open) / c.open * 100);
    const volK = (c.volume || 0) >= 1000 ? `${(c.volume / 1000).toFixed(0)}K` : c.volume.toFixed(0);
    return `${bodyPct > 0 ? "🟢" : "🔴"}${bodyPct > 0 ? "+" : ""}${bodyPct.toFixed(1)}% v${volK}`;
  });

  // Volume trend: declining = seller exhaustion
  const volumes = last8.map(c => c.volume || 0);
  const avgVolFirst = volumes.slice(0, 4).reduce((a, b) => a + b, 0) / 4;
  const avgVolLast = volumes.slice(-4).reduce((a, b) => a + b, 0) / 4;
  const volumeTrend = avgVolFirst > 0
    ? (avgVolLast < avgVolFirst * 0.6 ? "declining" : avgVolLast > avgVolFirst * 1.4 ? "rising" : "stable")
    : "unknown";

  // BB distance
  const lastClose = candles[candles.length - 1].close;
  const bbDistancePct = bb?.lower ? parseFloat(((lastClose - bb.lower) / bb.lower * 100).toFixed(1)) : null;

  // ── Classic EvilPanda confluence ─────────────────────────────────
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const isGreenCandle  = last.close > last.open;
  const candleBodyPct  = parseFloat(((last.close - last.open) / last.open * 100).toFixed(2));
  const bouncePattern  = (prev.close < prev.open) && isGreenCandle;

  const rsi2           = parseFloat(rsi.toFixed(1));
  const bbAboveUpper   = bb?.above_upper ?? false;
  const macdFirstGreen = macd?.first_green ?? false;

  const fullExitSignal    = rsi2 > 90 && (bbAboveUpper || macdFirstGreen) && isGreenCandle;
  const partialExitSignal = rsi2 > 90 && isGreenCandle;

  // ── Dump phase assessment ────────────────────────────────────────
  const phaseInfo = assessDumpPhase(candles, rsiHistory, macdTrajectory, rsi2, bb, macd);

  // ── Build summary ────────────────────────────────────────────────
  const signals = [];
  if (rsi2 > 90)       signals.push(`RSI(2)=${rsi2}`);
  if (bbAboveUpper)    signals.push("price>BB_upper");
  if (macdFirstGreen)  signals.push("MACD_first_green");
  if (isGreenCandle)   signals.push(`green(+${candleBodyPct}%)`);
  if (bouncePattern)   signals.push("bounce_pattern");

  const exitSignal = fullExitSignal || partialExitSignal;

  // Trend-aware summary
  const trendSummary = [
    `rsi2=${rsi2}`,
    `candle=${isGreenCandle ? "🟢" : "🔴"}(${candleBodyPct > 0 ? "+" : ""}${candleBodyPct}%)`,
    `vol=${volumeTrend}`,
    phaseInfo ? `phase=${phaseInfo.phase}` : null,
  ].filter(Boolean).join(" | ");

  return {
    // ── Classic exit fields (existing consumers) ──
    rsi2,
    bb_above_upper:    bbAboveUpper,
    macd_first_green:  macdFirstGreen,
    is_green_candle:   isGreenCandle,
    candle_body_pct:   candleBodyPct,
    bounce_pattern:    bouncePattern,
    full_exit_signal:  fullExitSignal,
    exit_signal:       exitSignal,
    summary: exitSignal
      ? `EXIT WINDOW: ${signals.join(" + ")}`
      : trendSummary,

    // ── NEW: Trend analysis fields ──
    rsi_history:      rsiHistory,
    last_candles:     lastCandles,
    volume_trend:     volumeTrend,
    bb_distance_pct:  bbDistancePct,
    macd_trajectory:  macdTrajectory,
    dump_phase:       phaseInfo?.phase ?? null,
    phase_description: phaseInfo?.description ?? null,
  };
}
