/**
 * Worker messages (FIX-1989): any worker with a conversation can message any
 * other on its user's roster. Talk, not delegation: no task row, no delegate,
 * no task-chain count. The session kit carries the tool and the entry, so
 * both worker flows get them; `hireWorkforce`'s `messages` sets the limits.
 */
export { MESSAGE_WORKER_TOOL, WORKER_MESSAGE_ENTRY } from "./keys";
export {
  MAX_MESSAGE_CHARS,
  MESSAGE_STATUSES,
  WORKER_MESSAGES_PATTERN,
  WORKER_MESSAGES_RESOURCE,
  workerMessageRowSchema,
  workerMessagesCollection,
  workerMessagesResources,
  type MessageAddress,
  type WorkerMessageRow
} from "./message-log";
export { DEFAULT_MESSAGE_HOP_LIMIT, DEFAULT_MESSAGES_PER_TURN, type MessageLimits } from "./message-limits";
export { messageWorkerInputSchema } from "./message-tool";
export { sendWorkerMessage, takesWorkerMessages, type SendOutcome, type SendWorkerMessage } from "./send-message";
