/**
 * A block that belongs to one seat, declared by living in that worker's own
 * `blocks/` folder.
 *
 * `fsdev gen` walks this folder and registers the basename for this seat and no
 * other. Registering is not the same as granting: the seat still names
 * `desk-summary` in its `WORKER.md` `tools:` list, and a seat that does not
 * name it cannot call it even though the file is sitting right there.
 *
 * Needs nothing from the kind. A block here may READ a store the kind
 * installed, and may not declare one of its own — a seat's folder is one
 * seat's, and a store belongs to every seat of the kind.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

/** What a caller asks for: nothing. The summary is the same shape every time. */
export const deskSummaryInput = z.object({});

/** A one-line read of how the desk is doing. */
export const deskSummaryOutput = z.object({ summary: z.string() });

export default handler({
  name: "desk-summary",
  description: "Summarises how the support desk is running this week.",
  inputSchema: deskSummaryInput,
  outputSchema: deskSummaryOutput,
  execute: () => ({ summary: "Steady week: nothing escalated past the front desk." }),
});
