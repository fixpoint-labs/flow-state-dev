/**
 * FIX-2541 spec POC check: each grader passes a planted correct turn and
 * fails each planted hollow one (the anti-game cases the spec names), and the
 * verdict rules read a sheet the way the spec says. Model-free; no app runs.
 *
 * Run: node specs/issues/FIX-2541/poc/closure-asks/check.mts
 */
import { runGoal } from "../../../../../goals/lib/verdict.mts";
import {
  controlFails,
  gradeCoder,
  gradeDate,
  gradeFold,
  gradeKnowledge,
  gradeMultiFile,
  gradeSizing,
  gradeSkill,
  passesEverywhere,
  passesIn,
  type Fixtures,
  type Graded,
  type Sheet,
  type Turn,
} from "./asks.mts";

const now = new Date();
const turn = (over: Partial<Turn>): Turn => ({ reply: "", tools: [], requests: 1, askedAt: now, answeredAt: now, ...over });
const long = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const yesterday = new Date(now.getTime() - 86_400_000);

const fx: Fixtures = {
  multiFile: { values: ["LC-418302-771", "LC-990114-205", "LC-552017-640"] },
  knowledge: { minLookups: 3 },
  sizing: { answer: /\b8\b|eight/i, maxWords: 50 },
  skill: { name: "release-notes", loadTool: /activate|loadSkill/i, marker: "RN-7731", asked: "Write the release note for the step budget change." },
  fold: { decision: "Postgres", rejected: "SQLite" },
};

/** [name, graded, should pass] */
const cases: [string, Graded, boolean][] = [
  ["date · long form today", gradeDate(turn({ reply: `Today is ${long(now)}.` })), true],
  ["date · ISO today", gradeDate(turn({ reply: `It's ${iso(now)}.` })), true],
  ["date · server-start date (stale)", gradeDate(turn({ reply: `Today is ${long(yesterday)}.` })), false],
  ["date · no date", gradeDate(turn({ reply: "I don't have access to the current date." })), false],
  ["date · today and a wrong one", gradeDate(turn({ reply: `Today is ${iso(now)}, or ${iso(yesterday)}.` })), false],

  ["multi-file · all values, one turn", gradeMultiFile(turn({ reply: fx.multiFile.values.join(", ") }), fx.multiFile), true],
  ["multi-file · one value missing", gradeMultiFile(turn({ reply: fx.multiFile.values.slice(1).join(", ") }), fx.multiFile), false],
  ["multi-file · needed a second turn", gradeMultiFile(turn({ reply: fx.multiFile.values.join(", "), requests: 2 }), fx.multiFile), false],

  ["coder · names a check that ran, right result", gradeCoder(turn({ reply: "Done. I ran `pnpm test` and it passed.", checks: [{ command: "pnpm test", ok: true }] })), true],
  ["coder · null record", gradeCoder(turn({ reply: "I ran `pnpm test` and it passed.", checks: null })), false],
  ["coder · names no check", gradeCoder(turn({ reply: "Done, the change is committed.", checks: [{ command: "pnpm test", ok: true }] })), false],
  ["coder · claims a check that never ran", gradeCoder(turn({ reply: "I ran `pnpm lint` and it passed.", checks: [{ command: "pnpm test", ok: true }] })), false],
  ["coder · says pass, it failed", gradeCoder(turn({ reply: "I ran `pnpm test` and it passed.", checks: [{ command: "pnpm test", ok: false }] })), false],

  [
    "knowledge · cites a page it fetched",
    gradeKnowledge(
      turn({
        reply: "Workers default to 50 steps (https://flowstate.dev/docs/workforce/steps).",
        tools: [{ name: "search", output: "https://flowstate.dev/docs/workforce/steps" }, { name: "fetch", input: "https://flowstate.dev/docs/workforce/steps" }, { name: "fetch", input: "https://flowstate.dev/docs/x" }],
      }),
      fx.knowledge,
    ),
    true,
  ],
  ["knowledge · cites a page it never looked at", gradeKnowledge(turn({ reply: "See https://example.com/made-up.", tools: [{ name: "search" }, { name: "fetch" }, { name: "fetch" }] }), fx.knowledge), false],
  ["knowledge · no lookups (guessed)", gradeKnowledge(turn({ reply: "See https://flowstate.dev/docs/workforce/steps." }), fx.knowledge), false],

  ["sizing · short and right", gradeSizing(turn({ reply: "8 steps by default." }), fx.sizing), true],
  ["sizing · right but an essay", gradeSizing(turn({ reply: `8 steps. ${"More background on why. ".repeat(20)}` }), fx.sizing), false],
  ["sizing · short and empty of the answer", gradeSizing(turn({ reply: "It depends." }), fx.sizing), false],

  ["skill · held, loaded, marker", gradeSkill(turn({ reply: "RN-7731: steps now 50.", held: ["release-notes"], tools: [{ name: "activateSkill", input: '{"name":"release-notes"}' }] }), fx.skill), true],
  ["skill · not held (vacuous)", gradeSkill(turn({ reply: "RN-7731", held: [], tools: [{ name: "activateSkill", input: "release-notes" }] }), fx.skill), false],
  ["skill · held, never loaded", gradeSkill(turn({ reply: "Steps now 50.", held: ["release-notes"] }), fx.skill), false],

  ["fold · folded, decision kept", gradeFold(turn({ reply: "We picked Postgres, so use its LISTEN.", folded: true }), fx.fold), true],
  ["fold · no fold ran (vacuous)", gradeFold(turn({ reply: "We picked Postgres.", folded: false }), fx.fold), false],
  ["fold · folded, decision lost", gradeFold(turn({ reply: "Use SQLite.", folded: true }), fx.fold), false],
];

const ok: Graded = [];
const bad: Graded = ["x"];
const sheet: Sheet = {
  date: { "claude-code-style": [ok, ok, ok], teammates: [ok, ok, ok], "kitchen-sink": [ok, ok, ok], "shift-manager": [ok, ok, ok] },
  sizing: { "claude-code-style": [ok, ok, ok], teammates: [ok, bad, ok], "kitchen-sink": [ok, ok, ok], "shift-manager": [ok, ok, ok] },
  fold: { "claude-code-style": [ok, ok], teammates: [ok, ok, ok] },
};
const rules: [string, boolean, boolean][] = [
  ["3 of 3 passes in an app", passesIn(sheet, "date", "teammates"), true],
  ["2 of 3 does not pass", passesIn(sheet, "sizing", "teammates"), false],
  ["2 recorded runs is not a pass", passesIn(sheet, "fold", "claude-code-style"), false],
  ["date passes everywhere (cut / wrap)", passesEverywhere(sheet, "date"), true],
  ["one failing app keeps the layer", passesEverywhere(sheet, "sizing"), false],
  ["control: one failed run anywhere holds", controlFails(sheet, "sizing"), true],
  ["control: an ask that never fails does not hold", controlFails(sheet, "date"), false],
  ["an unrun ask passes nowhere", passesEverywhere(sheet, "skill"), false],
];

await runGoal((failures, tell) => {
  for (const [name, graded, shouldPass] of tell.over("grader cases", cases)) {
    if (shouldPass && graded.length > 0) failures.push(`${name}: should pass, got ${graded.join("; ")}`);
    if (!shouldPass && graded.length === 0) failures.push(`${name}: a hollow turn passed`);
  }
  for (const [name, got, want] of tell.over("verdict rules", rules)) if (got !== want) failures.push(`${name}: got ${got}`);
  return { failures, evidence: `${cases.length} grader cases (${cases.filter((c) => !c[2]).length} hollow, each refused) and ${rules.length} verdict rules` };
});
