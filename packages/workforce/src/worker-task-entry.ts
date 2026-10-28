/**
 * The entry every worker flow takes work through: tasks, a coordinator's
 * routed messages among them (FIX-2083). A leaf module, so a flow that
 * declares the entry and the lookup that checks for it share the name without
 * either importing the other.
 */

/**
 * The task entry every worker flow takes tasks through. **Pinned**: a list's
 * fallback hands over to it, and so does the wake.
 */
export const WORKER_TASK_ENTRY = "work";

/**
 * The mark on a task-ledger binding that takes a conversation's tasks: the
 * `from` of each `work` entry `workerTaskEntry` builds, and nothing else. A
 * `work` entry gated by another binding (a feature board's door, say) refuses
 * every conversation task at its claim gate, where nothing can record the
 * refusal on the conversation's row (FIX-1842), so the delegate check asks
 * for this mark instead of whether the entry exists. A registered symbol, so
 * two installed copies of this package read each other's mark.
 */
const CONVERSATION_TASK_DOOR = Symbol.for("@flow-state-dev/workforce/conversation-task-door");

/** Mark `binding` as one that takes a conversation's tasks. Returns it. */
export function markConversationTaskDoor<T extends object>(binding: T): T {
  Object.defineProperty(binding, CONVERSATION_TASK_DOOR, { value: true });
  return binding;
}

/**
 * Whether a worker flow's `work` task entry takes a conversation's tasks:
 * it is declared, and its `from` is a binding {@link markConversationTaskDoor}
 * marked.
 */
export function takesConversationTasks(flow: unknown): boolean {
  const actions = (flow as { task?: { actions?: Record<string, unknown> } } | undefined)?.task?.actions;
  if (actions === undefined || !Object.hasOwn(actions, WORKER_TASK_ENTRY)) return false;
  const from = (actions[WORKER_TASK_ENTRY] as { from?: unknown } | undefined)?.from;
  return typeof from === "object" && from !== null && (from as Record<symbol, unknown>)[CONVERSATION_TASK_DOOR] === true;
}
