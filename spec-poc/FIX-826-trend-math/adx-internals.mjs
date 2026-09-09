/**
 * FIX-826 POC 1 — settle the `trading-signals@7.4.3` ADX internals that §9's
 * gate table rests on. Three questions, all measured, none argued:
 *
 *   Q1  At which bar does each of `adx.value` / `adx.pdi` / `adx.mdi` first
 *       become finite?  (§9 gates the whole strength block at 27.)
 *   Q2  What SCALE do `pdi` / `mdi` arrive on relative to `value`?
 *       (§7 says raw ratios needing ×100.)
 *   Q3  What does a zero-range (constant OHLC) series actually produce?
 *       (§7/§9 say NaN, not a clean absence, because the library's own
 *        `dmSum === 0` guard is compared against NaN.)
 *
 * Run:  node spec-poc/FIX-826-trend-math/adx-internals.mjs
 */
import { createRequire } from "node:module";
import { resolveFromTradingDesk } from "./resolve.mjs";

const require = createRequire(resolveFromTradingDesk());
const { ADX, ATR } = require("trading-signals");
const pkg = require("trading-signals/package.json");

console.log(`trading-signals resolved version: ${pkg.version}\n`);

/** The trading-desk test suite's own bar convention: high = close+range, low = close-range. */
const bar = (close, range = 1) => ({
  open: close,
  high: close + range,
  low: close - range,
  close,
  volume: 1000,
});

const fin = (x) => typeof x === "number" && Number.isFinite(x);

function walk(bars, label) {
  const adx = new ADX(14);
  const rows = [];
  bars.forEach((b, idx) => {
    const result = adx.update(b, false);
    rows.push({
      n: idx + 1, // 1-based count of candles fed
      i: idx, // 0-based array index
      value: result,
      pdi: adx.pdi,
      mdi: adx.mdi,
    });
  });
  const first = (pred) => rows.find(pred)?.n ?? "never";
  console.log(`--- ${label} (${bars.length} bars) ---`);
  console.log(`ADX(14).getRequiredInputs() = ${new ADX(14).getRequiredInputs()}`);
  console.log(`first finite adx.value : bar ${first((r) => fin(r.value))}`);
  console.log(`first finite adx.pdi   : bar ${first((r) => fin(r.pdi))}`);
  console.log(`first finite adx.mdi   : bar ${first((r) => fin(r.mdi))}`);
  return rows;
}

// ---------- Q1 + Q2: a strongly trending series ----------
const rising = Array.from({ length: 40 }, (_, i) => bar(100 + i));
const rows = walk(rising, "monotone rising, range 1");

console.log("\nbar |      value |        pdi |        mdi | pdi*100 | mdi*100");
for (const r of rows) {
  if (r.n < 12 || r.n > 30) continue;
  const f = (x) =>
    x === null || x === undefined
      ? "     null"
      : Number.isNaN(x)
        ? "      NaN"
        : x.toFixed(4).padStart(9);
  const g = (x) => (fin(x) ? (x * 100).toFixed(2).padStart(7) : "   n/a ");
  console.log(
    `${String(r.n).padStart(3)} | ${f(r.value)} | ${f(r.pdi)} | ${f(r.mdi)} | ${g(r.pdi)} | ${g(r.mdi)}`,
  );
}

const stable = rows.at(-1);
console.log(`\nQ2 scale check at the final bar:`);
console.log(`  adx.value = ${stable.value}   <- already ×100 (0..100 oscillator)`);
console.log(`  adx.pdi   = ${stable.pdi}   -> conventional +DI = ${stable.pdi * 100}`);
console.log(`  adx.mdi   = ${stable.mdi}   -> conventional -DI = ${stable.mdi * 100}`);
console.log(
  `  |pdi-mdi|/(pdi+mdi)*100 = ${(Math.abs(stable.pdi - stable.mdi) / (stable.pdi + stable.mdi)) * 100}` +
    `  (this is what DX feeds ADX, and it is scale-invariant --\n` +
    `   which is exactly why the ×100 defect is invisible in \`value\`)`,
);

// ---------- Q1 boundary: the 14..26 window ----------
const band = rows.filter((r) => r.n >= 14 && r.n <= 26);
const allComponentsFinite = band.every((r) => fin(r.pdi) && fin(r.mdi));
const allValuesNull = band.every((r) => r.value === null);
console.log(
  `\nQ1 boundary (bars 14-26): components finite on every bar = ${allComponentsFinite}; ` +
    `adx.value null on every bar = ${allValuesNull}`,
);

// ---------- Q3: the zero-range series ----------
const flat = Array.from({ length: 40 }, () => bar(50, 0));
const flatAdx = new ADX(14);
const flatAtr = new ATR(14);
let flatLast = null;
for (const b of flat) {
  flatLast = flatAdx.update(b, false);
  flatAtr.update(b, false);
}
console.log(`\n--- Q3: constant OHLC series (40 bars, close=50, range=0) ---`);
console.log(`  adx.value = ${flatLast}  (isNaN: ${Number.isNaN(flatLast)})`);
console.log(`  adx.pdi   = ${flatAdx.pdi}  (isNaN: ${Number.isNaN(flatAdx.pdi)})`);
console.log(`  adx.mdi   = ${flatAdx.mdi}  (isNaN: ${Number.isNaN(flatAdx.mdi)})`);
console.log(`  ATR(14)   = ${flatAtr.getResult?.() ?? "n/a"}   <- the extension denominator`);
console.log(
  `  a finite()-style coercion would publish: ${Number.isFinite(flatLast) ? flatLast : 0}  <- the defect`,
);
