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
 * - **One answer-again step, two sources** (FIX-2159). The answer after the
 *   plan is one source of the step that answers again after the turn; a flow
 *   may pass a second (`planned(turn, answerAgain)`), a block whose
 *   `{ message }` the worker answers again about in the same request: the
 *   agent flow's `answerAgain`, which hears the tasks that finished while the
 *   worker answered. After each answer the step asks its sources again, and
 *   answers while one asks something, at most {@link MAX_ANSWERS_AGAIN} times
 *   in a request, the plan's answer included. After the last, no source runs.
 * - **The answering turn files no step for itself.** Its filing is refused,
 *   telling it to do the work or answer (`PLAN_ANSWERING_STATE`). A task it
 *   files for a delegate is dispatched as usual.
 *
 * - **A step in a session of its own** (FIX-2082 D2). A step filed
 *   `session: "new"` is handed to a new session of the same worker, through
 *   its own `work` entry, and the drain waits on it until it ends, waiting
 *   again at each deadline; the next step sees its result. Its ending
 *   resumes the drain: the plan ledger owes no notice, only that resume,
 *   paid by the worker's board pass. Whether the request answers after its
 *   plan is decided once, after the turn, and kept across that resume, so a
 *   step in a session of its own that was the plan's last still gets its
 *   answer (FIX-2110).
 *
 * A failed attempt's open steps stay open and the next attempt adopts them.
 * The task-ending cascade (FIX-2080) doesn't reach them: a request that
 * crashes mid-step records no ending, so its step stays `in_progress` until
 * its lease runs out. Ending or adopting that step is a follow-up.
 */
import { handler, sequencer } from "@flow-state-dev/core";
import type { BlockContext, BlockDefinition } from "@flow-state-dev/core/types";
import { taskBoard, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import {
  defineTaskCollection,
  getOrCreateTaskCollection,
  taskLedgerResources,
  isTerminalStatus,
  resolveResourceCollection,
  type Task,
  type TaskCollectionRef,
  type TaskWorkerInput
} from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import { filingSessionIdOf } from "./filing-session";
import { CONVERSATION_BOARD_CLIENT_FIELDS, conversationPartition } from "./ledger";
import { conversationDelivery } from "./delivery";
import { taskMessage } from "./task-message";

/**
 * The plan ledger's id: its resource key. **Pinned**: rows are stored under it.
 */
export const PLAN_LEDGER_ID = "plan";

/**
 * The plan ledger's one declaration. A browser may read it as it reads the
 * conversation ledger: the user's own rows, each under its session's partition,
 * so a screen lists a worker's steps beside the tasks it dispatched. A step's
 * ending owes no notice (FIX-2082): the drain that waits on it is resumed by
 * it, through the worker's board pass, as a conversation's are.
 */
const planLedger = Object.assign(
  defineTaskCollection({
    id: PLAN_LEDGER_ID,
    scope: "user",
    partitionBy: conversationPartition,
    delivery: { ...conversationDelivery(PLAN_LEDGER_ID), notices: false }
  }),
  { client: { state: { read: true }, expose: CONVERSATION_BOARD_CLIENT_FIELDS } }
);

/** The flow resources that install the plan ledger. */
export const planLedgerResources = taskLedgerResources(planLedger);

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

/**
 * Request state: whether the turn left steps to work, decided once, right
 * after the turn (FIX-2110). A drain that waits on a step in a session of its
 * own suspends the request; on its resume the sequencer asks again whether to
 * answer, and by then the plan ledger may hold no open step. The answer is
 * this recorded decision, not a fresh read of the ledger.
 */
const PLAN_OWED_STATE = "planOwed";

/**
 * The most times one request answers again after its turn (FIX-2159): the
 * answer after its plan and each answer a source asked for count alike, so a
 * source that always has a message can't loop a turn forever. After the last
 * one no source runs, and what it would have taken stays for after the turn.
 * Apart from core's `maxSteps`, which counts model calls in one answer, and
 * the board's pass rounds, which count drains.
 */
export const MAX_ANSWERS_AGAIN = 3;

/** Request state: how many times this request answered again. */
const ANSWERS_AGAIN_STATE = "answersAgain";

/** Request state: what this round's sources asked the worker to answer about, in order. */
const ANSWER_ROUND_MESSAGES_STATE = "answerRoundMessages";

/** Request state: the plan's ended steps were put to the worker once, so its source has nothing more. */
const PLAN_BRIEFED_STATE = "planBriefed";

/** Whether the running request is in its answering turn. */
export function isAnsweringTurn(ctx: BlockContext): boolean {
  return (ctx.request?.state as Record<string, unknown> | undefined)?.[PLAN_ANSWERING_STATE] === true;
}

/**
 * Session state: the requests whose plan has a step in a session of its own
 * to wait on (FIX-2113), each from its turn's end until it answers, keyed by
 * request id. Each request writes and clears only its own key, so two that
 * plan in one session never overwrite each other. A request that dies leaves
 * its key, which then holds nothing (`anotherTurnWaitsOnItsPlan` asks whether
 * it ended), and the next plan in the session clears it.
 */
export const PLAN_WAITING_STATE = "planWaitingRequests";

/** The session state a plan writes. */
const planWaitingSessionState = z.object({ [PLAN_WAITING_STATE]: z.record(z.string(), z.literal(true)).optional() });

/** The requests the session's state marks as waiting on a step of their own plan. */
function markedRequests(ctx: BlockContext): string[] {
  const marked = (ctx.session?.state as Record<string, unknown> | undefined)?.[PLAN_WAITING_STATE];
  return marked !== null && typeof marked === "object" ? Object.keys(marked) : [];
}

/**
 * Whether another request in this session is working a plan with a step in a
 * session of its own, and hasn't answered (FIX-2113). That request's turn is
 * not over while it waits on the step, and one turn of a task runs at a time
 * in its session, so a notice's turn or a steer's turn waits until it ends.
 * Read off the session's state, never the plan ledger: a request reads a
 * ledger as the snapshot it first took, and its own plan reads it later.
 */
export async function anotherTurnWaitsOnItsPlan(ctx: BlockContext): Promise<boolean> {
  const others = markedRequests(ctx).filter((requestId) => requestId !== ctx.request?.identity?.id);
  if (others.length === 0) return false;
  // A host with no record of ended requests holds no durable wait, and a step
  // filed `session: "new"` is refused there, so no request marks the session;
  // reading a mark anyway, take it as live.
  const ended = ctx.requestHost?.waits?.ended;
  if (ended === undefined) return true;
  // A request that died holds nothing.
  const answers = await ended(others);
  return others.some((requestId) => answers[requestId] !== true);
}

/**
 * Mark the session as waiting on the running request's plan (FIX-2113),
 * under its own key; first, drop the keys of requests that have ended. A key
 * of a request that is interrupted and not yet driven again reads as ended
 * and is dropped too: if the sweeper drives it into its step's wait later, it
 * waits unmarked. That needs a crash between this mark and the drain's park,
 * with a second plan in the window between, and is accepted.
 */
export async function markPlanWaiting(ctx: BlockContext): Promise<void> {
  const own = ctx.request.identity.id;
  const others = markedRequests(ctx).filter((requestId) => requestId !== own);
  const ended = ctx.requestHost?.waits?.ended;
  if (ended !== undefined && others.length > 0) {
    const answers = await ended(others);
    for (const requestId of others) if (answers[requestId] === true) await ctx.session.deleteStateRecord(PLAN_WAITING_STATE, requestId);
  }
  await ctx.session.setStateRecord(PLAN_WAITING_STATE, own, true);
}

/** Clear the running request's own mark (FIX-2113): it answered. Another request's is left. */
export async function clearPlanWaiting(ctx: BlockContext): Promise<void> {
  const own = ctx.request.identity.id;
  if (markedRequests(ctx).includes(own)) await ctx.session.deleteStateRecord(PLAN_WAITING_STATE, own);
}

/** Whether the running request is in a step's turn. */
export function isSteppingTurn(ctx: BlockContext): boolean {
  return (ctx.request?.state as Record<string, unknown> | undefined)?.[PLAN_STEPPING_STATE] === true;
}

/** A step the drain would work now: open. A step is never held (FIX-2080): its filing refuses `held`, and so does a hold. */
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
   * same turn twice (with the same `answerAgain`) returns the same block, and
   * a planned turn is returned as it is.
   *
   * @param answerAgain A second source for the answer-again step (FIX-2159),
   *   beside the plan: a block run after each answer, whose `{ message }`, when
   *   it returns one, the worker answers again about in the same request.
   */
  planned(turn: BlockDefinition<any, any>, answerAgain?: BlockDefinition<any, any>): BlockDefinition<any, any>;
  /** Whether any turn on the flow was wrapped: only then is a worker offered its steps. */
  wired(): boolean;
}

/** What one flow's planning is built from. */
export interface PlanningOptions {
  /**
   * The hand-over of a step filed `session: "new"` to a new session of the
   * same worker (FIX-2082 D2): a dispatcher to its own `work` entry. Omitted,
   * every step runs inline.
   */
  readonly newSession?: BlockDefinition<any, any>;
  /**
   * Run as the last step of a request that worked its plan, once its turn
   * answered: a `.tap()`. The conversation board's sends the notices that
   * waited for this turn (FIX-2113).
   */
  readonly afterPlan?: BlockDefinition<any, any>;
}

/** Build one flow's planning. */
export function definePlanning(options: PlanningOptions = {}): Planning {
  const byTurn = new WeakMap<object, Map<object | undefined, BlockDefinition<any, any>>>();
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
   * it can never run), and brief the answer: the plan's message.
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
      await ctx.request.patchState({ [PLAN_BRIEFED_STATE]: true } as never);
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

  /**
   * Decide whether the turn left steps to work (a workable row on the
   * session's plan ledger) and record it. Its record is replayed on a resume,
   * so it runs once per request.
   */
  const decidePlan = handler({
    name: "plan-decide",
    inputSchema: z.unknown(),
    resources: { ...planLedgerResources },
    sessionStateSchema: planWaitingSessionState,
    execute: async (_input, ctx) => {
      const own = await ownPlanLedger(ctx as never);
      const workable = (own?.list() ?? []).filter(isWorkable);
      // The answer-again step starts afresh for this turn: nothing briefed, nothing answered again yet.
      await ctx.request.patchState({ [PLAN_OWED_STATE]: workable.length > 0, [PLAN_BRIEFED_STATE]: false, [ANSWERS_AGAIN_STATE]: 0, [ANSWER_ROUND_MESSAGES_STATE]: [] } as never);
      // A step in a session of its own: this request waits on it, and its turn isn't over until it answers.
      if (workable.some((row) => row.session === "new")) await markPlanWaiting(ctx as never);
    }
  });

  /** The request answered after its plan: its turn is over (FIX-2113). */
  const endPlanWaiting = handler({
    name: "plan-end-waiting",
    inputSchema: z.unknown(),
    sessionStateSchema: planWaitingSessionState,
    execute: async (_input, ctx) => {
      await clearPlanWaiting(ctx as never);
    }
  });

  /** Whether the turn left steps to work, as {@link decidePlan} recorded it. */
  const owesPlan = (_answer: unknown, ctx: unknown): boolean =>
    ((ctx as BlockContext).request?.state as Record<string, unknown> | undefined)?.[PLAN_OWED_STATE] === true;

  /** The plan's source: due once, when the turn left steps to work. */
  const planDue = (value: unknown, ctx: unknown): boolean =>
    owesPlan(value, ctx) &&
    ((ctx as BlockContext).request?.state as Record<string, unknown> | undefined)?.[PLAN_BRIEFED_STATE] !== true;

  /** Keep what a source asked the worker to answer about, when it asked anything. */
  const keepMessage = handler({
    name: "answer-again-keep-message",
    inputSchema: z.unknown(),
    execute: async (value, ctx) => {
      const message = (value as { message?: unknown } | null | undefined)?.message;
      if (typeof message !== "string" || message.trim() === "") return;
      const kept = ((ctx.request.state as Record<string, unknown> | undefined)?.[ANSWER_ROUND_MESSAGES_STATE] ?? []) as string[];
      await ctx.request.patchState({ [ANSWER_ROUND_MESSAGES_STATE]: [...kept, message] } as never);
    }
  });

  const roundSchema = z.object({ answer: z.unknown(), again: z.boolean().optional() });
  const roundEndSchema = z.object({ answer: z.unknown(), again: z.boolean(), message: z.string().optional() });

  /**
   * The round's sources have run: when any asked something, mark the request
   * as answering (an answering turn files no step for itself, and is no step),
   * count the answer, and brief it.
   */
  const briefRound = handler({
    name: "answer-again-brief",
    inputSchema: roundSchema,
    outputSchema: roundEndSchema,
    execute: async (value, ctx): Promise<z.infer<typeof roundEndSchema>> => {
      const state = (ctx.request.state ?? {}) as Record<string, unknown>;
      const messages = (state[ANSWER_ROUND_MESSAGES_STATE] ?? []) as string[];
      if (messages.length === 0) return { answer: value.answer, again: false };
      await ctx.request.patchState({
        [ANSWERS_AGAIN_STATE]: Number(state[ANSWERS_AGAIN_STATE] ?? 0) + 1,
        // Consumed, so the next round does not ask these again.
        [ANSWER_ROUND_MESSAGES_STATE]: [],
        [PLAN_ANSWERING_STATE]: true,
        // A step that threw left its mark: the answering turn is no step.
        [PLAN_STEPPING_STATE]: false
      } as never);
      return { answer: value.answer, again: true, message: messages.join("\n\n") };
    }
  });

  /**
   * The round's answer, and whether to look again. At the cap, no: a further
   * round would run a source.
   */
  const answeredAgain = handler({
    name: "answer-again-answered",
    inputSchema: z.unknown(),
    outputSchema: roundEndSchema,
    execute: (answer, ctx): z.infer<typeof roundEndSchema> => {
      const answered = Number((ctx.request.state as Record<string, unknown> | undefined)?.[ANSWERS_AGAIN_STATE] ?? 0);
      return { answer, again: answered < MAX_ANSWERS_AGAIN };
    }
  });

  /** The request's answer: the last one the worker gave. */
  const lastAnswer = handler({
    name: "answer-again-last",
    inputSchema: roundSchema,
    outputSchema: z.unknown(),
    execute: (value) => value.answer
  });

  const planned = (turn: BlockDefinition<any, any>, answerAgain?: BlockDefinition<any, any>): BlockDefinition<any, any> => {
    if (plannedBlocks.has(turn)) return turn;
    const known = byTurn.get(turn)?.get(answerAgain);
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
      // A step filed `session: "new"` goes to a session of its own, waited on.
      ...(options.newSession !== undefined ? { boardId: PLAN_LEDGER_ID, newSession: options.newSession as never } : {}),
      // In order: each step sees the one before it end.
      concurrency: 1
    });
    // The plan's source: drain the steps, then how each ended.
    const planSource = sequencer({ name: `${turn.name}-plan-answer`, inputSchema: z.unknown() })
      .tap(notePlanStart)
      .tap(board.drain)
      .step(briefAnswer)
      .tap(keepMessage);
    // Each source in turn: the plan's, once, then the flow's.
    let sources = sequencer({ name: `${turn.name}-answer-again-sources`, inputSchema: z.unknown() })
      .tapIf(planDue, planSource);
    if (answerAgain !== undefined) {
      // Handed the worker's last answer.
      const source = sequencer({ name: `${turn.name}-answer-again-source`, inputSchema: z.unknown() }).step(answerAgain).tap(keepMessage);
      sources = sources.tap((value: { answer?: unknown }) => value.answer, source);
    }
    const answering = sequencer({ name: `${turn.name}-answer-again-turn`, inputSchema: z.object({ message: z.string() }) })
      .step(turn)
      .tap(endAnswer)
      .step(answeredAgain);
    // One round: the sources, then one answer about everything they asked.
    const round = sequencer({ name: `${turn.name}-answer-again-round`, inputSchema: roundSchema })
      .tap(sources)
      .step(briefRound)
      .stepIf((value: { again: boolean }) => value.again, (value: { message?: string }) => ({ message: value.message ?? "" }), answering);
    // Another round while the last one answered under the cap. At the cap
    // `again` is false, so no further source runs.
    let again = sequencer({ name: `${turn.name}-answer-again`, inputSchema: roundSchema })
      .doWhile((value: { again?: boolean }) => value.again === true, round)
      .tapIf(owesPlan, endPlanWaiting);
    if (options.afterPlan !== undefined) again = again.tapIf(owesPlan, options.afterPlan);
    const answers = again.step(lastAnswer);
    const block = sequencer({ name: `${turn.name}-planned`, inputSchema: z.object({ message: z.string() }) })
      .step(turn)
      .tap(decidePlan)
      // A request with no plan and no source runs the turn alone.
      .stepIf((value: unknown, ctx: unknown) => answerAgain !== undefined || owesPlan(value, ctx), (answer: unknown) => ({ answer }), answers);
    const forTurn = byTurn.get(turn) ?? new Map<object | undefined, BlockDefinition<any, any>>();
    forTurn.set(answerAgain, block);
    byTurn.set(turn, forTurn);
    plannedBlocks.add(block);
    wired = true;
    return block;
  };

  return { planned, wired: () => wired };
}
