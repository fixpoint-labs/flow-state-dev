/**
 * Pins the census's `--after` mode against throwaway trees: it passes on the refusals the owner
 * kept, and on nothing wider. A planted retired-name line outside the kept list, an extra one
 * inside a kept file, a kept site that went, or either helper's name must each make it fail.
 *
 * The trees start from the kept sites as they are in this checkout, so the test reads the real
 * lines the exemption names, not copies written beside it.
 *
 * Run with `node --test specs/issues/FIX-2454/poc/retired-census/census.test.mjs`.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../../../..");
const REL = "specs/issues/FIX-2454/poc/retired-census/census.mjs";

/** The files that hold the kept refusals, under `packages/`. */
const KEPT_FILES = [
  "contracts/src/types/suspension.ts",
  "core/src/errors/resolve-allowed-actions.ts",
  "engine/src/context/createExecutionContext.ts",
  "react/src/hooks/useSuspensionForm.ts",
  "react/src/hooks/useSuspensions.ts",
  "engine/src/transports/runner.ts",
  "engine/src/flowstate/createFlowState.ts",
  "engine/src/routes/createFlowApiRouter.ts",
  "engine/src/routes/http-handlers.ts",
  "engine/src/transports/host/createInboundTransportHost.ts",
];

const trees = [];

/** A git repo with the census at its real path and the kept files copied from this checkout. */
function tree() {
  const dir = mkdtempSync(join(tmpdir(), "retired-census-"));
  trees.push(dir);
  mkdirSync(dirname(join(dir, REL)), { recursive: true });
  copyFileSync(join(REPO, REL), join(dir, REL));
  for (const file of KEPT_FILES) {
    mkdirSync(dirname(join(dir, "packages", file)), { recursive: true });
    copyFileSync(join(REPO, "packages", file), join(dir, "packages", file));
  }
  git(dir, "init", "-q");
  git(dir, "add", "-A");
  return dir;
}

function git(dir, ...args) {
  return spawnSync("git", args, { cwd: dir, encoding: "utf8" });
}

/** Writes a file under `packages/` and tracks it, so `git grep` sees it. */
function plant(dir, file, text) {
  const path = join(dir, "packages", file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  git(dir, "add", "-A");
}

/** Runs `--after` (optionally at a ref); the ceiling keeps git from finding a repo above the tree. */
const run = (dir, ...extra) =>
  spawnSync(process.execPath, [join(dir, REL), "--after", ...extra], {
    cwd: dir,
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, GIT_CEILING_DIRECTORIES: dirname(dir) },
  });

after(() => { for (const d of trees) rmSync(d, { recursive: true, force: true }); });

describe("retired-name census --after", () => {
  it("passes on the kept refusals alone", () => {
    const r = run(tree());
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^PASS/m);
  });

  it("fails on a human_* refusal in a file the kept list does not name", () => {
    const dir = tree();
    plant(dir, "core/src/planted.ts",
      'if (reason === "human_approval") return "user_approval"; // retired-name-refusal: a stop core 0.2.0 stored\n');
    const r = run(dir);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /FAIL\b.*core\/src\/planted\.ts:1/);
  });

  it("fails on an extra human_* refusal inside a kept file", () => {
    const dir = tree();
    appendFileSync(join(dir, "packages/contracts/src/types/suspension.ts"),
      'export const again = (r: string) => r === "human_input" ? "user_input" : r; // retired-name-refusal: a stop core 0.2.0 stored\n');
    git(dir, "add", "-A");
    const r = run(dir);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /FAIL\b.*contracts\/src\/types\/suspension\.ts/);
  });

  it("fails when a kept site is gone, so the list cannot go stale", () => {
    const dir = tree();
    const path = join(dir, "packages/core/src/errors/resolve-allowed-actions.ts");
    writeFileSync(path, readFileSync(path, "utf8").replace(/ \|\| reason === "human_input"(.*)\/\/ retired-name-refusal.*$/m, "$1"));
    git(dir, "add", "-A");
    const r = run(dir);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /FAIL\b.*core\/src\/errors\/resolve-allowed-actions\.ts/);
  });

  it("fails on rejectRemovedMiddleware anywhere", () => {
    const dir = tree();
    plant(dir, "core/src/flow/defineFlow.ts", "rejectRemovedMiddleware(definition, \"Flow\");\n");
    const r = run(dir);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /FAIL\b.*rejectRemovedMiddleware/);
  });

  it("reads a git ref when one is given, not the working tree", () => {
    const dir = tree();
    plant(dir, "core/src/planted.ts", 'throw new Error("`plantedKey` was removed");\n');
    git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "plant");
    rmSync(join(dir, "packages/core/src/planted.ts"));
    git(dir, "add", "-A");
    assert.equal(run(dir).status, 0, "the working tree no longer holds the plant");
    const r = run(dir, "HEAD");
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /FAIL\b.*core\/src\/planted\.ts:1/);
  });
});
