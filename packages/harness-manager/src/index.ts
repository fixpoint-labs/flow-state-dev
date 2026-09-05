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
 * - `conductorDrainBudgetMs` and `resolveOwnership`, because a host sizing its
 *   own shutdown needs the same numbers the manager enforces.
 * - The run record and inbox collections, so a host can build a status surface.
 *
 * **Checkout internals** — exported because this repository's own consumer and
 * its goal checks reach for them, NOT because a host should build on them.
 * Everything below the "checkout internals" heading is git-worktree-specific:
 * `provisionCheckout` cuts worktrees, `acquireCheckout` takes a lock file
 * beside the tree, and the path grammar assumes both. A second checkout
 * strategy — a fresh clone per run, a projected workspace — would put these
 * behind a seam, and a host that built on them would move with it. Adopt
 * `harnessManager({ harness })` and let it own the checkout.
 */

// ── The manager ─────────────────────────────────────────────────────────────
export {
  harnessManager,
  conductorDrainBudgetMs,
  resolveOwnership,
  requestTenant,
  describeTenant,
  withDeadline,
  conductorTaskInputSchema,
  ConductorAttemptFailed,
  ConductorAttemptSuperseded,
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
export {
  openRunRow,
  readRunRow,
  writeRunRow,
  runRecordCollection,
  runRecordStateSchema,
  runTopic,
  runTopicPrefix,
  collectionRef,
  type AttemptIdentity,
  type RunRecordState,
  type RunRowWrite,
  type CollectionHoldingContext,
} from "./run-record";

// ── The question inbox ──────────────────────────────────────────────────────
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
  withdrawEarlierQuestions,
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
  identityFromCommonDir,
  repositoryIdentity,
} from "./guards";

// ── Checkout internals — git-worktree-specific; see the note above ───────────
export {
  acquireCheckout,
  branchFor,
  canonicalSegment,
  checkoutPathFor,
  conductorTaskId,
  encodeSegment,
  isStrictlyInside,
  joinIdentity,
  provisionCheckout,
  releaseCheckout,
  sameSegment,
  assertSafeSegment,
  tenantSegment,
  type CheckoutLease,
  type OwnershipBounds,
  type RunLocation,
  type RunPrincipal,
  type WorkspaceConfig,
} from "./workspace";

export {
  run,
  CHECKOUT_CLEANUP_TIMEOUT_MS,
  GIT_TIMEOUT_MS,
  NETWORK_CALL_TIMEOUT_MS,
  type RunOptions,
} from "./exec";
