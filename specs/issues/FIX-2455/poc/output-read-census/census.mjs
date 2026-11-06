#!/usr/bin/env node
/**
 * Retained spec evidence, not production code. Re-derives the two counted
 * facts the spec rests on, from the source tree:
 *
 * 1. Every place shipped source reads a request's listing with outputs
 *    (`sessions.requests(…, { includeResultOutput: true })`), classified as an
 *    output read (list, then find one id) or a list view (shows many rows).
 * 2. Every hand-rolled status wait: a sleep (`setTimeout(resolve`) in a loop
 *    that reads a request's status, outside the client's own `wait()`.
 *
 * Totality: every site found must be in EXPECTED, and every EXPECTED entry
 * must be found. Either miss exits 1.
 * Negative control: `--plant` adds a file with an unlisted output read under
 * labs/ and must exit 1 naming it; the file is removed afterwards.
 * End state: `--end-state` checks FIX-2455's done state instead of the
 * baseline: removed sites are expected, and any remaining output read or
 * hand-rolled wait exits 1 (list views stay allowed). Today's tree fails it.
 *
 * Usage (repo root): node specs/issues/FIX-2455/poc/output-read-census/census.mjs [--plant] [--end-state]
 */
import { readFileSync, readdirSync, statSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN = ["packages", "labs", "apps", "examples", "goals"];
const SKIP = /(^|\/)(node_modules|dist|build|\.next|test|tests|__tests__|fixtures)(\/|$)|\.test\.|\.spec\./;

/** file → kind, for the listing-with-outputs census. */
const EXPECTED_READS = {
  "packages/orchestration/src/inbox/client.ts": "output-read",
  "packages/client/src/harness-line.ts": "output-read",
  "packages/shift-manager/src/lib/action.ts": "output-read",
  "packages/workforce/src/workers/client.ts": "output-read",
  "labs/claude-code-style/src/adapter.ts": "output-read",
  "labs/teammates/src/adapter.ts": "output-read",
  "packages/devtool/src/react/hooks/use-session-requests.ts": "list-view",
};
/** files with a hand-rolled status wait (outside client.ts's own wait). */
const EXPECTED_WAITS = [
  "packages/shift-manager/src/lib/action.ts",
  "packages/shift-manager/src/lib/send.ts",
  "packages/shift-manager/src/lib/run.ts",
  "packages/shift-manager/src/lib/lab-data.tsx",
  "packages/workforce/src/workers/client.ts",
];

const PLANT = "labs/_census-plant/src/plant.ts";

function* walk(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    const path = join(dir, name);
    const rel = relative(ROOT, path);
    if (SKIP.test(rel)) continue;
    const st = statSync(path);
    if (st.isDirectory()) yield* walk(path);
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) yield rel;
  }
}

function census() {
  const reads = {};
  const waits = new Set();
  for (const top of SCAN) for (const rel of walk(join(ROOT, top))) {
    const lines = readFileSync(join(ROOT, rel), "utf8").split("\n");
    lines.forEach((line, i) => {
      if (/sessions\.requests\(/.test(line)) {
        const window = lines.slice(i, i + 6).join("\n");
        if (/includeResultOutput:\s*true/.test(window)) {
          const findsOne = /\.find\(\s*\(?\s*\w+(\s*:\s*\w+)?\s*\)?\s*=>\s*\w+\.id\s*===/.test(lines.slice(Math.max(0, i - 2), i + 8).join("\n"));
          reads[rel] ??= new Set();
          reads[rel].add(findsOne ? "output-read" : "list-view");
        }
      }
      // A sleep inside a loop whose body reads a request's status: a hand-rolled wait.
      if (/setTimeout\(resolve/.test(line) && rel !== "packages/client/src/client.ts") {
        const body = lines.slice(Math.max(0, i - 30), i + 3).join("\n");
        if (/for \(;;\)|while \(|for \(let/.test(body) && /\.status\(\)|readRunRecord\(/.test(body)) waits.add(rel);
      }
    });
  }
  return { reads, waits };
}

const plant = process.argv.includes("--plant");
const endState = process.argv.includes("--end-state");
if (plant) {
  mkdirSync(join(ROOT, "labs/_census-plant/src"), { recursive: true });
  writeFileSync(join(ROOT, PLANT), [
    "export const read = async (c: any, s: string, id: string) =>",
    "  (await c.sessions.requests(s, { includeResultOutput: true, limit: 20 })).find((r: any) => r.id === id);",
    "",
  ].join("\n"));
}
let failed = false;
try {
  const { reads, waits } = census();
  const counts = { "output-read": 0, "list-view": 0 };
  console.log("Listing with outputs:");
  for (const [file, kinds] of Object.entries(reads).sort()) {
    const kind = [...kinds].includes("output-read") ? "output-read" : "list-view";
    counts[kind] += 1;
    const want = EXPECTED_READS[file];
    const ok = endState ? kind === "list-view" : want === kind;
    if (!ok) failed = true;
    console.log(`  ${ok ? "ok " : "NEW"} ${kind.padEnd(11)} ${file}${want && want !== kind ? ` (expected ${want})` : ""}`);
  }
  if (!endState) for (const file of Object.keys(EXPECTED_READS)) if (!reads[file]) { failed = true; console.log(`  GONE ${file}`); }
  console.log(`  → ${counts["output-read"]} output reads by list-and-find, ${counts["list-view"]} list view(s)`);
  console.log("Hand-rolled status waits:");
  for (const file of [...waits].sort()) {
    const ok = !endState && EXPECTED_WAITS.includes(file);
    if (!ok) failed = true;
    console.log(`  ${ok ? "ok " : "NEW"} ${file}`);
  }
  if (!endState) for (const file of EXPECTED_WAITS) if (!waits.has(file)) { failed = true; console.log(`  GONE ${file}`); }
  console.log(`  → ${waits.size} files`);
} finally {
  if (plant) rmSync(join(ROOT, "labs/_census-plant"), { recursive: true, force: true });
}
const what = endState ? "the end state (0 output reads, 0 hand-rolled waits)" : "the spec's counts";
console.log(failed ? `FAIL: census differs from ${what}` : `PASS: census matches ${what}`);
process.exit(failed ? 1 : 0);
