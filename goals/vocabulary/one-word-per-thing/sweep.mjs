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
 *
 * Retired tables (FIX-2454, rules.mjs → RETIRED_TABLES): every refusal-shaped line under
 * `packages/<pkg>/src` sits in that package's `src/retired.ts` table or goes through the
 * helper (`retired-unowned` otherwise), and no table entry's `removeIn` is at or below its
 * package's version (`retired-expired`).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { EXCLUDE, KEEP, REFUSAL_MARKER, RETIRED, RETIRED_TABLES, ROOTS } from "./rules.mjs";

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

// ── Retired tables ─────────────────────────────────────────────────────────
// The control plants one refusal no table owns and one table entry already at its
// package's version; each must be reported by its own rule, by identity.
const PLANTED_REFUSAL = { path: "packages/core/src/__planted_refusal__.ts", text: 'throw new Error("`plantedKey` was removed");\n' };
const versionOf = (pkg) => JSON.parse(readFileSync(`${repo}/packages/${pkg}/package.json`, "utf8")).version;
const PLANTED_TABLE = {
  path: "packages/core/src/retired.ts (planted)",
  pkg: "core",
  text: `export const REFUSALS = retiredNames("@flow-state-dev/core", {\n  plantedName: { replacement: "x", removeIn: "${versionOf("core")}" }\n});\n`
};

/** `a` before `b`, by major.minor.patch. */
const below = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] < y[i];
  return false;
};

/** Each entry of a table's source: its key and `removeIn`, read off the line that opens it. */
function tableEntries(text) {
  const entries = [];
  let key;
  for (const line of text.split("\n")) {
    const opens = /^\s*("[^"]+"|[A-Za-z_$][\w$]*)\s*:\s*\{/.exec(line);
    if (opens) key = opens[1].replace(/^"|"$/g, "");
    const removeIn = /removeIn:\s*"([^"]+)"/.exec(line);
    if (removeIn) entries.push({ key, removeIn: removeIn[1] });
  }
  return entries;
}

const retiredFails = [];
const sourceFiles = tracked.filter((f) => RETIRED_TABLES.source.test(f) && !RETIRED_TABLES.test.test(f));
const tables = sourceFiles
  .map((path) => ({ path, match: RETIRED_TABLES.table.exec(path) }))
  .filter((t) => t.match)
  .map(({ path, match }) => ({ path, pkg: match[1], text: readFileSync(`${repo}/${path}`, "utf8") }));
if (planted) tables.push(PLANTED_TABLE);
let tableEntryCount = 0;
for (const table of tables) {
  const manifest = JSON.parse(readFileSync(`${repo}/packages/${table.pkg}/package.json`, "utf8"));
  const named = /retiredNames\(\s*"([^"]+)"/.exec(table.text)?.[1];
  if (named !== manifest.name) {
    retiredFails.push({ rule: "retired-expired", path: table.path, entry: "(table)", text: `names ${named ?? "no package"}, not ${manifest.name}` });
  }
  for (const entry of tableEntries(table.text)) {
    tableEntryCount += 1;
    if (!below(manifest.version, entry.removeIn)) {
      retiredFails.push({ rule: "retired-expired", path: table.path, entry: entry.key, text: `removeIn ${entry.removeIn}, and ${manifest.name} is at ${manifest.version}: remove the entry and its refusal` });
    }
  }
}
const refusalSources = planted ? [...sourceFiles, PLANTED_REFUSAL.path] : sourceFiles;
let refusalLines = 0;
for (const path of refusalSources) {
  const text = path === PLANTED_REFUSAL.path ? PLANTED_REFUSAL.text : readFileSync(`${repo}/${path}`, "utf8");
  text.split("\n").forEach((line, i) => {
    if (!RETIRED_TABLES.shape.test(line)) return;
    refusalLines += 1;
    if (RETIRED_TABLES.table.test(path) || RETIRED_TABLES.helper.test(path)) return;
    if (RETIRED_TABLES.throughHelper.test(line)) return;
    if (RETIRED_TABLES.excluded.some(([file, text]) => file.test(path) && text.test(line))) return;
    retiredFails.push({ rule: "retired-unowned", path, entry: `line ${i + 1}`, text: line.trim().slice(0, 140) });
  });
}
// ── Q1 default, pending the owner's sign-off on the epic's Q1: `@deprecated` aliases ──
// One separable block: if Q1 settles on hold or break, delete it, its plant and its rule.
// An alias for a moved export names its removal the way a table entry does,
// `@deprecated Use `<new path>`. Removed in @flow-state-dev/<pkg> <version>.`, and the
// sweep reads that version against the package's as it reads `removeIn`.
const PLANTED_ALIAS = {
  path: "packages/core/src/__planted_alias__.ts",
  text: `/** @deprecated Use \`plantedNew\`. Removed in @flow-state-dev/core ${versionOf("core")}. */\nexport const plantedOld = 1;\n`
};
const ALIAS_TAG = /@deprecated\b.*\bRemoved in (@flow-state-dev\/[\w-]+) (\d+\.\d+\.\d+)/;
for (const path of planted ? [...sourceFiles, PLANTED_ALIAS.path] : sourceFiles) {
  const text = path === PLANTED_ALIAS.path ? PLANTED_ALIAS.text : readFileSync(`${repo}/${path}`, "utf8");
  if (!text.includes("@deprecated")) continue;
  const pkg = /^packages\/([^/]+)\//.exec(path)[1];
  const manifest = JSON.parse(readFileSync(`${repo}/packages/${pkg}/package.json`, "utf8"));
  text.split("\n").forEach((line, i) => {
    const tag = ALIAS_TAG.exec(line);
    if (!tag) return;
    if (tag[1] !== manifest.name || !below(manifest.version, tag[2])) {
      retiredFails.push({ rule: "retired-alias-expired", path, entry: `line ${i + 1}`, text: `names ${tag[1]} ${tag[2]}, and ${manifest.name} is at ${manifest.version}` });
    }
  });
}
// ── end of the Q1 block ──

const retiredOpen = retiredFails.filter((f) => inScope(f.rule));
console.log(`retired tables: ${tables.length} tables · ${tableEntryCount} entries · ${refusalLines} refusal-shaped src lines · OPEN ${retiredOpen.length}`);
for (const f of retiredOpen) console.log(`  ${f.rule}\t${f.path} ${f.entry}\t${f.text}`);

// Totality: a file under a swept root with no scanning rule and no exclusion is a hole.
if (unruled.length > 0) {
  console.log(`TOTALITY FAIL: ${unruled.length} files neither scanned nor excluded, e.g. ${unruled.slice(0, 5).join(", ")}`);
}
const pass = open.length === 0 && unruled.length === 0 && retiredOpen.length === 0;
if (planted) {
  // Each planted line must be caught by its own rule, so a row that reads nothing can't pass.
  const want = [
    ["packages/core/src/__planted__.ts", "ask-symbol"],
    ["packages/workforce/src/__planted__.ts", "message-names"],
    ["packages/workforce/src/__planted__.ts", "message-reply-to"]
  ].filter(([, rule]) => inScope(rule));
  // The table pass's plants, each by its path, rule and entry: a count of failures would pass on any two.
  const retiredWant = [
    [PLANTED_REFUSAL.path, "retired-unowned", "line 1"],
    [PLANTED_TABLE.path, "retired-expired", "plantedName"],
    [PLANTED_ALIAS.path, "retired-alias-expired", "line 1"] // the Q1 block's plant
  ].filter(([, rule]) => inScope(rule));
  // Under `--only`, only the selected families' plants are expected; none selected proves nothing.
  const caught =
    want.length + retiredWant.length > 0 &&
    want.every(([path, rule]) => open.some((h) => h.path === path && h.rule === rule)) &&
    retiredWant.every(([path, rule, entry]) => retiredOpen.some((f) => f.path === path && f.rule === rule && f.entry === entry));
  console.log(caught ? "CONTROL OK: every planted hit was caught" : "CONTROL BROKEN: a planted hit passed");
  process.exit(caught ? 0 : 1);
}
console.log(pass ? "PASS" : "FAIL");
process.exit(pass ? 0 : 1);
