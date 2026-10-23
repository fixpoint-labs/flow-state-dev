/**
 * FIX-2087 task-surface rules: what the task surface may offer, what it no longer has, and who
 * may record a task's ending. One engine (`engine.mjs`) reads these for the goal and for CI, so
 * the two give one answer on one commit (D2).
 *
 * Three rules:
 *
 * - **tools**: every task tool the task-tools capability declares (a call of core's
 *   `handler`, read by symbol), by literal name or `named()`, is on {@link TOOLS_ALLOWED}. A name
 *   not on it fails, deprecated ones included; an allowed name not read can't be told.
 * - **removed**: no surface the epic's migration table removes is live in the swept files.
 *   Each name row of the table is matched by a scoped matcher where its name means that
 *   surface ({@link REMOVED}); a behaviour row has no name and is proved by its owning child's
 *   goal ({@link BEHAVIOUR_ROWS}). The engine reads the table as it stands on the commit and
 *   fails when a row has neither.
 * - **endings**: every caller of a task collection's `complete` or `fail`, read by type through
 *   the TypeScript program, and every `cancel` that passes the caller's own claim, sits in a
 *   recorder function on {@link RECORDERS}. A write helper on {@link PASS_THROUGHS}, and a
 *   collection wrapper on {@link FORWARDERS}, is not a recorder: its own callers are read in
 *   its place. Each key names exactly one function, or the sweep can't tell.
 *
 * A line that names a removed surface on purpose (a BP-030 legacy read, a refusal) carries
 * the `retired-name-refusal` marker, FIX-1875's and FIX-1876's spelling. The allow lists change
 * only with a reason a reviewer can read; FIX-2058, retiring `answerTask`, edits
 * {@link TOOLS_ALLOWED}.
 */
import { REFUSAL_MARKER, ROOTS } from "../../vocabulary/one-word-per-thing/rules.mjs";

export { REFUSAL_MARKER, ROOTS };

/** The epic's migration table, read as it stands on the swept commit. */
export const MIGRATION_TABLE = "specs/epics/FIX-2056/migration.md";

/** The task tools a turn may be offered, each with why. Anything else the capability declares fails. */
export const TOOLS_ALLOWED = {
  createTask: "FIX-2081: the filer's five",
  getTask: "FIX-2081: the filer's five",
  listTasks: "FIX-2081: the filer's five",
  updateTask: "FIX-2081: the filer's five",
  reportProgress: "FIX-2081: the worker's progress checkpoint, one of the five",
  answerTask: "FIX-2056 D2: kept until FIX-2058 retires it",
  parkOnQuestion: "FIX-2056 D2: the worker's question park, kept until FIX-2058",
};

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
  // quoted `"x"` or `"x_<board>"`, or a page's `x` tool. `addTask` is also the collection's
  // method, which stays, so only those shapes are read for it.
  {
    row: "`addTask",
    kind: "text",
    files: SWEPT_TEXT,
    // Only where the name is a tool's or an action's: the collection's `addTask` method stays.
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
  { row: "`Task.parkedForTurn`", kind: "declared", module: "orchestration/tasks", type: "AwaitReviewOptions", props: ["forTurn"], owner: "FIX-2086" },
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
    owner: "FIX-2084",
  },
  { row: "A manager's `runTaskBoard` entry", kind: "text", files: PRODUCT.files, notFiles: PRODUCT.notFiles, pattern: /["'`]runTaskBoard["'`]|\brunTaskBoard\s*:/, owner: "FIX-2084" },
  { row: "`resumeOwedWaits`", kind: "text", files: SWEPT_TEXT, pattern: words("resumeOwedWaits"), owner: "FIX-2078" },
  { row: "`dispatchedTaskPredicate`", kind: "text", files: SWEPT_TEXT, pattern: words("dispatchedTaskPredicate"), owner: "FIX-2076" },
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
