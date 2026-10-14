#!/usr/bin/env node
// FIX-1887 rename-map check: the closure's judge of "nothing changed but names" (goal.md, P1.m).
// Moved from the spec's POC unchanged in rule.
//
// The epic's (FIX-1870) anti-game: since the epic spec merged, the diff to the
// three regression checks is names only, and the diff to the three coordinator
// checks (and the reruns FIX-1872's V9 names) is names, FIX-1872's two named
// shape entries, and listed fence lines.
// Every changed hunk is explained, or the check fails and prints it.
//
//   node goals/dispatching-work/runs-on-dispatch-task-alone/rename-map.mjs                   # base..HEAD
//   node goals/dispatching-work/runs-on-dispatch-task-alone/rename-map.mjs --head <ref>      # base..<ref>
//   node goals/dispatching-work/runs-on-dispatch-task-alone/rename-map.mjs --sources         # the map against the
//                                                                         # children's pinned tables
//   node goals/dispatching-work/runs-on-dispatch-task-alone/rename-map.mjs --control         # planted edits, must FAIL
//
// Exit: 0 every hunk explained · 1 a hunk unexplained · 2 the control caught
// every plant (the control's pass) · 3 the map and the sources disagree.
//
// How a hunk is explained: both sides are cut into tokens (words, numbers,
// single punctuation; whitespace ignored, so a re-wrapped line still compares).
// The old side's tokens are rewritten by the shape entries the hunk's group
// allows; then both sides must have the same length, and each differing token
// pair must be a map pair, the generic ask→wait family FIX-1876's table names,
// or an article (a/an) agreeing with the name after it.
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
process.chdir(root);
const here = dirname(fileURLToPath(import.meta.url));

/** The epic spec's merge commit (#3109): "the diff since this spec merged". */
const BASE = opt("--base", "f1ae352110a5e1ede28d9268161732e8bd1b14d7");
const HEAD = opt("--head", "HEAD");
/**
 * FIX-1872 V9's reruns change for reasons outside the epic before it lands, so
 * they are judged from the control commit (the main commit before FIX-1875's
 * first PR merged), passed by the closure runner. Not given: not judged, said so.
 */
const RERUN_BASE = opt("--rerun-base", undefined);

const REGRESSION = [
  "goals/hand-offs/ask-survives-a-restart/",
  "goals/coordinators/task-session-stays-open/",
  "goals/hand-offs/survives-a-restart-and-runs-once/",
];
const COORDINATOR = [
  "goals/coordinators/hands-each-post-to-its-delegates/",
  "goals/coordinators/files-tasks-down-the-owners-chain/",
  "goals/workforce-mailboxes/a-routed-post-gets-one-answer/",
];
/** FIX-1872 V9: these reruns' diffs pass this script too, judged as coordinator checks (declaration moves, listed fence lines). */
const RERUNS = [
  "goals/projects/a-shared-project-has-one-owner-per-workstream/",
  "goals/workforce-privacy/two-users-share-a-project-and-nothing-else/",
  "goals/workers/files-and-splits-down-the-chain/",
  "goals/pentest-lab/",
  "apps/kitchen-sink/lib/landing-control.ts",
];

/**
 * The map: [old, new, source]. Read off FIX-1875 PLAN.md → "The rename map" and
 * FIX-1876 PLAN.md → "Pinned names"; `--sources` checks both directions.
 */
const MAP = [
  ["addTask_tasks", "dispatchTask_tasks", "FIX-1875"],
  ["addTask", "dispatchTask", "FIX-1875"],
  ["waitForResponse", "wait", "FIX-1875"],
  ["addTaskAndWait", "dispatchAndWait", "FIX-1875"],
  ["AddTaskAndWaitOptions", "DispatchAndWaitOptions", "FIX-1875"],
  ["WaitForResponseResult", "DispatchAndWaitResult", "FIX-1875"],
  ["canHoldAsk", "canHoldWait", "FIX-1875"],
  ["AskEndedError", "WaitEndedError", "FIX-1875"],
  ["AskStoppedError", "WaitStoppedError", "FIX-1875"],
  ["DEFAULT_ASK_TIMEOUT_MS", "DEFAULT_WAIT_TIMEOUT_MS", "FIX-1875"],
  ["MIN_ASK_TIMEOUT_MS", "MIN_WAIT_TIMEOUT_MS", "FIX-1875"],
  ["MAX_ASK_TIMEOUT_MS", "MAX_WAIT_TIMEOUT_MS", "FIX-1875"],
  ["ASK_GATE_REASON", "WAIT_GATE_REASON", "FIX-1876"],
  ["isAskGate", "isWaitGate", "FIX-1876"],
  ["AskGateBinding", "WaitGateBinding", "FIX-1876"],
  ["AskOutcome", "WaitOutcome", "FIX-1876"],
  ["AskEndingErrorCode", "WaitEndingErrorCode", "FIX-1876"],
  ["recordedAskOutcome", "recordedWaitOutcome", "FIX-1876"],
  ["parkOnAsk", "parkOnWait", "FIX-1876"],
  ["ParkOnAskInput", "ParkOnWaitInput", "FIX-1876"],
  ["parseAskOutcome", "parseWaitOutcome", "FIX-1876"],
  ["resumeAsk", "resumeWait", "FIX-1876"],
  ["ResumeAskInput", "ResumeWaitInput", "FIX-1876"],
  ["ResumeAskResult", "ResumeWaitResult", "FIX-1876"],
  ["resumeAskGate", "resumeWaitGate", "FIX-1876"],
  ["AskResumeOperation", "WaitResumeOperation", "FIX-1876"],
  ["createAskResumeOperation", "createWaitResumeOperation", "FIX-1876"],
  ["hasAskSweeper", "hasWaitSweeper", "FIX-1876"],
  ["resumeOwedAsks", "resumeOwedWaits", "FIX-1876"],
  ["askGateId", "waitGateId", "FIX-1876"],
  ["ask", "wait", "FIX-1876"], // Task.ask → Task.wait: only after a `.`, see pairOk
  ["asked", "waitedOn", "FIX-1876"], // the task listing's `asked: true`: only before a `:`, see pairOk
  ["createHandOff", "createRowDispatch", "FIX-1876"],
  ["HandOffOptions", "RowDispatchOptions", "FIX-1876"],
  ["HandOffAssignee", "DispatchingAssignee", "FIX-1876"],
  ["handedOffTaskPredicate", "dispatchedTaskPredicate", "FIX-1876"],
  ["assertHandOffBoardSupported", "assertDispatchBoardSupported", "FIX-1876"],
  ["assertHandOffBlockSupported", "assertDispatchEntrySupported", "FIX-1876"],
  ["handedOff", "dispatchers", "FIX-1876"],
  ["handedOff", "dispatched", "FIX-1876"],
  ["handed", "dispatched", "FIX-1876"], // the "handed-off" ending: `handed - off` → `dispatched`, see SHAPES
  ["handOff", "dispatchTask", "#3153"], // coordinator checks only, see SHAPES
  ["worker", "assignee", "#3153"], // coordinator checks only, inside a handOff call
  ["internal", "task", "#3153"], // coordinator checks only, on the post entry's declaration
];
const PAIRS = new Set(MAP.map(([o, n]) => `${o}\u0000${n}`));
/** Pairs that are only names inside a coordinator check's shape entry (#3153), never in the three (ER-11). */
const COORDINATOR_ONLY = new Set(["handOff\u0000dispatchTask", "worker\u0000assignee", "internal\u0000task"]);
/** Tokens the children's tables name and keep (wire values) or that are words, not names. */
const KEPT = new Set(["fsd.ask.step:", "fsd.ask.plan:", "fsd.ask.file:", "TaskNotice.asked", "Task.ask", "Task.wait", "RequestHost.resumeAsk", "asked: true", "waitedOn: true", "handedOff: true", "dispatched: true", "\"handed-off\"", "\"dispatched\"", "#assignees-that-hand-off", "ASK_GATE_REASON = \"ask\"", "WAIT_GATE_REASON = \"wait\"", "Wait", "updateTask", "patchMetadata", "rename map"]);

/** FIX-1876: "the engine's other `*Ask*` internals → the same with `Wait`". */
function askFamily(o, n) {
  if (!/Ask|^ask[A-Z]|_ASK_|^ASK_/.test(o)) return false;
  return o.replace(/Ask/g, "Wait").replace(/^ask(?=[A-Z])/, "wait").replace(/(^|_)ASK(?=_)/g, "$1WAIT") === n;
}

const tokenize = (s) => s.match(/[A-Za-z_$][\w$]*|\d[\d_]*|[^\sA-Za-z0-9_$]/g) ?? [];
const ARTICLES = new Set(["a\u0000an", "an\u0000a", "A\u0000An", "An\u0000A"]);

/** Shape rewrites applied to the OLD side before comparing; each returns new tokens or the same array. */
const SHAPES = {
  /** FIX-1876: the board ending `"handed-off"` → `"dispatched"`. Every group: a stored value a check may read. */
  handedOffEnding(t) {
    const out = [];
    for (let i = 0; i < t.length; i++) {
      if (t[i] === "handed" && t[i + 1] === "-" && t[i + 2] === "off") {
        out.push("dispatched");
        i += 2;
      } else out.push(t[i]);
    }
    return out;
  },
  /** #3153: `handOff({ worker, target? })` → `dispatchTask({ post: true, assignee, target? })`. Coordinator checks only. */
  handOffCall(t) {
    if (!t.includes("handOff")) return t;
    const out = [];
    for (let i = 0; i < t.length; i++) {
      // `worker:` and `"worker":` both open the recipient; `post: true,` is inserted before it.
      if (t[i] === "worker" && t[i + 1] === ":") out.push("post", ":", "true", ",", "worker");
      else if (t[i] === '"' && t[i + 1] === "worker" && t[i + 2] === '"' && t[i + 3] === ":") {
        out.push('"', "post", '"', ":", "true", ",", '"', "worker");
        i += 1;
      } else out.push(t[i]);
    }
    return out;
  },
};

/** Why a differing token pair is a name, or undefined when it isn't. */
function pairOk(o, n, i, oldT, newT, group, hunkText) {
  const key = `${o}\u0000${n}`;
  if (COORDINATOR_ONLY.has(key)) {
    if (group !== "coordinator") return undefined;
    if (key === "internal\u0000task") return /DELEGATED_POST_ENTRY|delegatedPostEntry/.test(hunkText) ? "#3153 declaration move" : undefined;
    return /handOff/.test(hunkText) ? "#3153 handOff → dispatchTask({ post: true, assignee })" : undefined;
  }
  if (key === "ask\u0000wait") return oldT[i - 1] === "." ? "FIX-1876 Task.ask" : undefined;
  if (key === "asked\u0000waitedOn") return oldT[i + 1] === ":" ? "FIX-1876 listing field" : undefined;
  if (PAIRS.has(key)) return "map";
  if (askFamily(o, n)) return "FIX-1876 *Ask* family";
  if (ARTICLES.has(key)) {
    // An article agrees with the next word, which must itself be a renamed pair.
    for (let j = i + 1; j < oldT.length; j++) {
      if (!/^[A-Za-z_$]/.test(oldT[j])) continue;
      return oldT[j] !== newT[j] && pairOk(oldT[j], newT[j], j, oldT, newT, group, hunkText) ? "article agreement" : undefined;
    }
  }
  return undefined;
}

/**
 * A hunk: explained (with its reasons) or not (with the first offending pair).
 * A fence entry `{ path, removed, added, why }` exempts exactly one removed line
 * and the one added line that replaces it, in that path and a coordinator check
 * only; the rest of the hunk is judged as usual (CR-14).
 */
function judge(removed, added, group, fences, path) {
  const fenced = [];
  if (group === "coordinator") {
    removed = [...removed];
    added = [...added];
    for (const f of fences) {
      if (f.path !== path) continue;
      const r = removed.findIndex((l) => l.includes(f.removed));
      const a = added.findIndex((l) => l.includes(f.added));
      if (r === -1 || a === -1) continue;
      removed.splice(r, 1);
      added.splice(a, 1);
      fenced.push(`fence line (listed: ${f.why})`);
    }
  }
  const hunkText = removed.join("\n");
  let oldT = SHAPES.handedOffEnding(tokenize(hunkText));
  if (group === "coordinator") oldT = SHAPES.handOffCall(oldT);
  const newT = tokenize(added.join("\n"));
  if (oldT.length !== newT.length) return { ok: false, why: `token count ${oldT.length} → ${newT.length}: something besides a name was added or removed` };
  const reasons = new Set();
  for (let i = 0; i < oldT.length; i++) {
    if (oldT[i] === newT[i]) continue;
    const r = pairOk(oldT[i], newT[i], i, oldT, newT, group, hunkText);
    if (r === undefined) return { ok: false, why: `\`${oldT[i]}\` → \`${newT[i]}\` is not in the map` };
    reasons.add(r);
  }
  return { ok: true, reasons: [...fenced, ...reasons] };
}

/** `git diff -U0` → [{ path, removed[], added[] }]. */
function hunks(base, head, paths) {
  const out = execFileSync("git", ["diff", "-U0", "--no-color", "--no-ext-diff", base, head, "--", ...paths], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const list = [];
  let path;
  let cur;
  for (const line of out.split("\n")) {
    if (line.startsWith("+++ ")) path = line.slice(6);
    else if (line.startsWith("@@")) list.push((cur = { path, removed: [], added: [] }));
    else if (cur && line.startsWith("-") && !line.startsWith("--- ")) cur.removed.push(line.slice(1));
    else if (cur && line.startsWith("+")) cur.added.push(line.slice(1));
  }
  return list;
}

function loadFences() {
  const f = join(here, "fence-lines.json");
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : [];
}

function run(base, head) {
  const fences = loadFences();
  let bad = 0;
  let good = 0;
  const groups = [["regression", REGRESSION, base], ["coordinator", COORDINATOR, base]];
  if (RERUN_BASE !== undefined) groups.push(["coordinator", RERUNS, RERUN_BASE]);
  else console.log("  (FIX-1872 V9's reruns not judged: pass --rerun-base <control commit>)");
  for (const [group, dirs, from] of groups) {
    for (const h of hunks(from, head, dirs)) {
      const v = judge(h.removed, h.added, group, fences, h.path);
      if (v.ok) {
        good++;
        console.log(`  ok    ${h.path}  (${v.reasons.join(", ")})`);
      } else {
        bad++;
        console.log(`  FAIL  ${h.path}  ${v.why}`);
        for (const l of h.removed) console.log(`        - ${l.trim().slice(0, 150)}`);
        for (const l of h.added) console.log(`        + ${l.trim().slice(0, 150)}`);
      }
    }
  }
  return { good, bad };
}

if (args.includes("--sources")) {
  // Both directions: every map entry is in its child's table, and every name
  // in those tables is a map entry or kept on purpose (totality).
  const read = (id) => readFileSync(`specs/issues/${id}/PLAN.md`, "utf8");
  const plan1875 = read("FIX-1875");
  const plan1876 = read("FIX-1876");
  // The tables are found by their headings. A heading that moved stops the run:
  // fix the extraction, never hand-edit MAP to make a diff pass (PLAN guardrails).
  const cut = (text, id, start, end) => {
    const s = text.indexOf(start);
    if (s === -1) {
      console.log(`sources: ${id}'s PLAN.md has no "${start}"; fix the extraction, don't edit MAP`);
      process.exit(3);
    }
    const e = text.indexOf(end, s + start.length);
    return text.slice(s, e === -1 ? undefined : e);
  };
  const section1875 = cut(plan1875, "FIX-1875", "**The rename map**", "\n\n");
  const section1876 = cut(plan1876, "FIX-1876", "## Pinned names", "\n## ");
  const src = { "FIX-1875": section1875, "FIX-1876": section1876 };
  /** Every whole backticked name in a table, split on ` · `: a name matches only as a complete entry. */
  const names = (t) => new Set([...t.matchAll(/`([^`]+)`/g)].flatMap((m) => m[1].split(/\s*·\s*/)));
  let bad = 0;
  for (const [o, n, from] of MAP) {
    if (!(from in src)) continue; // #3153 entries are prose in the epic SPEC, checked by eye
    const t = src[from];
    const whole = names(t);
    const has = (x) => whole.has(x) || (x === "ask" && whole.has("Task.ask")) || (x === "wait" && whole.has("Task.wait")) || (x === "asked" && whole.has("asked: true")) || (x === "waitedOn" && whole.has("waitedOn: true")) || (x === "handedOff" && whole.has("handedOff: true")) || (x === "handed" && whole.has('"handed-off"')) || (x === "dispatched" && (whole.has('"dispatched"') || whole.has("dispatched: true")));
    // Two rows elide their names: FIX-1875's `MIN_…`, `MAX_…` → `…_WAIT_TIMEOUT_MS`, and
    // FIX-1876's "`hasAskSweeper` and the engine's other `*Ask*` internals → the same with `Wait`".
    const elided =
      (/_ASK_TIMEOUT_MS$/.test(o) && t.includes("…_WAIT_TIMEOUT_MS") && t.includes(o.split("_")[0])) ||
      (has(o) && t.includes("the same with `Wait`") && askFamily(o, n)) ||
      (askFamily(o, n) && t.includes("other `*Ask*` internals"));
    if (!elided && (!has(o) || !has(n))) {
      bad++;
      console.log(`MISSING in ${from}: ${o} → ${n}`);
    }
  }
  const known = new Set(MAP.flatMap(([o, n]) => [o, n]));
  for (const [from, t] of Object.entries(src)) {
    for (const m of t.matchAll(/`([^`]+)`/g)) {
      for (const name of m[1].split(/\s*·\s*/)) {
        const bare = name.replace(/^the same with /, "");
        if (known.has(bare) || KEPT.has(bare) || bare.includes("…") || bare.includes("<") || /^`?\.?\*/.test(bare)) continue;
        bad++;
        console.log(`UNMAPPED in ${from}: \`${bare}\``);
      }
    }
  }
  console.log(bad === 0 ? "sources: the map and both tables agree" : `sources: ${bad} disagreement(s)`);
  process.exit(bad === 0 ? 0 : 3);
}

if (args.includes("--control")) {
  // Each plant must FAIL, and each pure rename must pass. Built from the
  // checks' own lines at BASE, so the control runs on the real text.
  const line = (path, re) => execFileSync("git", ["show", `${BASE}:${path}`], { encoding: "utf8" }).split("\n").find((l) => re.test(l));
  const filed = line("goals/coordinators/task-session-stays-open/run.mts", /const filed = await act\("coordinator", conv, "addTask_tasks"/);
  const parked = line("goals/coordinators/task-session-stays-open/run.mts", /const parked = await waitFor/);
  // A synthetic fence entry, shaped as FIX-1872's implementer writes one.
  const FENCE_PATH = "goals/coordinators/hands-each-post-to-its-delegates/devteam.mts";
  const LEDGER_READ = '  const delivered = ledger.filter((d) => d.outcome === "delivered");';
  const ROW_READ = '  const delivered = rows.filter((r) => r.status === "completed" && r.post === true);';
  const CONTROL_FENCES = [{ path: FENCE_PATH, removed: "ledger.filter(", added: "rows.filter(", why: "control: a ledger read becomes a row read" }];
  const cases = [
    ["pure rename passes", [filed], [filed.replace("addTask_tasks", "dispatchTask_tasks")], "regression", true],
    ["re-wrapped rename passes", [filed], filed.replace("addTask_tasks", "dispatchTask_tasks").replace(", {", ",\n    {").split("\n"), "regression", true],
    ["a loosened timeout FAILS", [parked], [parked.replace("120_000", "240_000")], "regression", false],
    ["an assertion widened to the old name FAILS", ['filter((i) => i.toolCall?.name === "addTask")'], ['filter((i) => (i.toolCall?.name === "addTask" || i.toolCall?.name === "dispatchTask"))'], "coordinator", false],
    ["a shape entry in a regression check FAILS", ['toolName: "handOff", args: { worker: id }'], ['toolName: "dispatchTask", args: { post: true, assignee: id }'], "regression", false],
    ["the same shape entry in a coordinator check passes", ['toolName: "handOff", args: { worker: id }'], ['toolName: "dispatchTask", args: { post: true, assignee: id }'], "coordinator", true],
    ["a dropped leg FAILS", [filed, parked], [filed.replace("addTask_tasks", "dispatchTask_tasks")], "regression", false],
    // CR-14: a listed fence line is exempt alone, in its own path, and nothing beside it is.
    ["a listed fence line passes", [LEDGER_READ], [ROW_READ], "coordinator", true, FENCE_PATH],
    ["a fence line beside a loosened timeout FAILS", [LEDGER_READ, parked], [ROW_READ, parked.replace("120_000", "240_000")], "coordinator", false, FENCE_PATH],
    ["a fence entry in another path admits nothing", [LEDGER_READ], [ROW_READ], "coordinator", false, "goals/coordinators/files-tasks-down-the-owners-chain/run.mts"],
    ["a fence line in a regression check FAILS", [LEDGER_READ], [ROW_READ], "regression", false, FENCE_PATH],
  ];
  let wrong = 0;
  for (const [name, removed, added, group, want, path] of cases) {
    const v = judge(removed, added, group, CONTROL_FENCES, path);
    const right = v.ok === want;
    if (!right) wrong++;
    console.log(`${right ? "ok  " : "WRONG"} ${name}: ${v.ok ? "explained" : v.why}`);
  }
  process.exit(wrong === 0 ? 2 : 1);
}

console.log(`rename-map check · ${BASE.slice(0, 12)}..${execFileSync("git", ["rev-parse", HEAD], { encoding: "utf8" }).trim().slice(0, 12)}`);
const { good, bad } = run(BASE, HEAD);
console.log(`\n${bad === 0 ? "PASS" : "FAIL"} · ${good} hunk(s) explained, ${bad} not`);
process.exit(bad === 0 ? 0 : 1);
