/**
 * The worker instructions view: one worker's core instructions and the
 * caller's additional instructions, answered at user scope with no session,
 * for the form that edits them. A standard worker's core instructions are its
 * file's (`fixed`); the additions are the caller's own, read from their copy.
 *
 * The client reads it through `WorkforceClient.instructions`.
 */
import { defineView, handler, type ViewDefinition } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z } from "zod";
import type { WorkerInstallation } from "./installation";
import { WORKERS_RESOURCE } from "./keys";
import { instructionsOf } from "./worker-instructions";
import { parseWorkerResourceState } from "./worker-row";

const inputSchema = z.object({ id: z.string().min(1) }).strict();

const outputSchema = z.object({
  instructions: z.string().nullable(),
  additionalInstructions: z.string().nullable(),
  fixed: z.boolean()
});

/** The worker instructions view, as {@link defineWorkerInstructionsView} builds it. Import as a type in client code. */
export type WorkerInstructionsView = ViewDefinition<BlockDefinition<typeof inputSchema, typeof outputSchema>, "user">;

/** The view over `installation`. The roster flow installs it in its `views`. */
export function defineWorkerInstructionsView(installation: WorkerInstallation): WorkerInstructionsView {
  return defineView({
    scope: "user",
    block: handler({
      name: "workforce-worker-instructions",
      inputSchema,
      outputSchema,
      resources: { [WORKERS_RESOURCE]: installation.resources[WORKERS_RESOURCE] },
      execute: async (input, ctx) => {
        const file = installation.standardWorker(input.id);
        const stored = await ctx.resources[WORKERS_RESOURCE].getOptional(input.id);
        if (stored === undefined && file === undefined) throw new Error(`No worker "${input.id}" on your roster.`);
        const parsed = stored === undefined ? undefined : parseWorkerResourceState(stored.state);
        if (parsed !== undefined && "problem" in parsed) throw new Error(`Worker "${input.id}" can't be read: ${parsed.problem}.`);
        return instructionsOf(parsed?.worker, file);
      }
    })
  }) as WorkerInstructionsView;
}
