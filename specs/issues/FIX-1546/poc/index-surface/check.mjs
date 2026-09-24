#!/usr/bin/env node
// FIX-1546 spec evidence, throwaway. Re-derives PLAN.md's surface list: every
// non-test source file that names the `ScheduleIndex` contract must be
// classified below, and every classified file must still exist and still name
// it. A file nobody listed fails the run (totality), and so does a stale entry.
//
// Run from the repo root:
//   node specs/issues/FIX-1546/poc/index-surface/check.mjs
// Negative control (plants an unlisted file, expects a failure, removes it):
//   node specs/issues/FIX-1546/poc/index-surface/check.mjs --plant
import { execFileSync } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";

// file -> [role, PLAN surface id]
const CLASSIFIED = {
  "packages/scheduled/src/scheduleIndex.ts": ["contract: row + interface", "S2"],
  "packages/scheduled/src/defineScheduleCollection.ts": ["the one writer (hooks)", "S3"],
  "packages/scheduled/src/testing.ts": ["conformance suite", "S4"],
  "packages/scheduled/src/index.ts": ["re-export only", "-"],
  "packages/scheduled/src/createBadCronWarner.ts": ["comment only", "-"],
  "packages/scheduled/src/parseNextFireAt.ts": ["comment only", "-"],
  "packages/store-sqlite/src/schedule-index.ts": ["implementation", "S5"],
  "packages/store-postgres/src/schedule-index.ts": ["implementation", "S6"],
  "packages/bullmq/src/schedule-index.ts": ["implementation (scheduler id)", "S7"],
  "packages/bullmq/src/index.ts": ["re-export only", "-"],
  "packages/vercel/src/store.ts": ["proxy + no-op", "S8"],
  "packages/vercel/src/schedules.ts": ["consumer: tick handler, reads rows only", "-"],
  "apps/kitchen-sink/lib/schedule-index.ts": ["proxy + no-op", "S8"],
  "apps/kitchen-sink/fsdev.config.ts": ["wiring only", "-"],
  "apps/kitchen-sink/app/api/cron/schedule-tick/route.ts": ["consumer: tick route", "-"],
  "apps/kitchen-sink/flows/weekly-digest/flow.ts": ["uses defineScheduleCollection", "-"]
};

const PLANT = "apps/kitchen-sink/lib/__fix1546_planted.ts";
const plant = process.argv.includes("--plant");
if (plant) writeFileSync(PLANT, "export type X = import('@flow-state-dev/scheduled').ScheduleIndex;\n");

let failures = [];
try {
  const out = execFileSync(
    "git",
    ["grep", "--untracked", "-l", "-w", "-E", "ScheduleIndex|scheduleIndex", "--",
     "packages/*/src/**.ts", "apps/**.ts", ":!apps/docs/**", ":!**/node_modules/**",
     ":!**/*.test.ts", ":!**/test/**"],
    { encoding: "utf8" }
  );
  const found = new Set(out.split("\n").filter(Boolean));
  for (const f of found) if (!(f in CLASSIFIED)) failures.push(`unclassified: ${f}`);
  for (const f of Object.keys(CLASSIFIED)) if (!found.has(f)) failures.push(`stale entry: ${f}`);
  console.log(`files naming the contract: ${found.size}; classified: ${Object.keys(CLASSIFIED).length}`);
  const impls = Object.entries(CLASSIFIED).filter(([, [r]]) => /implementation|proxy/.test(r));
  console.log(`implementations + proxies (must all change remove/identity): ${impls.map(([f]) => f).join(", ")}`);
} finally {
  if (plant) rmSync(PLANT, { force: true });
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(plant ? "NEGATIVE CONTROL: failed as expected" : "FAIL");
  process.exit(plant ? 0 : 1);
}
if (plant) {
  console.error("NEGATIVE CONTROL DID NOT FIRE — the check is blind");
  process.exit(1);
}
console.log("PASS: every file naming ScheduleIndex is classified");
