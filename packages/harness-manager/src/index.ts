/**
 * `@flow-state-dev/harness-manager` — a task-board row becomes a supervised
 * coding run.
 *
 * One handed-off worker on a board:
 *
 *   open the run row → build the prompt & take the checkout → run the harness
 *   → read the verdict → settle or fail
 *
 * The **harness is a slot**, not a dependency. This package imports no coding
 * agent and reads no vendor field: the host hands it a factory, the manager
 * calls that factory once with the three feeds the harness contract declares
 * (`@flow-state-dev/core`), and a Codex run and a Claude Code run settle
 * identically because the verdict is read off the neutral handle.
 *
 * ## The export surface has two halves, and the difference matters
 *
 * **Supported host API** — what you need to stand a manager up, and what this
 * package versions:
 *
 * - {@link harnessManager} and its options, including the `harness` slot.
 * - `PhaseSpec` and the two run-context types a phase's hooks are handed.
 * - `WorkspaceConfig`, and the construction-time guards a host should run at
 *   its own door (`assertDistinctRepository`, `assertBaseRefExists`,
 *   `assertCheckoutRootUsable`, `assertPositiveInt`).
 * - `harnessDrainBudgetMs` and `resolveOwnership`, because a host sizing its
 *   own shutdown needs the same numbers the manager enforces.
 * - The run record and inbox collections, so a host can build a status surface.
 *
 * **Checkout internals are NOT here.** They live behind
 * `@flow-state-dev/harness-manager/checkout`, a separate entry point, because
 * semver binds what this file exports regardless of what a header says about
 * it. They are git-worktree-specific; adopt `harnessManager({ harness })` and
 * let it own the checkout.
 */

// ── The manager ─────────────────────────────────────────────────────────────
export {
  harnessManager,
  harnessDrainBudgetMs,
  resolveOwnership,
  requestTenant,
  describeTenant,
  withDeadline,
  harnessTaskInputSchema,
  HarnessAttemptFailed,
  HarnessAttemptSuperseded,
  RUNS,
  type ManagerOptions,
  type HarnessSlot,
  type HarnessFeeds,
  type PhaseSpec,
  type PhaseRunContext,
  type PromptRunContext,
  type AnsweredQuestion,
  type QuestionAnnouncement,
  type RequestIdentityContext,
} from "./manager";

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
  runTopic,
  runTopicPrefix,
  type RunRecordState,
  type CollectionHoldingContext,
} from "./run-record";

// ── The question inbox ──────────────────────────────────────────────────────
//
// `withdrawEarlierQuestions` is not here for the same reason the run-record
// writes are not: it is attempt-scoped reconciliation the manager performs at
// the start of a run, and calling it from outside one withdraws a question a
// live attempt is still waiting on.
export {
  INBOX,
  askQuestion,
  answerQuestion,
  inboxCollection,
  listQuestions,
  parseQuestionTopic,
  questionFingerprint,
  questionTopic,
  readQuestion,
  withdrawQuestion,
} from "./inbox";

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
