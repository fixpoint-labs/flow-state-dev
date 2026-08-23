/**
 * POC CODE ON A NEVER-MERGED BRANCH (`spec/FIX-1230`, epic FIX-1197).
 * Throwaway. Not to be reviewed as code, never merged, dies with the PR.
 * See `spec-poc/README.md` and `spec/FIX-1230.md` §7.
 *
 * Continues `spec-poc/epic-relay/` on the epic branch. That one settled the
 * SEND half (Q1-Q4). This one runs the REPLY half — the part the epic-spec
 * says has been specified wrong twice and told us not to write a third prose
 * variant of.
 *
 * Two seams are hand-wired here because the spec proposes them and neither
 * exists yet. They are the whole experiment:
 *
 *   1. `liveReplyTargets` — a per-process Map<requestId, ResponseEmitterHandle>.
 *      Deliberately the same shape as the shipped `execution/abort-registry.ts`,
 *      which is how a cancellation already reaches a live request from outside
 *      it. If reply delivery cannot be that, the spec is wrong.
 *   2. `waitForCorrelated` — the wait, built at TOOL-CALL RUNTIME rather than at
 *      sequencer-definition time, out of `ctx.response.subscribeToItems` +
 *      a timer. Nothing new: this is `waitForCondition`'s own engine
 *      (`core/src/blocks/sequencer.ts:2295-2385`) with a call-time predicate.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import type { BlockContext, ResponseEmitterHandle } from "@flow-state-dev/core";
import { buildReplyItem } from "./reply-item";
import { z } from "zod";
import {
  createFlowRegistry,
  createInMemoryStores,
  createInboundTransportHost,
  defaultBodyUserIdPrincipalResolver
} from "../../packages/engine/src";
import type { InboundTransportHost } from "../../packages/engine/src/transports/types";
import type { ConcurrencyArbiter } from "../../packages/engine/src/transports/concurrency/arbiter";
import type { StoreRegistry } from "../../packages/engine/src/stores/types";

export const FLOW_KIND = "relay-core-poc";

/** Same module-level hack as the epic POC: nothing on `ctx` reaches the host. */
let HOST: InboundTransportHost | undefined;
export function theHost(): InboundTransportHost {
  if (HOST === undefined) throw new Error("host not wired");
  return HOST;
}

// ---------------------------------------------------------------------------
// Seam 1 — the delivery target (proposed; mirrors execution/abort-registry.ts)
// ---------------------------------------------------------------------------

/**
 * Live requests in THIS process that can still receive an item from outside.
 * The shipped abort registry is `Map<string, AbortController>`; this is the
 * same map holding the thing a reply needs instead of the thing a cancel needs.
 */
const liveReplyTargets = new Map<string, { response: ResponseEmitterHandle; requestId: string }>();

export function registerReplyTarget(requestId: string, response: ResponseEmitterHandle): void {
  liveReplyTargets.set(requestId, { response, requestId });
}
export function deregisterReplyTarget(requestId: string): void {
  liveReplyTargets.delete(requestId);
}

/**
 * Correlation id -> the request waiting on it. Minted per SEND, which is the
 * epic's constraint: `requestId` identifies the asker, not the ask, and one
 * request can have two sends outstanding at once (which is exactly what q5
 * runs).
 */
const waiters = new Map<string, string>();

/**
 * Deliver a reply onto the waiting request's own live stream. Returns why not.
 *
 * FIRST ATTEMPT, AND THE FIRST FINDING: this originally emitted
 * `{ type: "message", id, payload }` — the obvious shape. It "succeeded" and
 * woke nobody. `ResponseEmitter.emit` accepts anything with a string `type`
 * (`isRequestStreamDraft`, `response-emitter.ts:112-121`), and only routes
 * `item.added` / `item.done` / `item.updated` through item tracking
 * (`:343-364`). Anything else is appended as a raw stream event: it is never an
 * ITEM, so it is not in `getItems()` and `subscribeToItems` never fires for it.
 * A reply delivered that way is dropped in silence.
 *
 * So the delivery target has to be an ITEM, emitted as an item event. Kept as a
 * comment rather than tidied away because the silent-drop is the part a spec
 * would otherwise get wrong twice.
 */
export function deliverReply(
  correlationId: string,
  payload: unknown
): { delivered: boolean; reason?: string } {
  const requestId = waiters.get(correlationId);
  if (requestId === undefined) return { delivered: false, reason: "no-waiter" };
  const target = liveReplyTargets.get(requestId);
  if (target === undefined) return { delivered: false, reason: "waiter-not-live-in-this-process" };
  const { response, requestId: waitingRequestId } = target;
  // The carrier is built by `reply-item.ts`, which is TYPE-CHECKED. Four hand-shaped
  // versions of this object were invalid and all four passed at runtime, because
  // `response.emit` takes `unknown` and the emitter's guard is shallower than the type.
  // Read that file's header for the sequence; run `tsc -p spec-poc/FIX-1230-relay-core`.
  const item = buildReplyItem({
    correlationId,
    waitingRequestId,
    itemIndex: response.getItemCount(),
    payload
  });
  void response.emit({ type: "item.added", item });
  void response.emit({ type: "item.done", item });
  return { delivered: true };
}

// ---------------------------------------------------------------------------
// Seam 2 — the runtime correlation-aware wait
// ---------------------------------------------------------------------------

/**
 * Wait for an item on THIS request's own response stream that matches a
 * predicate built now, at call time. `waitForCondition` cannot do this: its
 * predicate is fixed when the sequencer is DEFINED, and the correlation id
 * does not exist until the send runs.
 */
type WaitOutcome = { timedOut: boolean; sawItemId?: string; replyPayload?: unknown };

/**
 * Pull the reply payload back out of the delivered item.
 *
 * THE POINT, and it is a correction: this used to return only `sawItemId`, so
 * the experiment proved an item with the right id arrived and proved NOTHING
 * about the sender receiving the recipient's answer — which is the entire
 * ask-and-continue flow. Asserting the mechanism instead of the promise.
 */
function readReply(item: unknown): unknown {
  // Read the real field, not an invented one — see `deliverReply`.
  const text = (item as { content?: Array<{ text?: string }> })?.content?.[0]?.text;
  if (typeof text !== "string") return undefined;
  try {
    return (JSON.parse(text) as { payload?: unknown }).payload;
  } catch {
    return undefined;
  }
}

async function waitForCorrelated(
  response: ResponseEmitterHandle,
  match: (item: { id?: string }) => boolean,
  timeoutMs: number
): Promise<WaitOutcome> {
  const already = response.getItems().find((i) => match(i as { id?: string }));
  if (already !== undefined) {
    return {
      timedOut: false,
      sawItemId: (already as { id?: string }).id,
      replyPayload: readReply(already)
    };
  }

  return await new Promise((resolve) => {
    let settled = false;
    let unsubscribe: (() => void) | undefined;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      unsubscribe?.();
      resolve({ timedOut: true });
    }, timeoutMs);

    unsubscribe = response.subscribeToItems((item) => {
      if (settled) return;
      if (!match(item as { id?: string })) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe?.();
      resolve({
        timedOut: false,
        sawItemId: (item as { id?: string }).id,
        replyPayload: readReply(item)
      });
    });
  });
}

// ---------------------------------------------------------------------------
// The flow
// ---------------------------------------------------------------------------

export type SendResult = {
  correlationId: string;
  timedOut: boolean;
  sawItemId?: string;
  /** The recipient's answer. What the sender actually came for. */
  replyPayload?: unknown;
  elapsedMs: number;
  dispatchRefused?: string;
};

/** One blocking send: dispatch, register the waiter, wait on our own stream. */
async function blockingSend(
  ctx: BlockContext,
  args: { to: string; text: string; correlationId: string; timeoutMs: number }
): Promise<SendResult> {
  const started = Date.now();
  const myRequestId = ctx.request.identity.id;
  registerReplyTarget(myRequestId, ctx.response);
  waiters.set(args.correlationId, myRequestId);
  try {
    theHost().dispatch({
      source: "http", // no relay source exists yet; provenance only here
      flowKind: FLOW_KIND,
      action: "receiveAndReply",
      input: { text: args.text, correlationId: args.correlationId },
      sessionId: args.to,
      // Server-derived in the real design; read off ctx here to keep the
      // experiment about delivery rather than about identity (epic Q1 owns that).
      principal: { userId: ctx.session.identity.userId },
      responseEmitter: null
    });
  } catch (error) {
    // Deregister on the throw path too. The spec's rule is that every terminal
    // path releases the waiter, and an artifact people copy from should show
    // that rather than describe it.
    waiters.delete(args.correlationId);
    return {
      correlationId: args.correlationId,
      timedOut: true,
      elapsedMs: Date.now() - started,
      dispatchRefused: error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    };
  }

  const outcome = await waitForCorrelated(
    ctx.response,
    (item) => item.id === `relay_reply_${args.correlationId}`,
    args.timeoutMs
  );
  waiters.delete(args.correlationId);
  return { correlationId: args.correlationId, ...outcome, elapsedMs: Date.now() - started };
}

/** What the recipient saw, read back after the run. */
export const received: Array<Record<string, unknown>> = [];
/** What each reply delivery reported. */
export const deliveries: Array<Record<string, unknown>> = [];

export function buildFlow(concurrency?: { policy: "queue" | "allow"; key?: "session" | "user" }) {
  return defineFlow({
    kind: FLOW_KIND,
    ...(concurrency !== undefined ? { request: { concurrency } } : {}),
    actions: {
      seed: {
        inputSchema: z.object({ note: z.string() }),
        block: handler<{ note: string }, { seeded: true }>({
          name: "seed",
          execute: (input, ctx) => {
            ctx.emit.message(`seed: ${input.note}`);
            return { seeded: true } as const;
          }
        })
      },

      /** The recipient. Runs as its own request, then replies out of band. */
      receiveAndReply: {
        inputSchema: z.object({ text: z.string(), correlationId: z.string() }),
        block: handler<{ text: string; correlationId: string }, { handled: true }>({
          name: "receiveAndReply",
          execute: async (input, ctx) => {
            received.push({
              sessionId: ctx.session.identity.id,
              requestId: ctx.request.identity.id,
              ...input
            });
            // A real recipient does work first. Keep it long enough that the
            // sender is genuinely parked rather than racing a synchronous reply.
            await new Promise((r) => setTimeout(r, 150));
            // Distinct per message, so "did A get A's answer" is answerable.
            const outcome = deliverReply(input.correlationId, {
              answerTo: input.correlationId,
              echo: input.text
            });
            deliveries.push({ correlationId: input.correlationId, ...outcome });
            return { handled: true } as const;
          }
        })
      },

      /** TWO blocking sends outstanding at once from ONE request. */
      sendTwo: {
        inputSchema: z.object({
          toA: z.string(),
          toB: z.string(),
          timeoutMs: z.number()
        }),
        block: handler<
          { toA: string; toB: string; timeoutMs: number },
          { a: SendResult; b: SendResult; myRequestId: string }
        >({
          name: "sendTwo",
          execute: async (input, ctx) => {
            const [a, b] = await Promise.all([
              blockingSend(ctx, {
                to: input.toA,
                text: "question A",
                correlationId: "corr_A",
                timeoutMs: input.timeoutMs
              }),
              blockingSend(ctx, {
                to: input.toB,
                text: "question B",
                correlationId: "corr_B",
                timeoutMs: input.timeoutMs
              })
            ]);
            deregisterReplyTarget(ctx.request.identity.id);
            return { a, b, myRequestId: ctx.request.identity.id };
          }
        })
      },

      /** ONE blocking send — used by q6 to measure the arbiter key collision. */
      sendOne: {
        inputSchema: z.object({ to: z.string(), timeoutMs: z.number() }),
        block: handler<{ to: string; timeoutMs: number }, SendResult & { myRequestId: string }>({
          name: "sendOne",
          execute: async (input, ctx) => {
            const result = await blockingSend(ctx, {
              to: input.to,
              text: "question",
              correlationId: `corr_${ctx.request.identity.id}`,
              timeoutMs: input.timeoutMs
            });
            deregisterReplyTarget(ctx.request.identity.id);
            return { ...result, myRequestId: ctx.request.identity.id };
          }
        })
      }
    }
  })({ id: FLOW_KIND });
}

export const hostLogs: Array<{ level: string; message: string; context?: unknown }> = [];

export function boot(
  concurrency?: { policy: "queue" | "allow"; key?: "session" | "user" },
  arbiter?: ConcurrencyArbiter
): { host: InboundTransportHost; stores: StoreRegistry } {
  const registry = createFlowRegistry();
  registry.register(buildFlow(concurrency));
  const stores = createInMemoryStores();
  const host = createInboundTransportHost({
    registry,
    stores,
    ...(arbiter !== undefined ? { arbiter } : {}),
    resolvePrincipal: defaultBodyUserIdPrincipalResolver,
    runtimeConfig: {
      logger: {
        warn: (m, c) => hostLogs.push({ level: "warn", message: String(m), context: c }),
        error: (m, c) => hostLogs.push({ level: "error", message: String(m), context: c })
      }
    }
  });
  HOST = host;
  return { host, stores };
}

/** Dispatch from OUTSIDE — what an HTTP caller does — and await the run. */
export async function fromOutside(
  host: InboundTransportHost,
  action: string,
  input: unknown,
  sessionId: string,
  userId: string
) {
  const handle = host.dispatch({
    source: "http",
    flowKind: FLOW_KIND,
    action,
    input,
    sessionId,
    principal: { userId },
    responseEmitter: null
  });
  return { requestId: handle.requestId, result: await handle.finished };
}

export function show(label: string, value: unknown): void {
  console.log(`\n--- ${label} ---`);
  console.log(JSON.stringify(value, null, 2));
}
