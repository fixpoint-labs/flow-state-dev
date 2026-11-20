// FIX-1989, FIX-2238.
/**
 * The pinned names of worker messages. A leaf module with
 * no imports, so the browser entry, the tool and the entry share one spelling.
 */

/** The internal entry a worker message arrives on. **Pinned**: the goal check reads deliveries by it. */
export const MESSAGE_RECEIVED_ENTRY = "onMessageReceived";

/** The tool a worker's model sends a message with. **Pinned**: an app draws its calls by name. */
export const SEND_MESSAGE_TOOL = "sendMessage";

// FIX-2271.
/**
 * The mark on the capability that offers {@link SEND_MESSAGE_TOOL}, read by
 * the hire. A registered symbol, so two installed copies of this
 * package read each other's mark.
 */
export const SENDS_MESSAGES_MARK = Symbol.for("@flow-state-dev/workforce/sends-messages");

/** The client-only data record a received message is drawn from. **Pinned**: an app's renderer is keyed by it. */
export const RECEIVED_MESSAGE_DATA_TYPE = "workforce:received";

// FIX-2848 D1.
/** The client-only data record a message a worker sent (`sendMessage`) is drawn from, refused ones too. **Pinned**: an app's renderer is keyed by it. */
export const SENT_MESSAGE_DATA_TYPE = "workforce:sent";

/** The client-only data record a task a conversation filed is drawn from. **Pinned**: an app's renderer is keyed by it. */
export const FILED_TASK_DATA_TYPE = "workforce:task";

/** The client-only data record a task's ending is drawn from, under the worker that ran it. **Pinned**: an app's renderer is keyed by it. */
export const TASK_RESULT_DATA_TYPE = "workforce:result";

// FIX-2240.
/** Server-written session state: the messages a session sent that haven't landed or ended yet, with the request that sent each. */
export const WORKER_MESSAGES_OWED_STATE = "workerMessagesOwed";

// FIX-2310.
/**
 * Server-written session state: the reply-requested messages this session
 * landed and hasn't answered yet, with the request that landed each.
 * The pass answers "no answer" for one whose request ended
 * without answering it.
 */
export const WORKER_REPLIES_OWED_STATE = "workerRepliesOwed";
