/**
 * FIX-1113 — how often would decision 6 withhold a rating?
 *
 * Throwaway. Never merges. Measures period disagreement under decision 6's
 * ACTUAL bounded-distance rule (not strict equality) across every recorded
 * payload in the repo, and separates within-provider from cross-provider.
 *
 * Run: node spec-poc/FIX-1113-period-alignment/measure-disagreement.mjs
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";

const FIX = "labs/trading-desk/fixtures";
const RAW = "labs/trading-desk/test/__fixtures__";
const DAY = 86_400_000;
const days = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / DAY;
const BOUNDS = [7, 31, 92];

console.log("=".repeat(78));
console.log("A. RECORDED STATEMENT PAYLOADS — the desk's own fixture corpus");
console.log("=".repeat(78));
console.log(
  "\nEach ticker's three statements as recorded. Decision 6 asks: do they\n" +
    "share a period? Max pairwise distance decides it.\n",
);

const tickers = readdirSync(FIX).filter(
  (t) => !t.startsWith("_") && !t.includes(".") && existsSync(`${FIX}/${t}`),
);

const rows = [];
for (const t of tickers) {
  const dates = readdirSync(`${FIX}/${t}`);
  for (const d of dates) {
    const dir = `${FIX}/${t}/${d}`;
    const read = (f) =>
      existsSync(`${dir}/${f}`) ? JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) : null;
    const inc = read("income-statement.json");
    const bal = read("balance-sheet.json");
    const cf = read("cashflow.json");
    if (!inc || !bal || !cf) {
      rows.push({ t, d, skip: "missing a statement" });
      continue;
    }
    const ends = { income: inc.asOf, balance: bal.asOf, cashflow: cf.asOf };
    const vals = Object.values(ends).filter(Boolean);
    let maxGap = 0;
    for (const a of vals) for (const b of vals) maxGap = Math.max(maxGap, days(a, b));
    rows.push({ t, d, ends, maxGap, allNull: [inc, bal, cf].every((s) => s.totalAssets === null && s.revenue === null && s.operating === null) });
  }
}

for (const r of rows) {
  if (r.skip) {
    console.log(`  ${r.t.padEnd(6)} ${r.d}  SKIP — ${r.skip}`);
    continue;
  }
  console.log(
    `  ${r.t.padEnd(6)} ${r.d}  income=${r.ends.income}  balance=${r.ends.balance}  cashflow=${r.ends.cashflow}`,
  );
  console.log(`  ${" ".repeat(6)} ${" ".repeat(10)}  max pairwise gap: ${r.maxGap} days`);
}

console.log("\n  Withheld under each candidate bound:");
for (const b of BOUNDS) {
  const measured = rows.filter((r) => !r.skip);
  const withheld = measured.filter((r) => r.maxGap > b);
  console.log(
    `     bound ${String(b).padStart(3)}d -> ${withheld.length} of ${measured.length} would have the rating withheld` +
      (withheld.length ? `  [${withheld.map((r) => r.t).join(", ")}]` : ""),
  );
}

console.log("\n" + "=".repeat(78));
console.log("B. CROSS-PROVIDER — the same company through both raw providers");
console.log("=".repeat(78));

const ANNUAL_MIN = 350;
const g = JSON.parse(readFileSync(`${RAW}/edgar-companyfacts-aapl.json`, "utf8")).facts["us-gaap"];
const entries = (tag) => g[tag]?.units?.USD ?? [];
const between = (s, e) => (Date.parse(e) - Date.parse(s)) / DAY;

// Aligned reader (decision 1): newest annual period end across the core tags.
function edgarAnchor(kind, tags) {
  let best = null;
  for (const tag of tags)
    for (const e of entries(tag)) {
      if (typeof e.val !== "number" || !e.end) continue;
      const annual =
        kind === "instant"
          ? e.start == null && e.fp === "FY"
          : e.start != null && between(e.start, e.end) > ANNUAL_MIN;
      if (!annual) continue;
      if (!best || Date.parse(e.end) > Date.parse(best)) best = e.end;
    }
  return best;
}
const edgar = {
  income: edgarAnchor("duration", ["RevenueFromContractWithCustomerExcludingAssessedTax", "NetIncomeLoss"]),
  balance: edgarAnchor("instant", ["Assets", "StockholdersEquity"]),
  cashflow: edgarAnchor("duration", ["NetCashProvidedByUsedInOperatingActivities"]),
};

const y = JSON.parse(readFileSync(`${RAW}/yahoo-timeseries-aapl.json`, "utf8"));
const idx = new Map();
for (const row of y.timeseries?.result ?? []) {
  const type = row.meta?.type?.[0];
  if (type && Array.isArray(row[type])) idx.set(type, row[type]);
}
const yAnchor = (type) => {
  const p = idx.get(type) ?? [];
  for (let i = p.length - 1; i >= 0; i--)
    if (Number.isFinite(p[i]?.reportedValue?.raw)) return p[i].asOfDate;
  return null;
};
const yahoo = {
  income: yAnchor("annualTotalRevenue"),
  balance: yAnchor("annualTotalAssets"),
  cashflow: yAnchor("annualOperatingCashFlow"),
};

console.log("\n  AAPL, same fiscal year, each provider's aligned anchor:\n");
for (const k of ["income", "balance", "cashflow"]) {
  console.log(
    `     ${k.padEnd(9)} filings=${edgar[k]}   market-data=${yahoo[k]}   gap=${days(edgar[k], yahoo[k])}d`,
  );
}

console.log("\n  WITHIN provider (all three statements from one source):");
for (const [name, set] of [["filings", edgar], ["market-data", yahoo]]) {
  const v = Object.values(set);
  let m = 0;
  for (const a of v) for (const b of v) m = Math.max(m, days(a, b));
  console.log(`     ${name.padEnd(12)} max gap ${m}d  ->  ${m === 0 ? "identical" : "differs"}`);
}

console.log("\n  ACROSS providers (the ladder mixes them — the case decision 6 targets):");
const mixes = [
  ["income=filings, balance=market-data", edgar.income, yahoo.balance],
  ["income=market-data, balance=filings", yahoo.income, edgar.balance],
  ["income=filings, cashflow=market-data", edgar.income, yahoo.cashflow],
];
for (const [label, a, b] of mixes) {
  const gap = days(a, b);
  console.log(
    `     ${label.padEnd(38)} ${a} vs ${b}  gap=${gap}d` +
      `  -> ` +
      BOUNDS.map((x) => `${x}d:${gap > x ? "WITHHELD" : "ok"}`).join(" "),
  );
}

console.log("\n" + "=".repeat(78));
console.log("C. WHAT DRIVES THE DISAGREEMENT WE CAN SEE");
console.log("=".repeat(78));
console.log(`
  The filings source dates AAPL's fiscal year ${edgar.income}.
  The market-data source dates the same year ${yahoo.income}.
  Gap: ${days(edgar.income, yahoo.income)} days — a normalisation difference, not a
  different period. The market-data source reports month-end; the filer's
  52/53-week year ends on the last Saturday of September.

  This is a CALENDAR-CONVENTION skew, and it is systematic per provider
  rather than per company. Under any bound at or above ~7 days it is
  absorbed. Under strict equality every mixed pairing is withheld.
`);
