#!/usr/bin/env node
// FIX-2775 directory census — retained spec evidence, not production code.
//
// Re-derives the counted facts SPEC.md rests on, from the real tree:
//
// 1. The allowlist split. Every Shift Manager inventory entry is classified
//    once, by file: the directory modules are this issue's; `reads.ts`,
//    `derive.ts` and `snapshot-subscribe.ts` are FIX-2777's (it deletes them).
//    FIX-2774 and FIX-2776 have merged, so no other owner is left.
// 2. The snapshot census. Every place in `src/` outside the four files FIX-2777
//    deletes (`reads.ts`, `derive.ts`, `lab-data.tsx`, `snapshot-subscribe.ts`)
//    that still reaches the snapshot: the `snapshot` value or prop, a snapshot
//    type, a read of `useLab()`'s snapshot fields (`snapshot`, `refresh`,
//    `asking`, `reader`, `refreshing`, `answered`, `noteAnswered`), or an import
//    of `reads.ts`. Every one is this issue's: it is the last child that moves
//    screens (ER-8), so FIX-2777 deletes four files and edits none.
//
//    The unit: a site is one token kind on one line. Comment lines are skipped.
//
// Totality: an allowlist entry nobody classified fails, and so does a file
// classified that holds no entry. Every site found is this issue's by rule, so
// the census has no unclassified case; its control plants a site instead.
//
//   node specs/issues/FIX-2775/poc/directory-census/check.mjs            # check
//   node specs/issues/FIX-2775/poc/directory-census/check.mjs --control  # plant an entry and a site: expect FAIL
//   node specs/issues/FIX-2775/poc/directory-census/check.mjs --built    # the goal check: this issue's counts expected 0
//   node specs/issues/FIX-2775/poc/directory-census/check.mjs --simulate-built  # --built over the finished state: expect PASS
//
// `--built` is the goal check, run on the implementation. On today's main it
// FAILS by design (that is its control), and says so in a banner first.
// `--simulate-built` shows the goal check can pass: it reads today's tree with
// this issue's 16 entries and every census site removed, the state the
// implementation must reach, and must PASS.
//
// Exit 0 when the totals hold and the counts are the spec's. Exit 1 otherwise.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const APP = join(ROOT, "packages/shift-manager");
const CONTROL = process.argv.includes("--control");
const SIMULATE = process.argv.includes("--simulate-built");
const BUILT = SIMULATE || process.argv.includes("--built");
const failures = [];

// The spec's counts, measured on origin/main b7d2f79f37.
const EXPECTED = { entries: { "FIX-2775": 16, "FIX-2777": 21 }, sites: 233 };

// ── 1. The allowlist ─────────────────────────────────────────────────────
const allowlist = JSON.parse(readFileSync(join(APP, "test/inventory-allowlist.json"), "utf8"));
if (CONTROL) allowlist.push({ file: "src/lib/planted.ts", symbol: "Planted", kind: "type" });
if (BUILT) {
  console.log(SIMULATE
    ? "GOAL CHECK, SIMULATED: today's tree with this issue's entries and sites removed. Must PASS."
    : "GOAL CHECK: run on the implementation. Before it lands, FAIL here is expected: it is the control.");
}

const byFile = {
  "src/lib/messages.ts": "FIX-2775",
  "src/lib/projects.ts": "FIX-2775",
  "src/lib/routines.ts": "FIX-2775",
  "src/lib/usage.ts": "FIX-2775",
  "src/lib/mcp-credentials.ts": "FIX-2775",
  "src/lib/reads.ts": "FIX-2777",
  "src/lib/snapshot-subscribe.ts": "FIX-2777",
  "src/lib/derive.ts": "FIX-2777",
};
const counts = {};
const mine = [];
// The finished state: this issue's entries gone.
const read = SIMULATE ? allowlist.filter((entry) => byFile[entry.file] !== "FIX-2775") : allowlist;
for (const entry of read) {
  const owner = byFile[entry.file];
  if (owner === undefined) {
    failures.push(`allowlist entry unclassified: ${entry.file} ${entry.symbol} (${entry.kind})`);
    continue;
  }
  counts[owner] = (counts[owner] ?? 0) + 1;
  if (owner === "FIX-2775") mine.push(`${entry.file} ${entry.symbol} (${entry.kind})`);
}
// A classified file with no entry is a stale classification, except, under
// --built, this issue's own files: emptying them is the goal.
for (const [file, owner] of Object.entries(byFile)) {
  if (BUILT && owner === "FIX-2775") continue;
  if (!read.some((entry) => entry.file === file)) failures.push(`classified file holds no entry: ${file}`);
}
const wantEntries = BUILT ? { ...EXPECTED.entries, "FIX-2775": 0 } : EXPECTED.entries;
for (const [owner, want] of Object.entries(wantEntries)) {
  const held = counts[owner] ?? 0;
  // Built, FIX-2777's entries may shrink but never grow: moving a `reads.ts` name
  // to its screen module leaves one definition, so its type entry goes with it.
  const ok = BUILT && owner === "FIX-2777" ? held <= want : held === want;
  if (!ok) failures.push(`${owner} holds ${held} entries, the spec says ${BUILT && owner === "FIX-2777" ? `at most ${want}` : want}`);
}

// ── 2. The census ────────────────────────────────────────────────────────
const DELETED = new Set(["src/lib/reads.ts", "src/lib/derive.ts", "src/lib/lab-data.tsx", "src/lib/snapshot-subscribe.ts"]);
/** Files whose `snapshot` is not the Lab's, with why: skipped for the `snapshot` kind only. */
const NOT_THE_LAB = { "src/lib/routes.ts": "the location store's own getSnapshot for useSyncExternalStore" };
const LAB_FIELDS = ["snapshot", "refresh", "asking", "reader", "refreshing", "answered", "noteAnswered"];
const KINDS = [
  ["snapshot", /\bsnapshot\b/],
  ["snapshot type", /\b(LoadedSnapshot|LabSnapshot)\b/],
  ["reads import", /from "(\.\/|\.\.\/lib\/|\.\.\/\.\.\/lib\/)reads"/],
];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

const sites = [];
const files = walk(join(APP, "src")).map((path) => [relative(APP, path), readFileSync(path, "utf8")]);
if (CONTROL) files.push(["src/lib/planted.ts", "const { snapshot } = useLab();\n"]);
for (const [file, text] of files) {
  if (DELETED.has(file)) continue;
  text.split("\n").forEach((line, i) => {
    const code = line.trim();
    if (code.startsWith("*") || code.startsWith("//") || code.startsWith("/*")) return;
    for (const [kind, pattern] of KINDS) {
      if (kind === "snapshot" && NOT_THE_LAB[file] !== undefined) continue;
      if (pattern.test(line)) sites.push({ file, line: i + 1, kind });
    }
    const destructured = line.match(/\{([^}]*)\}\s*=\s*useLab\(\)/);
    if (destructured !== null) {
      const fields = destructured[1].split(",").map((f) => f.trim().split(":")[0].trim());
      for (const field of fields) if (LAB_FIELDS.includes(field) && field !== "snapshot") sites.push({ file, line: i + 1, kind: `useLab ${field}` });
    }
  });
}
// The finished state: no census site left.
if (SIMULATE) sites.length = 0;
const wantSites = BUILT ? 0 : EXPECTED.sites;
if (sites.length !== wantSites) failures.push(`the census finds ${sites.length} sites, the spec says ${wantSites}`);
if (CONTROL && !sites.some((site) => site.file === "src/lib/planted.ts")) failures.push("control: the planted site was not found");

// ── Report ───────────────────────────────────────────────────────────────
const byKind = {};
const byScreen = {};
for (const site of sites) {
  byKind[site.kind] = (byKind[site.kind] ?? 0) + 1;
  byScreen[site.file] = (byScreen[site.file] ?? 0) + 1;
}
console.log(`allowlist: ${read.length} entries · by owner: ${JSON.stringify(counts)}`);
console.log(`census: ${sites.length} sites on ${new Set(sites.map((s) => `${s.file}:${s.line}`)).size} lines in ${Object.keys(byScreen).length} files · by kind: ${JSON.stringify(byKind)}`);
console.log(`files that import reads.ts outside FIX-2777's four: ${new Set(sites.filter((s) => s.kind === "reads import").map((s) => s.file)).size}`);
if (BUILT || process.argv.includes("--list")) {
  for (const entry of mine) console.log(`  entry: ${entry}`);
  for (const site of sites) console.log(`  site: ${site.file}:${site.line} ${site.kind}`);
}
if (failures.length > 0) {
  for (const failure of failures) console.log(`FAIL ${failure}`);
  process.exit(1);
}
console.log("PASS");
