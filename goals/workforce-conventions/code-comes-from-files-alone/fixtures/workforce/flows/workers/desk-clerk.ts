/**
 * The fixture's one custom worker kind: a desk clerk whose `answer` action
 * tags a note with the desk the seat's own `WORKER.md` sets.
 *
 * Nothing registers it. `fsdev gen` walks this folder and puts it on the
 * `kinds` map of `workforce.gen.ts` under its basename, `desk-clerk`, the name
 * both seats' files give in their `flow:` line. The goal check hires from that
 * map and never imports this module.
 *
 * Model-free on purpose: the check grades which seat's settings reached the
 * answer, and a model would only add a way to fail that has nothing to do
 * with that.
 */
import { defineFlow, handler, type BlockContext } from "@flow-state-dev/core";
import { workerConfigSchema } from "@flow-state-dev/workforce";
import { z } from "zod";

/** The seat contract plus this kind's own key, which a `WORKER.md` sets at its top level. */
const settings = workerConfigSchema().extend({
  desk: z.string().default("front"),
});

const answer = handler({
  name: "desk-clerk-answer",
  inputSchema: z.object({ note: z.string().min(1) }),
  outputSchema: z.object({ said: z.string() }),
  execute: (input: { note: string }, ctx: BlockContext) => {
    const { desk } = ctx.flow.config as z.infer<typeof settings>;
    return { said: `[${desk} desk] ${input.note}` };
  },
});

export default defineFlow({
  kind: "desk-clerk",
  cardinality: "collection",
  configSchema: settings,
  actions: { answer: { block: answer } },
} as never);
