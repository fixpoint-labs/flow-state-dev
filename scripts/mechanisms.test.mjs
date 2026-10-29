/**
 * Pins the mechanism list's two checks (FIX-2315) against the real tree.
 *
 * The anchor check must pass on this commit and must fail when an anchor stops
 * being exported, or the list could drift from the code with CI green. The
 * classifier must label a PR that adds a second way to do a job the list already
 * has, and must leave alone an export that lands inside an existing mechanism.
 * Each red case plants its change through an overlay reader over the real
 * packages, so the walk that runs in CI is the walk under test.
 *
 * Run with `node --test scripts/mechanisms.test.mjs`.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { fsReader, packageExports } from "./mechanism-exports.mjs";
import { ROOT, checkAnchors, loadRows } from "./check-mechanism-anchors.mjs";
import { LABELS, classify, renderComment } from "./classify-mechanism-pr.mjs";

const rows = loadRows();
const real = fsReader(ROOT);
const index = packageExports(real);

/** The real tree, with some files' text replaced or added. */
function overlay(files) {
  const read = (path) => (path in files ? files[path] : real(path));
  read.packageDirs = real.packageDirs;
  return read;
}

const WAIT_GATE = "packages/core/src/types/wait-gate.ts";
const CORE_INDEX = "packages/core/src/index.ts";

describe("anchor check", () => {
  it("passes on this commit, through the CLI CI runs", () => {
    const run = spawnSync(process.execPath, [fileURLToPath(new URL("./check-mechanism-anchors.mjs", import.meta.url))], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr + run.stdout);
    assert.deepEqual(checkAnchors(rows, index), []);
  });

  it("fails when a row's anchor is no longer exported", () => {
    const text = real(WAIT_GATE);
    assert.match(text, /export async function parkOnWait\(/);
    const removed = packageExports(overlay({ [WAIT_GATE]: text.replace("export async function parkOnWait(", "async function parkOnWait(") }));
    const problems = checkAnchors(rows, removed);
    assert.equal(problems.length, 1, problems.join("\n"));
    assert.match(problems[0], /^wait-gate: .*`parkOnWait`: no longer exported/);
  });

  it("fails when `file` no longer declares the anchor, and names the file that does", () => {
    const moved = rows.map((r) => (r.id === "wait-gate" ? { ...r, file: "packages/core/src/types/old-place.ts" } : r));
    assert.deepEqual(checkAnchors(moved, index), [
      `wait-gate: @flow-state-dev/core \`parkOnWait\`: declared in ${WAIT_GATE}, not packages/core/src/types/old-place.ts. Set file: ${WAIT_GATE}`,
    ]);
  });
});

describe("PR classifier", () => {
  it("labels a second way to park a request as a new mechanism that overlaps wait-gate", () => {
    const head = packageExports(overlay({
      "packages/core/src/types/timer-park.ts": "export async function parkOnTimer(ms: number) {}\n",
      [CORE_INDEX]: `${real(CORE_INDEX)}\nexport { parkOnTimer } from "./types/timer-park";\n`,
    }));
    const result = classify(rows, index, head, ["packages/core/src/types/timer-park.ts", CORE_INDEX]);
    assert.deepEqual(result.added.map((a) => [a.name, a.row?.id ?? null]), [["parkOnTimer", null]]);
    assert.deepEqual(result.labels, [LABELS.added, LABELS.overlap]);
    assert.deepEqual(result.lookalikes, [{ name: "parkOnTimer", rows: [{ id: "wait-gate", shared: ["park"] }] }]);
    const comment = renderComment(result);
    assert.match(comment, /anchor: parkOnTimer\n {4}file: packages\/core\/src\/types\/timer-park\.ts/);
  });

  it("maps an export added to an existing mechanism's file to that row, with no label", () => {
    const head = packageExports(overlay({
      [WAIT_GATE]: `${real(WAIT_GATE)}\nexport function waitGateLabel() { return "gate"; }\n`,
      [CORE_INDEX]: `${real(CORE_INDEX)}\nexport { waitGateLabel } from "./types/wait-gate";\n`,
    }));
    const result = classify(rows, index, head, [WAIT_GATE, CORE_INDEX]);
    assert.deepEqual(result.added.map((a) => [a.name, a.row?.id]), [["waitGateLabel", "wait-gate"]]);
    assert.deepEqual(result.labels, []);
  });

  it("labels a PR that touches two rows the list marks as overlapping", () => {
    const debate = rows.find((r) => r.id === "debate").file;
    const roundRobin = rows.find((r) => r.id === "round-robin").file;
    const result = classify(rows, index, index, [debate, roundRobin]);
    assert.deepEqual(result.overlaps.map((o) => [o.a, o.b]), [["debate", "round-robin"]]);
    assert.deepEqual(result.labels, [LABELS.overlap]);
  });
});
