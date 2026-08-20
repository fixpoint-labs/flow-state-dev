/**
 * FIX-1066 spec POC — characterization of the ATTENDANCE hole in the agreement
 * number, plus the two candidate fixes, run against the REAL shipped function.
 *
 * The premise this checks is §7's stated safety property:
 *
 *     "The denominator never shrinks and only majority-side terms are ever
 *      scaled down, so no gap flag anywhere can raise the agreement number."
 *
 * The first clause is a claim about `computeConvergence`, and it is false of it.
 * `convergence-math.ts:50` sets `const n = verdicts.length` — the set that
 * REPORTED, not the set that was SEATED. A lens that errors produces no verdict,
 * is absent from `verdicts`, and shrinks `n`.
 *
 * Run it:
 *     npx tsx spec-poc/FIX-1066-attendance/attendance.ts
 *
 * Nothing here is shipping code. Case A runs the real function; cases B and C
 * model the spec's PROPOSED aggregate (which does not exist yet) so the round-11
 * design can be checked before it is built.
 */
import { computeConvergence } from "../../labs/trading-desk/flows/analysis/agents/lenses/convergence-math";
import type { LensVerdictRecord } from "../../labs/trading-desk/flows/analysis/agents/lenses/lens-convergence-resource";

type Stance = "bullish" | "neutral" | "bearish";

const v = (
  lensId: string,
  stance: Stance,
  opts: { conviction?: number; gap?: boolean } = {},
): LensVerdictRecord => ({
  lensId,
  label: lensId,
  attribution: "",
  glyph: "",
  stance,
  conviction: opts.conviction ?? 0.8,
  verdict: "",
  keyDriver: "",
  dataGap: opts.gap ? "missing a core metric" : "",
  missingData: opts.gap ? ["someRatio"] : [],
});

/** The spec's proposed aggregate (decisions 10 + 11), parameterised by which
 *  count lands in the denominator. `seated` is the fix; `reported` is round 11
 *  as written, and is what `computeConvergence` does today. */
const GAP_WEIGHT = 0.5;
function proposed(verdicts: LensVerdictRecord[], seated: number, denom: "seated" | "reported") {
  const counts: Record<Stance, number> = { bullish: 0, neutral: 0, bearish: 0 };
  for (const x of verdicts) counts[x.stance] += 1;
  const max = Math.max(counts.bullish, counts.neutral, counts.bearish);
  const leaders = (["bullish", "neutral", "bearish"] as const).filter((s) => counts[s] === max);
  const majority: Stance = leaders.length === 1 ? leaders[0] : "neutral";

  const weighted = verdicts
    .filter((x) => x.stance === majority)
    .reduce((sum, x) => sum + (x.dataGap || x.missingData.length ? GAP_WEIGHT : 1), 0);

  const n = denom === "seated" ? seated : verdicts.length;
  const agreement = n === 0 ? 0 : weighted / n;
  const classification = agreement >= 1 ? "CONVERGENT" : agreement >= 0.5 ? "MIXED" : "DIVERGENT";
  return { agreement, classification };
}

const f = (x: number) => x.toFixed(3);
const line = (s: string) => console.log(s);
const rule = (s: string) => console.log(`\n${"─".repeat(78)}\n${s}\n${"─".repeat(78)}`);

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) failures += 1;
  line(`   ${ok ? "OK  " : "FAIL"}  ${label}: ${actual}${ok ? "" : `  (expected ${expected})`}`);
}

// ───────────────────────────────────────────────────────────────────────────
rule(
  "A — LIVE TODAY, at today's four seats, in the REAL computeConvergence.\n" +
    "    A dissenting lens that CRASHES promotes the headline MIXED -> CONVERGENT.",
);

const fourAllReport = [
  v("quality-value", "bullish"),
  v("macro-reflexive", "bullish"),
  v("cycle-risk", "bullish"),
  v("forensic-skeptic", "bearish"),
];
const fourDissenterCrashed = fourAllReport.slice(0, 3);

const a1 = computeConvergence(fourAllReport);
const a2 = computeConvergence(fourDissenterCrashed);
line(`   all four report          -> agreement ${f(a1.agreementScore)}  ${a1.classification}`);
line(`   the dissenter crashed    -> agreement ${f(a2.agreementScore)}  ${a2.classification}`);
check("panel that fully reported", a1.classification, "mixed");
check("panel that lost its dissenter", a2.classification, "convergent");
line("   => A lens FAILING is worth more to the headline than a lens SURVIVING and dissenting.");
line("      Live in shipped code, at the pack size we run today. PR a inherits it.");

// ───────────────────────────────────────────────────────────────────────────
rule(
  "B — THE INVERSION the round-11 design INTRODUCES, at the six seats PR b ships.\n" +
    "    Same lens, two fates: it reports and admits a gap, or it crashes.",
);

const sixAllReport = [
  v("l1", "bullish"),
  v("l2", "bullish"),
  v("l3", "bullish"),
  v("l4", "bullish"),
  v("l5", "bullish"),
  v("forensic-skeptic", "bullish", { gap: true }),
];
const sixOneCrashed = sixAllReport.slice(0, 5);

for (const denom of ["reported", "seated"] as const) {
  const honest = proposed(sixAllReport, 6, denom);
  const crashed = proposed(sixOneCrashed, 6, denom);
  line(`\n   denominator = ${denom.toUpperCase()}${denom === "reported" ? "   (round 11 as written)" : "     (the fix)"}`);
  line(`     survives, flags a gap  -> agreement ${f(honest.agreement)}  ${honest.classification}`);
  line(`     crashes outright       -> agreement ${f(crashed.agreement)}  ${crashed.classification}`);
  if (denom === "reported") {
    check("honest report", honest.classification, "MIXED");
    check("crash", crashed.classification, "CONVERGENT");
    line("     => INVERTED. Crashing outranks reporting honestly, and the sizing floor");
    line("        goes to 1.000 off a panel where one seat never spoke.");
  } else {
    check("honest report", honest.classification, "MIXED");
    check("crash", crashed.classification, "MIXED");
    check("crash scores strictly lower than the honest report", crashed.agreement < honest.agreement, "true");
    line("     => ORDER RESTORED. Absence dilutes; it never joins the majority.");
  }
}

// ───────────────────────────────────────────────────────────────────────────
rule(
  "C — QUORUM DOES NOT CATCH IT. Quorum is a floor, not an attendance check.\n" +
    "    Six seats = 5 methodology + skeptic; quorum is 3 of 5.",
);

line("   one methodology lens crashes -> 4 of 5 methodology reported -> quorum MET (4 > 2.5)");
line("   ...and the aggregate then runs over the five that spoke, scoring 1.000 CONVERGENT.");
check(
  "above-quorum partial panel still prints the unanimity headline (reported denominator)",
  proposed(sixOneCrashed, 6, "reported").classification,
  "CONVERGENT",
);
check(
  "...and is demoted once the denominator is the seated count",
  proposed(sixOneCrashed, 6, "seated").classification,
  "MIXED",
);

// ───────────────────────────────────────────────────────────────────────────
rule(
  "D — THE TIE-BREAK, characterized. It can never OVERSTATE agreement,\n" +
    "    which is why deferring it is defensible and the attendance hole was not.",
);

const ties: Array<[string, LensVerdictRecord[]]> = [
  ["3-3 bullish / bearish", [
    v("a", "bullish"), v("b", "bullish"), v("c", "bullish"),
    v("d", "bearish"), v("e", "bearish"), v("f", "bearish"),
  ]],
  ["3-3 bullish / neutral", [
    v("a", "bullish"), v("b", "bullish"), v("c", "bullish"),
    v("d", "neutral"), v("e", "neutral"), v("f", "neutral"),
  ]],
  ["2-2-2 three-way", [
    v("a", "bullish"), v("b", "bullish"), v("c", "neutral"),
    v("d", "neutral"), v("e", "bearish"), v("f", "bearish"),
  ]],
];

for (const [name, set] of ties) {
  const r = computeConvergence(set);
  const counts: Record<string, number> = {};
  for (const x of set) counts[x.stance] = (counts[x.stance] ?? 0) + 1;
  const modal = Math.max(...Object.values(counts)) / set.length;
  line(
    `   ${name.padEnd(24)} majority=${r.majorityStance.padEnd(8)} agreement=${f(r.agreementScore)}  ` +
      `${r.classification.padEnd(10)} (modal fraction ${f(modal)})`,
  );
  check(`   ${name}: agreement never exceeds the modal fraction`, r.agreementScore <= modal, "true");
}
line("");
line("   The proof, not just the three cases: majorityStance on a tie is `neutral`, and");
line("   counts[neutral] <= maxCount by construction — neutral is either a tied leader");
line("   (counts[neutral] === maxCount) or not a leader (counts[neutral] < maxCount).");
line("   So the tie-break's agreement is always <= the modal fraction. It fails CLOSED.");

rule(failures === 0 ? "ALL CHECKS AS EXPECTED" : `${failures} CHECK(S) DID NOT MATCH`);
process.exit(failures === 0 ? 0 : 1);
