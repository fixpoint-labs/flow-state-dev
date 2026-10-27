/**
 * The pinned names of worker messages (FIX-1989, FIX-2238). A leaf module with
 * no imports, so the browser entry, the tool and the entry share one spelling.
 */

/** The internal entry a worker message arrives on. **Pinned**: the goal check reads deliveries by it. */
export const MESSAGE_RECEIVED_ENTRY = "onMessageReceived";

/** The tool a worker's model sends a message with. **Pinned**: an app draws its calls by name. */
export const SEND_MESSAGE_TOOL = "sendMessage";

/** The client-only component a received message is drawn by. **Pinned**: an app's renderer is keyed by it. */
export const RECEIVED_MESSAGE_COMPONENT = "workforce:received";

/** Server-written session state: the message ids a session has acted on, newest last. */
export const WORKER_MESSAGES_SEEN_STATE = "workerMessagesSeen";
