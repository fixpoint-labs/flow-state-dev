/**
 * The packed-install check's rule for test files (run.mjs `shippedTestFiles`),
 * pinned on throwaway package directories. A published package that carries a
 * compiled test file ships dead weight and a `vitest` import a consumer never
 * installed, so the check must see every shape a test file compiles to, and
 * must not mistake a module whose name merely contains "test" for one.
 *
 * Run: `node --test scripts/packed-install/run.test.mjs`.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { shippedTestFiles } from "./run.mjs";

function packageDir(files) {
  const dir = mkdtempSync(join(tmpdir(), "fsd-shipped-tests-"));
  for (const file of files) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), "");
  }
  return dir;
}

test("finds every compiled shape of a test file, at any depth", () => {
  const dir = packageDir([
    "dist/helpers/tests/harness-activity.test.js",
    "dist/helpers/tests/harness-activity.test.d.ts",
    "dist/bindings/__tests__/createBindingCache.test.js",
    "dist/foo.spec.mjs",
    "dist/foo.spec.d.mts",
    "dist/view.test.jsx",
    "dist/surface.type-test.js",
    "dist/surface.type-test.d.ts",
    "dist/action-entry.test-d.js",
    "dist/action-entry.test-d.d.ts",
    "src/raw.test.ts",
  ]);
  try {
    assert.deepEqual(shippedTestFiles(dir), [
      "dist/action-entry.test-d.d.ts",
      "dist/action-entry.test-d.js",
      "dist/bindings/__tests__/createBindingCache.test.js",
      "dist/foo.spec.d.mts",
      "dist/foo.spec.mjs",
      "dist/helpers/tests/harness-activity.test.d.ts",
      "dist/helpers/tests/harness-activity.test.js",
      "dist/surface.type-test.d.ts",
      "dist/surface.type-test.js",
      "dist/view.test.jsx",
      "src/raw.test.ts",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a package of real modules, some named for testing, ships no test file", () => {
  // @flow-state-dev/testing ships modules like these on purpose.
  const dir = packageDir([
    "package.json",
    "dist/index.js",
    "dist/test-flow.js",
    "dist/testing.d.ts",
    "dist/contest.js",
    "dist/latest.test-helpers.md",
  ]);
  try {
    assert.deepEqual(shippedTestFiles(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("does not walk a nested node_modules: another package's files are not this one's", () => {
  const dir = packageDir(["dist/index.js", "node_modules/dep/dist/dep.test.js"]);
  try {
    assert.deepEqual(shippedTestFiles(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
