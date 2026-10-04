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
 * assistant item of its own ({@link heardLine}), refuses a line that asks to
 * be refused, or stops on a stock approval for a line that asks for one, the
 * way a chief of staff's gated change does, so a test can see each. Built
 * with `projects`, a line `start project <id>` also creates that project
 * through the project writes' own `createProject`, the way a chief of staff's
 * tool does, so the turn writes the organization's `projects` collection.
 *
 * No model anywhere: the ask is the point, not what the seat would do.
 */
import { defineFlow, handler, sequencer, SuspensionRejectedError } from "@flow-state-dev/core";
import { defineProjectBlocks, workerConfigSchema } from "@flow-state-dev/workforce";
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

/** The line a test sends to have the seat stop on a person's approval before it answers. */
export const ASKER_GATED_LINE = "ask me first";

/** The line that starts project `<id>`, on a kind built with `projects`. */
export const startProjectLine = (id: string) => `start project ${id}`;
const START_PROJECT = /^start project (\S+)$/;

/** What the seat says when it hears `message`. */
export const heardLine = (message: string) => `Heard: ${message}`;

const hear = handler({
  name: "asker-hear",
  inputSchema: messageSchema,
  outputSchema: z.object({ heard: z.string() }),
  execute: async (input, ctx) => {
    if (input.message === ASKER_REFUSED_LINE) throw new Error("This seat won't take that line.");
    if (input.message === ASKER_GATED_LINE) await ctx.suspend!({ reason: "human_approval", message: `Approve: ${input.message}` });
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

/** `hear`, then, for a {@link startProjectLine}, `createProject` with that id. */
function hearAndStartProjects() {
  const { createProject } = defineProjectBlocks();
  const toProject = handler({
    name: "asker-to-project",
    inputSchema: z.object({ heard: z.string() }),
    outputSchema: z.object({ id: z.string(), title: z.string() }),
    execute: (input) => {
      const id = START_PROJECT.exec(input.heard)![1]!;
      return { id, title: `Project ${id}` };
    },
  });
  return sequencer({ name: "asker-hear-and-start", inputSchema: messageSchema })
    .step(hear)
    .stepIf((out: { heard: string }) => START_PROJECT.test(out.heard), sequencer({ name: "asker-start-project", inputSchema: z.object({ heard: z.string() }) }).step(toProject).step(createProject as never));
}

const onMailboxPost = sequencer({ name: "asker-on-post", inputSchema: postSchema }).step(fromPost).step(gate);
const ask = sequencer({ name: "asker-ask", inputSchema: askSchema }).step(gate);

/**
 * Build the kind `hireWorkforce` mints one copy of per `asker` record.
 *
 * @param resources The tree's declared documents, as `resourcesFromDocs`
 *   built them, so a document that opts in to browser reads is served.
 * @param options.projects Let the `message` door start projects ({@link startProjectLine}).
 */
export function defineAskerFlow(resources: Record<string, unknown> = {}, options: { projects?: boolean } = {}) {
  return defineFlow({
    kind: ASKER_KIND,
    resources,
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    actions: {
      ask: { block: ask, durable: true, description: "Ask a person to approve something." },
      message: {
        block: options.projects === true ? hearAndStartProjects() : hear,
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
