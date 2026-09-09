/**
 * FIX-826 POC 3 — what does widening the price window 1y -> 2y actually change?
 *
 * Decision 2 claims "No number the desk already publishes changes value because
 * of this issue." Round 7 found that claim false twice already (the memo's
 * `trend` metric key; the shared price-fetch cache entry). This settles the
 * third and largest version of it EMPIRICALLY rather than by argument: feed the
 * SAME final bars to each indicator with 1y vs 2y of leading history and print
 * which published fields move.
 *
 * The distinction that matters:
 *   - trailing-window indicators (SMA, Bollinger, VWMA, Stochastic) read a fixed
 *     number of recent bars, so more leading history cannot change them;
 *   - recursively-smoothed indicators (RSI, MACD, ATR — all Wilder/EMA) carry a
 *     warm-up that converges exponentially, so they move by a vanishing amount;
 *   - CUMULATIVE indicators (OBV) sum from the first bar, so they move outright.
 *
 * Run:  node spec-poc/FIX-826-trend-math/window-widening.mjs
 */
import { createRequire } from "node:module";
import { resolveFromTradingDesk } from "./resolve.mjs";

const require = createRequire(resolveFromTradingDesk());
const { SMA, RSI, MACD, EMA, ATR, OBV, BollingerBands, StochasticOscillator } = require("trading-signals");

const bar = (close, range = 1, volume = 1000) => ({
  open: close,
  high: close + range,
  low: close - range,
  close,
  volume,
});

/** A deterministic pseudo-random walk — no seeded-RNG dependency. */
function series(n) {
  const out = [];
  let px = 100;
  for (let i = 0; i < n; i++) {
    px += Math.sin(i / 7) * 1.5 + Math.cos(i / 3) * 0.8;
    out.push(bar(Number(px.toFixed(4)), 1 + (i % 3), 1000 + ((i * 37) % 500)));
  }
  return out;
}

const last = (ind, bars, pick = (b) => b.close) => {
  let v = null;
  for (const b of bars) v = ind.update(pick(b), false);
  return v;
};

/** 2 years ~= 500 trading bars; 1 year ~= 260. Same TAIL, different lead-in. */
const FULL = series(500);
const oneYear = FULL.slice(-260);
const twoYear = FULL;

function compute(bars) {
  const closes = bars.map((b) => b.close);
  // Mirrors indicators-math.ts's own construction exactly.
  const macdOut = (() => {
    const m = new MACD(new EMA(12), new EMA(26), new EMA(9));
    let v = null;
    for (const c of closes) {
      const out = m.add(c);
      if (out) v = out;
    }
    return v;
  })();
  const bb = (() => {
    const b = new BollingerBands(20, 2);
    let v = null;
    for (const c of closes) v = b.update(c, false);
    return v;
  })();
  const st = (() => {
    const s = new StochasticOscillator(14, 3, 3);
    let v = null;
    for (const b2 of bars) v = s.update(b2, false);
    return v;
  })();
  return {
    sma50: last(new SMA(50), bars),
    sma200: last(new SMA(200), bars),
    rsi14: last(new RSI(14), bars),
    atr14: last(new ATR(14), bars, (b) => b),
    obv: last(new OBV(2), bars, (b) => b),
    macdLine: macdOut ? Number(macdOut.macd) : null,
    bbMiddle: bb ? Number(bb.middle) : null,
    stochK: st ? Number(st.stochK ?? st.k) : null,
  };
}

const a = compute(oneYear);
const b = compute(twoYear);

console.log(`Same final bar in both runs: close=${FULL[FULL.length - 1].close}`);
console.log(`1y run: ${oneYear.length} bars    2y run: ${twoYear.length} bars\n`);

const rows = Object.keys(a);
const pad = (s, n) => String(s).padEnd(n);
console.log(`${pad("field", 10)} ${pad("1y (260 bars)", 24)} ${pad("2y (500 bars)", 24)} verdict`);
let moved = [];
for (const k of rows) {
  const x = a[k] === null ? null : Number(a[k]);
  const y = b[k] === null ? null : Number(b[k]);
  let verdict;
  if (x === null || y === null) verdict = "n/a";
  else if (x === y) verdict = "IDENTICAL";
  else {
    const rel = Math.abs(y - x) / (Math.abs(x) || 1);
    verdict = rel < 1e-9 ? `negligible (rel ${rel.toExponential(1)})` : `MOVED (rel ${rel.toExponential(2)})`;
    if (rel >= 1e-9) moved.push(k);
  }
  console.log(`${pad(k, 10)} ${pad(x, 24)} ${pad(y, 24)} ${verdict}`);
}

console.log(`\nFields that MOVE on a window widening: ${moved.length ? moved.join(", ") : "(none)"}`);
console.log(
  "\nsetup-score.ts:94-105 momentumSub reads `trend` (+/-20) and the sma50>sma200\n" +
    "ordering (+/-10). Both are trailing-window reads, so a widening alone does not\n" +
    "move them. A fixture REGENERATION is the separate hazard: it replaces the\n" +
    "authored sma50/sma200/trend outright.",
);
