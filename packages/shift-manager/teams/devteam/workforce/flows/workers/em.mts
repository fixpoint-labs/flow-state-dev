/**
 * The `em` worker flow — one file under `workforce/flows/workers/`, basename =
 * the flow name every coordinating `WORKER.md` names in its `flow:` line.
 *
 * **This worker flow declares no harness slot, and that is the point.** "The EM
 * does no harness work" is a locked DevForce opinion, and it is graded on the
 * worker flow rather than on behaviour: its one `task:` entry is a coordinator's
 * delegated post, which runs the EM's own turn, and there is no option through
 * which a harness could be installed, so the worker cannot run a coding
 * harness — not merely "it happened not to". Search this file for the word
 * harness and the only hits are in this paragraph.
 *
 * What it has instead is its session's own task board, Workforce's filing kit
 * (`defineSessionBoard`). An EM worker leads a workstream as an ordinary
 * worker: its `WORKER.md` names the coder and the reviewer as `delegates:`,
 * both of which take tasks, and that list is what gives its sessions the task
 * tools. A task it files lands on the board of the session it was filed from
 * (its workstream session, when it leads one), is handed to the delegate it
 * names in a task session of its own, and its ending comes back to that same
 * session as a notice its turn hears once.
 *
 * Two ways a task gets filed:
 *
 * - **The turn**: a model, with the nine task tools and the lead's
 *   `updateWorkstream`. It takes a user's line, the project coordinator's
 *   delegated post, and each task's notice. Its own file tells it to name the
 *   feature's `issue` and `phase` on every coder task: a task naming both is
 *   feature work and must end in a commit.
 * - **The lab's doors** (`file`, `askToFile`, `drain`): deterministic, no
 *   model, for the checks that grade the board rather than a model's
 *   judgement. They file through the same board, one row per feature, under
 *   the feature's canonical id so a second filing finds the first.
 *
 * Every EM worker runs on this worker flow's one copy. A session names its worker
 * (`installation.session()`), and a block reads that worker's own settings
 * through the installation, never `ctx.flow.config`.
 *
 * Nothing under `flows/` is read as a convention file — the loader walks
 * `workers/`, `skills/` and `resources/` and ignores the rest
 * (BR-16), which is why the code side of the fence can sit inside the tree.
 */

import { defineFlow, generator, handler, sequencer, SuspensionRejectedError } from "@flow-state-dev/core";
import type { GeneratorTool } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import {
  defineSessionBoard,
  projectAddressSchema,
  routedTaskHistory,
  workerConfigOf,
  WORKSTREAM_OPENED_ENTRY,
  workstreamOpenedEntry,
  WORKER_TASK_ENTRY,
  workerTaskEntry,
  type ProjectAddress,
  type WorkerInstallation,
} from "@flow-state-dev/workforce";

import { PHASE } from "../../../phase.mts";
import {
  ASK_ENTRY,
  defineReadOwnFacts,
  INSPECT_ENTRY,
  workerOf,
  workerSettingsSchema,
} from "../../../worker-config.mts";

/** The flow name the coordinating `WORKER.md` names. **Pinned** — the basename must match. */
export const EM_FLOW = "em";

/** The action that turns one feature into one row on the session's board. */
export const FILE_ENTRY = "file";

/** The action that runs the session's board until nothing it can start is waiting. */
export const DRAIN_ENTRY = "drain";

/**
 * The worker's door: the action a user's own line in the EM's session
 * reaches, `respond` on every worker flow. The turn answers it.
 */
export const MESSAGE_ENTRY = "respond";

/** The turn's generator name, which a scripted model resolves it by. */
export const EM_TURN = "devforce-em-turn";

/**
 * What filing one feature takes.
 *
 * `phase` is not an input: this team runs one phase, and letting a caller pick
 * one would let a row be filed that the coder's manager then refuses after
 * the checkout has been cut.
 */
export const fileInputSchema = z.object({
  /** The row's identity, and the leaf of every path derived from it. */
  issue: z.string().min(1),
  /** What the row is, in a sentence. */
  goal: z.string().min(1),
  /**
   * How many attempts the row gets.
   *
   * Stated, because a reported failure would otherwise spend the board's
   * default and BR-14's "back to pending, then errored once the budget is
   * spent" would read a budget nobody chose.
   */
  maxAttempts: z.number().int().min(1).default(2),
  /**
   * The project the row's coding run works in, by its address, when the
   * session it is filed from works for none: a session that leads a
   * workstream passes its project down by itself.
   */
  project: projectAddressSchema.optional(),
});

/** What the asking door is handed: the feature it asks about. */
export const askInputSchema = z.object({
  /** The row's identity, as {@link fileInputSchema} takes it. */
  issue: z.string().min(1),
  /** What the row is, in a sentence. Named in the ask so a user knows what they approve. */
  goal: z.string().min(1),
  /** The project the row's coding run works in, as {@link fileInputSchema} takes it. */
  project: projectAddressSchema.optional(),
});

/**
 * The feature a row is filed for: its typed payload's `issue`, or `undefined`
 * for a row that names none.
 */
export function featureIssueOf(row: { input?: unknown }): string | undefined {
  const issue = (row.input as { issue?: unknown } | undefined)?.issue;
  return typeof issue === "string" ? issue : undefined;
}

/** What the turn reads off the worker it runs as: its file's settings. */
interface EmSettings {
  instructions?: string;
  teamInstructions?: string;
  model?: string;
  tools?: string[];
}

export interface EmWorkerFlowOptions {
  /** The installation whose workers run on this worker flow, and whose delegates take its tasks. */
  installation: WorkerInstallation;
  /**
   * The worker the lab's doors file a feature for: a delegate of the EM that
   * takes tasks. Passed in rather than named here because the host derives
   * it from the tree, so no worker is named in this lab's code.
   */
  coderWorker: string;
  /** The file-declared documents, as `resourcesFromDocs` built them. */
  resources: Record<string, unknown>;
  /**
   * The tools a worker's `tools:` line may name, by name: the lead's
   * `updateWorkstream`, which the host builds with the workstream writes.
   */
  catalog: Record<string, GeneratorTool>;
  /**
   * **Control only.** The asking door files its row *before* it suspends, so
   * a row exists while the ask is still pending. The red state of "nothing is
   * filed until a user approves"; never set outside a goal control.
   */
  fileBeforeAsking?: boolean;
}

/**
 * Build the coordinating worker flow.
 *
 * @param options The installation, the coder worker, the documents and the tool catalog.
 * @returns The flow factory `hireWorkforce` registers one copy of, which every EM worker runs on.
 */
export function defineEmWorkerFlow(options: EmWorkerFlowOptions) {
  const { installation } = options;
  const readOwnFacts = defineReadOwnFacts(workerOf(installation, EM_FLOW));
  const kit = defineSessionBoard({ installation, flowKind: EM_FLOW });
  const toolNames = Object.keys(options.catalog);
  const settingsOf = (ctx: BlockContext): EmSettings => workerConfigOf(ctx) as EmSettings;

  /**
   * The turn: one model call, as the worker the session names, with its
   * file's instructions and model, the session board's task tools, and the
   * tools its `tools:` line names. Its history is the session's, with a
   * routed task's recent lines from the conversation that routed it shown
   * just before the message, on that turn only.
   */
  const turn = generator({
    name: EM_TURN,
    inputSchema: z.object({ message: z.string() }),
    itemVisibility: { client: true, history: true },
    history: routedTaskHistory,
    uses: [kit.tools, kit.messages],
    prompt: [
      (_input: unknown, ctx: BlockContext) => settingsOf(ctx).teamInstructions,
      (_input: unknown, ctx: BlockContext) => settingsOf(ctx).instructions,
    ],
    model: (_input: unknown, ctx: BlockContext) => {
      const model = settingsOf(ctx).model;
      if (model === undefined) throw new Error(`EM worker "${workerConfigOf(ctx).workerId}" names no \`model:\`, so its turn has nothing to run on.`);
      return model;
    },
    tools: (_input: unknown, ctx: BlockContext) => (settingsOf(ctx).tools ?? []).map((name) => options.catalog[name]!),
    user: (input: { message: string }) => input.message,
  } as never);

  /**
   * Put one feature on the session's board, idempotently.
   *
   * Shared by the lab's doors rather than written per door: what a row IS
   * does not depend on whether a caller handed it over or a user approved
   * an ask. A feature already on the board, by its issue, is found rather
   * than filed again, so the same work never runs twice. The board mints the
   * row's id. The TYPED payload carries the issue and the phase, never
   * `metadata`: a task naming both is feature work, and the coder's run needs
   * a commit for it.
   */
  const addRow = async (
    ctx: BlockContext,
    input: { issue: string; goal: string; maxAttempts: number; project?: ProjectAddress },
  ): Promise<{ taskId: string; existed: boolean }> => {
    const tasks = await kit.board.resolver(ctx);
    if (tasks === undefined) {
      throw new Error("this session files no tasks: none of its worker's delegates takes one");
    }
    const filed = tasks.list().find((row) => featureIssueOf(row) === input.issue);
    if (filed !== undefined) return { taskId: filed.id, existed: true };
    const added = await tasks.createTask({
      goal: input.goal,
      input: { issue: input.issue, phase: PHASE, ...(input.project === undefined ? {} : { project: input.project }) },
      assignee: options.coderWorker,
      maxAttempts: input.maxAttempts,
    });
    return { taskId: added.id, existed: false };
  };

  const fileRow = handler({
    name: "devforce-em-file-row",
    inputSchema: fileInputSchema,
    outputSchema: z.object({ taskId: z.string(), existed: z.boolean() }),
    execute: async (input: z.infer<typeof fileInputSchema>, ctx: BlockContext) => await addRow(ctx, input),
  });

  // ---- the asking door --------------------------------------------------
  //
  // prepare → gate → on approve: file, then run the board → on reject: say so.
  // Handlers and the stock suspension only; no model is on this path.

  const askDecisionSchema = askInputSchema.extend({ approved: z.boolean() });
  const defaultAttempts = (): number => fileInputSchema.shape.maxAttempts.parse(undefined);

  /**
   * Before the gate. Replayed from the durable log on resume, not re-run.
   *
   * Passes the feature through, except under the `fileBeforeAsking` control,
   * which files here so a check can watch a row exist before anyone approved.
   */
  const prepareAsk = handler({
    name: "devforce-em-prepare-ask",
    inputSchema: askInputSchema,
    outputSchema: askInputSchema,
    execute: async (input: z.infer<typeof askInputSchema>, ctx: BlockContext) => {
      if (options.fileBeforeAsking === true) {
        await addRow(ctx, { ...input, maxAttempts: defaultAttempts() });
      }
      return input;
    },
  });

  /**
   * The stock `user_approval` suspension, naming the feature.
   *
   * Approve makes `ctx.suspend` return; reject makes it throw
   * `SuspensionRejectedError`. Either way the gate returns a decision the
   * branches below read.
   */
  const askGate = handler({
    name: "devforce-em-ask-gate",
    inputSchema: askInputSchema,
    outputSchema: askDecisionSchema,
    execute: async (input: z.infer<typeof askInputSchema>, ctx: BlockContext) => {
      try {
        await ctx.suspend!({
          reason: "user_approval",
          message: `File ${input.issue}: ${input.goal} and start the coder on it?`,
          allow: ["approve", "reject"],
        });
        return { ...input, approved: true };
      } catch (error) {
        if (error instanceof SuspensionRejectedError) return { ...input, approved: false };
        throw error;
      }
    },
  });

  /** On approve: file the row through the one row writer, and say what happened. */
  const fileApproved = handler({
    name: "devforce-em-file-approved",
    inputSchema: askDecisionSchema,
    execute: async (input: z.infer<typeof askDecisionSchema>, ctx: BlockContext) => {
      const filed = await addRow(ctx, {
        issue: input.issue,
        goal: input.goal,
        maxAttempts: defaultAttempts(),
        ...(input.project === undefined ? {} : { project: input.project }),
      });
      ctx.emit.message(
        filed.existed
          ? `Approved, but ${filed.taskId} already existed; nothing new was filed.`
          : `Approved. Filed ${filed.taskId} and handed it to the board.`,
      );
    },
  });

  /** On reject: file nothing, and say so. */
  const refuseAsked = handler({
    name: "devforce-em-ask-denied",
    inputSchema: askDecisionSchema,
    execute: async (input: z.infer<typeof askDecisionSchema>, ctx: BlockContext) => {
      ctx.emit.message(`Nothing filed for ${input.issue}: the ask was denied.`);
    },
  });

  const askToFile = sequencer({ name: "devforce-em-ask-to-file", inputSchema: askInputSchema })
    .step(prepareAsk)
    .step(askGate)
    .tapIf((decision) => decision.approved, fileApproved)
    // The approved branch runs the board's pass, through its entry (one at a
    // time, FIX-2078), so Approve starts the coder's run without a second call.
    .tapIf((decision) => decision.approved, () => ({}), kit.board.triggerPass)
    .tapIf((decision) => !decision.approved, refuseAsked);

  /**
   * The turn's worker, loaded before anything reads a setting, at the start
   * of every run of a request, a resumed one included.
   */
  const resolveEmWorker = handler({
    name: "devforce-em-resolve-worker",
    inputSchema: z.unknown(),
    outputSchema: z.object({ worker: z.string() }),
    resources: { ...installation.resources },
    execute: async (_input, ctx) => ({ worker: (await installation.resolveWorker(ctx, EM_FLOW)).id }),
  });

  return defineFlow({
    kind: EM_FLOW,
    // Registered once, under its flow name; every EM worker's session runs on it.
    cardinality: "collection",
    // A worker's `model:` and the tools its `tools:` line names from the catalog.
    configSchema: workerSettingsSchema().extend({
      model: z.string().min(1).optional(),
      tools: z.array(toolNames.length > 0 ? z.enum(toolNames as [string, ...string[]]) : z.never()).optional(),
    }),
    session: { ...installation.session(kit.sessionStateShape), serverOwned: [...kit.serverOwned] },
    resources: { ...options.resources, ...installation.resources, ...kit.resources },
    // The worker is loaded first.
    request: { onStarted: resolveEmWorker },
    actions: {
      [FILE_ENTRY]: { block: fileRow, description: "File one feature as a row on this session's board." },
      [DRAIN_ENTRY]: { block: kit.board.triggerPass, description: "Run this session's board until nothing it can start is waiting." },
      // A third action rather than a flag on `file`: `file` is the direct door
      // a check drives, and a flag that made it wait would change what that
      // check proves. Durable, because the answer arrives in a later request
      // through the engine's resume route, and the request has to be there to
      // continue.
      [ASK_ENTRY]: {
        block: askToFile,
        durable: true,
        description: "Ask a user before filing one feature; on approval, file it and run the board.",
      },
      [INSPECT_ENTRY]: {
        block: readOwnFacts,
        description: "Read what this worker can see of its own configuration. Writes nothing.",
      },
      [MESSAGE_ENTRY]: {
        block: turn,
        inputSchema: z.object({ message: z.string() }),
        userMessage: (input: { message: string }) => input.message,
        description: "A user's line, which the EM answers, filing the coder's tasks it calls for.",
      },
      // The nine task actions and the four delegate actions.
      ...kit.actions,
    },
    // A coordinator's routed task (FIX-2083): the project coordinator's, for
    // the workstream this worker leads, or the Shift Coordinator's. A routed task
    // is a task on the coordinator's board, taken on `work` like any.
    task: { actions: { [WORKER_TASK_ENTRY]: workerTaskEntry({ name: "em-task", turn }) } },
    internal: {
      actions: {
        // Opening a workstream this worker leads starts its session here.
        [WORKSTREAM_OPENED_ENTRY]: workstreamOpenedEntry(),
        // A run of the board, each task's notice (which wakes the turn), and
        // a split task's settle and cancel.
        ...kit.entries(turn),
      },
    },
  } as never);
}
