/**
 * Codemod: FIX-2183, one word per state on the task surface.
 *
 * *Hold* keeps one meaning, the filer's hold before a start (status `held`,
 * `hold()`, `release()`). A task's open asks become `questions`, what keeps a
 * running task open becomes `keptOpenBy`, a request's right on its task is its
 * claim, and a board's session is its owner. The head names are the contract in
 * `specs/epics/FIX-2071/renames.md` → "Decided by FIX-2183".
 *
 * Two passes:
 *
 * 1. **Type-aware property renames.** `holds`, `waitingOn`, `releasedBy`,
 *    `question` and `holdId` collide with live names (`useReadFence`'s `holds`
 *    predicate, a steer's shown `question`, English prose), so each is renamed
 *    through the language service from its declaration, which follows every
 *    reference the checker resolves to it and nothing else.
 * 2. **Exact identifiers.** The rest are unique, so a word-bounded replace over
 *    source, tests, goals, labs, apps and the published docs is the same rename.
 *
 * Usage: `pnpm tsx scripts/codemod/rename-hold-words.ts`. Re-run on a fresh
 * `main` to regenerate a conflicting PR (FIX-2071 ER-2). Hand edits that follow
 * it (string outcomes, prose, a goal's directory) are their own commits.
 */

import { Project, SyntaxKind, type Node } from "ts-morph";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

/** A property or parameter to rename from its declaration: the file, the old name, the new one, and the declaration's text to tell it apart. */
interface DeclRename {
  readonly file: string;
  readonly from: string;
  readonly to: string;
  /** A substring of the declaring line, when the file declares `from` more than once. */
  readonly near?: string;
}

const DECL_RENAMES: readonly DeclRename[] = [
  { file: "packages/orchestration/src/tasks/schema/task.ts", from: "holds", to: "questions" },
  { file: "packages/orchestration/src/tasks/schema/task.ts", from: "waitingOn", to: "keptOpenBy" },
  { file: "packages/orchestration/src/tasks/schema/hold.ts", from: "releasedBy", to: "closedBy" },
  { file: "packages/orchestration/src/inbox/types.ts", from: "holds", to: "questions", near: "InboxHold<TDetail>" },
  { file: "packages/orchestration/src/inbox/types.ts", from: "holds", to: "questions", near: "TaskHold[] | null" },
  { file: "packages/orchestration/src/inbox/client.ts", from: "holdId", to: "questionId", near: "holdId?: string" },
  { file: "packages/orchestration/src/skills/task-tools-capability.ts", from: "holds", to: "questions", near: "z.array(taskHoldSchema)" },
  { file: "packages/orchestration/src/skills/task-tools-capability.ts", from: "waitingOn", to: "keptOpenBy", near: "z.enum([\"wait\"" },
  { file: "packages/orchestration/src/skills/task-tools-capability.ts", from: "question", to: "answers", near: "question: z\n" },
  { file: "packages/orchestration/src/skills/task-tools-capability.ts", from: "question", to: "answers", near: "question: string | undefined; message" },
  { file: "packages/orchestration/src/tasks/collection/holds.ts", from: "hold", to: "questionId", near: "interface HoldAnswer" },
  { file: "packages/orchestration/src/tasks/collection/types.ts", from: "hold", to: "question", near: "hold?: SuspensionHold" },
  { file: "packages/orchestration/src/task-board/task-request.ts", from: "holds", to: "questions", near: "readonly ok: true; readonly holds" },
  { file: "packages/orchestration/src/tasks/collection/holds.ts", from: "holds", to: "questions", near: 'op: "ask"; readonly holds' },
  { file: "packages/orchestration/src/tasks/collection/types.ts", from: "holds", to: "questions", near: "readonly holds?: readonly string[]" },
  { file: "packages/orchestration/src/tasks/collection/types.ts", from: "waitingOn", to: "keptOpenBy", near: "TaskWaitingOn | null" },
  { file: "packages/devtool/src/react/lib/task-collection-state.ts", from: "holds", to: "questions" },
  { file: "packages/shift-manager/src/lib/reads.ts", from: "holds", to: "questions", near: "holds: TaskHold[]" },
  { file: "packages/workforce/src/messages/midway-question.ts", from: "holds", to: "questions", near: "readonly RowHold[]" },
  { file: "packages/workforce/src/conversation-board/backfill-wakes.ts", from: "waitingOn", to: "keptOpenBy" },
];

/** Unique identifiers: renamed by an exact, word-bounded replace. */
const IDENTIFIERS: Record<string, string> = {
  // A task's questions (was: holds)
  TaskHold: "TaskQuestion", taskHoldSchema: "taskQuestionSchema",
  RowHold: "RowQuestion", rowHoldSchema: "rowQuestionSchema",
  SuspensionHold: "SuspensionQuestion", suspensionHoldSchema: "suspensionQuestionSchema",
  RowHoldSource: "RowQuestionSource", SuspensionHoldSource: "SuspensionQuestionSource", InboxHold: "InboxQuestion",
  HoldAsk: "QuestionInit", HoldReleaser: "QuestionCloser", HoldAnswer: "QuestionAnswer",
  MAX_HOLD_PROMPT: "MAX_QUESTION_PROMPT",
  openHolds: "openQuestions", hasOpenHold: "hasOpenQuestion", openRowHolds: "openRowQuestions",
  isRowHold: "isRowQuestion", isSuspensionHold: "isSuspensionQuestion", suspensionHoldOf: "suspensionQuestionOf",
  holdsDue: "questionsDue", nextHoldDue: "nextQuestionDue", newRowHolds: "newRowQuestions",
  holdWrite: "questionWrite", HoldChange: "QuestionChange", HoldWriteResult: "QuestionWriteResult",
  payHoldDeadlines: "payQuestionDeadlines", holdDueMs: "questionDueMs",
  holdOfSuspension: "questionOfSuspension", openUserHolds: "openUserQuestions",
  whileHoldOpen: "whileQuestionOpen", refuseWhenHeld: "refuseWithOpenQuestion",
  answerHold: "answerOne",
  // What keeps a running task open (was: waitingOn, filed work holds)
  TaskWaitingOn: "TaskKeptOpenBy", setWaitingOn: "setKeptOpenBy",
  filedWorkHolds: "filedWorkKeepsOpen", holdsItsFiler: "keepsFilerOpen",
  // The claim, and a board's owner
  heldTask: "claimedTask", heldTaskId: "claimedTaskId", heldRowOf: "claimedRowOf", ticketHoldsRow: "ticketClaimsRow",
  holderSessionId: "ownerSessionId", holderOf: "boardOwnerOf",
};

/** Where the exact pass reads: code, tests, goals, labs, apps and published docs. Retained specs, changelogs and archives are history. */
const TEXT_PATHS = [
  "packages", "apps/docs/docs", "apps/docs/guides", "apps/kitchen-sink", "apps/devtool", "goals", "labs", "examples",
  "docs/architecture", "docs/internal/design/workforce-coordination-concept.md", "docs/internal/design/workforce-coordination-gaps.md",
];
const TEXT_EXCLUDES = [":!**/CHANGELOG.md", ":!**/node_modules/**", ":!**/dist/**", ":!**/*.verdict.*", ":!**/verdicts/**"];

function declarationOf(sourceFile: ReturnType<Project["getSourceFileOrThrow"]>, rename: DeclRename): Node {
  const kinds = [SyntaxKind.PropertyAssignment, SyntaxKind.PropertySignature, SyntaxKind.Parameter, SyntaxKind.ShorthandPropertyAssignment];
  const found = kinds
    .flatMap((kind) => sourceFile.getDescendantsOfKind(kind))
    .filter((node) => node.getFirstChildByKind(SyntaxKind.Identifier)?.getText() === rename.from)
    .filter((node) => rename.near === undefined || node.getText().includes(rename.near) || node.getParent()?.getText().includes(rename.near));
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
  resolve(repoRoot, "apps/kitchen-sink/src/**/*.{ts,tsx}"),
  resolve(repoRoot, "apps/kitchen-sink/flows/**/*.{ts,tsx}"),
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

// Pass 2: exact identifiers, word-bounded.
const files = execFileSync("git", ["grep", "-lwE", Object.keys(IDENTIFIERS).join("|"), "--", ...TEXT_PATHS, ...TEXT_EXCLUDES], {
  cwd: repoRoot,
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);
const pattern = new RegExp(`\\b(${Object.keys(IDENTIFIERS).join("|")})\\b`, "g");
for (const file of files) {
  const path = resolve(repoRoot, file);
  const before = readFileSync(path, "utf8");
  const after = before.replace(pattern, (name) => IDENTIFIERS[name]!);
  if (after !== before) writeFileSync(path, after);
}
console.log(`exact pass: ${files.length} files`);

// Pass 3: the colliding property names where the checker can't reach them
// (loosely typed fixtures, `.mts` goals, docs examples), by their shape.
// `holds` only as a property (`.holds` not called, a `holds:` key, `"holds"`),
// never a `.holds()` method or React's `useReadFence` predicate; `holdId` never the held *request* of the client
// goal; `waitingOn` never the two labs' own view models.
interface ShapeRename {
  readonly pattern: RegExp;
  /** The plain word `git grep -lw` finds candidate files by; `pattern` decides each hit. */
  readonly find: string;
  readonly to: string;
  readonly skip?: readonly string[];
}
const SHAPES: readonly ShapeRename[] = [
  { pattern: /\breleasedBy\b/g, find: "releasedBy", to: "closedBy" },
  { pattern: /\bwaitingOn\b/g, find: "waitingOn", to: "keptOpenBy", skip: ["labs/teammates/", "labs/claude-code-style/"] },
  { pattern: /\bholdId\b/g, find: "holdId", to: "questionId", skip: ["goals/client/does-every-job-with-one-client/"] },
  { pattern: /(?<=\.)holds\b(?!\(|\?\.\()|(?<=(?:^|[{,;])\s*)holds(?=\??: (?!\())|(?<=")holds(?=")/gm, find: "holds", to: "questions", skip: ["packages/react/"] },
  { pattern: /\bno-such-hold\b/g, find: "no-such-hold", to: "no-such-question" },
  { pattern: /\bdone_without_question\b/g, find: "done_without_question", to: "done_without_answers" },
];
// `updateTask`'s `question` input: a `question:` inside one object literal
// that also names the task's `id` and a `message` or `done`; a template's
// `${…}` may sit inside it.
const UPDATE_TASK_QUESTION = /\{(?:[^{}]|\$\{[^{}]*\})*\bid\b(?:[^{}]|\$\{[^{}]*\})*\}/g;
for (const shape of SHAPES) {
  const hits = execFileSync("git", ["grep", "-lw", shape.find, "--", ...TEXT_PATHS, ...TEXT_EXCLUDES], { cwd: repoRoot, encoding: "utf8" })
    .split("\n")
    .filter((file) => file && !(shape.skip ?? []).some((prefix) => file.startsWith(prefix)));
  let changed = 0;
  for (const file of hits) {
    const path = resolve(repoRoot, file);
    const before = readFileSync(path, "utf8");
    const after = before.replace(shape.pattern, shape.to);
    if (after !== before) {
      writeFileSync(path, after);
      changed++;
    }
  }
  console.log(`${shape.find} → ${shape.to}: ${changed} files`);
}
const questionFiles = execFileSync("git", ["grep", "-lP", "\\bquestion: ", "--", ...TEXT_PATHS, ...TEXT_EXCLUDES], { cwd: repoRoot, encoding: "utf8" })
  .split("\n")
  .filter(Boolean);
let answered = 0;
for (const file of questionFiles) {
  const path = resolve(repoRoot, file);
  const before = readFileSync(path, "utf8");
  const after = before.replace(UPDATE_TASK_QUESTION, (literal) =>
    /\bquestion: /.test(literal) && /\b(message|done)\b/.test(literal) ? literal.replace(/\bquestion: /, "answers: ") : literal
  );
  if (after !== before) {
    writeFileSync(path, after);
    answered++;
  }
}
console.log(`updateTask question → answers: ${answered} files`);

// Pass 4: the decline reason "held" (a write refused while a question is
// open) becomes "open-question". Status `held`, the `held` change kind and
// `case "held"` on a status stay, so each spelling is matched where it is
// the reason and nowhere else.
const REASONS: ReadonlyArray<{ readonly file: string; readonly pattern: RegExp; readonly to: string }> = [
  { file: "packages/orchestration/src/tasks/collection/types.ts", pattern: /\| "held"(?=\n\s+\/\*\* An answer to a question already)/, to: '| "open-question"' },
  { file: "packages/orchestration/src/tasks/collection/holds.ts", pattern: /\{ decline: "held" \}/g, to: '{ decline: "open-question" }' },
  { file: "packages/orchestration/src/tasks/collection/internal.ts", pattern: /^(\s+)return "held";$/gm, to: '$1return "open-question";' },
  { file: "packages/orchestration/src/tasks/collection/internal.ts", pattern: /(Questions?\(task\)(?:\.length > 0)?\)) return "held";/g, to: '$1 return "open-question";' },
  { file: "packages/orchestration/src/task-board/task-request.ts", pattern: /reason === "held"/g, to: 'reason === "open-question"' },
  { file: "packages/orchestration/src/tasks/lease-renewal.ts", pattern: /reason === "held"/g, to: 'reason === "open-question"' },
  { file: "packages/orchestration/test/collection/holds.test.ts", pattern: /reason: "held"/g, to: 'reason: "open-question"' },
  { file: "packages/orchestration/test/collection/waiting-on-user.test.ts", pattern: /reason: "held"/g, to: 'reason: "open-question"' },
];
for (const reason of REASONS) {
  const path = resolve(repoRoot, reason.file);
  const before = readFileSync(path, "utf8");
  const after = before.replace(reason.pattern, reason.to);
  if (after === before) throw new Error(`${reason.file}: no "held" reason matched ${reason.pattern.source}`);
  writeFileSync(path, after);
}
console.log(`decline reason "held" → "open-question": ${REASONS.length} spellings`);
