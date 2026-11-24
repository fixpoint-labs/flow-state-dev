// FIX-2083.
/**
 * The entry every worker flow takes work through: tasks, a coordinator's
 * routed messages among them. A leaf module, so a flow that
 * declares the entry and the lookup that checks for it share the name without
 * either importing the other.
 */

/**
 * The task entry every worker flow takes tasks through. **Pinned**: a list's
 * fallback hands over to it, and so does the wake.
 */
export const WORKER_TASK_ENTRY = "work";

// FIX-1842.
/**
 * The mark on a task-ledger binding that takes a conversation's tasks: the
 * `from` of each `work` entry `workerTaskEntry` builds, and nothing else. A
 * `work` entry gated by another binding (a feature board's door, say) refuses
 * every conversation task at its claim gate, where nothing can record the
 * refusal on the conversation's row, so the delegate check asks
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

// FIX-2894.
/** The mark on a `work` entry's `from` holding the flow's task-input declaration. */
const TASK_INPUT_DECLARATION = Symbol.for("@flow-state-dev/workforce/task-input-declaration");

/** Mark `binding` with the declaration of what its flow's tasks take. Returns it. */
export function markTaskInput<T extends object>(binding: T, declaration: unknown): T {
  Object.defineProperty(binding, TASK_INPUT_DECLARATION, { value: declaration });
  return binding;
}

/** The mark on a `work` entry's `from` holding the entry's name, for a refusal to name it. */
const TASK_ENTRY_NAME = Symbol.for("@flow-state-dev/workforce/task-entry-name");

/** Mark `binding` with the name its `workerTaskEntry` was given. Returns it. */
export function markTaskEntryName<T extends object>(binding: T, name: string): T {
  Object.defineProperty(binding, TASK_ENTRY_NAME, { value: name });
  return binding;
}

/** The name the `workerTaskEntry` behind `door` was given, when it was marked with one. */
export function taskEntryNameOf(door: object): string | undefined {
  const name = (door as Record<symbol, unknown>)[TASK_ENTRY_NAME];
  return typeof name === "string" ? name : undefined;
}

/** The `from` of a worker flow's `work` entry, when it takes a conversation's tasks. */
export function conversationTaskDoorOf(flow: unknown): object | undefined {
  if (!takesConversationTasks(flow)) return undefined;
  return (flow as { task: { actions: Record<string, { from: object }> } }).task.actions[WORKER_TASK_ENTRY]!.from;
}

/**
 * The declaration of what a worker flow's tasks take, read off its `work`
 * entry as {@link takesConversationTasks} reads the entry's mark: `undefined`
 * for a flow that declares none, whose tasks take any object.
 */
export function taskInputOf(flow: unknown): unknown {
  const door = conversationTaskDoorOf(flow);
  return door === undefined ? undefined : (door as Record<symbol, unknown>)[TASK_INPUT_DECLARATION];
}
