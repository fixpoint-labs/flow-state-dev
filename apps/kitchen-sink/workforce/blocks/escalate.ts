/**
 * `escalate`: a specialist files a case that needs a person onto
 * `support.help`'s `escalations` board, through that mailbox's own `fileTask`.
 *
 * Declared by living in `workforce/blocks/`: `fsdev gen` puts it on the
 * generated `blocks` map under its basename, and the `agent` kind carries that
 * map as its tool catalog. A seat reaches it only by naming `escalate` in its
 * `tools:`, as each specialist's `WORKER.md` does.
 *
 * The model writes only the case. The mailbox and the board are named here,
 * and the author is the seat's own `seatId`, which the hire writes into every
 * seat's settings, so no model can file as another seat or onto another board.
 *
 * The dispatch is fire-and-forget: the row is written when the mailbox runs
 * `fileTask`, a moment after the tool returns, so the tool never sees the
 * mailbox's answer. The one refusal it could predict, it checks first: the
 * mailbox files only its members' cases, so a seat that is not one (an
 * operator can hire any seat with this tool) gets `filed: false` and sends
 * nothing, rather than a `filed: true` the mailbox would then refuse. Nothing
 * drains `escalations` in this app, and the boot says so.
 */
import { DispatchRefusedError, dispatcher, handler, sequencer, type BlockContext } from "@flow-state-dev/core";
import { MAILBOX_KIND } from "@flow-state-dev/workforce";
import { z } from "zod";

/** The mailbox a case is filed in. */
export const ESCALATION_MAILBOX = "support.help";

/** The board on that mailbox a case is filed onto. */
export const ESCALATION_BOARD = "escalations";

/**
 * The seats the mailbox files for: its `members:`, as `support.help`'s
 * `MAILBOX.md` declares them. Written down because the mailbox's own list lives
 * in its session, which a seat's tool cannot read; `test/escalate.test.ts`
 * holds this to the file.
 */
export const ESCALATION_MEMBERS: readonly string[] = [
  "support.devices",
  "support.accounts",
  "support.fsd",
  "support.general",
];

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
 * mailbox's session: a dispatcher that hands work to an external queue refuses
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
        "cannot deliver into the support mailbox. Nothing was filed; tell the person so.",
    };
  },
});

/** The dispatch into the mailbox's own `fileTask`, signed as the seat. */
const fileIntoMailbox = dispatcher({
  name: "escalate-file",
  flowKind: MAILBOX_KIND,
  action: "fileTask",
  inputSchema: escalateInput,
  session: { id: () => ESCALATION_MAILBOX },
  payload: (input, ctx: BlockContext) => ({
    board: ESCALATION_BOARD,
    goal: input.case,
    author: (ctx.flow.config as { seatId?: string }).seatId,
  }),
});

/** The calling seat's id, which the hire writes into every seat's settings. */
const seatIdOf = (ctx: BlockContext): string | undefined => (ctx.flow.config as { seatId?: string }).seatId;

/** Whether the calling seat is one the mailbox files for. */
const isMember = (ctx: BlockContext): boolean => ESCALATION_MEMBERS.includes(seatIdOf(ctx) ?? "");

/** A member's case: into the mailbox's `fileTask`. */
const fileAsMember = sequencer({ name: "escalate-member", inputSchema: escalateInput })
  .step(fileIntoMailbox)
  .map(() => ({ filed: true as const }))
  .rescue([{ block: filingUnavailable }]);

/** Any other seat's: nothing is sent, and the model is told why. */
const notAMember = handler({
  name: "escalate-not-a-member",
  inputSchema: escalateInput,
  outputSchema: z.object({ filed: z.literal(false), reason: z.string() }),
  execute: () => ({
    filed: false as const,
    reason:
      `Only the members of ${ESCALATION_MAILBOX} can file on its ${ESCALATION_BOARD} board, and this ` +
      "seat is not one. Nothing was filed; tell the person so.",
  }),
});

export default sequencer({
  name: "escalate",
  description: ESCALATE_DESCRIPTION,
  inputSchema: escalateInput,
}).branch({
  member: [(input: z.infer<typeof escalateInput>) => input, (_input, ctx) => isMember(ctx as BlockContext), fileAsMember],
  outsider: [(input: z.infer<typeof escalateInput>) => input, (_input, ctx) => !isMember(ctx as BlockContext), notAMember],
});
