/**
 * Pins the one-compiler rule the package-boundary guard enforces.
 *
 * The rule's point is one TypeScript version across the workspace. Examples are
 * the narrow exception: they are copied out of the repository, and a copy needs
 * a compiler of its own, so an example may declare `typescript` at exactly the
 * root's specifier. Any other version, and any other member, still fails.
 *
 * Run with `node --test scripts/compiler-declarations.test.mjs`.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { compilerDeclarationErrors } from "./compiler-declarations.mjs";

const ROOT_TS = "npm:@typescript/typescript6@^6.0.2";
const dev = (typescript) => ({ devDependencies: { typescript } });

describe("compiler declarations", () => {
  it("lets an example declare the root's compiler, so a copy of it typechecks", () => {
    assert.deepEqual(compilerDeclarationErrors("examples/hello-chat/package.json", dev(ROOT_TS), ROOT_TS), []);
    assert.deepEqual(
      compilerDeclarationErrors("examples/guides/board-lifecycle/package.json", dev(ROOT_TS), ROOT_TS),
      [],
    );
  });

  it("fails an example whose compiler drifts from the root's", () => {
    const errors = compilerDeclarationErrors("examples/hello-chat/package.json", dev("^5.9.0"), ROOT_TS);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /examples\/hello-chat\/package\.json: declares typescript \^5\.9\.0/);
    assert.match(errors[0], /must match the root's/);
  });

  it("fails a non-example member that declares the compiler, even at the root's version", () => {
    const errors = compilerDeclarationErrors("packages/core/package.json", dev(ROOT_TS), ROOT_TS);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /the compiler is declared only at the root/);
  });

  it("fails an example that declares another compiler package", () => {
    const errors = compilerDeclarationErrors(
      "examples/hello-chat/package.json",
      { devDependencies: { "@typescript/native-preview": "^7.0.0" } },
      ROOT_TS,
    );
    assert.equal(errors.length, 1);
  });

  it("passes on this commit, through the guard CI runs", () => {
    const run = spawnSync(process.execPath, [fileURLToPath(new URL("./validate-package-boundaries.mjs", import.meta.url))], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      encoding: "utf8",
    });
    assert.equal(run.status, 0, run.stderr + run.stdout);
  });
});
