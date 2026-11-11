#!/usr/bin/env node
// FIX-2629 spec evidence. Not production code: retained design evidence, run by hand.
/**
 * The static half of the epic's goal check (FIX-2618): does an app on workforce
 * carry only configuration, UI and small flows? Re-derives, on any commit, the
 * counted facts SPEC.md states, and shows the rule can tell today's lab from
 * the epic's proposed end state.
 *
 * Six rules. L1 to L4 read one lab directory; H and S read the repo.
 *   L1 classes   every tracked file under the lab is config, UI, flow or outside the count
 *                (FIX-2152 ER-1, by path). An unclassified file fails: the totality assertion.
 *   L2 caps      at most 3 flows, each under 200 lines; config at most 300 lines (ER-1).
 *   L3 transport no UI file reaches the server itself: no runtime import from
 *                `@flow-state-dev/client` except `createClient` in `src/main.tsx`, and no
 *                `.subscribe(` or `.flow(...)` call. Only package hooks and views.
 *   L4 types     no UI file declares an object type for data the server computes: every
 *                exported `interface` or object `type` in a non-component `src/**\/*.ts` file is
 *                on APP_TYPES (what only the screen computes, ER-6), or it fails. Totality, so a
 *                rename can't hide one.
 *   H  hosts     no product host keeps `workerFlows: () =>` or calls `createWorkerInstallation(` or
 *                `hireWorkforce(` (labs/*\/host.mts, Shift Manager's team hosts), and neither lab host
 *                keeps `as never`.
 *   S  sessions  no product source names an own-session helper (`ownSession`, `labSession`,
 *                `rosterSession`, `readerSessionId`, `openReaderSession`).
 *
 * L1 and L2 alone are ER-1 as written. They classify `src/adapter.ts` as UI, which is why
 * L3 and L4 exist (SPEC.md D1).
 *
 *   node check.mjs                          # today's main: prints every finding, exits 1
 *   POC_EXPECT=red node check.mjs           # asserts L1 green and every other rule red (today's main)
 *   POC_LAB=<dir> POC_ONLY=lab node check.mjs   # L1-L4 on a fixture lab (the green control)
 *   POC_PLANT=1 POC_LAB=<dir> POC_ONLY=lab …    # plants src/glue.ts in the fixture: must fail L3, L4
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, mkdtempSync, cpSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const LAB_REL = "labs/claude-code-style";

/** What only the screen computes: the types the app may keep (ER-6; epic example ccs-types.md). */
const APP_TYPES = new Set([
  "ThreadEntry", "ThreadView",            // how this app draws a thread (ccs-types.md)
  "Address",                              // the page address, src/lib/address.ts
  "Mode",                                 // the app's own modes list, src/modes.ts
  "ToolCallOf", "ToolStep", "ToolRun",    // tool-step presentation, src/lib/tool-steps.ts, which the epic keeps
]);
const OUTSIDE = [/^README\.md$/, /^package\.json$/, /^tsconfig\.json$/, /^vite\.config\.ts$/, /^index\.html$/, /^test\//,
  // Tooling ER-1 does not name, counted outside with it: no logic.
  /^\.gitignore$/, /^components\.json$/, /^vitest(\.[a-z]+)?\.config\.ts$/, /^cli\/index\.ts$/];

function classify(rel) {
  if (OUTSIDE.some((r) => r.test(rel))) return "outside";
  if (rel === "fsdev.config.mts" || rel === "host.mts" || /^workforce\/.*\.md$/.test(rel)) return "config";
  if (/^workforce\/flows\/.*\.mts$/.test(rel)) return "flow";
  if (/^src\/.*\.(tsx|ts|css)$/.test(rel)) return "ui";
  return "other";
}

const lines = (abs) => (readFileSync(abs, "utf8").match(/\n/g) ?? []).length; // as `wc -l` counts

function listLab(dir) {
  if (dir === join(ROOT, LAB_REL)) {
    return execFileSync("git", ["ls-files", LAB_REL], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean)
      .map((f) => relative(LAB_REL, f));
  }
  const out = [];
  const walk = (d) => { for (const e of readdirSync(d)) { const p = join(d, e); statSync(p).isDirectory() ? walk(p) : out.push(relative(dir, p)); } };
  walk(dir);
  return out;
}

function labRules(dir) {
  const files = listLab(dir).map((rel) => ({ rel, abs: join(dir, rel), kind: classify(rel) }));
  const f = { L1: [], L2: [], L3: [], L4: [] };
  for (const x of files) if (x.kind === "other") f.L1.push(`${x.rel}: no class`);
  const flows = files.filter((x) => x.kind === "flow");
  if (flows.length > 3) f.L2.push(`${flows.length} flows, cap 3`);
  for (const x of flows) if (lines(x.abs) >= 200) f.L2.push(`${x.rel}: ${lines(x.abs)} lines, cap 199`);
  const config = files.filter((x) => x.kind === "config" && x.rel.endsWith(".mts")).reduce((n, x) => n + lines(x.abs), 0);
  if (config > 300) f.L2.push(`config ${config} lines, cap 300`);
  for (const x of files.filter((x) => x.kind === "ui" && /\.tsx?$/.test(x.rel))) {
    // Comments name APIs without calling them; strip them before matching.
    const src = readFileSync(x.abs, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
    for (const m of src.matchAll(/import\s+(?!type\b)\{([^}]*)\}\s+from\s+["']@flow-state-dev\/client["']/g)) {
      const values = m[1].split(",").map((s) => s.trim()).filter((s) => s && !s.startsWith("type "));
      const allowed = x.rel === "src/main.tsx" ? values.filter((v) => v !== "createClient") : values;
      if (allowed.length) f.L3.push(`${x.rel}: imports ${allowed.join(", ")} from the client`);
    }
    const subs = (src.match(/\.subscribe\(/g) ?? []).length;
    const flowCalls = (src.match(/\.flow\(/g) ?? []).length;
    if (subs) f.L3.push(`${x.rel}: ${subs} .subscribe( call(s)`);
    if (flowCalls) f.L3.push(`${x.rel}: ${flowCalls} .flow( call(s)`);
    if (x.rel.endsWith(".ts") && !x.rel.startsWith("src/components/")) {
      for (const m of src.matchAll(/^export\s+(?:interface\s+(\w+)|type\s+(\w+)(?:<[^=]*>)?\s*=\s*\{)/gm)) {
        const name = m[1] ?? m[2];
        if (!APP_TYPES.has(name)) f.L4.push(`${x.rel}: ${name}`);
      }
    }
  }
  return { f, files };
}

function grepRepo(pattern, paths) {
  try {
    return execFileSync("git", ["grep", "-nE", pattern, "--", ...paths], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 24 })
      .split("\n").filter(Boolean);
  } catch { return []; }
}

function repoRules() {
  // The wiring, in every product host; `as never` in the two hosts the epic's legs name (DevTeam's
  // casts are mostly not install wiring, so they are not graded here).
  const H = [
    ...grepRepo("workerFlows: \\(\\) =>|\\b(createWorkerInstallation|hireWorkforce)\\(", ["labs/*/host.mts", "packages/shift-manager/teams/*/host.mts"]),
    ...grepRepo("as never", ["labs/claude-code-style/host.mts", "labs/teammates/host.mts"]),
  ];
  const S = grepRepo("\\b(ownSessions?|labSessions?|rosterSession|readerSessionId|openReaderSession)\\b",
    ["packages/*/src/**", "labs/*/src/**", "labs/*/*.mts", "apps/*/src/**", ":!packages/engine/src/**", ":!packages/orchestration/src/**", ":!**/test/**", ":!**/*.test.*"]);
  return { H, S };
}

const only = process.env.POC_ONLY;
let labDir = process.env.POC_LAB ? resolve(process.env.POC_LAB) : join(ROOT, LAB_REL);
if (process.env.POC_PLANT === "1") {
  const copy = mkdtempSync(join(tmpdir(), "fix2629-plant-"));
  cpSync(labDir, copy, { recursive: true });
  writeFileSync(join(copy, "src/glue.ts"),
    'import { createClient } from "@flow-state-dev/client";\nexport interface BoardRow { id: string; status: string }\nexport const watch = (c: any) => c.subscribe([], {});\n');
  labDir = copy;
}

const result = {};
if (only !== "repo") Object.assign(result, labRules(labDir).f);
if (only !== "lab") Object.assign(result, repoRules());

let red = 0;
for (const [rule, found] of Object.entries(result)) {
  console.log(`${rule.padEnd(3)} ${found.length === 0 ? "PASS" : `FAIL ${found.length}`}`);
  for (const line of found.slice(0, 12)) console.log(`    ${line}`);
  if (found.length > 12) console.log(`    … ${found.length - 12} more`);
  if (found.length) red++;
}
if (process.env.POC_EXPECT === "red") {
  // Today's main: ER-1's path classes (L1) pass the adapter; every other rule must catch it.
  const wrong = Object.entries(result).filter(([k, v]) => (k === "L1" ? v.length > 0 : v.length === 0)).map(([k]) => k);
  console.log(wrong.length ? `EXPECT red: not as stated: ${wrong.join(", ")}` : "EXPECT red: L1 green (ER-1's path rule passes src/adapter.ts), every other rule red");
  process.exit(wrong.length ? 1 : 0);
}
process.exit(red ? 1 : 0);
