/**
 * The `coordinator` worker flow: a worker that hands each post to delegates
 * from its user's own roster, by its routing policy.
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
 * **How a post is routed.**
 *
 * - `judgment`: the coordinator's own turn reads the post and hands it to
 *   delegates with its `dispatchTask` tool and `post: true`, or answers itself. It reads its
 *   delegates with its `listDelegates` tool; the list is never in its prompt.
 * - `best-fit`: best fit's ladder (`best-fit.ts`): the delegate still on the
 *   user's last post, else one evaluator call (asked again as a language model when it
 *   fails on a model string), else the fallback delegate,
 *   else the coordinator's own judgment turn. Only when that turn fails is the
 *   post unplaced, recorded and said in the conversation.
 * - `round-robin`: the next delegate in list order after the one the
 *   user's last post went to.
 * - `everyone`: each delegate.
 *
 * Every pick is checked against the user's roster when the post arrives
 * (`../delegates/delegate-check.ts`), so a fired delegate is skipped and recorded
 * without anyone editing the list.
 *
 * **The conversation's lines.** When a post opens, its conversation's recent
 * lines are read once from the conversation's own items, with any answer that
 * landed while its request is still finishing (`coordinator-lines.ts`): best
 * fit's call reads the post with them, and every delivery, by any policy,
 * carries them to the delegate, whose model is shown them for that turn as a
 * message of the conversation, never as system text (`delegated-post.ts`).
 *
 * **How a delivery reaches a delegate.** Each delivery is one row on this
 * conversation's board (`../conversation-board`), its id derived from the
 * post, the round and the delegate record, so the same pick twice files one
 * row. The post rides on the row's server-written payload. The board hands the
 * row to the delegate's flow on its task entry {@link DELEGATED_POST_ENTRY},
 * behind the board's claim gate, into a session keyed by this conversation and
 * the delegate record. The session is created on first delivery, naming the
 * delegate as its worker, so the delegate's own create check links it at
 * create; the key's derivation includes this conversation's incarnation, so a
 * conversation deleted and created again under the same id opens fresh
 * delegate sessions. A later delivery from this conversation reuses it.
 *
 * **A project's coordinator** (FIX-1793): a conversation linked to a project
 * (its readonly `projectId`) has a delegate record per workstream its user has
 * open there, the lead with the workstream as the record's target
 * (`../projects/project-coordinator.ts`). A delivery to such a record goes
 * into the workstream's own session, the one its entry names, not a session
 * of this conversation's; the records change only through the workstream's
 * entry paths, on the internal {@link WORKSTREAM_DELEGATE_ACTION}.
 *
 * **How an answer lands.** The delegate's run settles its row with its reply,
 * and the row's ending reaches this conversation once, on the board's notice
 * entry for post rows (`onPostSettled`): only the claim the row was worked
 * under can settle it, and the notice is acted on once however often it is
 * sent. It lands as a line under the delegate's name. The round, the delegate
 * and the post come from the row's payload, never from the answer. With
 * `rounds: 0`, an answer routes nowhere further.
 *
 * **How an answer goes back out** (`coordinator-rounds.ts`). Below the
 * coordinator's `rounds:`, best fit and round robin route each answer again
 * as it lands, never to its author; everyone and judgment send a round's
 * answers on when the round closes. Either way the next round runs on the
 * internal {@link ROUTE_ON_ACTION}, which the conversation dispatches into
 * itself, through the same policy steps as a user's post. A row that ends
 * without an answer (failed, or cancelled: a cancelled run tells the
 * conversation on {@link POST_CANCELLED_ACTION}, which ends the row under its
 * claim) ends that delegate's part, so a round doesn't wait on it, and a round
 * closes at its deadline whatever is still out. Every wake of the conversation
 * (a user's post, a row's ending, the end of a routing) also closes each round past its deadline, so
 * a delegate that never reports holds its round only until the next wake.
 */
import {
  choice,
  defineFlow,
  dispatcher,
  evaluator,
  generator,
  handler,
  router,
  sequencer
} from "@flow-state-dev/core";
import { withOutcome } from "@flow-state-dev/core/helpers";
import type { BlockContext, BlockDefinition, EvaluationModel } from "@flow-state-dev/core/types";
import { z } from "zod";
import {
  bestFitEvaluationFailed,
  failedEvaluationSchema,
  needsBestFitCall,
  placeBestFit,
  type BestFitCase,
  type BestFitMiss,
  type BestFitPlacement
} from "../best-fit";
import { agentWorkerTurn, type AgentWorkerFlowOptions } from "../agent-worker-flow";
import { markUserTurn } from "../standing-rules/user-turn";
import { STANDING_RULES_ACTION, standingRulesAction } from "../standing-rules/rules-action";
import { filingSessionIdOf } from "../conversation-board/filing-session";
import { PROJECT_ROW_RESOURCES } from "../projects/project-address";
import {
  resolveWorkstreamTarget,
  WORKSTREAM_DELEGATE_ACTION,
  workstreamDelegateEntry,
  workstreamDelegateSeed
} from "../projects/project-coordinator";
import { isTerminalStatus } from "@flow-state-dev/orchestration/tasks";
import { conversationLedgerAt } from "../conversation-board/ledger";
import { sendOwedNotices } from "../conversation-board/notice-delivery";
import { defineSessionBoard } from "../conversation-board/session-board";
import { workerTaskEntry } from "../conversation-board/task-entry";
import {
  CONVERSATION_BOARD_SERVER_OWNED,
  REPLY_CONCURRENCY,
  conversationBoardStateShape,
  postEndingSchema,
  type PostEnding
} from "../conversation-board/task-settled";
import { DELEGATED_POST_ENTRY, WORKER_TASK_ENTRY } from "../worker-task-entry";
import { workerConfigOf } from "../workers/verified-worker";
import type { RosterWorker, WorkerInstallation } from "../workers/installation";
import {
  coordinatorConfigProblems,
  coordinatorConfigSchema,
  type CoordinatorConfig,
  type CoordinatorRouting
} from "./coordinator-config";
import { declaresInternalPostEntry, takesDelegatedPost } from "../delegates/delegate-check";
import { DELEGATES_STATE } from "../delegates/delegate-keys";
import {
  currentDelegates,
  delegateKey,
  delegateLabel,
  delegateRefSchema,
  readDelegates,
  sameDelegate,
  type DelegateRef,
  type DelegateDefaults,
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
  COORDINATOR_ROUTE_ASK,
  HOLD_STATE,
  LANDED_STATE,
  ROUND_DEADLINE_ACTION,
  ROUND_DEADLINE_MS,
  ROUND_ROBIN_STATE,
  ROUNDS_STATE,
  ROUTE_ON_ACTION,
  POST_CANCELLED_ACTION
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
import {
  POST_ROW,
  delegatedPostHistory,
  delegatedPostMessage,
  postCancelledSchema,
  postRowOf,
  postRowSchema,
  type PostCancelled,
  type PostRow
} from "./delegated-post";

/** What the coordinator flow is built from. */
export interface CoordinatorFlowOptions {
  /** The worker installation the coordinator's workers, and their delegates, belong to. */
  installation: WorkerInstallation;
  /**
   * The worker flows a delegate can run on and take a post: each declares
   * {@link DELEGATED_POST_ENTRY} (see `delegatedPostEntry`). A delivery can
   * only reach these. A worker whose flow takes only tasks can still be added.
   */
  delegateFlows: readonly { readonly kind: string }[];
  /**
   * The model best fit's one evaluator call runs on: a model string the app's
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
  agent?: Omit<AgentWorkerFlowOptions, "installation" | "taskLists">;
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
  "Who should take the post? Read it with the recent lines before it: " +
  "a post that follows up on a delegate's answer goes to that delegate.";

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
  /** What each hand-off of the judgment turn came to. */
  handOffs: z.array(routedDelegateSchema),
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

type PostState = z.infer<typeof postStateSchema>;

const requestStateSchema = z.object({ [POST_STATE]: postStateSchema.optional() });

/** One delivery to make. */
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

/** The defaults a worker's configuration names. */
function defaultsOf(config: CoordinatorConfig): DelegateDefaults {
  return { delegates: config.delegates, ...(config.fallback === undefined ? {} : { fallback: config.fallback }) };
}

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
 * A post row's id: one per post, round and delegate, so a second filing of
 * the same part finds the first. Each part is URI-encoded, since a ledger
 * keeps a task id to one path segment and a workstream target has slashes.
 */
function postRowId(postId: string, round: number, delegate: DelegateRef): string {
  const parts = [postId, String(round), delegate.worker, ...(delegate.target === undefined ? [] : [delegate.target])];
  return `post:${parts.map(encodeURIComponent).join(":")}`;
}

/**
 * Build the coordinator flow.
 *
 * @throws when a delegate flow declares no {@link DELEGATED_POST_ENTRY}.
 */
export function defineCoordinatorFlow(options: CoordinatorFlowOptions) {
  const { installation } = options;
  for (const flow of options.delegateFlows) {
    if (takesDelegatedPost(flow)) continue;
    if (declaresInternalPostEntry(flow)) {
      throw new Error(
        `defineCoordinatorFlow: delegate flow "${flow.kind}" declares "${DELEGATED_POST_ENTRY}" under internal entries. ` +
          `A post is a row on the conversation's board now: declare it under task entries, ` +
          `\`task: { actions: { ${DELEGATED_POST_ENTRY}: delegatedPostEntry(...) } }\`.`
      );
    }
    throw new Error(
      `defineCoordinatorFlow: delegate flow "${flow.kind}" declares no "${DELEGATED_POST_ENTRY}" task entry, ` +
        `so a delegate on it couldn't take a post. Declare it with delegatedPostEntry(...) under task entries.`
    );
  }
  const deadlineMs = options.roundDeadlineMs ?? ROUND_DEADLINE_MS;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0) {
    throw new Error(
      `defineCoordinatorFlow: roundDeadlineMs must be a positive whole number of milliseconds, not ${deadlineMs}.`
    );
  }
  const postFlows = new Set(options.delegateFlows.map((flow) => flow.kind));
  /**
   * The conversation's board and delegates (FIX-1802): the one delegate
   * check, the four delegate actions and tools, the eight task tools and
   * actions over its board. Its post check reaches only the flows this
   * coordinator dispatches to.
   */
  const sessionBoard = defineSessionBoard({
    installation,
    flowKind: COORDINATOR_FLOW,
    postFlows,
    // A project's coordinator starts with its user's open workstreams there.
    seed: (ctx) => workstreamDelegateSeed(ctx as never),
    // The judgment turn hands a post on with `dispatchTask` and `post: true`,
    // on a turn routing one: the post comes from request state.
    posts: {
      routing: (ctx) => (ctx.request?.state as Record<string, unknown> | undefined)?.[POST_STATE] !== undefined,
      description:
        "On this turn you are routing a post: to hand it to one of this conversation's delegates, call " +
        "dispatchTask with post: true and assignee, the delegate's worker id, and nothing else but target, " +
        "which names the record when that worker is more than one delegate here. Its answer lands in this " +
        "conversation under its name. A delegate takes each post once per round; a new message is a new " +
        "post, even when it repeats an earlier ask.",
      file: (ctx, call) => handOnPost(ctx, call)
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
    return { worker, config, defaults: { ...defaultsOf(config), ...(records === undefined ? {} : { records }) } };
  };

  const blockBase = { resources, sessionStateSchema: coordinatorSessionStateSchema };

  // -------------------------------------------------------------------------
  // Delivery: one row on the conversation's board per delegate picked.
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
   * The open rounds' rows, read off the conversation's board before a write
   * that may close one: one filtered read per open round, after the rounds
   * themselves are read, so the write can tell a routing filed rows since. A
   * round the read didn't see (opened since) can't close on it.
   */
  const roundRowsOf = async (ctx: BlockContext): Promise<RoundRows> => {
    const open = roundsIn(ctx.session.state);
    const ref = open.length === 0 ? undefined : await conversationLedgerAt(ctx, await filingSessionIdOf(ctx.session));
    const read = new Map<string, RoundRead>();
    for (const { postId, round, begun, opening } of open) {
      const rows = ref?.list({ sealed: { kind: POST_ROW, postId, round } }) ?? [];
      const replied = rows.flatMap((row) => {
        const post = row.status === "completed" && typeof row.output === "string" ? postRowOf(row) : undefined;
        return post === undefined ? [] : [post.delegate];
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
   * Hand the post to one delegate record: file its row on this conversation's
   * board, and start it. The row's id is derived from the post, the round and
   * the record, so a delegate already handed this post in this round files
   * nothing. In a round below the limit the row carries the round's deadline,
   * which its round's first row sets. A record with a target is worked in the
   * session its target names now; one whose target names none yet files
   * nothing.
   */
  const deliverTo = async (ctx: BlockContext, request: DeliveryRequest): Promise<RoutedDelegate> => {
    const named = bare(request.delegate);
    const now = Date.now();
    const deadlineAt = await withOutcome(
      (mutator: (state: Readonly<Record<string, unknown>>) => Record<string, unknown>) =>
        ctx.session.atomicState(mutator as never),
      (state: Readonly<Record<string, unknown>>) => {
        const rounds = roundsIn(state);
        const timed = roundDeadline(rounds, request.postId, request.round, now, deadlineMs);
        return {
          state: { ...(timed.deadlineAt === undefined ? {} : { [ROUNDS_STATE]: timed.rounds }), ...dropRetiredLedger(state) },
          result: timed.deadlineAt
        };
      }
    );
    // A record with a target goes into the session its target names now.
    let session: PostRow["session"] = { key: `delegate:${delegateKey(named)}` };
    if (named.target !== undefined) {
      const resolved = await resolveWorkstreamTarget(ctx as never, { worker: named.worker, target: named.target });
      if ("problem" in resolved) return { ...named, outcome: "failed", reason: resolved.problem };
      session = { id: resolved.sessionId };
    }
    const post: PostRow = {
      kind: POST_ROW,
      postId: request.postId,
      round: request.round,
      delegate: named,
      session,
      body: request.body,
      from: request.from,
      coordinator: request.coordinator,
      ...(deadlineAt === undefined ? {} : { deadlineAt }),
      ...linesField(request.recent)
    };
    try {
      const filed = await sessionBoard.filePost(ctx as never, {
        id: postRowId(request.postId, request.round, named),
        title: `Post for ${delegateLabel(named)}`,
        goal: delegatedPostMessage(post),
        assignee: named.worker,
        // Nothing retries a post: a failed one ends its delegate's part.
        maxAttempts: 1,
        sealed: post
      });
      if (filed === "exists") {
        return { ...named, outcome: "skipped", reason: "it was already handed this post in this round" };
      }
      return { ...named, outcome: "delivered" };
    } catch (error) {
      if (ctx.signal.aborted) throw error;
      return { ...named, outcome: "failed", reason: error instanceof Error ? error.message : String(error) };
    }
  };

  /** {@link deliverTo} as a step: a fixed policy hands each of its picks to it. */
  const deliverOne = handler({
    name: "coordinator-deliver",
    inputSchema: deliveryRequestSchema,
    outputSchema: routedDelegateSchema,
    sessionStateSchema: coordinatorSessionStateSchema,
    resources,
    execute: (request: DeliveryRequest, ctx) => deliverTo(ctx as never, request)
  });

  // -------------------------------------------------------------------------
  // The post: open it, then route it by the conversation's policy.
  // -------------------------------------------------------------------------

  /** The post being routed, from request state. Set by the door before anything routes. */
  const postOf = (ctx: BlockContext): PostState => {
    const post = (ctx.request.state as Record<string, unknown>)[POST_STATE] as PostState | undefined;
    if (post === undefined) throw new Error("No post is being routed in this request.");
    // A request opened before posts carried their lines, and resumed since, reads as having none (BP-030).
    return post.recent === undefined ? { ...post, recent: [] } : post;
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
      handOffs: []
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
    requestStateSchema,
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

  /** The sentence a refused post ends with: who on the list a post reaches now, by the same check. */
  const postTakers = async (ctx: BlockContext, delegates: readonly DelegateRecord[]): Promise<string> => {
    const takers: string[] = [];
    for (const { worker } of delegates) {
      if (!takers.includes(worker) && (await check(ctx as never, worker, "post")).ok) takers.push(worker);
    }
    return takers.length === 0 ? "No delegate here takes posts." : `Delegates here that take posts: ${takers.join(", ")}.`;
  };

  /**
   * Whether the coordinator may hand this post to `assignee`: on the list, and
   * passing the check now. A listed delegate the check refuses is refused with
   * the delegates that would take the post.
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
    const checked = await check(ctx as never, record.worker, "post");
    if (!checked.ok) return { refused: `${checked.message} ${await postTakers(ctx as never, listed.delegates)}` };
    return deliveryOf(post, record, checked.worker.flow);
  };

  /**
   * The judgment turn's hand-off: `dispatchTask` with `post: true` (FIX-1872),
   * on a turn routing a post. The post comes from this request's state, never
   * from the model, which names only the delegate. What it came to is kept for
   * the turn's record, and told to the model.
   */
  const handOnPost = async (
    ctx: BlockContext,
    call: { assignee?: string; target?: string }
  ): Promise<{ ok: true; taskId?: string; note?: string } | { ok: false; error: string }> => {
    const post = postOf(ctx);
    if (call.assignee === undefined) {
      const listed = currentDelegates(ctx.session.state, post.defaults);
      return {
        ok: false,
        error: `post_assignee_required: name the delegate to hand the post to with assignee. ${await postTakers(ctx, listed.delegates)} Nothing was filed.`
      };
    }
    const judged = await judgedDelivery(ctx, post, { assignee: call.assignee, ...(call.target === undefined ? {} : { target: call.target }) });
    const routed: RoutedDelegate =
      "refused" in judged
        ? { worker: call.assignee, outcome: "skipped", reason: judged.refused }
        : await deliverTo(ctx, judged);
    await ctx.request.patchState(POST_STATE as never, ((state: PostState) => ({
      ...state,
      handOffs: [...state.handOffs, routed]
    })) as never);
    // A refusal's reason is a sentence of its own, often with its period.
    if (routed.outcome === "delivered") {
      return { ok: true, note: `Handed to ${routed.worker}. Its answer will land in this conversation under its name.` };
    }
    return { ok: false, error: `Not handed to ${routed.worker}: ${(routed.reason ?? routed.outcome).replace(/\.$/, "")}.` };
  };

  // -------------------------------------------------------------------------
  // Tasks: the conversation's board, filed for its delegates (FIX-1794).
  // -------------------------------------------------------------------------

  /**
   * The judgment turn: the built-in agent's own turn, shared rather than
   * copied, run as this conversation's worker. It reads the worker's
   * instructions, model, tools, skills and capabilities as an `agent` worker's
   * are read, and carries the four delegate tools, the hand-off and the eight
   * task tools on every coordinator, whatever the worker's `tools:` line
   * grants. The task tools come from one capability instance, the
   * conversation's board's, composed by the turn once, so no skill or preset
   * adds a second set; they are on a turn while one of its delegates takes a
   * task.
   */
  const turn = agentWorkerTurn(
    { ...(options.agent ?? {}), installation },
    {
      kind: COORDINATOR_FLOW,
      answerName: COORDINATOR_JUDGMENT,
      extraTools: [...sessionBoard.delegates.tools],
      board: sessionBoard,
      // The turn's model reads a delegate's answer as a line from that
      // delegate, never as its own reply, and a post the routing handed on as
      // handled (`coordinatorHistory`).
      history: async (input, ctx) =>
        coordinatorHistory(
          await delegatedPostHistory(input, ctx),
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

  /** The judgment turn's one record: each hand-off it made, or that it answered itself. */
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
        delegates: post.handOffs,
        ...(post.handOffs.some((handOff) => handOff.outcome === "delivered")
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
   * record in the order given (never `exclude`), checked for a post now. One
   * that can't be reached is skipped with the check's answer; each one that
   * can goes to `visit`. Skips come back in scan order, so every policy words
   * them the same way.
   */
  const scanReachable = async (
    ctx: BlockContext,
    records: Iterable<DelegateRecord> | AsyncIterable<DelegateRecord>,
    exclude: DelegateRef | undefined,
    visit: (record: DelegateRecord, worker: RosterWorker) => Visit
  ): Promise<RoutedDelegate[]> => {
    const skipped: RoutedDelegate[] = [];
    for await (const record of records) {
      if (exclude !== undefined && sameDelegate(record, exclude)) continue;
      const checked = await check(ctx as never, record.worker, "post");
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

  /**
   * Best fit's one call: which delegate answers the post, read with the
   * conversation's recent lines before it. Its state is `{ recent, post }`,
   * each line and the post as `{ from, text }`; a scripted evaluation reads
   * that shape.
   */
  const routeEvaluator = evaluator({
    name: COORDINATOR_ROUTE,
    model: options.routeModel,
    inputSchema: bestFitCaseSchema,
    state: (bestFit: BestFitCaseValue) => ({ recent: bestFit.recent, post: bestFit.post }),
    questions: (bestFit: BestFitCaseValue) => ({ worker: choice(ROUTE_QUESTION, bestFit.ladder.options) })
  });

  /** A gateway serves most model ids as language models only, so a failed evaluator call on a string asks again here. */
  const routeModelId = typeof options.routeModel === "string" ? options.routeModel : undefined;
  const routeAsked = (model: string) =>
    generator({
      name: COORDINATOR_ROUTE_ASK,
      model,
      inputSchema: bestFitCaseSchema,
      outputSchema: z.object({ worker: z.string() }),
      itemVisibility: { client: false, history: false },
      // Only `routeModel` picks: no coercion pass on another model.
      repair: { coerce: false },
      prompt: (bestFit: BestFitCaseValue) =>
        [
          ROUTE_QUESTION,
          "Answer with the key of exactly one option below, as `worker`.",
          "",
          "Options:",
          ...Object.entries(bestFit.ladder.options).map(([key, pickBy]) => `- ${key}: ${pickBy}`)
        ].join("\n"),
      user: (bestFit: BestFitCaseValue) =>
        [
          ...bestFit.recent.map((line) => `${line.from}: ${line.text}`),
          `The post, from ${bestFit.post.from}: ${bestFit.post.text}`
        ].join("\n")
    })
      .connectInput((_failed: unknown, ctx) => bestFitCaseSchema.parse(ctx.parent?.input))
      .connectOutput((asked: { worker: string }) => ({ answers: { worker: { choice: asked.worker } } }));

  /** Keep the evaluator's error on the post before asking again, so the record says the call failed. */
  const noteEvaluationFailed = handler({
    name: "coordinator-route-note-failed",
    inputSchema: failedEvaluationSchema,
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

  const evaluateRoute = sequencer({ name: "coordinator-best-fit-ask", inputSchema: bestFitCaseSchema }).step(
    routeEvaluator.rescue([{ block: bestFitEvaluationFailed("coordinator-route-evaluation-failed") }])
  );
  const isFailedEvaluation = (evaluated: unknown) => failedEvaluationSchema.safeParse(evaluated).success;
  const askRoute =
    routeModelId === undefined
      ? evaluateRoute
      : evaluateRoute
          .tapIf(isFailedEvaluation, noteEvaluationFailed)
          .stepIf(
            isFailedEvaluation,
            routeAsked(routeModelId).rescue([{ block: bestFitEvaluationFailed("coordinator-route-ask-failed") }])
          );

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

  /** Nobody took the post: recorded, and said in the conversation. */
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
      // A user's post is answered in the conversation; answers going back out aren't.
      if (post.round === 0) ctx.emit.message(`Nobody took this post: ${why}.`);
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
      if (post.round === 0) ctx.emit.message(`Nobody took this post: ${reason}.`);
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


  /**
   * Every wake of the conversation starts here: each open round whose
   * deadline has passed closes, and its answers go on. A round whose delegate
   * never reported holds only until the next wake after its deadline.
   */
  const sweepOverdue = handler({
    name: "coordinator-sweep-overdue",
    inputSchema: z.unknown(),
    outputSchema: routeOnsOutputSchema,
    ...blockBase,
    execute: async (_value: unknown, ctx) => {
      const now = Date.now();
      if (!anyOverdue((ctx.session.state[ROUNDS_STATE] ?? []) as OpenRound[], now)) return {};
      const rows = await roundRowsOf(ctx as never);
      const closed = await withOutcome(
        (mutator: (state: Readonly<Record<string, unknown>>) => Record<string, unknown>) =>
          ctx.session.atomicState(mutator as never),
        (state: Readonly<Record<string, unknown>>) => {
          const swept = closeOverdue(roundsIn(state), rows, now);
          return { state: swept.closed.length === 0 ? {} : { [ROUNDS_STATE]: swept.rounds }, result: swept.closed };
        }
      );
      return routeOnsOutput(await routeOnsFor(ctx as never, { closed: closed ?? [] }));
    }
  });

  const sweep = sequencer({ name: "coordinator-sweep", inputSchema: z.unknown() })
    .step(sweepOverdue)
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

  // --- a post row's ending ---------------------------------------------------

  /**
   * A post row ended, heard through `onPostSettled`, whose dedupe and the
   * row's claim are the only fence. The notice is acknowledged only once this
   * has run, so a failure here leaves it owed for the board's next touch, and
   * an answer its round already keeps isn't kept or said twice. Completed, its reply lands as a line under
   * the delegate's name; failed or cancelled, it only ends that delegate's
   * part. In an open round a reply is kept for what goes on, and the round
   * closes if that was the last row out; in a round already closed, it lands
   * and goes no further. Like every wake, it also closes each round past its
   * deadline. It wakes no turn of its own.
   */
  const postEnded = handler({
    name: "coordinator-post-ended",
    inputSchema: postEndingSchema,
    outputSchema: z.object({ landed: z.boolean(), routeOns: z.array(routeOnSchema).optional() }),
    ...blockBase,
    execute: async (ending: PostEnding, ctx) => {
      const post = ending.post;
      const posted: RoundPost = { postId: post.postId, round: post.round, delegate: post.delegate };
      const body = ending.ending === "completed" && typeof ending.output === "string" ? ending.output : undefined;
      const now = Date.now();
      const rows = await roundRowsOf(ctx as never);
      type Ended = { kept: boolean; again?: true; closed: ClosedRound[] };
      const outcome = await withOutcome(
        (mutator: (state: Readonly<Record<string, unknown>>) => Record<string, unknown>) =>
          ctx.session.atomicState(mutator as never),
        (state: Readonly<Record<string, unknown>>): { state: Record<string, unknown>; result: Ended } => {
          const rounds = roundsIn(state);
          if (body === undefined) {
            const closing = closeRound(rounds, rows, post.postId, post.round, now);
            const swept = closeOverdue(closing.rounds, rows, now);
            return {
              state: rounds.length === 0 ? {} : { [ROUNDS_STATE]: swept.rounds },
              result: { kept: false, closed: [...(closing.closed === undefined ? [] : [closing.closed]), ...swept.closed] }
            };
          }
          const hold = state[HOLD_STATE] as { postId: string; delegate: DelegateRef } | null | undefined;
          const releases =
            hold !== null && hold !== undefined && hold.postId === post.postId && sameDelegate(hold.delegate, post.delegate);
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
              ...(releases ? { [HOLD_STATE]: null } : {}),
              ...(rounds.length === 0 ? {} : { [ROUNDS_STATE]: swept.rounds })
            },
            result: {
              kept: landed.kept,
              closed: [...(landed.closed === undefined ? [] : [landed.closed]), ...swept.closed]
            }
          };
        }
      );
      if (outcome === undefined) throw new Error("The post's ending could not be recorded.");
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

  const onPostEnded = sequencer({ name: "coordinator-on-post-ended", inputSchema: postEndingSchema })
    .step(postEnded)
    .tapIf(hasRouteOns, sendOn);

  /**
   * A delegate's run on one of this conversation's posts was cancelled: end
   * its row under the claim the delegate sent, and send the ending it then
   * owes here, as the board's replay would. The claim fences the write: a row
   * already ended, or claimed again since, declines it, and nothing changes.
   */
  const postCancelled = handler({
    name: "coordinator-post-cancelled",
    inputSchema: postCancelledSchema,
    outputSchema: z.object({}),
    ...blockBase,
    execute: async (cancelled: PostCancelled, ctx) => {
      const ref = await conversationLedgerAt(ctx as never, await filingSessionIdOf(ctx.session));
      const row = ref?.get(cancelled.taskId);
      if (ref === undefined || row === undefined || postRowOf(row) === undefined) return {};
      const outcome = await ref.fail(cancelled.taskId, "its run was cancelled", {
        claim: cancelled.claim,
        ifAllowed: true,
        noRetry: true
      });
      const ended = ref.get(cancelled.taskId);
      if (outcome.outcome !== "declined" && ended !== undefined) {
        await sendOwedNotices(ctx as never, ended, { session: { id: ctx.session.identity.id }, from: "coordinator-post-cancelled" });
      }
      return {};
    }
  });

  /**
   * How this conversation hears a task it filed end: its coordinator's turn
   * under any routing that runs that turn, so the turn can file a failed task
   * again and say so. Judgment always does; best fit does on a post it picks
   * the coordinator for and on a miss with no fallback. Round robin and
   * everyone never run it, so the ending is a line there. A post row's
   * ending is {@link onPostEnded}'s, under every routing.
   */
  const boardEntries = sessionBoard.entries(
    turn.run,
    (ctx) => {
      const { routing } = workerConfigOf(ctx) as unknown as CoordinatorConfig;
      return routing === "judgment" || routing === "best-fit" ? "judgment" : "fixed";
    },
    onPostEnded
  );

  const flow = defineFlow({
    kind: COORDINATOR_FLOW,
    configSchema: coordinatorConfigSchema(turn.settings),
    // The agent turn's binding: the documents a worker may be granted, the
    // per-turn visibility rule, and the request `onStarted` that loads this
    // turn's worker on this flow before anything reads a setting.
    ...turn.bound,
    session: {
      ...installation.session({ ...coordinatorStateShape, ...conversationBoardStateShape }),
      serverOwned: [...COORDINATOR_SERVER_OWNED, ...CONVERSATION_BOARD_SERVER_OWNED],
      // Every answer, routing and pass-on writes this one record at once; a pass-on that
      // runs out of retries fails after its round has closed, and its answers are lost.
      cas: { maxRetries: 8 }
    },
    resources: { ...resources, ...(turn.bound.resources ?? {}), ...sessionBoard.resources },
    isolateUserState: options.agent?.isolateUserState ?? false,
    actions: {
      // The eight task tools, as actions on this conversation's board
      // (`addTask_tasks` and the rest, checked against its delegates), and
      // the four delegate actions.
      ...sessionBoard.actions,
      // The session names its worker, so a turn whose input carries any other key is refused.
      run: {
        inputSchema: doorInputSchema.strict(),
        block: door,
        userMessage: (input: DoorInput) => input.message,
        concurrency: REPLY_CONCURRENCY
      },
      // A page reads and edits the coordinator's standing rules for the
      // signed-in user here (FIX-1945 S5).
      [STANDING_RULES_ACTION]: standingRulesAction
    },
    internal: {
      actions: {
        // A delegate still working at its round's deadline wakes the
        // conversation here, with nothing: it closes every overdue round.
        [ROUND_DEADLINE_ACTION]: { inputSchema: z.object({}).strict(), block: sweep, concurrency: "queue" },
        // A delegate whose run on a post was cancelled tells it here; this ends the row.
        [POST_CANCELLED_ACTION]: { inputSchema: postCancelledSchema, block: postCancelled, concurrency: "queue" },
        // Only this conversation's own code sends answers back out. A round's
        // routing can run the coordinator's turn, so it is a reply too.
        [ROUTE_ON_ACTION]: { inputSchema: routeOnSchema, block: routeOnEntry, concurrency: REPLY_CONCURRENCY },
        // A filing's wake (one run of this conversation's board, as its
        // owner), and a task this conversation filed ended: its notice.
        ...boardEntries,
        // A workstream's entry path adds or removes its record, on a project's
        // coordinator only (FIX-1793). Never public: a record with a target
        // is written nowhere else.
        [WORKSTREAM_DELEGATE_ACTION]: {
          ...workstreamDelegateEntry({ check, defaults: async (ctx) => (await coordinatorOf(ctx)).defaults }),
          concurrency: "queue"
        }
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
  return Object.assign(mint, flow) as typeof flow;
}
