/**
 * The ask-lab's one worker kind: a seat that asks a person before it does
 * anything.
 *
 * Two doors, both durable, both ending in the framework's stock
 * `human_approval` suspension:
 *
 * - `onChannelPost` — the internal entry `wakeMemberSeats` dispatches a
 *   channel's post to, with `session: { key }`. So an ask raised here lives in
 *   a dispatch-run session, which is what App Lab's listing has to ask for.
 * - `ask` — a public action a test calls directly, for a seat that sits in no
 *   channel.
 *
 * No model anywhere: the ask is the point, not what the seat would do.
 */
import { defineFlow, handler, sequencer, SuspensionRejectedError } from "@flow-state-dev/core";
import { workerConfigSchema } from "@flow-state-dev/workforce";
import { z } from "zod";

/** The kind a `WORKER.md` names in its `flow:` line. */
export const ASKER_KIND = "asker";

const postSchema = z
  .object({ member: z.string(), channelId: z.string(), body: z.string() })
  .passthrough();

const askSchema = z.object({ what: z.string().min(1) });

const decisionSchema = z.object({ what: z.string(), approved: z.boolean() });

/** Suspend on a stock approval naming `what`; answer whether it was approved. */
const gate = handler({
  name: "asker-gate",
  inputSchema: askSchema,
  outputSchema: decisionSchema,
  execute: async (input, ctx) => {
    try {
      await ctx.suspend!({ reason: "human_approval", message: `Approve: ${input.what}` });
      return { what: input.what, approved: true };
    } catch (error) {
      if (error instanceof SuspensionRejectedError) return { what: input.what, approved: false };
      throw error;
    }
  },
});

const fromPost = handler({
  name: "asker-from-post",
  inputSchema: postSchema,
  outputSchema: askSchema,
  execute: (input) => ({ what: input.body }),
});

const onChannelPost = sequencer({ name: "asker-on-post", inputSchema: postSchema }).step(fromPost).step(gate);
const ask = sequencer({ name: "asker-ask", inputSchema: askSchema }).step(gate);

/**
 * Build the kind `hireWorkforce` mints one copy of per `asker` record.
 *
 * @param resources The tree's declared documents, as `resourcesFromDocs`
 *   built them, so a document that opts in to browser reads is served.
 */
export function defineAskerFlow(resources: Record<string, unknown> = {}) {
  return defineFlow({
    kind: ASKER_KIND,
    resources,
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    actions: {
      ask: { block: ask, durable: true, description: "Ask a person to approve something." },
    },
    internal: {
      actions: {
        onChannelPost: { block: onChannelPost, durable: true },
      },
    },
  } as never);
}
