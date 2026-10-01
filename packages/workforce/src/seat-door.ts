/**
 * A seat's door: the one public action its kind declares for a person's
 * message (FIX-1690).
 *
 * An app that wants to send a person's line into a seat's session has to know
 * which action takes it, and it must not know the seat's kind to find out. So
 * the hire answers once, from the kind's own declaration, and the answer rides
 * on the seat's inventory row as `door`.
 *
 * The door is the public action (`flow.actions`, never `internal` or `task`)
 * that both:
 *
 * - declares `userMessage`, so the engine writes the person's line into the
 *   session as a user item before the block runs; and
 * - takes `{ message: string }`, so the app builds the input without knowing
 *   the kind.
 *
 * The built-in agent kind's `run` is one. A kind with none has no door
 * (`null`), and an app says that seat takes no message rather than guessing. A
 * kind with two is a hire problem naming both, and also gets `null`: picking
 * one would be a guess about which the author meant.
 */
import type { FlowInstance } from "@flow-state-dev/core";

/** What the hire found for one seat. */
export type SeatDoor = {
  /** The action that takes a person's message, or `null` when there is none (or two). */
  door: string | null;
  /** Set when the kind declares two or more such actions. */
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
function isDoor(action: ActionLike): boolean {
  if (typeof action.userMessage !== "function") return false;
  const schema = action.inputSchema ?? action.block?.inputSchema;
  return typeof schema?.safeParse === "function" && schema.safeParse(PROBE).success;
}

/**
 * The door of a hired seat, read off its flow's public actions.
 *
 * @param seat A seat `hireWorkforce` returned (or any flow instance).
 * @returns The door's action name, `null` when the kind has none, and a
 *   problem naming both when it has two.
 */
export function seatDoorOf(seat: Pick<FlowInstance, "id" | "kind"> & { actions?: unknown }): SeatDoor {
  const actions = (seat.actions ?? {}) as Record<string, ActionLike>;
  const doors = Object.keys(actions)
    .filter((name) => isDoor(actions[name]!))
    .sort();
  if (doors.length <= 1) return { door: doors[0] ?? null };
  return {
    door: null,
    problem:
      `seat "${seat.id}" (kind "${seat.kind}") declares ${doors.length} actions that take a ` +
      `person's message (${doors.map((d) => `"${d}"`).join(", ")}), so it is published with no ` +
      `door and takes no message. Keep one: a door is the one public action with \`userMessage\` ` +
      `and a \`{ message }\` input.`,
  };
}
