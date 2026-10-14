/**
 * Pins the pre-push lint gate: `pnpm lint` must be able to fail, and the
 * pre-push hook must run it.
 *
 * The gate this guards against is one that reports green no matter what:
 * a `lint` script that only echoes, or a hook that never calls lint. Each
 * case below fails if the gate goes back to that shape. The defect cases
 * are the ones that have reached `main` with every other check green: a
 * duplicated object key and a stray label, the two shapes a codemod left
 * in test fixtures that nothing typechecks.
 *
 * Run with `node --test scripts/lint-gate.test.mjs`.
 */

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const require = createRequire(join(ROOT, "package.json"));
const rootPackage = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

/** Every workspace member's package.json, from the globs in pnpm-workspace.yaml. */
function workspaceManifests() {
  const globs = readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8")
    .split("\n")
    .map((line) => line.match(/^\s*-\s*(\S+)/)?.[1])
    .filter(Boolean);
  const dirs = globs.flatMap((glob) => {
    if (!glob.endsWith("/*")) return [glob];
    const parent = glob.slice(0, -2);
    return readdirSync(join(ROOT, parent), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${parent}/${entry.name}`);
  });
  return dirs
    .map((dir) => join(ROOT, dir, "package.json"))
    .filter((file) => existsSync(file))
    .map((file) => ({ file: file.slice(ROOT.length + 1), json: JSON.parse(readFileSync(file, "utf8")) }));
}

/** Lint `code` as if it lived at `filePath`, through the repo's own config. */
async function lint(code, filePath) {
  const { ESLint } = require("eslint");
  const eslint = new ESLint({ cwd: ROOT });
  const [result] = await eslint.lintText(code, { filePath: join(ROOT, filePath) });
  return result.messages.map((m) => m.ruleId ?? `fatal: ${m.message}`);
}

describe("pre-push lint gate", () => {
  it("no workspace package has a lint script that cannot fail", () => {
    const stubs = workspaceManifests()
      .filter(({ json }) => /^\s*(echo|true|exit 0)\b/.test(json.scripts?.lint ?? ""))
      .map(({ file }) => file);
    assert.deepEqual(stubs, [], `lint scripts that always pass:\n  ${stubs.join("\n  ")}`);
  });

  it("the root lint script runs ESLint", () => {
    assert.match(rootPackage.scripts?.lint ?? "", /\beslint\b/);
  });

  it("the pre-push hook runs pnpm lint, and installs on pnpm install", () => {
    const hook = join(ROOT, ".husky/pre-push");
    assert.ok(existsSync(hook), ".husky/pre-push is missing");
    assert.match(readFileSync(hook, "utf8"), /^pnpm lint\b/m);
    assert.match(rootPackage.scripts?.prepare ?? "", /\bhusky\b/);
  });

  it("fails on a duplicated object key", async () => {
    const rules = await lint(
      "export const call = { orgId: 'a', seat: 's', orgId: 'b' };\n",
      "packages/core/test/lint-gate-probe.test.ts",
    );
    assert.deepEqual(rules, ["no-dupe-keys"]);
  });

  it("fails on a stray label in a function body", async () => {
    const rules = await lint(
      "export function call(seat: string) {\n  orgId: seat;\n  return seat;\n}\n",
      "goals/lint-gate-probe/run.mts",
    );
    assert.deepEqual(rules, ["no-unused-labels"]);
  });

  it("passes clean code, so the gate does not block every push", async () => {
    const rules = await lint(
      "export async function call(seat: string): Promise<string> {\n  return { orgId: 'a', seat }.seat;\n}\n",
      "packages/core/src/lint-gate-probe.ts",
    );
    assert.deepEqual(rules, []);
  });
});
