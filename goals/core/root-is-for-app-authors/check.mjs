#!/usr/bin/env node
// goals/core/root-is-for-app-authors (FIX-2448), promoted from the spec's evidence at
// specs/issues/FIX-2448/poc/export-census/. Not production code.
//
// The goal: an adopter who autocompletes `@flow-state-dev/core` sees only names an app
// author uses or the docs teach. This check reads who uses each name the way CI's export
// check does (`scripts/check-root-exports.mjs`, over the one import census), never a list
// the change writes. `--after` holds when:
//   core-root     core's root fails the export check on no name but the frozen `benchmark`
//                 rows of moved.tsv, which another issue moves;
//   moved-gone    no `harness`, `internal` or `unexport` row of moved.tsv is on the root or
//                 `core/types`; each `harness` row is on `core/harness`, each `internal` row
//                 on `core/internal`, each `unexport` row on no public entry;
//   no-internal   no app, example or lab file imports any `@flow-state-dev/*/internal` path,
//                 in any form.
// It also prints, for the PR's reviewer, every core root name a README or changeset line is the
// only thing clearing where d6a38c09 (the spec's census commit) did not clear it that way.
//
//   node goals/core/root-is-for-app-authors/check.mjs --after [ref]   # the working tree, or git ref
//   node goals/core/root-is-for-app-authors/check.mjs --control       # every plant must be named
//
// The installed-tarball half (moved names read from the packed core's .d.ts, BlockContext's
// members, no compiled test file) is the packed-install leg `surface.core-installed-dts`,
// not a second pack here.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ROOT, compare, rootReport, violations } from "../../../scripts/check-root-exports.mjs";
import { fsReader, gitReader, overlayReader, packageEntryExports } from "../../../scripts/mechanism-exports.mjs";
import { MOVED_RENAMES } from "../../../scripts/packed-install/goal.mjs";

const CORE = "@flow-state-dev/core";
const CENSUS_COMMIT = "d6a38c09";
const MOVED = readFileSync(fileURLToPath(new URL("../../../specs/issues/FIX-2448/poc/export-census/moved.tsv", import.meta.url)), "utf8")
  .split("\n").filter(Boolean).map((l) => l.split("\t"));
const BENCHMARK = new Set(MOVED.filter(([m]) => m === "benchmark").map(([, n]) => n));

/** The three assertions over one tree. Returns { failures, read: { name: count } }. */
function after(read) {
  const failures = [];
  const report = rootReport(read);
  const core = report.roots.get(CORE) ?? new Map();
  for (const [name, { file, why }] of core) {
    if (why === "failing" && !BENCHMARK.has(name)) failures.push(`core-root: \`${name}\` (${file}) fails the export check`);
  }
  const entries = packageEntryExports(read).get(CORE) ?? new Map();
  const on = (sub, name) => entries.get(sub)?.has(name) ?? false;
  const publicSubs = [...entries.keys()].filter((k) => !/(^|\/)internal(\/|$)/.test(k));
  const rows = MOVED.filter(([m]) => m !== "benchmark");
  for (const [move, row] of rows) {
    // A row a later change renamed is read under its new name (MOVED_RENAMES), and under both on the entries it left.
    const name = MOVED_RENAMES[row] ?? row;
    for (const sub of [".", "./types"]) for (const n of new Set([row, name])) if (on(sub, n)) failures.push(`moved-gone: \`${n}\` (${move}) is on ${sub === "." ? "the root" : "core/types"}`);
    if (move === "harness" && !on("./harness", name)) failures.push(`moved-gone: \`${name}\` is not on core/harness`);
    if (move === "internal" && !on("./internal", name)) failures.push(`moved-gone: \`${name}\` is not on core/internal`);
    if (move === "unexport") for (const sub of publicSubs) if (on(sub, name)) failures.push(`moved-gone: \`${name}\` (unexport) is on ${sub}`);
  }
  for (const { file, spec, form } of report.internalImports) failures.push(`no-internal: ${file}: ${form} of ${spec}`);
  return { failures, report, read: { "core root names": core.size, "moved rows": rows.length } };
}

/** A count of zero means the check read nothing: it can't tell. */
function verdict({ failures, read }) {
  const empty = Object.entries(read).filter(([, n]) => n === 0).map(([k]) => k);
  const evidence = Object.entries(read).map(([k, n]) => `${k}: ${n}`).join(" · ");
  if (failures.length) {
    console.log(`FAIL — ${failures.length} finding(s) (read: ${evidence})`);
    for (const f of failures) console.log(`  - ${f}`);
  }
  if (empty.length) console.log(`CAN'T TELL — read 0: ${empty.join(", ")}`);
  if (!failures.length && !empty.length) console.log(`PASS — core's root fails only on the benchmark rows, every moved row is in its one home, no adopter /internal import (read: ${evidence})`);
  return failures.length ? 1 : empty.length ? 3 : 0;
}

const args = process.argv.slice(2);
if (args.includes("--control")) {
  const real = fsReader(ROOT);
  const coreIndex = "packages/core/src/index.ts";
  const engineIndex = "packages/engine/src/index.ts";
  const plants = {
    [coreIndex]: real(coreIndex) +
      "\nexport const zzGoalNobody = 1;\nexport const zzGoalGoalOnly = 1;\nexport const zzGoalReadmeDump = 1;\n" +
      `export { recordPullRequests } from "./harness";\n`,
    [engineIndex]: real(engineIndex) + "\nexport const zzGoalSiblingOnly = 1;\n",
    "packages/orchestration/src/zz-goal-plant.ts": `import { zzGoalSiblingOnly } from "@flow-state-dev/engine";\nvoid zzGoalSiblingOnly;\n`,
    "goals/zz-goal-plant/run.mts": `import { zzGoalGoalOnly } from "@flow-state-dev/core";\nvoid zzGoalGoalOnly;\n`,
    "apps/kitchen-sink/zz-goal-plant.ts": `import type { RequestHost } from "@flow-state-dev/core/internal";\n`,
    "labs/zz-goal-plant/seams.ts": `const seams = await import("@flow-state-dev/engine/internal");\n`,
    // A README line listing bare names, no code form: the hollow pass a dump would be.
    "packages/core/README.md": real("packages/core/README.md") + "\nzzGoalReadmeDump zzGoalNobody\n",
  };
  const expected = {
    "a consumer-less core root name": "zzGoalNobody",
    "a sibling-only engine root name": "zzGoalSiblingOnly",
    "a goal-only core root name": "zzGoalGoalOnly",
    "an app `import type` of core/internal": "apps/kitchen-sink/zz-goal-plant.ts",
    "an app `import()` of engine/internal": "labs/zz-goal-plant/seams.ts",
    "a README line listing bare names": "zzGoalReadmeDump",
    "a moved name re-added to the root": "`recordPullRequests` (harness) is on the root",
  };
  const planted = after(overlayReader(real, plants));
  // The goal reads core's root; the sibling-only plant is on engine's, so it is named by the
  // export check's strict run over every root, which the adopter goal reads.
  const named = [...planted.failures, ...violations(planted.report).map((v) => `${v.package} ${v.name} ${v.detail}`)];
  const misses = Object.entries(expected).filter(([, needle]) => !named.some((l) => l.includes(needle))).map(([what]) => what);
  if (misses.length) {
    console.log("CONTROL FAIL — a plant was not named:");
    for (const m of misses) console.log(`  - ${m}`);
    process.exit(1);
  }
  console.log(`CONTROL PASS — all ${Object.keys(expected).length} plants named: ${Object.keys(expected).join("; ")}`);
  process.exit(0);
}

const at = args.indexOf("--after");
const ref = at >= 0 && args[at + 1] && !args[at + 1].startsWith("--") ? args[at + 1] : null;
const result = after(ref ? gitReader(ROOT, ref) : fsReader(ROOT));
console.log(`tree: ${ref ?? "working tree"}`);
const cleared = compare(rootReport(gitReader(ROOT, CENSUS_COMMIT)), result.report).readmeCleared.filter((c) => c.pkg === CORE);
if (cleared.length) {
  console.log(`for the reviewer: cleared only by a README or changeset mention, not so at ${CENSUS_COMMIT} (${cleared.length}):`);
  for (const { pkg, name } of cleared) console.log(`  ${pkg}: ${name}`);
}
process.exit(verdict(result));
