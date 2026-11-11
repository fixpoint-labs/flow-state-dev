#!/usr/bin/env node
// FIX-2551 spec evidence. Not production code: retained design evidence, run by hand.
/**
 * Count every copy of the live-read logic in the repo's shipped code: the
 * coalescer ("one read in flight, one queued") and the path rule ("may this
 * resource notice's path belong to what I show?").
 *
 * Totality, not a spot check: every non-test code file that carries either
 * signature must be classified below, as a copy or as exempt with a reason.
 * An unclassified hit fails the run.
 *
 *   node specs/issues/FIX-2551/poc/copy-count/check.mjs           # today: the counts SPEC.md states
 *   node specs/issues/FIX-2551/poc/copy-count/check.mjs --after   # the goal: one home, in the client
 *   PLANT=/path/to/file.ts node …/check.mjs                       # negative control: must fail
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const after = process.argv.includes("--after");

/** A coalescer: a flag that queues one more read while one runs. */
const COALESCER = /\bqueued\s*=\s*true\b/;
/**
 * A path rule: a resource path tested against a root with `startsWith`, in a
 * file that handles notices or resource changes.
 */
const PATH_TEST = /(path|resource|resourcePath)\b[^\n]*\.startsWith\(|\bstartsWith\(`\$\{(root|prefix|ref|OBSERVED_PLAN|OBSERVED_PLAN_LIST)\}\/`\)/;
const NOTICE_FILE = /\bWireNotice\b|\btopic\.resource\b|\bresourcePath\b|\bnotice\b/i;

/** Today's copies, as SPEC.md counts them. */
const TODAY = {
  coalescer: [
    "packages/react/src/internal/coalescedReads.ts",
    "packages/workforce/src/workers/client.ts",
    "labs/teammates/src/adapter.ts",
    "labs/claude-code-style/src/adapter.ts",
  ],
  pathRule: [
    "packages/react/src/internal/scopeNotices.ts",
    "packages/workforce/src/workers/client.ts",
    "packages/shift-manager/src/lib/snapshot-subscribe.ts",
    "labs/teammates/src/adapter.ts",
    "labs/claude-code-style/src/adapter.ts",
  ],
};

/** Hits that are not live-read logic, each with why. */
const EXEMPT = {
  "packages/react/src/internal/mergeResourceChangeIntoSnapshot.ts":
    "locates a streamed resource_change inside a snapshot it already holds; decides no re-read",
  "packages/integration-tests/src/helpers/assertions.ts": "a test assertion helper",
  "packages/engine/src/context/reactive-dispatch.ts": "server side: matches a write to a reactive trigger, not a client re-read",
};

function files() {
  const out = execFileSync("git", ["-C", root, "ls-files", "packages", "labs", "apps", "examples"], { encoding: "utf8" });
  const list = out
    .split("\n")
    .filter((f) => /\.(ts|tsx|mts)$/.test(f))
    .filter((f) => !/\/(test|tests|__tests__)\/|\.(test|spec)\.|\/dist\/|\/poc\//.test(f));
  if (process.env.PLANT) list.push(process.env.PLANT);
  return list;
}

const found = { coalescer: [], pathRule: [] };
for (const f of files()) {
  const text = readFileSync(f.startsWith("/") ? f : resolve(root, f), "utf8");
  if (COALESCER.test(text)) found.coalescer.push(f);
  if (NOTICE_FILE.test(text) && PATH_TEST.test(text)) found.pathRule.push(f);
}

let failed = false;
const fail = (msg) => {
  failed = true;
  console.log(`FAIL  ${msg}`);
};

for (const kind of ["coalescer", "pathRule"]) {
  const hits = found[kind].filter((f) => !(f in EXEMPT));
  const unclassified = hits.filter((f) => !TODAY[kind].includes(f) && !(after && f.startsWith("packages/client/src/")));
  for (const f of unclassified) fail(`${kind}: unclassified copy in ${f}`);
  if (after) {
    const outside = hits.filter((f) => !f.startsWith("packages/client/src/"));
    const inside = hits.filter((f) => f.startsWith("packages/client/src/"));
    if (outside.length > 0) fail(`${kind}: ${outside.length} cop${outside.length === 1 ? "y" : "ies"} outside the client: ${outside.join(", ")}`);
    if (inside.length !== 1) fail(`${kind}: want exactly one home in packages/client/src, found ${inside.length}`);
  } else {
    const missing = TODAY[kind].filter((f) => !hits.includes(f));
    for (const f of missing) fail(`${kind}: the baseline names ${f}, which no longer carries it`);
  }
  console.log(`${kind}: ${hits.length} (${hits.join(", ")})`);
}
for (const [f, why] of Object.entries(EXEMPT)) console.log(`exempt: ${f} — ${why}`);
console.log(failed ? "RESULT: FAIL" : `RESULT: PASS (${after ? "after" : "today"})`);
process.exit(failed ? 1 : 0);
