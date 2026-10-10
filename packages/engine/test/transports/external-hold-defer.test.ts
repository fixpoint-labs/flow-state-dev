/**
 * `hold` and `defer` on work handed to a queue worker (FIX-1836).
 *
 * The host decides the policy and the worker carries it out, so what the host
 * hands the queue is the contract: a `hold` job carries a place that has its
 * turn already, and a `defer` job carries no place, only the key it claims
 * once that key is free. The cap on waiting `defer` requests and the
 * ownership check before any place is taken apply here exactly as they do to
 * a run in this process.
 *
 * The dispatcher below enqueues and records; a test ends a job by hand, the
 * way its worker would report it done. The backend is adapter-shaped (only its
 * four public calls), so the arbiter takes the path the Redis backend takes.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import {
  ConcurrencyDeferLimitError,
  createFlowRegistry,
  createInMemoryLeaseBackend,
  createInMemoryStores,
  createInboundTransportHost,
  defaultBodyUserIdPrincipalResolver,
  type ConcurrencyLeaseBackend,
  type DispatchEnvelope,
  type FlowDispatcher
} from "../../src";
import type { ExecutionResult } from "../../src/execution/types";
import { createConcurrencyArbiter } from "../../src/transports/concurrency/arbiter";

const OWNER = "u_1";
const SESSION = "s_1";

/** A queue that records each job and lets the test end it. */
function recordingQueue() {
  const enqueued: DispatchEnvelope[] = [];
  const ends = new Map<string, () => void>();
  const dispatcher: FlowDispatcher = {
    async dispatch(envelope) {
      enqueued.push(envelope);
      const finished = new Promise<ExecutionResult>((resolve) => {
        ends.set(envelope.requestId, () => resolve({ output: {} } as ExecutionResult));
      });
      return { requestId: envelope.requestId, finished, abort: () => {} };
    },
    async close() {}
  };
  return {
    dispatcher,
    enqueued,
    /** The job for `requestId` ends, as its worker would report. */
    end: (requestId: string) => ends.get(requestId)!()
  };
}

function adapterShaped(inner = createInMemoryLeaseBackend()): ConcurrencyLeaseBackend {
  return {
    take: (input) => inner.take(input),
    isMyTurn: (place) => inner.isMyTurn(place),
    giveBack: (place) => inner.giveBack(place),
    renew: (place) => inner.renew(place)
  };
}

async function buildHost(options: { maxDeferredPerKey?: number } = {}) {
  const registry = createFlowRegistry();
  const stores = createInMemoryStores();
  const backend = adapterShaped();
  const queue = recordingQueue();
  const block = handler<{ value: string }, { ok: true }>({
    name: "never-runs-here",
    execute: async () => ({ ok: true })
  });
  const input = z.object({ value: z.string() });
  registry.register(
    defineFlow({
      kind: "conversation",
      actions: {
        reply: { concurrency: "hold", inputSchema: input, block },
        notify: { concurrency: "defer", inputSchema: input, block },
        strict: { concurrency: "reject", inputSchema: input, block }
      }
    })({ id: "conversation" })
  );
  // The owner's conversation already exists, so a stranger is refused on it.
  const ts = Date.now();
  await stores.session.set(
    SESSION,
    {
      id: SESSION,
      state: {},
      version: 0,
      createdAt: ts,
      updatedAt: ts,
      flowKind: "conversation",
      flowId: "conversation",
      userId: OWNER,
      orgId: DEFAULT_ORG_ID,
      lineageId: "lin_1",
      journal: []
    },
    "any"
  );
  const host = createInboundTransportHost({
    registry,
    stores,
    resolvePrincipal: defaultBodyUserIdPrincipalResolver,
    runtimeConfig: {},
    dispatcher: queue.dispatcher,
    arbiter: createConcurrencyArbiter({
      backend,
      ...(options.maxDeferredPerKey !== undefined ? { maxDeferredPerKey: options.maxDeferredPerKey } : {})
    })
  });
  const dispatch = (action: "reply" | "notify" | "strict", requestId: string, userId = OWNER) =>
    host.dispatch({
      source: "http" as const,
      flowKind: "conversation",
      action,
      input: { value: requestId },
      requestId,
      sessionId: SESSION,
      principal: { userId, orgId: DEFAULT_ORG_ID }
    });
  return { host, stores, backend, queue, dispatch };
}

describe("a hold request handed to a queue worker", () => {
  it("carries a place marked to run at once, and the conversation reads busy until its job ends", async () => {
    const h = await buildHost();
    const reply = h.dispatch("reply", "reply-1");
    await reply.accepted;

    const job = h.queue.enqueued.find((e) => e.requestId === "reply-1")!;
    expect(job.leasePlace).toMatchObject({ key: SESSION });
    expect(job.leaseTurn).toEqual({ kind: "now" });
    // A `reject` request on the conversation is refused while the reply runs.
    const strict = h.dispatch("strict", "strict-1");
    await expect(strict.accepted).rejects.toMatchObject({ inFlightRequestId: "reply-1" });
  });
});

describe("a defer request handed to a queue worker", () => {
  it("carries no place, only the key its worker claims once nothing holds or waits on it", async () => {
    const h = await buildHost();
    const reply = h.dispatch("reply", "reply-1");
    await reply.accepted;
    const notice = h.dispatch("notify", "notice-1");
    await notice.accepted;

    const job = h.queue.enqueued.find((e) => e.requestId === "notice-1")!;
    expect(job.leasePlace ?? undefined).toBeUndefined();
    expect(job.leaseTurn).toEqual({ kind: "when-free", key: SESSION });
  });

  it("is refused past the per-conversation cap with nothing enqueued, and counts until its job ends", async () => {
    const h = await buildHost({ maxDeferredPerKey: 2 });
    await h.dispatch("reply", "reply-1").accepted;
    const n1 = h.dispatch("notify", "notice-1");
    const n2 = h.dispatch("notify", "notice-2");
    await Promise.all([n1.accepted, n2.accepted]);

    const n3 = h.dispatch("notify", "notice-3");
    await expect(n3.accepted).rejects.toBeInstanceOf(ConcurrencyDeferLimitError);
    expect(h.queue.enqueued.map((e) => e.requestId)).not.toContain("notice-3");
    expect(await h.stores.request.get("notice-3")).toBeUndefined();

    // One deferred job ends: there is room for one more.
    h.queue.end("notice-1");
    await n1.finished;
    await h.dispatch("notify", "notice-4").accepted;
    expect(h.queue.enqueued.map((e) => e.requestId)).toContain("notice-4");
  });
});

describe("a caller who does not own the conversation, on the queue path", () => {
  it("cannot use up the owner's defer cap", async () => {
    const h = await buildHost({ maxDeferredPerKey: 2 });
    await h.dispatch("reply", "reply-1").accepted;
    const foreign = [h.dispatch("notify", "x-1", "u_2"), h.dispatch("notify", "x-2", "u_2")];
    const mine = [h.dispatch("notify", "notice-1"), h.dispatch("notify", "notice-2")];
    for (const f of foreign) await expect(f.accepted).rejects.not.toBeInstanceOf(ConcurrencyDeferLimitError);
    await Promise.all(mine.map((m) => m.accepted));
    expect(h.queue.enqueued.map((e) => e.requestId)).toEqual(["reply-1", "notice-1", "notice-2"]);
  });

  it("cannot hold the owner's conversation", async () => {
    const h = await buildHost();
    const foreign = h.dispatch("reply", "x-1", "u_2");
    await expect(foreign.accepted).rejects.toBeDefined();
    // Nothing marks the conversation busy: the owner's `reject` request runs.
    await h.dispatch("strict", "strict-1").accepted;
    expect(h.queue.enqueued.map((e) => e.requestId)).toEqual(["strict-1"]);
  });
});
