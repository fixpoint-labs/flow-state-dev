/**
 * A custom block, declared by living in `workforce/blocks/`.
 *
 * Nothing registers it. `fsdev gen` walks this folder, and the basename is the
 * name it registers under — the name a task board would assign by. The block's
 * own `name` is a separate job (trace identity), so the two are allowed to
 * differ and this one keeps them the same for readability.
 *
 * It reads the seat's settings off `ctx.flow.config`, which is what makes it
 * useful as a demonstration: the answer names the desk this particular seat was
 * configured with, so two seats on one kind produce visibly different answers.
 *
 * It returns and says nothing else. The block is reachable two ways — as the
 * `desk-clerk` kind's `answer` action, and as a tool a seat names in its
 * `WORKER.md` — and only the first of those wants a user-facing utterance. A
 * seat calling it as a tool already has its own answer to give, so a message
 * emitted from in here would publish the model's tool argument as a second,
 * client- and history-visible turn nobody asked for. The utterance therefore
 * belongs to the action that wants it, and lives in
 * `flows/workers/desk-clerk.ts`.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

/** What a caller sends the desk. */
export const deskNoteInput = z.object({ note: z.string() });

/** What comes back: the note, plus which seat answered and how it was configured. */
export const deskNoteOutput = z.object({
  answered: z.string(),
  desk: z.string(),
  instructions: z.string(),
});

export default handler({
  name: "desk-note",
  description: "Answers a note from the desk the seat was configured with.",
  inputSchema: deskNoteInput,
  outputSchema: deskNoteOutput,
  execute: (input, ctx) => {
    const config = ctx.flow.config as { desk?: string; instructions?: string };
    return {
      answered: input.note,
      // `unassigned` on a kind that declares no desk — this block is reachable
      // both as a flow action and as a seat's tool, and only one of those
      // kinds has the setting.
      desk: config.desk ?? "unassigned",
      instructions: config.instructions ?? "",
    };
  },
});
