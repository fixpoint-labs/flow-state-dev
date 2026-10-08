/**
 * The fixture's one custom worker flow: a desk clerk whose `answer` action
 * tags a note with the desk the worker's own `WORKER.md` sets.
 *
 * Nothing registers it. `fsdev gen` walks this folder and puts it on the
 * `kinds` map of `workforce.gen.ts` under its basename, `desk-clerk`, the name
 * both workers' files give in their `flow:` line. The goal check hands that map
 * to the installation and never imports this module.
 *
 * A `workerFlow(...)` builder, because the flow is built on the installation
 * that runs its workers (its session names the worker, and the flow's
 * `request.onStarted` loads it), and a module in its own file has no
 * installation to import.
 *
 * Model-free on purpose: the check grades which worker's settings reached the
 * answer, and a model would only add a way to fail that has nothing to do
 * with that.
 */
import { defineFlow, handler, type BlockContext } from "@flow-state-dev/core";
import { workerConfigOf, workerConfigSchema, workerFlow } from "@flow-state-dev/workforce";
import { z } from "zod";
import { workerDoor } from "../../../../../../lib/worker-door.mts";

/** The worker contract plus this flow's own key, which a `WORKER.md` sets at its top level. */
const settings = workerConfigSchema().extend({
  desk: z.string().default("front"),
});

const answer = handler({
  name: "desk-clerk-answer",
  inputSchema: z.object({ note: z.string().min(1) }),
  outputSchema: z.object({ said: z.string() }),
  execute: (input: { note: string }, ctx: BlockContext) => {
    const { desk } = workerConfigOf(ctx) as z.infer<typeof settings>;
    return { said: `[${desk} desk] ${input.note}` };
  },
});

export default workerFlow((installation) =>
  defineFlow({
    kind: "desk-clerk",
    cardinality: "collection",
    configSchema: settings,
    session: installation.session(),
    resources: { ...installation.resources },
    request: {
      onStarted: handler({
        name: "desk-clerk-load-worker",
        inputSchema: z.unknown(),
        resources: { ...installation.resources },
        execute: async (_input: unknown, ctx: BlockContext) => ({
          worker: (await installation.resolveWorker(ctx, "desk-clerk")).id,
        }),
      }),
    },
    actions: { ...workerDoor, answer: { block: answer } },
  } as never),
);
