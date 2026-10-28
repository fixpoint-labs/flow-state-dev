/**
 * Codemod: FIX-2243, the task collection files with the filer tool's name.
 *
 * `TaskCollection.addTask` and a board capability's `addTask` become
 * `createTask`, the name the model's tool already has, so the method and the
 * tool keep one contract under one name. `addTasks` follows its head name as
 * `createTasks`. The test fixture's `readTask` step becomes `getTask`. The head
 * names are the contract in `specs/epics/FIX-2071/renames.md` → "Owned here".
 *
 * Two passes:
 *
 * 1. **Type-aware renames.** `addTask` collides with the engine's side-chain
 *    pool (`RequestSideChainPool.addTask`, a promise pool, not a task), so the
 *    collection's and the board capability's methods are renamed through the
 *    language service from their declarations, which follows every reference
 *    the checker resolves to them and leaves the pool alone.
 * 2. **Word-bounded text.** What the checker can't reach (`.mts` goals, loosely
 *    typed refs, comments, docs examples) is renamed by a word-bounded replace
 *    that skips the pool's own files, a `pool.addTask` call and a test's
 *    stand-in pool. A goal's dated verdict row (`| 2026-…`) is history and
 *    keeps the name it ran under.
 *
 * Usage: `pnpm tsx scripts/codemod/rename-task-tool-names.ts`. Re-run on a fresh
 * `main` to regenerate a conflicting PR (FIX-2071 ER-2). Hand edits that follow
 * it (retired names' lines, prose) are their own commit.
 */

import { Project, SyntaxKind } from "ts-morph";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

/** A method or property to rename from its declaration: the file, the old name, the new one. */
interface DeclRename {
  readonly file: string;
  readonly from: string;
  readonly to: string;
}

const DECL_RENAMES: readonly DeclRename[] = [
  { file: "packages/orchestration/src/tasks/collection/types.ts", from: "addTask", to: "createTask" },
  { file: "packages/orchestration/src/tasks/collection/types.ts", from: "addTasks", to: "createTasks" },
  { file: "packages/orchestration/src/task-board/capability.ts", from: "addTask", to: "createTask" },
  { file: "packages/orchestration/src/task-board/capability.ts", from: "addTasks", to: "createTasks" },
  { file: "packages/orchestration/test/tasks/wait-fixture.ts", from: "readTask", to: "getTask" },
];

/** Word-bounded names for the text pass. */
const IDENTIFIERS: Record<string, string> = { addTask: "createTask", addTasks: "createTasks" };

/** The side-chain pool's own files: its `addTask` is a promise, not a task. */
const POOL_FILES = [
  "packages/core/src/execution/request-side-chain-pool.ts",
  "packages/engine/src/execution/request-side-chain-pool.ts",
  "packages/engine/test/request-side-chain-pool.test.ts",
];

/**
 * Where the text pass reads: code, tests, goals, labs, apps and published docs. Retained specs,
 * changelogs, archives and the internal design docs are history: there `addTask` and `readTask` are
 * the model tools FIX-2081 renamed, not this method.
 */
const TEXT_PATHS = ["packages", "apps/docs/docs", "apps/docs/guides", "apps/kitchen-sink", "apps/devtool", "goals", "labs", "examples", "docs/architecture"];
const TEXT_EXCLUDES = [
  ":!**/CHANGELOG.md", ":!**/node_modules/**", ":!**/dist/**", ":!**/*.verdict.*", ":!**/verdicts/**",
  // FIX-2081's goal and sweep name the removed model tools `addTask` and `readTask`.
  ":!goals/task-tools/five-tools-one-rule-per-field/**",
  ":!goals/workforce-coordination/runs-on-one-task/rules.mjs",
  // A goal's own reader of `createTask` tool outputs: not a filing, so it gets its own name by hand.
  ":!goals/workers/files-and-splits-down-the-chain/run.mts",
];

// Pass 1: through the language service.
const project = new Project({ tsConfigFilePath: resolve(repoRoot, "tsconfig.base.json"), skipAddingFilesFromTsConfig: true });
project.addSourceFilesAtPaths([
  resolve(repoRoot, "packages/*/src/**/*.{ts,tsx}"),
  resolve(repoRoot, "packages/*/test/**/*.{ts,tsx}"),
  resolve(repoRoot, "packages/*/teams/**/*.{ts,tsx,mts}"),
  resolve(repoRoot, "goals/**/*.{ts,tsx,mts}"),
  resolve(repoRoot, "labs/*/src/**/*.{ts,tsx}"),
  resolve(repoRoot, "apps/kitchen-sink/src/**/*.{ts,tsx}"),
  resolve(repoRoot, "apps/kitchen-sink/flows/**/*.{ts,tsx}"),
  "!**/node_modules/**",
  "!**/dist/**",
]);
for (const rename of DECL_RENAMES) {
  const sourceFile = project.getSourceFile(resolve(repoRoot, rename.file));
  if (sourceFile === undefined) throw new Error(`not loaded: ${rename.file}`);
  const kinds = [SyntaxKind.MethodSignature, SyntaxKind.PropertySignature, SyntaxKind.VariableDeclaration];
  const declaration = kinds
    .flatMap((kind) => sourceFile.getDescendantsOfKind(kind))
    .find((node) => node.getFirstChildByKind(SyntaxKind.Identifier)?.getText() === rename.from);
  if (declaration === undefined) throw new Error(`${rename.file}: no declaration of ${rename.from}`);
  declaration.getFirstChildByKindOrThrow(SyntaxKind.Identifier).rename(rename.to, { usePrefixAndSuffixText: true });
  console.log(`renamed ${rename.file}: ${rename.from} → ${rename.to}`);
}
project.saveSync();

// Pass 2: word-bounded text, minus the pool and the dated verdict rows.
const files = execFileSync("git", ["grep", "-lwE", Object.keys(IDENTIFIERS).join("|"), "--", ...TEXT_PATHS, ...TEXT_EXCLUDES], {
  cwd: repoRoot,
  encoding: "utf8",
})
  .split("\n")
  .filter((file) => file && !POOL_FILES.includes(file));
/** A goal's dated verdict row: history, kept under the name it ran under. */
const VERDICT_ROW = /^\| \d{4}-\d{2}-\d{2} \|/;
/** A test's stand-in side-chain pool (`addTask: (task: { promise: … })`), which the checker can't tie to the pool. */
const POOL_STAND_IN = /\baddTask: \(task: \{ promise: Promise/;
const pattern = new RegExp(`(?<!pool\\.)\\b(${Object.keys(IDENTIFIERS).join("|")})\\b`, "g");
let changed = 0;
for (const file of files) {
  const path = resolve(repoRoot, file);
  const before = readFileSync(path, "utf8");
  const after = before
    .split("\n")
    .map((line) => (VERDICT_ROW.test(line) || POOL_STAND_IN.test(line) ? line : line.replace(pattern, (name) => IDENTIFIERS[name]!)))
    .join("\n");
  if (after !== before) {
    writeFileSync(path, after);
    changed++;
  }
}
console.log(`text pass: ${changed} of ${files.length} files`);
