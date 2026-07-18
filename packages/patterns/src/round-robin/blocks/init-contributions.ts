/**
 * Tap that resets the contributions resource at the start of a run and
 * primes the per-run TaskCollection. Runs once before the round loop.
 */
import { handler } from "@flow-state-dev/core";
import type { BlockContext, DefinedResource } from "@flow-state-dev/core/types";
import { getOrCreateTaskCollection } from "@flow-state-dev/orchestration";
import { roundRobinInputSchema } from "../schemas";

/**
 * Build the init tap. `contributions` is the session resource holding
 * `entries`; `collectionId` is the stable id used by every record-tap
 * in the round executor so all turns land in the same collection.
 */
export function createInitContributions(opts: {
  name: string;
  contributions: DefinedResource;
  collectionId: string;
  /** Accessor key used in the block's `resources:` map. Defaults to
   *  `"contributions"`. Set to a unique key when multiple `roundRobin()`
   *  instances coexist in the same sequencer chain to avoid the
   *  build-time accessor-key conflict. */
  accessorKey?: string;
}) {
  const accessor = opts.accessorKey ?? "contributions";
  return handler({
    name: `${opts.name}-init`,
    inputSchema: roundRobinInputSchema,
    resources: { [accessor]: opts.contributions },
    execute: async (_input, ctx) => {
      // TODO: computed-key resource accessor — see round-robin follow-up
      await (ctx.resources as any)[accessor].setState({
        entries: [],
      });
      // Materialize the collection so its `tasks` slot exists in
      // sequencer state from turn one.
      getOrCreateTaskCollection({
        ctx: ctx as unknown as BlockContext,
        backing: "sequencer",
        collectionId: opts.collectionId,
        sequencer: ctx.sequencer!,
      });
    },
  });
}
