// FIX-2534, epic ER-5.
/**
 * Subscribing and ending a subscription: the one
 * `subscribe` and the one `unsubscribe` everything that writes a subscription
 * goes through. The two tools call them; so does a task's ending, and a
 * thread's closing.
 *
 * `subscribe` runs in the session that will hear. It selects by provider, one
 * thread key and optional kinds (epic D6), and refuses a thread its user can't
 * read, checked as that user on the provider's `canRead` (ER-4). The session,
 * the worker, the task and the user come from the turn's own session, never
 * from the input. It writes the row, then the thread index entry that mirrors
 * the row's screen settings for the service.
 *
 * `unsubscribe` turns the row off (`enabled: false`) and takes it out of the
 * index. A task's failure or cancel ends the subscriptions its session made,
 * and a thread's closing ends the ones on it (ER-7 as amended by #4675).
 */
import { handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import { retryOnConflict } from "../projects/cas-retry";
import { TASK_ID_STATE_KEY, WORKER_ID_STATE_KEY } from "../workers/keys";
import { SUBSCRIPTION_TOOLS } from "./keys";
import {
  indexKeyOf,
  listedScreenSchema,
  subscriptionCursorsOf,
  subscriptionIndexOf,
  subscriptionResources,
  subscriptionsOf,
  type IndexEntry,
  type SubscriptionResourceState
} from "./rows";
import { requestHostOf } from "@flow-state-dev/core/internal";

/**
 * A provider a session can subscribe on: its key, who may read a thread, and
 * who the running user is there. Both read the running request's own user,
 * on that user's credentials.
 */
export interface SubscriptionProvider {
  /** The provider key, as events and thread keys carry it (`github`). */
  readonly provider: string;
  /** Whether the running request's user can read `thread`. Asked at subscribe, and again before a private event is delivered. */
  canRead(thread: string, ctx: BlockContext): boolean | Promise<boolean>;
  /** The running user's own id at the provider, so their own actions are dropped (`own`). */
  self?(ctx: BlockContext): string | undefined | Promise<string | undefined>;
}

/** What `subscribe` takes: the tool's input. */
export const subscribeInputSchema = z
  .object({
    provider: z.string().describe("The provider the thread is on, e.g. github."),
    thread: z.string().describe('One thread key the event names, e.g. "github:acme/api#412" for a PR, or "github:acme/api" for the whole repo.'),
    kinds: z.array(z.string().min(1)).optional().describe('The kinds of event to hear, e.g. ["review", "check"]. Leave it out to hear every kind.'),
    screens: z
      .array(listedScreenSchema)
      .optional()
      .describe(
        'Narrow what passes: { screen: "labels", any: [...] }, { screen: "words", any: [...] } (title or text, any case), ' +
          '{ screen: "allow", ids: [...] } (only these senders). Every listed screen must pass.'
      ),
    outsiders: z.literal(true).optional().describe("Also hear people outside the project (not members, collaborators or listed bots). Off by default."),
    interest: z.string().min(1).max(500).describe("In one sentence, what you want to hear about, kept with the subscription.")
  })
  .strict();

export type SubscribeInput = z.infer<typeof subscribeInputSchema>;

/** What a subscribe came to. */
export type SubscribeOutcome = { readonly id: string } | { readonly refused: string };

/** Why a subscription ended. */
export type SubscriptionEnd = "unsubscribed" | "thread_closed" | "task_errored" | "task_cancelled";

/**
 * A stable id for one session's subscription to one thread: subscribing again
 * updates it. A session id is unique only within its tenant, and every tenant's
 * rows share the user's cell, so the tenant is part of the id. A session with
 * no tenant keeps the id it had.
 */
async function subscriptionIdOf(sessionId: string, provider: string, thread: string, tenantId: string | undefined): Promise<string> {
  const tenant = tenantId === undefined ? "" : `\n${tenantId}`;
  const bytes = new TextEncoder().encode(`${sessionId}\n${provider}\n${thread}${tenant}`);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  return `sub_${[...digest.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** The tenant the running session is under, or none. */
const tenantOf = (ctx: BlockContext): string | undefined => {
  const tenantId = (ctx.session.identity as { tenantId?: string }).tenantId;
  return tenantId === undefined || tenantId.length === 0 ? undefined : tenantId;
};

/** Whether `row` was made by the running session: its id, in its tenant. */
const madeHere = (ctx: BlockContext, row: SubscriptionResourceState): boolean => row.sessionId === ctx.session.identity.id && row.tenantId === tenantOf(ctx);

const indexEntryOf = (row: SubscriptionResourceState): IndexEntry => ({
  provider: row.provider,
  thread: row.thread,
  ...(row.kinds === undefined ? {} : { kinds: row.kinds }),
  screens: row.screens,
  ...(row.outsiders === true ? { outsiders: true as const } : {}),
  ...(row.self === undefined ? {} : { self: row.self }),
  userId: row.userId,
  orgId: row.orgId,
  ...(row.tenantId === undefined ? {} : { tenantId: row.tenantId })
});

/**
 * Subscribe the running session to one thread.
 *
 * @param providers The providers a session may subscribe on.
 */
export async function subscribe(ctx: BlockContext, providers: readonly SubscriptionProvider[], input: SubscribeInput): Promise<SubscribeOutcome> {
  const state = (ctx.session.state ?? {}) as Record<string, unknown>;
  const worker = state[WORKER_ID_STATE_KEY];
  if (typeof worker !== "string" || worker.length === 0) return { refused: "not_a_worker: this session runs no worker, so it can't subscribe." };
  const thread = input.thread.trim();
  if (thread.length === 0) return { refused: "no_thread: name one thread key to follow; a sentence alone selects nothing." };
  const provider = providers.find((p) => p.provider === input.provider);
  if (provider === undefined) {
    return { refused: `no_provider: "${input.provider}" isn't one you can subscribe on. You can: ${providers.map((p) => p.provider).join(", ") || "none"}.` };
  }
  if (!thread.startsWith(`${provider.provider}:`)) {
    return { refused: `wrong_provider: a ${provider.provider} thread key starts with "${provider.provider}:".` };
  }
  if (!(await provider.canRead(thread, ctx))) return { refused: `not_readable: you can't read "${thread}", so you can't follow it.` };

  const identity = ctx.session.identity as { id: string; userId?: string; orgId?: string; tenantId?: string };
  if (identity.userId === undefined || identity.orgId === undefined) {
    return { refused: "no_identity: a subscription needs a session that names its user and organization." };
  }
  // The flow a delivery lands on: the session's own record, as the engine reads it for this user.
  const view = await requestHostOf(ctx)?.sessions?.read(identity.id);
  const flowKind = view === undefined ? undefined : (view.flowId ?? view.flowKind);
  const tenantId = tenantOf(ctx);
  const id = await subscriptionIdOf(identity.id, provider.provider, thread, tenantId);
  const self = await provider.self?.(ctx);
  const taskId = state[TASK_ID_STATE_KEY];
  const row: SubscriptionResourceState = {
    id,
    provider: provider.provider,
    thread,
    ...(input.kinds === undefined ? {} : { kinds: input.kinds }),
    screens: input.screens ?? [],
    ...(input.outsiders === true ? { outsiders: true as const } : {}),
    ...(self === undefined ? {} : { self }),
    interest: input.interest,
    sessionId: identity.id,
    flow: flowKind ?? "",
    worker,
    ...(typeof taskId === "string" && taskId.length > 0 ? { taskId } : {}),
    userId: identity.userId,
    orgId: identity.orgId,
    // The tenant its session runs under, so its deliveries reach that session.
    ...(tenantId === undefined ? {} : { tenantId }),
    enabled: true,
    at: Date.now()
  };
  if (row.flow.length === 0) return { refused: "no_session: this host can't read this session's record, so nothing could be delivered to it." };
  const ref = await subscriptionsOf(ctx).getOrCreate(id, row);
  await ref.setState(row);
  await subscriptionCursorsOf(ctx).getOrCreate(id, { seen: [], window: { start: 0, sent: 0 }, held: 0 });
  // Other users' subscribes to this thread may write at once: `updateState`
  // runs again against the row that won, so every entry lands.
  const index = await subscriptionIndexOf(ctx).getOrCreate(indexKeyOf(thread), { subscriptions: {} });
  await retryOnConflict(() => index.updateState((current) => ({ subscriptions: { ...current.subscriptions, [id]: indexEntryOf(row) } })));
  return { id };
}

/**
 * End one of the running user's subscriptions: off on its row, out of the
 * index. Ending one that already ended changes nothing.
 *
 * @returns Whether it was live.
 */
export async function unsubscribe(ctx: BlockContext, id: string, reason: SubscriptionEnd): Promise<boolean> {
  const ref = await subscriptionsOf(ctx).getOptional(id);
  if (ref === undefined) return false;
  const row = ref.state;
  if (row.enabled) await ref.setState({ ...row, enabled: false, endedReason: reason, endedAt: Date.now() });
  // Out of the index even when the row was already off: a stop between the two writes leaves it there.
  const index = await subscriptionIndexOf(ctx).getOptional(indexKeyOf(row.thread));
  if (index?.state.subscriptions[id] !== undefined) {
    await retryOnConflict(() =>
      index.updateState((current) => {
        const { [id]: _gone, ...rest } = current.subscriptions;
        return { subscriptions: rest };
      })
    );
  }
  return row.enabled;
}

/**
 * End the live subscriptions a task's session made, when the task failed or
 * was cancelled (ER-7 as amended). A completed task's stay: its session keeps
 * hearing its thread until the thread closes.
 */
export async function endTaskSubscriptions(ctx: BlockContext, taskId: string, ending: "errored" | "cancelled"): Promise<number> {
  const reason: SubscriptionEnd = ending === "errored" ? "task_errored" : "task_cancelled";
  let ended = 0;
  // Every subscription in the cell: the collection filters by key prefix only,
  // and a subscription's key names its session and thread, not its task.
  for (const ref of await subscriptionsOf(ctx).list()) {
    if (ref.state.taskId === taskId && ref.state.enabled && (await unsubscribe(ctx, ref.state.id, reason))) ended += 1;
  }
  return ended;
}

const subscribeOutputSchema = z.union([z.object({ id: z.string() }), z.object({ refused: z.string() })]);
const unsubscribeOutputSchema = z.union([z.object({ ended: z.string() }), z.object({ refused: z.string() })]);

/**
 * The two subscription tools, for a worker's turn (or an action that calls
 * them as a model would). `unsubscribe` ends only a subscription this session
 * made.
 */
export function subscriptionTools(options: { readonly providers: readonly SubscriptionProvider[] }) {
  const subscribeTool = handler({
    name: SUBSCRIPTION_TOOLS.subscribe,
    description:
      "Follow one thread (a PR, an issue, a repo) so its events reach this conversation as messages from the service, " +
      "each once. Name the thread key; list kinds and screens to hear less. Refused for a thread you can't read.",
    inputSchema: subscribeInputSchema,
    outputSchema: subscribeOutputSchema,
    resources: subscriptionResources,
    execute: async (input, ctx) => subscribe(ctx, options.providers, input)
  });
  const unsubscribeTool = handler({
    name: SUBSCRIPTION_TOOLS.unsubscribe,
    description: "Stop following a thread this conversation subscribed to, by the id subscribe gave you.",
    inputSchema: z.object({ id: z.string().min(1) }).strict(),
    outputSchema: unsubscribeOutputSchema,
    resources: subscriptionResources,
    execute: async (input, ctx) => {
      const row = (await subscriptionsOf(ctx).getOptional(input.id))?.state;
      if (row === undefined || !madeHere(ctx, row)) {
        return { refused: `not_yours: this conversation has no subscription "${input.id}".` };
      }
      await unsubscribe(ctx, input.id, "unsubscribed");
      return { ended: input.id };
    }
  });
  return { subscribe: subscribeTool, unsubscribe: unsubscribeTool };
}
