/**
 * The goal check's echo control for the desk clerk (`GOAL_CONTROL=echo`).
 *
 * Swaps the clerk's `answer` back to the note handed back under the desk tag,
 * with no model, no filing and no kept turn: what the clerk did before it
 * answered with a model. The goal
 * `goals/kitchen-sink-talk/answers-a-clerk-note-or-files-it` must FAIL both of
 * its legs under it.
 *
 * Honoured only under `KITCHEN_SINK_TEST_MODE=1`, so a control can never reach
 * a deployed build. A test seam like `mock-flowstate.ts`, not product code.
 */
import { sequencer } from "@flow-state-dev/core";

import deskNote, { deskNoteInput, deskNoteOutput } from "../workforce/blocks/desk-note";

/** The echo `answer` action when the control is on; `undefined` otherwise. */
export function deskClerkEchoControl() {
  if (process.env.KITCHEN_SINK_TEST_MODE !== "1" || process.env.GOAL_CONTROL !== "echo") return undefined;
  const echo = sequencer({ name: "desk-clerk-echo", inputSchema: deskNoteInput, outputSchema: deskNoteOutput })
    .step(deskNote)
    .tap((said, ctx) => {
      ctx.emit.message(`[${said.desk} desk] ${said.answered}`);
    });
  return { inputSchema: deskNoteInput, block: echo };
}
