/**
 * Pins the census against a throwaway tree, so a count of zero is a result and not a crash.
 * `git grep` exits 1 when nothing matches; the census must read that as 0 and still count
 * casts when they are there.
 *
 * Run with `node --test specs/issues/FIX-2457/poc/cast-census/census.test.mjs`.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "census.mjs");
const REL = "specs/issues/FIX-2457/poc/cast-census/census.mjs";
const trees = [];

/** A git repo with the census at its real relative path and one tracked file under a package's `src`. */
function tree(source, { repo = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "census-"));
  trees.push(dir);
  mkdirSync(dirname(join(dir, REL)), { recursive: true });
  copyFileSync(SCRIPT, join(dir, REL));
  mkdirSync(join(dir, "packages/core/src"), { recursive: true });
  writeFileSync(join(dir, "packages/core/src/a.ts"), source);
  const git = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  if (repo) {
    git("init", "-q");
    git("add", "-A");
  }
  return dir;
}

/** Runs the census; the ceiling keeps git from finding a repo above the temp tree. */
const run = (dir) =>
  spawnSync(process.execPath, [join(dir, REL)], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, GIT_CEILING_DIRECTORIES: dirname(dir) },
  });

after(() => { for (const d of trees) rmSync(d, { recursive: true, force: true }); });

describe("cast census", () => {
  it("reports 0 and exits cleanly when no casts remain", () => {
    const r = run(tree("export const x = 1;\n"));
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /total ctx as never: 0/);
    assert.match(r.stdout, /totality ok: walker and git grep agree on 0/);
  });

  it("still counts planted casts", () => {
    const r = run(tree("declare const ctx: unknown;\nexport const a = ctx as never;\nexport const b = ctx as never;\n"));
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /total ctx as never: 2/);
    assert.match(r.stdout, /totality ok: walker and git grep agree on 2/);
  });

  it("still fails when git grep itself fails", () => {
    const r = run(tree("export const x = 1;\n", { repo: false }));
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /git grep failed \(exit 128\)/);
  });
});
