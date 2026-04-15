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
 * Exit signal for MANAGER (EvilPanda confluence rule).
 * Fires when RSI(2) > 90 AND (price above BB upper OR MACD first green).
 *
 * @returns {{
 *   rsi2: number,
 *   bb_above_upper: boolean,
 *   macd_first_green: boolean,
 *   exit_signal: boolean,   ← true = EvilPanda says this is an exit window
 *   summary: string
 * } | null}
 */
export async function getExitSignal(mint) {
  const candles = await fetchCandles(mint, "15m", 60);
  if (!candles || candles.length < 2) return null;

  const rsi  = calcRsi(candles, 2);
  const bb   = calcBB(candles, 20, 2);
  const macd = calcMACD(candles);

  if (rsi == null) return null;

  // ── Green candle check (EvilPanda core rule) ─────────────────────────────
  // "Always exit on a GREEN candle, no matter the timeframe."
  // Green = current 15m candle closed higher than it opened.
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const isGreenCandle  = last.close > last.open;
  const candleBodyPct  = parseFloat(((last.close - last.open) / last.open * 100).toFixed(2));
  // Previous candle was red (dump candle) — current is green = classic bounce signal
  const bouncePattern  = (prev.close < prev.open) && isGreenCandle;

  const rsi2           = parseFloat(rsi.toFixed(1));
  const bbAboveUpper   = bb?.above_upper ?? false;
  const macdFirstGreen = macd?.first_green ?? false;

  // ── EvilPanda exit: confluence + green candle ────────────────────────────
  // Full signal: RSI(2) > 90 AND (BB upper OR MACD green) AND current candle is green
  // Partial signal: RSI(2) > 90 AND green candle (weaker but valid per EvilPanda)
  const fullExitSignal    = rsi2 > 90 && (bbAboveUpper || macdFirstGreen) && isGreenCandle;
  const partialExitSignal = rsi2 > 90 && isGreenCandle;

  const signals = [];
  if (rsi2 > 90)       signals.push(`RSI(2)=${rsi2}`);
  if (bbAboveUpper)    signals.push("price>BB_upper");
  if (macdFirstGreen)  signals.push("MACD_first_green");
  if (isGreenCandle)   signals.push(`green_candle(+${candleBodyPct}%)`);
  if (bouncePattern)   signals.push("bounce_pattern");

  const exitSignal = fullExitSignal || partialExitSignal;

  return {
    rsi2,
    bb_above_upper:    bbAboveUpper,
    macd_first_green:  macdFirstGreen,
    is_green_candle:   isGreenCandle,
    candle_body_pct:   candleBodyPct,
    bounce_pattern:    bouncePattern,
    full_exit_signal:  fullExitSignal,   // RSI+BB/MACD+green (kuat)
    exit_signal:       exitSignal,        // RSI+green minimum (cukup per EvilPanda)
    summary: exitSignal
      ? `EXIT WINDOW: ${signals.join(" + ")}`
      : `rsi2=${rsi2}, candle=${isGreenCandle ? "🟢" : "🔴"}(${candleBodyPct > 0 ? "+" : ""}${candleBodyPct}%)`,
  };
}
