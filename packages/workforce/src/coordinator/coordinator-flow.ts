/**
 * The `coordinator` worker flow: a worker that hands each of its user's
 * messages to delegates from their own roster, by its routing policy, by
 * filing a task (FIX-2083).
 *
 * One registered copy runs every coordinator worker, the way any worker flow
 * on the installation does: each session names its worker when it is
 * created, and each turn loads that worker's configuration.
 *
 * **What a conversation holds.** Its delegates and its fallback
 * (`../delegates/delegate-list.ts`), and best fit's hold and the open rounds
 * (`coordinator-state.ts`), in server-written session state: the list
 * copied from the worker's defaults the first time it's read or changed,
 * changed only by the four actions and the coordinator's own tools, and never
 * seeded by a session create.
 *
 * **How a message is routed.**
 *
 * - `judgment`: the coordinator's own turn reads the message and hands it to
 *   delegates with its `createTask` tool and the routing settings
 *   (`session: "ongoing"`, `resultTo: "conversation"`), or answers itself. It
 *   reads its delegates with its `listDelegates` tool; the list is never in
 *   its prompt.
 * - `best-fit`: best fit's ladder (`best-fit.ts`): the delegate still on the
 *   user's last message, else one evaluator call (asked again as a language model when it
 *   fails on a model string), else the fallback delegate,
 *   else the coordinator's own judgment turn. Only when that turn fails is the
 *   message unplaced, recorded and said in the conversation.
 * - `round-robin`: the next delegate in list order after the one the
 *   user's last message went to.
 * - `everyone`: each delegate.
 *
 * Every pick is checked against the user's roster when the message arrives
 * (`../delegates/delegate-check.ts`), so a fired delegate is skipped and recorded
 * without anyone editing the list. Routing never picks the coordinator itself.
 *
 * **The conversation's lines.** When a message opens, its conversation's recent
 * lines are read once from the conversation's own items, with any answer that
 * landed while its request is still finishing (`coordinator-lines.ts`): best
 * fit's call reads the message with them, and every routed task, by any
 * policy, carries them to the delegate, whose model is shown them for that turn
 * as a message of the conversation, never as system text (`routed-brief.ts`).
 *
 * **How a routed task reaches a delegate.** Each pick is one ordinary task on
 * this conversation's board (`../conversation-board`), filed by the one filing
 * step here ({@link CoordinatorFlowOptions}'s every policy, and the judgment
 * turn's `createTask` on a turn routing a message, alike): worked in the
 * delegate's ongoing session for this conversation, its result to this
 * conversation, one attempt. Its id is derived from the message, the round
 * and the delegate record, so the same pick twice files one task. The message
 * rides as written on the task's server-written brief. The board hands it to
 * the delegate's `work` entry, behind the claim gate, like any task; the
 * delegate's session is created on first use, naming the delegate as its
 * worker. A session works one task at a time (FIX-2080), so a second message
 * to a busy delegate waits, pending in the user's list, until the first ends.
 *
 * **A project's coordinator** (FIX-1793): a conversation linked to a project
 * (its readonly `projectId`) has a delegate record per workstream its user has
 * open there, the lead with the workstream as the record's target
 * (`../projects/project-coordinator.ts`). A task for such a record names it
 * (`target`) and runs in the workstream's own session, the one its entry
 * names, resolved at filing; the records change only through the workstream's
 * entry paths, on the internal {@link WORKSTREAM_DELEGATE_ACTION}.
 *
 * **How an answer lands.** The delegate's run settles its task with its
 * answer, through the claim gate, and the task's ending reaches this
 * conversation once, on `onTaskSettled` (FIX-2078's one path). It lands as a
 * line under the delegate's name; no turn wakes for it. The round, the
 * delegate and the message come from the task's brief, never from the answer.
 * With `rounds: 0`, an answer routes nowhere further.
 *
 * **How an answer goes back out** (`coordinator-rounds.ts`). Below the
 * coordinator's `rounds:`, best fit and round robin route each answer again
 * as it lands, never to its author; everyone and judgment send a round's
 * answers on when the round closes. Either way the next round runs on the
 * internal {@link ROUTE_ON_ACTION}, which the conversation dispatches into
 * itself, through the same policy steps as a user's message. A task that ends
 * without an answer (failed, or cancelled from the user's list) ends that
 * delegate's part, so a round doesn't wait on it, and a round closes at its
 * deadline whatever is still out: a wake on this conversation's session, due
 * then, after a restart too (D2), on the internal {@link ROUND_DEADLINE_ACTION}.
 * A host that keeps no wakes keeps an in-process timer instead.
 */
import {
  defineFlow,
  dispatcher,
  handler,
  logicalBlockIdOf,
  router,
  sequencer
} from "@flow-state-dev/core";
import { withOutcome } from "@flow-state-dev/core/helpers";
import { dispatchThroughSeam } from "@flow-state-dev/core/types";
import type { BlockContext, BlockDefinition, EvaluationModel } from "@flow-state-dev/core/types";
import { z } from "zod";
import { defineFitCheck, failedFitSchema } from "../fit-check";
import {
  needsBestFitCall,
  placeBestFit,
  type BestFitCase,
  type BestFitMiss,
  type BestFitPlacement
} from "../best-fit";
import { agentWorkerTurn, type AgentWorkerFlowOptions } from "../agent-worker-flow";
import { markUserTurn, userTurnStateSchema } from "../standing-rules/user-turn";
import { STANDING_RULES_ACTION, standingRulesAction } from "../standing-rules/rules-action";
import { filingSessionIdOf } from "../conversation-board/filing-session";
import { PROJECT_ROW_RESOURCES } from "../projects/project-address";
import {
  resolveWorkstreamTarget,
  WORKSTREAM_DELEGATE_ACTION,
  workstreamDelegateEntry,
  workstreamDelegateSeed
} from "../projects/project-coordinator";
import { isTerminalStatus, TaskWriteRefusedError, type Task, type TaskInit } from "@flow-state-dev/orchestration/tasks";
import { conversationLedgerAt } from "../conversation-board/ledger";
import { defineSessionBoard, WORKER_MESSAGE_SERVER_OWNED, workerMessageStateShape } from "../conversation-board/session-board";
import { workerTaskEntry } from "../conversation-board/task-entry";
import {
  CONVERSATION_BOARD_SERVER_OWNED,
  REPLY_CONCURRENCY,
  conversationBoardStateShape,
  routedEndingSchema,
  type RoutedEnding
} from "../conversation-board/task-settled";
import { WORKER_TASK_ENTRY } from "../worker-task-entry";
import { RESPOND_ACTION } from "../worker-door";
import { declareBuiltInRoles, markRolePiece } from "../worker-roles";
import { reportRescuedFailure } from "../error-reporter/rescued";
import { verifiedWorkerOf, workerConfigOf } from "../workers/verified-worker";
import { ROUTED_FROM_STATE_KEY, SET_WORK_PROJECT_ACTION, WORK_PROJECT_STATE_KEY, WORKER_ID_STATE_KEY } from "../workers/keys";
import { setWorkProjectAction } from "../projects/work-project";
import type { RosterWorker, WorkerInstallation } from "../workers/installation";
import {
  coordinatorConfigProblems,
  coordinatorConfigSchema,
  coordinatorRunsOwnTurn,
  type CoordinatorConfig,
  type CoordinatorRouting
} from "./coordinator-config";
import { DELEGATES_STATE } from "../delegates/delegate-keys";
import { delegateDefaultsOf, withRoster } from "../delegates/worker-delegates";
import {
  currentDelegates,
  delegateKey,
  delegateLabel,
  delegateRefSchema,
  readDelegates,
  sameDelegate,
  type DelegateRef,
  type DelegateRecord
} from "../delegates/delegate-list";
import {
  COORDINATOR_SERVER_OWNED,
  coordinatorSessionStateSchema,
  coordinatorStateShape,
  dropRetiredLedger,
  roundAnswerSchema,
  roundRobinCursorSchema,
  turnOrder,
  type OpenRound
} from "./coordinator-state";
import {
  COORDINATOR_JUDGMENT,
  COORDINATOR_FLOW,
  COORDINATOR_ROUTE,
  HOLD_STATE,
  LANDED_STATE,
  ROUND_DEADLINE_ACTION,
  ROUND_DEADLINE_MS,
  ROUND_ROBIN_STATE,
  ROUNDS_STATE,
  ROUTE_ON_ACTION
} from "./coordinator-keys";
import { coordinatorHistory, conversationLineSchema, keepLanded, linesField, readRecentLines } from "./coordinator-lines";
import {
  bestFitWhySchema,
  emitCoordinatorRoute,
  routedDelegateSchema,
  type BestFitWhy,
  type RoutedDelegate
} from "./coordinator-route";
import {
  MAX_OPEN_ROUNDS,
  anyOverdue,
  beginRound,
  closeOverdue,
  closeRound,
  endRound,
  landAnswer,
  othersOf,
  passedOn,
  roundDeadline,
  routeOnAfterAnswer,
  routeOnAfterClose,
  routeOnSchema,
  wakeMessage,
  type ClosedRound,
  type RoundPost,
  type RoundRead,
  type RoundRows,
  type RouteOn
} from "./coordinator-rounds";
import { routedBriefOf, routedTaskHistory, type RoutedBrief } from "./routed-brief";

/** What the coordinator flow is built from. */
export interface CoordinatorFlowOptions {
  /** The worker installation the coordinator's workers, and their delegates, belong to. */
  installation: WorkerInstallation;
  /**
   * The model best fit's one fit check (`../fit-check.ts`) runs on: a model string the app's
   * resolver turns into an evaluation model, or an evaluation model. Required;
   * the package names no default, and an evaluator takes no intent.
   */
  routeModel: string | EvaluationModel;
  /**
   * What the judgment turn is built with: the options the app gives the
   * built-in `agent` flow (its tool catalog, capabilities, skills and model
   * choices). Judgment is the agent's own turn, so a coordinator worker's
   * `model`, `tools`, `skills` and `capabilities` read the way an `agent`
   * worker's do, against the same catalog. Its `isolateUserState` keys this
   * flow's user-scoped storage by its copy, as it does the agent flow's.
   * Omitted, the agent's defaults.
   */
  agent?: Omit<AgentWorkerFlowOptions, "installation" | "taskLists" | "answerAgain">;
  /**
   * How long a round waits for its answers, in whole milliseconds, before it
   * closes without the ones still out and its answers go back out. Only a
   * coordinator whose `rounds:` is above 0 has rounds to close. Defaults to
   * five minutes ({@link ROUND_DEADLINE_MS}).
   */
  roundDeadlineMs?: number;
}

/** What best fit's one call is asked. */
const ROUTE_QUESTION =
  "Who should take the message? Read it with the recent lines before it: " +
  "a message that follows up on a delegate's answer goes to that delegate.";

/** The door's input: what the user says. */
const doorInputSchema = z.object({ message: z.string() });

type DoorInput = z.infer<typeof doorInputSchema>;

/** Request state: the post being routed, and what the turn needs of its worker. */
const POST_STATE = "coordinatorPost";

const postStateSchema = z.object({
  /** The user's post. Answers going back out keep its id, in a later round. */
  postId: z.string(),
  body: z.string(),
  from: z.string(),
  round: z.number().int().min(0),
  coordinator: z.string(),
  /** This conversation's id and incarnation, read from its session record when the post opened. */
  filingSessionId: z.string(),
  /** This conversation's recent lines before this request, read when the post opened. */
  recent: z.array(conversationLineSchema),
  policy: z.string(),
  defaults: z.object({ delegates: z.array(z.string()), fallback: z.string().optional() }),
  /** What each dispatch of the judgment turn came to. */
  dispatches: z.array(routedDelegateSchema),
  /** In a round after the user's post: the answers going back out. */
  answers: z.array(roundAnswerSchema).optional(),
  /** Who they never go back to: their author, under best fit and round robin. */
  exclude: delegateRefSchema.optional(),
  /** Why this round's answers go no further, when it was refused at the cap on open rounds. */
  note: z.string().optional(),
  /** Why best fit handed this post to the judgment turn, when it did: the turn's record says it. */
  fit: bestFitWhySchema.optional(),
  /** Best fit's evaluator error, when it failed and best fit asked again as a language model: every record says it. */
  evaluationFailed: z.string().optional()
});

export type PostState = z.infer<typeof postStateSchema>;

const requestStateSchema = z.object({ [POST_STATE]: postStateSchema.optional() });

/**
 * A request opened while `dispatches` had its old name, and resumed since, reads it as
 * `dispatches` (BP-030). Request state is not parsed on read, so this is the one reader.
 *
 * @internal Exported for its test.
 */
export function withDispatches(post: PostState): PostState {
  const { handOffs: legacy, ...rest } = post as PostState & { handOffs?: PostState["dispatches"] }; // retired-name-refusal: BP-030
  if (legacy === undefined) return post;
  return { ...rest, dispatches: rest.dispatches ?? legacy };
}

/** One routed task to file. */
const deliveryRequestSchema = z.object({
  postId: z.string(),
  round: z.number().int().min(0),
  delegate: delegateRefSchema,
  /** The flow the delegate's worker runs on. */
  flow: z.string(),
  body: z.string(),
  from: z.string(),
  coordinator: z.string(),
  /** The delivering conversation's id and incarnation, which the delegate's session carries. */
  filingSessionId: z.string(),
  /** The delivering conversation's recent lines, which the delegate is shown with the post. */
  recent: z.array(conversationLineSchema)
});

type DeliveryRequest = z.infer<typeof deliveryRequestSchema>;


/** Why best fit didn't use its evaluator's pick, in words. */
function missReason(miss: BestFitMiss): string {
  switch (miss.kind) {
    case "none-reachable":
      return "no delegate in this conversation can be reached";
    case "none-described":
      return "no delegate that can be reached has a note or a description to pick it by";
    case "evaluation-failed":
      return `the evaluation failed: ${miss.message}`;
    case "not-an-option":
      return `the evaluation answered ${JSON.stringify(miss.choice)}, which is not one of the choices`;
    case "below-floor":
      return `the evaluation picked "${miss.choice}" at confidence ${miss.confidence}, below the floor of ${miss.minConfidence}`;
    case "no-confidence":
      return `the evaluation picked "${miss.choice}" with no confidence, and the floor of ${miss.minConfidence} needs one`;
  }
}

/**
 * Why best fit didn't deliver to its pick, as the routing record's `fit`
 * says it: the pick of the coordinator itself, or the miss. Nothing is
 * filled in that the call didn't report.
 */
function fitOf(placed: Exclude<BestFitPlacement, { by: "held" | "evaluated" }>, minConfidence: number | undefined): BestFitWhy {
  const floor = minConfidence === undefined ? {} : { minConfidence };
  if (placed.by === "coordinator") {
    return {
      reason: "coordinator",
      choice: placed.worker,
      ...(placed.confidence === undefined ? {} : { confidence: placed.confidence }),
      ...floor
    };
  }
  const { miss } = placed;
  switch (miss.kind) {
    case "none-reachable":
    case "none-described":
      return { reason: "no-delegates" };
    case "evaluation-failed":
      return { reason: "failed" };
    case "not-an-option":
      return { reason: "not-a-choice", ...(typeof miss.choice === "string" ? { choice: miss.choice } : {}) };
    case "below-floor":
      return { reason: "below-floor", choice: miss.choice, confidence: miss.confidence, ...floor };
    case "no-confidence":
      return { reason: "no-confidence", choice: miss.choice, ...floor };
  }
}

/**
 * A routed task's id: one per message, round and delegate record, so a second
 * filing of the same pick finds the first. Each part is URI-encoded, since a
 * ledger keeps a task id to one path segment and a workstream target has
 * slashes.
 */
function routedTaskId(postId: string, round: number, delegate: DelegateRef): string {
  return `routed:${routedIdParts(postId, round, delegate)}`;
}

/**
 * The id a coordinator before FIX-2083 gave the same message to the same
 * delegate, as a post row (BP-030): a routing replayed across the upgrade
 * finds it, and files no second task for a pick already handed the message.
 */
function legacyPostRowId(postId: string, round: number, delegate: DelegateRef): string {
  return `post:${routedIdParts(postId, round, delegate)}`;
}

function routedIdParts(postId: string, round: number, delegate: DelegateRef): string {
  const parts = [postId, String(round), delegate.worker, ...(delegate.target === undefined ? [] : [delegate.target])];
  return parts.map(encodeURIComponent).join(":");
}

/** A routed task's answer: its output when that says something. An empty or blank one is no answer, whoever reads it. */
function answerOf(output: unknown): string | undefined {
  return typeof output === "string" && output.trim().length > 0 ? output : undefined;
}

/** A routed task's title in its user's list: the message's first line, cut short. */
function routedTitle(body: string): string {
  const first = body.trim().split("\n", 1)[0] ?? "";
  return first.length <= 80 ? first || "A message" : `${first.slice(0, 79)}…`;
}

/** The in-process round timers, by session and deadline: only where the host keeps no wakes (D2). */
const roundTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** The worker this conversation runs as: the one its turn loaded, else the one its session names. */
function verifiedCoordinatorId(ctx: BlockContext): string | undefined {
  const named = (ctx.session.state as Record<string, unknown> | undefined)?.[WORKER_ID_STATE_KEY];
  return verifiedWorkerOf(ctx.session) ?? (typeof named === "string" ? named : undefined);
}

/**
 * Build the coordinator flow.
 */
export function defineCoordinatorFlow(options: CoordinatorFlowOptions) {
  const { installation } = options;
  const deadlineMs = options.roundDeadlineMs ?? ROUND_DEADLINE_MS;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0) {
    throw new Error(
      `defineCoordinatorFlow: roundDeadlineMs must be a positive whole number of milliseconds, not ${deadlineMs}.`
    );
  }
  /**
   * The conversation's board and delegates (FIX-1802): the one delegate
   * check, the four delegate actions and tools, the eight task tools and
   * actions over its board.
   */
  const sessionBoard = defineSessionBoard({
    installation,
    flowKind: COORDINATOR_FLOW,
    // A project's coordinator starts with its user's open workstreams there.
    seed: (ctx) => workstreamDelegateSeed(ctx as never),
    // The judgment turn hands a message on with `createTask` and the routing
    // settings, on a turn routing one: the message comes from request state.
    routes: {
      routing: (ctx) => (ctx.request?.state as Record<string, unknown> | undefined)?.[POST_STATE] !== undefined,
      description:
        "On this turn you are routing a message: to hand it to one of this conversation's delegates, call " +
        'createTask with assignee (the delegate\'s worker id), session: "ongoing", resultTo: "conversation" and a goal ' +
        "saying what you want of it, and target when that delegate's record names a workstream. The delegate reads " +
        "the message as written, with your goal beside it, and its answer lands in this conversation under its name. " +
        "A delegate takes each message once per round; a new message is a new one, even when it repeats an earlier ask.",
      file: (ctx, init) => fileJudged(ctx, init)
    }
  });
  const check = sessionBoard.delegates.check;
  const resources = { ...installation.resources, ...PROJECT_ROW_RESOURCES };

  /**
   * The worker this conversation runs as, and its defaults, with the
   * conversation's seed while its list was never written. Refuses a session
   * that names none.
   */
  const coordinatorOf = async (ctx: BlockContext) => {
    const worker = await installation.resolveWorker(ctx, COORDINATOR_FLOW);
    const config = worker.config as unknown as CoordinatorConfig;
    const records = (ctx.session.state as Record<string, unknown>)[DELEGATES_STATE] == null
      ? await workstreamDelegateSeed(ctx as never)
      : undefined;
    // `delegates: all` is the roster as it stands, read now (FIX-2081 D2).
    const defaults = await withRoster(installation, ctx, delegateDefaultsOf(config as unknown as Record<string, unknown>));
    return { worker, config, defaults: { ...defaults, ...(records === undefined ? {} : { records }) } };
  };

  const blockBase = { resources, sessionStateSchema: coordinatorSessionStateSchema };

  // -------------------------------------------------------------------------
  // The one filing step: one routed task on the conversation's board per
  // delegate picked, by every policy and every round, and by the judgment
  // turn's filing on a turn routing a message.
  // -------------------------------------------------------------------------

  /** The open rounds, as saved. A round saved before it counted its routings reads as having begun none (BP-030). */
  const roundsIn = (state: Readonly<Record<string, unknown>>) =>
    ((state[ROUNDS_STATE] ?? []) as Array<Omit<OpenRound, "begun"> & { begun?: number }>).map(
      ({ ended: _ended, ...open }: Omit<OpenRound, "begun"> & { begun?: number; ended?: unknown }): OpenRound => ({
        ...open,
        begun: open.begun ?? 0
      })
    );

  /**
   * The open rounds' tasks, read off the conversation's board before a write
   * that may close one: one read of the board, grouped by the message and
   * round their briefs carry (a post row stored before FIX-2083 carries both
   * too), after the rounds themselves are read, so the write can tell a
   * routing filed tasks since. A round the read didn't see (opened since)
   * can't close on it. An answer is a reply only when it says something, as
   * `routedEnded` reads it: an empty one is no answer, and holds no round.
   */
  const roundRowsOf = async (ctx: BlockContext): Promise<RoundRows> => {
    const open = roundsIn(ctx.session.state);
    const ref = open.length === 0 ? undefined : await conversationLedgerAt(ctx, await filingSessionIdOf(ctx.session));
    const byRound = new Map<string, Task[]>();
    for (const row of ref?.list() ?? []) {
      const brief = routedBriefOf(row);
      if (brief === undefined) continue;
      const key = JSON.stringify([brief.postId, brief.round]);
      byRound.set(key, [...(byRound.get(key) ?? []), row]);
    }
    const read = new Map<string, RoundRead>();
    for (const { postId, round, begun, opening } of open) {
      const rows = byRound.get(JSON.stringify([postId, round])) ?? [];
      const replied = rows.flatMap((row) => {
        const brief = row.status === "completed" && answerOf(row.output) !== undefined ? routedBriefOf(row) : undefined;
        return brief === undefined ? [] : [brief.delegate];
      });
      read.set(JSON.stringify([postId, round]), {
        ids: rows.map((row) => row.id),
        running: rows.some((row) => !isTerminalStatus(row.status)),
        replied,
        begun,
        opening
      });
    }
    const unseen: RoundRead = { ids: [], running: false, replied: [], begun: -1, opening: 0 };
    return (postId, round) => read.get(JSON.stringify([postId, round])) ?? unseen;
  };

  /**
   * Owe this conversation's round-deadline wake at `dueAt` (D2): the engine's
   * sweeper fires {@link ROUND_DEADLINE_ACTION} here then, after a restart
   * too, earlier due times winning. A host that keeps no wakes keeps an
   * in-process timer instead, which a restart loses, as today.
   */
  const oweRoundDeadline = async (ctx: BlockContext, dueAt: number): Promise<void> => {
    const wakes = ctx.requestHost?.wakes;
    if (wakes !== undefined) {
      try {
        if (await wakes.owe({ entry: ROUND_DEADLINE_ACTION, dueAt })) return;
      } catch (error) {
        // Not kept: the timer below stands in.
        console.warn("[workforce] a round's deadline wake couldn't be written; an in-process timer stands in", {
          error: (error as Error).message
        });
      }
    }
    const key = `${(ctx.session.identity as { tenantId?: string }).tenantId ?? ""}\u0000${ctx.session.identity.id}\u0000${dueAt}`;
    if (roundTimers.has(key)) return;
    const timer = setTimeout(() => {
      roundTimers.delete(key);
      void dispatchThroughSeam(ctx, {
        type: "internal",
        action: ROUND_DEADLINE_ACTION,
        session: { id: ctx.session.identity.id },
        payload: {},
        from: "coordinator-round-timer"
      }).catch(() => undefined);
    }, Math.max(0, dueAt - Date.now()));
    (timer as { unref?: () => void }).unref?.();
    roundTimers.set(key, timer);
  };

  /**
   * The one filing step (FIX-2083): hand the message to one delegate record by
   * filing a routed task on this conversation's board, and start it. The id is
   * derived from the message, the round and the record, so a delegate already
   * handed this message in this round files nothing. In a round below the
   * limit, its round's first task sets the round's deadline, owed as a wake. A
   * record with a target runs in the session its target names now; one whose
   * target names none yet files nothing.
   *
   * @param filing What the judgment turn's model filed with, kept beside the
   *   brief: its goal and the rest. A policy files the message as the goal.
   * @returns What the pick came to, and the task when one was filed or found.
   */
  const routeTask = async (
    ctx: BlockContext,
    request: DeliveryRequest,
    filing?: TaskInit
  ): Promise<{ routed: RoutedDelegate; taskId?: string }> => {
    const named = bare(request.delegate);
    const now = Date.now();
    // The judgment turn's tool call: the same on its replay. A policy's filing has none.
    const call = filing === undefined ? undefined : logicalBlockIdOf(ctx);
    // Owed before the write that sets the deadline, as the wake contract has
    // it: a crash between leaves a wake with nothing to close, never a
    // deadline with no wake. A routing that sets none after all leaves an
    // extra wake, which closes nothing.
    const planned = roundDeadline(roundsIn(ctx.session.state), request.postId, request.round, now, deadlineMs).deadlineAt;
    if (planned !== undefined) await oweRoundDeadline(ctx, planned);
    const timed = await withOutcome(
      (mutator: (state: Readonly<Record<string, unknown>>) => Record<string, unknown>) =>
        ctx.session.atomicState(mutator as never),
      (state: Readonly<Record<string, unknown>>) => {
        const rounds = roundsIn(state);
        const deadline = roundDeadline(rounds, request.postId, request.round, now, deadlineMs);
        return {
          state: { ...(deadline.deadlineAt === undefined ? {} : { [ROUNDS_STATE]: deadline.rounds }), ...dropRetiredLedger(state) },
          result: deadline.deadlineAt
        };
      }
    );
    // Another routing's write landed first with another deadline: owe that one too.
    if (timed !== undefined && timed !== planned) await oweRoundDeadline(ctx, timed);
    // A record with a target runs in the session its target names now.
    let targetSessionId: string | undefined;
    if (named.target !== undefined) {
      const resolved = await resolveWorkstreamTarget(ctx as never, { worker: named.worker, target: named.target });
      if ("problem" in resolved) return { routed: { ...named, outcome: "failed", reason: resolved.problem } };
      targetSessionId = resolved.sessionId;
    }
    const brief: RoutedBrief = {
      body: request.body,
      from: request.from,
      coordinator: request.coordinator,
      postId: request.postId,
      round: request.round,
      delegate: named,
      ...linesField(request.recent),
      // The judgment turn's call, so a replay of it finds its own task (BR-15).
      ...(call !== undefined ? { call } : {})
    };
    const id = routedTaskId(request.postId, request.round, named);
    const handedBefore = { routed: { ...named, outcome: "skipped" as const, reason: "it was already handed this message in this round" } };
    // Handed this message before the upgrade, as a post row (BP-030).
    const legacyId = legacyPostRowId(request.postId, request.round, named);
    if ((await conversationLedgerAt(ctx, request.filingSessionId))?.get(legacyId) !== undefined) return { ...handedBefore, taskId: legacyId };
    try {
      const filed = await sessionBoard.fileRouted(ctx as never, {
        // What the judgment turn's model asked beside the message: its goal,
        // its title and the rest. Never its id, its settings or a payload.
        ...(filing?.title !== undefined ? { title: filing.title } : { title: routedTitle(request.body) }),
        ...(filing?.context !== undefined ? { context: filing.context } : {}),
        ...(filing?.input !== undefined ? { input: filing.input } : {}),
        ...(filing?.labels !== undefined ? { labels: filing.labels } : {}),
        ...(filing?.priority !== undefined ? { priority: filing.priority } : {}),
        ...(filing?.metadata !== undefined ? { metadata: filing.metadata } : {}),
        ...(filing?.session !== undefined ? { session: filing.session } : { session: "ongoing" as const }),
        goal: filing?.goal ?? request.body,
        id,
        assignee: named.worker,
        resultTo: "conversation",
        // A routed task has one attempt (FIX-2080's rule for a conversation-result task).
        maxAttempts: 1,
        ...(named.target !== undefined ? { target: named.target, targetSessionId } : {}),
        sealed: brief
      });
      if (filed === "exists") {
        // The same tool call replayed after a crash: its own task, filed the first time.
        const same = brief.call !== undefined
          && routedBriefOf((await conversationLedgerAt(ctx, request.filingSessionId))?.get(id))?.call === brief.call;
        return same ? { routed: { ...named, outcome: "delivered" }, taskId: id } : { ...handedBefore, taskId: id };
      }
      return { routed: { ...named, outcome: "delivered" }, taskId: id };
    } catch (error) {
      if (ctx.signal.aborted) throw error;
      return { routed: { ...named, outcome: "failed", reason: error instanceof Error ? error.message : String(error) } };
    }
  };

  /** {@link routeTask} as a step: a fixed policy hands each of its picks to it. */
  const deliverOne = handler({
    name: "coordinator-deliver",
    inputSchema: deliveryRequestSchema,
    outputSchema: routedDelegateSchema,
    sessionStateSchema: coordinatorSessionStateSchema,
    resources,
    execute: async (request: DeliveryRequest, ctx) => (await routeTask(ctx as never, request)).routed
  });

  // -------------------------------------------------------------------------
  // The message being routed: open it, then route it by the conversation's
  // policy. Its request state keeps the name it had as a post (BP-030).
  // -------------------------------------------------------------------------

  /** The message being routed, from request state. Set by the door before anything routes. */
  const postOf = (ctx: BlockContext): PostState => {
    const post = (ctx.request.state as Record<string, unknown>)[POST_STATE] as PostState | undefined;
    if (post === undefined) throw new Error("No message is being routed in this request.");
    // A request opened before posts carried their lines, and resumed since, reads as having none (BP-030).
    return withDispatches(post.recent === undefined ? { ...post, recent: [] } : post);
  };

  /** A delegate record as a delivery names it: its worker, and its target when it has one. */
  const bare = (delegate: DelegateRef): DelegateRef => ({
    worker: delegate.worker,
    ...(delegate.target === undefined ? {} : { target: delegate.target })
  });

  /**
   * A delivery of this request's post to `delegate`, which runs on `flow`:
   * the post as it stands, or `passed`, the answers this delegate is handed,
   * with the conversation's recent lines either way.
   */
  const deliveryOf = (
    post: PostState,
    delegate: DelegateRef,
    flow: string,
    passed: { from: string; body: string } = post
  ): DeliveryRequest => ({
    postId: post.postId,
    round: post.round,
    delegate: bare(delegate),
    flow,
    body: passed.body,
    from: passed.from,
    coordinator: post.coordinator,
    filingSessionId: post.filingSessionId,
    recent: post.recent
  });

  /** What every record of this request's routing starts with, its note and best fit's evaluator error included when it has them. */
  const recordOf = (post: PostState) => ({
    postId: post.postId,
    round: post.round,
    policy: post.policy,
    ...(post.note === undefined ? {} : { note: post.note }),
    ...(post.evaluationFailed === undefined ? {} : { evaluationFailed: post.evaluationFailed })
  });

  /** What the judgment turn reads: the user's post, or the answers going back out. */
  const turnMessage = (post: PostState): string =>
    post.answers === undefined ? post.body : wakeMessage(post.round - 1, post.answers);

  /** The post state every routing of this conversation starts from. */
  const postStateOf = async (
    ctx: BlockContext,
    opening: Pick<PostState, "postId" | "body" | "from" | "round"> & Partial<Pick<PostState, "answers" | "exclude">>
  ) => {
    const { worker, config, defaults } = await coordinatorOf(ctx);
    // The first read seeds the conversation's copy of the defaults.
    await readDelegates(ctx.session, defaults);
    const post: PostState = {
      ...opening,
      coordinator: worker.id,
      filingSessionId: await filingSessionIdOf(ctx.session),
      // Read once, from the conversation's own items, and carried to best fit and every delivery.
      recent: readRecentLines(ctx.session, {
        user: ctx.session.identity.userId ?? "",
        coordinator: worker.id,
        coordinatorNames: turn.answerNames
      }),
      policy: config.routing,
      defaults: { delegates: [...defaults.delegates], ...(defaults.fallback === undefined ? {} : { fallback: defaults.fallback }) },
      dispatches: []
    };
    // Below the limit, this round waits for its answers so they can go back out.
    // `beginRound` counts the routings adding to a round: under best fit or round
    // robin, each answer of a round with several deliveries goes on into the next
    // round in a request of its own, and the round must not close until both have
    // added their deliveries.
    if (post.round < config.rounds) {
      const begun = await withOutcome(
        (mutator: (state: Readonly<Record<string, unknown>>) => Record<string, unknown>) =>
          ctx.session.atomicState(mutator as never),
        (state: Readonly<Record<string, unknown>>) => {
          const result = beginRound(roundsIn(state), post.postId, post.round);
          return { state: result.opened ? { [ROUNDS_STATE]: result.rounds } : {}, result: result.opened };
        }
      );
      if (begun === false) {
        post.note =
          `this conversation already has ${MAX_OPEN_ROUNDS} rounds waiting for answers, ` +
          `so answers in round ${post.round} go no further`;
      }
    }
    await ctx.request.patchState({ [POST_STATE]: post } as never);
    return post;
  };

  const openPost = handler({
    name: "coordinator-open-post",
    inputSchema: doorInputSchema,
    outputSchema: z.object({ message: z.string(), policy: z.string() }),
    ...blockBase,
    // Declares the user-turn mark it sets, as the agent flow's marking step does.
    requestStateSchema: requestStateSchema.merge(userTurnStateSchema),
    execute: async (input: DoorInput, ctx) => {
      const post = await postStateOf(ctx as never, {
        postId: ctx.request.identity.id,
        body: input.message,
        from: ctx.session.identity.userId ?? "",
        round: 0
      });
      // A user's own post: the judgment turn it runs is offered the rule
      // tools (FIX-1945 D2). A round that sends answers back out is not.
      await markUserTurn(ctx as never);
      return { message: input.message, policy: post.policy };
    }
  });

  // --- judgment ------------------------------------------------------------

  /** The sentence a refused routing ends with: who on the list takes a task now, by the same check. */
  const taskTakers = async (ctx: BlockContext, delegates: readonly DelegateRecord[]): Promise<string> => {
    const takers: string[] = [];
    for (const { worker } of delegates) {
      if (!takers.includes(worker) && (await check(ctx as never, worker, "task")).ok) takers.push(worker);
    }
    return takers.length === 0 ? "No delegate here takes a task." : `Delegates here that take one: ${takers.join(", ")}.`;
  };

  /**
   * Whether the coordinator may hand this message to `assignee`: on the list,
   * and passing the check now. A listed delegate the check refuses is refused
   * with the delegates that would take it.
   */
  const judgedDelivery = async (
    ctx: BlockContext,
    post: PostState,
    call: { assignee: string; target?: string }
  ): Promise<DeliveryRequest | { refused: string }> => {
    // Read now, through the versioned read: an add earlier in this turn is on it.
    const listed = currentDelegates(ctx.session.state, post.defaults);
    const named = { worker: call.assignee, ...(call.target === undefined ? {} : { target: call.target }) };
    // Without a target, the worker's one record, whatever its target.
    const records = listed.delegates.filter((candidate) =>
      call.target === undefined ? candidate.worker === call.assignee : sameDelegate(candidate, named)
    );
    if (records.length === 0) return { refused: `"${delegateLabel(named)}" isn't a delegate in this conversation. Add it first.` };
    if (records.length > 1) {
      return {
        refused:
          `"${call.assignee}" is ${records.length} delegates here: ${records.map(delegateLabel).join(", ")}. ` +
          `Name the one you mean by its target.`
      };
    }
    const record = records[0]!;
    // Routing never hands a message to the coordinator itself, whatever its list says.
    if (record.worker === verifiedCoordinatorId(ctx)) {
      return { refused: `"${record.worker}" is you: answer the message yourself rather than file it for yourself.` };
    }
    const checked = await check(ctx as never, record.worker, "task");
    if (!checked.ok) return { refused: `${checked.message} ${await taskTakers(ctx as never, listed.delegates)}` };
    return deliveryOf(post, record, checked.worker.flow);
  };

  /**
   * The judgment turn's filing on a turn routing a message (FIX-2083): a
   * `createTask` whose result goes to this conversation, handed here by the
   * board. The message comes from this request's state, never from the
   * model, which names the delegate and says what it wants of it. Filed by the
   * one filing step, so the task is the same routed task a policy files. What
   * it came to is kept for the turn's record; a pick that files nothing is a
   * refusal the model reads.
   */
  const fileJudged = async (ctx: BlockContext, init: TaskInit): Promise<Task> => {
    const post = postOf(ctx);
    // A routed task starts now, in the delegate's ongoing session, and stands
    // alone: a setting that says otherwise is refused, never dropped.
    if (init.session !== undefined && init.session !== "ongoing") {
      throw new TaskWriteRefusedError(
        "routed_session_ongoing",
        `a message handed on runs in the delegate's ongoing session for this conversation, so give session: "ongoing" ` +
          `or leave session out, not "${init.session}". Nothing was filed.`
      );
    }
    const unrouted = (["held", "deps", "followUpOf"] as const).filter((field) =>
      field === "held" ? init.held === true : field === "deps" ? (init.deps?.length ?? 0) > 0 : init.followUpOf !== undefined
    );
    if (unrouted.length > 0) {
      throw new TaskWriteRefusedError(
        "routed_task_starts_now",
        `a message handed on starts now and waits on nothing, so its task takes no ${unrouted.join(" or ")}. ` +
          `To file work for later, leave resultTo out. Nothing was filed.`
      );
    }
    if (init.assignee === undefined) {
      const listed = currentDelegates(ctx.session.state, post.defaults);
      throw new TaskWriteRefusedError(
        "routed_assignee_required",
        `name the delegate to hand the message to with assignee. ${await taskTakers(ctx, listed.delegates)} Nothing was filed.`
      );
    }
    const judged = await judgedDelivery(ctx, post, { assignee: init.assignee, ...(init.target === undefined ? {} : { target: init.target }) });
    const filed =
      "refused" in judged
        ? { routed: { worker: init.assignee, outcome: "skipped" as const, reason: judged.refused } }
        : await routeTask(ctx, judged, init);
    await ctx.request.patchState(POST_STATE as never, ((state: PostState) => {
      const current = withDispatches(state);
      // A replayed call's delivery is recorded once: a delegate takes the message once a round.
      const again = filed.routed.outcome === "delivered" && current.dispatches.some((entry) => entry.outcome === "delivered" && sameDelegate(entry, filed.routed));
      return again ? current : { ...current, dispatches: [...current.dispatches, filed.routed] };
    }) as never);
    const row = filed.taskId === undefined ? undefined : (await conversationLedgerAt(ctx, post.filingSessionId))?.get(filed.taskId);
    if (filed.routed.outcome === "delivered" && row !== undefined) return row;
    // A refusal's reason is a sentence of its own, often with its period.
    throw new TaskWriteRefusedError(
      "not_routed",
      `not handed to ${filed.routed.worker}: ${(filed.routed.reason ?? filed.routed.outcome).replace(/\.$/, "")}. Nothing was filed.`,
      filed.taskId
    );
  };

  // -------------------------------------------------------------------------
  // Tasks: the conversation's board, filed for its delegates (FIX-1794).
  // -------------------------------------------------------------------------

  /**
   * The judgment turn: the built-in agent's own turn, shared rather than
   * copied, run as this conversation's worker. It reads the worker's
   * instructions, model, tools, skills and capabilities as an `agent` worker's
   * are read, and carries the delegate tools (`listDelegates`, and the three
   * that change the list on one set to `editsOwnDelegates`), the dispatch
   * tool and the task tools on every coordinator, whatever the worker's
   * `tools:` line grants. The task tools come from one capability instance, the
   * conversation's board's, composed by the turn once, so no skill or preset
   * adds a second set; they are on a turn while one of its delegates takes a
   * task.
   */
  const turn = agentWorkerTurn(
    { ...(options.agent ?? {}), installation },
    {
      kind: COORDINATOR_FLOW,
      answerName: COORDINATOR_JUDGMENT,
      board: sessionBoard,
      // The turn's model reads a delegate's answer as a line from that
      // delegate, never as its own reply, and a message the routing handed on
      // as handled (`coordinatorHistory`).
      history: async (input, ctx) =>
        coordinatorHistory(
          await routedTaskHistory(input, ctx),
          [
            ...ctx.session.items.all({ itemTypes: ["message"], itemVisibility: { client: true, history: true } }),
            ...ctx.session.items.all({ itemTypes: ["component"] })
          ],
          turn.answerNames
        )
    }
  );

  /** A task handed to a coordinator worker: one turn of its own, the task as the message. */
  const taskEntry = workerTaskEntry({ name: "coordinator-task-turn", turn: turn.run });

  /** The judgment turn's one record: each dispatch it made, or that it answered itself. */
  const recordJudgment = handler({
    name: "coordinator-record-judgment",
    inputSchema: z.unknown(),
    outputSchema: z.object({}),
    requestStateSchema,
    execute: async (_reply: unknown, ctx) => {
      const post = postOf(ctx as never);
      await emitCoordinatorRoute(ctx as never, {
        ...recordOf(post),
        by: "judgment",
        delegates: post.dispatches,
        ...(post.dispatches.some((dispatch) => dispatch.outcome === "delivered")
          ? {}
          : { none: "the coordinator handed it to no delegate" }),
        ...(post.fit === undefined ? {} : { fit: post.fit })
      });
      return {};
    }
  });

  const judgmentTurn = sequencer({ name: "coordinator-judgment-turn", inputSchema: doorInputSchema })
    .step(turn.run)
    .tap(recordJudgment);

  // --- the fixed policies' one scan ----------------------------------------

  /** What a policy does with one delegate that can be reached: take it, skip it with why, or take it and stop. */
  type Visit = void | "stop" | { skip: string };

  /**
   * One reachability scan for best fit, round robin and everyone: each
   * record in the order given (never `exclude`, never the coordinator
   * itself), checked for a task now. One that can't be reached is skipped
   * with the check's answer; each one that can goes to `visit`. Skips come
   * back in scan order, so every policy words them the same way.
   */
  const scanReachable = async (
    ctx: BlockContext,
    records: Iterable<DelegateRecord> | AsyncIterable<DelegateRecord>,
    exclude: DelegateRef | undefined,
    visit: (record: DelegateRecord, worker: RosterWorker) => Visit
  ): Promise<RoutedDelegate[]> => {
    const skipped: RoutedDelegate[] = [];
    const self = verifiedCoordinatorId(ctx);
    for await (const record of records) {
      if (exclude !== undefined && sameDelegate(record, exclude)) continue;
      // Routing never picks the coordinator itself: no routed task lands on its own plan.
      if (record.worker === self) continue;
      const checked = await check(ctx as never, record.worker, "task");
      if (!checked.ok) {
        skipped.push({ ...bare(record), outcome: "skipped", reason: checked.message });
        continue;
      }
      const visited = visit(record, checked.worker);
      if (visited === "stop") break;
      if (visited !== undefined) skipped.push({ ...bare(record), outcome: "skipped", reason: visited.skip });
    }
    return skipped;
  };

  // --- best fit ------------------------------------------------------------

  const bestFitCaseSchema = z.object({
    ladder: z.object({
      held: z.string().optional(),
      reachable: z.array(z.string()),
      options: z.record(z.string()),
      fallback: z.string().optional(),
      coordinator: z.string().optional(),
      minConfidence: z.number().optional()
    }),
    /** Each reachable delegate, by its label, with the flow it runs on. */
    byLabel: z.record(z.object({ delegate: delegateRefSchema, flow: z.string() })),
    skipped: z.array(routedDelegateSchema),
    /** The conversation's recent lines before the post, oldest first. */
    recent: z.array(conversationLineSchema),
    post: z.object({ from: z.string(), text: z.string() })
  });

  type BestFitCaseValue = z.infer<typeof bestFitCaseSchema>;

  /**
   * One roster read per post: every delegate checked now, the options, the
   * holder and the fallback. An answer going back out is never offered to its
   * own author, and holds nothing: the hold is about a user's posts.
   *
   * On a user's post, the coordinator is a choice too, keyed by its worker
   * id and picked by its description, when it has one. Its floor, from its
   * configuration, applies on every round. Both come from the worker and the
   * roster, never from the post.
   */
  const readBestFitCase = handler({
    name: "coordinator-best-fit-case",
    inputSchema: z.unknown(),
    outputSchema: bestFitCaseSchema,
    ...blockBase,
    requestStateSchema,
    execute: async (_input, ctx): Promise<BestFitCaseValue> => {
      const post = postOf(ctx as never);
      const listed = currentDelegates(ctx.session.state, post.defaults);
      const reachable: string[] = [];
      const options: Record<string, string> = {};
      const byLabel: BestFitCaseValue["byLabel"] = {};
      const skipped = await scanReachable(ctx as never, listed.delegates, post.exclude, (record, worker) => {
        const label = delegateLabel(record);
        reachable.push(label);
        byLabel[label] = { delegate: bare(record), flow: worker.flow };
        const pickBy = record.note ?? worker.description ?? undefined;
        if (pickBy !== undefined) options[label] = pickBy;
      });
      const hold =
        post.round === 0
          ? coordinatorSessionStateSchema.shape[HOLD_STATE].parse(ctx.session.state[HOLD_STATE] ?? null)
          : null;
      const held = hold === null ? undefined : delegateLabel(hold.delegate);
      const fallback = listed.fallback === null ? undefined : delegateLabel(listed.fallback);
      const { worker, config } = await coordinatorOf(ctx as never);
      const offersSelf = post.round === 0 && worker.description !== null;
      if (offersSelf) options[worker.id] = worker.description!;
      return {
        ladder: {
          ...(held !== undefined && reachable.includes(held) ? { held } : {}),
          reachable,
          options,
          ...(fallback === undefined ? {} : { fallback }),
          ...(offersSelf ? { coordinator: worker.id } : {}),
          ...(config.minConfidence === undefined ? {} : { minConfidence: config.minConfidence })
        },
        byLabel,
        skipped,
        recent: post.recent,
        post: { from: post.from, text: post.body }
      };
    }
  });

  /** Keep the evaluator's error on the post before asking again, so the record says the call failed. */
  const noteEvaluationFailed = handler({
    name: "coordinator-route-note-failed",
    inputSchema: failedFitSchema,
    outputSchema: z.object({}),
    requestStateSchema,
    execute: async (evaluated, ctx) => {
      await ctx.request.patchState(POST_STATE as never, ((state: PostState) => ({
        ...state,
        evaluationFailed: evaluated.failed
      })) as never);
      return {};
    }
  });

  /**
   * Best fit's one call, the one fit check: which delegate answers the post,
   * read with the conversation's recent lines before it. Its state is
   * `{ recent, post }`, each line and the post as `{ from, text }`; a
   * scripted evaluation reads that shape.
   */
  const askRoute = defineFitCheck({
    name: COORDINATOR_ROUTE,
    model: options.routeModel,
    inputSchema: bestFitCaseSchema,
    question: ROUTE_QUESTION,
    candidates: (bestFit: BestFitCaseValue) => bestFit.ladder.options,
    state: (bestFit: BestFitCaseValue) => ({ recent: bestFit.recent, post: bestFit.post }),
    work: (bestFit: BestFitCaseValue) =>
      [
        ...bestFit.recent.map((line) => `${line.from}: ${line.text}`),
        `The post, from ${bestFit.post.from}: ${bestFit.post.text}`
      ].join("\n"),
    onEvaluationFailed: noteEvaluationFailed
  });

  /** Where a fixed policy put the post: deliveries to make, best fit's miss for judgment, or nobody. */
  const placedSchema = z.union([
    z.object({
      place: z.literal("deliver"),
      by: z.enum(["held", "evaluated", "fallback", "round-robin", "everyone"]),
      picks: z.array(deliveryRequestSchema),
      skipped: z.array(routedDelegateSchema),
      /** Under best fit, by the fallback: why best fit didn't deliver to its pick. */
      fit: bestFitWhySchema.optional()
    }),
    z.object({ place: z.literal("judgment"), reason: z.string(), skipped: z.array(routedDelegateSchema) }),
    z.object({ place: z.literal("unplaced"), reason: z.string(), skipped: z.array(routedDelegateSchema) })
  ]);

  type Placed = z.infer<typeof placedSchema>;

  /**
   * Place the post on best fit's ladder, and note who now holds the user's
   * next post. A post the judgment turn takes, picked for the coordinator or
   * missed, carries why in request state, for the turn's record.
   */
  const placeBestFitPost = handler({
    name: "coordinator-best-fit-place",
    inputSchema: z.unknown(),
    outputSchema: placedSchema,
    sessionStateSchema: coordinatorSessionStateSchema,
    requestStateSchema,
    execute: async (answer: unknown, ctx): Promise<Placed> => {
      const bestFit = bestFitCaseSchema.parse(ctx.parent?.input);
      const post = postOf(ctx as never);
      const placed = placeBestFit(bestFit.ladder as BestFitCase, answer);
      // Only a user's post moves the hold.
      const holds = post.round === 0;
      if (placed.by === "none" || placed.by === "coordinator") {
        if (holds) await ctx.session.patchState({ [HOLD_STATE]: null } as never);
        const fit = fitOf(placed, bestFit.ladder.minConfidence);
        await ctx.request.patchState(POST_STATE as never, ((state: PostState) => ({ ...state, fit })) as never);
        const reason =
          placed.by === "coordinator"
            ? "the evaluation picked the coordinator"
            : missReason(placed.miss) + (placed.fallbackUnreachable ? "; the fallback delegate can't be reached" : "");
        return { place: "judgment", reason, skipped: bestFit.skipped };
      }
      const target = bestFit.byLabel[placed.worker]!;
      if (holds) {
        await ctx.session.patchState({ [HOLD_STATE]: { postId: post.postId, delegate: target.delegate } } as never);
      }
      return {
        place: "deliver",
        by: placed.by,
        picks: [deliveryOf(post, target.delegate, target.flow)],
        skipped: bestFit.skipped,
        ...(placed.by === "fallback" ? { fit: fitOf(placed, bestFit.ladder.minConfidence) } : {})
      };
    }
  });

  const decideBestFit = sequencer({ name: "coordinator-best-fit-decide", inputSchema: bestFitCaseSchema })
    .stepIf(
      (bestFit: BestFitCaseValue) => needsBestFitCall(bestFit.ladder as BestFitCase),
      askRoute
    )
    .step(placeBestFitPost);

  /** Record a fixed policy's decision: what each pick came to, and who was skipped. */
  const recordPlaced = handler({
    name: "coordinator-record-placed",
    inputSchema: z.array(routedDelegateSchema),
    outputSchema: z.object({ routed: z.array(routedDelegateSchema) }),
    requestStateSchema,
    execute: async (outcomes: RoutedDelegate[], ctx) => {
      const placed = placedSchema.parse(ctx.parent?.input);
      const post = postOf(ctx as never);
      const delegates = [...(placed.place === "deliver" ? outcomes : []), ...placed.skipped];
      const delivered = outcomes.some((outcome) => outcome.outcome === "delivered");
      await emitCoordinatorRoute(ctx as never, {
        ...recordOf(post),
        by: placed.place === "deliver" ? placed.by : "unplaced",
        delegates,
        ...(delivered ? {} : { none: "no pick could be delivered" }),
        ...(placed.place === "deliver" && placed.fit !== undefined ? { fit: placed.fit } : {})
      });
      return { routed: delegates };
    }
  });

  const deliverPicks = sequencer({ name: "coordinator-deliver-picks", inputSchema: placedSchema })
    .forEach((placed: Placed) => (placed.place === "deliver" ? placed.picks : []), deliverOne)
    .step(recordPlaced);

  /** Nobody took the message: recorded, and said in the conversation. */
  const unplaced = handler({
    name: "coordinator-unplaced",
    inputSchema: z.unknown(),
    outputSchema: z.object({ unplaced: z.string() }),
    requestStateSchema,
    execute: async (error: unknown, ctx) => {
      if (ctx.signal.aborted) throw error;
      const post = postOf(ctx as never);
      const why = `best fit couldn't place it, and the coordinator's own turn failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
      await emitCoordinatorRoute(ctx as never, {
        ...recordOf(post),
        by: "unplaced",
        delegates: [],
        none: why,
        ...(post.fit === undefined ? {} : { fit: post.fit })
      });
      // The request completes on this answer, so no final failure is sent for it: the crash is reported here.
      await reportRescuedFailure(ctx as never, {
        flowKind: COORDINATOR_FLOW,
        actionName: post.round === 0 ? RESPOND_ACTION : ROUTE_ON_ACTION,
        blockName: COORDINATOR_JUDGMENT,
        error
      });
      // A user's post is answered in the conversation; answers going back out aren't.
      if (post.round === 0) ctx.emit.message(`Nobody took this message: ${why}.`);
      return { unplaced: why };
    }
  });

  const judgmentAfterBestFit = (judgmentTurn.rescue([{ block: unplaced }]) as BlockDefinition<any, any>).connectInput(
    (_placed: unknown, ctx: BlockContext) => ({ message: turnMessage(postOf(ctx)) })
  );

  /**
   * A fixed policy found nobody to take the post: recorded, and on a user's
   * post said in the conversation.
   */
  const recordNobody = handler({
    name: "coordinator-record-nobody",
    inputSchema: placedSchema,
    outputSchema: z.object({ unplaced: z.string() }),
    requestStateSchema,
    execute: async (placed: Placed, ctx) => {
      const post = postOf(ctx as never);
      const reason = placed.place === "deliver" ? "no pick could be delivered" : placed.reason;
      await emitCoordinatorRoute(ctx as never, {
        ...recordOf(post),
        by: "unplaced",
        delegates: placed.skipped,
        none: reason
      });
      if (post.round === 0) ctx.emit.message(`Nobody took this message: ${reason}.`);
      return { unplaced: reason };
    }
  });

  const afterPlace = router({
    name: "coordinator-best-fit-after",
    inputSchema: placedSchema,
    routes: [deliverPicks, judgmentAfterBestFit, recordNobody],
    execute: (placed: Placed) =>
      placed.place === "deliver" ? deliverPicks : placed.place === "judgment" ? judgmentAfterBestFit : recordNobody
  } as never) as BlockDefinition<any, any>;

  const bestFit = sequencer({ name: "coordinator-best-fit", inputSchema: z.unknown() })
    .step(readBestFitCase)
    .step(decideBestFit)
    .step(afterPlace);

  // --- round robin ---------------------------------------------------------

  /** Where a delegate record stands in a list, or -1. */
  const indexIn = (list: readonly DelegateRecord[], delegate: DelegateRef) =>
    list.findIndex((record) => sameDelegate(record, delegate));

  /**
   * Round robin's turns for a user's post, each claimed before it is
   * checked: one versioned write moves the turn to the next delegate after
   * where it stands now, so two posts at once never take the same turn. A
   * delegate already tried is passed over; the turns end once each has been
   * tried.
   */
  async function* claimTurns(ctx: BlockContext, list: readonly DelegateRecord[]): AsyncGenerator<DelegateRecord> {
    const tried = new Set<string>();
    for (;;) {
      const claimed = await withOutcome(
        (mutator: (state: Readonly<Record<string, unknown>>) => Record<string, unknown>) =>
          ctx.session.atomicState(mutator as never),
        (state: Readonly<Record<string, unknown>>) => {
          const cursor = roundRobinCursorSchema.nullable().parse(state[ROUND_ROBIN_STATE] ?? null);
          const next = turnOrder(list, cursor).find((record) => !tried.has(delegateKey(record)));
          if (next === undefined) return { state: {}, result: null };
          return { state: { [ROUND_ROBIN_STATE]: { delegate: bare(next), index: indexIn(list, next) } }, result: next };
        }
      );
      if (claimed === undefined || claimed === null) return;
      tried.add(delegateKey(claimed));
      yield claimed;
    }
  }

  /**
   * The next delegate in list order that can be reached. For a user's post
   * the turn goes on from the delegate the last one went to, and moves on;
   * for an answer going back out it goes on from the answer's author, never
   * to it, and stays where it was.
   */
  const pickRoundRobin = handler({
    name: "coordinator-round-robin-pick",
    inputSchema: z.unknown(),
    outputSchema: placedSchema,
    ...blockBase,
    requestStateSchema,
    execute: async (_input: unknown, ctx): Promise<Placed> => {
      const post = postOf(ctx as never);
      const list = currentDelegates(ctx.session.state, post.defaults).delegates;
      const author = post.exclude;
      // A user's post claims each turn before checking it, so two posts at
      // once take two turns; an answer going back out goes on from its author
      // and leaves the turn where it is.
      const order =
        author === undefined
          ? claimTurns(ctx as never, list)
          : turnOrder(list, { delegate: author, index: Math.max(0, indexIn(list, author)) });
      let pick: { record: DelegateRecord; flow: string } | undefined;
      const skipped = await scanReachable(ctx as never, order, author, (record, worker) => {
        pick = { record, flow: worker.flow };
        return "stop";
      });
      if (pick !== undefined) {
        return { place: "deliver", by: "round-robin", picks: [deliveryOf(post, pick.record, pick.flow)], skipped };
      }
      return {
        place: "unplaced",
        reason:
          author === undefined
            ? "no delegate in this conversation can be reached"
            : "no other delegate in this conversation can be reached",
        skipped
      };
    }
  });

  const roundRobin = sequencer({ name: "coordinator-round-robin", inputSchema: z.unknown() })
    .step(pickRoundRobin)
    .step(afterPlace);

  // --- everyone ------------------------------------------------------------

  /**
   * Each delegate that can be reached. On a user's post each gets the post;
   * when a round's answers go back out, each gets the others' answers from it,
   * and one with no other answer to get is skipped.
   */
  const pickEveryone = handler({
    name: "coordinator-everyone-pick",
    inputSchema: z.unknown(),
    outputSchema: placedSchema,
    ...blockBase,
    requestStateSchema,
    execute: async (_input: unknown, ctx): Promise<Placed> => {
      const post = postOf(ctx as never);
      const answers = post.answers;
      const picks: DeliveryRequest[] = [];
      const records = currentDelegates(ctx.session.state, post.defaults).delegates;
      const skipped = await scanReachable(ctx as never, records, undefined, (record, worker): Visit => {
        if (answers === undefined) {
          picks.push(deliveryOf(post, record, worker.flow));
          return;
        }
        const others = othersOf(answers, record);
        if (others.length === 0) return { skip: `no other delegate answered in round ${post.round - 1}` };
        picks.push(deliveryOf(post, record, worker.flow, passedOn(others)));
      });
      if (picks.length > 0) return { place: "deliver", by: "everyone", picks, skipped };
      return {
        place: "unplaced",
        reason:
          post.answers === undefined
            ? "no delegate in this conversation can be reached"
            : "no delegate that can be reached has another's answer to get",
        skipped
      };
    }
  });

  const everyone = sequencer({ name: "coordinator-everyone", inputSchema: z.unknown() })
    .step(pickEveryone)
    .step(afterPlace);

  // --- the door ------------------------------------------------------------

  /** Each policy's steps: the one map both the router's routes and its pick read. */
  const policies: Readonly<Record<CoordinatorRouting, BlockDefinition<any, any>>> = {
    judgment: judgmentTurn,
    "best-fit": bestFit,
    "round-robin": roundRobin,
    everyone
  };

  const routeByPolicy = router({
    name: "coordinator-route-by-policy",
    inputSchema: z.object({ message: z.string(), policy: z.string() }),
    routes: Object.values(policies),
    execute: (opened: { policy: string }) => policies[opened.policy as CoordinatorRouting] ?? judgmentTurn
  } as never) as BlockDefinition<any, any>;

  // --- rounds --------------------------------------------------------------

  /** Send answers back out in their next round: into this conversation, on its route-on entry. */
  const routeOnDispatch = dispatcher({
    name: "coordinator-route-on-dispatch",
    action: ROUTE_ON_ACTION,
    inputSchema: routeOnSchema,
    session: { id: (_routeOn: RouteOn, ctx: BlockContext) => ctx.session.identity.id }
  });

  /**
   * Where answers go next, by this conversation's policy and limit now: an
   * answer as it lands, and each closed round's answers.
   */
  const routeOnsFor = async (
    ctx: BlockContext,
    event: { landed?: { posted: RoundPost; body: string; kept: boolean }; closed: readonly ClosedRound[] }
  ): Promise<RouteOn[]> => {
    // An answer that landed outside an open round, and no round closed: nothing goes on.
    if (event.landed?.kept !== true && event.closed.length === 0) return [];
    const { config } = await coordinatorOf(ctx);
    const { routing, rounds } = config;
    const landed = event.landed;
    return [
      landed === undefined ? undefined : routeOnAfterAnswer(landed.posted, landed.body, landed.kept, routing, rounds),
      ...event.closed.map((closed) => routeOnAfterClose(closed, routing, rounds))
    ].filter((routeOn): routeOn is RouteOn => routeOn !== undefined);
  };

  /** Answers going on, as a step's output carries them: absent when there are none. */
  const routeOnsOutput = (routeOns: RouteOn[]) => (routeOns.length > 0 ? { routeOns } : {});
  const routeOnsOutputSchema = z.object({ routeOns: z.array(routeOnSchema).optional() });
  const hasRouteOns = (value: { routeOns?: RouteOn[] }) => (value.routeOns?.length ?? 0) > 0;

  /** Send each of a step's answers on, into this conversation. */
  const sendOn = sequencer({
    name: "coordinator-send-on",
    inputSchema: z.object({ routeOns: z.array(routeOnSchema) })
  }).forEach((value: { routeOns: RouteOn[] }) => value.routeOns, routeOnDispatch);


  /** Close each open round past its deadline, in one versioned write: the rounds closed, and the earliest deadline still open. */
  const closeOverdueRounds = async (ctx: BlockContext): Promise<{ closed: ClosedRound[]; nextDue?: number }> => {
    const now = Date.now();
    const rows = await roundRowsOf(ctx);
    const swept = await withOutcome(
      (mutator: (state: Readonly<Record<string, unknown>>) => Record<string, unknown>) =>
        ctx.session.atomicState(mutator as never),
      (state: Readonly<Record<string, unknown>>) => {
        const result = closeOverdue(roundsIn(state), rows, now);
        const due = result.rounds.flatMap((open) => (open.deadlineAt === undefined ? [] : [open.deadlineAt]));
        return {
          state: result.closed.length === 0 ? {} : { [ROUNDS_STATE]: result.rounds },
          result: { closed: result.closed, ...(due.length === 0 ? {} : { nextDue: Math.min(...due) }) }
        };
      }
    );
    return swept ?? { closed: [] };
  };

  /**
   * Every wake of the conversation starts here: each open round whose
   * deadline has passed closes, and its answers go on.
   */
  const sweepOverdue = handler({
    name: "coordinator-sweep-overdue",
    inputSchema: z.unknown(),
    outputSchema: routeOnsOutputSchema,
    ...blockBase,
    execute: async (_value: unknown, ctx) => {
      if (!anyOverdue((ctx.session.state[ROUNDS_STATE] ?? []) as OpenRound[], Date.now())) return {};
      const { closed } = await closeOverdueRounds(ctx as never);
      return routeOnsOutput(await routeOnsFor(ctx as never, { closed }));
    }
  });

  const sweep = sequencer({ name: "coordinator-sweep", inputSchema: z.unknown() })
    .step(sweepOverdue)
    .tapIf(hasRouteOns, sendOn);

  /**
   * The round-deadline wake (D2): each round past its deadline closes, and the
   * wake moves to the earliest deadline still open, or clears. Read before the
   * close, settled against that version after: a round a routing opened
   * meanwhile owed its own wake, which a stale settle leaves standing.
   */
  const deadlineSweep = handler({
    name: "coordinator-round-deadline",
    inputSchema: z.unknown(),
    outputSchema: routeOnsOutputSchema,
    ...blockBase,
    execute: async (_value: unknown, ctx) => {
      const wakes = ctx.requestHost?.wakes;
      const read = await wakes?.read(ROUND_DEADLINE_ACTION);
      const { closed, nextDue } = await closeOverdueRounds(ctx as never);
      if (wakes !== undefined && read !== undefined) await wakes.settle(ROUND_DEADLINE_ACTION, read, nextDue ?? null);
      return routeOnsOutput(await routeOnsFor(ctx as never, { closed }));
    }
  });

  const deadlineEntry = sequencer({ name: "coordinator-round-deadline-entry", inputSchema: z.unknown() })
    .step(deadlineSweep)
    .tapIf(hasRouteOns, sendOn);

  /**
   * A routing is done adding deliveries to its round: close the round if
   * nothing is still out, and every round past its deadline.
   */
  const endRouting = handler({
    name: "coordinator-end-routing",
    inputSchema: z.unknown(),
    outputSchema: routeOnsOutputSchema,
    ...blockBase,
    requestStateSchema,
    execute: async (_value: unknown, ctx) => {
      const post = postOf(ctx as never);
      const now = Date.now();
      const isThisRound = (open: OpenRound) => open.postId === post.postId && open.round === post.round;
      // A round at the limit was never opened, one closed at its deadline is
      // gone, and nothing is overdue: nothing to write.
      const open = (ctx.session.state[ROUNDS_STATE] ?? []) as OpenRound[];
      if (!open.some(isThisRound) && !anyOverdue(open, now)) return {};
      const rows = await roundRowsOf(ctx as never);
      const closed = await withOutcome(
        (mutator: (state: Readonly<Record<string, unknown>>) => Record<string, unknown>) =>
          ctx.session.atomicState(mutator as never),
        (state: Readonly<Record<string, unknown>>) => {
          const rounds = roundsIn(state);
          const ended = rounds.some(isThisRound)
            ? closeRound(endRound(rounds, post.postId, post.round), rows, post.postId, post.round, now, true)
            : { rounds };
          const swept = closeOverdue(ended.rounds, rows, now);
          return {
            state: { [ROUNDS_STATE]: swept.rounds },
            result: [...(ended.closed === undefined ? [] : [ended.closed]), ...swept.closed]
          };
        }
      );
      return routeOnsOutput(await routeOnsFor(ctx as never, { closed: closed ?? [] }));
    }
  });

  /** After a routing: end its round, and send the answers of each round that closed on. */
  const finishRouting = sequencer({ name: "coordinator-finish-routing", inputSchema: z.unknown() })
    .step(endRouting)
    .tapIf(hasRouteOns, sendOn);

  const door = sequencer({ name: "coordinator-run", inputSchema: doorInputSchema })
    .tap(sweep)
    .step(openPost)
    .step(routeByPolicy)
    .tap(finishRouting);

  /**
   * Open a round after the user's post: the answers going back out, routed
   * by the conversation's policy now. When none of the closed round's
   * deliveries was answered, nothing goes on: recorded, and done.
   */
  const openRouteOn = handler({
    name: "coordinator-open-route-on",
    inputSchema: routeOnSchema,
    outputSchema: z.object({ message: z.string(), policy: z.string(), done: z.boolean() }),
    ...blockBase,
    requestStateSchema,
    execute: async (routeOn: RouteOn, ctx) => {
      if (routeOn.answers.length === 0) {
        const { config } = await coordinatorOf(ctx as never);
        await emitCoordinatorRoute(ctx as never, {
          postId: routeOn.postId,
          round: routeOn.round,
          policy: config.routing,
          by: config.routing === "judgment" ? "judgment" : "everyone",
          delegates: [],
          none: `no delegate answered in round ${routeOn.round - 1}`
        });
        return { message: "", policy: config.routing, done: true };
      }
      const post = await postStateOf(ctx as never, {
        postId: routeOn.postId,
        round: routeOn.round,
        ...passedOn(routeOn.answers),
        answers: routeOn.answers,
        ...(routeOn.exclude === undefined ? {} : { exclude: routeOn.exclude })
      });
      return { message: turnMessage(post), policy: post.policy, done: false };
    }
  });

  const routeOnEntry = sequencer({ name: "coordinator-route-on", inputSchema: routeOnSchema })
    .step(openRouteOn)
    .exitIf((opened: { done: boolean }) => opened.done)
    .step(routeByPolicy)
    .tap(finishRouting);

  // --- a routed task's ending ------------------------------------------------

  /**
   * A task whose result goes to this conversation ended, heard through
   * `onTaskSettled` (FIX-2078's one path), whose dedupe and the task's claim
   * are the only fence. The notice is acknowledged only once this has run, so
   * a failure here leaves it owed for the board's next touch, and an answer
   * its round already keeps isn't kept or said twice. Completed, its answer
   * lands as a line under the delegate's name; failed or cancelled, it only
   * ends that delegate's part, and lets go of best fit's hold if it had it.
   * In an open round an answer is kept for what goes on, and the round
   * closes if that was the last task out; in a round already closed, it
   * lands and goes no further. A task filed with no brief (not on a turn
   * routing a message) only lands its answer. Like every wake,
   * it also closes each round past its deadline. It wakes no turn of its own:
   * a failure of a task the judgment turn filed is said, and wakes that turn,
   * by `onTaskSettled` after this has run (FIX-2115, `task-settled.ts`).
   */
  const routedEnded = handler({
    name: "coordinator-routed-ended",
    inputSchema: routedEndingSchema,
    outputSchema: z.object({ landed: z.boolean(), routeOns: z.array(routeOnSchema).optional() }),
    ...blockBase,
    execute: async (ending: RoutedEnding, ctx) => {
      // An empty answer is no answer: nothing lands, and best fit's hold stays.
      const body = ending.ending === "completed" ? answerOf(ending.output) : undefined;
      const post = ending.brief;
      if (post === undefined) {
        // Not routed: its answer lands, and nothing goes on.
        if (body !== undefined) ctx.emit.message(body, ending.assignee === undefined ? {} : { agentName: ending.assignee });
        return { landed: body !== undefined };
      }
      const posted: RoundPost = { postId: post.postId, round: post.round, delegate: post.delegate };
      const now = Date.now();
      const rows = await roundRowsOf(ctx as never);
      type Ended = { kept: boolean; again?: true; closed: ClosedRound[] };
      const outcome = await withOutcome(
        (mutator: (state: Readonly<Record<string, unknown>>) => Record<string, unknown>) =>
          ctx.session.atomicState(mutator as never),
        (state: Readonly<Record<string, unknown>>): { state: Record<string, unknown>; result: Ended } => {
          const rounds = roundsIn(state);
          const hold = state[HOLD_STATE] as { postId: string; delegate: DelegateRef } | null | undefined;
          const held =
            hold !== null && hold !== undefined && hold.postId === post.postId && sameDelegate(hold.delegate, post.delegate);
          if (body === undefined) {
            const closing = closeRound(rounds, rows, post.postId, post.round, now);
            const swept = closeOverdue(closing.rounds, rows, now);
            // A failed or cancelled holder holds nothing (FIX-1610 D1); an empty answer keeps its hold.
            const releases = held && ending.ending !== "completed";
            return {
              state: {
                ...(releases ? { [HOLD_STATE]: null } : {}),
                ...(rounds.length === 0 ? {} : { [ROUNDS_STATE]: swept.rounds })
              },
              result: { kept: false, closed: [...(closing.closed === undefined ? [] : [closing.closed]), ...swept.closed] }
            };
          }
          const landed = landAnswer(rounds, rows, posted, body, now);
          const swept = closeOverdue(landed.rounds, rows, now);
          // Heard again after a failure past this write: it landed then.
          if (landed.again === true) {
            return {
              state: { [ROUNDS_STATE]: swept.rounds },
              result: { kept: false, again: true, closed: [...(landed.closed === undefined ? [] : [landed.closed]), ...swept.closed] }
            };
          }
          return {
            state: {
              // Kept before the answer is said, so a post routed while this request finishes still reads it.
              [LANDED_STATE]: keepLanded(state[LANDED_STATE], {
                requestId: ctx.request.identity.id,
                from: post.delegate.worker,
                text: body,
                at: now
              }),
              ...(held ? { [HOLD_STATE]: null } : {}),
              ...(rounds.length === 0 ? {} : { [ROUNDS_STATE]: swept.rounds })
            },
            result: {
              kept: landed.kept,
              closed: [...(landed.closed === undefined ? [] : [landed.closed]), ...swept.closed]
            }
          };
        }
      );
      if (outcome === undefined) throw new Error("The routed task's ending could not be recorded.");
      if (body === undefined || outcome.again === true) {
        return { landed: false, ...routeOnsOutput(await routeOnsFor(ctx as never, { closed: outcome.closed })) };
      }
      ctx.emit.message(body, { agentName: post.delegate.worker });
      const routeOns = await routeOnsFor(ctx as never, {
        landed: { posted, body, kept: outcome.kept },
        closed: outcome.closed
      });
      return { landed: true, ...routeOnsOutput(routeOns) };
    }
  });

  const onRoutedEnded = sequencer({ name: "coordinator-on-routed-ended", inputSchema: routedEndingSchema })
    .step(routedEnded)
    .tapIf(hasRouteOns, sendOn);

  /**
   * How this conversation hears a task it filed end: its coordinator's turn
   * under any routing that runs that turn, so the turn can file a failed task
   * again and say so. Judgment always does; best fit does on a message it
   * picks the coordinator for and on a miss with no fallback. Round robin and
   * everyone never run it, so the ending is a line there. A task whose result
   * goes to this conversation (a routed task) is {@link onRoutedEnded}'s,
   * under every routing: its answer, and a routed round's failure or cancel;
   * a failure of one this turn filed (`filedByTurn`) also lands as a line and
   * wakes the turn, after that (FIX-2115). The failure or cancel of one with no routed brief (a routed task's
   * follow-up, FIX-2122) is in no round, and is heard as a filed task's is.
   */
  const boardEntries = sessionBoard.entries(
    turn.run,
    (ctx) => {
      const { routing } = workerConfigOf(ctx) as unknown as CoordinatorConfig;
      return coordinatorRunsOwnTurn(routing) ? "judgment" : "fixed";
    },
    onRoutedEnded
  );

  const flow = defineFlow({
    kind: COORDINATOR_FLOW,
    configSchema: coordinatorConfigSchema(turn.settings),
    // The agent turn's binding: the documents a worker may be granted, the
    // per-turn visibility rule, and the request `onStarted` that loads this
    // turn's worker on this flow before anything reads a setting.
    ...turn.bound,
    session: {
      ...installation.session({ ...coordinatorStateShape, ...conversationBoardStateShape, ...workerMessageStateShape }),
      // The board's `routedFrom` too: no caller names the conversation a routed task came from (BP-031).
      // And `workProjectId`: only the work-project action sets the project a conversation works in (FIX-2161).
      serverOwned: [
        ...COORDINATOR_SERVER_OWNED,
        ...CONVERSATION_BOARD_SERVER_OWNED,
        ...WORKER_MESSAGE_SERVER_OWNED,
        ROUTED_FROM_STATE_KEY,
        WORK_PROJECT_STATE_KEY
      ],
      // Every answer, routing and pass-on writes this one record at once; a pass-on that
      // runs out of retries fails after its round has closed, and its answers are lost.
      cas: { maxRetries: 8 }
    },
    resources: { ...resources, ...(turn.bound.resources ?? {}), ...sessionBoard.resources },
    isolateUserState: options.agent?.isolateUserState ?? false,
    actions: {
      // The task tools, as actions on this conversation's board
      // (`updateTask_tasks` and the rest, checked against its delegates), and
      // the four delegate actions.
      ...sessionBoard.actions,
      // The session names its worker, so a turn whose input carries any other key is refused.
      [RESPOND_ACTION]: {
        inputSchema: doorInputSchema.strict(),
        block: door,
        userMessage: (input: DoorInput) => input.message,
        concurrency: REPLY_CONCURRENCY
      },
      [STANDING_RULES_ACTION]: standingRulesAction,
      [SET_WORK_PROJECT_ACTION]: setWorkProjectAction
    },
    internal: {
      actions: {
        // The round-deadline wake (D2), or a host's in-process timer, with
        // nothing: it closes every overdue round.
        [ROUND_DEADLINE_ACTION]: markRolePiece(
          { inputSchema: z.object({}).strict(), block: deadlineEntry, concurrency: "queue" as const },
          "coordinator"
        ),
        // Only this conversation's own code sends answers back out. A round's
        // routing can run the coordinator's turn, so it is a reply too.
        [ROUTE_ON_ACTION]: markRolePiece({ inputSchema: routeOnSchema, block: routeOnEntry, concurrency: REPLY_CONCURRENCY }, "coordinator"),
        // A filing's wake (one run of this conversation's board, as its
        // owner), and a task this conversation filed ended: its notice.
        ...boardEntries,
        // A workstream's entry path adds or removes its record, on a project's
        // coordinator only (FIX-1793). Never public: a record with a target
        // is written nowhere else.
        [WORKSTREAM_DELEGATE_ACTION]: markRolePiece(
          {
            ...workstreamDelegateEntry({ check, defaults: async (ctx) => (await coordinatorOf(ctx)).defaults }),
            concurrency: "queue" as const
          },
          "coordinator"
        )
      }
    },
    // A coordinator worker can be a delegate that takes a task.
    task: { actions: { [WORKER_TASK_ENTRY]: taskEntry } }
  } as never) as ReturnType<typeof defineFlow>;

  /**
   * The mint, with the refusals the configuration schema can't carry across
   * keys: the agent turn's own (a tool two presets both carry, a package
   * shadowing a catalog tool), then a fallback that isn't a default and a
   * default named twice.
   */
  const mint = (mintOptions?: Parameters<typeof flow>[0]) => {
    const instance = flow(mintOptions);
    const turnProblem = turn.mintProblems(instance.config as never);
    if (turnProblem !== undefined) throw new Error(turnProblem);
    const problems = coordinatorConfigProblems(instance.config as unknown as CoordinatorConfig);
    if (problems.length > 0) throw new Error(`This coordinator ${problems.join(", and ")}.`);
    return instance;
  };
  return declareBuiltInRoles(Object.assign(mint, flow), ["contributor", "manager", "coordinator"]) as typeof flow;
}
