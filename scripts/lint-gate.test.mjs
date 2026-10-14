/**
 * The pre-push gate has to be able to fail. An echo lint script, or a hook
 * that never calls lint, reports green. The planted defects are a duplicated
 * key and a stray label, the two shapes nothing typechecks.
 */

import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const require = createRequire(join(ROOT, "package.json"));
const rootPackage = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

function stubLintScripts() {
  const globs = readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8")
    .split("\n")
    .map((line) => /^\s*-\s*["']?([^"'#\s]+)/.exec(line)?.[1])
    .filter(Boolean);
  return globs.flatMap((glob) =>
    globSync(`${glob}/package.json`, { cwd: ROOT }).filter((file) => {
      const lint = JSON.parse(readFileSync(join(ROOT, file), "utf8")).scripts?.lint ?? "";
      return /^\s*(echo|true|exit 0)\b/.test(lint);
    }),
  );
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
    const stubs = stubLintScripts();
    assert.deepEqual(stubs, [], `lint scripts that always pass:\n  ${stubs.join("\n  ")}`);
  });

  it("the root lint script runs ESLint", () => {
    assert.match(rootPackage.scripts?.lint ?? "", /\beslint\b/);
  });

  it("the pre-push hook runs pnpm lint, and installs on pnpm install", () => {
    assert.match(readFileSync(join(ROOT, ".husky/pre-push"), "utf8"), /^pnpm lint\b/m);
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
