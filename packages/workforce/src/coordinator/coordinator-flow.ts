/**
 * The `coordinator` worker flow: a worker that hands each post to delegates
 * from its user's own roster, by its routing policy.
 *
 * One registered copy runs every coordinator worker, the way any worker flow
 * on the installation does: each session names its worker when it is
 * created, and each turn loads that worker's configuration.
 *
 * **What a conversation holds.** Its delegates, its fallback, best fit's
 * hold and the delivery ledger, in server-written session state
 * (`coordinator-delegates.ts`): copied from the worker's defaults the first
 * time they're read or changed, changed only by the four actions and the
 * coordinator's own tools, and never seeded by a session create.
 *
 * **How a post is routed.**
 *
 * - `judgment`: the coordinator's own turn reads the post and hands it to
 *   delegates with its `handOff` tool, or answers itself. It reads its
 *   delegates with its `listDelegates` tool; the list is never in its prompt.
 * - `best-fit`: best fit's ladder (`best-fit.ts`): the delegate still on the
 *   person's last post, else one evaluator call, else the fallback delegate,
 *   else the coordinator's own judgment turn. Only when that turn fails is the
 *   post unplaced, recorded and said in the conversation.
 * - `round-robin`: the next delegate in list order after the one the
 *   person's last post went to.
 * - `everyone`: each delegate.
 *
 * Every pick is checked against the user's roster when the post arrives
 * (`coordinator-check.ts`), so a fired delegate is skipped and recorded
 * without anyone editing the list.
 *
 * **How a delivery reaches a delegate.** Each delivery is opened in the
 * delivery ledger with a token, then dispatched to the delegate's flow on
 * {@link DELEGATED_POST_ENTRY}, into a session keyed by this conversation and
 * the delegate record. The session is created on first delivery, naming the
 * delegate as its worker, so the delegate's own create check links it at
 * create; the key's derivation includes this conversation's incarnation, so a
 * conversation deleted and created again under the same id opens fresh
 * delegate sessions. A later delivery from this conversation reuses it.
 *
 * **How an answer lands.** On the internal {@link DELEGATE_ANSWER_ACTION}, with
 * its delivery's token, claimed once. It lands as a line under the delegate's
 * name. The round, the delegate and the post come from the delivery the
 * token names, never from the answer. With `rounds: 0`, an answer routes
 * nowhere further.
 *
 * **How an answer goes back out** (`coordinator-rounds.ts`). Below the
 * coordinator's `rounds:`, best fit and round robin route each answer again
 * as it lands, never to its author; everyone and judgment send a round's
 * answers on when the round closes. Either way the next round runs on the
 * internal {@link ROUTE_ON_ACTION}, which the conversation dispatches into
 * itself, through the same policy steps as a person's post. A delegate with
 * no answer says so on {@link DELEGATE_MISSED_ACTION}, so a round doesn't wait
 * on a failed or cancelled turn, and closes at its deadline whatever is still
 * out. Every wake of the conversation (a person's post, an answer, a missed
 * report, the end of a routing) also closes each round past its deadline, so
 * a delegate that never reports holds its round only until the next wake.
 */
import {
  choice,
  defineFlow,
  dispatcher,
  evaluator,
  handler,
  router,
  sequencer
} from "@flow-state-dev/core";
import { withOutcome } from "@flow-state-dev/core/helpers";
import type { BlockContext, BlockDefinition, EvaluationModel } from "@flow-state-dev/core/types";
import { z } from "zod";
import { bestFitEvaluationFailed, needsBestFitCall, placeBestFit, type BestFitCase, type BestFitMiss } from "../best-fit";
import {
  claimAnswer,
  delegateKey,
  deliveryDelegateSchema,
  markMissed,
  mintDeliveryToken,
  openDelivery,
  settleDelivery,
  type AnswerClaim,
  type DeliveryDelegate,
  type DeliveryLedger,
  type DeliveryRecord
} from "../delivery-ledger";
import { agentWorkerTurn, type AgentWorkerFlowOptions } from "../agent-worker-flow";
import { FILING_SESSION_STATE_KEY, WORKER_ID_STATE_KEY } from "../workers/keys";
import type { RosterWorker, WorkerInstallation } from "../workers/installation";
import {
  coordinatorConfigProblems,
  coordinatorConfigSchema,
  type CoordinatorConfig,
  type CoordinatorRouting
} from "./coordinator-config";
import { createDelegateCheck, takesDelegatedPost } from "./coordinator-check";
import {
  COORDINATOR_SERVER_OWNED,
  changeDelegates,
  currentDelegates,
  coordinatorSessionStateSchema,
  coordinatorStateShape,
  delegateLabel,
  delegateRecordSchema,
  readDelegates,
  roundAnswerSchema,
  roundRobinCursorSchema,
  sameDelegate,
  turnOrder,
  type DelegateChange,
  type DelegateDefaults,
  type DelegateList,
  type DelegateRecord,
  type OpenRound
} from "./coordinator-delegates";
import {
  ADD_DELEGATE,
  COORDINATOR_JUDGMENT,
  COORDINATOR_KIND,
  COORDINATOR_ROUTE,
  DELEGATED_POST_ENTRY,
  DELEGATE_ANSWER_ACTION,
  DELEGATE_MISSED_ACTION,
  DELIVERIES_STATE,
  HAND_OFF,
  HOLD_STATE,
  LIST_DELEGATES,
  MAX_DELEGATES,
  REMOVE_DELEGATE,
  ROUND_DEADLINE_MS,
  ROUND_ROBIN_STATE,
  ROUNDS_STATE,
  ROUTE_ON_ACTION,
  SET_FALLBACK
} from "./coordinator-keys";
import { emitCoordinatorRoute, routedDelegateSchema, type RoutedDelegate } from "./coordinator-route";
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
  type RouteOn
} from "./coordinator-rounds";
import {
  delegatedAnswerSchema,
  delegatedMissSchema,
  type DelegatedAnswer,
  type DelegatedMiss
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
   * worker's do, against the same catalog. Omitted, the agent's defaults.
   */
  agent?: Omit<AgentWorkerFlowOptions, "installation" | "taskLists">;
  /**
   * How long a round waits for its answers, in milliseconds, before it
   * closes without the ones still out and its answers go back out. Only a
   * coordinator whose `rounds:` is above 0 has rounds to close. Defaults to
   * five minutes ({@link ROUND_DEADLINE_MS}).
   */
  roundDeadlineMs?: number;
}

/** The door's input: what the person says. */
const doorInputSchema = z.object({ message: z.string() });

type DoorInput = z.infer<typeof doorInputSchema>;

/** Request state: the post being routed, and what the turn needs of its worker. */
const POST_STATE = "coordinatorPost";

const postStateSchema = z.object({
  /** The person's post. Answers going back out keep its id, in a later round. */
  postId: z.string(),
  body: z.string(),
  from: z.string(),
  round: z.number().int().min(0),
  coordinator: z.string(),
  /** This conversation's id and incarnation, read from its session record when the post opened. */
  filingSessionId: z.string(),
  policy: z.string(),
  defaults: z.object({ delegates: z.array(z.string()), fallback: z.string().optional() }),
  /** What each hand-off of the judgment turn came to. */
  handOffs: z.array(routedDelegateSchema),
  /** In a round after the person's post: the answers going back out. */
  answers: z.array(roundAnswerSchema).optional(),
  /** Who they never go back to: their author, under best fit and round robin. */
  exclude: deliveryDelegateSchema.optional(),
  /** Why this round's answers go no further, when it was refused at the cap on open rounds. */
  note: z.string().optional()
});

type PostState = z.infer<typeof postStateSchema>;

const requestStateSchema = z.object({ [POST_STATE]: postStateSchema.optional() });

/** One delivery to make. */
const deliveryRequestSchema = z.object({
  postId: z.string(),
  round: z.number().int().min(0),
  delegate: deliveryDelegateSchema,
  /** The flow the delegate's worker runs on. */
  flow: z.string(),
  body: z.string(),
  from: z.string(),
  coordinator: z.string(),
  /** The delivering conversation's id and incarnation, which the delegate's session carries. */
  filingSessionId: z.string()
});

type DeliveryRequest = z.infer<typeof deliveryRequestSchema>;

/** A delivery as it is dispatched. */
const deliveryDispatchSchema = deliveryRequestSchema.extend({
  token: z.string(),
  /** False when the ledger already settled this delivery: nothing is dispatched. */
  deliver: z.boolean(),
  sessionKey: z.string(),
  /** Its round's deadline, when its answer can go back out. */
  deadlineAt: z.number().int().optional()
});

type DeliveryDispatch = z.infer<typeof deliveryDispatchSchema>;

const dispatchFailedSchema = z.object({ dispatchFailed: z.string() });

const delegateListOutputSchema = z.object({
  delegates: z.array(delegateRecordSchema),
  fallback: deliveryDelegateSchema.nullable(),
  max: z.number(),
  /**
   * This conversation's `filingSessionId`: what each of its delegates' sessions
   * carries, and what `findWorkerSession({ worker, filingSessionId })` takes.
   */
  filingSessionId: z.string()
});

/** A conversation's delegates, and the conversation's `filingSessionId`. */
type Listed = { list: DelegateList; filingSessionId: string };

/** A delegate list as the actions and tools answer it. */
function listOutput(listed: Listed) {
  return {
    delegates: listed.list.delegates,
    fallback: listed.list.fallback,
    max: MAX_DELEGATES,
    filingSessionId: listed.filingSessionId
  };
}

/** Hex of the first 8 bytes of the SHA-256 of `text`. */
async function shortDigest(text: string): Promise<string> {
  const bytes = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  let hex = "";
  for (const byte of bytes.subarray(0, 8)) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/**
 * A conversation's `filingSessionId`: its id plus its incarnation, read from
 * the server-written session record, never from a caller. A conversation
 * deleted and created again under the same id gets a new lineage, so a new
 * value. The lineage id itself stays server-side; the value carries a digest
 * of it.
 */
async function filingSessionIdOf(session: { identity: { id: string }; lineageId?: string }): Promise<string> {
  if (session.lineageId === undefined) {
    throw new Error(
      `Session "${session.identity.id}" has no lineageId, so the coordinator refuses it. ` +
        "Each delegate's session is filed under its conversation's id and lineageId; without the lineageId, " +
        "a conversation deleted and created again under this id would pick up its predecessor's delegates. " +
        "Sessions without one aren't supported: run the conversation on a host that sets ctx.session.lineageId."
    );
  }
  return `${session.identity.id}~${await shortDigest(session.lineageId)}`;
}

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
      return `the evaluation answered ${JSON.stringify(miss.choice)}, which is not a delegate`;
  }
}

/**
 * Build the coordinator flow.
 *
 * @throws when a delegate flow declares no {@link DELEGATED_POST_ENTRY}.
 */
export function defineCoordinatorFlow(options: CoordinatorFlowOptions) {
  const { installation } = options;
  for (const flow of options.delegateFlows) {
    if (!takesDelegatedPost(flow)) {
      throw new Error(
        `defineCoordinatorFlow: delegate flow "${flow.kind}" declares no internal "${DELEGATED_POST_ENTRY}" entry, ` +
          `so a delegate on it couldn't take a post. Declare it with delegatedPostEntry(...).`
      );
    }
  }
  const deadlineMs = options.roundDeadlineMs ?? ROUND_DEADLINE_MS;
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) {
    throw new Error(
      `defineCoordinatorFlow: roundDeadlineMs must be a positive number of milliseconds, not ${deadlineMs}.`
    );
  }
  const postFlows = new Set(options.delegateFlows.map((flow) => flow.kind));
  const check = createDelegateCheck(installation, postFlows);
  const resources = { ...installation.resources };

  // -------------------------------------------------------------------------
  // The four delegate changes, shared by the actions (which refuse by
  // throwing) and the tools (which hand the refusal back to the model).
  // -------------------------------------------------------------------------

  /** The worker this conversation runs as, and its defaults. Refuses a session that names none. */
  const coordinatorOf = async (ctx: BlockContext) => {
    const worker = await installation.resolveWorker(ctx, COORDINATOR_KIND);
    const config = worker.config as unknown as CoordinatorConfig;
    return { worker, config, defaults: defaultsOf(config) };
  };

  type Changed = ({ ok: true } & Listed) | { ok: false; message: string };

  /** A change's outcome, with the conversation's `filingSessionId` beside a list that landed. */
  const withFiling = async (ctx: BlockContext, outcome: Awaited<ReturnType<typeof changeDelegates>>): Promise<Changed> =>
    outcome.ok ? { ok: true, list: outcome.list, filingSessionId: await filingSessionIdOf(ctx.session) } : outcome;

  const addInputSchema = z.object({ worker: z.string().min(1), note: z.string().min(1).optional() }).strict();
  const nameInputSchema = z.object({ worker: z.string().min(1) }).strict();
  const fallbackInputSchema = z.object({ worker: z.string().min(1).nullable() }).strict();

  const add = async (ctx: BlockContext, input: z.infer<typeof addInputSchema>): Promise<Changed> => {
    const { defaults } = await coordinatorOf(ctx);
    const checked = await check(ctx, input.worker, "add");
    if (!checked.ok) return checked;
    const record: DelegateRecord = { worker: input.worker, ...(input.note === undefined ? {} : { note: input.note }) };
    return withFiling(ctx, await changeDelegates(ctx.session, defaults, { add: record }));
  };
  const change = async (ctx: BlockContext, delegateChange: DelegateChange): Promise<Changed> => {
    const { defaults } = await coordinatorOf(ctx);
    return withFiling(ctx, await changeDelegates(ctx.session, defaults, delegateChange));
  };
  const list = async (ctx: BlockContext): Promise<Listed> => {
    const { defaults } = await coordinatorOf(ctx);
    return { list: await readDelegates(ctx.session, defaults), filingSessionId: await filingSessionIdOf(ctx.session) };
  };

  /** Throw a refusal, for the actions. */
  const orRefuse = (changed: Changed) => {
    if (!changed.ok) throw new Error(changed.message);
    return listOutput(changed);
  };
  /** Hand a refusal back as a value, for the tools: a model can read it and recover. */
  const orTell = (changed: Changed) => (changed.ok ? listOutput(changed) : { refused: changed.message });

  const toolOutputSchema = z.union([delegateListOutputSchema, z.object({ refused: z.string() })]);
  const blockBase = { resources, sessionStateSchema: coordinatorSessionStateSchema };

  const addDelegateAction = handler({
    name: "coordinator-add-delegate",
    inputSchema: addInputSchema,
    outputSchema: delegateListOutputSchema,
    ...blockBase,
    execute: async (input, ctx) => orRefuse(await add(ctx as never, input))
  });
  const removeDelegateAction = handler({
    name: "coordinator-remove-delegate",
    inputSchema: nameInputSchema,
    outputSchema: delegateListOutputSchema,
    ...blockBase,
    execute: async (input, ctx) => orRefuse(await change(ctx as never, { remove: { worker: input.worker } }))
  });
  const setFallbackAction = handler({
    name: "coordinator-set-fallback",
    inputSchema: fallbackInputSchema,
    outputSchema: delegateListOutputSchema,
    ...blockBase,
    execute: async (input, ctx) =>
      orRefuse(await change(ctx as never, { fallback: input.worker === null ? null : { worker: input.worker } }))
  });
  const listDelegatesAction = handler({
    name: "coordinator-list-delegates",
    inputSchema: z.object({}).strict(),
    outputSchema: delegateListOutputSchema,
    ...blockBase,
    execute: async (_input, ctx) => listOutput(await list(ctx as never))
  });

  const addDelegateTool = handler({
    name: ADD_DELEGATE,
    description:
      "Add a worker on this person's roster to this conversation's delegates, by its id, with an optional note on what it's good at.",
    inputSchema: addInputSchema,
    outputSchema: toolOutputSchema,
    ...blockBase,
    execute: async (input, ctx) => orTell(await add(ctx as never, input))
  });
  const removeDelegateTool = handler({
    name: REMOVE_DELEGATE,
    description: "Remove a delegate from this conversation, by its worker id.",
    inputSchema: nameInputSchema,
    outputSchema: toolOutputSchema,
    ...blockBase,
    execute: async (input, ctx) => orTell(await change(ctx as never, { remove: { worker: input.worker } }))
  });
  const setFallbackTool = handler({
    name: SET_FALLBACK,
    description:
      "Set the delegate that takes a post best fit can't place, by its worker id, or clear it with null.",
    inputSchema: fallbackInputSchema,
    outputSchema: toolOutputSchema,
    ...blockBase,
    execute: async (input, ctx) =>
      orTell(await change(ctx as never, { fallback: input.worker === null ? null : { worker: input.worker } }))
  });
  const listDelegatesTool = handler({
    name: LIST_DELEGATES,
    description:
      "Read who this conversation's delegates are: every one, with its note, and the fallback. Answer who your delegates are from this, never from memory.",
    inputSchema: z.object({}).strict(),
    outputSchema: delegateListOutputSchema,
    ...blockBase,
    execute: async (_input, ctx) => listOutput(await list(ctx as never))
  });

  // -------------------------------------------------------------------------
  // Delivery: open in the ledger, dispatch to the delegate's flow, settle.
  // -------------------------------------------------------------------------

  /**
   * Open the delivery in the ledger, or find it already opened. In a round
   * below the limit it carries the round's deadline, which its round's first
   * delivery sets.
   */
  const openForDelivery = handler({
    name: "coordinator-open-delivery",
    inputSchema: deliveryRequestSchema,
    outputSchema: deliveryDispatchSchema,
    sessionStateSchema: coordinatorSessionStateSchema,
    execute: async (request: DeliveryRequest, ctx): Promise<DeliveryDispatch> => {
      const token = mintDeliveryToken();
      const now = Date.now();
      const opened = await withOutcome(
        (mutator: (state: Readonly<Record<string, unknown>>) => Record<string, unknown>) =>
          ctx.session.atomicState(mutator as never),
        (state: Readonly<Record<string, unknown>>) => {
          const ledger = (state[DELIVERIES_STATE] ?? []) as DeliveryLedger;
          const result = openDelivery(ledger, request, token);
          const rounds = (state[ROUNDS_STATE] ?? []) as OpenRound[];
          const timed = roundDeadline(rounds, request.postId, request.round, now, deadlineMs);
          return {
            state: {
              ...(result.ledger === ledger ? {} : { [DELIVERIES_STATE]: result.ledger }),
              ...(timed.deadlineAt === undefined ? {} : { [ROUNDS_STATE]: timed.rounds })
            },
            result: { token: result.delivery.token, deliver: result.deliver, deadlineAt: timed.deadlineAt }
          };
        }
      );
      if (opened === undefined) throw new Error("The delivery could not be opened.");
      return {
        ...request,
        token: opened.token,
        deliver: opened.deliver,
        sessionKey: `delegate:${delegateKey(request.delegate)}`,
        ...(opened.deadlineAt === undefined ? {} : { deadlineAt: opened.deadlineAt })
      };
    }
  });

  /** One dispatcher per flow a delegate can take a post on. */
  const dispatchers = new Map<string, BlockDefinition<any, any>>();
  for (const kind of postFlows) {
    dispatchers.set(
      kind,
      dispatcher({
        name: `coordinator-deliver-${kind}`,
        flowKind: kind,
        action: DELEGATED_POST_ENTRY,
        inputSchema: deliveryDispatchSchema,
        // The delegate's own session for this conversation: derived from the
        // key and this conversation's incarnation, created naming the
        // delegate from the record this code resolved, so its create check
        // links it. A session that exists keeps its own.
        session: {
          key: (delivery: DeliveryDispatch) => delivery.sessionKey,
          state: (delivery: DeliveryDispatch) => ({
            [WORKER_ID_STATE_KEY]: delivery.delegate.worker,
            [FILING_SESSION_STATE_KEY]: delivery.filingSessionId
          })
        },
        payload: (delivery: DeliveryDispatch) => ({
          token: delivery.token,
          body: delivery.body,
          from: delivery.from,
          coordinator: delivery.coordinator,
          ...(delivery.deadlineAt === undefined ? {} : { deadlineAt: delivery.deadlineAt })
        })
      })
    );
  }

  const dispatchDelivery = router({
    name: "coordinator-dispatch-delivery",
    inputSchema: deliveryDispatchSchema,
    routes: [...dispatchers.values()],
    execute: (delivery: DeliveryDispatch) => {
      const route = dispatchers.get(delivery.flow);
      if (route === undefined) throw new Error(`No delivery reaches flow "${delivery.flow}".`);
      return route;
    }
  } as never) as BlockDefinition<any, any>;

  /** A refused dispatch, as a value the settle step reads. */
  const dispatchFailed = handler({
    name: "coordinator-dispatch-failed",
    inputSchema: z.unknown(),
    outputSchema: dispatchFailedSchema,
    execute: (error: unknown, ctx) => {
      if (ctx.signal.aborted) throw error;
      return { dispatchFailed: error instanceof Error ? error.message : String(error) };
    }
  });

  /** Settle the delivery in the ledger, and say what became of it. */
  const settle = handler({
    name: "coordinator-settle-delivery",
    inputSchema: z.unknown(),
    outputSchema: routedDelegateSchema,
    sessionStateSchema: coordinatorSessionStateSchema,
    execute: async (outcome: unknown, ctx): Promise<RoutedDelegate> => {
      const request = deliveryRequestSchema.parse(ctx.parent?.input);
      const delegate = request.delegate;
      const named = { worker: delegate.worker, ...(delegate.target === undefined ? {} : { target: delegate.target }) };
      const dispatched = outcome as Partial<DeliveryDispatch & { sessionId: string; dispatchFailed: string }>;
      if (dispatched.deliver === false) {
        return { ...named, outcome: "skipped", reason: "it was already handed this post in this round" };
      }
      const token = (ctx.session.state[DELIVERIES_STATE] as DeliveryLedger).find(
        (record) =>
          record.postId === request.postId &&
          record.round === request.round &&
          delegateKey(record.delegate) === delegateKey(delegate)
      )?.token;
      const settled =
        typeof dispatched.sessionId === "string"
          ? ({ delivered: dispatched.sessionId } as const)
          : ({ failed: dispatched.dispatchFailed ?? "the dispatch returned nothing" } as const);
      if (token !== undefined) {
        await ctx.session.atomicState((state) => ({
          [DELIVERIES_STATE]: settleDelivery((state[DELIVERIES_STATE] ?? []) as DeliveryLedger, token, settled)
        }));
      }
      return "delivered" in settled
        ? { ...named, outcome: "delivered" }
        : { ...named, outcome: "failed", reason: settled.failed };
    }
  });

  const deliverOne = sequencer({ name: "coordinator-deliver", inputSchema: deliveryRequestSchema })
    .step(openForDelivery)
    .stepIf((delivery: DeliveryDispatch) => delivery.deliver, dispatchDelivery.rescue([{ block: dispatchFailed }]))
    .step(settle);

  // -------------------------------------------------------------------------
  // The post: open it, then route it by the conversation's policy.
  // -------------------------------------------------------------------------

  /** The post being routed, from request state. Set by the door before anything routes. */
  const postOf = (ctx: BlockContext): PostState => {
    const post = (ctx.request.state as Record<string, unknown>)[POST_STATE] as PostState | undefined;
    if (post === undefined) throw new Error("No post is being routed in this request.");
    return post;
  };

  /** A delegate record as a delivery names it: its worker, and its target when it has one. */
  const bare = (delegate: DeliveryDelegate): DeliveryDelegate => ({
    worker: delegate.worker,
    ...(delegate.target === undefined ? {} : { target: delegate.target })
  });

  /**
   * A delivery of this request's post to `delegate`, which runs on `flow`:
   * the post as it stands, or `passed`, the answers this delegate is handed.
   */
  const deliveryOf = (
    post: PostState,
    delegate: DeliveryDelegate,
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
    filingSessionId: post.filingSessionId
  });

  /** What every record of this request's routing starts with, its note included when it has one. */
  const recordOf = (post: PostState) => ({
    postId: post.postId,
    round: post.round,
    policy: post.policy,
    ...(post.note === undefined ? {} : { note: post.note })
  });

  /** What the judgment turn reads: the person's post, or the answers going back out. */
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
          const result = beginRound((state[ROUNDS_STATE] ?? []) as OpenRound[], post.postId, post.round);
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
      return { message: input.message, policy: post.policy };
    }
  });

  // --- judgment ------------------------------------------------------------

  const handOffInputSchema = z.object({ worker: z.string().min(1) }).strict();
  const handOffRefusedSchema = z.object({ refused: z.string(), worker: z.string() });

  /** Whether the coordinator may hand this post to `worker`: on the list, and passing the check now. */
  const handOffCheck = handler({
    name: "coordinator-hand-off-check",
    inputSchema: handOffInputSchema,
    outputSchema: z.union([deliveryRequestSchema, handOffRefusedSchema]),
    ...blockBase,
    requestStateSchema,
    execute: async (input, ctx) => {
      const post = postOf(ctx as never);
      // Read now, through the versioned read: an add earlier in this turn is on it.
      const listed = currentDelegates(ctx.session.state, post.defaults);
      const record = listed.delegates.find((candidate) => sameDelegate(candidate, { worker: input.worker }));
      if (record === undefined) {
        return {
          worker: input.worker,
          refused: `"${input.worker}" isn't a delegate in this conversation. Add it first.`
        };
      }
      const checked = await check(ctx as never, record.worker, "post");
      if (!checked.ok) return { worker: input.worker, refused: checked.message };
      return deliveryOf(post, record, checked.worker.flow);
    }
  });

  /** Note what the hand-off came to, for the turn's record, and tell the model. */
  const noteHandOff = handler({
    name: "coordinator-note-hand-off",
    inputSchema: z.unknown(),
    outputSchema: z.object({ worker: z.string(), outcome: z.string(), note: z.string() }),
    requestStateSchema,
    execute: async (value: unknown, ctx) => {
      const refused = handOffRefusedSchema.safeParse(value);
      const routed: RoutedDelegate = refused.success
        ? { worker: refused.data.worker, outcome: "skipped", reason: refused.data.refused }
        : routedDelegateSchema.parse(value);
      await ctx.request.patchState(POST_STATE as never, ((post: PostState) => ({
        ...post,
        handOffs: [...post.handOffs, routed]
      })) as never);
      const note =
        routed.outcome === "delivered"
          ? `Handed to ${routed.worker}. Its answer will land in this conversation under its name.`
          : `Not handed to ${routed.worker}: ${routed.reason ?? routed.outcome}.`;
      return { worker: routed.worker, outcome: routed.outcome, note };
    }
  });

  const handOffTool = sequencer({
    name: HAND_OFF,
    description:
      "Hand the post you are reading to one of this conversation's delegates, by its worker id. Its answer lands in this conversation under its name. Each delegate takes a post once.",
    inputSchema: handOffInputSchema
  })
    .step(handOffCheck)
    .stepIf((value: unknown) => deliveryRequestSchema.safeParse(value).success, deliverOne)
    .step(noteHandOff);

  /**
   * The judgment turn: the built-in agent's own turn, shared rather than
   * copied, run as this conversation's worker. It reads the worker's
   * instructions, model, tools, skills and capabilities as an `agent` worker's
   * are read, and carries the four delegate tools and the hand-off on every
   * coordinator, whatever the worker's `tools:` line grants.
   */
  const turn = agentWorkerTurn(
    { ...(options.agent ?? {}), installation },
    {
      kind: COORDINATOR_KIND,
      answerName: COORDINATOR_JUDGMENT,
      extraTools: [listDelegatesTool, addDelegateTool, removeDelegateTool, setFallbackTool, handOffTool]
    }
  );

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
          : { none: "the coordinator handed it to no delegate" })
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
    records: readonly DelegateRecord[],
    exclude: DeliveryDelegate | undefined,
    visit: (record: DelegateRecord, worker: RosterWorker) => Visit
  ): Promise<RoutedDelegate[]> => {
    const skipped: RoutedDelegate[] = [];
    for (const record of records) {
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
      fallback: z.string().optional()
    }),
    /** Each reachable delegate, by its label, with the flow it runs on. */
    byLabel: z.record(z.object({ delegate: deliveryDelegateSchema, flow: z.string() })),
    skipped: z.array(routedDelegateSchema),
    post: z.object({ from: z.string(), text: z.string() })
  });

  type BestFitCaseValue = z.infer<typeof bestFitCaseSchema>;

  /**
   * One roster read per post: every delegate checked now, the options, the
   * holder and the fallback. An answer going back out is never offered to its
   * own author, and holds nothing: the hold is about a person's posts.
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
      return {
        ladder: {
          ...(held !== undefined && reachable.includes(held) ? { held } : {}),
          reachable,
          options,
          ...(fallback === undefined ? {} : { fallback })
        },
        byLabel,
        skipped,
        post: { from: post.from, text: post.body }
      };
    }
  });

  const routeEvaluator = evaluator({
    name: COORDINATOR_ROUTE,
    model: options.routeModel,
    inputSchema: bestFitCaseSchema,
    state: (bestFit: BestFitCaseValue) => ({ post: bestFit.post }),
    questions: (bestFit: BestFitCaseValue) => ({
      member: choice("Which delegate should answer the post?", bestFit.ladder.options)
    })
  });

  /** Where a fixed policy put the post: deliveries to make, best fit's miss for judgment, or nobody. */
  const placedSchema = z.union([
    z.object({
      place: z.literal("deliver"),
      by: z.enum(["held", "evaluated", "fallback", "round-robin", "everyone"]),
      picks: z.array(deliveryRequestSchema),
      skipped: z.array(routedDelegateSchema)
    }),
    z.object({ place: z.literal("judgment"), reason: z.string(), skipped: z.array(routedDelegateSchema) }),
    z.object({ place: z.literal("unplaced"), reason: z.string(), skipped: z.array(routedDelegateSchema) })
  ]);

  type Placed = z.infer<typeof placedSchema>;

  /** Place the post on best fit's ladder, and note who now holds the person's next post. */
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
      // Only a person's post moves the hold.
      const holds = post.round === 0;
      if (placed.by === "none") {
        if (holds) await ctx.session.patchState({ [HOLD_STATE]: null } as never);
        const reason = missReason(placed.miss) + (placed.fallbackUnreachable ? "; the fallback delegate can't be reached" : "");
        return { place: "judgment", reason, skipped: bestFit.skipped };
      }
      const target = bestFit.byLabel[placed.member]!;
      if (holds) {
        await ctx.session.patchState({ [HOLD_STATE]: { postId: post.postId, delegate: target.delegate } } as never);
      }
      return {
        place: "deliver",
        by: placed.by,
        picks: [deliveryOf(post, target.delegate, target.flow)],
        skipped: bestFit.skipped
      };
    }
  });

  const decideBestFit = sequencer({ name: "coordinator-best-fit-decide", inputSchema: bestFitCaseSchema })
    .stepIf(
      (bestFit: BestFitCaseValue) => needsBestFitCall(bestFit.ladder as BestFitCase),
      routeEvaluator.rescue([{ block: bestFitEvaluationFailed("coordinator-route-evaluation-failed") }])
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
        ...(delivered ? {} : { none: "no pick could be delivered" })
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
        none: why
      });
      // A person's post is answered in the conversation; answers going back out aren't.
      if (post.round === 0) ctx.emit.message(`Nobody took this post: ${why}.`);
      return { unplaced: why };
    }
  });

  const judgmentAfterBestFit = (judgmentTurn.rescue([{ block: unplaced }]) as BlockDefinition<any, any>).connectInput(
    (_placed: unknown, ctx: BlockContext) => ({ message: turnMessage(postOf(ctx)) })
  );

  /**
   * A fixed policy found nobody to take the post: recorded, and on a person's
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

  /**
   * The next delegate in list order that can be reached. For a person's post
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
      const after =
        author === undefined
          ? roundRobinCursorSchema.nullable().parse(ctx.session.state[ROUND_ROBIN_STATE] ?? null)
          : { delegate: author, index: Math.max(0, list.findIndex((record) => sameDelegate(record, author))) };
      let pick: { record: DelegateRecord; flow: string } | undefined;
      const skipped = await scanReachable(ctx as never, turnOrder(list, after), author, (record, worker) => {
        pick = { record, flow: worker.flow };
        return "stop";
      });
      if (pick !== undefined) {
        const { record, flow } = pick;
        if (author === undefined) {
          const index = list.findIndex((candidate) => sameDelegate(candidate, record));
          await ctx.session.patchState({ [ROUND_ROBIN_STATE]: { delegate: bare(record), index } } as never);
        }
        return { place: "deliver", by: "round-robin", picks: [deliveryOf(post, record, flow)], skipped };
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
   * Each delegate that can be reached. On a person's post each gets the post;
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
    event: { landed?: { delivery: DeliveryRecord; body: string; kept: boolean }; closed: readonly ClosedRound[] }
  ): Promise<RouteOn[]> => {
    // An answer that landed outside an open round, and no round closed: nothing goes on.
    if (event.landed?.kept !== true && event.closed.length === 0) return [];
    const { config } = await coordinatorOf(ctx);
    const { routing, rounds } = config;
    const landed = event.landed;
    return [
      landed === undefined ? undefined : routeOnAfterAnswer(landed.delivery, landed.body, landed.kept, routing, rounds),
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

  /** The state an atomic write reads rounds from. */
  const roundsIn = (state: Readonly<Record<string, unknown>>) => ({
    rounds: (state[ROUNDS_STATE] ?? []) as OpenRound[],
    ledger: (state[DELIVERIES_STATE] ?? []) as DeliveryLedger
  });

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
      const closed = await withOutcome(
        (mutator: (state: Readonly<Record<string, unknown>>) => Record<string, unknown>) =>
          ctx.session.atomicState(mutator as never),
        (state: Readonly<Record<string, unknown>>) => {
          const { rounds, ledger } = roundsIn(state);
          const swept = closeOverdue(rounds, ledger, now);
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
      const closed = await withOutcome(
        (mutator: (state: Readonly<Record<string, unknown>>) => Record<string, unknown>) =>
          ctx.session.atomicState(mutator as never),
        (state: Readonly<Record<string, unknown>>) => {
          const { rounds, ledger } = roundsIn(state);
          const ended = rounds.some(isThisRound)
            ? closeRound(endRound(rounds, post.postId, post.round), ledger, post.postId, post.round, now)
            : { rounds };
          const swept = closeOverdue(ended.rounds, ledger, now);
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
   * Open a round after the person's post: the answers going back out, routed
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

  // --- an answer -----------------------------------------------------------

  /**
   * A delegate's answer: claimed once by its delivery's token, landed as a
   * line under the delegate's name. A token no delivery carries is refused;
   * a second answer to one delivery writes nothing. In an open round the
   * answer is kept for what goes on, and the round closes if it was the last
   * one out; in a round already closed, it lands and goes no further. Like
   * every wake, it also closes each round past its deadline.
   */
  const claimDelegateAnswer = handler({
    name: "coordinator-delegate-answer",
    inputSchema: delegatedAnswerSchema,
    outputSchema: z.object({ landed: z.boolean(), routeOns: z.array(routeOnSchema).optional() }),
    ...blockBase,
    execute: async (answer: DelegatedAnswer, ctx) => {
      const now = Date.now();
      type Claimed = { claim: AnswerClaim; kept: boolean; closed: ClosedRound[] };
      const outcome = await withOutcome(
        (mutator: (state: Readonly<Record<string, unknown>>) => Record<string, unknown>) =>
          ctx.session.atomicState(mutator as never),
        (state: Readonly<Record<string, unknown>>): { state: Record<string, unknown>; result: Claimed } => {
          const { rounds, ledger } = roundsIn(state);
          const claimed = claimAnswer(ledger, answer.token);
          // A refused answer writes nothing, not even the sweep: its close would go unrouted.
          if (!claimed.claimed && claimed.reason === "unknown-token") {
            return { state: {}, result: { claim: claimed, kept: false, closed: [] } };
          }
          if (!claimed.claimed) {
            const swept = closeOverdue(rounds, ledger, now);
            return {
              state: swept.closed.length === 0 ? {} : { [ROUNDS_STATE]: swept.rounds },
              result: { claim: claimed, kept: false, closed: swept.closed }
            };
          }
          const hold = state[HOLD_STATE] as { postId: string; delegate: DeliveryDelegate } | null | undefined;
          const releases =
            hold !== null &&
            hold !== undefined &&
            hold.postId === claimed.delivery.postId &&
            sameDelegate(hold.delegate, claimed.delivery.delegate);
          const landed = landAnswer(rounds, claimed.ledger, claimed.delivery, answer.body, now);
          const swept = closeOverdue(landed.rounds, claimed.ledger, now);
          return {
            state: {
              [DELIVERIES_STATE]: claimed.ledger,
              ...(releases ? { [HOLD_STATE]: null } : {}),
              ...(rounds.length === 0 ? {} : { [ROUNDS_STATE]: swept.rounds })
            },
            result: {
              claim: claimed,
              kept: landed.kept,
              closed: [...(landed.closed === undefined ? [] : [landed.closed]), ...swept.closed]
            }
          };
        }
      );
      if (outcome === undefined) throw new Error("The answer could not be claimed.");
      const { claim } = outcome;
      if (!claim.claimed && claim.reason === "unknown-token") {
        throw new Error("No delivery in this conversation carries that token, so the answer was refused.");
      }
      if (!claim.claimed) {
        return { landed: false, ...routeOnsOutput(await routeOnsFor(ctx as never, { closed: outcome.closed })) };
      }
      ctx.emit.message(answer.body, { agentName: claim.delivery.delegate.worker });
      const routeOns = await routeOnsFor(ctx as never, {
        landed: { delivery: claim.delivery, body: answer.body, kept: outcome.kept },
        closed: outcome.closed
      });
      return { landed: true, ...routeOnsOutput(routeOns) };
    }
  });

  const delegateAnswer = sequencer({ name: "coordinator-delegate-answered", inputSchema: delegatedAnswerSchema })
    .step(claimDelegateAnswer)
    .tapIf(hasRouteOns, sendOn);

  /**
   * A delegate with no answer for a delivery: its turn failed or its run was
   * cancelled, or its round's deadline came while it was still working. The
   * delivery is marked missed, once, and its round closes if nothing else is
   * out, or if its deadline has passed. The round's deadline is this
   * conversation's own: the report only wakes it. Like every wake, it also
   * closes each round past its deadline. A token no delivery carries is
   * refused.
   */
  const claimDelegateMiss = handler({
    name: "coordinator-delegate-missed",
    inputSchema: delegatedMissSchema,
    outputSchema: z.object({ missed: z.boolean(), routeOns: z.array(routeOnSchema).optional() }),
    ...blockBase,
    execute: async (miss: DelegatedMiss, ctx) => {
      const now = Date.now();
      const why =
        miss.failed === undefined ? "it hadn't answered by the round's deadline" : `its turn failed: ${miss.failed}`;
      type Marked = { marked: boolean; unknown: boolean; closed: ClosedRound[] };
      const outcome = await withOutcome(
        (mutator: (state: Readonly<Record<string, unknown>>) => Record<string, unknown>) =>
          ctx.session.atomicState(mutator as never),
        (state: Readonly<Record<string, unknown>>): { state: Record<string, unknown>; result: Marked } => {
          const { rounds, ledger } = roundsIn(state);
          const marked = markMissed(ledger, miss.token, why);
          if (!marked.marked && marked.reason === "unknown-token") {
            return { state: {}, result: { marked: false, unknown: true, closed: [] } };
          }
          if (!marked.marked) {
            const swept = closeOverdue(rounds, ledger, now);
            return {
              state: swept.closed.length === 0 ? {} : { [ROUNDS_STATE]: swept.rounds },
              result: { marked: false, unknown: false, closed: swept.closed }
            };
          }
          const { postId, round } = marked.delivery;
          const closing = closeRound(rounds, marked.ledger, postId, round, now);
          const swept = closeOverdue(closing.rounds, marked.ledger, now);
          return {
            state: {
              [DELIVERIES_STATE]: marked.ledger,
              ...(rounds.length === 0 ? {} : { [ROUNDS_STATE]: swept.rounds })
            },
            result: {
              marked: true,
              unknown: false,
              closed: [...(closing.closed === undefined ? [] : [closing.closed]), ...swept.closed]
            }
          };
        }
      );
      if (outcome === undefined) throw new Error("The missed delivery could not be marked.");
      if (outcome.unknown) {
        throw new Error("No delivery in this conversation carries that token, so the report was refused.");
      }
      const routeOns = await routeOnsFor(ctx as never, { closed: outcome.closed });
      return { missed: outcome.marked, ...routeOnsOutput(routeOns) };
    }
  });

  const delegateMissed = sequencer({ name: "coordinator-delegate-missed-it", inputSchema: delegatedMissSchema })
    .step(claimDelegateMiss)
    .tapIf(hasRouteOns, sendOn);

  const flow = defineFlow({
    kind: COORDINATOR_KIND,
    configSchema: coordinatorConfigSchema(turn.settings),
    // The agent turn's binding: the documents a worker may be granted, the
    // per-turn visibility rule, and the request `onStarted` that loads this
    // turn's worker on this flow before anything reads a setting.
    ...turn.bound,
    session: { ...installation.session(coordinatorStateShape), serverOwned: COORDINATOR_SERVER_OWNED },
    resources: { ...resources, ...(turn.bound.resources ?? {}) },
    actions: {
      // The session names its worker, so a turn whose input carries any other key is refused.
      run: { inputSchema: doorInputSchema.strict(), block: door, userMessage: (input: DoorInput) => input.message },
      [ADD_DELEGATE]: {
        inputSchema: addInputSchema,
        block: addDelegateAction,
        description: "Add a worker on your roster to this conversation's delegates."
      },
      [REMOVE_DELEGATE]: {
        inputSchema: nameInputSchema,
        block: removeDelegateAction,
        description: "Remove a delegate from this conversation."
      },
      [SET_FALLBACK]: {
        inputSchema: fallbackInputSchema,
        block: setFallbackAction,
        description: "Set or clear this conversation's fallback delegate."
      },
      [LIST_DELEGATES]: {
        inputSchema: z.object({}).strict(),
        block: listDelegatesAction,
        description: "Read this conversation's delegates and its fallback."
      }
    },
    internal: {
      actions: {
        // Here only, never in `actions`: an answer, and a report of none, name their delivery.
        [DELEGATE_ANSWER_ACTION]: { inputSchema: delegatedAnswerSchema, block: delegateAnswer, concurrency: "queue" },
        [DELEGATE_MISSED_ACTION]: { inputSchema: delegatedMissSchema, block: delegateMissed, concurrency: "queue" },
        // Only this conversation's own code sends answers back out.
        [ROUTE_ON_ACTION]: { inputSchema: routeOnSchema, block: routeOnEntry }
      }
    }
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
