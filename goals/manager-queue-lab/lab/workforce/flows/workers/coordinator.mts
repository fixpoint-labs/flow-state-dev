/**
 * The `coordinator` worker kind — one file under `workforce/flows/workers/`,
 * basename = the kind id the manager's `WORKER.md` names in its `flow:` line.
 *
 * This is the seat that files work, and the **grant is the composition**:
 *
 * ```ts
 * uses: [channelBoardTaskTools(work)]   // <- the whole of it
 * ```
 *
 * The eight task tools arrive as capability **controls**, minted per resolver
 * and never exported, so no `tools:` line can name them back in or fence them
 * out. That is why the manager's own file says `tools: []` on purpose and holds
 * the board anyway, and why there is nothing to add to the tree to make this
 * work. If you find yourself wanting to write a board tool into a `WORKER.md`,
 * you are about to take the other door — read BR-2 first.
 *
 * **There are two doors and the lab takes one of them.** The other is an app
 * registering `buildTaskToolsList()` output in its own catalog, where a seat's
 * `tools:` does bite. Taking it would make this proof evidence for a wiring
 * nothing else uses, and would leave the shipped one unexercised. BR-2's
 * `tools: []` arm is the tripwire: route the eight through the fenced `tools`
 * bucket and it goes red.
 *
 * ## Why `composeBoard` exists
 *
 * The same factory builds BR-2's **twin** — the same kind with the capability
 * left out. It hires just as cleanly, because a missing board grant is not a
 * refusal at all: there is nothing to refuse at hire, and nothing to refuse at
 * filing either, because there is no tool to call. The twin's tool set is what
 * grades that, and it is why this kind is built twice rather than probed once.
 *
 * ## The catalog tool below is one tool, and it earns its line
 *
 * `note` is a plain catalog tool, offered to the seat through the fenced
 * `tools:` bucket. It is here so BR-2's first arm is not a restatement of its
 * second: with `tools: ["note"]` the seat holds nine, with `tools: []` it holds
 * exactly eight and `note` is gone. That difference is the fence biting, on the
 * same kind, in the same run — and it is what makes "the fence never touches
 * the controls" a claim with two readings rather than one.
 */

import { defineFlow, generator, handler } from "@flow-state-dev/core";
import type { GeneratorTool } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { buildTaskToolsList } from "@flow-state-dev/orchestration";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import {
  channelBoardTaskTools,
  workerConfigSchema,
  type ChannelBoardCollection,
} from "@flow-state-dev/workforce";
import { z } from "zod";
import { ledgerOf, rowsOf } from "../../../ledger.mts";
import { queueView, type HiredSeat, type QueueView } from "../../../queue.mts";

/** The kind id the manager's `WORKER.md` names. **Pinned** — the basename must match. */
export const COORDINATOR_KIND = "coordinator";

/** The action that hands the coordinator a list of work and lets it file. */
export const INTAKE_ENTRY = "intake";

/** The action that reads the queue. Writes nothing. */
export const QUEUE_ENTRY = "queue";

/** The action that reads the ledger's rows whole, lease and claim included. */
export const ROWS_ENTRY = "rows";

/** The action that settles a row this seat never claimed (BR-9). */
export const SETTLE_ENTRY = "settle";

/** The action that blocks a row with a reason, so a column has something to show (BR-12). */
export const BLOCK_ENTRY = "block";

/** The one catalog tool this lab offers. See the module header. */
export const NOTE_TOOL = "note";

/** What a coordinator seat's settings bag holds: the contract, plus its own two. */
export function coordinatorSettingsSchema() {
  return workerConfigSchema().extend({
    /** The catalog names this seat may call. **A hard fence** — `[]` means none. */
    tools: z.array(z.string()).default([]),
    /** The model this seat runs on, when its file names one. */
    model: z.string().optional(),
  });
}

/** The parts of the bag this module reads where the bag's type is erased. */
interface CoordinatorConfig {
  instructions?: string;
  teamInstructions?: string;
  tools: string[];
  model?: string;
}

/** What intake is handed: the pieces of work, in the words they arrived in. */
export const intakeInputSchema = z.object({
  work: z.array(z.string().min(1)).min(1),
});

/** What the queue read hands back — the view, unchanged. */
export const queueOutputSchema = z.custom<QueueView>(
  (value) => typeof value === "object" && value !== null,
);

/**
 * The lab's one catalog tool: leave a note.
 *
 * It does nothing that matters. Its whole job is to be a tool the fence can
 * take away, so BR-2's two arms differ by something observable.
 */
function noteTool(): GeneratorTool {
  return {
    name: NOTE_TOOL,
    description: "Leave a short note for the team. Does nothing else.",
    inputSchema: z.object({ note: z.string() }),
    execute: async (input: { note: string }) => ({ noted: input.note }),
  } as unknown as GeneratorTool;
}

export interface CoordinatorWorkerFlowOptions {
  /** The channel's own ledger — the one the `CHANNEL.md` declared by name. */
  board: ChannelBoardCollection;
  /**
   * Whether this kind composes the board capability.
   *
   * `true` is the real coordinator. `false` builds BR-2's twin: the same kind
   * with nothing composed, which holds none of the eight and therefore cannot
   * write the ledger at all.
   */
  composeBoard: boolean;
  /**
   * Which door the eight tools arrive through. **A control, not a setting.**
   *
   * `"capability"` is the shipped door and the lab's own: composition, controls,
   * fence-exempt. `"catalog"` is the OTHER door — an app registering
   * `buildTaskToolsList()` output in its own catalog, where a seat's `tools:`
   * does bite — and it exists here only so BR-2 has the red state it names. A
   * coordinator whose file says `tools: []` then holds nothing, and the arm
   * that says the fence never touches the controls fails.
   */
  door?: "capability" | "catalog";
  /** The model a seat that names none runs on. */
  defaultModel?: string;
  /** The hired seats the queue reports idleness for, with their drain sessions. */
  seats?: readonly HiredSeat[];
}

/**
 * Build the coordinator kind.
 *
 * @param options The ledger, whether to compose the board capability, the
 *   default model, and the seats the queue reports on.
 * @returns `{ kind, intake }` — the flow `hireWorkforce` mints a copy of, and
 *   the generator itself, so a check can read the tool names it resolves
 *   without having to run a model to find out.
 */
export function defineCoordinatorWorkerFlow(options: CoordinatorWorkerFlowOptions) {
  const board = options.board;
  const door = options.door ?? "capability";
  const catalog: Record<string, GeneratorTool> = { [NOTE_TOOL]: noteTool() };

  // The control's door. Under `catalog` the eight are ordinary catalog tools,
  // resolvable only by name — which is what makes the fence able to take them
  // away, and what makes BR-2's `tools: []` arm go red.
  if (door === "catalog" && options.composeBoard) {
    for (const tool of buildTaskToolsList(
      async (ctx) => ledgerOf(ctx, board.id),
      undefined,
      board.id.replace(/[^a-zA-Z0-9_-]/g, "_"),
    ) as GeneratorTool[]) {
      catalog[String((tool as { name?: unknown }).name)] = tool;
    }
  }

  /**
   * The queue read — a pure grouping over rows that already exist.
   *
   * The block resolves the ledger and lists it; every column is
   * {@link queueView}'s, which writes nothing. BR-10 is graded by comparing the
   * ledger before and after this runs, so a view that wrote something fails
   * there rather than being argued about here.
   */
  const readQueue = handler({
    name: "coordinator-read-queue",
    requireOrg: true,
    resources: { [board.id]: board },
    inputSchema: z.object({}).optional(),
    outputSchema: queueOutputSchema,
    execute: async (_input: unknown, ctx: BlockContext): Promise<QueueView> =>
      queueView(await rowsOf(ctx, board.id), options.seats ?? [], Date.now()),
  });

  /**
   * The rows themselves, whole.
   *
   * Separate from the queue read because the two answer different questions and
   * a check needs both: the view is what a coordinator sees, and this is the
   * ledger the view has to be derivable from. It is also the only route to
   * `claimedBy` and `leaseUntil` — the channel's own `readBoard` publishes an
   * allowlist that deliberately drops both, which is right for a public
   * projection and useless for grading a running/queued split.
   */
  const readRows = handler({
    name: "coordinator-read-rows",
    requireOrg: true,
    resources: { [board.id]: board },
    inputSchema: z.object({}).optional(),
    outputSchema: z.custom<Task[]>((value) => Array.isArray(value)),
    execute: async (_input: unknown, ctx: BlockContext): Promise<Task[]> =>
      rowsOf(ctx, board.id),
  });

  /**
   * Settle a row from the coordinator's own session — BR-9.
   *
   * The coordinator never claimed it, and the write goes through anyway. That
   * is **recorded as observed behaviour, not defended as a design**: the
   * substrate's settle is unguarded against a caller that holds no claim, and
   * the eight task tools reach the same method, so a coordinator holding them
   * can settle somebody else's row. The lab shows it rather than working around
   * it, because a queue meets this case.
   */
  const settleRow = handler({
    name: "coordinator-settle-row",
    requireOrg: true,
    resources: { [board.id]: board },
    inputSchema: z.object({ taskId: z.string() }),
    outputSchema: z.object({ settled: z.boolean(), refusal: z.string().optional() }),
    execute: async (input: { taskId: string }, ctx: BlockContext) => {
      const ledger = await ledgerOf(ctx, board.id);
      try {
        await ledger.complete(input.taskId, { did: "settled by the coordinator" });
        return { settled: true };
      } catch (error) {
        return {
          settled: false,
          refusal: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        };
      }
    },
  });

  /**
   * Put a row into the *waiting on you* column, carrying its reason — BR-12.
   *
   * The only route to that column: a row is blocked or parked by somebody, and
   * the view groups it and reports the reason **the row already carries**. The
   * view writes nothing, so a lab that could not produce a blocked row could
   * not grade that column at all.
   */
  const blockRow = handler({
    name: "coordinator-block-row",
    requireOrg: true,
    resources: { [board.id]: board },
    inputSchema: z.object({ taskId: z.string(), reason: z.string().min(1) }),
    outputSchema: z.object({ blocked: z.boolean(), refusal: z.string().optional() }),
    execute: async (input: { taskId: string; reason: string }, ctx: BlockContext) => {
      const ledger = await ledgerOf(ctx, board.id);
      try {
        await ledger.block(input.taskId, input.reason);
        return { blocked: true };
      } catch (error) {
        return {
          blocked: false,
          refusal: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        };
      }
    },
  });

  /**
   * The model's door onto the board — and the only place a model appears in
   * this lab.
   *
   * The `tools:` slot is declared unconditionally, which is what raises the
   * fence. What it resolves is the seat's own declared catalog names and
   * nothing else; the eight controls are added underneath it by core, where no
   * list can reach them.
   */
  const intake = generator({
    name: "coordinator-intake",
    inputSchema: intakeInputSchema,
    flowConfigSchema: coordinatorSettingsSchema(),
    // The grant, and the whole of it — under the lab's own door.
    ...(options.composeBoard && door === "capability"
      ? { uses: [channelBoardTaskTools(board)] }
      : {}),
    // Under the control's door the capability is gone, so the board resource it
    // would have installed has to be declared by hand — which is itself part of
    // what taking the other door costs.
    ...(door === "catalog" ? { resources: { [board.id]: board } } : {}),
    prompt: [
      (_input: unknown, ctx: BlockContext) =>
        (ctx.flow.config as unknown as CoordinatorConfig).teamInstructions,
      (_input: unknown, ctx: BlockContext) =>
        (ctx.flow.config as unknown as CoordinatorConfig).instructions,
    ],
    model: (_input: unknown, ctx: BlockContext) =>
      (ctx.flow.config as unknown as CoordinatorConfig).model ?? options.defaultModel,
    tools: (_input: unknown, ctx: BlockContext): GeneratorTool[] =>
      (ctx.flow.config as unknown as CoordinatorConfig).tools
        .map((name) => catalog[name])
        .filter((tool): tool is GeneratorTool => tool !== undefined),
    user: (input: z.infer<typeof intakeInputSchema>) =>
      `Here is the work that came in. File one row per line, in this order:\n\n` +
      input.work.map((piece, index) => `${index + 1}. ${piece}`).join("\n"),
  } as never);

  const kind = defineFlow({
    kind: COORDINATOR_KIND,
    cardinality: "collection",
    configSchema: coordinatorSettingsSchema(),
    actions: {
      [INTAKE_ENTRY]: { block: intake, description: "Take work in and file it onto the board." },
      [QUEUE_ENTRY]: { block: readQueue, description: "Read the queue. Writes nothing." },
      [ROWS_ENTRY]: { block: readRows, description: "Read the ledger's rows whole. Writes nothing." },
      [SETTLE_ENTRY]: { block: settleRow, description: "Settle a row this seat never claimed." },
      [BLOCK_ENTRY]: { block: blockRow, description: "Block a row, carrying a reason." },
    },
  } as never);

  return { kind, intake };
}
