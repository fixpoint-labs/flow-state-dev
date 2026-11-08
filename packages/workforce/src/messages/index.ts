// FIX-1989; FIX-2238.
/**
 * Worker messages: any worker with a conversation can message any
 * other on its user's roster. Talk, not delegation: no task row, no delegate,
 * no task-chain count. The session factory carries the tool and the entry; a
 * worker flow without it mounts `messageReceivedEntry` itself, and the hire
 * refuses one with neither. `hireWorkforce`'s `messages` sets the budget.
 */
export { SEND_MESSAGE_TOOL, RECEIVED_MESSAGE_COMPONENT } from "./keys";
export {
  messageReceivedEntry,
  messageReceivedInputSchema,
  messageReceivedSchema,
  promptedMessageTurn,
  receivedMessagePrompt,
  type MessageHearing,
  type MessageReceived
} from "./message-received-entry";
export {
  MAX_MESSAGE_CHARS,
  MESSAGE_STATUSES,
  WORKER_MESSAGES_PATTERN,
  WORKER_MESSAGES_RESOURCE,
  workerMessageResourceStateSchema,
  workerMessagesCollection,
  workerMessagesResources,
  type MessageAddress,
  type WorkerMessageResourceState
} from "./message-log";
export { DEFAULT_MESSAGE_BUDGET, DEFAULT_MESSAGES_PER_TURN, type MessageLimits } from "./message-limits";
export { sendMessageInputSchema } from "./message-tool";
export { MAX_LISTED_RECIPIENTS, rosterDisplayName, rosterTeamName, workerRecipients, type WorkerRecipients } from "./recipients";
// The default worker layer: exported so a worker flow an app writes
// itself puts the same first entry in its prompt as the built-in agent flow.
export { workerIdentityPrompt } from "./worker-identity";
// Reading another conversation without waking it (FIX-2173).
export {
  CONSULT_SESSION_HISTORY_TOOL,
  CONSULT_SESSIONS_CAPABILITY,
  consultSessionHistoryInputSchema,
  consultSessionsCapability,
  type ConsultSessionsOptions
} from "./consult";
export { sendMessage, type SendOutcome, type SendMessageInput } from "./send-message";
// A message to a task or a conversation, checked before anything is written (FIX-2160).
export { checkTargetSession, checkTaskTarget, type CheckedTarget, type MessageTarget, type TargetCheck } from "./message-target";
