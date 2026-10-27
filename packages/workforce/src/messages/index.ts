/**
 * Worker messages (FIX-1989): any worker with a conversation can message any
 * other on its user's roster. Talk, not delegation: no task row, no delegate,
 * no task-chain count. The session kit carries the tool and the entry; a
 * worker flow without it mounts `messageReceivedEntry` itself, and the hire
 * refuses one with neither (FIX-2238). `hireWorkforce`'s `messages` sets the budget.
 */
export { SEND_MESSAGE_TOOL, MESSAGE_RECEIVED_ENTRY, RECEIVED_MESSAGE_COMPONENT } from "./keys";
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
  workerMessageRowSchema,
  workerMessagesCollection,
  workerMessagesResources,
  type MessageAddress,
  type WorkerMessageRow
} from "./message-log";
export { DEFAULT_MESSAGE_HOP_LIMIT, DEFAULT_MESSAGES_PER_TURN, type MessageLimits } from "./message-limits";
export { sendMessageInputSchema } from "./message-tool";
export { sendMessage, type SendOutcome, type SendMessageInput } from "./send-message";
// A message to a task or a conversation, checked before anything is written (FIX-2160).
export { checkTargetSession, checkTaskTarget, type CheckedTarget, type MessageTarget, type TargetCheck } from "./message-target";
