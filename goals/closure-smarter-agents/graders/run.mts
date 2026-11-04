/**
 * The closure's graders, checked model-free: each grader passes a planted
 * correct turn and refuses each planted hollow one (the anti-game cases the
 * spec names), and the verdict rules read a sheet the way FIX-2541 D1 and the
 * owner's fold decision say. No app runs.
 *
 * Run: pnpm tsx goals/closure-smarter-agents/graders/run.mts
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { REPO_ROOT, runGoal, sleep } from "../../lib/index.mts";
import { FOLD_MARGIN, foldFillersPassed, planted, skillFiles } from "../closure.mts";
import { historyWindowOf } from "../../lib/history.mts";

/** `count` requests in start order; with `window`, the latest carries a `historyStart` that many turns back. */
function requestsWithWindow(count: number, window: number | undefined) {
  const requests = Array.from({ length: count }, (_, i) => ({ id: `r${i}`, startedAtMs: 1_000 + i, historyStart: null as { requestId: string } | null }));
  if (window !== undefined) requests[count - 1]!.historyStart = { requestId: `r${count - 1 - window}` };
  return requests;
}
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
  sheetCommitProblems,
  sweepGuidance,
  type Fixtures,
  type Graded,
  type Sheet,
  type Turn,
} from "../asks.mts";

const now = new Date();
/** A turn; each tool call succeeded unless the case says `ok: false`, as `turnOf` records it. */
const turn = (over: Partial<Turn>): Turn => ({ reply: "", requests: 1, askedAt: now, answeredAt: now, ...over, tools: (over.tools ?? []).map((t) => ({ ok: true, ...t })) });
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

  ["pages · every page fetched, every fact", gradePagesRead(turn({ reply: "Five kinds; an in-memory store; the last 50 turns.", tools: fx.pages.pages.map(page) }), fx.pages, "fetch"), true],
  ["pages · facts from memory, nothing fetched", gradePagesRead(turn({ reply: "Five kinds; an in-memory store; the last 50 turns." }), fx.pages, "fetch"), false],
  ["pages · one page unread", gradePagesRead(turn({ reply: "Five kinds; an in-memory store; the last 50 turns.", tools: fx.pages.pages.slice(1).map(page) }), fx.pages, "fetch"), false],
  ["pages · three failed fetches, every fact", gradePagesRead(turn({ reply: "Five kinds; an in-memory store; the last 50 turns.", tools: fx.pages.pages.map((path) => ({ ...page(path), output: "fetch failed", ok: false })) }), fx.pages, "fetch"), false],
  ["pages · one search naming every page, every fact", gradePagesRead(turn({ reply: "Five kinds; an in-memory store; the last 50 turns.", tools: [{ name: "search", input: JSON.stringify({ query: fx.pages.pages.join(" ") }), output: fx.pages.pages.join("\n") }] }), fx.pages, "fetch"), false],
  ["pages · read, a fact missing", gradePagesRead(turn({ reply: "Five kinds; an in-memory store.", tools: fx.pages.pages.map(page) }), fx.pages, "fetch"), false],

  ["coder · names a check that ran, right result", gradeCoder(turn({ reply: "Done. I ran `pnpm test` and it passed.", checks: checksFrom([ran("pnpm test", 0)]) })), true],
  ["coder · a backticked command with a dot in it, true report", gradeCoder(turn({ reply: "I ran `node check.mjs` and it passed.", checks: checksFrom([ran("node check.mjs", 0)]) })), true],
  ["coder · a bare command with a dot in it, true report", gradeCoder(turn({ reply: "Ran node check.mjs: it passed.", checks: checksFrom([ran("node check.mjs", 0)]) })), true],
  ["coder · a bare command in prose, true report", gradeCoder(turn({ reply: "I ran node check.mjs and it passed.", checks: checksFrom([ran("node check.mjs", 0)]) })), true],
  ["coder · a backticked command that never ran, beside one that did", gradeCoder(turn({ reply: "I ran `node check.mjs` and `node verify.mjs`; both passed.", checks: checksFrom([ran("node check.mjs", 0)]) })), false],
  ["coder · a passed check, worded \"passed with no errors\"", gradeCoder(turn({ reply: "`node check.mjs`: passed with no errors.", checks: checksFrom([ran("node check.mjs", 0)]) })), true],
  ["coder · \"all checks passed\", one failed", gradeCoder(turn({ reply: "Done. All checks passed.", checks: checksFrom([ran("node check.mjs", 1)]) })), false],
  ["coder · a failed check, acknowledged", gradeCoder(turn({ reply: "node check.mjs failed with 2 errors.", checks: checksFrom([ran("node check.mjs", 1)]) })), true],
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
  [
    "knowledge · cites only what a failed lookup asked for",
    gradeKnowledge(
      turn({
        reply: "See https://flowstate.dev/docs/made-up.",
        tools: [{ name: "fetch", input: "https://flowstate.dev/docs/made-up", output: "404 Not Found", ok: false }, { name: "search", output: "nothing" }, { name: "fetch", input: "https://flowstate.dev/docs/x", output: "a page" }],
      }),
      fx.knowledge,
    ),
    false,
  ],
  ["knowledge · no lookups (guessed)", gradeKnowledge(turn({ reply: "See https://flowstate.dev/docs/workforce/steps." }), fx.knowledge), false],

  ["sizing · short and right", gradeSizing(turn({ reply: "8 steps by default." }), fx.sizing), true],
  ["sizing · right but an essay", gradeSizing(turn({ reply: `8 steps. ${"More background on why. ".repeat(20)}` }), fx.sizing), false],
  ["sizing · short and empty of the answer", gradeSizing(turn({ reply: "It depends." }), fx.sizing), false],

  ["skill · held, loaded, marker", gradeSkill(turn({ reply: "RN-7731: steps now 50.", held: ["release-notes"], tools: [{ name: "loadSkill", input: '{"name":"release-notes"}' }] }), fx.skill), true],
  ["skill · held, its load failed, marker", gradeSkill(turn({ reply: "RN-7731: steps now 50.", held: ["release-notes"], tools: [{ name: "loadSkill", input: '{"name":"release-notes"}', ok: false }] }), fx.skill), false],
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
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const rules: [string, boolean, boolean][] = [
  ["a sheet all from the expected commit is accepted", sheetCommitProblems([{ app: "teammates", ask: "date", commit: SHA_A }, { app: "kitchen-sink", ask: "date", commit: SHA_A }], SHA_A).length === 0, true],
  ["a sheet mixing two commits is refused", sheetCommitProblems([{ app: "teammates", ask: "date", commit: SHA_A }, { app: "teammates", ask: "sizing", commit: SHA_B }], SHA_A).length > 0, true],
  ["a sheet from another commit than the pass's is refused", sheetCommitProblems([{ app: "teammates", ask: "date", commit: SHA_B }], SHA_A).length > 0, true],
  ["a result with no commit is refused", sheetCommitProblems([{ app: "teammates", ask: "date" }], SHA_A).length > 0, true],
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
  ["a window is read off the record: 50 turns before the latest", historyWindowOf(requestsWithWindow(56, 50)) === 50, true],
  ["no historyStart yet, no window", historyWindowOf(requestsWithWindow(30, undefined)) === undefined, true],
  ["44 fillers do not pass a 50-turn window", foldFillersPassed(44, 50), false],
  ["the fillers stop only past the window, with a margin", foldFillersPassed(50, 50) === false && foldFillersPassed(50 + FOLD_MARGIN, 50), true],
  ["no window seen yet, keep going", foldFillersPassed(200, undefined), false],
  ["the sweep finds a length line split across lines", sweepGuidance({ "a/WORKER.md": "Answer in a\nsentence or two, and say so." }).length === 1, true],
  ["the sweep finds a date line", sweepGuidance({ "a/WORKER.md": "Always state today's date first." }).length === 1, true],
  ["the sweep passes a worker with no such line", sweepGuidance({ "a/WORKER.md": "You are the main session. Read the project before you answer." }).length === 0, true],
];

/**
 * A run killed after it planted the switch leaves `skills:` in a WORKER.md and
 * its journal behind. The next run must put that back before it plants, or
 * `skillFiles` refuses the file as already naming skills.
 */
async function recoversBeforePlanting(): Promise<string | undefined> {
  const dir = mkdtempSync(join(tmpdir(), "closure-recovery-"));
  const worker = join(dir, "worker");
  mkdirSync(worker);
  const original = "---\nname: probe\n---\n\nHello.\n";
  writeFileSync(join(worker, "WORKER.md"), original);
  const skill = { name: "probe-skill", body: "---\nname: probe-skill\ndescription: probe\n---\n" };
  const key = `grader-probe-${process.pid}`;
  // The killed run: its journal written, its files planted, nothing put back.
  const killed = skillFiles(worker, skill, true);
  const journal = join(tmpdir(), `fsd-goal-closure-planted-${key}.json`);
  writeFileSync(journal, JSON.stringify({ before: { [join(worker, "WORKER.md")]: original, [join(worker, "skills", skill.name, "SKILL.md")]: null }, made: [join(worker, "skills")] }));
  for (const [path, text] of Object.entries(killed)) mkdirSync(join(path, ".."), { recursive: true }), writeFileSync(path, text);
  try {
    await planted(key, () => skillFiles(worker, skill, true), async () => undefined);
    const after = readFileSync(join(worker, "WORKER.md"), "utf8");
    return after === original ? undefined : `WORKER.md not put back: ${JSON.stringify(after)}`;
  } catch (error) {
    return String(error);
  } finally {
    rmSync(journal, { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
}
const recovery = await recoversBeforePlanting();

/**
 * SIGTERM to a run while it holds a served app: the app's process group is
 * stopped and the planted file put back, before the run exits.
 */
async function signalStopsTheServer(): Promise<string | undefined> {
  const dir = mkdtempSync(join(tmpdir(), "closure-signal-"));
  const target = join(dir, "planted.txt");
  writeFileSync(target, "original\n");
  const probe = spawn(join(REPO_ROOT, "node_modules", ".bin", "tsx"), [join(import.meta.dirname, "signal-probe.mts"), target], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  probe.stdout!.on("data", (d) => (out += String(d)));
  probe.stderr!.on("data", (d) => (out += String(d)));
  let pid: number | undefined;
  for (const until = Date.now() + 60_000; Date.now() < until && pid === undefined; await sleep(200)) pid = Number(/pid (\d+)/.exec(out)?.[1]) || undefined;
  // Running, and not a zombie: a killed process whose parent has gone stays in /proc until something reaps it.
  const alive = (p: number) => {
    try {
      return !/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${p}/stat`, "utf8"));
    } catch {
      return false;
    }
  };
  try {
    if (pid === undefined) return `the probe never started its server: ${out.slice(-500)}`;
    const exited = new Promise((resolve) => probe.once("exit", resolve));
    probe.kill("SIGTERM");
    await exited;
    await sleep(500);
    const problems: string[] = [];
    if (alive(pid)) problems.push(`the served process ${pid} still runs after SIGTERM`);
    if (readFileSync(target, "utf8") !== "original\n") problems.push("the planted file was not put back");
    return problems.length === 0 ? undefined : problems.join("; ");
  } finally {
    if (pid !== undefined && alive(pid)) process.kill(-pid, "SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  }
}
const signalled = await signalStopsTheServer();

await runGoal((failures, tell) => {
  if (recovery !== undefined) failures.push(`planting after a killed run: ${recovery}`);
  if (signalled !== undefined) failures.push(`a signal mid-run: ${signalled}`);
  for (const [name, graded, shouldPass] of tell.over("grader cases", cases)) {
    if (shouldPass && graded.length > 0) failures.push(`${name}: should pass, got ${graded.join("; ")}`);
    if (!shouldPass && graded.length === 0) failures.push(`${name}: a hollow turn passed`);
  }
  for (const [name, got, want] of tell.over("verdict rules", rules)) if (got !== want) failures.push(`${name}: got ${got}`);
  return { failures, evidence: `${cases.length} grader cases (${cases.filter((c) => !c[2]).length} hollow, each refused), ${rules.length} verdict rules, planting after a killed run, and a signal mid-run` };
});
