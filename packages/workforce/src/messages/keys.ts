/**
 * The pinned names of worker messages (FIX-1989). A leaf module with no
 * imports, so the browser entry, the tool and the entry share one spelling.
 */

/** The internal entry a worker message arrives on. **Pinned**: the goal check reads deliveries by it. */
export const WORKER_MESSAGE_ENTRY = "onWorkerMessage";

/** The tool a worker's model sends a message with. **Pinned**: an app draws its calls by name. */
export const MESSAGE_WORKER_TOOL = "messageWorker";

/** Server-written session state: the message ids a session has acted on, newest last. */
export const WORKER_MESSAGES_SEEN_STATE = "workerMessagesSeen";
