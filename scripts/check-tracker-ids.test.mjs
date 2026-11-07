/**
 * Tests for the tracker-id lint's strict run (`check-tracker-ids.mjs`), the
 * script the adopter goal's `leakage.tracker-ids` cell reads. It must read the
 * tree it is pointed at, not this repository, set suppressions aside, and name
 * each violation by its package.
 *
 * Run with `node --test scripts/check-tracker-ids.test.mjs`.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./check-tracker-ids.mjs", import.meta.url));

/** Write `files` (path → text) under `root`. */
function plant(root, files) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

/** Run the strict run over `tree` and return its parsed verdict. */
function strict(tree) {
  const res = spawnSync(process.execPath, [SCRIPT, "--strict", "--json", "--root", tree], { encoding: "utf8" });
  const last = res.stdout.trim().split("\n").pop();
  return { status: res.status, verdict: JSON.parse(last), stderr: res.stderr };
}

describe("check-tracker-ids --strict --json --root <tree>", () => {
  let tree;
  before(() => {
    tree = mkdtempSync(join(tmpdir(), "tracker-ids-"));
    plant(tree, {
      "packages/demo/package.json": JSON.stringify({ name: "@flow-state-dev/demo" }),
      "packages/demo/src/a.ts": "/** Holds the slot (FIX-2133). */\nexport const a = 1;\n",
      "packages/demo/src/b.ts": "// FIX-2133: a pointer, kept.\nexport const b = 2;\n",
      "packages/ui/package.json": JSON.stringify({ name: "@flow-state-dev/ui", private: true }),
      "packages/ui/src/c.ts": "/** Not published (FIX-1). */\nexport const c = 3;\n",
      "packages/ui/registry/d.tsx": "// FIX-5: copied whole.\nexport const d = 4;\n",
      "examples/hello/package.json": JSON.stringify({ name: "hello" }),
      "examples/hello/src/e.ts": "// LAB-9\nexport const e = 5;\n",
      // A suppressions file in the tree: the strict run sets it aside.
      "eslint-suppressions.json": JSON.stringify({ "packages/demo/src/a.ts": { "fsd/no-tracker-ids": { count: 1 } } }),
    });
  });
  after(() => rmSync(tree, { recursive: true, force: true }));

  it("names every leak in the tree by package, suppressions set aside, and nothing else", () => {
    const { status, verdict, stderr } = strict(tree);
    const got = verdict.violations.map((v) => `${v.package} ${v.name}`).sort();
    assert.deepEqual(
      got,
      ["@flow-state-dev/demo packages/demo/src/a.ts:1", "@flow-state-dev/ui packages/ui/registry/d.tsx:1", "hello examples/hello/src/e.ts:1"],
      stderr,
    );
    assert.match(verdict.violations.find((v) => v.package === "@flow-state-dev/demo").detail, /FIX-2133 in a JSDoc block/);
    assert.equal(status, 1);
  });

  it("passes a tree with only // pointers in shipped source", () => {
    const clean = mkdtempSync(join(tmpdir(), "tracker-ids-clean-"));
    try {
      plant(clean, {
        "packages/demo/package.json": JSON.stringify({ name: "@flow-state-dev/demo" }),
        "packages/demo/src/b.ts": "// FIX-2133: a pointer, kept.\n/** Holds the slot. */\nexport const b = 2;\n",
      });
      const { status, verdict } = strict(clean);
      assert.deepEqual(verdict.violations, []);
      assert.equal(status, 0);
    } finally {
      rmSync(clean, { recursive: true, force: true });
    }
  });
});
