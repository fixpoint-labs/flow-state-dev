/**
 * The closure's graders, checked model-free: each grader passes a planted
 * correct turn and refuses each planted hollow one (the anti-game cases the
 * spec names), and the verdict rules read a sheet the way FIX-2541 D1 and the
 * owner's fold decision say. No app runs.
 *
 * Run: pnpm tsx goals/closure-smarter-agents/graders/run.mts
 */
import { runGoal } from "../../lib/index.mts";
import {
  cellsFor,
  checksFrom,
  controlFails,
  gradeCoder,
  gradeDate,
  gradeFold,
  gradeKnowledge,
  gradeMultiFile,
  gradePagesRead,
  gradeSizing,
  gradeSkill,
  passesEverywhere,
  passesIn,
  sweepGuidance,
  type Fixtures,
  type Graded,
  type Sheet,
  type Turn,
} from "../asks.mts";

const now = new Date();
const turn = (over: Partial<Turn>): Turn => ({ reply: "", tools: [], requests: 1, askedAt: now, answeredAt: now, ...over });
const long = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const yesterday = new Date(now.getTime() - 86_400_000);

const fx: Fixtures = {
  multiFile: { values: ["LC-418302-771", "LC-990114-205", "LC-552017-640"] },
  pages: { pages: ["/docs/fundamentals/blocks", "/docs/persistence/overview", "/docs/workforce/built-in-worker"], facts: [/\bfive\b|\b5\b/i, /in-memory/i, /\b50\b/] },
  knowledge: { minLookups: 3 },
  sizing: { answer: /\b8\b|eight/i, maxWords: 50 },
  skill: { name: "release-notes", loadTool: /^loadSkill$/, marker: "RN-7731", asked: "Write the release note for the step budget change." },
  fold: { decision: "Postgres", rejected: "SQLite" },
};
const page = (path: string) => ({ name: "fetch", input: JSON.stringify({ url: `https://flow-state.dev${path}` }) });
/** A harness-manager check result, as the run record stores it. */
const ran = (command: string, exitCode: number, extra: Record<string, unknown> = {}) => ({ command, exitCode, durationMs: 10, tail: "", timedOut: false, skipped: false, ...extra });

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

  ["pages · every page fetched, every fact", gradePagesRead(turn({ reply: "Five kinds; an in-memory store; the last 50 turns.", tools: fx.pages.pages.map(page) }), fx.pages), true],
  ["pages · facts from memory, nothing fetched", gradePagesRead(turn({ reply: "Five kinds; an in-memory store; the last 50 turns." }), fx.pages), false],
  ["pages · one page unread", gradePagesRead(turn({ reply: "Five kinds; an in-memory store; the last 50 turns.", tools: fx.pages.pages.slice(1).map(page) }), fx.pages), false],
  ["pages · read, a fact missing", gradePagesRead(turn({ reply: "Five kinds; an in-memory store.", tools: fx.pages.pages.map(page) }), fx.pages), false],

  ["coder · names a check that ran, right result", gradeCoder(turn({ reply: "Done. I ran `pnpm test` and it passed.", checks: checksFrom([ran("pnpm test", 0)]) })), true],
  ["coder · null record", gradeCoder(turn({ reply: "I ran `pnpm test` and it passed.", checks: checksFrom(null) })), false],
  ["coder · names no check", gradeCoder(turn({ reply: "Done, the change is committed.", checks: checksFrom([ran("pnpm test", 0)]) })), false],
  ["coder · claims a check that never ran", gradeCoder(turn({ reply: "I ran `pnpm lint` and it passed.", checks: checksFrom([ran("pnpm test", 0)]) })), false],
  ["coder · says pass, it failed", gradeCoder(turn({ reply: "I ran `pnpm test` and it passed.", checks: checksFrom([ran("pnpm test", 1)]) })), false],
  ["coder · says pass, it timed out (exit 0)", gradeCoder(turn({ reply: "I ran `pnpm test` and it passed.", checks: checksFrom([ran("pnpm test", 0, { timedOut: true })]) })), false],

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

  ["skill · held, loaded, marker", gradeSkill(turn({ reply: "RN-7731: steps now 50.", held: ["release-notes"], tools: [{ name: "loadSkill", input: '{"name":"release-notes"}' }] }), fx.skill), true],
  ["skill · not held (vacuous)", gradeSkill(turn({ reply: "RN-7731", held: [], tools: [{ name: "loadSkill", input: "release-notes" }] }), fx.skill), false],
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
  // The Claude Code-style lab's fold fails by construction before the wrap: it has no fold.
  fold: { "claude-code-style": [bad, bad, bad], teammates: [ok, ok, ok] },
  knowledge: { "claude-code-style": [ok, ok], teammates: [ok, ok, ok], "kitchen-sink": [ok, ok, ok], "shift-manager": [ok, ok, ok] },
};
const rules: [string, boolean, boolean][] = [
  ["3 of 3 passes in an app", passesIn(sheet, "date", "teammates"), true],
  ["2 of 3 does not pass", passesIn(sheet, "sizing", "teammates"), false],
  ["2 recorded runs is not a pass", passesIn(sheet, "knowledge", "claude-code-style"), false],
  ["date is cut (passes everywhere on the cut run)", passesEverywhere(sheet, "date", "cut"), true],
  ["one failing app keeps the layer", passesEverywhere(sheet, "sizing", "cut"), false],
  ["control: one failed run anywhere holds", controlFails(sheet, "sizing"), true],
  ["control: an ask that never fails does not hold", controlFails(sheet, "date"), false],
  ["an unrun ask passes nowhere", passesEverywhere(sheet, "skill", "wrap"), false],
  ["fold is cut on Teammates alone", passesEverywhere(sheet, "fold", "cut"), true],
  ["fold at the wrap needs both labs", passesEverywhere(sheet, "fold", "wrap"), false],
  ["the fold's control counts Teammates alone", controlFails(sheet, "fold"), false],
  ["fold counts in two labs at the wrap", cellsFor("wrap", "fold").length === 2, true],
  ["the sweep finds a length line split across lines", sweepGuidance({ "a/WORKER.md": "Answer in a\nsentence or two, and say so." }).length === 1, true],
  ["the sweep finds a date line", sweepGuidance({ "a/WORKER.md": "Always state today's date first." }).length === 1, true],
  ["the sweep passes a worker with no such line", sweepGuidance({ "a/WORKER.md": "You are the main session. Read the project before you answer." }).length === 0, true],
];

await runGoal((failures, tell) => {
  for (const [name, graded, shouldPass] of tell.over("grader cases", cases)) {
    if (shouldPass && graded.length > 0) failures.push(`${name}: should pass, got ${graded.join("; ")}`);
    if (!shouldPass && graded.length === 0) failures.push(`${name}: a hollow turn passed`);
  }
  for (const [name, got, want] of tell.over("verdict rules", rules)) if (got !== want) failures.push(`${name}: got ${got}`);
  return { failures, evidence: `${cases.length} grader cases (${cases.filter((c) => !c[2]).length} hollow, each refused) and ${rules.length} verdict rules` };
});
