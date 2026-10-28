#!/usr/bin/env node
// FIX-1887 surface sweep. Retained spec evidence, not production code.
//
// The epic's (FIX-1870) sweep: the retired ways of giving another worker work
// are gone from what a person reads or imports. It reads ONE commit, through
// `git grep <commit>`, so the pass and its control run from the same checkout:
//
//   node specs/issues/FIX-1887/poc/surface-sweep/sweep.mjs                 # HEAD, report
//   node specs/issues/FIX-1887/poc/surface-sweep/sweep.mjs --at <commit>   # any commit
//   node specs/issues/FIX-1887/poc/surface-sweep/sweep.mjs --assert        # exit 1 on any live hit
//   node specs/issues/FIX-1887/poc/surface-sweep/sweep.mjs --control       # plant a hit in the
//                                                                          # line matcher, expect it caught
//
// The epic's control: `--assert --at <the main commit before FIX-1875's first
// PR merged>` must exit 1. After the last child merges, `--assert` at HEAD must exit 0.
//
// Exported symbols and tool names are read from source: a tool reaches a
// list only by a name declared as a string literal, a key constant, or a
// worker file's `tools:` line, and a symbol is exported only by a line that
// names it. The runtime refusals are the children's own checks (FIX-1875 V6,
// FIX-1872 BR-18 and its V7), cited by the report, not rechecked here.
//
// A line that names a retired name on purpose (a refusal of the old name, a
// legacy reader) carries `retired-name-refusal` and is not a live use; the
// marker FIX-1875 and FIX-1876 also use.
//
// A published page's `handOff` migration sentence is kept instead by the
// vocabulary sweep's own WR-25b entries, read from its rules: each admits the
// sentence only on a line naming `handOff` once, so a stale second mention
// beside it stays live here too.
import { execFileSync } from "node:child_process";
import { KEEP } from "../../../../../goals/vocabulary/one-word-per-thing/rules.mjs";

const args = process.argv.slice(2);
const at = args.includes("--at") ? args[args.indexOf("--at") + 1] : "HEAD";
const MARKER = "retired-name-refusal";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
process.chdir(root);
const sha = execFileSync("git", ["rev-parse", at], { encoding: "utf8" }).trim();

/**
 * What a person reads or imports. Tests, goal checks, specs, changesets and
 * changelogs are not the public surface: a test may name a retired field to
 * prove it is refused, and history may remember it.
 */
const SCOPE = [
  "packages/*/src/**",
  "packages/*/teams/**",
  "packages/*/README.md",
  "apps/docs/docs/**",
  "apps/kitchen-sink/**",
  ":(exclude)**/test/**",
  ":(exclude)**/tests/**",
  ":(exclude)**/__tests__/**",
  ":(exclude)**/*.test.ts",
  ":(exclude)**/*.test.tsx",
];

/** One rule per retired thing the epic's signal names. */
const RULES = [
  { id: "wait-flag", what: "`waitForResponse` (addTask's wait flag)", re: String.raw`\bwaitForResponse\b` },
  {
    id: "addtask-timeout",
    what: "`timeoutMs` on `addTask`: both on one line, or inside one `addTask({ … })` call across lines",
    re: String.raw`(\baddTask\b.*\btimeoutMs\b|\btimeoutMs\b.*\baddTask\b)`,
    // A call wrapped over lines: read each file that names both, whole.
    span: { words: ["addTask", "timeoutMs"], re: /\baddTask\s*\(\s*\{[^{}]*?\btimeoutMs\b/g },
  },
  {
    id: "ask-exports",
    what: "the public ask names FIX-1875 renames",
    re: String.raw`\b(addTaskAndWait|AddTaskAndWaitOptions|WaitForResponseResult|canHoldAsk|AskEndedError|AskStoppedError|(DEFAULT|MIN|MAX)_ASK_TIMEOUT_MS)\b`,
  },
  {
    id: "handoff-tool",
    what: "the coordinator's `handOff` tool: its name as a string, its key, an exported `handOff`, a worker file's `tools:` line, or `handOff` in backticks in a page",
    re: String.raw`(["'\`]handOff["'\`]|\bHAND_OFF\b|\bexport\b.*\bhandOff\b|^tools:.*\bhandOff\b)`,
  },
  { id: "post-to-mailbox", what: "`post-to-mailbox`", re: String.raw`post-to-mailbox` },
  {
    id: "ledger",
    what: "the coordinator's delivery ledger",
    re: String.raw`(delivery-ledger|DeliveryLedger|deliveryLedger|DELIVERIES_STATE|[Dd]elivery ledger)`,
  },
  {
    id: "ledger-entries",
    what: "the ledger's two answer entries",
    re: String.raw`\b(delegateAnswer|delegateMissed|DELEGATE_ANSWER_ACTION|DELEGATE_MISSED_ACTION)\b`,
  },
];

/** The vocabulary sweep's WR-25b entries: FIX-1872's `handOff` migration sentences on pages. */
const PAGE_KEEP = KEEP.filter((k) => k.why.startsWith("WR-25b"));
if (PAGE_KEEP.length === 0) throw new Error("no WR-25b entry in the vocabulary sweep's KEEP");

/** A `handoff-tool` hit on a kept page sentence; any other rule, path or line stays live. */
const isKept = (rule, h) => rule === "handoff-tool" && PAGE_KEEP.some((k) => k.path.test(h.path) && k.line.test(h.text));

/** `git grep` exits 1 on no match; that is a clean rule, not an error. */
function grep(re) {
  try {
    return execFileSync("git", ["grep", "-n", "-I", "-P", re, sha, "--", ...SCOPE], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
      .split("\n")
      .filter(Boolean);
  } catch (e) {
    if (e.status === 1) return [];
    throw e;
  }
}

/** A rule's `span`: matches that cross lines, in files naming every word; each reported at its last line. */
function spanHits(span) {
  let files;
  try {
    const flags = span.words.flatMap((w) => ["-e", w]);
    files = execFileSync("git", ["grep", "-l", "-I", "--all-match", ...flags, sha, "--", ...SCOPE], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .map((l) => l.slice(sha.length + 1));
  } catch (e) {
    if (e.status === 1) return [];
    throw e;
  }
  const out = [];
  for (const path of files) {
    const text = execFileSync("git", ["show", `${sha}:${path}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const lines = text.split("\n");
    for (const m of text.matchAll(span.re)) {
      const line = text.slice(0, m.index + m[0].length).split("\n").length;
      out.push(`${sha}:${path}:${line}:${lines[line - 1]}`);
    }
  }
  return out;
}

/**
 * A sweep that scanned nothing passes. Each place SCOPE reads must hold at
 * least one file at the commit, or the run stops: a moved tree is a finding
 * against the sweep, not a pass.
 */
function assertScopeReads() {
  const excludes = SCOPE.filter((g) => g.startsWith(":(exclude)"));
  for (const glob of SCOPE.filter((g) => !g.startsWith(":(exclude)"))) {
    let n = 0;
    try {
      n = execFileSync("git", ["grep", "-l", "-I", "-e", "", sha, "--", glob, ...excludes], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n").filter(Boolean).length;
    } catch (e) {
      if (e.status !== 1) throw e;
    }
    console.log(`  scope ${glob}: ${n} file(s)`);
    if (n === 0) {
      console.log(`FAIL · scope \`${glob}\` reads no file at ${sha.slice(0, 12)}: the sweep would pass on nothing`);
      process.exit(3);
    }
  }
}

/** `<sha>:<path>:<line>:<text>` → a live hit, or undefined when marked. */
function parse(hit) {
  const rest = hit.slice(sha.length + 1);
  const m = /^([^:]+):(\d+):(.*)$/.exec(rest);
  if (m === null) throw new Error(`unparsed git grep line: ${hit}`);
  const [, path, line, text] = m;
  return text.includes(MARKER) ? undefined : { path, line: Number(line), text: text.trim() };
}

if (args.includes("--control")) {
  // The negative control: every rule must catch its own planted line, and the
  // marker must clear it. A rule that can't fail is not a check.
  const planted = {
    "wait-flag": 'addTask({ goal, waitForResponse: true })',
    "addtask-timeout": 'addTask({ goal, assignee: "ops", timeoutMs: 120000 })',
    "addtask-timeout:span": 'await addTask({\n  goal,\n  timeoutMs: 120000,\n});',
    "ask-exports": "import { AskEndedError } from '@flow-state-dev/core'",
    "handoff-tool": [
      'export const HAND_OFF = "handOff";',
      "export function handOff(post) {",
      "tools: [listDelegates, handOff]",
    ],
    "post-to-mailbox": "uses: [post-to-mailbox]",
    ledger: "state[DELIVERIES_STATE]",
    "ledger-entries": "[DELEGATE_ANSWER_ACTION]: { block: delegateAnswer }",
  };
  let bad = 0;
  for (const r of RULES) {
    // `m`: a `^` alternative anchors at a line start, as git grep reads it.
    const re = new RegExp(r.re, "m");
    for (const line of [planted[r.id]].flat()) {
      const caught = re.test(line);
      // The same line, marked, through the real hit parser: it must be dropped.
      const cleared = parse(`${sha}:scratch/planted.ts:1:${line} // ${MARKER}`) === undefined;
      console.log(`${caught && cleared ? "ok  " : "MISS"} ${r.id}: ${line}`);
      if (!caught || !cleared) bad++;
    }
    if (r.span !== undefined) {
      const line = planted[`${r.id}:span`];
      const caught = [...line.matchAll(r.span.re)].length === 1;
      console.log(`${caught ? "ok  " : "MISS"} ${r.id} (across lines): ${line.replace(/\n\s*/g, " ")}`);
      if (!caught) bad++;
    }
  }
  // The page keep: the WR-25b sentence on its page is kept, and the same line
  // with a second `handOff` beside it, or on another page, is not.
  const sentence = "Earlier versions declared the entry under `internal.actions` and named the dispatch tool `handOff`.";
  for (const [path, text, want] of [
    ["packages/workforce/README.md", sentence, true],
    ["packages/workforce/README.md", `${sentence} Pass \`handOff\` in \`tools:\`.`, false],
    ["apps/docs/docs/orchestration/task-board.md", sentence, false],
  ]) {
    const kept = isKept("handoff-tool", { path, text });
    console.log(`${kept === want ? "ok  " : "MISS"} page keep ${want ? "keeps" : "leaves live"}: ${path}: ${text}`);
    if (kept !== want) bad++;
  }
  process.exit(bad === 0 ? 2 : 3); // 2 = every plant caught (the control FAILS the sweep, as it must)
}

let live = 0;
console.log(`surface sweep at ${sha}`);
assertScopeReads();
for (const r of RULES) {
  const raw = grep(r.re);
  if (r.span !== undefined) {
    const seen = new Set(raw.map((h) => h.split(":").slice(1, 3).join(":")));
    for (const h of spanHits(r.span)) if (!seen.has(h.split(":").slice(1, 3).join(":"))) raw.push(h);
  }
  const parsed = raw.map(parse).filter(Boolean);
  const hits = parsed.filter((h) => !isKept(r.id, h));
  const kept = parsed.length - hits.length;
  live += hits.length;
  const files = [...new Set(hits.map((h) => h.path))];
  console.log(`\n${hits.length === 0 ? "PASS" : "FAIL"} ${r.id} · ${r.what}: ${hits.length} line(s) in ${files.length} file(s)${kept ? ` (${kept} kept by WR-25b)` : ""}`);
  for (const h of hits.slice(0, 12)) console.log(`  ${h.path}:${h.line}  ${h.text.slice(0, 140)}`);
  if (hits.length > 12) console.log(`  … ${hits.length - 12} more`);
}
console.log(`\n${live === 0 ? "PASS" : "FAIL"} · ${live} live line(s) at ${sha.slice(0, 12)}`);
if (args.includes("--assert") && live > 0) process.exit(1);
