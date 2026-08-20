/**
 * FIX-1066 spec POC — the ATTENDANCE hole in the agreement number, the TIE
 * CLIFF that survives fixing it, and the lean's version of the same defect.
 * Run against the REAL shipped function where the claim is about today.
 *
 * Three premises checked, none of them assumed:
 *
 *   1. §7's stated safety property — "the denominator never shrinks and only
 *      majority-side terms are ever scaled down" — is false of
 *      `computeConvergence`. Line 50 is `const n = verdicts.length`: the set
 *      that REPORTED, not the set that was SEATED.
 *   2. Fixing the denominator is necessary and NOT sufficient. The numerator
 *      moves too, because `majorityStance` is recomputed — and on a tie
 *      line 74 names `neutral`, a stance nobody voted for, so line 77 divides
 *      `counts["neutral"] === 0`. Removing a lens can BREAK the tie and raise
 *      agreement off that floor.
 *   3. `netLean` (line 64) divides by the same reported count, so an errored
 *      dissenter lengthens the lean.
 *
 * Run it:
 *     npx tsx spec-poc/FIX-1066-attendance/attendance.ts
 *
 * Exits non-zero if any characterized behaviour has moved. Cases A/D1/F1 run
 * the real function; the rest model the proposed aggregate (which does not
 * exist yet) so the design can be checked before it is built.
 */
import { computeConvergence } from "../../labs/trading-desk/flows/analysis/agents/lenses/convergence-math";
import type { LensVerdictRecord } from "../../labs/trading-desk/flows/analysis/agents/lenses/lens-convergence-resource";

type Stance = "bullish" | "neutral" | "bearish";
const STANCES: Stance[] = ["bullish", "neutral", "bearish"];
const GAP_WEIGHT = 0.5;

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
  conviction: opts.conviction ?? 1,
  verdict: "",
  keyDriver: "",
  dataGap: opts.gap ? "missing a core metric" : "",
  missingData: opts.gap ? ["someRatio"] : [],
});

const flagged = (x: LensVerdictRecord) => Boolean(x.dataGap || x.missingData.length);
const sign = (s: Stance) => (s === "bullish" ? 1 : s === "bearish" ? -1 : 0);

/** Round 12 as written: seated denominator, majority via today's tie-break
 *  (ties collapse to `neutral`), agreement = counts[majority] weighted. */
function r12(verdicts: LensVerdictRecord[], seated: number) {
  const raw: Record<Stance, number> = { bullish: 0, neutral: 0, bearish: 0 };
  for (const x of verdicts) raw[x.stance] += 1;
  const max = Math.max(raw.bullish, raw.neutral, raw.bearish);
  const leaders = STANCES.filter((s) => raw[s] === max);
  const majority: Stance = leaders.length === 1 ? leaders[0] : "neutral";
  const score = verdicts
    .filter((x) => x.stance === majority)
    .reduce((sum, x) => sum + (flagged(x) ? GAP_WEIGHT : 1), 0);
  return classify(score / seated, majority as Stance | null);
}

/** Round 13 proposed: a tie has NO majority (`null` — `neutral` is a stance a
 *  lens can actually hold, so it cannot also mean "nobody won"), and agreement
 *  is the weighted score of the modal bloc — on a tie, the best-scoring of the
 *  co-modal blocs. Direction is still decided on RAW counts, so a gap flag can
 *  never flip which way the panel is reported to lean.
 *
 *  `tie` is parameterised so section E can measure the alternatives instead of
 *  the spec asserting that this one is best. */
type TieRule = "neutral" | "max" | "min" | "allmax";
function r13(verdicts: LensVerdictRecord[], seated: number, tie: TieRule = "max") {
  const raw: Record<Stance, number> = { bullish: 0, neutral: 0, bearish: 0 };
  for (const x of verdicts) raw[x.stance] += 1;
  const max = Math.max(raw.bullish, raw.neutral, raw.bearish);
  const leaders = STANCES.filter((s) => raw[s] === max);
  const majority: Stance | null = leaders.length === 1 ? leaders[0] : null;
  const scoreOf = (s: Stance) =>
    verdicts.filter((x) => x.stance === s).reduce((sum, x) => sum + (flagged(x) ? GAP_WEIGHT : 1), 0);
  let numerator: number;
  if (tie === "allmax") numerator = Math.max(...STANCES.map(scoreOf));
  else if (leaders.length === 1) numerator = scoreOf(leaders[0]);
  else if (tie === "neutral") numerator = scoreOf("neutral");
  else numerator = tie === "max" ? Math.max(...leaders.map(scoreOf)) : Math.min(...leaders.map(scoreOf));
  const score = verdicts.length === 0 ? 0 : numerator;
  return { ...classify(score / seated, majority), majorityScore: majority ? scoreOf(majority) / seated : null };
}

function classify(agreement: number, majority: Stance | null) {
  const classification =
    agreement >= 1 ? "CONVERGENT" : agreement >= 0.5 ? "MIXED" : "DIVERGENT";
  return { agreement, classification, majority };
}

const rank = (c: string) => (c === "DIVERGENT" ? 0 : c === "MIXED" ? 1 : 2);
const lean = (verdicts: LensVerdictRecord[], denom: number) =>
  denom === 0 ? 0 : verdicts.reduce((s, x) => s + sign(x.stance) * x.conviction, 0) / denom;

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
const a1 = computeConvergence(fourAllReport);
const a2 = computeConvergence(fourAllReport.slice(0, 3));
line(`   all four report          -> agreement ${f(a1.agreementScore)}  ${a1.classification}`);
line(`   the dissenter crashed    -> agreement ${f(a2.agreementScore)}  ${a2.classification}`);
check("panel that fully reported", a1.classification, "mixed");
check("panel that lost its dissenter", a2.classification, "convergent");
line("   => A lens FAILING is worth more to the headline than a lens SURVIVING and dissenting.");

// ───────────────────────────────────────────────────────────────────────────
rule(
  "B — THE INVERSION the round-11 design INTRODUCES, at the six seats PR b ships.\n" +
    "    Same METHODOLOGY lens, two fates: it reports and admits a gap, or it crashes.",
);

// Seats: l1..l5 are the five methodology lenses, forensic-skeptic is the sixth.
// The lens with the two fates is l5 — a METHODOLOGY lens, so the quorum
// arithmetic in C below is about the count quorum actually measures.
const sixAllReport = [
  v("l1", "bullish"),
  v("l2", "bullish"),
  v("l3", "bullish"),
  v("l4", "bullish"),
  v("l5", "bullish", { gap: true }),
  v("forensic-skeptic", "bullish"),
];
const sixL5Crashed = sixAllReport.filter((x) => x.lensId !== "l5");

for (const [name, fn] of [["REPORTED denominator (round 11)", r12], ["SEATED denominator (round 12+)", (vs: LensVerdictRecord[]) => r13(vs, 6)]] as const) {
  const honest = name.startsWith("REPORTED")
    ? classifyReported(sixAllReport)
    : (fn as (vs: LensVerdictRecord[]) => ReturnType<typeof r13>)(sixAllReport);
  const crashed = name.startsWith("REPORTED")
    ? classifyReported(sixL5Crashed)
    : (fn as (vs: LensVerdictRecord[]) => ReturnType<typeof r13>)(sixL5Crashed);
  line(`\n   ${name}`);
  line(`     l5 survives, flags a gap -> agreement ${f(honest.agreement)}  ${honest.classification}`);
  line(`     l5 crashes outright      -> agreement ${f(crashed.agreement)}  ${crashed.classification}`);
  if (name.startsWith("REPORTED")) {
    check("honest report", honest.classification, "MIXED");
    check("crash", crashed.classification, "CONVERGENT");
    line("     => INVERTED. Crashing outranks reporting honestly; sizing floor 1.000.");
  } else {
    check("crash scores strictly lower than the honest report", crashed.agreement < honest.agreement, "true");
    check("neither reaches convergent", `${honest.classification}/${crashed.classification}`, "MIXED/MIXED");
    line("     => ORDER RESTORED. Absence dilutes; it never joins the majority.");
  }
}

function classifyReported(verdicts: LensVerdictRecord[]) {
  return r12(verdicts, verdicts.length);
}

// ───────────────────────────────────────────────────────────────────────────
rule(
  "C — QUORUM DOES NOT CATCH IT. Quorum is a floor, not an attendance check.\n" +
    "    Six seats = 5 METHODOLOGY lenses (l1..l5) + the skeptic. Quorum is 3 of 5.\n" +
    "    The lens that crashes here is l5 — a methodology lens, the kind quorum counts.",
);

const methodologyReporting = sixL5Crashed.filter((x) => x.lensId !== "forensic-skeptic").length;
line(`   methodology lenses reporting after l5 crashes: ${methodologyReporting} of 5 seated`);
line(`   quorum needs a strict majority of 5 seated methodology lenses = 3`);
check("quorum is met, so nothing suppresses", methodologyReporting > 5 / 2, "true");
check(
  "...and the partial panel still prints unanimity under the reported denominator",
  classifyReported(sixL5Crashed).classification,
  "CONVERGENT",
);
check(
  "...and is demoted once the denominator is the seated count",
  r13(sixL5Crashed, 6).classification,
  "MIXED",
);

// ───────────────────────────────────────────────────────────────────────────
rule(
  "D — THE TIE CLIFF. Codex's case. The seated denominator does NOT fix this,\n" +
    "    because the NUMERATOR moves when the majority is recomputed.",
);

// 3 bullish methodology, 2 bearish methodology, 1 bearish skeptic -> 3-3.
const tied = [
  v("l1", "bullish"),
  v("l2", "bullish"),
  v("l3", "bullish"),
  v("l4", "bearish"),
  v("l5", "bearish"),
  v("forensic-skeptic", "bearish"),
];
const tieBroken = tied.filter((x) => x.lensId !== "l5"); // one bearish METHODOLOGY lens errors

const d1a = computeConvergence(tied);
const d1b = computeConvergence(tieBroken);
line("\n   D1 — the real shipped function (reported denominator):");
line(`     3-3 tie                 -> agreement ${f(d1a.agreementScore)}  ${d1a.classification}  majority=${d1a.majorityStance}`);
line(`     one bearish lens errors -> agreement ${f(d1b.agreementScore)}  ${d1b.classification}  majority=${d1b.majorityStance}`);
check("today: removing a lens RAISES agreement", d1b.agreementScore > d1a.agreementScore, "true");

const d2a = r12(tied, 6);
const d2b = r12(tieBroken, 6);
line("\n   D2 — round 12 as written (seated denominator, today's tie-break)  <-- RED:");
line(`     3-3 tie                 -> agreement ${f(d2a.agreement)}  ${d2a.classification}  majority=${d2a.majority}`);
line(`     one bearish lens errors -> agreement ${f(d2b.agreement)}  ${d2b.classification}  majority=${d2b.majority}`);
check("STILL rises with the denominator pinned at 6", d2b.agreement > d2a.agreement, "true");
check("...and the printed word improves", `${d2a.classification}->${d2b.classification}`, "DIVERGENT->MIXED");
line("     => The monotonic invariant round 12 asserted is UNSATISFIABLE as written.");
line("        counts['neutral'] is 0 on a bull/bear tie: agreement sits on a floor");
line("        that has nothing to do with how agreed the panel is, then jumps off it.");

const d3a = r13(tied, 6);
const d3b = r13(tieBroken, 6);
line("\n   D3 — round 13 proposed (tie has no majority; agreement = modal bloc)  <-- GREEN:");
line(`     3-3 tie                 -> agreement ${f(d3a.agreement)}  ${d3a.classification}  majority=${d3a.majority}`);
line(`     one bearish lens errors -> agreement ${f(d3b.agreement)}  ${d3b.classification}  majority=${d3b.majority}`);
check("no longer rises", d3b.agreement <= d3a.agreement, "true");
check("the tied panel reports the modal count, not 0", f(d3a.agreement), "0.500");
check("the tied panel has NO majority stance", String(d3a.majority), "null");
line("     => 3 of 6 agreed each way. 0.500 is that fact. 0.000 was never a reading.");

// ───────────────────────────────────────────────────────────────────────────
rule(
  "E — EXHAUSTIVE, and the tie rule is CHOSEN ON EVIDENCE, not asserted.\n" +
    "    Every verdict multiset at 4 and 6 seats, every single-lens removal,\n" +
    "    under four candidate tie rules. Three questions per rule:\n" +
    "      rises  — can removing a lens raise the agreement number?\n" +
    "      wordUp — can removing a lens raise the PRINTED classification?\n" +
    "      over   — does the number ever EXCEED the majority bloc's own score?",
);

type Kind = { stance: Stance; gap: boolean };
const KINDS: Kind[] = STANCES.flatMap((s) => [{ stance: s, gap: false }, { stance: s, gap: true }]);
const toVerdicts = (ks: Kind[]) => ks.map((k, i) => v(`x${i}`, k.stance, { gap: k.gap }));

function* multisets(size: number, start = 0): Generator<Kind[]> {
  if (size === 0) return void (yield []);
  for (let i = start; i < KINDS.length; i++)
    for (const rest of multisets(size - 1, i)) yield [KINDS[i], ...rest];
}

const LABEL: Record<TieRule, string> = {
  neutral: "neutral   (today, and round 12)",
  max: "max       (round 13 PROPOSED)",
  min: "min       (the cautious-looking one)",
  allmax: "allmax    (max over ALL blocs)",
};

for (const seated of [4, 6]) {
  line(`\n   seated = ${seated}`);
  const results: Record<string, { rises: number; wordUp: number; over: number; worst: number; worstCase: string }> = {};
  for (const tie of ["neutral", "max", "min", "allmax"] as const) {
    const r = { rises: 0, wordUp: 0, over: 0, worst: 0, worstCase: "" };
    for (let size = 1; size <= seated; size++) {
      for (const ks of multisets(size)) {
        const vs = toVerdicts(ks);
        const base = r13(vs, seated, tie);
        if (base.majorityScore != null && base.agreement > base.majorityScore + 1e-9) r.over += 1;
        for (let i = 0; i < vs.length; i++) {
          const less = vs.filter((_, j) => j !== i);
          if (less.length === 0) continue;
          const cut = r13(less, seated, tie);
          if (cut.agreement > base.agreement + 1e-9) {
            r.rises += 1;
            if (cut.agreement - base.agreement > r.worst) {
              r.worst = cut.agreement - base.agreement;
              r.worstCase =
                `${ks.map((k) => k.stance[0] + (k.gap ? "*" : "")).join(" ")} minus ` +
                `${ks[i].stance[0]}${ks[i].gap ? "*" : ""}: ${f(base.agreement)} -> ${f(cut.agreement)} ` +
                `(${base.classification} -> ${cut.classification})`;
            }
          }
          if (rank(cut.classification) > rank(base.classification)) r.wordUp += 1;
        }
      }
    }
    results[tie] = r;
    line(
      `     ${LABEL[tie].padEnd(36)} rises=${String(r.rises).padStart(4)}  ` +
        `wordUp=${String(r.wordUp).padStart(3)}  over=${String(r.over).padStart(3)}  worstLeak=${f(r.worst)}`,
    );
  }
  check(`   seated=${seated}: today's rule leaks and changes the printed word`, results.neutral.wordUp > 0, "true");
  check(`   seated=${seated}: PROPOSED rule never raises the printed word`, results.max.wordUp, 0);
  check(`   seated=${seated}: PROPOSED rule never overstates the majority bloc`, results.max.over, 0);
  check(`   seated=${seated}: 'min' is strictly worse than 'max'`, results.min.wordUp >= results.max.wordUp && results.min.rises >= results.max.rises, "true");
  check(`   seated=${seated}: 'allmax' is fully monotone but OVERSTATES`, results.allmax.rises === 0 && results.allmax.over > 0 === (seated === 6), "true");
  if (results.max.rises > 0) line(`     residual on the proposed rule: ${results.max.worstCase}`);
}

line("");
line("   READ THIS OFF THE TABLE, not off the prose:");
line("     - 'neutral' (today, and round 12) leaks badly AND moves the printed word.");
line("     - 'min' looks cautious and is strictly WORSE than 'max' on every column.");
line("     - 'allmax' is perfectly monotone and is REJECTED anyway: at six seats it");
line("       publishes a number HIGHER than the majority bloc's own score in 18 cases.");
line("       Overstating agreement is the failure this whole spec exists to remove.");
line("     - 'max' over the co-modal blocs is monotone at four seats, and at six has a");
line("       residual bounded at 0.083 that NEVER crosses a classification boundary and");
line("       NEVER overstates. That residual is disclosed in the spec, not hidden.");

// ───────────────────────────────────────────────────────────────────────────
rule(
  "F — THE LEAN has the same absence hole, and the seated denominator BOUNDS it\n" +
    "    rather than closing it. Stated honestly rather than claimed as a fix.",
);

const leanSet = [v("l1", "bullish"), v("l2", "bullish"), v("l3", "bearish")];
const leanCut = leanSet.slice(0, 2); // the lone bear errors

line("\n   F1 — the real shipped function (reported denominator):");
const f1a = computeConvergence(leanSet);
const f1b = computeConvergence(leanCut);
line(`     all three report        -> netLean ${f(f1a.netLean)}`);
line(`     the lone bear errors    -> netLean ${f(f1b.netLean)}`);
check("today: an errored dissenter LENGTHENS the lean", f1b.netLean > f1a.netLean, "true");
check("...and by how much", `${f(f1a.netLean)} -> ${f(f1b.netLean)}`, "0.333 -> 1.000");

line("\n   F2 — seated denominator (3 seats), the EM's ruling:");
line(`     all three report        -> netLean ${f(lean(leanSet, 3))}`);
line(`     the lone bear errors    -> netLean ${f(lean(leanCut, 3))}`);
check("still lengthens", lean(leanCut, 3) > lean(leanSet, 3), "true");
check("but bounded far tighter", `${f(lean(leanSet, 3))} -> ${f(lean(leanCut, 3))}`, "0.333 -> 0.667");
line("     => The fix BOUNDS the effect; it does not remove it. Removing an opposing");
line("        verdict genuinely changes the signed sum, and the only way to stop that");
line("        is to impute a stance for a lens that never spoke — which is forbidden.");
line("        What the seated denominator buys: |netLean| <= reported/seated, so every");
line("        empty chair caps the lean 1/seated shorter. A fully absent panel cannot");
line("        point anywhere. Under the reported denominator the cap is always 1.0.");

rule(failures === 0 ? "ALL CHECKS AS EXPECTED" : `${failures} CHECK(S) DID NOT MATCH`);
process.exit(failures === 0 ? 0 : 1);
