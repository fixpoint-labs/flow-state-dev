/**
 * The ask-lab's one worker kind: a seat that asks a person before it does
 * anything.
 *
 * Two doors, both durable, both ending in the framework's stock
 * `human_approval` suspension:
 *
 * - `onDelegatedPost` — the internal entry a coordinator delivers a post to
 *   (Workforce's `delegatedPostEntry`), into a session of the delegate's own
 *   that the coordinator's dispatch opens. So an ask raised here lives in a
 *   dispatch-run session, which is what Shift Manager's listing has to ask
 *   for. Its answer, once a person decides, goes back to the coordinator.
 * - `ask` — a public action a test calls directly, in a session a person
 *   opened.
 *
 * And a door, `message`: a person's line into the seat's session, which the
 * engine writes as a user item before the block runs. It says it heard, as an
 * assistant item of its own ({@link heardLine}), refuses a line that asks to
 * be refused, takes its time over a line that asks it to, or stops on a stock approval for a line that asks for one, the
 * way a chief of staff's gated change does, so a test can see each. Built
 * with `projects`, a line `start project <id>` also creates that project
 * through the project writes' own `createProject`, the way a chief of staff's
 * tool does, so the turn writes the organization's `projects` collection.
 *
 * Built with `inventory`, the kind also declares the organization's inventory
 * collections for a browser to read, so a person who holds only a worker's
 * session still finds the inventory.
 *
 * No model anywhere: the ask is the point, not what the seat would do.
 */
import { defineFlow, handler, sequencer, SuspensionRejectedError } from "@flow-state-dev/core";
import {
  DELEGATED_POST_ENTRY,
  defineProjectBlocks,
  defineSeatInventoryCollection,
  delegatedPostEntry,
  workerConfigSchema,
  type WorkerInstallation,
} from "@flow-state-dev/workforce";
import { z } from "zod";

/** The kind a `WORKER.md` names in its `flow:` line. */
export const ASKER_KIND = "asker";

const askSchema = z.object({ what: z.string().min(1) });

const decisionSchema = z.object({ what: z.string(), approved: z.boolean() });

const messageSchema = z.object({ message: z.string() });

/** The line a test sends to be refused. */
export const ASKER_REFUSED_LINE = "refuse me";

/** The line a test sends to have the seat stop on a person's approval before it answers. */
export const ASKER_GATED_LINE = "ask me first";

/**
 * The line a test sends to keep the seat's turn running: the seat answers it
 * only once the test lets it ({@link holdSlowLines}).
 */
export const ASKER_SLOW_LINE = "take your time";

let slow: Promise<void> = Promise.resolve();

/**
 * Hold every {@link ASKER_SLOW_LINE} turn until the returned function is
 * called. The session holds the line meanwhile; only the answer waits.
 */
export function holdSlowLines(): () => void {
  let release!: () => void;
  slow = new Promise<void>((resolve) => (release = resolve));
  return release;
}

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
    if (input.message === ASKER_SLOW_LINE) await slow;
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

/** A delegated post's turn: ask about the line the coordinator handed over, then say what the person decided. */
const fromPost = handler({
  name: "asker-from-post",
  inputSchema: messageSchema,
  outputSchema: askSchema,
  execute: (input) => ({ what: input.message }),
});

const decided = handler({
  name: "asker-decided",
  inputSchema: decisionSchema,
  outputSchema: z.object({ text: z.string() }),
  execute: (input) => ({ text: `${input.approved ? "Approved" : "Denied"}: ${input.what}` }),
});

/** `hear`, then, for a {@link startProjectLine}, `createProject` with that id. */
function hearAndStartProjects() {
  return sequencer({ name: "asker-hear-and-start", inputSchema: messageSchema })
    .step(hear)
    .stepIf(
      (out) => START_PROJECT.test(out.heard),
      (out) => {
        const id = START_PROJECT.exec(out.heard)![1]!;
        return { id, title: `Project ${id}` };
      },
      defineProjectBlocks().createProject,
    );
}

const onPost = sequencer({ name: "asker-on-post", inputSchema: messageSchema }).step(fromPost).step(gate).step(decided);
const ask = sequencer({ name: "asker-ask", inputSchema: askSchema }).step(gate);

/**
 * Build the kind `hireWorkforce` registers one copy of, which every `asker`
 * worker runs on: each session names its worker.
 *
 * @param installation The installation whose workers run on it.
 * @param resources The tree's declared documents, as `resourcesFromDocs`
 *   built them, so a document that opts in to browser reads is served.
 * @param options.projects Let the `message` door start projects ({@link startProjectLine}).
 * @param options.inventory Declare the organization's inventory for a browser to read.
 */
export function defineAskerFlow(
  installation: WorkerInstallation,
  resources: Record<string, unknown> = {},
  options: { projects?: boolean; inventory?: boolean } = {},
) {
  const inventory = options.inventory === true ? { inventorySeats: defineSeatInventoryCollection() } : {};
  return defineFlow({
    kind: ASKER_KIND,
    session: installation.session(),
    resources: { ...resources, ...inventory, ...installation.resources },
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
        [DELEGATED_POST_ENTRY]: { ...delegatedPostEntry(onPost), durable: true },
      },
    },
  } as never);
}
