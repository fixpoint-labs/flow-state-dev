#!/usr/bin/env node
// FIX-1887 surface sweep, static half. Retained spec evidence, not production code.
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
// The runtime half (the tool lists and the exported symbols, read from the
// built packages) is PLAN.md's S4, built at implement time.
//
// A line that names a retired name on purpose (a refusal of the old name, a
// legacy reader) carries `retired-name-refusal` and is not a live use; the
// marker FIX-1875 and FIX-1876 also use.
import { execFileSync } from "node:child_process";

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
    id: "ask-exports",
    what: "the public ask names FIX-1875 renames",
    re: String.raw`\b(addTaskAndWait|AddTaskAndWaitOptions|WaitForResponseResult|canHoldAsk|AskEndedError|AskStoppedError|(DEFAULT|MIN|MAX)_ASK_TIMEOUT_MS)\b`,
  },
  {
    id: "handoff-tool",
    what: "the coordinator's `handOff` tool: its name as a string, its key, or `handOff` in backticks in a page",
    re: String.raw`(["'\`]handOff["'\`]|\bHAND_OFF\b)`,
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

/** `<sha>:<path>:<line>:<text>` → a live hit, or undefined when marked. */
function parse(hit) {
  const rest = hit.slice(sha.length + 1);
  const m = /^([^:]+):(\d+):(.*)$/.exec(rest);
  if (m === null) throw new Error(`unparsed git grep line: ${hit}`);
  const [, path, line, text] = m;
  return text.includes(MARKER) ? undefined : { path, line: Number(line), text: text.trim().slice(0, 140) };
}

if (args.includes("--control")) {
  // The negative control: every rule must catch its own planted line, and the
  // marker must clear it. A rule that can't fail is not a check.
  const planted = {
    "wait-flag": 'addTask({ goal, waitForResponse: true })',
    "ask-exports": "import { AskEndedError } from '@flow-state-dev/core'",
    "handoff-tool": 'export const HAND_OFF = "handOff";',
    "post-to-mailbox": "uses: [post-to-mailbox]",
    ledger: "state[DELIVERIES_STATE]",
    "ledger-entries": "[DELEGATE_ANSWER_ACTION]: { block: delegateAnswer }",
  };
  let bad = 0;
  for (const r of RULES) {
    const re = new RegExp(r.re);
    const caught = re.test(planted[r.id]);
    // The same line, marked, through the real hit parser: it must be dropped.
    const cleared = parse(`${sha}:scratch/planted.ts:1:${planted[r.id]} // ${MARKER}`) === undefined;
    console.log(`${caught && cleared ? "ok  " : "MISS"} ${r.id}: ${planted[r.id]}`);
    if (!caught || !cleared) bad++;
  }
  process.exit(bad === 0 ? 2 : 3); // 2 = every plant caught (the control FAILS the sweep, as it must)
}

let live = 0;
console.log(`surface sweep at ${sha}`);
for (const r of RULES) {
  const hits = grep(r.re).map(parse).filter(Boolean);
  live += hits.length;
  const files = [...new Set(hits.map((h) => h.path))];
  console.log(`\n${hits.length === 0 ? "PASS" : "FAIL"} ${r.id} · ${r.what}: ${hits.length} line(s) in ${files.length} file(s)`);
  for (const h of hits.slice(0, 12)) console.log(`  ${h.path}:${h.line}  ${h.text}`);
  if (hits.length > 12) console.log(`  … ${hits.length - 12} more`);
}
console.log(`\n${live === 0 ? "PASS" : "FAIL"} · ${live} live line(s) at ${sha.slice(0, 12)}`);
if (args.includes("--assert") && live > 0) process.exit(1);
