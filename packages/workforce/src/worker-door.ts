/**
 * A worker's door: `respond`, the public action every worker flow declares
 * for a user's message (FIX-1690).
 *
 * An app that wants to send a user's line into a worker's session sends it to
 * `respond`, on any worker, without knowing the worker's flow. The hire's
 * contract check refuses a worker flow without one, and the inventory row
 * still carries the name as `door`.
 *
 * `respond` is a door when it is a public action (`flow.actions`, never
 * `internal` or `task`) that both:
 *
 * - declares `userMessage`, so the engine writes the user's line into the
 *   session as a user item before the block runs; and
 * - takes `{ message: string }`, so the app builds the input without knowing
 *   the worker flow.
 *
 * Found by name, as every other entry a worker's roles need is. The one
 * definition of "door" in the package: the contract check reads
 * {@link doorProblem}, and the inventory {@link workerDoorOf}.
 *
 * A door may also take an optional `taskId`, the task a line is sent from,
 * through {@link doorTask}; {@link workerDoorOf} says so as `takesTask`.
 */
import type { FlowInstance } from "@flow-state-dev/core";
import { z } from "zod";

/** The door's name: the public action a user's message arrives on, on every worker flow. */
export const RESPOND_ACTION = "respond";

/** What the hire found for one worker. */
export type WorkerDoor = {
  /** `respond` when the worker flow's door is in order, or `null` when it isn't. */
  door: string | null;
  /**
   * Whether the door takes an optional `taskId` and names it as the turn's
   * task (see {@link doorTask}). `false` when the door isn't in order.
   */
  takesTask: boolean;
  /** Set when the door isn't in order: what to fix. */
  problem?: string;
};

/** The probe input a door must accept. */
const PROBE = { message: "probe" };

type SchemaLike = { safeParse?: (value: unknown) => { success: boolean; data?: unknown } };

type ActionLike = {
  block?: { inputSchema?: SchemaLike };
  inputSchema?: SchemaLike;
  userMessage?: unknown;
  taskOf?: unknown;
};

/** Whether `action` declares `userMessage` and takes `{ message }`. */
function takesUserMessage(action: ActionLike | undefined): boolean {
  if (typeof action?.userMessage !== "function") return false;
  const schema = action.inputSchema ?? action.block?.inputSchema;
  return typeof schema?.safeParse === "function" && schema.safeParse(PROBE).success;
}

const SHAPE = `a public action with \`userMessage\` and a \`{ message }\` input`;

/**
 * Why `name`'s public actions have no door in order, or `undefined` when
 * `respond` is its one door.
 *
 * @param name The worker flow's name, for the sentence.
 * @param actions The flow's public actions.
 */
export function doorProblem(name: string, actions: Readonly<Record<string, unknown>>): string | undefined {
  const entries = actions as Readonly<Record<string, ActionLike>>;
  const doors = Object.keys(entries)
    .filter((action) => takesUserMessage(entries[action]))
    .sort();
  const others = doors.filter((action) => action !== RESPOND_ACTION);
  if (doors.includes(RESPOND_ACTION) && others.length === 0) return undefined;
  if (doors.length > 1) {
    return (
      `worker flow "${name}" has ${doors.length} doors (${doors.map((d) => `"${d}"`).join(", ")}). ` +
      `Keep one, named "${RESPOND_ACTION}": ${SHAPE}.`
    );
  }
  if (others.length === 1) {
    return (
      `worker flow "${name}" takes a user's message on "${others[0]}", and every worker's door is ` +
      `"${RESPOND_ACTION}": rename "${others[0]}" to "${RESPOND_ACTION}".`
    );
  }
  if (Object.hasOwn(entries, RESPOND_ACTION)) {
    return (
      `worker flow "${name}" has a "${RESPOND_ACTION}" that takes no user's message. Make it ${SHAPE}.`
    );
  }
  return (
    `worker flow "${name}" has no door: no "${RESPOND_ACTION}", ${SHAPE}, so no worker on it could ` +
    `take a user's message. Give it one.`
  );
}

/** The optional task id a door takes: which task's screen the line was sent from. */
const taskIdSchema = z.string().min(1).optional();

/**
 * Lets a door take the task a line is sent from. Spread into the
 * `respond` action: it returns the door's input extended with an optional,
 * non-empty `taskId` (a strict input stays strict), and the matching
 * `taskOf`, so the engine stamps the id on the user's line and on every item
 * the turn emits. Together, so a door can't take the key and forget to stamp
 * it. A door that uses it does not also mark its scope with the same id.
 *
 * The id is a label for the task's view. It never routes the line: a steer
 * still picks the session's open task from server state.
 *
 * @param inputSchema The door's own input, `{ message }` at least.
 */
export function doorTask<TShape extends z.ZodRawShape, TKeys extends z.UnknownKeysParam>(
  inputSchema: z.ZodObject<TShape, TKeys>,
) {
  const extended = inputSchema.extend({ taskId: taskIdSchema });
  return {
    inputSchema: extended,
    taskOf: (input: { taskId?: string }): string | undefined => input.taskId,
  };
}

/** The probe a door that takes a task must accept, keep, and name as the turn's task. */
const TASK_PROBE = { ...PROBE, taskId: "probe-task" };

/**
 * Whether `action` takes a task id, probed the way {@link doorProblem} probes
 * `{ message }`: its input accepts and keeps `taskId` (a strict door that never
 * declared it refuses the probe, a stripping one drops it), and its `taskOf`
 * names it as the turn's task. An app sends `taskId` only to such a door.
 */
function takesTask(action: ActionLike | undefined): boolean {
  if (typeof action?.taskOf !== "function") return false;
  const schema = action.inputSchema ?? action.block?.inputSchema;
  if (typeof schema?.safeParse !== "function") return false;
  const parsed = schema.safeParse(TASK_PROBE);
  return parsed.success && (action.taskOf as (input: unknown) => unknown)(parsed.data) === TASK_PROBE.taskId;
}

/**
 * The door of a hired worker, read off its flow's public actions.
 *
 * @param worker A worker `hireWorkforce` returned (or any registered flow).
 * @returns `respond` and whether it takes a task id, or `null` with the
 *   problem when the flow's door isn't in order.
 */
export function workerDoorOf(worker: Pick<FlowInstance, "id" | "kind"> & { actions: Readonly<Record<string, unknown>> }): WorkerDoor {
  const problem = doorProblem(worker.kind, worker.actions);
  if (problem !== undefined) return { door: null, takesTask: false, problem };
  const respond = (worker.actions as Readonly<Record<string, ActionLike>>)[RESPOND_ACTION];
  return { door: RESPOND_ACTION, takesTask: takesTask(respond) };
}
