/**
 * A custom worker kind: a desk clerk. Its `answer` action asks a model to
 * answer a note, under the seat's own instructions, and gives the model one
 * tool, which files the note onto one of `support.desk`'s boards through that
 * channel's own `fileTask`. The reply is tagged with the desk the seat's
 * `WORKER.md` sets; the rest is the model's. The kind declares no board, so
 * filing onto `escalations` does not attend it: nothing drains that board here.
 *
 * Nothing registers it. `fsdev gen` walks this folder and puts it on the
 * `kinds` map under its basename, `desk-clerk`, which is the name a
 * `WORKER.md` names in its `flow:` line. The flow's own `kind` has to agree
 * with that basename — `hireWorkforce` refuses the seat by name when it does
 * not.
 *
 * `cardinality: "collection"` is what a worker kind needs: a seat mints its own
 * copy under its own id, and a singleton's id has to equal its kind, so a
 * worker kind left at the default would be refused at admission.
 *
 * The settings schema composes the seat contract and then adds this kind's own
 * key. Composing it is what admits the seat's skills and its instructions; a
 * kind that declared only its own keys would be handed a bag it has not
 * declared and refused at the mint.
 */
import {
  DispatchRefusedError,
  defineFlow,
  dispatcher,
  generator,
  handler,
  sequencer,
  type BlockContext,
} from "@flow-state-dev/core";
import { CHANNEL_KIND, workerConfigSchema } from "@flow-state-dev/workforce";
import { z } from "zod";

import { deskNoteInput } from "../../blocks/desk-note";
import { deskClerkEchoControl } from "../../../lib/desk-clerk-echo-control";

/**
 * `desk` is this kind's own setting and sits at the top level of a worker
 * file, where the framework closes it: a seat declaring a key this schema
 * does not know is refused by name.
 */
const settings = workerConfigSchema().extend({
  desk: z.string().default("front"),
});

type ClerkSettings = z.infer<typeof settings>;

/** The seat's settings, from a block whose context does not type them. */
const settingsOf = (ctx: BlockContext): ClerkSettings => ctx.flow.config as ClerkSettings;

/** The channel the clerk files into, named in code the way `followup-runner` names its board. */
const DESK_CHANNEL = "support.desk";

/** The worker a `followups` row is filed for: `support.wren`'s drain runs rows assigned to it. */
const FOLLOWUP_WORKER = "followup-runner";

/** The dispatch refusal an error carries, directly or as its cause. */
function refusalIn(error: unknown): DispatchRefusedError | undefined {
  for (let current = error; current instanceof Error; current = current.cause) {
    if (current instanceof DispatchRefusedError) return current;
  }
  return undefined;
}

/**
 * What the tool hands the model when the deployment cannot deliver into the
 * channel's session: a dispatcher that hands work to an external queue refuses
 * a delivery into an existing session, so there is nowhere to file.
 */
const filingUnavailable = handler({
  name: "desk-clerk-file-unavailable",
  // Whatever the dispatch threw: narrowed below, and rethrown unless it is the refusal.
  inputSchema: z.unknown(),
  outputSchema: z.object({ filed: z.literal(false), reason: z.string() }),
  execute: (error: unknown) => {
    // Only the external-dispatcher refusal is this deployment's to report. Any
    // other failure stays one.
    if (refusalIn(error)?.refused !== "external-dispatcher") throw error;
    return {
      filed: false as const,
      reason:
        "Filing is unavailable here: this deployment runs work on an external queue, which " +
        "cannot deliver into the desk channel. Nothing was filed; tell the person so.",
    };
  },
});

/** The tool's input: the only two things the model chooses. */
const fileInput = z.object({
  board: z.enum(["followups", "escalations"]),
  goal: z.string().min(1),
});

/**
 * The dispatch into the channel's own `fileTask`.
 *
 * The author is the seat's own `seatId`, which the hire writes into every
 * seat's settings, so a model cannot sign as another seat. The dispatch is
 * fire-and-forget: its result is the request it started, and the row is
 * written when the channel runs `fileTask`.
 */
const dispatchToDesk = dispatcher({
  name: "desk-clerk-dispatch",
  flowKind: CHANNEL_KIND,
  action: "fileTask",
  inputSchema: fileInput,
  session: { id: () => DESK_CHANNEL },
  payload: (input, ctx) => ({
    board: input.board,
    goal: input.goal,
    author: settingsOf(ctx).seatId,
    ...(input.board === "followups" ? { assignee: FOLLOWUP_WORKER } : {}),
  }),
});

/**
 * The model's one tool: file the note onto one of the desk channel's boards.
 * The model chooses only the board and the goal.
 *
 * A sequencer around the dispatch so its rescue runs wherever the tool does:
 * an external-dispatcher refusal becomes a result the model can read.
 */
const fileOntoDesk = sequencer({
  name: "desk-clerk-file",
  description:
    "File this note onto a board of the support desk: followups for work a seat runs later, " +
    "escalations for work a person picks up.",
  inputSchema: fileInput,
})
  .step(dispatchToDesk)
  .rescue([{ block: filingUnavailable }]);

/**
 * The model call: the team's and the seat's instructions, then the desk's
 * rule; the note as the person's turn; one tool.
 */
const clerkModel = generator({
  name: "desk-clerk-answer",
  inputSchema: deskNoteInput,
  flowConfigSchema: settings,
  model: "intent/chat",
  prompt: [
    (_input, ctx) => ctx.flow.config.teamInstructions,
    (_input, ctx) => ctx.flow.config.instructions,
    () =>
      "Answer the note when you can. When it needs a person, file it on escalations; when it " +
      "is work a seat can run later, file it on followups. Either way, reply, and say where it went.",
  ],
  user: (input) => input.note,
  tools: [fileOntoDesk],
});

/**
 * The `answer` action: ask the model, then say what it answered under the
 * seat's desk tag.
 *
 * The tag is the kind's, read from the seat's own settings, never the model's,
 * so two seats on one kind stay visibly different whatever a model writes. A
 * model that says nothing gets the tag alone, never the note.
 */
const reply = sequencer({ name: "desk-clerk-reply", inputSchema: deskNoteInput })
  .step(clerkModel)
  .tap((said, ctx) => {
    const tag = `[${settingsOf(ctx).desk} desk]`;
    const text = typeof said === "string" ? said.trim() : "";
    ctx.emit.message(text.length > 0 ? `${tag} ${text}` : tag);
  });

export default defineFlow({
  kind: "desk-clerk",
  cardinality: "collection",
  configSchema: settings,
  actions: {
    // `userMessage` keeps the person's note as their turn, so the seat's
    // conversation holds both sides and survives a reload.
    answer: deskClerkEchoControl() ?? {
      inputSchema: deskNoteInput,
      block: reply,
      userMessage: (input: z.infer<typeof deskNoteInput>) => input.note,
    },
  },
});
