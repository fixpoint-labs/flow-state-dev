/**
 * FIX-1113 spec POC — characterization, not a proposal.
 *
 * Throwaway. Never merges. It answers one question the spec's §10 rests on:
 *
 *   Can the repo's existing fixtures show the period-mixing defect at all?
 *
 * It runs the REAL selection rules (copied verbatim from
 * `labs/trading-desk/lib/providers/edgar-companyfacts.ts` and
 * `yahoo-timeseries.ts`, marked below) against two inputs:
 *
 *   A. the committed AAPL fixtures — symmetric and complete
 *   B. the same filing with ONE tag missing from the newest 10-K
 *
 * Run:  node spec-poc/FIX-1113-period-alignment/characterize.mjs
 */
import { readFileSync } from "node:fs";

const EDGAR = "labs/trading-desk/test/__fixtures__/edgar-companyfacts-aapl.json";
const YAHOO = "labs/trading-desk/test/__fixtures__/yahoo-timeseries-aapl.json";

// ---------------------------------------------------------------------------
// Selection rules, copied verbatim from the shipping mappers.
// ---------------------------------------------------------------------------
const ANNUAL_MIN_DAYS = 350;
const days = (s, e) => (Date.parse(e) - Date.parse(s)) / 86_400_000;
const entries = (facts, tag) => facts[tag]?.units?.USD ?? [];

/** edgar-companyfacts.ts :: latestInstantB — note: no `fp === "FY"` filter. */
function latestInstantEnd(facts, tag) {
  const u = entries(facts, tag)
    .filter((e) => e.start == null && e.end != null && typeof e.val === "number")
    .sort((a, b) => Date.parse(a.end) - Date.parse(b.end));
  return u.at(-1)?.end ?? null;
}

/** edgar-companyfacts.ts :: latestDurationB */
function latestDurationEnd(facts, tag) {
  const u = entries(facts, tag)
    .filter(
      (e) =>
        e.start != null && e.end != null && typeof e.val === "number" &&
        days(e.start, e.end) > ANNUAL_MIN_DAYS,
    )
    .sort((a, b) => Date.parse(a.end) - Date.parse(b.end));
  return u.at(-1)?.end ?? null;
}

/** edgar-companyfacts.ts :: annualByFy — the fiscal-year index under test. */
function annualByFy(facts, tags, kind) {
  const byFy = new Map();
  for (const tag of tags) {
    for (const e of entries(facts, tag)) {
      if (typeof e.val !== "number" || e.end == null || e.fy == null) continue;
      const isAnnual =
        kind === "instant"
          ? e.start == null && e.fp === "FY"
          : e.start != null && (e.fp === "FY" || days(e.start, e.end) > ANNUAL_MIN_DAYS);
      if (!isAnnual) continue;
      const prev = byFy.get(e.fy);
      if (prev == null || Date.parse(e.end) > Date.parse(prev.end)) {
        byFy.set(e.fy, { end: e.end, val: e.val });
      }
    }
  }
  return byFy;
}

// ---------------------------------------------------------------------------
const raw = JSON.parse(readFileSync(EDGAR, "utf8"));
const base = raw.facts["us-gaap"];

const INCOME = [
  ["RevenueFromContractWithCustomerExcludingAssessedTax", "duration"],
  ["GrossProfit", "duration"],
  ["OperatingIncomeLoss", "duration"],
  ["NetIncomeLoss", "duration"],
];
const BALANCE = [
  ["Assets", "instant"],
  ["Liabilities", "instant"],
  ["StockholdersEquity", "instant"],
  ["CashAndCashEquivalentsAtCarryingValue", "instant"],
  ["LongTermDebtNoncurrent", "instant"],
];

function singlePeriodEnds(facts, spec) {
  return spec.map(([tag, kind]) => [
    tag,
    kind === "instant" ? latestInstantEnd(facts, tag) : latestDurationEnd(facts, tag),
  ]);
}

function report(label, facts) {
  console.log(`\n${"=".repeat(74)}\n${label}\n${"=".repeat(74)}`);

  for (const [name, spec] of [["income statement", INCOME], ["balance sheet", BALANCE]]) {
    const rows = singlePeriodEnds(facts, spec);
    const ends = new Set(rows.map(([, e]) => e).filter(Boolean));
    console.log(`\n  ${name} — period end each field was actually read at:`);
    for (const [tag, end] of rows) console.log(`     ${tag.padEnd(52)} ${end}`);
    console.log(
      `     >>> ${ends.size} distinct period end(s): ${[...ends].join(", ")}` +
        (ends.size > 1 ? "   <-- MIXED PERIODS IN ONE STATEMENT" : "   (coherent)"),
    );
  }

  // The multi-period path: does a fiscal-year key identify a period?
  console.log("\n  multi-period rows, keyed by SEC `fy` (buildPeriods):");
  const all = [...INCOME, ...BALANCE];
  const fys = new Set();
  for (const [tag, kind] of all) for (const fy of annualByFy(facts, [tag], kind).keys()) fys.add(fy);
  for (const fy of [...fys].sort((a, b) => b - a)) {
    const ends = new Set(
      all.map(([t, k]) => annualByFy(facts, [t], k).get(fy)?.end).filter(Boolean),
    );
    console.log(
      `     fy ${fy} -> period end(s) {${[...ends].join(", ")}}` +
        (ends.size > 1 ? "   <-- ONE ROW, TWO PERIODS" : ""),
    );
  }
}

report("A. COMMITTED FIXTURE (every tag present in both 10-Ks)", base);

// B. One tag dropped from the newest filing. This is not exotic: a filer that
//    renames or stops reporting a tag produces exactly this, and the legacy
//    `Revenues` tag in this very fixture is already an instance of the shape.
const asym = structuredClone(base);
asym.StockholdersEquity.units.USD = asym.StockholdersEquity.units.USD.filter(
  (e) => e.end !== "2025-09-27",
);
report("B. SAME FILING, StockholdersEquity ABSENT FROM THE NEWEST 10-K", asym);

// ---------------------------------------------------------------------------
// The `Revenues` tag, already in the committed fixture: three distinct fiscal
// years, all labelled fy 2018.
// ---------------------------------------------------------------------------
console.log(`\n${"=".repeat(74)}\nC. THE COMMITTED FIXTURE ALREADY CARRIES A COLLAPSED INDEX\n${"=".repeat(74)}`);
console.log("\n  `Revenues` raw entries:");
for (const e of entries(base, "Revenues")) {
  console.log(`     end=${e.end}  fy=${e.fy}  val=${e.val}`);
}
const rev = annualByFy(base, ["Revenues"], "duration");
console.log(`\n  annualByFy keeps ${rev.size} row(s) from those 3 fiscal years:`);
for (const [fy, v] of rev) console.log(`     fy ${fy} -> ${v.end} = ${v.val}`);
console.log("     >>> two fiscal years are silently discarded by the fy key.\n");

// ---------------------------------------------------------------------------
console.log("=".repeat(74));
console.log("YAHOO: does the single-period mapper's asOf track the value it published?");
console.log("=".repeat(74));
const y = JSON.parse(readFileSync(YAHOO, "utf8"));
const idx = new Map();
for (const row of y.timeseries?.result ?? []) {
  const t = row.meta?.type?.[0];
  if (t && Array.isArray(row[t])) idx.set(t, row[t]);
}
/** yahoo-timeseries.ts :: latestB — walks BACKWARD to the first finite value. */
const latestBEnd = (t) => {
  const p = idx.get(t) ?? [];
  for (let i = p.length - 1; i >= 0; i--) {
    const r = p[i]?.reportedValue?.raw;
    if (typeof r === "number" && Number.isFinite(r)) return p[i].asOfDate;
  }
  return null;
};
/** yahoo-timeseries.ts :: latestAsOf — takes the LAST point, finite or not. */
const latestAsOfEnd = (t) => (idx.get(t) ?? []).at(-1)?.asOfDate ?? null;

for (const [label, series] of [
  ["committed fixture", idx],
  [
    "same response, newest revenue point reported null",
    (() => {
      const c = new Map(idx);
      const pts = structuredClone(idx.get("annualTotalRevenue"));
      pts.at(-1).reportedValue = {};
      c.set("annualTotalRevenue", pts);
      return c;
    })(),
  ],
]) {
  const saved = idx.get("annualTotalRevenue");
  idx.set("annualTotalRevenue", series.get("annualTotalRevenue"));
  const v = latestBEnd("annualTotalRevenue");
  const a = latestAsOfEnd("annualTotalRevenue");
  console.log(
    `\n  ${label}\n     revenue value read at : ${v}\n     payload asOf claims   : ${a}` +
      (v !== a ? "\n     >>> THE PAYLOAD'S DATE IS NOT THE DATE ITS VALUE CAME FROM" : "\n     (agree)"),
  );
  idx.set("annualTotalRevenue", saved);
}
console.log("");
