/**
 * A worker's plan (FIX-2076 D1, D2): the steps it files for itself, worked by
 * its own request, in order, each seeing the one before.
 *
 * - **The ledger.** A step is a row on the session's *plan ledger*, apart from
 *   its tasks for delegates (`./ledger`): durable, at the owner's user scope,
 *   partitioned by the session's `filingSessionId` like the conversation
 *   ledger, so a retry of the request finds the rows it left open and works
 *   them. A step owes no notice: nobody else is waiting on it.
 * - **The board.** A plan board (`mode: "plan"`) over that ledger, one row at
 *   a time, whose one worker is the worker's own turn, handed the row's brief
 *   and the results of the steps it depends on. Its drain waits on every row.
 * - **The request.** {@link Planning.planned} wraps a turn: the turn runs; if
 *   it left steps to work, the plan board drains them in the same request, and
 *   then the worker answers once more, told how every step ended, a failed one
 *   included. That answer is the request's result. A request that filed no
 *   step runs the turn alone and costs nothing more.
 * - **The answering turn files no step for itself.** Its filing is refused,
 *   telling it to do the work or answer (`PLAN_ANSWERING_STATE`). A task it
 *   files for a delegate is dispatched as usual.
 *
 * Until FIX-2080 lands, a failed attempt's open steps stay open and the next
 * attempt adopts them; that issue's cascade is what will cancel them.
 */
import { handler, sequencer } from "@flow-state-dev/core";
import type { BlockContext, BlockDefinition } from "@flow-state-dev/core/types";
import { taskBoard, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import {
  defineTaskCollection,
  getOrCreateTaskCollection,
  isTerminalStatus,
  resolveResourceCollection,
  type Task,
  type TaskCollectionRef,
  type TaskWorkerInput
} from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import { filingSessionIdOf } from "./filing-session";
import { CONVERSATION_BOARD_CLIENT_FIELDS, conversationPartition } from "./ledger";
import { taskMessage } from "./task-message";

/**
 * The plan ledger's id: its resource key. **Pinned**: rows are stored under it.
 */
export const PLAN_LEDGER_ID = "plan";

/**
 * The plan ledger's one declaration. A browser may read it as it reads the
 * conversation ledger: the user's own rows, each under its session's partition,
 * so a screen lists a worker's steps beside the tasks it dispatched.
 */
const planLedger = Object.assign(
  defineTaskCollection({ id: PLAN_LEDGER_ID, scope: "user", partitionBy: conversationPartition }),
  { client: { state: { read: true }, expose: CONVERSATION_BOARD_CLIENT_FIELDS } }
);

/** The flow resources that install the plan ledger. */
export const planLedgerResources = { [PLAN_LEDGER_ID]: planLedger } as const;

/**
 * The plan ledger at `partition`, or `undefined` when the running flow doesn't
 * declare it.
 */
export async function planLedgerAt(ctx: BlockContext, partition: string): Promise<TaskCollectionRef | undefined> {
  const collection = resolveResourceCollection(ctx, PLAN_LEDGER_ID);
  if (collection === undefined) return undefined;
  return getOrCreateTaskCollection({ ctx, backing: "resource", collectionId: PLAN_LEDGER_ID, collection, partition });
}

/** The running session's own plan ledger. */
async function ownPlanLedger(ctx: BlockContext): Promise<TaskCollectionRef | undefined> {
  return planLedgerAt(ctx, await filingSessionIdOf(ctx.session));
}

/** How many attempts a step gets: one. A step that fails is the answering turn's to handle. */
export const STEP_ATTEMPTS = 1;

/**
 * Request state: set while the turn that answers after the plan drained runs.
 * A step it files for itself is refused. Request-scoped, so it ends with the
 * request.
 */
const PLAN_ANSWERING_STATE = "planAnswering";

/**
 * Request state: set while a step's turn runs. A step it files for itself is
 * refused, so one request's steps are the ones its turn filed, and further work
 * goes in the step's answer. Request-scoped, so it ends with the request.
 */
const PLAN_STEPPING_STATE = "planStepping";

/** Request state: the steps already ended when this request's drain began, so the answer reports only the rest. */
const PLAN_SEEN_STATE = "planSeen";

/** Whether the running request is in its answering turn. */
export function isAnsweringTurn(ctx: BlockContext): boolean {
  return (ctx.request?.state as Record<string, unknown> | undefined)?.[PLAN_ANSWERING_STATE] === true;
}

/** Whether the running request is in a step's turn. */
export function isSteppingTurn(ctx: BlockContext): boolean {
  return (ctx.request?.state as Record<string, unknown> | undefined)?.[PLAN_STEPPING_STATE] === true;
}

/** A step the drain would work now: open (a held row is neither). */
function isWorkable(row: Task): boolean {
  return row.status === "pending" || row.status === "in_progress";
}

/** The longest output or error a step's ending shows the answering turn, in characters of its JSON. */
const ENDING_LIMIT = 4_000;

function shown(value: unknown): string {
  const text = typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
  return text.length <= ENDING_LIMIT ? text : `${text.slice(0, ENDING_LIMIT)}…`;
}

/**
 * A step as its turn reads it: the task message, then the results of the
 * steps it depends on.
 */
function stepMessage(task: TaskWorkerInput): string {
  const lines = [
    `You are working a step you filed for yourself, and it is running now, so don't file or dispatch it again. Do this step's work in this answer, and answer with its result. If you find more work, say so in your answer rather than filing it.\n\n${taskMessage(task)}`
  ];
  const deps = task.deps === undefined ? [] : Object.entries(task.deps);
  if (deps.length > 0) {
    lines.push(`The results of the steps it depends on:\n${deps.map(([id, output]) => `- ${id}: ${shown(output)}`).join("\n")}`);
  }
  return lines.join("\n\n");
}

/** What the answering turn is told: how each step this request worked ended. */
function answerMessage(steps: readonly Task[]): string {
  const endings = steps.map((row, index) => {
    const label = `${index + 1}. "${row.title ?? row.goal}" (${row.id})`;
    if (row.status === "completed") return `${label} completed: ${shown(row.output ?? null)}`;
    if (row.status === "errored") return `${label} failed: ${row.error ?? "no error was recorded"}`;
    return `${label} ${row.status}${row.error !== undefined ? `: ${row.error}` : ""}`;
  });
  return [
    "The steps you filed for yourself have ended:",
    endings.join("\n"),
    "Now give your answer. Finish anything left yourself rather than filing another step for yourself; a task for a delegate is still dispatched."
  ].join("\n\n");
}

/** A worker flow's planning: wrap a turn so the steps it files are worked in its request. */
export interface Planning {
  /**
   * The turn, with its plan: `{ message }` in, the answer out. Wrapping the
   * same turn twice returns the same block, and a planned turn is returned
   * as it is.
   */
  planned(turn: BlockDefinition<any, any>): BlockDefinition<any, any>;
  /** Whether any turn on the flow was wrapped: only then is a worker offered its steps. */
  wired(): boolean;
}

/** Build one flow's planning. */
export function definePlanning(): Planning {
  const byTurn = new WeakMap<object, BlockDefinition<any, any>>();
  const plannedBlocks = new WeakSet<object>();
  let wired = false;

  const notePlanStart = handler({
    name: "plan-note-start",
    inputSchema: z.unknown(),
    resources: { ...planLedgerResources },
    execute: async (_input, ctx) => {
      const own = await ownPlanLedger(ctx as never);
      const seen = (own?.list() ?? []).filter((row) => isTerminalStatus(row.status)).map((row) => row.id);
      await ctx.request.patchState({ [PLAN_SEEN_STATE]: seen } as never);
    }
  });

  /**
   * After the drain: end any step left open (one whose dependency failed, so
   * it can never run), mark the request as answering, and brief the turn.
   */
  const briefAnswer = handler({
    name: "plan-brief-answer",
    inputSchema: z.unknown(),
    outputSchema: z.object({ message: z.string() }),
    resources: { ...planLedgerResources },
    execute: async (_input, ctx) => {
      const own = await ownPlanLedger(ctx as never);
      const rows = own?.list() ?? [];
      for (const row of rows.filter(isWorkable)) {
        await own!.cancel(row.id, "A step it depends on didn't complete, so it couldn't run.");
      }
      const seen = new Set(((ctx.request.state as Record<string, unknown> | undefined)?.[PLAN_SEEN_STATE] ?? []) as string[]);
      const ended = (own?.list() ?? [])
        .filter((row) => isTerminalStatus(row.status) && !seen.has(row.id))
        .sort((a, b) => a.createdAt - b.createdAt);
      // A step that threw left its mark: the answering turn is no step.
      await ctx.request.patchState({ [PLAN_ANSWERING_STATE]: true, [PLAN_STEPPING_STATE]: false } as never);
      return { message: answerMessage(ended) };
    }
  });

  /** Mark the request as in a step's turn, or out of one. */
  const stepping = (on: boolean) =>
    handler({
      name: on ? "plan-step-start" : "plan-step-end",
      inputSchema: z.unknown(),
      execute: async (_input, ctx) => {
        await ctx.request.patchState({ [PLAN_STEPPING_STATE]: on } as never);
      }
    });
  const stepStart = stepping(true);
  const stepEnd = stepping(false);

  const endAnswer = handler({
    name: "plan-end-answer",
    inputSchema: z.unknown(),
    execute: async (_input, ctx) => {
      await ctx.request.patchState({ [PLAN_ANSWERING_STATE]: false } as never);
    }
  });

  /** Whether the turn left steps to work: a workable row on the session's plan ledger. */
  const owesPlan = async (_answer: unknown, ctx: unknown): Promise<boolean> => {
    const own = await ownPlanLedger(ctx as never);
    return (own?.list() ?? []).some(isWorkable);
  };

  const planned = (turn: BlockDefinition<any, any>): BlockDefinition<any, any> => {
    if (plannedBlocks.has(turn)) return turn;
    const known = byTurn.get(turn);
    if (known !== undefined) return known;

    const brief = handler({
      name: `${turn.name}-step-brief`,
      inputSchema: taskWorkerInputSchema,
      outputSchema: z.object({ message: z.string() }),
      execute: (task: TaskWorkerInput) => ({ message: stepMessage(task) })
    });
    // A step is one turn of the worker, on the step's brief. Its answer is the step's result.
    const step = sequencer({ name: `${turn.name}-step`, inputSchema: taskWorkerInputSchema })
      .tap(stepStart)
      .step(brief)
      .step(turn)
      .tap(stepEnd);
    const board = taskBoard({
      name: `${turn.name}-plan`,
      mode: "plan",
      collection: planLedger,
      workers: step,
      // In order: each step sees the one before it end.
      concurrency: 1
    });
    const answer = sequencer({ name: `${turn.name}-plan-answer`, inputSchema: z.unknown() })
      .tap(notePlanStart)
      .tap(board.drain)
      .step(briefAnswer)
      .step(turn)
      .tap(endAnswer);
    const block = sequencer({ name: `${turn.name}-planned`, inputSchema: z.object({ message: z.string() }) })
      .step(turn)
      .stepIf(owesPlan, (value: unknown) => value, answer);
    byTurn.set(turn, block);
    plannedBlocks.add(block);
    wired = true;
    return block;
  };

  return { planned, wired: () => wired };
}
