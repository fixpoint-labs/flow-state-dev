/**
 * The pinned names of worker messages (FIX-1989, FIX-2238). A leaf module with
 * no imports, so the browser entry, the tool and the entry share one spelling.
 */

/** The internal entry a worker message arrives on. **Pinned**: the goal check reads deliveries by it. */
export const MESSAGE_RECEIVED_ENTRY = "onMessageReceived";

/** The tool a worker's model sends a message with. **Pinned**: an app draws its calls by name. */
export const SEND_MESSAGE_TOOL = "sendMessage";

/**
 * The mark on the capability that offers {@link SEND_MESSAGE_TOOL}, read by
 * the hire (FIX-2271). A registered symbol, so two installed copies of this
 * package read each other's mark.
 */
export const SENDS_MESSAGES_MARK = Symbol.for("@flow-state-dev/workforce/sends-messages");

/** The client-only component a received message is drawn by. **Pinned**: an app's renderer is keyed by it. */
export const RECEIVED_MESSAGE_COMPONENT = "workforce:received";

/** Server-written session state: the messages a session sent that haven't landed or ended yet, with the request that sent each (FIX-2240). */
export const WORKER_MESSAGES_OWED_STATE = "workerMessagesOwed";
