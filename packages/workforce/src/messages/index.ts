/**
 * Worker messages (FIX-1989): any worker with a conversation can message any
 * other on its user's roster. Talk, not delegation: no task row, no delegate,
 * no task-chain count. The session kit carries the tool and the entry, so
 * both worker flows get them; `hireWorkforce`'s `messages` sets the limits.
 */
export { SEND_MESSAGE_TOOL, MESSAGE_RECEIVED_ENTRY } from "./keys";
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
export { sendMessageInputSchema } from "./message-tool";
export { sendMessage, type SendOutcome, type SendMessageInput } from "./send-message";
