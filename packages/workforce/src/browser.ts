/**
 * `@flow-state-dev/workforce/browser` — the names a browser component needs
 * from this package, and nothing that runs a worker.
 *
 * The package root is not safe to bundle for a browser: the conversation
 * board reaches the orchestration task board, which imports `node:async_hooks`. A
 * bundler that drops unused re-exports hides that until a client component
 * asks for one name that sits beside the runtime, and then the page fails to
 * compile. Import from here in a client component instead.
 *
 * `test/browser-subpath-safe.test.ts` walks this entry's import graph, through
 * the workspace packages it reaches, and fails on any Node built-in.
 *
 * `parseWorkstreamEntry` comes from the entry's leaf module: a browser read of
 * a project's entries parses them with the same schema `readProject` does.
 *
 * The coordinator's names come from its leaf keys module: an app tells a
 * coordinator's conversation, its routing records and its own turn apart by them.
 */

export {
  createWorkforceClient,
  type RosterEntry,
  type WorkerSessionEntry,
  type WorkforceClient,
  type WorkforceClientSource
} from "./workers/client";
export {
  deriveWorkerSessionId,
  isDerivedWorkerSessionId,
  type WorkerSessionCriteria
} from "./workers/derive-session-id";
export {
  FILING_SESSION_STATE_KEY,
  PROJECT_STATE_KEY,
  ROSTER_FLOW,
  SET_WORK_PROJECT_ACTION,
  TASK_ID_STATE_KEY,
  WORK_PROJECT_STATE_KEY,
  WORKER_ID_STATE_KEY,
  WORKSTREAM_STATE_KEY
} from "./workers/keys";
export type { SetWorkProjectOutput } from "./projects/work-project";
export { sessionIdOfFiling } from "./conversation-board/filing-session";
export {
  parseProjectRef,
  parseWorkstreamRef,
  PRIVATE_WORKSTREAMS_RESOURCE,
  projectRef,
  workstreamRef,
  WORKSTREAMS_RESOURCE,
  workstreamsAccessor,
  workstreamStorageKey,
  type ProjectAddressRef,
  type WorkstreamAddress
} from "./projects/workstream-ref";
export {
  DONE_STATUS,
  projectProgress,
  STALE_AFTER_MS,
  type ProgressEntry,
  type ProjectProgress
} from "./projects/project-progress";
export {
  parseWorkstreamEntry,
  type ParsedWorkstreamEntry,
  type WorkstreamEntry
} from "./projects/workstream-entry";
export { COORDINATOR_JUDGMENT, COORDINATOR_FLOW, COORDINATOR_ROUTE } from "./coordinator/coordinator-keys";
/** The Error Reporter's flow: an app finds the worker a user tells about a problem by it. */
export { ERROR_REPORTER_FLOW } from "./error-reporter/keys";
export { SEND_MESSAGE_TOOL, MESSAGE_RECEIVED_ENTRY, RECEIVED_MESSAGE_COMPONENT } from "./messages/keys";
export { LIST_SCHEDULES_ACTION, SCHEDULES_PATTERN } from "./schedules/keys";
export { listedScheduleSchema, type ListedSchedule } from "./schedules/listed-schedule";
export {
  WORKER_MESSAGES_PATTERN,
  WORKER_MESSAGES_RESOURCE,
  workerMessageRowSchema,
  type WorkerMessageRow
} from "./messages/log-row";
export { MAX_RULES, MAX_RULE_CHARS, type StandingRule } from "./standing-rules/rules-list";
export { RULE_TOOLS, STANDING_RULES_ACTION, STANDING_RULES_LINE } from "./standing-rules/keys";
export type { StandingRulesActionInput, StandingRulesActionOutput } from "./standing-rules/rules-action";
