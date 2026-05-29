/**
 * Codemod: rename the sequencer DSL `then`-prefix family to the `step` family.
 *
 * `then` / `thenIf` / `thenAll` / `thenAny` → `step` / `stepIf` / `stepAll` /
 * `stepAny`. The bare `then` name collides with the JavaScript Promise/thenable
 * protocol, so a naive `s/\.then(/\.step(/` would also rewrite the ~80 genuine
 * `Promise.then` call sites in the repo. This codemod is type-aware: it only
 * rewrites a `.then`-family call when the receiver's resolved type is a
 * `SequencerDefinition`, leaving promise chains untouched.
 *
 * Run BEFORE renaming the `SequencerDefinition` interface methods — while
 * `.then` still resolves on the interface — so every link in a chained call
 * (`seq.then(a).then(b)`) keeps a `SequencerDefinition`-typed receiver. If the
 * interface is renamed first, the first `.then` becomes a type error returning
 * `any`, and downstream links in the chain would be skipped.
 *
 * Known miss patterns the type filter cannot catch (handle manually, see the
 * spec §4.5 / Step 3.5): `any`-typed receivers and structural generic
 * constraints (`<S extends { then: ... }>`) in
 * `packages/memory/src/memory-system-blocks.ts`.
 *
 * Usage: `pnpm tsx scripts/codemod/rename-sequencer-then-to-step.ts`
 */

import { Project, SyntaxKind, type Node } from "ts-morph";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

const RENAMES: Record<string, string> = {
  then: "step",
  thenIf: "stepIf",
  thenAll: "stepAll",
  thenAny: "stepAny",
};

/** Load the shared base config for its compiler options + `@flow-state-dev/*`
 * path aliases (so imports resolve to source and receiver types are real). The
 * base config declares no `include`, so no files are added from it — they are
 * added explicitly below via glob. */
const project = new Project({
  tsConfigFilePath: resolve(repoRoot, "tsconfig.base.json"),
  skipAddingFilesFromTsConfig: true,
});

project.addSourceFilesAtPaths([
  resolve(repoRoot, "packages/*/src/**/*.{ts,tsx}"),
  resolve(repoRoot, "packages/*/test/**/*.{ts,tsx}"),
  resolve(repoRoot, "examples/*/src/**/*.{ts,tsx}"),
  resolve(repoRoot, "examples/*/flows/**/*.{ts,tsx}"),
  resolve(repoRoot, "examples/*/test/**/*.{ts,tsx}"),
  resolve(repoRoot, "apps/kitchen-sink/src/**/*.{ts,tsx}"),
  resolve(repoRoot, "apps/kitchen-sink/flows/**/*.{ts,tsx}"),
  resolve(repoRoot, "apps/devtool/src/**/*.{ts,tsx}"),
  "!**/node_modules/**",
  "!**/dist/**",
]);

/** Resolve the type symbol name of a call's receiver, tolerating chains. */
function receiverTypeName(receiver: Node): string | undefined {
  const type = receiver.getType();
  const symbol = type.getSymbol() ?? type.getAliasSymbol();
  return symbol?.getName();
}

let rewrites = 0;
const perFile = new Map<string, number>();

for (const sourceFile of project.getSourceFiles()) {
  for (const callExpr of sourceFile.getDescendantsOfKind(
    SyntaxKind.CallExpression,
  )) {
    const expr = callExpr.getExpression();
    if (!expr.isKind(SyntaxKind.PropertyAccessExpression)) continue;
    const methodName = expr.getName();
    if (!(methodName in RENAMES)) continue;

    if (receiverTypeName(expr.getExpression()) !== "SequencerDefinition") {
      continue;
    }

    expr.getNameNode().replaceWithText(RENAMES[methodName]);
    rewrites += 1;
    const f = sourceFile.getFilePath();
    perFile.set(f, (perFile.get(f) ?? 0) + 1);
  }
}

project.saveSync();

console.log(`Rewrote ${rewrites} sequencer call site(s) across ${perFile.size} file(s).`);
for (const [file, count] of [...perFile.entries()].sort()) {
  console.log(`  ${count.toString().padStart(4)}  ${file.replace(repoRoot + "/", "")}`);
}
