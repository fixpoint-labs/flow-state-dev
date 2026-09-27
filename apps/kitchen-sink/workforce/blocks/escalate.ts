/**
 * `escalate`: a specialist files a case that needs a person onto
 * `support.help`'s `escalations` board, through that channel's own `fileTask`.
 *
 * Declared by living in `workforce/blocks/`: `fsdev gen` puts it on the
 * generated `blocks` map under its basename, and the `agent` kind carries that
 * map as its tool catalog. A seat reaches it only by naming `escalate` in its
 * `tools:`, as each specialist's `WORKER.md` does.
 *
 * The model writes only the case. The channel and the board are named here,
 * and the author is the seat's own `seatId`, which the hire writes into every
 * seat's settings, so no model can file as another seat or onto another board.
 * The channel's own author rule still applies: a seat that is not a member of
 * `support.help` is refused there, and files nothing.
 *
 * The dispatch is fire-and-forget: the row is written when the channel runs
 * `fileTask`, a moment after the tool returns. Nothing drains `escalations` in
 * this app, and the boot says so.
 */
import { DispatchRefusedError, dispatcher, handler, sequencer, type BlockContext } from "@flow-state-dev/core";
import { CHANNEL_KIND } from "@flow-state-dev/workforce";
import { z } from "zod";

/** The channel a case is filed in. */
export const ESCALATION_CHANNEL = "support.help";

/** The board on that channel a case is filed onto. */
export const ESCALATION_BOARD = "escalations";

/** The tool's input: the case, and only the case. */
export const escalateInput = z.object({
  case: z.string().min(1).describe("What the person needs, in a sentence or two, for whoever picks it up."),
});

/**
 * What the model reads about the tool. Shared with the goal check's stand-in
 * (`lib/escalate-control.ts`), so the model is offered the same tool either way.
 */
export const ESCALATE_DESCRIPTION =
  "File this case for a person to pick up, when you cannot resolve it yourself. " +
  "Say in your answer that you filed it.";

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
  name: "escalate-unavailable",
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
        "cannot deliver into the support channel. Nothing was filed; tell the person so.",
    };
  },
});

/** The dispatch into the channel's own `fileTask`, signed as the seat. */
const fileIntoChannel = dispatcher({
  name: "escalate-file",
  flowKind: CHANNEL_KIND,
  action: "fileTask",
  inputSchema: escalateInput,
  session: { id: () => ESCALATION_CHANNEL },
  payload: (input, ctx: BlockContext) => ({
    board: ESCALATION_BOARD,
    goal: input.case,
    author: (ctx.flow.config as { seatId?: string }).seatId,
  }),
});

export default sequencer({
  name: "escalate",
  description: ESCALATE_DESCRIPTION,
  inputSchema: escalateInput,
})
  .step(fileIntoChannel)
  .map(() => ({ filed: true as const }))
  .rescue([{ block: filingUnavailable }]);
