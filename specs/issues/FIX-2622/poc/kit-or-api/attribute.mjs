/**
 * The attribution table, read off the files: for each of today's wiring lines
 * and casts, which host still has it. Retained POC evidence for FIX-2622.
 *
 *   node attribute.mjs <today's labs/teammates/host.mts> <this folder>
 *
 * Each row names its lines in today's host by anchors (regexes, one per line
 * it keys on) and how many lines and casts it is. A row is removed from a host
 * when none of its anchors matches there. Before anything is credited:
 *
 * - every anchor must match today's host exactly as often as the row says,
 *   so a row whose anchor matches nothing can't be credited as removed;
 * - the control: today's host read as a variant must come out "neither" on
 *   every row, or the script exits non-zero.
 *
 * The credit: a row B0 (today's API, used as it allows) also removes is
 * "neither change: removable on main"; otherwise both / A only / B only /
 * neither, by which of A and B removed it. Rows that belong to another child
 * whatever happens (the two read-only flows are views', FIX-2623) say so.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const [todayPath, here] = process.argv.slice(2);
if (todayPath === undefined || here === undefined) {
  console.error("usage: node attribute.mjs <labs/teammates/host.mts> <poc folder>");
  process.exit(2);
}

/** Today's wiring, row by row. `n` is how often each anchor matches today's host. */
const ROWS = [
  { id: "tree-constant", what: "`TEAMMATES_TREE` and its comment", anchors: [/^\/\*\* The workers, beside this file\. \*\/$/, /^const TEAMMATES_TREE = /], lines: 2, casts: 0, owner: "tree read" },
  { id: "loader-import", what: "`readDeclaredRoster` import", anchors: [/^import \{ readDeclaredRoster \} from "@flow-state-dev\/workforce\/loader";$/], lines: 1, casts: 0, owner: "tree read" },
  { id: "roster-read", what: "`readDeclaredRoster(...)` call", anchors: [/await readDeclaredRoster\(options\.tree \?\? TEAMMATES_TREE\)/], lines: 1, casts: 0, owner: "tree read" },
  { id: "roster-refusal", what: "the problem check (`if`, `throw`, `}`)", anchors: [/if \(roster\.problems\.length > 0\)/, /teammates: the workers did not load/], lines: 3, casts: 0, owner: "tree read" },
  { id: "install-imports", what: "`createWorkerInstallation` and `hireWorkforce` imports", anchors: [/^  createWorkerInstallation,$/, /^  hireWorkforce,$/], lines: 2, casts: 0, owner: "install" },
  { id: "callback-variable", what: "`let flows = {}`, `flows = {`, `};`", anchors: [/let flows: Record<string, unknown> = \{\};/, /^  flows = \{$/], lines: 3, casts: 0, owner: "the circular callback" },
  { id: "callback-install", what: "`createWorkerInstallation({ ..., workerFlows: () => flows as never })`", anchors: [/workerFlows: \(\) => flows as never/], lines: 1, casts: 1, owner: "the circular callback" },
  { id: "hire", what: "`hireWorkforce(installation) as Array<{ id: string }>`", anchors: [/const copies = hireWorkforce\(installation\) as Array<\{ id: string \}>;/], lines: 1, casts: 1, owner: "install" },
  { id: "spread", what: "the hand-spread flows map (`[...copies, ...]`)", anchors: [/Object\.fromEntries\(\[\.\.\.copies, readinessFlow, contextFlow\]/], lines: 1, casts: 0, owner: "the spread" },
  { id: "create-cast", what: "`createFlowState({ ... } as never)`", anchors: [/^  \} as never\);$/], lines: 0, casts: 1, owner: "casts" },
  { id: "harness-casts", what: "three harness blocks: `as never) as unknown as HarnessBlock` (and the type import)", anchors: [/\} as never\) as unknown as HarnessBlock,$/, /^import type \{ HarnessBlock \} from "@flow-state-dev\/core\/harness";$/], n: [3, 1], lines: 1, casts: 9, owner: "harness blocks" },
  { id: "readiness-casts", what: "readiness flow: `as never`, `as never`, `as { id }`", anchors: [/\} as never\)\(\{ id: READINESS_FLOW \} as never\) as \{ id: string \};/], lines: 0, casts: 3, owner: "read-only flows", views: true },
  { id: "context-casts", what: "lab-context flow: `as never`, `as never`, `as { id }`", anchors: [/\} as never\)\(\{ id: LAB_CONTEXT_FLOW \} as never\) as \{ id: string \};/], lines: 0, casts: 3, owner: "read-only flows", views: true },
  { id: "readiness-flow", what: "the `harness-readiness` flow", anchors: [/kind: READINESS_FLOW,/], lines: 4, casts: 0, owner: "read-only flows", views: true },
  { id: "context-flow", what: "the `lab-context` flow", anchors: [/kind: LAB_CONTEXT_FLOW,/], lines: 20, casts: 0, owner: "read-only flows", views: true },
  { id: "context-delegates", what: "lab-context's delegates, read off the workers", anchors: [/const declared = w\.declared\.delegates;/], lines: 6, casts: 1, owner: "read-only flows", views: true },
];

const count = (text, re) => text.split("\n").filter((line) => re.test(line)).length;
const hasRow = (text, row) => row.anchors.some((re) => count(text, re) > 0);

const today = readFileSync(todayPath, "utf8");
const bad = [];
for (const row of ROWS) {
  row.anchors.forEach((re, i) => {
    const want = row.n?.[i] ?? 1;
    const got = count(today, re);
    if (got !== want) bad.push(`${row.id}: anchor ${re} matches ${got} line(s) of today's host, the row says ${want}`);
  });
}
if (bad.length > 0) {
  console.error(`today's host isn't the one these rows were written against:\n  ${bad.join("\n  ")}`);
  process.exit(1);
}

const hosts = {
  today,
  b0: readFileSync(join(here, "b0-main-api/host.mts"), "utf8"),
  a: readFileSync(join(here, "a-kit/host.mts"), "utf8"),
  b: readFileSync(join(here, "b-api/host.mts"), "utf8"),
};

/** The credit for one row, given which hosts still have it. */
function credit(row, kept) {
  if (!kept.b0) return "neither change: removable on main (B0)";
  if (!kept.a && !kept.b) return "both";
  if (!kept.a) return "A only";
  if (!kept.b) return "B only";
  return row.views ? "neither (views, FIX-2623)" : "neither";
}

// The control: today's host as every variant removes nothing.
const control = ROWS.map((row) => credit(row, { b0: hasRow(today, row), a: hasRow(today, row), b: hasRow(today, row) }));
if (control.some((c) => c !== "neither" && c !== "neither (views, FIX-2623)")) {
  console.error(`control failed: today's host credited a removal: ${control.join(", ")}`);
  process.exit(1);
}
console.log(`control: today's host against itself, ${control.length} rows, every one "neither" ✓`);

const rows = ROWS.map((row) => {
  const kept = { b0: hasRow(hosts.b0, row), a: hasRow(hosts.a, row), b: hasRow(hosts.b, row) };
  return { ...row, kept, credit: credit(row, kept) };
});

const mark = (kept) => (kept ? "kept" : "**gone**");
console.log("\n| Today's wiring | Lines | Casts | B0 | A | B | Credit |\n|---|---|---|---|---|---|---|");
for (const r of rows) console.log(`| ${r.what} | ${r.lines} | ${r.casts} | ${mark(r.kept.b0)} | ${mark(r.kept.a)} | ${mark(r.kept.b)} | ${r.credit} |`);

const sum = (filter, key) => rows.filter(filter).reduce((n, r) => n + r[key], 0);
const credits = [...new Set(rows.map((r) => r.credit))];
console.log("\n| Credit | Rows | Lines | Casts |\n|---|---|---|---|");
for (const c of credits) console.log(`| ${c} | ${rows.filter((r) => r.credit === c).length} | ${sum((r) => r.credit === c, "lines")} | ${sum((r) => r.credit === c, "casts")} |`);
const aOnly = rows.filter((r) => r.credit === "A only");
console.log(`\n"A only" row: ${aOnly.length === 0 ? "EMPTY" : aOnly.map((r) => r.id).join(", ")}`);

// Totals: what the host author still writes, and what each variant adds to a package.
/** The host's code, without comments or blank lines. */
const code = (text) => {
  let inBlock = false;
  return text.split("\n").filter((raw) => {
    const line = raw.trim();
    if (inBlock) {
      if (line.includes("*/")) inBlock = false;
      return false;
    }
    if (line.startsWith("/*")) {
      inBlock = !line.includes("*/");
      return false;
    }
    return line !== "" && !line.startsWith("//") && !line.startsWith("*");
  }).map((line) => line.replace(/\s\/\/ .*$/, ""));
};
const codeLines = (text) => code(text).length;
/** Every `as` cast in the code: `x as unknown as T` is two. */
const casts = (text) => {
  const joined = code(text).join("\n");
  return {
    asNever: (joined.match(/\bas never\b/g) ?? []).length,
    all: (joined.match(/\bas (never|unknown|[A-Z{[(]|Array<|"|Record<)/g) ?? []).length,
  };
};
const pkg = (dir, only) =>
  readdirSync(join(here, dir))
    .filter((f) => f.endsWith(".ts") && (only === undefined || f === only))
    .reduce((n, f) => n + codeLines(readFileSync(join(here, dir, f), "utf8")), 0);
/** Lines `diff` reports removed from and added to today's host. */
const churn = (path) => {
  const out = spawnSync("diff", [todayPath, path], { encoding: "utf8" }).stdout;
  return { removed: count(out, /^< /), added: count(out, /^> /) };
};
console.log(
  "\n| Host | Lines | Code lines | `as never` | All casts | diff vs today | Added to a package (code lines) | Under ER-1's 300 |\n|---|---|---|---|---|---|---|---|",
);
for (const [name, path, added] of [
  ["today", todayPath, "0"],
  ["B0 · main's API", join(here, "b0-main-api/host.mts"), "0"],
  ["A · workforce kit", join(here, "a-kit/host.mts"), `${pkg("a-kit/poc-kit")} (define-kit ${pkg("a-kit/poc-kit", "define-kit.ts")}, workforce-kit ${pkg("a-kit/poc-kit", "workforce-kit.ts")})`],
  ["B · better install API", join(here, "b-api/host.mts"), `${pkg("b-api/poc-api")}`],
]) {
  const text = readFileSync(path, "utf8");
  const lines = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  const c = casts(text);
  const d = churn(path);
  console.log(`| ${name} | ${lines} | ${codeLines(text)} | ${c.asNever} | ${c.all} | −${d.removed} +${d.added} | ${added} | ${lines <= 300 ? "yes" : "no"} |`);
}
