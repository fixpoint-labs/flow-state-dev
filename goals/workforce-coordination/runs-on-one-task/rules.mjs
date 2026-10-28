/**
 * FIX-2087 task-surface rules. `engine.mjs` reads these for the goal and for CI, so the two
 * give one answer on one commit (D2).
 *
 * {@link TOOLS_ALLOWED}: task tools the capability may declare. {@link REMOVED}: one matcher per
 * name row of {@link MIGRATION_TABLE}. {@link BEHAVIOUR_ROWS}: the goal for a row with no name.
 * A row with neither fails. {@link RECORDERS} may write an ending; {@link PASS_THROUGHS} and
 * {@link FORWARDERS} are not recorders, and their callers are read instead. Each of those keys
 * names exactly one function, or the sweep can't tell. A line that names a removed surface on
 * purpose carries the `retired-name-refusal` marker. The lists change only with a reason a
 * reviewer can read; FIX-2131 (FIX-2058) retired `answerTask` and `parkOnQuestion` from
 * {@link TOOLS_ALLOWED}, and added the worker's `askQuestion` and `waitForUser`.
 */
import { REFUSAL_MARKER, ROOTS } from "../../vocabulary/one-word-per-thing/rules.mjs";

export { REFUSAL_MARKER, ROOTS };

/** The epic's migration table, read as it stands on the swept commit. */
export const MIGRATION_TABLE = "specs/epics/FIX-2056/migration.md";

/** The task tools a turn may be offered. Anything else the capability declares fails. */
export const TOOLS_ALLOWED = new Set([
  "createTask", "getTask", "listTasks", "updateTask", // FIX-2081: the filer's five
  "reportProgress", // FIX-2081: the worker's progress checkpoint, one of the five
  "askQuestion", // FIX-2131: the worker's question, which holds its task (FIX-2133's hold)
  "waitForUser", // FIX-2131: the model's stop for an approval, a review or (with no task row) input
]);

/** Code under the swept roots: the files the AST rules (tools, members, endings) read. */
export const CODE = /^(packages|apps)\/.*\.(ts|tsx|mts|cts)$/;

/**
 * Test and fixture code. A test plays a worker or a board on purpose, and a refusal test names
 * the surface it refuses, so the endings rule and the code matchers skip it; the behaviour it
 * pins is graded by the children's goals.
 */
export const TEST_CODE = /(^|\/)(test|tests|__tests__|e2e|fixtures)\/|\.(test|spec|type-test)\.(ts|tsx|mts)$|\.d\.ts$|(^|\/)(stores\/testing|src\/testing)\//;

/** Tracked files under ROOTS that are deliberately not swept by the removed rule, each with its reason. */
export const EXCLUDE = [
  { path: /(^|\/)CHANGELOG\.md$/, why: "release history: records what shipped under the old names" },
  {
    path: /^\.changeset\//,
    why: "release notes: the migration table says each removal's changeset carries its row's line, so a changeset names the removed surface by design",
  },
  { path: /^apps\/docs\/blog\//, why: "dated blog posts: history, not reference" },
  { path: /^goals\/workforce-coordination\/runs-on-one-task\//, why: "this sweep: its rules name every removed surface on purpose" },
  {
    path: /^goals\//,
    why: "goals: a goal drives the public surface, so one still driving a removed surface fails its own run (plan row 3); its verdict log is history, and a goal serving an older commit (GOAL_COMMIT) names that commit's surface by design",
  },
  { path: TEST_CODE, why: "tests and fixtures: a test pins the refusal of what it names; the behaviour is graded by the children's goals" },
  {
    path: /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|json|jsonl|ya?ml|lock|css|scss|html|txt|toml|sh|py|sql|snap|map|svg)$|(^|\/)\.[^/]+$|(^|\/)(LICENSE|Dockerfile)$/,
    why: "no symbols in scope (data, assets, config, figures)",
  },
  { path: /^(apps|packages)\/.*\.(md|mdx)$/, notIf: /^(apps\/docs\/(docs|guides)\/|packages\/[^/]+\/README\.md$)/, why: "markdown outside the published docs and package READMEs (fixtures, worker files, app notes)" },
];

/** Code and the pages a user reads: where a removed name is live. */
const SWEPT_TEXT = /^(packages|apps)\/.*\.(ts|tsx|mts|cts|js|mjs|cjs)$|^(apps\/docs\/(docs|guides)\/.*\.mdx?|packages\/[^/]+\/README\.md|docs\/architecture\/.*\.md)$/;
/** The pages a user reads. */
const PAGES = /^(apps\/docs\/(docs|guides)\/.*\.mdx?|packages\/[^/]+\/README\.md|docs\/architecture\/.*\.md)$/;
/** Product code only (no tests): where a common word means the removed surface only in a declaration. */
const PRODUCT = { files: CODE, notFiles: TEST_CODE };

const words = (...names) => new RegExp(`\\b(${names.join("|")})\\b`);

/**
 * One matcher per name row of the migration table. `row` is a phrase the engine finds in the
 * row's "Removed" cell, so a row the table adds later with no matcher here fails the run.
 *
 * Kinds:
 * - `text`: a line pattern over `files` (less `notFiles`).
 * - `declared`: a property declared on an exported type (`type` in `module`), read by the
 *   TypeScript checker, so a renamed variable can't hide it.
 * - `member`: a call of `name` on a value of that type, read by type.
 * - `union`: a string member of an exported union type.
 * - `door`: a worker flow's declared action (read by the goal, which builds the flows; the
 *   sweep reads the action keys of every worker flow file's `actions`).
 */
export const REMOVED = [
  // ---- tools and their `_tasks` actions (FIX-2081, FIX-2080, FIX-2083) ----
  // A tool's name means the tool where it is a tool's or an action's name: `named("x")`, a
  // quoted `"x"` or `"x_<board>"`, or a page's `x` tool. `addTask` was also the collection's
  // method until FIX-2243 renamed it `createTask`, so only those shapes are read for it.
  {
    row: "`addTask",
    kind: "text",
    files: SWEPT_TEXT,
    // Only where the name is a tool's or an action's, never prose about the collection's old method.
    pattern: /named\(\s*["']addTask["']|\b(name|toolName)\s*(:|===)\s*["'`]addTask["'`]|\baddTask_\w+|`addTask`\s+(tool|action)\b|\btool\s+`addTask`/,
    owner: "FIX-2081",
  },
  ...["dispatchTask", "readTask", "assignTask", "cancelTask", "completeTask", "failTask", "blockTask"].map((name) => ({
    row: `\`${name}`,
    kind: "text",
    files: SWEPT_TEXT,
    pattern: new RegExp(`named\\(\\s*["']${name}["']|(?<!\\[)["'\`]${name}(_\\w+)?["'\`](?!\\])|\\b${name}_\\w+|\\b${name}\\b\`?\\s+(tool|action)\\b|\\btool\\s+\`?${name}\\b`),
    owner: name === "dispatchTask" ? "FIX-2083" : name === "blockTask" ? "FIX-2080" : "FIX-2081",
  })),
  {
    row: "`dispatchAndWait`",
    kind: "text",
    files: SWEPT_TEXT,
    pattern: words("dispatchAndWait", "DispatchAndWaitOptions", "DispatchAndWaitResult", "DispatchRef", "DispatchTarget", "DEFAULT_WAIT_TIMEOUT_MS", "MIN_WAIT_TIMEOUT_MS", "MAX_WAIT_TIMEOUT_MS"),
    owner: "FIX-2082",
  },
  { row: "`TaskInit.wait`", kind: "declared", module: "orchestration/tasks", type: "TaskInit", props: ["wait", "undispatched"], owner: "FIX-2082, FIX-2080" },
  { row: "`taskTurnInstead`", kind: "text", files: SWEPT_TEXT, pattern: words("taskTurnInstead"), owner: "FIX-2082" },
  { row: "`parkOnWait`'s `timeoutMs`", kind: "text", files: SWEPT_TEXT, pattern: words("WaitEndedError", "WaitStoppedError"), owner: "FIX-2082" },
  { row: "`parkOnWait`'s `timeoutMs`", kind: "declared", module: "core", type: "ParkOnWaitInput", props: ["timeoutMs"], owner: "FIX-2082" },
  {
    row: "`updateTask`'s `taskId`",
    kind: "text",
    files: PRODUCT.files,
    notFiles: PRODUCT.notFiles,
    // updateTask's input: its schema keys. A refusal of the old keys carries the marker.
    pattern: /\b(addLabel|removeLabel)\s*:\s*z\.|\bpatch\s*:\s*z\.object/,
    owner: "FIX-2081",
  },
  // `A task session's reach to the whole roster` has no name: FIX-2081's goal (roster-reach) proves it.
  { row: "`TaskCollection.block`", kind: "member", module: "orchestration/tasks", type: "TaskCollectionRef", props: ["block", "unblock"], owner: "FIX-2080" },
  { row: "The `\"blocked\"` task status", kind: "union", type: "TaskStatus", members: ["blocked"], owner: "FIX-2080" },
  { row: "`Task.undispatched`", kind: "declared", type: "Task", props: ["undispatched", "reopened", "parkedForTurn", "dispatchCall"], owner: "FIX-2080, FIX-2086, FIX-2083" },
  { row: "Change kinds `blocked`, `unblocked`", kind: "union", type: "TaskChangeKind", members: ["blocked", "unblocked", "dispatched", "reopened"], owner: "FIX-2080, FIX-2086" },
  { row: "Change kind `dispatched`", kind: "union", module: "orchestration/tasks", type: "TaskChangeKind", members: ["dispatched"], owner: "FIX-2080" },
  { row: "The board's `counts.blocked`", kind: "text", files: PRODUCT.files, notFiles: PRODUCT.notFiles, pattern: /counts\??\.blocked\b|\bblocked\s*:\s*(0|number|z\.number)/, owner: "FIX-2080" },
  { row: "`createCascadeSkipDependents`", kind: "text", files: SWEPT_TEXT, pattern: words("createCascadeSkipDependents"), owner: "FIX-2080" },
  { row: "`TaskCollection.block`", kind: "text", files: PAGES, pattern: /`unblock`|\.(un)?block\(/, owner: "FIX-2080" },
  { row: "`TaskCollection.reopen`", kind: "text", files: PAGES, pattern: /`reopen`|\.reopen\(/, owner: "FIX-2086" },
  { row: "`TaskCollection.reopen`", kind: "member", module: "orchestration/tasks", type: "TaskCollectionRef", props: ["reopen"], owner: "FIX-2086" },
  { row: "`Task.reopened`", kind: "declared", module: "orchestration/tasks", type: "Task", props: ["reopened"], owner: "FIX-2086" },
  { row: "The `reopened` change kind", kind: "union", module: "orchestration/tasks", type: "TaskChangeKind", members: ["reopened"], owner: "FIX-2086" },
  // `AwaitReviewOptions` itself is gone (FIX-2131), so its `forTurn` is read as text.
  { row: "`Task.parkedForTurn`", kind: "text", files: SWEPT_TEXT, pattern: words("parkedForTurn"), owner: "FIX-2086" },
  { row: "A board's `reopenIn`", kind: "text", files: SWEPT_TEXT, pattern: words("reopenIn"), owner: "FIX-2086" },
  {
    row: "`harnessMessageDoor`",
    kind: "text",
    files: SWEPT_TEXT,
    pattern: words("harnessMessageDoor", "messageDoorInputSchema", "messageDoorOutputSchema", "messageDoor"),
    owner: "FIX-2086",
  },
  {
    row: "`TurnRefused`",
    kind: "text",
    files: SWEPT_TEXT,
    pattern: words("TurnRefused", "TurnRefusalReason", "HarnessMessageDoorOptions", "MessageDoorAction", "MessageDoorBoard", "MessageDoorOptions", "MessageDoorOutput", "DoorRunIdentity"),
    owner: "FIX-2086",
  },
  {
    row: "`DELEGATED_POST_ENTRY`",
    kind: "text",
    files: SWEPT_TEXT,
    pattern: words("DELEGATED_POST_ENTRY", "delegatedPostEntry", "delegatedPostOnFinished", "delegatedPostSchema", "DelegatedPost"),
    owner: "FIX-2083",
  },
  { row: "`delegatedPostHistory`", kind: "text", files: SWEPT_TEXT, pattern: words("delegatedPostHistory"), owner: "FIX-2083" },
  { row: "`DispatchPostForm`", kind: "text", files: SWEPT_TEXT, pattern: words("DispatchPostForm"), owner: "FIX-2083" },
  { row: "`taskLedgers({ taskTurn })`", kind: "text", files: PRODUCT.files, notFiles: PRODUCT.notFiles, pattern: /taskLedgers\(\s*\{[^}]*\btaskTurn\b/, owner: "FIX-2083" },
  { row: "`defineCoordinatorFlow`'s `delegateFlows`", kind: "text", files: SWEPT_TEXT, pattern: words("delegateFlows", "postFlows"), owner: "FIX-2083" },
  { row: "`defineCoordinatorFlow`'s `delegateFlows`", kind: "declared", module: "workforce", type: "SessionBoardOptions", props: ["posts", "postFlows"], owner: "FIX-2083" },
  { row: "`TaskCollectionRef.dispatch`", kind: "member", module: "orchestration/tasks", type: "TaskCollectionRef", props: ["dispatch"], owner: "FIX-2083" },
  { row: "`TaskCollectionRef.dispatch`", kind: "text", files: SWEPT_TEXT, pattern: /\bTaskDispatchOptions\b|["'`]already-dispatched["'`]/, owner: "FIX-2083" },
  { row: "`idempotencyWindowMs`", kind: "text", files: SWEPT_TEXT, pattern: words("idempotencyWindowMs"), owner: "FIX-2085" },
  { row: "`idempotencyOptions`", kind: "text", files: SWEPT_TEXT, pattern: words("idempotencyOptions"), owner: "FIX-2085" },
  { row: "`settleSplitTask`", kind: "text", files: SWEPT_TEXT, pattern: words("settleSplitTask"), owner: "FIX-2077" },
  // `retryOf` is also the engine's request retry, which stays: the split's marker lives on the Workforce board.
  { row: "the retry marker (`retryOf`)", kind: "text", files: /^packages\/(workforce|orchestration)\/src\/.*\.ts$/, pattern: /["'`]retryOf["'`]|\bRETRY_OF\b/, owner: "FIX-2077" },
  {
    row: "Every worker flow's door: `run`",
    kind: "door",
    names: ["run", "message", "runTaskBoard"],
    // The built-in worker flows: the door rule must read both, or it can't tell.
    floor: ["packages/workforce/src/agent-worker-flow.ts", "packages/workforce/src/coordinator/coordinator-flow.ts"],
    owner: "FIX-2084",
  },
  { row: "A manager's `runTaskBoard` entry", kind: "text", files: PRODUCT.files, notFiles: PRODUCT.notFiles, pattern: /["'`]runTaskBoard["'`]|\brunTaskBoard\s*:/, owner: "FIX-2084" },
  { row: "`resumeOwedWaits`", kind: "text", files: SWEPT_TEXT, pattern: words("resumeOwedWaits"), owner: "FIX-2078" },
  { row: "`dispatchedTaskPredicate`", kind: "text", files: SWEPT_TEXT, pattern: words("dispatchedTaskPredicate"), owner: "FIX-2076" },
];

/**
 * FIX-2058's old ways to stop for a person or to answer one, and the names they leave behind
 * (FIX-2134 D2): no reference in package source, the pages a user reads, or Shift Manager,
 * matched as the text rows of {@link REMOVED} are, with the same `--control` plant. A ratchet:
 * each child of FIX-2058 adds the names it deletes in the PR that deletes them, and FIX-2134
 * checks the list is complete. A name is a word, matched wherever the removed rule sweeps,
 * unless its entry narrows `files`.
 */
export const PERSON_STOPS_REMOVED = [
  // FIX-2129: every listed suspension answers through the answer route, whatever source its run
  // arrived on, so none is unanswerable for that; and an expiry that carries a turn on is no
  // longer an approval's alone (`continuesAtExpiry`).
  { name: "REOPENED_SOURCES", owner: "FIX-2129" },
  { name: "DISPATCHED_RUN_UNANSWERABLE", owner: "FIX-2129" },
  { name: "isExpiredApproval", owner: "FIX-2129" },
  // FIX-2133: a task run's stop for a person is a suspension hold in `holds`, not `waitingFor`
  // beside `keptOpenBy: "user"`; and a row hold is answered from the Inbox, so none is unanswerable.
  { name: "waitingFor", owner: "FIX-2133" },
  { name: "MAX_WAITING_FOR_PROMPT", owner: "FIX-2133" },
  { name: "keepWaitingFor", owner: "FIX-2133" },
  { name: "ROW_HOLD_UNANSWERABLE", owner: "FIX-2133" },
  { name: "inboxQuestionAnswer", owner: "FIX-2133" },
  // FIX-2132: a coding run's question holds its task on the board, through one ask step; the
  // harness manager's own question inbox, its board park and its announcement are gone.
  // `answerQuestion` is also the board's own `updateTask` step, so only harness-manager's is swept.
  { name: "answerQuestion", owner: "FIX-2132", files: /^packages\/harness-manager\/.*\.(ts|tsx|mts)$|^packages\/harness-manager\/README\.md$/ },
  { name: "inboxCollection", owner: "FIX-2132" },
  { name: "parkOnBoardQuestion", owner: "FIX-2132" },
  { name: "parkOnMismatch", owner: "FIX-2132" },
  { name: "HarnessRunParked", owner: "FIX-2132" },
  { name: "QuestionAnnouncement", owner: "FIX-2132" },
  { name: "listQuestions", owner: "FIX-2132" },
  { name: "readQuestion", owner: "FIX-2132" },
  { name: "withdrawQuestion", owner: "FIX-2132" },
  { name: "withdrawEarlierQuestions", owner: "FIX-2132" },
  { name: "questionTopic", owner: "FIX-2132" },
  { name: "questionTopicPrefix", owner: "FIX-2132" },
  { name: "questionFingerprint", owner: "FIX-2132" },
  { name: "parseQuestionTopic", owner: "FIX-2132" },
  { name: "announce", owner: "FIX-2132", files: /^packages\/harness-manager\/src\/.*\.ts$/ },
  // FIX-2131: a question holds its task and a review suspends; the question park, its answer
  // and the review park are gone, with the board's park exit. `onReview` is still named once, by
  // the board's refusal of it (marked).
  { name: "parkOnQuestion", owner: "FIX-2131" },
  { name: "createParkOnQuestion", owner: "FIX-2131" },
  { name: "ParkOnQuestionOptions", owner: "FIX-2131" },
  { name: "answerTask", owner: "FIX-2131" },
  { name: "awaitReview", owner: "FIX-2131" },
  { name: "AwaitReviewOptions", owner: "FIX-2131" },
  { name: "unparkAndDrain", owner: "FIX-2131" },
  { name: "UnparkAndDrainInput", owner: "FIX-2131" },
  { name: "unparkAndDrainInputSchema", owner: "FIX-2131" },
  { name: "unpark", owner: "FIX-2131" },
  { name: "UnparkOptions", owner: "FIX-2131" },
  { name: "onReview", owner: "FIX-2131" },
  { name: "TaskBoardOnReview", owner: "FIX-2131" },
  { name: "assertParkExitSupported", owner: "FIX-2131" },
  { name: "parkedOnQuestion", owner: "FIX-2131" },
  { name: "turnReentries", owner: "FIX-2131" },
  { name: "refuseWhenParked", owner: "FIX-2131" },
  { name: "excusedParked", owner: "FIX-2131" },
  { name: "PERSON_REASONS", owner: "FIX-2131" },
  // FIX-2220: a verb's one-edge guard, left with no callers once the park verbs went.
  { name: "requireFrom", owner: "FIX-2220" },
  { name: "assertTransitionFrom", owner: "FIX-2220" },
];

/**
 * Lines that name a removed surface on purpose where a marker can't go or doesn't belong, each
 * with its reason: a published page or README telling a consumer what replaced it, or a legacy
 * read (BP-030). Never widened to silence a live surface: a line here says the surface is gone.
 */
export const KEEP = [
  { path: /^apps\/docs\/docs\/orchestration\/task-board\.md$/, line: /^\*\*Moving from `dispatchTask`\.\*\* There is no `dispatchTask` tool/, why: "the page's migration note: says the tool is gone and what replaces it" },
  { path: /^(apps\/docs\/docs\/server\/scheduled\.md|packages\/scheduled\/README\.md)$/, line: /idempotency(WindowMs|Options)/, why: "says the adapter refuses the removed options (FIX-2085)" },
  { path: /^packages\/scheduled\/src\/createScheduledTransportAdapter\.ts$/, line: /idempotency(WindowMs|Options)/, why: "BP-030: the adapter refuses a removed option loudly, naming it" },
  { path: /^packages\/harness-manager\/README\.md$/, line: /Upgrading from `messageDoor`|^Before `harnessSessionDoor`, a manager's `messageDoor`/, why: "the README's upgrade note: says the door is gone and what replaces it" },
  { path: /^packages\/harness-manager\/src\/manager\.ts$/, line: /^if \("announce" in \(options as object\)\) \{$|^"\[harness-manager\] `announce` was removed: /, why: "BP-030: the manager refuses the removed `announce` option loudly, naming it (FIX-2132)" },
  { path: /^packages\/harness-manager\/README\.md$/, line: /^- The manager keeps no questions of its own\. Removed: /, why: "the README's migration note: says the question inbox is gone and what replaces it (FIX-2132)" },
  { path: /^packages\/orchestration\/README\.md$/, line: /^\*\*Migrating from `resumeOwedWaits`\.\*\* `resumeOwedWaits\(ctx, collection\)` is no longer exported/, why: "the README's migration note: says the helper is gone" },
  { path: /^packages\/workforce\/src\/conversation-board\/(board-entries|ledger)\.ts$/, line: /\bRETRY_OF\b/, why: "BP-030: the retired marker's key, kept only so a row an older host wrote has it stripped from what a caller reads; nothing writes it" },
  { path: /^packages\/workforce\/src\/workers\/upgrade-entry-names\.ts$/, line: /from: "runTaskBoard"/, why: "BP-030: the host-start rewrite of a request stored under the old entry name (FIX-2084)" },
];

/**
 * Rows of the "Removed" table that remove behaviour rather than a name, and the goal that
 * proves each (row 3 of the plan). Keyed by a phrase of the row's "Removed" cell.
 */
export const BEHAVIOUR_ROWS = {
  "`addDelegate`, `removeDelegate`, `setFallback` on every coordinator": "goals/task-tools/five-tools-one-rule-per-field (leg a: only a coordinator set to `editsOwnDelegates` is offered them), FIX-2081",
  "A task session's reach to the whole roster": "goals/task-tools/five-tools-one-rule-per-field (control roster-reach), FIX-2081",
  "The dispatch request body's `idempotencyKey`": "goals/scheduled-work/recurring-work-files-a-task, FIX-2085",
  "A fixed `nominalFireTime`": "goals/scheduled-work/recurring-work-files-a-task, FIX-2085",
  "A cron of more than five fields": "goals/scheduled-work/recurring-work-files-a-task, FIX-2085",
  "A schedule `timezone` that isn't an IANA zone": "goals/scheduled-work/recurring-work-files-a-task, FIX-2085",
  "A `ScheduleResolutionContext` built by hand": "goals/scheduled-work/recurring-work-files-a-task, FIX-2085",
  "A split task's `{ answer, pieces }` output": "goals/task-board/settles-when-its-work-is-over, FIX-2077",
  "A failed piece failing its task": "goals/task-board/settles-when-its-work-is-over, FIX-2077",
  "A worker flow with a role's entries and no declared role": "goals/workers/roles-checked-at-hire (control no-role-check), FIX-2084",
};

/**
 * The ending's recorders: the functions allowed to write a task's ending, each with its reason.
 * Keyed `<package>:<function>`, never a file path, so moving a recorder costs no rule edit.
 * Rule 18: the claim gate for a dispatched row, the drain for an inline one. Patterns keep
 * their own boards' recorders (FIX-2056, "What stays as it is"), the drain there.
 */
export const RECORDERS = {
  "orchestration:checkTask": "the claim gate: a dispatched task's request-end check fails the attempt (FIX-2077, FIX-2088)",
  "orchestration:checkAnswered": "the claim gate: a dispatched task's request-end check settles it done (FIX-2077)",
  "orchestration:settleAtRequestEnd": "the claim gate: the settle every request-end and recorder write passes through",
  "orchestration:cancelForStop": "the claim gate: a stop of a task's run waiting on a user cancels the task where it would have failed the try (FIX-2129, rule 12)",
  "orchestration:createRecordSuccess": "the drain's recorder: an inline row's result",
  "orchestration:createRecordError": "the drain's recorder: an inline row's error (FIX-2090's refused run ends here)",
  "orchestration:releaseRow": "the drain's recorder: a row whose recorder could not confirm its own write",
  "patterns:createRecordArgument": "a pattern's own inline recorder (patterns stay)",
  "patterns:createRecordContribution": "a pattern's own inline recorder (patterns stay)",
  "patterns:routedSpecialists": "a pattern's own inline recorder (patterns stay)",
};

/**
 * Collection wrappers: functions that build a task collection over another one and hand its
 * `complete` or `fail` on (a bound method, or a method picked by name). Not recorders: the
 * wrapper is itself a collection, so every call of its `complete` or `fail` is read in its place.
 * Only the forwarding shapes are exempt; a direct `complete()`/`fail()` call inside one is a finding.
 * Keyed like {@link RECORDERS}.
 */
export const FORWARDERS = {
  "workforce:guarded": "the conversation board's ref: complete and fail bound through, deleting a finished top task's chain count",
  "workforce:byRow": "the plan board: a write sent to the ledger holding the row (the plan's, or the board's)",
  "workforce:notOnAStep": "the plan board: complete and fail refused on a step, else sent to the board",
};

/**
 * Write helpers that pass an ending through: not recorders. Their own callers are read in
 * their place, so a new caller of a helper is a finding like a direct write.
 */
export const PASS_THROUGHS = ["advisoryComplete", "advisoryFail", "advisoryCancel"];

/**
 * FIX-2133's Inbox rule: one item type says what waits on the user, built in one place. The
 * functions allowed to build an orchestration `InboxItem`, each with its reason. Keyed like
 * {@link RECORDERS}. An item built anywhere else is a finding: a second list of what waits on
 * the user, which the Inbox and its counts would disagree with.
 */
export const INBOX_READ = {
  "orchestration:itemOf": "the Inbox read's one constructor of an item: `inboxItems`, the read, lists every item through it",
};
