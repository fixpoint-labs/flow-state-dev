/**
 * Pins the pre-push lint gate: `pnpm lint` must be able to fail, and the
 * pre-push hook must fail with it.
 *
 * The gate this guards against is one that reports green no matter what:
 * a `lint` script that only echoes, a rule turned down to a warning, or a
 * hook that swallows lint's exit code. So the cases below run the real root
 * `pnpm lint` and the real hook against planted defects and check the exit
 * code, not the config text. The planted defects are the shapes that have
 * reached `main` with every other check green: a duplicated object key and a
 * stray label, which a codemod left in test fixtures nothing typechecks.
 *
 * Run with `node --test scripts/lint-gate.test.mjs`. The first run lints the
 * whole repo (about a minute cold); ESLint's cache makes later runs fast.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { workspaceManifests } from "./workspace-members.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const rootPackage = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const HOOK = join(ROOT, ".husky/pre-push");

/** Run `command` at the repo root and return its exit code and combined output. */
function run(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: "utf8" });
  if (result.error) throw result.error;
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe("pre-push lint gate", { timeout: 600_000 }, () => {
  it("no workspace package has a lint script that cannot fail", () => {
    const stubs = workspaceManifests(ROOT).filter((file) => {
      const lint = JSON.parse(readFileSync(join(ROOT, file), "utf8")).scripts?.lint ?? "";
      return /^\s*(echo|true|exit 0)\b/.test(lint);
    });
    assert.deepEqual(stubs, [], `lint scripts that always pass:\n  ${stubs.join("\n  ")}`);
  });

  it("pnpm install installs the hook", () => {
    assert.match(rootPackage.scripts?.prepare ?? "", /\bhusky\b/);
  });

  it("the clean repo passes, so the gate does not block every push", () => {
    const lint = run("pnpm", ["lint"]);
    assert.equal(lint.status, 0, lint.output);
    const hook = run("sh", ["-e", HOOK]);
    assert.equal(hook.status, 0, hook.output);
  });

  describe("with planted defects inside the lint scope", () => {
    let probe;
    before(() => {
      probe = mkdtempSync(join(ROOT, "lint-gate-probe-"));
      writeFileSync(join(probe, "dupe-key.test.ts"), "export const call = { orgId: 'a', worker: 'w', orgId: 'b' };\n");
      writeFileSync(join(probe, "stray-label.mts"), "export function call(worker: string) {\n  orgId: worker;\n  return worker;\n}\n");
    });
    after(() => rmSync(probe, { recursive: true, force: true }));

    it("pnpm lint exits nonzero and names both defects", () => {
      const lint = run("pnpm", ["lint"]);
      assert.notEqual(lint.status, 0, `pnpm lint passed with planted defects:\n${lint.output}`);
      const where = relative(ROOT, probe);
      assert.match(lint.output, new RegExp(`${where}/dupe-key\\.test\\.ts[\\s\\S]*?no-dupe-keys`));
      assert.match(lint.output, new RegExp(`${where}/stray-label\\.mts[\\s\\S]*?no-unused-labels`));
    });

    it("the pre-push hook exits nonzero, as husky runs it", () => {
      const hook = run("sh", ["-e", HOOK]);
      assert.notEqual(hook.status, 0, `the hook passed with planted defects:\n${hook.output}`);
    });
  });
});
