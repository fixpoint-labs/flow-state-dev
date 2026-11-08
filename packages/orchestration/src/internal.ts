/**
 * `@flow-state-dev/orchestration/internal` — what only FSD's own packages read.
 *
 * Not for apps. Published, so a sibling package's installed tarball resolves
 * it, but outside semver: a name here can change between minors, and the
 * packages that read it (workforce, harness-manager, patterns, our goals)
 * move with it under exact pins. A name an app, example, lab or docs page
 * imports belongs on a public entry instead; the export check's import census
 * holds that line.
 *
 * Node-only, like the root: several of these modules reach `node:` built-ins.
 *
 * @internal
 */

// Collection backings, behind `defineTaskCollection` / `getOrCreateTaskCollection`.
export { createResourceBackedTaskCollection, type ResourceBackedOptions } from "./tasks/collection/resource-backed";
export { createStateBackedTaskCollection, type StateBackedOptions } from "./tasks/collection/state-backed";
export { taskLedgerResources, hasFrozenLedgerAssignee } from "./tasks/collection/define-task-collection";
export { findTaskPartitions } from "./tasks/collection/find-task-partitions";
export { readCommittedTask } from "./tasks/collection/read-committed";
export { TaskWriteRefusedError } from "./tasks/collection/refused-write";
export { resolveTaskCapDefaults, RETRY_BUDGET_NOT_APPLICABLE } from "./tasks/collection/task-caps";
export { CASCADE_DUE_MS, cascadeEndedAt, DEFAULT_LEASE_DURATION_MS } from "./tasks/collection/internal";
export { type TaskChangeEvent, type TaskChangeKind, SERVER_ONLY_TASK_FIELDS } from "./tasks/collection/change-event";
export type { TaskClaimIdentity } from "./tasks/schema/task";
export type { TaskWorkerRegistry } from "./tasks/workers/types";
export { taskClaimTicketSchema } from "./tasks/claim-ticket";
export { requestSpendView } from "./tasks/spend";

// Filing, holds and steers: what a wrapped board (workforce's conversation
// board) re-runs before it writes.
export {
  assertDepsFileable,
  assertFilingCallerContext,
  assertFilingSettings,
  assertFollowUpHasRun,
  assertIdsFree,
  assertUniqueIds,
  parentCancelledRefusal,
  type TaskFilingCallerContext,
} from "./tasks/collection/filing";
export { hasStarted } from "./tasks/collection/field-rules";
export { endsFiledWork } from "./tasks/collection/cascade";
export { answerOf, hasOpenHold, isOwnHold, isSuspensionHold, nextHoldDue, openOwnHolds } from "./tasks/collection/holds";
export { MAX_QUESTION_PROMPT } from "./tasks/schema/hold";
export { MAX_STEERS } from "./tasks/schema/steer";
export {
  untakenSteers,
  steersTakenIn,
  steerWrite,
  steerFromLine,
  shownSteer,
  LINE_STEER_REFUSALS,
  type ShownSteer,
  type LineSteerRefusal,
} from "./tasks/steers";
export { keepsFilerOpen } from "./tasks/helpers/filed-work";
export { decideTake, hasEnded, type TakeRule } from "./tasks/helpers/request-states";
export { rowsInSession } from "./tasks/helpers/session-rows";
export { cancelAndResume } from "./tasks/helpers/user-stop";
export { checkWaitable, toolCallOf, type WaitableOptions, type WaitableRefusal } from "./tasks/helpers/wait-on-task";

// A delegated row's ending: its delivery, its notice, and the pass a filer runs itself.
export { TASK_SETTLED_ENTRY, filerResolver } from "./tasks/notice/delivery";
export {
  owedNotices,
  owesAnyNotice,
  clearNotice,
  noticeKey,
  decideNotice,
  withoutNoticeMarkers,
  type NoticePolicy,
  type NoticeDecision,
  NOTICE_DUE_MS,
  nextResendAt,
  noticeDueAt,
  resendNowPatch,
} from "./tasks/notice/task-notice";
export { takeOwedNotice } from "./tasks/notice/task-settled-entry";
export { payBoardDebts, settlePassWake, type BoardDebts, type PayBoardDebtsOptions } from "./tasks/notice/pass";

// The lease-renewal async-context seam (Node-only: `node:async_hooks`).
export {
  openLeaseRenewalScope,
  withLeaseRenewalScope,
  stampLeaseRenewal,
  currentLeaseRenewal,
} from "./tasks/lease-renewal-scope";
export { RENEWAL_DIVISOR } from "./tasks/lease-renewal";

// The task board's own blocks and markers.
export { taskBoardStateSchema } from "./task-board/schemas";
export { packWorkerInput } from "./task-board/blocks/worker-step";
export { TASK_BOARD_META_COMPONENT_TYPE } from "./task-board/blocks/board-meta";
export { GOAL_SEEK_LOOP_TERMINATION_COMPONENT_TYPE } from "./task-board/goal-seek-loop";
export { assertDispatchEntrySupported } from "./task-board/dispatch-assignee";
export { afterTaskCheck, STEER_TURN_DUE_MS } from "./task-board/task-request";
export { TASK_SESSION_TASK_KEY } from "./task-board/task-turn";

// The task tools' and skills' pieces a worker flow composes itself.
export { taskToolsForTurn, taskToolReads, STATUS_NOTE_LIMIT, readTaskView } from "./skills/task-tools-capability";
export { taskToolSuffix } from "./skills/task-tool-suffix";
export {
  createSteerContext,
  renderSteers,
  runningTaskOf,
  showTakenSteers,
  takeRunningSteers,
  STEERED_WHILE_RUNNING,
  type RunningTask,
  type SteerContextOptions,
} from "./skills/steer-context";
export { pushActiveSkill, type ActiveSkillEntry } from "./skills/active-skill-state";
export { formatAllowedToolsIntentNote } from "./skills/render-skill-body";

// The frontmatter dialect `SKILL.md` and workforce's `WORKER.md` share.
export { splitFrontmatter, parseFrontmatterYaml } from "./shared/frontmatter";
