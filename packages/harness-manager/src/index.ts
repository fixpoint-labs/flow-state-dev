/**
 * `@flow-state-dev/harness-manager` — a task-board row becomes a supervised
 * coding run.
 *
 * One dispatched worker on a board:
 *
 *   open the run row → build the prompt & take the checkout → run the harness
 *   → read the verdict → settle or fail
 *
 * The **harness is a slot**, not a dependency. This package imports no coding
 * agent and reads no vendor field: the host hands it a factory, the manager
 * calls that factory once with the four feeds the harness contract declares
 * (`@flow-state-dev/core`), and a Codex run and a Claude Code run settle
 * identically because the verdict is read off the neutral handle.
 *
 * ## The export surface has two halves, and the difference matters
 *
 * **Supported host API** — what you need to stand a manager up, and what this
 * package versions:
 *
 * - {@link harnessManager} and its options, including the `harness` slot.
 * - `goalJudge`, a ready-made `judge`: an evaluation model reads a run's
 *   answer and commits against its task's goal.
 * - `harnessSessionDoor`, the door a coding flow declares for a line typed
 *   in a run's session: a steer while its task is open, talk once it has
 *   finished. `harnessTalkTurn` is its talk half, which a coder also runs for
 *   a message about a finished task.
 * - `harnessSessionFlow`, a coding harness as one long-lived session a
 *   person talks to: the host says where sessions work and which harness
 *   runs. `harnessStub`, a scripted harness for the slot, for checks that run
 *   no model.
 * - `upgradeKeptTurns`, the upgrade's one-off step that writes a line the
 *   coding door kept before FIX-2086 onto its task as a steer.
 * - `runOwnerClaimOrder`, for a board kept per organization: a run belongs to
 *   the member who started it, and another member's drain leaves it alone.
 * - `PhaseSpec` and the run-context types a phase's hooks are handed: the
 *   shared base, plus the prompt side and the completion side.
 * - `WorkspaceConfig`, and the construction-time guards a host should run at
 *   its own door (`assertDistinctRepository`, `assertBaseRefExists`,
 *   `assertCheckoutRootUsable`, `assertPositiveInt`).
 * - `harnessDrainBudgetMs` and `resolveOwnership`, because a host sizing its
 *   own shutdown needs the same numbers the manager enforces.
 * - The run record collection, so a host can build a status surface. A run's
 *   question holds its task on the board, so a host reads questions there.
 * - `harnessUsageAction`, the one query for how much of each harness's
 *   subscription a person has used, and the collection behind it.
 *
 * **Checkout internals are NOT here.** They live behind
 * `@flow-state-dev/harness-manager/checkout`, a separate entry point, because
 * semver binds what this file exports regardless of what a header says about
 * it. They are git-worktree-specific; adopt `harnessManager({ harness })` and
 * let it own the checkout.
 */

// ── A ready-made judge ──────────────────────────────────────────────────────
export {
  goalJudge,
  GOAL_JUDGE_MODEL,
  GOAL_JUDGE_FLOOR,
  GOAL_JUDGE_QUESTION,
  GOAL_JUDGE_WHY_QUESTION,
  type GoalJudgeOptions,
} from "./goal-judge";

// ── The manager ─────────────────────────────────────────────────────────────
export {
  harnessManager,
  harnessDrainBudgetMs,
  resolveOwnership,
  requestTenant,
  describeTenant,
  withDeadline,
  harnessTaskInputSchema,
  HARNESS_FEATURE_KEY,
  namesHarnessFeature,
  harnessFeatureOf,
  harnessClaimSchema,
  harnessManagerInputSchema,
  harnessJudgeInputSchema,
  harnessJudgeVerdictSchema,
  harnessReviewAnswerSchema,
  MAX_ANSWER_CHARS,
  HarnessAttemptFailed,
  HarnessAttemptSuperseded,
  HarnessRunRefused,
  RUNS,
  STEER_POLL_MS,
  type ManagerOptions,
  type HarnessLedgers,
  type HarnessJudge,
  type HarnessJudgeInput,
  type HarnessJudgeVerdict,
  type HarnessReviewAnswer,
  type HarnessSlot,
  type HarnessFeeds,
  type PhaseSpec,
  type PhaseRunContext,
  type PromptRunContext,
  type CompletionRunContext,
  type AnsweredQuestion,
  type RequestIdentityContext,
} from "./manager";
export { PROGRESS_NOTE_MS, progressNoteOf } from "./progress-note";

// ── A line typed in a run's session: a steer, or talk once finished ─────────
export {
  harnessSessionDoor,
  harnessTalkTurn,
  harnessTalkInputSchema,
  harnessTalkOutputSchema,
  sessionDoorInputSchema,
  sessionDoorOutputSchema,
  SessionDoorRefused,
  type HarnessSessionDoorOptions,
  type HarnessTalkTurnOptions,
  type SessionDoorBoard,
  type SessionDoorRefusalReason,
} from "./session-door";

// ── A coding harness as a long-lived session a person talks to ────────────
export {
  harnessSessionFlow,
  harnessSessionFeeds,
  harnessSessionTitle,
  harnessSessionStartSchema,
  harnessSessionStateSchema,
  harnessSessionWorkspaceRecordSchema,
  harnessTurnRecordSchema,
  resolveHarnessSessionStart,
  HARNESS_SESSION_FAILED_OUTCOME,
  HARNESS_SESSION_MODEL_REQUIRED,
  HARNESS_SESSION_REMOVE_UNSUPPORTED,
  HARNESS_SESSION_REMOVE_NOT_OWNER,
  HARNESS_SESSION_ATTACH_MISSING,
  HARNESS_SESSION_ATTACH_NOT_YOURS,
  HARNESS_SESSION_ATTACH_NOT_PROVISIONED,
  HARNESS_SESSION_ATTACHED_BRANCH_CHANGED,
  harnessSessionAttachedTo,
  HARNESS_SESSION_START_INVALID,
  type HarnessSessionFeeds,
  type HarnessSessionFlowOptions,
  type HarnessSessionPlace,
  type HarnessSessionProvisioned,
  type HarnessSessionProvisionRequest,
  type HarnessSessionStart,
  type HarnessSessionState,
  type HarnessSessionWorkspace,
  type HarnessSessionWorkspaceRecord,
  type ResolvedHarnessSessionStart,
  type HarnessTurnRecord,
} from "./session-flow";
// ── A scripted harness for model-free checks ────────────────────────────────
export {
  harnessStub,
  type HarnessStub,
  type HarnessStubMcpTools,
  type HarnessStubOptions,
  type StubRun,
} from "./harness-stub";
// ── The upgrade's one-off step for lines the coding door kept ───────────────
export { upgradeKeptTurns, type KeptTurnUpgradeOptions, type KeptTurnUpgradeStores } from "./upgrade-kept-turns";

// ── Whose run a row is, on a board kept per organization ────────────────────
export {
  runOwnerClaimOrder,
  HARNESS_RUN_OWNER_KEY,
  runOwnerOf,
  type RunOwner,
} from "./run-owner";

// ── The run record ──────────────────────────────────────────────────────────
//
// **Read, not write.** `openRunRow`, `writeRunRow` and `collectionRef` are the
// manager's own — every one of them writes through the attempt fence, and a
// caller outside a claimed attempt either gets refused or corrupts a ledger the
// board is the authority on. A host builds its status surface from
// `readRunRow` and the collection; the writes stay internal.
export {
  readRunRow,
  runRecordCollection,
  runRecordStateSchema,
  heldSchema,
  placeStateSchema,
  runTopic,
  runTopicPrefix,
  type RunRecordState,
  type HeldRecord,
  type PlaceState,
  type CollectionHoldingContext,
} from "./run-record";
/**
 * The board segment of a run's identity: the ledger id, plus its partition on
 * a board read from the claim. `runTopic(runBoardSegment(ledgerId, partition),
 * issue, phase)` is that run's record key.
 */
export { runBoardSegment } from "./workspace";
/**
 * The issue a task's own id stands in for, on a board that mints its ids: a
 * session door's `runOf` keys a row's run with it, as the manager did.
 */
export { taskIssueSegment } from "./workspace";

// ── Subscription usage left, per person and harness ─────────────────────────
//
// The query is the read path: a host puts `harnessUsageAction({ readers })`
// on one flow. `recordHarnessUsage` is the collection's one writer, for a
// harness that reports usage during a run.
export {
  HARNESS_USAGE,
  USAGE_READ_TIMEOUT_MS,
  USAGE_REFRESH_EVERY_MS,
  harnessUsageAction,
  harnessUsageCollection,
  harnessUsageStateSchema,
  readHarnessUsage,
  recordHarnessUsage,
  type HarnessUsageActionOptions,
  type HarnessUsageRow,
  type HarnessUsageState,
  type HarnessUsageWindowRow,
  type UsageWrite,
} from "./harness-usage";

// ── The ask marker ──────────────────────────────────────────────────────────
export { ASK_MARKER_DIR, ASK_MARKER_IGNORE_RULE, askMarkerPath, readAskMarker } from "./ask";

// ── Construction-time guards a host runs at its own door ─────────────────────
export {
  MAX_TIMER_MS,
  assertBaseRefExists,
  assertCheckoutRootUsable,
  assertDistinctRepository,
  assertPositiveInt,
  repositoryIdentity,
} from "./guards";

// ── What a host configures the workspace with ───────────────────────────────
//
// The TYPES a host needs to write `workspace:` and `ownership:`. The functions
// that act on them are `@flow-state-dev/harness-manager/checkout` — see that
// module for why the split is an entry point rather than a comment.
export type { OwnershipBounds, WorkspaceConfig } from "./workspace";
