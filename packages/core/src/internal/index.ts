/**
 * `@flow-state-dev/core/internal` — core's one hidden entry, for our own
 * packages only.
 *
 * It holds the runtime seams that engine, orchestration, workforce and the
 * harness packages share: the request host and the internal context type the
 * engine builds, the wait gate, the dispatch, request-end, spend, resume and
 * board-notice seams, the request's side-chain pool, the replay read model,
 * and the internal item surface (the `ref` block value and the runtime item
 * union, from `@flow-state-dev/contracts/items/internal`).
 *
 * Not for apps: none of these names is on core's root or `core/types`, and an
 * app, example or docs page that imports any `@flow-state-dev/<pkg>/internal`
 * path fails the import census in CI. A name an app author needs belongs on a
 * public entry with a README line instead.
 */

/** The internal context type: the public `BlockContext` plus the runtime's wiring. */
export type { InternalBlockContext } from "../types/block";

/**
 * The request host (FIX-999): how a framework package reaches facilities only
 * the runtime can provide. `requestHostOf` reads it, `undefined` when none is
 * wired; `requireRequestHost` throws by name.
 */
export { NoRequestHostError, requestHostOf, requireRequestHost } from "../types/request-host";
export type {
  LivenessAnswers,
  ParentTaskOutcome,
  RequestHost,
  RequestSessions,
  RequestWaits,
  RequestWakes,
  ResumeWaitInput,
  ResumeWaitResult,
  SessionHistory,
  SessionHistoryQuery,
  PeerSessionView,
  SettleParentTaskInput,
  SettleParentTaskResult,
  SuspensionAddress,
  WaitDeadlines,
  WakeSettleResult,
  WakeView,
} from "../types/request-host";

/**
 * The wait gate: what a request parks on while work it started runs
 * elsewhere, and how the wait ends: the work's ending, its deadline, or a stop.
 */
export {
  MAX_WAIT_DEPTH,
  WAIT_DEADLINE_ENTRY,
  WAIT_DEADLINE_OUTCOME,
  WAIT_GATE_REASON,
  canHoldWait,
  continuesAtExpiry,
  isWaitGate,
  parkOnWait,
  parseWaitOutcome,
  recordedWaitOutcome,
  waitGateDataOf,
} from "../types/wait-gate";
export type {
  ParkOnWaitInput,
  WaitEndingErrorCode,
  WaitGateBinding,
  WaitGateData,
  WaitOutcome,
  WaitRow,
} from "../types/wait-gate";
export { waitOnRequest } from "../blocks/wait-on-request";
export type { RequestWaitOutcome, WaitOnRequestInput } from "../blocks/wait-on-request";

/** The dispatch seam: the runtime's dispatch operation, under a symbol slot. */
export { DISPATCH_SEAM, NoDispatchSeamError, dispatchThroughSeam } from "../types/dispatch";
export type { DispatchSeam } from "../types/dispatch";

/** The request-end seam (FIX-2077) and the request's spend ledger (FIX-2145). */
export {
  REQUEST_END_SEAM,
  REQUEST_SPEND_SEAM,
  SESSION_REQUEST_END_HOOK,
  addRequestSpendSource,
  onRequestEnded,
  readRequestSpend,
  readRequestTotalSpend,
  requestSpendSources,
} from "../types/request-end";
export type {
  BackgroundFailure,
  RequestEndHook,
  RequestEndSeam,
  RequestEndStatus,
  RequestEndVerdict,
  RequestEnding,
  RequestSpend,
  RequestSpendSeam,
  RequestSpendSource,
  SessionRequestEndHook,
} from "../types/request-end";

/** How the running request resumed (FIX-2129): read where a resumed request is admitted. */
export { REQUEST_RESUME_SEAM, requestResumeOf } from "../types/request-resume";
export type { RequestResume } from "../types/request-resume";

/** The board-notice seam: a task board's change reaches the change bus. */
export { BOARD_NOTICE_SEAM, publishBoardChange } from "../types/board-notice";
export type { BoardChange, BoardNoticeSeam } from "../types/board-notice";

/** The request's side-chain pool: detached work a request drains before it ends. */
export { getRequestSideChainPool } from "../execution/request-side-chain-pool";
export type {
  RequestSideChainPool,
  RequestSideChainPoolDrainAllOptions,
  RequestSideChainPoolDrainOptions,
  RequestSideChainPoolDrainToQuiescenceOptions,
  RequestSideChainPoolResult,
  RequestSideChainTaskMeta,
} from "../execution/request-side-chain-pool";

/**
 * The resume read model (FIX-811): the server builds a `ReplayLog` from a
 * request's persisted items at re-entry and assigns it to `ctx._replayLog`.
 */
export { buildReplayLog } from "../blocks/internal/replay-log";
export type { ReplayLog } from "../blocks/internal/replay-log";

/** Runtime helpers the engine shares with core. */
export { resolveActiveStatusMessage } from "../blocks/internal/resolve-active-status-message";
export { resolveAllowedActions } from "../errors/resolve-allowed-actions";
export { cacheTokensOf } from "../helpers/cache-tokens";
export { isFiveFieldCron } from "../types/schedules";

/**
 * The internal item surface: the `ref` block value, the runtime item union
 * and their resolvers.
 */
export * from "../items/internal";
