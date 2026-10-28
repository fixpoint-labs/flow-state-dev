/**
 * The ask-lab's one worker kind: a worker that asks a user before it does
 * anything.
 *
 * Two doors, both durable, both ending in the framework's stock
 * `human_approval` suspension:
 *
 * - `work` — the task entry a coordinator's routed task is handed to
 *   (Workforce's `workerTaskEntry`), in the delegate's own session for that
 *   conversation, which the hand-over opens. So an ask raised here lives in a
 *   dispatch-run session, which is what Shift Manager's listing has to ask
 *   for. Its answer, once a user decides, goes back to the coordinator.
 * - `ask` — a public action a test calls directly, in a session a user
 *   opened.
 *
 * And a door, `message`: a user's line into the worker's session, which the
 * engine writes as a user item before the block runs. It says it heard, as an
 * assistant item of its own ({@link heardLine}), refuses a line that asks to
 * be refused, takes its time over a line that asks it to, or stops on a stock approval for a line that asks for one, the
 * way a chief of staff's gated change does, so a test can see each. Built
 * with `projects`, a line `start project <id>` also creates that project
 * through the project writes' own `createProject`, the way a chief of staff's
 * tool does, so the turn writes the organization's `projects` collection.
 *
 * Built with `inventory`, the worker flow also declares the organization's inventory
 * collections for a browser to read, so a user who holds only a worker's
 * session still finds the inventory.
 *
 * No model anywhere: the ask is the point, not what the worker would do.
 */
import { defineFlow, handler, sequencer, SuspensionRejectedError } from "@flow-state-dev/core";
import {
  defineProjectBlocks,
  defineWorkerInventoryCollection,
  WORKER_TASK_ENTRY,
  workerConfigSchema,
  workerTaskEntry,
  type WorkerInstallation,
  MESSAGE_RECEIVED_ENTRY,
  messageReceivedEntry,
  workerMessagesResources,
} from "@flow-state-dev/workforce";
import { z } from "zod";

/** The worker flow a `WORKER.md` names in its `flow:` line. */
export const ASKER_FLOW = "asker";

/** `detail`: the ask is titled `Approve: <what>`, with `detail` (markdown) as its body. */
const askSchema = z.object({ what: z.string().min(1), detail: z.string().optional() });

const decisionSchema = z.object({ what: z.string(), approved: z.boolean() });

const messageSchema = z.object({ message: z.string() });

/** The line a test sends to be refused. */
export const ASKER_REFUSED_LINE = "refuse me";

/** The line a test sends to have the worker stop on a user's approval before it answers. */
export const ASKER_GATED_LINE = "ask me first";

/**
 * The line a test sends to keep the worker's turn running: the worker answers it
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

/** The line that starts project `<id>`, on a worker flow built with `projects`. */
export const startProjectLine = (id: string) => `start project ${id}`;
const START_PROJECT = /^start project (\S+)$/;

/** What the worker says when it hears `message`. */
export const heardLine = (message: string) => `Heard: ${message}`;

const hear = handler({
  name: "asker-hear",
  inputSchema: messageSchema,
  outputSchema: z.object({ heard: z.string() }),
  execute: async (input, ctx) => {
    if (input.message === ASKER_REFUSED_LINE) throw new Error("This worker won't take that line.");
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
      await ctx.suspend!(
        input.detail === undefined
          ? { reason: "human_approval", message: `Approve: ${input.what}` }
          : { reason: "human_approval", title: `Approve: ${input.what}`, message: input.detail },
      );
      return { what: input.what, approved: true };
    } catch (error) {
      if (error instanceof SuspensionRejectedError) return { what: input.what, approved: false };
      throw error;
    }
  },
});

/** A delegated post's turn: ask about the line the coordinator handed over, then say what the user decided. */
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
 * Build the worker flow `hireWorkforce` registers one copy of, which every `asker`
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
  const inventory = options.inventory === true ? { inventoryWorkers: defineWorkerInventoryCollection() } : {};
  return defineFlow({
    kind: ASKER_FLOW,
    session: installation.session(),
    resources: { ...resources, ...inventory, ...installation.resources, ...workerMessagesResources },
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    actions: {
      ask: { block: ask, durable: true, description: "Ask a user to approve something." },
      respond: {
        block: options.projects === true ? hearAndStartProjects() : hear,
        inputSchema: messageSchema,
        userMessage: (input: { message: string }) => input.message,
        description: "A user's line into this worker's session.",
      },
    },
    internal: { actions: { [MESSAGE_RECEIVED_ENTRY]: messageReceivedEntry({ installation, flowKind: ASKER_FLOW }) } },
    task: {
      actions: {
        [WORKER_TASK_ENTRY]: { ...workerTaskEntry({ name: "asker-task", turn: onPost }), durable: true },
      },
    },
  } as never);
}
