#!/usr/bin/env node
/**
 * FIX-1876 vocabulary sweep — one word per thing. The goal check for goal.md beside it.
 *
 * Walks every git-tracked file under the swept roots, finds each use of a retired
 * name or a retired meaning (rules.mjs → RETIRED), and fails on any hit that the
 * keep list (rules.mjs → KEEP) does not classify. A line carrying the marker
 * `retired-name-refusal` names a retired name on purpose (a legacy reader, BP-030, or a refusal)
 * and is counted, not failed.
 *
 *   node goals/vocabulary/one-word-per-thing/sweep.mjs            # report + verdict
 *   node goals/vocabulary/one-word-per-thing/sweep.mjs --list     # every unclassified hit
 *   node goals/vocabulary/one-word-per-thing/sweep.mjs --control  # planted hit must FAIL
 *   node goals/vocabulary/one-word-per-thing/sweep.mjs --only ask # one family (rule-id prefix)
 *
 * Totality: every tracked file under a swept root is either scanned or excluded by a
 * named rule in rules.mjs → EXCLUDE; the report prints both counts, and the run fails
 * if a file is neither. CI's Process guards run it, and again with `--control`.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { EXCLUDE, KEEP, REFUSAL_MARKER, RETIRED, ROOTS } from "./rules.mjs";

const argv = process.argv.slice(2);
const args = new Set(argv);
// `--only ask` or `--only handoff,post-to-mailbox`: one PR's families (rule-id prefixes).
const onlyAt = argv.indexOf("--only");
const only = onlyAt >= 0 ? argv[onlyAt + 1].split(",") : undefined;
const inScope = (id) => only === undefined || only.some((p) => id.startsWith(p));
const repo = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const tracked = execFileSync("git", ["ls-files", "--", ...ROOTS], { cwd: repo, encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

// The negative control: planted files, through the same path as every real one. FIX-2242 D2
// adds one per message row, the `replyTo` one under Workforce, the only place that row reads.
const planted = args.has("--control")
  ? [
      { path: "packages/core/src/__planted__.ts", text: "export const x = parkOnAsk;\n" },
      { path: "packages/workforce/src/__planted__.ts", text: "export const y = messageWorker;\nexport const z = { replyTo: 1 };\n" }
    ]
  : undefined;
const plantedText = new Map((planted ?? []).map((p) => [p.path, p.text]));
const files = planted ? [...tracked, ...planted.map((p) => p.path)] : tracked;

const scanned = [];
const excluded = new Map();
const unruled = [];
for (const path of files) {
  // A history exclusion (`over: true`) wins over scanning; any other exclusion only
  // names a file that no retired rule reads, so a scanned file is never excluded by accident.
  const swept = RETIRED.some((r) => r.files.test(path));
  const rule = EXCLUDE.find((r) => r.path.test(path) && (r.over === true || !swept));
  if (rule) {
    excluded.set(rule.why, (excluded.get(rule.why) ?? 0) + 1);
    continue;
  }
  if (!swept) {
    unruled.push(path);
    continue;
  }
  scanned.push(path);
}

const hits = [];
for (const path of scanned) {
  const text = plantedText.get(path) ?? readFileSync(`${repo}/${path}`, "utf8");
  const lines = text.split("\n");
  for (const rule of RETIRED) {
    if (!inScope(rule.id) || !rule.files.test(path)) continue;
    if (rule.pathName && rule.pathName.test(path)) {
      hits.push({ rule: rule.id, path, line: 0, text: "(file path)" });
    }
    lines.forEach((line, i) => {
      rule.pattern.lastIndex = 0;
      if (rule.pattern.test(line)) hits.push({ rule: rule.id, path, line: i + 1, text: line.trim() });
    });
  }
}

const marked = [];
const kept = [];
const open = [];
for (const hit of hits) {
  if (hit.text.includes(REFUSAL_MARKER)) marked.push(hit);
  else if (KEEP.some((k) => k.path.test(hit.path) && (!k.line || k.line.test(hit.text)) && (!k.rules || k.rules.includes(hit.rule))))
    kept.push(hit);
  else open.push(hit);
}

const byRule = (list) =>
  Object.fromEntries(RETIRED.map((r) => [r.id, list.filter((h) => h.rule === r.id).length]));
const byFile = new Map();
for (const h of open) byFile.set(h.path, (byFile.get(h.path) ?? 0) + 1);

console.log(`commit ${execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repo, encoding: "utf8" }).trim()}`);
console.log(`files: ${files.length} tracked under ${ROOTS.join(" ")} · ${scanned.length} scanned · ${[...excluded.values()].reduce((a, b) => a + b, 0)} excluded · ${unruled.length} with no rule`);
for (const [why, n] of excluded) console.log(`  excluded ${n} · ${why}`);
console.log(`hits: ${hits.length} · refusal-marked ${marked.length} · kept ${kept.length} · OPEN ${open.length}`);
console.log(`open by rule: ${JSON.stringify(byRule(open))}`);
// A line two rules both hit is one line to change: report lines as well as hits.
const openLines = new Set(open.map((h) => `${h.path}:${h.line}`));
console.log(`open lines: ${openLines.size} · open files: ${byFile.size}`);
if (args.has("--list")) {
  for (const h of open) console.log(`  ${h.rule}\t${h.path}:${h.line}\t${h.text.slice(0, 140)}`);
} else {
  for (const [path, n] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${String(n).padStart(4)}  ${path}`);
}

// Totality: a file under a swept root with no scanning rule and no exclusion is a hole.
if (unruled.length > 0) {
  console.log(`TOTALITY FAIL: ${unruled.length} files neither scanned nor excluded, e.g. ${unruled.slice(0, 5).join(", ")}`);
}
const pass = open.length === 0 && unruled.length === 0;
if (planted) {
  // Each planted line must be caught by its own rule, so a row that reads nothing can't pass.
  const want = [
    ["packages/core/src/__planted__.ts", "ask-symbol"],
    ["packages/workforce/src/__planted__.ts", "message-names"],
    ["packages/workforce/src/__planted__.ts", "message-reply-to"]
  ];
  const caught = want.every(([path, rule]) => open.some((h) => h.path === path && h.rule === rule));
  console.log(caught ? "CONTROL OK: every planted hit was caught" : "CONTROL BROKEN: a planted hit passed");
  process.exit(caught ? 0 : 1);
}
console.log(pass ? "PASS" : "FAIL");
process.exit(pass ? 0 : 1);
