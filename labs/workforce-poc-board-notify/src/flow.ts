/**
 * Static board-notify lab — Workforce L2 composition, no MessageBoard L1.
 *
 * A topic-scoped collection holds subscribers as data (flow / session / entry).
 * `reactTo` fans out through a **router over declared dispatchers**. The stored
 * `entry` is documentary — it never becomes `dispatcher({ target: entry })`.
 *
 * Fence: `packages/core/src/types/dispatch.ts` — "A target chosen from data is
 * a router over declared dispatchers, not a dynamic address."
 */
import {
  DispatchRefusedError,
  defineFlow,
  defineResourceCollection,
  dispatcher,
  handler,
  resourceChangeSchema,
  router,
  sequencer
} from "@flow-state-dev/core";
import type { ResourceChange, ResourceCollectionRef } from "@flow-state-dev/core";
import { z } from "zod";
import { shouldPruneSubscription } from "./prune";

export const FLOW_KIND = "workforce-poc-board-notify";
export const NOTIFY_ENTRY = "onNotify";
export const DECLARED_SEATS = ["alice", "bob"] as const;

export const seatSchema = z.enum(DECLARED_SEATS);
export type Seat = z.infer<typeof seatSchema>;

export const subscriberSchema = z.object({
  seat: seatSchema,
  sessionId: z.string(),
  /** Documentary. Never resolved as a dispatch address. */
  flow: z.string(),
  /** Documentary. Never passed to `dispatcher()`. */
  entry: z.string()
});
export type Subscriber = z.infer<typeof subscriberSchema>;

export const postSchema = z.object({
  id: z.string(),
  body: z.string(),
  fromSessionId: z.string()
});

export const boardStateSchema = z.object({
  brief: z.string().default(""),
  thread: z.array(postSchema).default([]),
  subscribers: z.array(subscriberSchema).default([]),
  retired: z.boolean().default(false)
});
export type BoardState = z.infer<typeof boardStateSchema>;

export const sessionStateSchema = z.object({
  lastNotify: z
    .object({
      topic: z.string(),
      postId: z.string(),
      body: z.string(),
      fromSessionId: z.string(),
      seat: seatSchema
    })
    .nullable()
    .default(null)
});

const wakeSchema = z.object({
  topic: z.string(),
  seat: seatSchema,
  sessionId: z.string(),
  postId: z.string(),
  body: z.string(),
  fromSessionId: z.string()
});
export type Wake = z.infer<typeof wakeSchema>;

const notifyPayloadSchema = wakeSchema.omit({ sessionId: true });

function wakesFrom(change: ResourceChange<BoardState>): Wake[] {
  const state = change.state;
  if (state == null) return [];
  const last = state.thread[state.thread.length - 1];
  if (last === undefined) return [];
  return state.subscribers.map((sub) => ({
    topic: change.key,
    seat: sub.seat,
    sessionId: sub.sessionId,
    postId: last.id,
    body: last.body,
    fromSessionId: last.fromSessionId
  }));
}

export function threadGrew(change: ResourceChange<BoardState>): boolean {
  if (change.state == null || change.state.retired) return false;
  const prev = change.prevState?.thread.length ?? 0;
  return change.state.thread.length > prev && change.state.subscribers.length > 0;
}

const onNotify = handler({
  name: "on-notify",
  inputSchema: notifyPayloadSchema,
  outputSchema: z.object({ sessionId: z.string(), seat: seatSchema }),
  sessionStateSchema,
  execute: async (input, ctx) => {
    await ctx.session.patchState({
      lastNotify: {
        topic: input.topic,
        postId: input.postId,
        body: input.body,
        fromSessionId: input.fromSessionId,
        seat: input.seat
      }
    });
    return { sessionId: ctx.session.identity.id, seat: input.seat };
  }
});

function notifySeat(seat: Seat) {
  return dispatcher({
    name: `notify-${seat}`,
    type: "internal",
    target: NOTIFY_ENTRY,
    inputSchema: wakeSchema,
    session: { id: (input) => input.sessionId },
    payload: (input) => ({
      topic: input.topic,
      seat,
      postId: input.postId,
      body: input.body,
      fromSessionId: input.fromSessionId
    })
  });
}

/** Declared at defineFlow time. Selection is a router, not a constructed address. */
export const notifyAlice = notifySeat("alice");
export const notifyBob = notifySeat("bob");

const notifyOutcomeSchema = z.object({
  ok: z.boolean(),
  topic: z.string(),
  seat: seatSchema,
  sessionId: z.string(),
  refused: z.string().nullable()
});
type NotifyOutcome = z.infer<typeof notifyOutcomeSchema>;

const notifyRouter = router({
  name: "notify-router",
  inputSchema: wakeSchema,
  routes: [notifyAlice, notifyBob],
  execute: (input) => (input.seat === "alice" ? notifyAlice : notifyBob)
});

/**
 * Select a declared dispatcher for this wake. The factory closes over the
 * subscriber identity so a refusal still names who to prune — it does not
 * construct a dispatcher from `entry` data. `blocks` keeps both addresses
 * on the `defineFlow` walk.
 */
function deliverWake(wake: Wake) {
  return sequencer({
    name: `deliver-${wake.seat}`,
    inputSchema: wakeSchema,
    outputSchema: notifyOutcomeSchema
  })
    .step(notifyRouter)
    .map(() => ({
      ok: true as const,
      topic: wake.topic,
      seat: wake.seat,
      sessionId: wake.sessionId,
      refused: null
    }))
    .rescue([
      {
        when: [DispatchRefusedError],
        block: handler({
          name: `refuse-${wake.seat}`,
          inputSchema: z.any(),
          outputSchema: notifyOutcomeSchema,
          execute: (err: unknown): NotifyOutcome => ({
            ok: false,
            topic: wake.topic,
            seat: wake.seat,
            sessionId: wake.sessionId,
            refused: err instanceof DispatchRefusedError ? err.refused : "dispatch-rejected"
          })
        })
      }
    ]);
}

const packNotifies = handler({
  name: "pack-notifies",
  inputSchema: resourceChangeSchema(boardStateSchema),
  outputSchema: z.object({ topic: z.string(), wakes: z.array(wakeSchema) }),
  execute: (change: ResourceChange<BoardState>) => ({
    topic: change.key,
    wakes: wakesFrom(change)
  })
});

const pruneDead = handler({
  name: "prune-dead",
  inputSchema: z.array(notifyOutcomeSchema),
  outputSchema: z.object({
    topic: z.string(),
    pruned: z.array(z.string())
  }),
  execute: async (outcomes, ctx) => {
    const sessionIds = new Set<string>();
    let topic = "";
    for (const outcome of outcomes) {
      if (outcome.topic.length > 0) topic = outcome.topic;
      if (outcome.refused !== null && shouldPruneSubscription(outcome.refused as Parameters<typeof shouldPruneSubscription>[0])) {
        sessionIds.add(outcome.sessionId);
      }
    }
    if (sessionIds.size === 0 || topic.length === 0) {
      return { topic, pruned: [] };
    }
    const collection = ctx.resources.boards as unknown as ResourceCollectionRef<BoardState>;
    const board = await collection.get(topic);
    const next = board.state.subscribers.filter((sub) => !sessionIds.has(sub.sessionId));
    await board.patchState({ subscribers: next });
    return { topic, pruned: [...sessionIds] };
  }
});

/**
 * Bound on the collection and declared as an internal entry so `defineFlow`
 * walks the two static dispatchers. reactTo is what actually runs it.
 */
export const notifyOnChange = sequencer({
  name: "notify-on-change",
  inputSchema: resourceChangeSchema(boardStateSchema)
})
  .step(packNotifies)
  .forEach((packed) => packed.wakes, deliverWake, {
    blocks: [notifyAlice, notifyBob]
  })
  .step(pruneDead);

export const boards = defineResourceCollection({
  scope: "user",
  pattern: "boards/*",
  flowIsolation: true,
  writable: true,
  stateSchema: boardStateSchema,
  reactTo: {
    stateUpdated: {
      block: notifyOnChange,
      when: threadGrew
    }
  }
});

const emptyBoard = (): BoardState => ({
  brief: "",
  thread: [],
  subscribers: [],
  retired: false
});

async function boardOf(ctx: { resources: Record<string, unknown> }, topic: string) {
  const collection = ctx.resources.boards as unknown as ResourceCollectionRef<BoardState>;
  return collection.getOrCreate(topic, emptyBoard());
}

const openBoard = handler({
  name: "open-board",
  inputSchema: z.object({ topic: z.string() }),
  outputSchema: z.object({ topic: z.string() }),
  resources: { boards },
  execute: async (input, ctx) => {
    await boardOf(ctx, input.topic);
    return { topic: input.topic };
  }
});

const subscribe = handler({
  name: "subscribe",
  inputSchema: z.object({
    topic: z.string(),
    seat: seatSchema,
    sessionId: z.string().optional(),
    flow: z.string().optional(),
    entry: z.string().optional()
  }),
  outputSchema: z.object({
    topic: z.string(),
    subscribers: z.array(subscriberSchema)
  }),
  resources: { boards },
  execute: async (input, ctx) => {
    const board = await boardOf(ctx, input.topic);
    const record: Subscriber = {
      seat: input.seat,
      sessionId: input.sessionId ?? ctx.session.identity.id,
      flow: input.flow ?? FLOW_KIND,
      entry: input.entry ?? NOTIFY_ENTRY
    };
    const current = board.state.subscribers;
    const subscribers = current.some((s) => s.sessionId === record.sessionId && s.seat === record.seat)
      ? current
      : [...current, record];
    if (subscribers !== current) {
      await board.patchState({ subscribers });
    }
    return { topic: input.topic, subscribers };
  }
});

const unsubscribe = handler({
  name: "unsubscribe",
  inputSchema: z.object({ topic: z.string(), sessionId: z.string().optional() }),
  outputSchema: z.object({ topic: z.string(), subscribers: z.array(subscriberSchema) }),
  resources: { boards },
  execute: async (input, ctx) => {
    const board = await boardOf(ctx, input.topic);
    const sessionId = input.sessionId ?? ctx.session.identity.id;
    const subscribers = board.state.subscribers.filter((s) => s.sessionId !== sessionId);
    await board.patchState({ subscribers });
    return { topic: input.topic, subscribers };
  }
});

const post = handler({
  name: "post",
  inputSchema: z.object({
    topic: z.string(),
    body: z.string(),
    brief: z.string().optional()
  }),
  outputSchema: z.object({
    topic: z.string(),
    postId: z.string(),
    brief: z.string()
  }),
  resources: { boards },
  execute: async (input, ctx) => {
    const board = await boardOf(ctx, input.topic);
    if (board.state.retired) {
      throw new Error(`board "${input.topic}" is retired`);
    }
    const postId = `post_${ctx.request.identity.id}`;
    const fromSessionId = ctx.session.identity.id;
    const brief = input.brief ?? board.state.brief;
    await board.patchState({
      brief,
      thread: [...board.state.thread, { id: postId, body: input.body, fromSessionId }]
    });
    return { topic: input.topic, postId, brief };
  }
});

const retire = handler({
  name: "retire-board",
  inputSchema: z.object({ topic: z.string() }),
  outputSchema: z.object({ topic: z.string(), retired: z.literal(true) }),
  resources: { boards },
  execute: async (input, ctx) => {
    const board = await boardOf(ctx, input.topic);
    await board.patchState({ retired: true });
    return { topic: input.topic, retired: true as const };
  }
});

const readBoard = handler({
  name: "read-board",
  inputSchema: z.object({ topic: z.string() }),
  outputSchema: z.object({
    topic: z.string(),
    brief: z.string(),
    thread: z.array(postSchema),
    subscribers: z.array(subscriberSchema),
    retired: z.boolean()
  }),
  resources: { boards },
  execute: async (input, ctx) => {
    const board = await boardOf(ctx, input.topic);
    return {
      topic: input.topic,
      brief: board.state.brief,
      thread: board.state.thread,
      subscribers: board.state.subscribers,
      retired: board.state.retired
    };
  }
});

export const boardNotifyFlow = defineFlow({
  kind: FLOW_KIND,
  session: { stateSchema: sessionStateSchema },
  resources: { boards },
  actions: {
    openBoard: { block: openBoard },
    subscribe: { block: subscribe },
    unsubscribe: { block: unsubscribe },
    post: { block: post },
    retire: { block: retire },
    read: { block: readBoard }
  },
  internal: {
    actions: {
      [NOTIFY_ENTRY]: {
        block: onNotify
      },
      notifyOnChange: { block: notifyOnChange }
    }
  }
})({ id: "default" });

/** Minimal other-kind flow so the lab can show today's cross-flow refuse. */
export const otherKindFlow = defineFlow({
  kind: "other-kind",
  actions: {
    ping: {
      block: handler({
        name: "ping",
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.literal(true) }),
        execute: () => ({ ok: true as const })
      })
    }
  }
})({ id: "other" });

