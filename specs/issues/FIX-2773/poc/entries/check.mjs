// FIX-2773 spec evidence. Throwaway: not production code, not run by `pnpm test`.
/**
 * Re-derives which of Teammates' inventory allowlist entries this issue
 * removes, from the real allowlist on any commit. Every entry is classified
 * by its file: this issue's (t3), a sibling job's (t1 people, t2
 * conversations), or plumbing every job shares. It fails on an entry no row
 * classifies (totality), and prints the t3 entries and the counts.
 *
 *   node specs/issues/FIX-2773/poc/entries/check.mjs            # the real allowlist
 *   node specs/issues/FIX-2773/poc/entries/check.mjs --control  # plants an unclassified entry: must FAIL
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const allowlist = JSON.parse(readFileSync(`${root}labs/teammates/test/inventory-allowlist.json`, "utf8"));
if (process.argv.includes("--control")) allowlist.push({ file: "src/app/planted.ts", symbol: "Planted", kind: "type" });

/** Owner by file: the epic's set row for each job, and the coordinator's B1 to B5. */
const OWNER = {
  "src/app/tasks.ts": "t3",
  "src/app/runs.ts": "t3",
  "test/fake-app.ts": "last Teammates child (B1)",
  configuration: "t1",
  "src/app/setup.ts": "t1",
  "src/app/talk.ts": "t1",
  "src/app/workers.ts": "t1 (B5)",
  "src/app/conversations.ts": "t2",
  "src/app/files.ts": "t2",
  "src/app/window.ts": "t2",
  "src/components/App.tsx": "t2",
  "src/lib/session-feed.ts": "t2",
  "src/app/calls.ts": "last Teammates child (B2)",
  "src/app/state.ts": "last Teammates child (B2)",
  "src/app/reads.ts": "last Teammates child (B2)",
  "src/app/items.ts": "last Teammates child (B2)",
  "src/app/steps.ts": "t2 (B3)",
};

const unclassified = allowlist.filter((e) => !(e.file in OWNER));
const by = new Map();
for (const e of allowlist) {
  const owner = OWNER[e.file] ?? "UNCLASSIFIED";
  by.set(owner, [...(by.get(owner) ?? []), e]);
}
const t3 = allowlist.filter((e) => (OWNER[e.file] ?? "").startsWith("t3"));
console.log(`entries: ${allowlist.length}`);
for (const [owner, entries] of by) console.log(`  ${owner}: ${entries.length}`);
console.log(`\nt3 removes ${t3.length}:`);
for (const e of t3) console.log(`  ${e.file} · ${e.symbol} · ${e.kind}`);
if (unclassified.length > 0) {
  console.error(`\nFAIL: ${unclassified.length} entr${unclassified.length === 1 ? "y" : "ies"} no row classifies: ${unclassified.map((e) => `${e.file} ${e.symbol}`).join(", ")}`);
  process.exit(1);
}
if (t3.length !== 12) {
  console.error(`\nFAIL: the spec names 12 entries; the allowlist gives ${t3.length}`);
  process.exit(1);
}
console.log("\nPASS: every entry classified; 12 are this issue's");
