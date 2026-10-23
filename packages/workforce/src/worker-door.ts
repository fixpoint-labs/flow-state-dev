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
 */
import type { FlowInstance } from "@flow-state-dev/core";

/** The door's name: the public action a user's message arrives on, on every worker flow. */
export const RESPOND_ACTION = "respond";

/** What the hire found for one worker. */
export type WorkerDoor = {
  /** `respond` when the worker flow's door is in order, or `null` when it isn't. */
  door: string | null;
  /** Set when the door isn't in order: what to fix. */
  problem?: string;
};

/** The probe input a door must accept. */
const PROBE = { message: "probe" };

type ActionLike = {
  block?: { inputSchema?: { safeParse?: (value: unknown) => { success: boolean } } };
  inputSchema?: { safeParse?: (value: unknown) => { success: boolean } };
  userMessage?: unknown;
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

/**
 * The door of a hired worker, read off its flow's public actions.
 *
 * @param worker A worker `hireWorkforce` returned (or any registered flow).
 * @returns `respond`, or `null` with the problem when the flow's door isn't in order.
 */
export function workerDoorOf(worker: Pick<FlowInstance, "id" | "kind"> & { actions: Readonly<Record<string, unknown>> }): WorkerDoor {
  const problem = doorProblem(worker.kind, worker.actions);
  return problem === undefined ? { door: RESPOND_ACTION } : { door: null, problem };
}
