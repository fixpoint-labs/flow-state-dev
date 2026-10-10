/**
 * The entries every worker kind takes work through: tasks, and delegated
 * posts. A leaf module, so a kind that declares an entry and the lookup that
 * checks for it share the name without either importing the other.
 */

/**
 * The task entry every worker kind takes tasks through. **Pinned**: a list's
 * fallback hands over to it, and so does the wake.
 */
export const WORKER_TASK_ENTRY = "work";

/**
 * The internal entry a worker flow declares to take a delegated post. A
 * worker whose flow declares it can be a delegate that takes posts.
 */
export const DELEGATED_POST_ENTRY = "onDelegatedPost";

/**
 * The task-ledger bindings that take a conversation's tasks: the `from` of
 * each `work` entry `workerTaskEntry` builds, and nothing else. A `work`
 * entry gated by another binding (a feature board's door, say) refuses every
 * conversation task at its claim gate, where nothing can record the refusal
 * on the conversation's row (FIX-1842), so the delegate check asks this
 * instead of whether the entry exists.
 */
const conversationTaskDoors = new WeakSet<object>();

/** Mark `binding` as one that takes a conversation's tasks. Returns it. */
export function markConversationTaskDoor<T extends object>(binding: T): T {
  conversationTaskDoors.add(binding);
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
  return typeof from === "object" && from !== null && conversationTaskDoors.has(from);
}
