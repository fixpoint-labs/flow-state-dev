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

// FIX-999.
/**
 * The request host: how a framework package reaches facilities only
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
  TaskAddress,
} from "../types/wait-gate";
export { waitOnRequest } from "../blocks/wait-on-request";
export type { RequestWaitOutcome, WaitOnRequestInput } from "../blocks/wait-on-request";

// FIX-2519.
/** The harness attachment seam: the request's file reader, under a symbol slot. */
export { ATTACHMENT_SEAM } from "../types/attachment-seam";
export type { AttachmentSeam } from "../types/attachment-seam";

// FIX-2522.
/** The user attachment seam: copies of a turn's files kept in the person's own scope. */
export {
  USER_ATTACHMENT_SEAM,
  UserAttachmentsUnavailableError,
  discardAttachmentsForUser,
  keepAttachmentsForUser,
} from "../types/user-attachment-seam";
export type { UserAttachmentSeam } from "../types/user-attachment-seam";

/** The dispatch seam: the runtime's dispatch operation, under a symbol slot. */
export { DISPATCH_SEAM, NoDispatchSeamError, dispatchThroughSeam } from "../types/dispatch";
export type { DispatchSeam } from "../types/dispatch";

// FIX-2077; FIX-2145.
/** The request-end seam and the request's spend ledger. */
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

// FIX-2129.
/** How the running request resumed: read where a resumed request is admitted. */
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

// FIX-811.
/**
 * The resume read model: the server builds a `ReplayLog` from a
 * request's persisted items at re-entry and assigns it to `ctx._replayLog`.
 */
export { buildReplayLog } from "../blocks/internal/replay-log";
export type { ReplayLog } from "../blocks/internal/replay-log";

/**
 * The SDK version gate every harness package calls: its range match, the
 * installed-version reader, the readiness half, and the one error class.
 */
export {
  HarnessSdkVersionMismatchError,
  assertTestedSdkVersion,
  readInstalledSdkVersion,
  satisfiesSdkRange,
  sdkVersionReadiness,
} from "../helpers/harness-sdk-version";
export type { InstalledSdkVersion, InstalledSdkVersionReader, TestedSdk } from "../helpers/harness-sdk-version";

/** Runtime helpers the engine shares with core. */
export { resolveActiveStatusMessage } from "../blocks/internal/resolve-active-status-message";
export { resolveAllowedActions } from "../errors/resolve-allowed-actions";
export { cacheTokensOf } from "../helpers/cache-tokens";
export { isFiveFieldCron } from "../types/schedules";
/** A once-per-process warning that, unlike `warnOnceDev`, still prints in production. */
export { warnOnce } from "../helpers/deprecation";

/**
 * The internal item surface: the `ref` block value, the runtime item union
 * and their resolvers.
 */
export * from "../items/internal";

/**
 * Runtime helpers our packages share and no app imports: the block-instance-id
 * builders the engine stamps traces with, the reactive-binding normalizer, the
 * slash-command grammar, the evaluator check, the binding cache, error and
 * abort readers, and the trace-observability switch.
 */
export {
  ROOT_BLOCK_PATH,
  blockPathObserver,
  buildBlockInstanceId,
  logicalBlockIdOf,
} from "../blocks/internal/block-instance-id";
// FIX-742.
/** Block-level rescue, for the engine's top-level `executeBlock` on a bare action-root block. */
export { runRescue } from "../blocks/sequencer";
export { normalizeReactiveBinding } from "../types/resource-change";
export type { ReactiveBindingKind } from "../types/resource-change";
export { SLASH_COMMAND_PATTERN } from "../helpers/slash-command";
export { assertEvaluatorBlock } from "../blocks/evaluator";
export { createBindingCache } from "../bindings";
export { errorDetailsWithCause } from "../errors";
export { isTraceObservabilityEnabled } from "../helpers/trace-observability";

/**
 * The change-notice and push-delivery wire the engine and the node host serve,
 * and the manifest-domain guard workforce reads, from `@flow-state-dev/contracts`.
 */
export { PUSH_CLOSE_CODES, PUSH_MINT_MAX_TOPICS, isManifestDomain, wireTopicKey } from "@flow-state-dev/contracts";
// FIX-2625: the one cap and union rule for a notice's ids, shared by the engine's fold and the client's merge.
export { NOTICE_MAX_IDS, unionNoticeIds } from "@flow-state-dev/contracts/types/push-delivery";
export type { ChangeKind, PushCapability, PushMintAnswer, PushServerFrame, TopicScope } from "@flow-state-dev/contracts";
