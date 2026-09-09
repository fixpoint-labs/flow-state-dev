/**
 * FIX-826 POC 2 — re-derive §10's slope / extension goldens from scratch.
 *
 * Round 5 corrected this table after round 4 shipped it off-by-one. §13's rule
 * is that a golden comes from the code path the test executes, never from a
 * parallel derivation — so this runs `trading-signals`' SMA and ATR over the
 * literal fixture expressions §10 states, and ALSO cross-checks BOTH series
 * bar-by-bar against independent naive derivations. Two independent methods
 * that agree is the check; one method plus plausibility is not.
 *
 * Round 7 added the ATR leg. Until then only the SMA had a second derivation,
 * so the two extension goldens (±12.25) were library-confirms-library while
 * §10 claimed all fifteen were cross-checked. The naive ATR here is Wilder's
 * textbook definition written from the formula, not transcribed from the
 * library's source, so agreement is evidence rather than tautology.
 *
 * Run:  node spec-poc/FIX-826-trend-math/goldens.mjs
 */
import { createRequire } from "node:module";
import { resolveFromTradingDesk } from "./resolve.mjs";

const require = createRequire(resolveFromTradingDesk());
const { SMA, ATR } = require("trading-signals");

/** The trading-desk test suite's bar helper: high = close+range, low = close-range. */
const bar = (close, range = 1) => ({
  open: close,
  high: close + range,
  low: close - range,
  close,
  volume: 1000,
});

/** SMA series via the library — the path `simpleMovingAverage()` wraps. */
function smaSeries(closes, period) {
  const sma = new SMA(period);
  return closes.map((c) => sma.update(c, false));
}

/** SMA series via an independent naive trailing mean. No library involved. */
function naiveSmaSeries(closes, period) {
  return closes.map((_, i) => {
    if (i + 1 < period) return null;
    const window = closes.slice(i + 1 - period, i + 1);
    return window.reduce((a, b) => a + b, 0) / period;
  });
}

function atrAt(closes, period, range = 1) {
  const atr = new ATR(period);
  let last = null;
  for (const c of closes) last = atr.update(bar(c, range), false);
  return last;
}

/**
 * True-range series via Wilder's textbook definition. No library involved.
 *
 * TR_0 = high - low (no prior close to reach back to); thereafter
 * TR_i = max(high-low, |high - close_{i-1}|, |low - close_{i-1}|).
 */
function naiveTrueRangeSeries(closes, range = 1) {
  return closes.map((c, i) => {
    const { high, low } = bar(c, range);
    if (i === 0) return high - low;
    const prevClose = closes[i - 1];
    return Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
  });
}

/**
 * ATR series via Wilder's smoothing, written from the textbook rather than
 * from the library's source: seed at index `period-1` with the simple mean of
 * the first `period` true ranges, then ATR_i = (ATR_{i-1}*(period-1) + TR_i)/period.
 * Null before the seed bar.
 */
function naiveAtrSeries(closes, period, range = 1) {
  const tr = naiveTrueRangeSeries(closes, range);
  const out = new Array(closes.length).fill(null);
  if (tr.length < period) return out;
  let acc = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = acc;
  for (let i = period; i < tr.length; i++) {
    acc = (acc * (period - 1) + tr[i]) / period;
    out[i] = acc;
  }
  return out;
}

/** ATR series via the library, bar by bar — the path `atr()` wraps. */
function libAtrSeries(closes, period, range = 1) {
  const atr = new ATR(period);
  return closes.map((c) => atr.update(bar(c, range), false));
}

const L = 20; // §7's slope lookback
const round3 = (x) => (x === null ? null : Math.round(x * 1000) / 1000);

const fixtures = [
  { name: "rising,  100 + i", closes: Array.from({ length: 70 }, (_, i) => 100 + i) },
  { name: "falling, 200 - i", closes: Array.from({ length: 70 }, (_, i) => 200 - i) },
  { name: "flat,    150", closes: Array.from({ length: 70 }, () => 150) },
];

console.log("Fixture expression: Array.from({ length: 70 }, (_, i) => ...)  => i runs 0..69\n");

let mismatchTotal = 0;
let atrMismatchTotal = 0;

/** Bar-by-bar agreement between two nullable series. */
function countMismatches(a, b) {
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === null || y === null) {
      if ((x === null) !== (y === null)) n++;
      continue;
    }
    if (Math.abs(x - y) > 1e-9) n++;
  }
  return n;
}

for (const { name, closes } of fixtures) {
  const lib = smaSeries(closes, 50);
  const naive = naiveSmaSeries(closes, 50);

  // --- cross-check the two independent SMA derivations, bar by bar ---
  const mismatches = countMismatches(lib, naive);
  mismatchTotal += mismatches;

  // --- and the two independent ATR derivations, bar by bar ---
  const libAtr = libAtrSeries(closes, 14);
  const naiveAtr = naiveAtrSeries(closes, 14);
  const atrMismatches = countMismatches(libAtr, naiveAtr);
  atrMismatchTotal += atrMismatches;

  const t = closes.length - 1; // 69
  const smaT = lib[t];
  const smaPrev = lib[t - L]; // index 49
  const atr = atrAt(closes, 14);
  const atrNaive = naiveAtr[t];

  // §7's stated formula: older endpoint is the denominator, result ×100.
  const slope = smaPrev === 0 ? null : ((smaT - smaPrev) / smaPrev) * 100;

  // The three break modes §10 tabulates.
  const reversed = smaT === 0 ? null : ((smaPrev - smaT) / smaT) * 100;
  const rawDelta = smaT - smaPrev;
  const asFraction = smaPrev === 0 ? null : (smaT - smaPrev) / smaPrev;

  const extension = atr === 0 || !Number.isFinite(atr) ? null : (closes[t] - smaT) / atr;
  // The same extension computed entirely off the naive derivations — naive SMA
  // over naive Wilder ATR, no library on either leg. If this disagrees with the
  // library figure, the golden rests on one method and §10 must not claim two.
  const extensionNaive =
    atrNaive === 0 || !Number.isFinite(atrNaive) ? null : (closes[t] - naive[t]) / atrNaive;

  console.log(`--- ${name} ---`);
  console.log(`  closes[0]=${closes[0]}  closes[69]=${closes[t]}`);
  console.log(`  SMA-50 series: library vs naive mean    -> ${mismatches} mismatches over ${closes.length} bars`);
  console.log(`  ATR-14 series: library vs naive Wilder  -> ${atrMismatches} mismatches over ${closes.length} bars`);
  console.log(`  first bar SMA-50 exists (0-based index): ${lib.findIndex((v) => v !== null)}`);
  console.log(`  first bar ATR-14 exists (0-based index): ${libAtr.findIndex((v) => v !== null)}`);
  console.log(`  sma50[t]      = ${smaT}`);
  console.log(`  sma50[t-20]   = ${smaPrev}`);
  console.log(`  atr14[t]      = ${atr}   (naive Wilder: ${atrNaive})`);
  console.log(`  close[t]      = ${closes[t]}`);
  console.log(`  => sma50Pct20      = ${round3(slope)}`);
  console.log(`     reversed        = ${round3(reversed)}`);
  console.log(`     raw delta       = ${round3(rawDelta)}`);
  console.log(`     left a fraction = ${round3(asFraction)}`);
  console.log(`  => extensionSma50Atr = ${round3(extension)}   (naive both legs: ${round3(extensionNaive)})`);

  // --- separation check: can one equality assertion tell the four apart? ---
  const modes = { correct: slope, reversed, rawDelta, asFraction };
  const names = Object.keys(modes);
  const collisions = [];
  for (let a = 0; a < names.length; a++) {
    for (let b = a + 1; b < names.length; b++) {
      const d = Math.abs(modes[names[a]] - modes[names[b]]);
      if (d <= 0.001) collisions.push(`${names[a]}~${names[b]} (Δ=${d})`);
    }
  }
  console.log(
    `  separation: ${collisions.length === 0 ? "all 6 pairs > 0.001 apart" : `COLLIDES: ${collisions.join(", ")}`}\n`,
  );
}

console.log(`TOTAL library-vs-naive SMA mismatches across all fixtures: ${mismatchTotal}`);
console.log(`TOTAL library-vs-naive ATR mismatches across all fixtures: ${atrMismatchTotal}`);

// ---------------------------------------------------------------------------
// The ATR agreement above is real but DEGENERATE, and saying so matters more
// than the clean number: on a monotone series built with bar(close, 1) every
// true range is exactly 2.0 (high-low = 2, |high - prevClose| = 2,
// |low - prevClose| = 0), so Wilder's recursion is fed a constant and ANY
// correct averaging scheme returns 2.0. That is enough to confirm §10's
// ±12.25 goldens — which is what those rows need — but it does not
// discriminate Wilder smoothing from a simple mean or an EMA.
//
// So probe the smoothing itself on a series whose true range actually varies.
// This is not a §10 golden; it exists to make the cross-check meaningful.
// ---------------------------------------------------------------------------
console.log("\n=== ATR method probe: a series whose true range VARIES ===");
{
  // Ranges cycle 1,2,3,4 and closes wander, so TR changes bar to bar.
  const closes = Array.from({ length: 70 }, (_, i) => 100 + Math.round(10 * Math.sin(i / 3)));
  const ranges = Array.from({ length: 70 }, (_, i) => 1 + (i % 4));

  const libSeries = (() => {
    const atr = new ATR(14);
    return closes.map((c, i) => atr.update(bar(c, ranges[i]), false));
  })();

  const naiveSeries = (() => {
    const tr = closes.map((c, i) => {
      const { high, low } = bar(c, ranges[i]);
      if (i === 0) return high - low;
      const p = closes[i - 1];
      return Math.max(high - low, Math.abs(high - p), Math.abs(low - p));
    });
    const out = new Array(closes.length).fill(null);
    let acc = tr.slice(0, 14).reduce((a, b) => a + b, 0) / 14;
    out[13] = acc;
    for (let i = 14; i < tr.length; i++) {
      acc = (acc * 13 + tr[i]) / 14;
      out[i] = acc;
    }
    return out;
  })();

  const distinctTr = new Set(
    closes.map((c, i) => {
      const { high, low } = bar(c, ranges[i]);
      if (i === 0) return high - low;
      const p = closes[i - 1];
      return Math.max(high - low, Math.abs(high - p), Math.abs(low - p));
    }),
  );

  const n = countMismatches(libSeries, naiveSeries);
  console.log(`  distinct true-range values in this series: ${distinctTr.size} (monotone fixtures have 1)`);
  console.log(`  ATR-14 library vs naive Wilder -> ${n} mismatches over ${closes.length} bars`);
  console.log(`  atr14[last]: library=${libSeries[69]}  naive=${naiveSeries[69]}`);

  // A control: if the naive derivation used a SIMPLE mean instead of Wilder's
  // recursion, would it still agree? If yes, this probe proves nothing either.
  const simpleMeanSeries = (() => {
    const tr = closes.map((c, i) => {
      const { high, low } = bar(c, ranges[i]);
      if (i === 0) return high - low;
      const p = closes[i - 1];
      return Math.max(high - low, Math.abs(high - p), Math.abs(low - p));
    });
    return tr.map((_, i) =>
      i < 13 ? null : tr.slice(i - 13, i + 1).reduce((a, b) => a + b, 0) / 14,
    );
  })();
  const control = countMismatches(libSeries, simpleMeanSeries);
  console.log(
    `  CONTROL — library vs a plain trailing mean -> ${control} mismatches` +
      ` (must be > 0, else the probe cannot tell smoothing schemes apart)`,
  );
}

// --- what §10 claims, checked mechanically ---
console.log("\n=== §10 table as written, vs measured ===");
const claimed = [
  { row: "rising  sma50[t]", claim: 144.5 },
  { row: "rising  sma50[t-20]", claim: 124.5 },
  { row: "rising  sma50Pct20", claim: 16.064 },
  { row: "rising  reversed", claim: -13.841 },
  { row: "rising  rawDelta", claim: 20.0 },
  { row: "rising  fraction", claim: 0.161 },
  { row: "rising  extension", claim: 12.25 },
  { row: "rising  extension (naive)", claim: 12.25 },
  { row: "falling sma50[t]", claim: 155.5 },
  { row: "falling sma50[t-20]", claim: 175.5 },
  { row: "falling sma50Pct20", claim: -11.396 },
  { row: "falling reversed", claim: 12.862 },
  { row: "falling rawDelta", claim: -20.0 },
  { row: "falling fraction", claim: -0.114 },
  { row: "falling extension", claim: -12.25 },
  { row: "falling extension (naive)", claim: -12.25 },
  { row: "flat    sma50Pct20", claim: 0.0 },
];

const r = fixtures[0].closes;
const f = fixtures[1].closes;
const libR = smaSeries(r, 50);
const libF = smaSeries(f, 50);
const measured = {
  "rising  sma50[t]": libR[69],
  "rising  sma50[t-20]": libR[49],
  "rising  sma50Pct20": round3(((libR[69] - libR[49]) / libR[49]) * 100),
  "rising  reversed": round3(((libR[49] - libR[69]) / libR[69]) * 100),
  "rising  rawDelta": round3(libR[69] - libR[49]),
  "rising  fraction": round3((libR[69] - libR[49]) / libR[49]),
  "rising  extension": round3((r[69] - libR[69]) / atrAt(r, 14)),
  "rising  extension (naive)": round3(
    (r[69] - naiveSmaSeries(r, 50)[69]) / naiveAtrSeries(r, 14)[69],
  ),
  "falling sma50[t]": libF[69],
  "falling sma50[t-20]": libF[49],
  "falling sma50Pct20": round3(((libF[69] - libF[49]) / libF[49]) * 100),
  "falling reversed": round3(((libF[49] - libF[69]) / libF[69]) * 100),
  "falling rawDelta": round3(libF[69] - libF[49]),
  "falling fraction": round3((libF[69] - libF[49]) / libF[49]),
  "falling extension": round3((f[69] - libF[69]) / atrAt(f, 14)),
  "falling extension (naive)": round3(
    (f[69] - naiveSmaSeries(f, 50)[69]) / naiveAtrSeries(f, 14)[69],
  ),
  "flat    sma50Pct20": round3(
    ((smaSeries(fixtures[2].closes, 50)[69] - smaSeries(fixtures[2].closes, 50)[49]) /
      smaSeries(fixtures[2].closes, 50)[49]) *
      100,
  ),
};

let bad = 0;
for (const { row, claim } of claimed) {
  const got = measured[row];
  const ok = Math.abs(got - claim) < 1e-9;
  if (!ok) bad++;
  console.log(`  ${ok ? "OK  " : "WRONG"}  ${row.padEnd(22)} spec=${String(claim).padStart(9)}  measured=${got}`);
}
console.log(`\n${bad === 0 ? "ALL §10 GOLDENS CONFIRMED" : `${bad} GOLDEN(S) WRONG`}`);
