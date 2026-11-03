/**
 * Codemod: FIX-2317, a question is one kind of task hold.
 *
 * Undoes FIX-2183's split of a task's open asks from *hold*: the row's list
 * is `Task.holds` again, and a question is one kind of hold on it, beside the
 * filer's hold (status `held`, `hold()`, `release()`, unchanged). The two
 * tools that stop for a person are named for what stops, and for whom:
 *
 * - `waitForUser` becomes `suspendForUser`: it suspends the request (the
 *   turn) and resumes with the user's answer.
 * - `askQuestion` becomes `holdTaskForUser({ question })`: it holds the task
 *   on the user's answer.
 *
 * A question's content keeps its word: filing `questions`, `QuestionInit`,
 * `MAX_QUESTION_PROMPT`, `QuestionAnswer`, `updateTask({ answers })`, the
 * Inbox's `answerOne` and `questionId`, and the decline reasons.
 *
 * Three passes:
 *
 * 1. **Type-aware renames.** `questions` and `question` collide with live
 *    names (a filing's `questions`, a skill evaluator's, an error report's), so
 *    the row's list and its mirrors are renamed through the language service
 *    from their declarations.
 * 2. **Exact identifiers**, word-bounded, over code, tests, goals, labs, apps,
 *    the published docs, the architecture and mechanism docs, and the skills.
 * 3. **File moves**: the hold modules and the suspend-for-user module, and the
 *    import specifiers that name them.
 *
 * It runs once, on a tree from before FIX-2317: it fails on a tree that already
 * has `schema/hold.ts`. Hand edits that follow it (prose, sweep rows, the
 * `keptOpenBy` value) are their own commits.
 *
 * Usage: `pnpm tsx scripts/codemod/rename-question-hold-words.ts`.
 */

import { Project, SyntaxKind, type Node } from "ts-morph";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

if (existsSync(resolve(repoRoot, "packages/orchestration/src/tasks/schema/hold.ts"))) {
  throw new Error("already run: packages/orchestration/src/tasks/schema/hold.ts exists");
}

/** A property to rename from its declaration: the file, the old name, the new one, and the declaring text to tell it apart. */
interface DeclRename {
  readonly file: string;
  readonly from: string;
  readonly to: string;
  readonly near?: string;
}

const DECL_RENAMES: readonly DeclRename[] = [
  { file: "packages/orchestration/src/tasks/schema/task.ts", from: "questions", to: "holds", near: "z.array(taskQuestionSchema)" },
  { file: "packages/orchestration/src/skills/task-tools-capability.ts", from: "questions", to: "holds", near: "z.array(taskQuestionSchema)" },
  { file: "packages/orchestration/src/inbox/types.ts", from: "questions", to: "holds", near: "InboxQuestion<TDetail>[]" },
  { file: "packages/orchestration/src/inbox/types.ts", from: "questions", to: "holds", near: "TaskQuestion[] | null" },
  { file: "packages/orchestration/src/tasks/collection/questions.ts", from: "questions", to: "holds", near: "readonly RowQuestion[]" },
  { file: "packages/orchestration/src/tasks/collection/types.ts", from: "question", to: "hold", near: "question?: SuspensionQuestion" },
  { file: "packages/devtool/src/react/lib/task-collection-state.ts", from: "questions", to: "holds", near: "TaskHoldWire[]" },
  { file: "packages/shift-manager/src/lib/reads.ts", from: "questions", to: "holds", near: "questions: TaskQuestion[]" },
  { file: "labs/claude-code-style/src/adapter.ts", from: "questions", to: "holds", near: "questions?: TaskQuestion[]" },
];

/** Unique identifiers: renamed by an exact, word-bounded replace. */
const IDENTIFIERS: Record<string, string> = {
  // The row's list: a question is one kind of hold (was FIX-2183's questions)
  TaskQuestion: "TaskHold", taskQuestionSchema: "taskHoldSchema",
  RowQuestion: "RowHold", rowQuestionSchema: "rowHoldSchema",
  SuspensionQuestion: "SuspensionHold", suspensionQuestionSchema: "suspensionHoldSchema",
  RowQuestionSource: "RowHoldSource", SuspensionQuestionSource: "SuspensionHoldSource", InboxQuestion: "InboxHold",
  QuestionCloser: "HoldCloser", QuestionChange: "HoldChange", QuestionWriteResult: "HoldWriteResult",
  openQuestions: "openHolds", hasOpenQuestion: "hasOpenHold", openRowQuestions: "openRowHolds",
  isRowQuestion: "isRowHold", isSuspensionQuestion: "isSuspensionHold", suspensionQuestionOf: "suspensionHoldOf",
  questionsDue: "holdsDue", nextQuestionDue: "nextHoldDue", newRowQuestions: "newRowHolds",
  questionWrite: "holdWrite", payQuestionDeadlines: "payHoldDeadlines", questionDueMs: "holdDueMs",
  questionOfSuspension: "holdOfSuspension", openUserQuestions: "openUserHolds",
  whileQuestionOpen: "whileHoldOpen", refuseWithOpenQuestion: "refuseWithOpenHold",
  // The request's stop for a person: what stops is the request
  waitForUser: "suspendForUser", waitForUserOn: "suspendForUserOn",
  WaitForUser: "SuspendForUser", WaitForUserOptions: "SuspendForUserOptions",
  WaitForUserContext: "SuspendForUserContext", WaitForUserCancelled: "SuspendForUserCancelled",
  WaitForUserKind: "SuspendForUserKind", waitForUserKindOf: "suspendForUserKindOf",
  createWaitForUserTool: "createSuspendForUserTool",
  waitForUserBeforeFiling: "suspendForUserBeforeFiling", waitForUserPastReview: "suspendForUserPastReview",
  // The worker's question: what stops is the task
  askQuestion: "holdTaskForUser", createAskQuestion: "createHoldTaskForUser",
};

/**
 * Where the exact pass reads. Retained specs, changelogs, archives, pending
 * changesets and the committed codemods are history. The kitchen-sink's own
 * `askQuestion` action (a durable flow's clarifying question on `ctx.suspend`,
 * not the task tool) and the vocabulary sweep's rules, which name the retired
 * spellings, are edited by hand.
 */
const TEXT_PATHS = [
  "packages", "apps/docs/docs", "apps/docs/guides", "apps/devtool", "goals", "labs", "examples",
  "docs/architecture", "docs/mechanisms", "docs/internal/design/workforce-coordination-concept.md",
  "docs/internal/design/workforce-coordination-gaps.md", "docs/internal/design/workforce-coordination-stories.md",
  ".agents/skills", "scripts/check-retired-terms.mjs", "AGENTS.md",
];
const TEXT_EXCLUDES = [
  ":!**/CHANGELOG.md", ":!**/node_modules/**", ":!**/dist/**", ":!**/*.verdict.*", ":!**/verdicts/**",
  ":!goals/vocabulary/one-word-per-thing/rules.mjs",
];

function declarationOf(sourceFile: ReturnType<Project["getSourceFileOrThrow"]>, rename: DeclRename): Node {
  const kinds = [SyntaxKind.PropertyAssignment, SyntaxKind.PropertySignature];
  const found = kinds
    .flatMap((kind) => sourceFile.getDescendantsOfKind(kind))
    .filter((node) => node.getFirstChildByKind(SyntaxKind.Identifier)?.getText() === rename.from)
    .filter((node) => rename.near === undefined || node.getText().includes(rename.near));
  if (found.length === 0) throw new Error(`${rename.file}: no declaration of ${rename.from}${rename.near ? ` near ${rename.near}` : ""}`);
  return found[0]!.getFirstChildByKindOrThrow(SyntaxKind.Identifier);
}

// Pass 1: through the language service.
const project = new Project({ tsConfigFilePath: resolve(repoRoot, "tsconfig.base.json"), skipAddingFilesFromTsConfig: true });
project.addSourceFilesAtPaths([
  resolve(repoRoot, "packages/*/src/**/*.{ts,tsx}"),
  resolve(repoRoot, "packages/*/test/**/*.{ts,tsx}"),
  resolve(repoRoot, "goals/**/*.{ts,tsx,mts}"),
  resolve(repoRoot, "labs/*/src/**/*.{ts,tsx}"),
  resolve(repoRoot, "labs/*/test/**/*.{ts,tsx}"),
  resolve(repoRoot, "apps/kitchen-sink/**/*.{ts,tsx}"),
  "!**/node_modules/**",
  "!**/dist/**",
]);
for (const rename of DECL_RENAMES) {
  const sourceFile = project.getSourceFile(resolve(repoRoot, rename.file));
  if (sourceFile === undefined) throw new Error(`not loaded: ${rename.file}`);
  let identifier: Node;
  try {
    identifier = declarationOf(sourceFile, rename);
  } catch (error) {
    // Already renamed by an earlier entry's references (a shared declaration).
    console.log(`skip: ${(error as Error).message}`);
    continue;
  }
  identifier.asKindOrThrow(SyntaxKind.Identifier).rename(rename.to, { usePrefixAndSuffixText: true });
  console.log(`renamed ${rename.file}: ${rename.from} → ${rename.to}`);
}
project.saveSync();

function grepFiles(args: readonly string[]): string[] {
  try {
    return execFileSync("git", ["grep", ...args, "--", ...TEXT_PATHS, ...TEXT_EXCLUDES], { cwd: repoRoot, encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

function rewrite(file: string, edit: (text: string) => string): boolean {
  const path = resolve(repoRoot, file);
  const before = readFileSync(path, "utf8");
  const after = edit(before);
  if (after === before) return false;
  writeFileSync(path, after);
  return true;
}

// Pass 2: exact identifiers. A regex source's `\bname` counts as a boundary too.
const names = Object.keys(IDENTIFIERS).sort((a, b) => b.length - a.length);
const pattern = new RegExp(`(?:(?<![A-Za-z0-9_$])|(?<=\\\\b))(${names.join("|")})(?![A-Za-z0-9_$])`, "g");
const files = grepFiles(["-lE", names.join("|")]);
let renamed = 0;
for (const file of files) {
  if (rewrite(file, (text) => text.replace(pattern, (name) => IDENTIFIERS[name]!))) renamed++;
}
console.log(`exact pass: ${renamed} files`);

// Pass 3: the module files, and the specifiers and paths that name them.
const MOVES: ReadonlyArray<readonly [string, string]> = [
  ["packages/orchestration/src/tasks/schema/question.ts", "packages/orchestration/src/tasks/schema/hold.ts"],
  ["packages/orchestration/src/tasks/collection/questions.ts", "packages/orchestration/src/tasks/collection/holds.ts"],
  ["packages/orchestration/src/inbox/questions.ts", "packages/orchestration/src/inbox/holds.ts"],
  ["packages/core/src/types/wait-for-user.ts", "packages/core/src/types/suspend-for-user.ts"],
  ["packages/core/test/wait-for-user.test.ts", "packages/core/test/suspend-for-user.test.ts"],
  ["packages/engine/test/wait-for-user.test.ts", "packages/engine/test/suspend-for-user.test.ts"],
];
for (const [from, to] of MOVES) execFileSync("git", ["mv", from, to], { cwd: repoRoot });

const SPECIFIERS: ReadonlyArray<{ readonly scope: string; readonly pattern: RegExp; readonly to: string }> = [
  { scope: "packages/orchestration", pattern: /(?<=["'`/])schema\/question(?=(\.ts)?["'`]|\.ts\b)/g, to: "schema/hold" },
  { scope: "packages/orchestration/src/tasks/schema", pattern: /(?<=from ")\.\/question(?=")/g, to: "./hold" },
  { scope: "packages/orchestration", pattern: /(?<=["'`/])collection\/questions(?=(\.ts)?["'`]|\.ts\b)/g, to: "collection/holds" },
  { scope: "packages/orchestration/src/tasks/collection", pattern: /(?<=from ")\.\/questions(?=")/g, to: "./holds" },
  { scope: "packages/orchestration", pattern: /(?<=["'`/])inbox\/questions(?=(\.ts)?["'`]|\.ts\b)/g, to: "inbox/holds" },
  { scope: "packages/orchestration/src/inbox", pattern: /(?<=from ")\.\/questions(?=")/g, to: "./holds" },
  { scope: ".", pattern: /\bwait-for-user(?=(\.test)?(\.ts)?["'`)\]\s]|\.ts\b|\.test\b)/g, to: "suspend-for-user" },
];
for (const spec of SPECIFIERS) {
  const hits = grepFiles(["-lE", "schema/question|collection/questions|inbox/questions|\\./questions|\\./question|wait-for-user"]).filter(
    (file) => spec.scope === "." || file.startsWith(spec.scope)
  );
  let changed = 0;
  for (const file of hits) if (rewrite(file, (text) => text.replace(spec.pattern, spec.to))) changed++;
  console.log(`${spec.pattern.source} → ${spec.to}: ${changed} files`);
}
