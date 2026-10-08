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
import { bestFitEvaluationFailed, needsBestFitCall, placeBestFit, type BestFitCase, type BestFitMiss } from "../best-fit";
import {
  claimAnswer,
  delegateKey,
  deliveryDelegateSchema,
  mintDeliveryToken,
  openDelivery,
  settleDelivery,
  type AnswerClaim,
  type DeliveryDelegate,
  type DeliveryLedger
} from "../delivery-ledger";
import { WORKER_ID_STATE_KEY } from "../workers/keys";
import type { WorkerInstallation } from "../workers/installation";
import { coordinatorConfigProblems, coordinatorConfigSchema, type CoordinatorConfig } from "./coordinator-config";
import { createDelegateCheck, takesDelegatedPost } from "./coordinator-check";
import {
  COORDINATOR_SERVER_OWNED,
  changeDelegates,
  coordinatorSessionStateSchema,
  coordinatorStateShape,
  currentDelegates,
  delegateLabel,
  delegateRecordSchema,
  readDelegates,
  sameDelegate,
  type DelegateChange,
  type DelegateDefaults,
  type DelegateList,
  type DelegateRecord
} from "./coordinator-delegates";
import {
  ADD_DELEGATE,
  COORDINATOR_JUDGMENT,
  COORDINATOR_KIND,
  COORDINATOR_ROUTE,
  DELEGATED_POST_ENTRY,
  DELEGATE_ANSWER_ACTION,
  DELIVERIES_STATE,
  HAND_OFF,
  HOLD_STATE,
  LIST_DELEGATES,
  MAX_DELEGATES,
  REMOVE_DELEGATE,
  SET_FALLBACK
} from "./coordinator-keys";
import { emitCoordinatorRoute, routedDelegateSchema, type RoutedDelegate } from "./coordinator-route";
import { delegatedAnswerSchema, type DelegatedAnswer } from "./delegated-post";

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
  /** The model the judgment turn runs on when the worker names none. Defaults to `"intent/chat"`. */
  defaultModel?: string;
}

/** The door's input: what the person says. */
const doorInputSchema = z.object({ message: z.string() });

type DoorInput = z.infer<typeof doorInputSchema>;

/** Request state: the post being routed, and what the turn needs of its worker. */
const POST_STATE = "coordinatorPost";

const postStateSchema = z.object({
  postId: z.string(),
  body: z.string(),
  from: z.string(),
  round: z.number().int().min(0),
  coordinator: z.string(),
  policy: z.string(),
  model: z.string().optional(),
  instructions: z.string().optional(),
  teamInstructions: z.string().optional(),
  defaults: z.object({ delegates: z.array(z.string()), fallback: z.string().optional() }),
  /** What each hand-off of the judgment turn came to. */
  handOffs: z.array(routedDelegateSchema)
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
  coordinator: z.string()
});

type DeliveryRequest = z.infer<typeof deliveryRequestSchema>;

/** A delivery as it is dispatched. */
const deliveryDispatchSchema = deliveryRequestSchema.extend({
  token: z.string(),
  /** False when the ledger already settled this delivery: nothing is dispatched. */
  deliver: z.boolean(),
  sessionKey: z.string()
});

type DeliveryDispatch = z.infer<typeof deliveryDispatchSchema>;

const dispatchFailedSchema = z.object({ dispatchFailed: z.string() });

const delegateListOutputSchema = z.object({
  delegates: z.array(delegateRecordSchema),
  fallback: deliveryDelegateSchema.nullable(),
  max: z.number()
});

/** A delegate list as the actions and tools answer it. */
function listOutput(list: DelegateList) {
  return { delegates: list.delegates, fallback: list.fallback, max: MAX_DELEGATES };
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
  const defaultModel = options.defaultModel ?? "intent/chat";
  for (const flow of options.delegateFlows) {
    if (!takesDelegatedPost(flow)) {
      throw new Error(
        `defineCoordinatorFlow: delegate flow "${flow.kind}" declares no internal "${DELEGATED_POST_ENTRY}" entry, ` +
          `so a delegate on it couldn't take a post. Declare it with delegatedPostEntry(...).`
      );
    }
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

  type Changed = { ok: true; list: DelegateList } | { ok: false; message: string };

  const addInputSchema = z.object({ worker: z.string().min(1), note: z.string().min(1).optional() }).strict();
  const nameInputSchema = z.object({ worker: z.string().min(1) }).strict();
  const fallbackInputSchema = z.object({ worker: z.string().min(1).nullable() }).strict();

  const add = async (ctx: BlockContext, input: z.infer<typeof addInputSchema>): Promise<Changed> => {
    const { defaults } = await coordinatorOf(ctx);
    const checked = await check(ctx, input.worker, "add");
    if (!checked.ok) return checked;
    const record: DelegateRecord = { worker: input.worker, ...(input.note === undefined ? {} : { note: input.note }) };
    return changeDelegates(ctx.session, defaults, { add: record });
  };
  const change = async (ctx: BlockContext, delegateChange: DelegateChange): Promise<Changed> => {
    const { defaults } = await coordinatorOf(ctx);
    return changeDelegates(ctx.session, defaults, delegateChange);
  };
  const list = async (ctx: BlockContext): Promise<DelegateList> => {
    const { defaults } = await coordinatorOf(ctx);
    return readDelegates(ctx.session, defaults);
  };

  /** Throw a refusal, for the actions. */
  const orRefuse = (changed: Changed) => {
    if (!changed.ok) throw new Error(changed.message);
    return listOutput(changed.list);
  };
  /** Hand a refusal back as a value, for the tools: a model can read it and recover. */
  const orTell = (changed: Changed) => (changed.ok ? listOutput(changed.list) : { refused: changed.message });

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

  /** Open the delivery in the ledger, or find it already opened. */
  const openForDelivery = handler({
    name: "coordinator-open-delivery",
    inputSchema: deliveryRequestSchema,
    outputSchema: deliveryDispatchSchema,
    sessionStateSchema: coordinatorSessionStateSchema,
    execute: async (request: DeliveryRequest, ctx): Promise<DeliveryDispatch> => {
      const token = mintDeliveryToken();
      const opened = await withOutcome(
        (mutator: (state: Readonly<Record<string, unknown>>) => Record<string, unknown>) =>
          ctx.session.atomicState(mutator as never),
        (state: Readonly<Record<string, unknown>>) => {
          const ledger = (state[DELIVERIES_STATE] ?? []) as DeliveryLedger;
          const result = openDelivery(ledger, request, token);
          return {
            state: result.ledger === ledger ? {} : { [DELIVERIES_STATE]: result.ledger },
            result: { token: result.delivery.token, deliver: result.deliver }
          };
        }
      );
      if (opened === undefined) throw new Error("The delivery could not be opened.");
      return {
        ...request,
        token: opened.token,
        deliver: opened.deliver,
        sessionKey: `delegate:${delegateKey(request.delegate)}`
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
          state: (delivery: DeliveryDispatch) => ({ [WORKER_ID_STATE_KEY]: delivery.delegate.worker })
        },
        payload: (delivery: DeliveryDispatch) => ({
          token: delivery.token,
          body: delivery.body,
          from: delivery.from,
          coordinator: delivery.coordinator
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

  /** A delivery of this request's post to `delegate`, which runs on `flow`. */
  const deliveryOf = (post: PostState, delegate: DeliveryDelegate, flow: string): DeliveryRequest => ({
    postId: post.postId,
    round: post.round,
    delegate: { worker: delegate.worker, ...(delegate.target === undefined ? {} : { target: delegate.target }) },
    flow,
    body: post.body,
    from: post.from,
    coordinator: post.coordinator
  });

  const openPost = handler({
    name: "coordinator-open-post",
    inputSchema: doorInputSchema,
    outputSchema: z.object({ message: z.string(), policy: z.string() }),
    ...blockBase,
    requestStateSchema,
    execute: async (input: DoorInput, ctx) => {
      const { worker, config, defaults } = await coordinatorOf(ctx as never);
      // The first read seeds the conversation's copy of the defaults.
      await readDelegates(ctx.session, defaults);
      const post: PostState = {
        postId: ctx.request.identity.id,
        body: input.message,
        from: ctx.session.identity.userId ?? "",
        round: 0,
        coordinator: worker.id,
        policy: config.routing,
        ...(config.model === undefined ? {} : { model: config.model }),
        ...(config.instructions === undefined ? {} : { instructions: config.instructions }),
        ...(config.teamInstructions === undefined ? {} : { teamInstructions: config.teamInstructions }),
        defaults: { delegates: [...defaults.delegates], ...(defaults.fallback === undefined ? {} : { fallback: defaults.fallback }) },
        handOffs: []
      };
      await ctx.request.patchState({ [POST_STATE]: post });
      return { message: input.message, policy: config.routing };
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

  const judgmentGenerator = generator({
    name: COORDINATOR_JUDGMENT,
    inputSchema: doorInputSchema,
    requestStateSchema,
    itemVisibility: { client: true, history: true },
    history: true,
    prompt: [
      (_input: unknown, ctx: BlockContext) => postOf(ctx).teamInstructions,
      (_input: unknown, ctx: BlockContext) => postOf(ctx).instructions
    ],
    model: (_input: unknown, ctx: BlockContext) => postOf(ctx).model ?? defaultModel,
    tools: [listDelegatesTool, addDelegateTool, removeDelegateTool, setFallbackTool, handOffTool],
    user: (input: DoorInput) => input.message
  } as never) as BlockDefinition<any, any>;

  /** The judgment turn's one record: each hand-off it made, or that it answered itself. */
  const recordJudgment = handler({
    name: "coordinator-record-judgment",
    inputSchema: z.unknown(),
    outputSchema: z.object({}),
    requestStateSchema,
    execute: async (_reply: unknown, ctx) => {
      const post = postOf(ctx as never);
      await emitCoordinatorRoute(ctx as never, {
        postId: post.postId,
        round: post.round,
        policy: post.policy,
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
    .step(judgmentGenerator)
    .tap(recordJudgment);

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

  /** One roster read per post: every delegate checked now, the options, the holder and the fallback. */
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
      const skipped: RoutedDelegate[] = [];
      for (const record of listed.delegates) {
        const checked = await check(ctx as never, record.worker, "post");
        const delegate = { worker: record.worker, ...(record.target === undefined ? {} : { target: record.target }) };
        if (!checked.ok) {
          skipped.push({ ...delegate, outcome: "skipped", reason: checked.message });
          continue;
        }
        const label = delegateLabel(record);
        reachable.push(label);
        byLabel[label] = { delegate, flow: checked.worker.flow };
        const pickBy = record.note ?? checked.worker.description ?? undefined;
        if (pickBy !== undefined) options[label] = pickBy;
      }
      const hold = coordinatorSessionStateSchema.shape[HOLD_STATE].parse(ctx.session.state[HOLD_STATE] ?? null);
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

  const placedSchema = z.union([
    z.object({
      place: z.literal("deliver"),
      by: z.enum(["held", "evaluated", "fallback"]),
      picks: z.array(deliveryRequestSchema),
      skipped: z.array(routedDelegateSchema)
    }),
    z.object({ place: z.literal("judgment"), reason: z.string(), skipped: z.array(routedDelegateSchema) })
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
      if (placed.by === "none") {
        await ctx.session.patchState({ [HOLD_STATE]: null } as never);
        const reason = missReason(placed.miss) + (placed.fallbackUnreachable ? "; the fallback delegate can't be reached" : "");
        return { place: "judgment", reason, skipped: bestFit.skipped };
      }
      const target = bestFit.byLabel[placed.member]!;
      await ctx.session.patchState({ [HOLD_STATE]: { postId: post.postId, delegate: target.delegate } } as never);
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
        postId: post.postId,
        round: post.round,
        policy: post.policy,
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
        postId: post.postId,
        round: post.round,
        policy: post.policy,
        by: "unplaced",
        delegates: [],
        none: why
      });
      ctx.emit.message(`Nobody took this post: ${why}.`);
      return { unplaced: why };
    }
  });

  const judgmentAfterBestFit = (judgmentTurn.rescue([{ block: unplaced }]) as BlockDefinition<any, any>).connectInput(
    (_placed: unknown, ctx: BlockContext) => ({ message: postOf(ctx).body })
  );

  const afterPlace = router({
    name: "coordinator-best-fit-after",
    inputSchema: placedSchema,
    routes: [deliverPicks, judgmentAfterBestFit],
    execute: (placed: Placed) => (placed.place === "deliver" ? deliverPicks : judgmentAfterBestFit)
  } as never) as BlockDefinition<any, any>;

  const bestFit = sequencer({ name: "coordinator-best-fit", inputSchema: z.unknown() })
    .step(readBestFitCase)
    .step(decideBestFit)
    .step(afterPlace);

  // --- the door ------------------------------------------------------------

  const routeByPolicy = router({
    name: "coordinator-route-by-policy",
    inputSchema: z.object({ message: z.string(), policy: z.string() }),
    routes: [judgmentTurn, bestFit],
    execute: (opened: { policy: string }) => (opened.policy === "best-fit" ? bestFit : judgmentTurn)
  } as never) as BlockDefinition<any, any>;

  const door = sequencer({ name: "coordinator-run", inputSchema: doorInputSchema })
    .step(openPost)
    .step(routeByPolicy);

  // --- an answer -----------------------------------------------------------

  /**
   * A delegate's answer: claimed once by its delivery's token, landed as a
   * line under the delegate's name. A token no delivery carries is refused;
   * a second answer to one delivery writes nothing.
   */
  const delegateAnswer = handler({
    name: "coordinator-delegate-answer",
    inputSchema: delegatedAnswerSchema,
    outputSchema: z.object({ landed: z.boolean() }),
    sessionStateSchema: coordinatorSessionStateSchema,
    execute: async (answer: DelegatedAnswer, ctx) => {
      const claim = await withOutcome(
        (mutator: (state: Readonly<Record<string, unknown>>) => Record<string, unknown>) =>
          ctx.session.atomicState(mutator as never),
        (state: Readonly<Record<string, unknown>>): { state: Record<string, unknown>; result: AnswerClaim } => {
          const claimed = claimAnswer((state[DELIVERIES_STATE] ?? []) as DeliveryLedger, answer.token);
          if (!claimed.claimed) return { state: {}, result: claimed };
          const hold = state[HOLD_STATE] as { postId: string; delegate: DeliveryDelegate } | null | undefined;
          const releases =
            hold !== null &&
            hold !== undefined &&
            hold.postId === claimed.delivery.postId &&
            sameDelegate(hold.delegate, claimed.delivery.delegate);
          return {
            state: { [DELIVERIES_STATE]: claimed.ledger, ...(releases ? { [HOLD_STATE]: null } : {}) },
            result: claimed
          };
        }
      );
      if (claim === undefined) throw new Error("The answer could not be claimed.");
      if (!claim.claimed) {
        if (claim.reason === "unknown-token") {
          throw new Error("No delivery in this conversation carries that token, so the answer was refused.");
        }
        return { landed: false };
      }
      ctx.emit.message(answer.body, { agentName: claim.delivery.delegate.worker });
      return { landed: true };
    }
  });

  const flow = defineFlow({
    kind: COORDINATOR_KIND,
    configSchema: coordinatorConfigSchema(),
    session: { ...installation.session(coordinatorStateShape), serverOwned: COORDINATOR_SERVER_OWNED },
    resources,
    actions: {
      run: { inputSchema: doorInputSchema, block: door, userMessage: (input: DoorInput) => input.message },
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
        // Here only, never in `actions`: an answer names its delivery.
        [DELEGATE_ANSWER_ACTION]: { inputSchema: delegatedAnswerSchema, block: delegateAnswer, concurrency: "queue" }
      }
    }
  } as never) as ReturnType<typeof defineFlow>;

  /**
   * The mint, with the refusals the configuration schema can't carry across
   * keys: a fallback that isn't a default, a default named twice.
   */
  const mint = (mintOptions?: Parameters<typeof flow>[0]) => {
    const instance = flow(mintOptions);
    const problems = coordinatorConfigProblems(instance.config as unknown as CoordinatorConfig);
    if (problems.length > 0) throw new Error(`This coordinator ${problems.join(", and ")}.`);
    return instance;
  };
  return Object.assign(mint, flow) as typeof flow;
}
