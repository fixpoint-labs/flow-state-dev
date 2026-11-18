#!/usr/bin/env node
// FIX-2776 allowlist split — retained spec evidence, not production code.
//
// Re-derives the spec's factual base from the real allowlist: which of Shift
// Manager's inventory entries this issue removes, and that every other entry
// is named as another child's. Totality: every entry on the allowlist is
// classified exactly once, so an entry nobody listed fails the check. An
// owner is set by file, or by `file#symbol` where one file's entries split
// between children (an override wins over its file's owner).
//
//   node specs/issues/FIX-2776/poc/allowlist-split/check.mjs                # check
//   node specs/issues/FIX-2776/poc/allowlist-split/check.mjs --control      # plant an unclassified entry, expect FAIL
//   node specs/issues/FIX-2776/poc/allowlist-split/check.mjs --duplicate    # plant a repeated entry, expect FAIL
//
// Exit 0: every entry classified once, no entry repeated, every classification
// names an entry that exists, and this issue's count is 32.
// Exit 1: an entry unclassified or repeated, a classification with no entry,
// or a count other than 32.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const allowlist = JSON.parse(readFileSync(`${ROOT}packages/shift-manager/test/inventory-allowlist.json`, "utf8"));
if (process.argv.includes("--control")) allowlist.push({ file: "src/lib/planted.ts", symbol: "Planted", kind: "type" });
if (process.argv.includes("--duplicate")) allowlist.push({ ...allowlist.find((entry) => entry.file === "src/lib/run.ts") });

const THIS = "FIX-2776";
/** Owner by file. */
const byFile = {
  // This issue: conversations and runs (run, task, send, conversation and ask reads; delegates).
  "src/lib/action.ts": THIS,
  "src/lib/ask-session.ts": THIS,
  "src/lib/files.ts": THIS,
  "src/lib/run.ts": THIS,
  "src/lib/send.ts": THIS,
  "src/lib/task.tsx": THIS,
  "src/lib/delegates.ts": THIS,
  "src/components/flow-state/review-hold.tsx": THIS,
  "src/components/flow-state/run-checks.tsx": THIS,
  "src/components/flow-state/spend.tsx": THIS,
  "src/components/flow-state/task-actions.tsx": THIS,
  "src/components/flow-state/task-plan-state.ts": THIS,
  // Not this issue's: the snapshot (FIX-2777), the directory (FIX-2775).
  "src/lib/reads.ts": "FIX-2777",
  "src/lib/lab-data.tsx": "FIX-2777",
  "src/lib/snapshot-subscribe.ts": "FIX-2777",
  "src/lib/derive.ts": "FIX-2777",
  "src/lib/messages.ts": "FIX-2775",
  "src/lib/projects.ts": "FIX-2775",
  "src/lib/routines.ts": "FIX-2775",
  "src/lib/usage.ts": "FIX-2775",
  "src/lib/mcp-credentials.ts": "FIX-2775",
};
/**
 * Owner by `file#symbol`, for a file whose entries split between children.
 * `lab-data.tsx`'s one entry, `settled`, is the answer's follow, which goes
 * with the answer call: FIX-2774's (its spec, siblings table).
 */
const bySymbol = { "src/lib/lab-data.tsx#settled": "FIX-2774" };

const keyOf = (entry) => `${entry.file}#${entry.symbol}#${entry.kind}`;
const failures = [];
const mine = [];
const counts = {};
const seen = new Set();
for (const entry of allowlist) {
  const key = keyOf(entry);
  if (seen.has(key)) failures.push(`repeated: ${entry.file} ${entry.symbol} (${entry.kind})`);
  seen.add(key);
  const owner = bySymbol[`${entry.file}#${entry.symbol}`] ?? byFile[entry.file];
  if (owner === undefined) {
    failures.push(`unclassified: ${entry.file} ${entry.symbol} (${entry.kind})`);
    continue;
  }
  counts[owner] = (counts[owner] ?? 0) + 1;
  if (owner === THIS) mine.push(entry);
}
for (const file of Object.keys(byFile)) {
  if (!allowlist.some((entry) => entry.file === file)) failures.push(`classified but not on the allowlist: ${file}`);
}
for (const fileSymbol of Object.keys(bySymbol)) {
  if (!allowlist.some((entry) => `${entry.file}#${entry.symbol}` === fileSymbol)) failures.push(`override names no entry: ${fileSymbol}`);
}
if (mine.length !== 32) failures.push(`this issue's count is ${mine.length}, the spec says 32`);

console.log(`allowlist: ${allowlist.length} entries · by owner: ${JSON.stringify(counts)}`);
for (const entry of mine) console.log(`  ${THIS}  ${entry.file}  ${entry.symbol}  (${entry.kind})`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}
console.log("PASS every entry classified once");
