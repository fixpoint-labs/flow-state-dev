/**
 * `@flow-state-dev/workforce/browser` — the names a browser component needs
 * from this package, and nothing that runs a seat.
 *
 * The package root is not safe to bundle for a browser: the mailbox floor
 * reaches the orchestration task board, which imports `node:async_hooks`. A
 * bundler that drops unused re-exports hides that until a client component
 * asks for one name that sits beside the runtime, and then the page fails to
 * compile. Import from here in a client component instead.
 *
 * `test/browser-subpath-safe.test.ts` walks this entry's import graph, through
 * the workspace packages it reaches, and fails on any Node built-in.
 *
 * The coordinator's names come from its leaf keys module: an app tells a
 * coordinator's conversation, its routing records and its own turn apart by them.
 */

export {
  MAILBOX_POST_COMPONENT,
  mailboxTranscriptLineSchema,
  type MailboxTranscriptLine
} from "./mailbox/mailbox-post-line";
export {
  createWorkforceClient,
  type RosterEntry,
  type WorkforceClient,
  type WorkforceClientOptions
} from "./workers/client";
export {
  deriveWorkerSessionId,
  isDerivedWorkerSessionId,
  type WorkerSessionCriteria
} from "./workers/derive-session-id";
export { PROJECT_STATE_KEY, ROSTER_FLOW_KIND, WORKER_ID_STATE_KEY, WORKSTREAM_STATE_KEY } from "./workers/keys";
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
export { COORDINATOR_JUDGMENT, COORDINATOR_KIND, COORDINATOR_ROUTE } from "./coordinator/coordinator-keys";
