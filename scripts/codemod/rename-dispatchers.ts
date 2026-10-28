/**
 * Codemod: FIX-2245, "dispatcher" keeps one meaning, the dispatcher block.
 *
 * A board's rule for which task it claims next was a `TaskDispatcher`; it is a
 * `ClaimOrder`, and its implementations follow (`priorityDispatcher` →
 * `priorityClaimOrder`, and so on). What decides where a flow action runs was a
 * `FlowDispatcher`; it is a `FlowRunner`, with `InProcessDispatcher` →
 * `InProcessRunner` and BullMQ's `createWorkerDispatcher` → `createWorkerRunner`.
 * The head names are the contract in `specs/epics/FIX-2071/renames.md` → "Owned
 * here"; the derived spellings below (option keys, files, helpers) follow them.
 *
 * Three passes:
 *
 * 1. **Type-aware renames.** The option keys are spelled `dispatcher`, the same
 *    word as the block and as many locals that hold one, so they are renamed
 *    through the language service from their declarations: the task board's
 *    `claimOrder`, and `runner` on `createFlowState`, the flow API router, the
 *    route handlers and the transport host. Every reference the checker resolves
 *    follows, and the block's `dispatcher` is left alone.
 * 2. **File moves** through the same project, so relative imports follow:
 *    `tasks/dispatchers/` → `tasks/claim-orders/`, `transports/dispatcher.ts` →
 *    `transports/runner.ts`, `host/in-process-dispatcher.ts` →
 *    `host/in-process-runner.ts`, BullMQ's `dispatcher.ts` → `runner.ts`, and
 *    their tests.
 *    Re-exports the first pass left as `newName as oldName` take the new name.
 * 3. **Word-bounded text** for what the checker can't reach (`.mts` goals,
 *    comments, docs, test helpers): the identifiers in `IDENTIFIERS` and the
 *    moved paths. Every name in it is one of the two retired meanings; none is
 *    the block's.
 *
 * Usage: `pnpm tsx scripts/codemod/rename-dispatchers.ts`. Re-run on a fresh
 * `main` to regenerate a conflicting PR (FIX-2071 ER-2). Hand edits that follow
 * it (locals that kept the word, prose) are their own commit.
 */

import { Project, SyntaxKind, type Node } from "ts-morph";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

/** A declaration to rename: its file, the type or interface holding it (for a member), the old name, the new one. */
interface DeclRename {
  readonly file: string;
  readonly within?: string;
  readonly from: string;
  readonly to: string;
}

const ORCH = "packages/orchestration/src";
const ENGINE = "packages/engine/src";

const DECL_RENAMES: readonly DeclRename[] = [
  // The claim order.
  { file: `${ORCH}/tasks/dispatchers/types.ts`, from: "TaskDispatcher", to: "ClaimOrder" },
  { file: `${ORCH}/tasks/dispatchers/fifo.ts`, from: "fifoDispatcher", to: "fifoClaimOrder" },
  { file: `${ORCH}/tasks/dispatchers/topological.ts`, from: "topologicalDispatcher", to: "topologicalClaimOrder" },
  { file: `${ORCH}/tasks/dispatchers/priority.ts`, from: "priorityDispatcher", to: "priorityClaimOrder" },
  { file: `${ORCH}/task-board/shared.ts`, from: "TaskBoardDispatcherInput", to: "TaskBoardClaimOrderInput" },
  { file: `${ORCH}/task-board/shared.ts`, from: "resolveDispatcher", to: "resolveClaimOrder" },
  { file: `${ORCH}/task-board/index.ts`, within: "TaskBoardConfig", from: "dispatcher", to: "claimOrder" },
  { file: `${ORCH}/task-board/blocks/claim-task.ts`, within: "ClaimTaskOptions", from: "dispatcher", to: "claimOrder" },
  { file: "packages/harness-manager/src/run-owner.ts", from: "runOwnerDispatcher", to: "runOwnerClaimOrder" },
  // The flow runner.
  { file: `${ENGINE}/transports/dispatcher.ts`, from: "FlowDispatcher", to: "FlowRunner" },
  { file: `${ENGINE}/transports/host/in-process-dispatcher.ts`, from: "InProcessDispatcher", to: "InProcessRunner" },
  { file: `${ENGINE}/transports/host/in-process-dispatcher.ts`, from: "InProcessDispatcherDeps", to: "InProcessRunnerDeps" },
  { file: `${ENGINE}/transports/host/in-process-dispatcher.ts`, from: "createInProcessDispatcher", to: "createInProcessRunner" },
  { file: `${ENGINE}/transports/host/in-process-dispatcher.ts`, from: "isInProcessDispatcher", to: "isInProcessRunner" },
  { file: `${ENGINE}/transports/types.ts`, within: "InboundTransportHost", from: "usesExternalDispatcher", to: "usesExternalRunner" },
  { file: `${ENGINE}/flowstate/types.ts`, within: "WorkerAdapter", from: "createDispatcher", to: "createRunner" },
  { file: `${ENGINE}/flowstate/types.ts`, within: "CreateFlowStateOptions", from: "dispatcher", to: "runner" },
  { file: `${ENGINE}/routes/createFlowApiRouter.ts`, within: "CreateFlowApiRouterOptions", from: "dispatcher", to: "runner" },
  { file: `${ENGINE}/routes/http-handlers.ts`, within: "CreateFlowRouteHandlersOptions", from: "dispatcher", to: "runner" },
  { file: `${ENGINE}/transports/host/createInboundTransportHost.ts`, within: "CreateInboundTransportHostOptions", from: "dispatcher", to: "runner" },
  { file: "packages/bullmq/src/dispatcher.ts", from: "createWorkerDispatcher", to: "createWorkerRunner" },
  { file: "packages/bullmq/src/dispatcher.ts", from: "CreateWorkerDispatcherOptions", to: "CreateWorkerRunnerOptions" },
];

/** Files and the paths they move to. */
const MOVES: Record<string, string> = {
  [`${ORCH}/tasks/dispatchers/types.ts`]: `${ORCH}/tasks/claim-orders/types.ts`,
  [`${ORCH}/tasks/dispatchers/fifo.ts`]: `${ORCH}/tasks/claim-orders/fifo.ts`,
  [`${ORCH}/tasks/dispatchers/topological.ts`]: `${ORCH}/tasks/claim-orders/topological.ts`,
  [`${ORCH}/tasks/dispatchers/priority.ts`]: `${ORCH}/tasks/claim-orders/priority.ts`,
  "packages/orchestration/test/dispatchers/dispatchers.test.ts": "packages/orchestration/test/claim-orders/claim-orders.test.ts",
  [`${ENGINE}/transports/dispatcher.ts`]: `${ENGINE}/transports/runner.ts`,
  [`${ENGINE}/transports/host/in-process-dispatcher.ts`]: `${ENGINE}/transports/host/in-process-runner.ts`,
  "packages/bullmq/src/dispatcher.ts": "packages/bullmq/src/runner.ts",
  "packages/bullmq/test/dispatcher.test.ts": "packages/bullmq/test/runner.test.ts",
  "packages/harness-manager/test/run-owner-dispatcher.spec.ts": "packages/harness-manager/test/run-owner-claim-order.spec.ts",
};

/**
 * Word-bounded names for the text pass: the head names, their implementations, and the locals and
 * test helpers that hold a claim order or a flow runner. None of them is the dispatcher block's.
 */
const IDENTIFIERS: Record<string, string> = {
  TaskDispatcher: "ClaimOrder",
  fifoDispatcher: "fifoClaimOrder",
  topologicalDispatcher: "topologicalClaimOrder",
  priorityDispatcher: "priorityClaimOrder",
  runOwnerDispatcher: "runOwnerClaimOrder",
  TaskBoardDispatcherInput: "TaskBoardClaimOrderInput",
  resolveDispatcher: "resolveClaimOrder",
  leasingDispatcher: "leasingClaimOrder",
  countingDispatcher: "countingClaimOrder",
  FlowDispatcher: "FlowRunner",
  InProcessDispatcher: "InProcessRunner",
  InProcessDispatcherDeps: "InProcessRunnerDeps",
  createInProcessDispatcher: "createInProcessRunner",
  isInProcessDispatcher: "isInProcessRunner",
  inProcessDispatcher: "inProcessRunner",
  usesExternalDispatcher: "usesExternalRunner",
  isExternalDispatcher: "isExternalRunner",
  effectiveDispatcher: "effectiveRunner",
  workerDispatcher: "workerRunner",
  externalDispatcher: "externalRunner",
  pendingExternalDispatcher: "pendingExternalRunner",
  failingExternalDispatcher: "failingExternalRunner",
  backloggedExternalDispatcher: "backloggedExternalRunner",
  createWorkerDispatcher: "createWorkerRunner",
  CreateWorkerDispatcherOptions: "CreateWorkerRunnerOptions",
  WorkerDispatcher: "WorkerRunner",
  TriggerDevDispatcher: "TriggerDevRunner",
  PgBossDispatcher: "PgBossRunner",
  createDispatcher: "createRunner",
  fakeDispatcher: "fakeRunner",
  makeDispatcher: "makeRunner",
  dispatcherRuntimes: "runnerRuntimes",
};

/** Moved paths as other files spell them (docs, mocks, comments), longest first. */
const PATHS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\btasks\/dispatchers\//g, "tasks/claim-orders/"],
  [/\btest\/dispatchers\/dispatchers\.test/g, "test/claim-orders/claim-orders.test"],
  [/\bin-process-dispatcher\b/g, "in-process-runner"],
  [/\btransports\/dispatcher\b/g, "transports/runner"],
  [/\bbullmq\/src\/dispatcher\b/g, "bullmq/src/runner"],
  [/(["'])\.\.\/src\/dispatcher\1/g, "$1../src/runner$1"],
  [/\brun-owner-dispatcher\.spec\b/g, "run-owner-claim-order.spec"],
];

/**
 * Where the text pass reads: code, tests, goals, labs, apps and published docs. Retained specs,
 * changelogs, pending changesets, archives and the internal design docs are history.
 */
const TEXT_PATHS = ["packages", "apps/docs/docs", "apps/docs/guides", "apps/kitchen-sink", "apps/devtool", "goals", "labs", "examples", "docs/architecture"];
const TEXT_EXCLUDES = [":!**/CHANGELOG.md", ":!**/node_modules/**", ":!**/dist/**", ":!**/*.verdict.*", ":!**/verdicts/**"];

// Pass 1: through the language service.
const project = new Project({ tsConfigFilePath: resolve(repoRoot, "tsconfig.base.json"), skipAddingFilesFromTsConfig: true });
project.addSourceFilesAtPaths([
  resolve(repoRoot, "packages/*/src/**/*.{ts,tsx}"),
  resolve(repoRoot, "packages/*/test/**/*.{ts,tsx}"),
  resolve(repoRoot, "packages/*/teams/**/*.{ts,tsx,mts}"),
  resolve(repoRoot, "goals/**/*.{ts,tsx,mts}"),
  resolve(repoRoot, "labs/*/src/**/*.{ts,tsx}"),
  resolve(repoRoot, "apps/kitchen-sink/**/*.{ts,tsx}"),
  resolve(repoRoot, "examples/**/*.{ts,tsx}"),
  "!**/node_modules/**",
  "!**/dist/**",
]);

const DECL_KINDS = [
  SyntaxKind.InterfaceDeclaration,
  SyntaxKind.TypeAliasDeclaration,
  SyntaxKind.FunctionDeclaration,
  SyntaxKind.VariableDeclaration,
  SyntaxKind.PropertySignature,
  SyntaxKind.MethodSignature,
] as const;

/** The interface or type alias a member is declared in, by name. */
function container(node: Node): string | undefined {
  const holder = node.getFirstAncestor(
    (a) => a.getKind() === SyntaxKind.InterfaceDeclaration || a.getKind() === SyntaxKind.TypeAliasDeclaration,
  );
  return holder?.getFirstChildByKind(SyntaxKind.Identifier)?.getText();
}

for (const rename of DECL_RENAMES) {
  const sourceFile = project.getSourceFile(resolve(repoRoot, rename.file));
  if (sourceFile === undefined) throw new Error(`not loaded: ${rename.file}`);
  const matches = DECL_KINDS.flatMap((kind) => sourceFile.getDescendantsOfKind(kind)).filter(
    (node) =>
      node.getFirstChildByKind(SyntaxKind.Identifier)?.getText() === rename.from &&
      (rename.within === undefined || container(node) === rename.within),
  );
  if (matches.length !== 1) throw new Error(`${rename.file}: ${matches.length} declarations of ${rename.from}`);
  matches[0]!.getFirstChildByKindOrThrow(SyntaxKind.Identifier).rename(rename.to, { usePrefixAndSuffixText: true });
  console.log(`renamed ${rename.file}: ${rename.from} → ${rename.to}`);
}

// Pass 2: moves, through the same project so the imports follow.
for (const [from, to] of Object.entries(MOVES)) {
  const sourceFile = project.getSourceFile(resolve(repoRoot, from));
  if (sourceFile === undefined) throw new Error(`not loaded: ${from}`);
  sourceFile.move(resolve(repoRoot, to));
  console.log(`moved ${from} → ${to}`);
}
// Renaming an exported declaration with prefix/suffix text keeps the old public name on its re-exports
// (`newName as oldName`). There is no alias (D1): the re-export takes the new name.
const OLD_NAME_OF = new Map(DECL_RENAMES.map((rename) => [rename.to, rename.from]));
for (const sourceFile of project.getSourceFiles()) {
  for (const specifier of sourceFile.getDescendantsOfKind(SyntaxKind.ExportSpecifier)) {
    const alias = specifier.getAliasNode()?.getText();
    if (alias !== undefined && OLD_NAME_OF.get(specifier.getNameNode().getText()) === alias) specifier.removeAlias();
  }
}
project.saveSync();
// The moves wrote new files and deleted the old ones; stage both so git records a rename.
execFileSync("git", ["add", "-A", "--", ...Object.keys(MOVES), ...Object.values(MOVES)], { cwd: repoRoot });

// Pass 3: word-bounded text and the moved paths.
const files = execFileSync(
  "git",
  ["grep", "-lE", [...Object.keys(IDENTIFIERS).map((n) => `\\b${n}\\b`), "dispatchers/", "dispatcher\\b"].join("|"), "--", ...TEXT_PATHS, ...TEXT_EXCLUDES],
  { cwd: repoRoot, encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean);
const pattern = new RegExp(`\\b(${Object.keys(IDENTIFIERS).join("|")})\\b`, "g");
/** A goal's dated verdict row: history, kept under the name it ran under. */
const VERDICT_ROW = /^\| \d{4}-\d{2}-\d{2} \|/;
let changed = 0;
for (const file of files) {
  const path = resolve(repoRoot, file);
  const before = readFileSync(path, "utf8");
  const after = before
    .split("\n")
    .map((line) => {
      if (VERDICT_ROW.test(line)) return line;
      let next = line.replace(pattern, (name) => IDENTIFIERS[name]!);
      for (const [from, to] of PATHS) next = next.replace(from, to);
      return next;
    })
    .join("\n");
  if (after !== before) {
    writeFileSync(path, after);
    changed++;
  }
}
console.log(`text pass: ${changed} of ${files.length} files`);
