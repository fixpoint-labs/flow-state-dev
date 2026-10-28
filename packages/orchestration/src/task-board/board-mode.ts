/**
 * A board's mode (FIX-2076): whether its drain waits on its rows.
 *
 * The author declares it on `taskBoard({ mode })`, and the board is refused at
 * construction when its assignees contradict it. Nothing infers it from the
 * assignees any more: a board that dispatches says so, and `goalSeekLoop` reads
 * the answer off the handle instead of guessing.
 *
 * | mode            | rows run                                | the drain waits on |
 * |-----------------|-----------------------------------------|--------------------|
 * | `"plan"`        | in the drain, or handed to a session and waited on (FIX-2082) | every row |
 * | `"delegation"`  | in another session                      | no row             |
 *
 * The one test the drain's readers share ({@link runsElsewhereFor}) is the
 * mode's: a delegation board excuses every running row while its lease holds,
 * and a plan board excuses none. The lease conjunct stays with the readers
 * (`isDispatched` in `./shared`).
 */
import type { Task } from "../tasks";
import type { DispatchingAssignee } from "./dispatch-assignee";

/**
 * `"plan"` (the default): every row runs in the drain, which waits on every
 * one. `"delegation"`: every row is handed to another session, and the drain
 * never waits on one.
 */
export type TaskBoardMode = "plan" | "delegation";

/**
 * The drain's "this row's work runs in another session" test for a board of
 * `mode`, or `undefined` for a plan board, which excuses no row.
 */
export function runsElsewhereFor(mode: TaskBoardMode): ((task: Task) => boolean) | undefined {
  return mode === "delegation" ? () => true : undefined;
}

/**
 * The mode's construction-time refusals, by name and loud.
 *
 * - A plan board holding a dispatcher that says `wait: false`: its drain waits
 *   on every row, the ones it hands over included (FIX-2082).
 * - A delegation board holding a dispatcher that says `wait: true`: its drain
 *   waits on none (FIX-2082).
 * - A delegation board with an assignee that runs in the drain (named, uniform
 *   or floor): the drain would not wait on work running in it.
 * - A delegation board with no dispatcher: nothing on it is dispatched.
 *
 * @param inline The named assignees that run in the drain.
 * @param uniformInline Whether `workers` is one block that runs in the drain.
 * @param floorInline Whether `defaultWorker` is a block that runs in the drain.
 * @throws {Error} naming the board, the setting, and the fix.
 */
export function assertBoardModeSupported(options: {
  name: string;
  mode: TaskBoardMode;
  dispatchers: readonly DispatchingAssignee[];
  inline: readonly string[];
  uniformInline: boolean;
  floorInline: boolean;
}): void {
  const { name, mode, dispatchers, inline, uniformInline, floorInline } = options;
  // A dispatcher's own `wait` against the mode: unset follows it.
  const against = dispatchers.filter((assignee) => assignee.dispatch.wait === (mode === "plan" ? false : true));
  if (against.length > 0) {
    const declared = against.map((assignee) => assignee.label).join(", ");
    throw new Error(
      mode === "plan"
        ? `[task-board] "${name}" is a plan board, the default, and its dispatcher at ${declared} says ` +
            `\`wait: false\`: a plan board's drain waits on every row, the ones it hands to another ` +
            `session included. Drop \`wait\`, or declare \`mode: "delegation"\` for a board that ` +
            `hands rows off and waits on none.`
        : `[task-board] "${name}" is a delegation board, and its dispatcher at ${declared} says ` +
            `\`wait: true\`: a delegation board's drain waits on no row. Drop \`wait\`, or drop ` +
            `\`mode\` for a plan board, whose drain waits on every row it hands over.`
    );
  }
  if (mode === "plan") return;
  const inlineAt = [
    ...inline.map((assignee) => `assignee:${assignee}`),
    ...(uniformInline ? ["uniform"] : []),
    ...(floorInline ? ["floor"] : []),
  ];
  if (inlineAt.length > 0) {
    throw new Error(
      `[task-board] "${name}" is a delegation board, and ${inlineAt.join(", ")} runs in the drain: ` +
        `a delegation board hands every row to another session and its drain waits on none, so ` +
        `work running in it would be left behind. Put a \`dispatcher({ action, session })\` there, ` +
        `or move the inline work to a plan board (drop \`mode\`).`
    );
  }
  if (dispatchers.length === 0) {
    throw new Error(
      `[task-board] "${name}" is a delegation board with no dispatcher, so it hands nothing to ` +
        `another session. Give an assignee a \`dispatcher({ action, session })\`, or drop \`mode\` ` +
        `for a plan board, whose drain runs and waits on its rows.`
    );
  }
}
