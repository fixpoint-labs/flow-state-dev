/**
 * The ask-lab's one worker kind: a seat that asks a person before it does
 * anything.
 *
 * Two doors, both durable, both ending in the framework's stock
 * `human_approval` suspension:
 *
 * - `onMailboxPost` — the internal entry `wakeMemberSeats` dispatches a
 *   mailbox's post to, with `session: { key }`. So an ask raised here lives in
 *   a dispatch-run session, which is what Shift Manager's listing has to ask for.
 * - `ask` — a public action a test calls directly, for a seat that sits in no
 *   mailbox.
 *
 * And a door, `message`: a person's line into the seat's session, which the
 * engine writes as a user item before the block runs. It says it heard, as an
 * assistant item of its own ({@link heardLine}), or refuses a line that asks to
 * be refused, so a test can see both.
 *
 * No model anywhere: the ask is the point, not what the seat would do.
 */
import { defineFlow, handler, sequencer, SuspensionRejectedError } from "@flow-state-dev/core";
import { workerConfigSchema } from "@flow-state-dev/workforce";
import { z } from "zod";

/** The kind a `WORKER.md` names in its `flow:` line. */
export const ASKER_KIND = "asker";

const postSchema = z
  .object({ member: z.string(), mailboxId: z.string(), body: z.string() })
  .passthrough();

const askSchema = z.object({ what: z.string().min(1) });

const decisionSchema = z.object({ what: z.string(), approved: z.boolean() });

const messageSchema = z.object({ message: z.string() });

/** The line a test sends to be refused. */
export const ASKER_REFUSED_LINE = "refuse me";

/** What the seat says when it hears `message`. */
export const heardLine = (message: string) => `Heard: ${message}`;

const hear = handler({
  name: "asker-hear",
  inputSchema: messageSchema,
  outputSchema: z.object({ heard: z.string() }),
  execute: (input, ctx) => {
    if (input.message === ASKER_REFUSED_LINE) throw new Error("This seat won't take that line.");
    ctx.emit.message(heardLine(input.message));
    return { heard: input.message };
  },
});

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

const onMailboxPost = sequencer({ name: "asker-on-post", inputSchema: postSchema }).step(fromPost).step(gate);
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
      message: {
        block: hear,
        inputSchema: messageSchema,
        userMessage: (input: { message: string }) => input.message,
        description: "A person's line into this seat's session.",
      },
    },
    internal: {
      actions: {
        onMailboxPost: { block: onMailboxPost, durable: true },
      },
    },
  } as never);
}
