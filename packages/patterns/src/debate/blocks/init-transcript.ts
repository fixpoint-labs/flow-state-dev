/**
 * Tap that resets the transcript resource at the start of a debate run
 * and primes the per-run TaskCollection so the per-(round, debater)
 * audit slot exists in sequencer state from turn one.
 */
import { handler } from "@flow-state-dev/core";
import type { BlockContext, DefinedResource } from "@flow-state-dev/core/types";
import { getOrCreateTaskCollection } from "@flow-state-dev/tasks";
import { debateInputSchema } from "../schemas";

export function createInitTranscript(opts: {
  name: string;
  transcript: DefinedResource;
  collectionId: string;
}) {
  return handler({
    name: `${opts.name}-init`,
    inputSchema: debateInputSchema,
    resources: { transcript: opts.transcript },
    execute: async (_input, ctx) => {
      await ctx.resources.transcript.setState({
        entries: [],
      } as Parameters<typeof ctx.resources.transcript.setState>[0]);
      getOrCreateTaskCollection({
        ctx: ctx as unknown as BlockContext,
        backing: "sequencer",
        collectionId: opts.collectionId,
        sequencer: ctx.sequencer!,
      });
    },
  });
}
