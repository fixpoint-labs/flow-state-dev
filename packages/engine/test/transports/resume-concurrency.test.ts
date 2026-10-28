/**
 * A resumed request takes its turn in the session (FIX-2062).
 *
 * A suspended request gives its session's place back, so a new request can
 * run while it waits on a person. When the person answers, the resumed run
 * must line up behind that new request rather than start beside it: two runs
 * in one session would write the session's state at the same time.
 *
 * Driven through the real host and every way a parked request is continued
 * (the resume route, a stop of the parked request, the durability sweep's
 * re-drive), over the in-memory backend and over a backend supplied by an
 * adapter, which the arbiter polls instead of waking.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, handler, sequencer } from "@flow-state-dev/core";
import type { ConcurrencyConfig } from "@flow-state-dev/core";
import type { SuspensionRecord } from "@flow-state-dev/core/types";
import { z } from "zod";
import {
  createFlowRegistry,
  createInMemoryStores,
  createInboundTransportHost,
  defaultBodyUserIdPrincipalResolver
} from "../../src";
import { createCheckpointDurabilityProvider } from "../../src/durability/checkpoint-durability-provider";
import { resumeUnderLease } from "../../src/durability/resume-under-lease";
import { redriveResolvedGate, stopSuspendedRequest } from "../../src/durability/stop-suspended";
import { createConcurrencyArbiter } from "../../src/transports/concurrency/arbiter";
import {
  QUEUE_WAIT_TIMEOUT_MS,
  createInMemoryLeaseBackend,
  type ConcurrencyLeaseBackend
} from "../../src/transports/concurrency/lease-backend";
import { ConcurrencyRejectedError } from "../../src/transports/errors";
import { handleResumeSuspension } from "../../src/routes/resume-routes";

type Backend = "in-memory" | "supplied";

/**
 * A backend the arbiter cannot reach synchronously: the four calls of an
 * adapter-supplied backend, over an in-memory line. The arbiter polls it.
 */
function suppliedBackend(): ConcurrencyLeaseBackend {
  const inner = createInMemoryLeaseBackend();
  return {
    take: (input) => inner.take(input),
    isMyTurn: (place) => inner.isMyTurn(place),
    giveBack: (place) => inner.giveBack(place),
    renew: (place) => inner.renew(place)
  };
}

/**
 * One flow, two actions on the same session key: `transfer` parks on a person's
 * approval and then runs a step that blocks; `work` blocks. Every blocking
 * step records itself live until the test releases it.
 */
function buildHost(
  concurrency: ConcurrencyConfig,
  backend: Backend = "in-memory",
  tenantId?: string,
  heartbeatIntervalMs?: number
) {
  const registry = createFlowRegistry();
  const stores = createInMemoryStores();
  const provider = createCheckpointDurabilityProvider(stores);
  const live = new Set<string>();
  const gates = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
  let overlapped = false;

  const block = (name: string) => async (): Promise<{ ok: true }> => {
    if (live.size > 0) overlapped = true;
    live.add(name);
    try {
      await new Promise<void>((resolve, reject) => gates.set(name, { resolve, reject }));
    } finally {
      live.delete(name);
    }
    return { ok: true };
  };

  registry.register(
    defineFlow({
      kind: "chat",
      ...(heartbeatIntervalMs !== undefined ? { request: { heartbeatIntervalMs } } : {}),
      actions: {
        transfer: {
          concurrency,
          inputSchema: z.any(),
          block: sequencer({ name: "transferSeq", durable: true })
            .step(
              handler({
                name: "approve",
                inputSchema: z.any(),
                outputSchema: z.unknown(),
                execute: async (_input, ctx) => ctx.suspend!({ reason: "human_approval", message: "Go?" })
              })
            )
            .step(handler({ name: "afterApproval", inputSchema: z.any(), outputSchema: z.any(), execute: block("resumed") }))
        },
        work: {
          concurrency,
          inputSchema: z.any(),
          block: handler({ name: "work", inputSchema: z.any(), outputSchema: z.any(), execute: block("work") })
        }
      }
    })({ id: "chat" })
  );

  const host = createInboundTransportHost({
    registry,
    stores,
    resolvePrincipal: defaultBodyUserIdPrincipalResolver,
    runtimeConfig: { durabilityProvider: provider },
    arbiter: createConcurrencyArbiter(backend === "supplied" ? { backend: suppliedBackend() } : {})
  });

  const envelope = (action: "transfer" | "work", sessionId = "s_1") => ({
    source: "http" as const,
    flowKind: "chat",
    action,
    input: {},
    sessionId,
    ...(tenantId !== undefined ? { tenantId } : {}),
    principal: { userId: "u_1", orgId: DEFAULT_ORG_ID }
  });

  /** Park a `transfer` on its approval and return its request id and gate. */
  const park = async (sessionId = "s_1"): Promise<{ requestId: string; gate: SuspensionRecord }> => {
    const handle = host.dispatch(envelope("transfer", sessionId));
    await handle.finished;
    expect((await stores.request.get(handle.requestId))?.status).toBe("suspended");
    const [gate] = (await provider.listSuspended({ status: "pending" })).filter(
      (s) => s.requestId === handle.requestId
    );
    return { requestId: handle.requestId, gate: gate! };
  };

  /** Start a `work` run and wait until it is executing. */
  const startWork = async (sessionId = "s_1") => {
    const handle = host.dispatch(envelope("work", sessionId));
    await until(() => live.has("work"));
    return handle;
  };

  const release = (name: string): void => {
    const open = gates.get(name);
    gates.delete(name);
    open?.resolve();
  };

  const fail = (name: string): void => {
    const open = gates.get(name);
    gates.delete(name);
    open?.reject(new Error(`${name} failed`));
  };

  return {
    host,
    stores,
    provider,
    tenantId,
    live,
    park,
    startWork,
    envelope,
    release,
    fail,
    deps: { provider, stores, continueRequest: host.continueRequest },
    get overlapped() {
      return overlapped;
    }
  };
}

type Harness = ReturnType<typeof buildHost>;

async function until(check: () => boolean | Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** Long enough for a resumed run that was let through to reach its block. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 150));

const statusOf = async (h: Harness, requestId: string) => (await h.stores.request.get(requestId))?.status;

/** Approve through the public resume route, as a person's client does. */
async function approveViaRoute(h: Harness, requestId: string, gate: SuspensionRecord): Promise<Response> {
  return handleResumeSuspension(
    new Request(`https://x/api/flows/chat/requests/${requestId}/resume`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ suspensionId: gate.suspensionId, action: "approve" })
    }),
    { kind: "resume_suspension", flowKind: "chat", requestId },
    {
      host: h.host,
      registry: h.host.registry,
      stores: h.stores,
      durabilityProvider: h.provider,
      ...(h.tenantId !== undefined ? { tenantId: h.tenantId } : {}),
      seams: {} as never,
      requestContext: {} as never
    }
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe.each<Backend>(["in-memory", "supplied"])("a resumed request takes its turn (%s backend)", (backend) => {
  it.each<ConcurrencyConfig>(["queue", "reject", "defer"])(
    "under %s, a resume waits for the request running in its session, then runs",
    async (policy) => {
      const h = buildHost(policy, backend);
      const { requestId, gate } = await h.park();
      const work = await h.startWork();

      const response = await approveViaRoute(h, requestId, gate);
      expect(response.status).toBe(202);

      // The answer is recorded at once, but the turn does not move on while
      // `work` holds the session.
      await settle();
      expect(h.live.has("resumed")).toBe(false);
      expect((await h.provider.loadSuspension(requestId, gate.suspensionId))?.status).toBe("approved");
      expect(await statusOf(h, requestId)).toBe("suspended");

      h.release("work");
      await work.finished;
      await until(() => h.live.has("resumed"));
      h.release("resumed");
      await until(async () => (await statusOf(h, requestId)) === "completed");
      expect(h.overlapped).toBe(false);
    }
  );

  it("a new request arriving while a resume waits its turn lines up behind it, never beside it", async () => {
    const h = buildHost("queue", backend);
    const { requestId, gate } = await h.park();
    const first = await h.startWork();
    expect((await approveViaRoute(h, requestId, gate)).status).toBe(202);
    await settle();

    // Queued behind the resume: the resume took its place first.
    const second = h.host.dispatch(h.envelope("work"));
    h.release("work");
    await first.finished;
    await until(() => h.live.has("resumed"));
    await settle();
    expect(h.live.has("work")).toBe(false);
    h.release("resumed");
    await until(() => h.live.has("work"));
    h.release("work");
    await second.finished;
    expect(h.overlapped).toBe(false);
  });

  it("under reject, a new request is refused while a resumed run holds the session", async () => {
    const h = buildHost("reject", backend);
    const { requestId, gate } = await h.park();
    expect((await approveViaRoute(h, requestId, gate)).status).toBe(202);
    await until(() => h.live.has("resumed"));

    const refused = h.host.dispatch(h.envelope("work"));
    await expect(refused.finished).rejects.toBeInstanceOf(ConcurrencyRejectedError);

    h.release("resumed");
    await until(async () => (await statusOf(h, requestId)) === "completed");
    expect(h.overlapped).toBe(false);
  });

  it("a resumed run that fails gives the session back to the request waiting behind it", async () => {
    const h = buildHost("queue", backend);
    const { requestId, gate } = await h.park();
    expect((await approveViaRoute(h, requestId, gate)).status).toBe(202);
    await until(() => h.live.has("resumed"));

    const next = h.host.dispatch(h.envelope("work"));
    await settle();
    expect(h.live.has("work")).toBe(false);

    h.fail("resumed");
    await until(async () => (await statusOf(h, requestId)) === "failed");
    await until(() => h.live.has("work"));
    h.release("work");
    await next.finished;
    expect(h.overlapped).toBe(false);
  });

  it("a stop of a parked request waits for the running request before it ends the turn", async () => {
    const h = buildHost("queue", backend);
    const { requestId } = await h.park();
    const work = await h.startWork();

    const record = (await h.stores.request.get(requestId))!;
    expect(await stopSuspendedRequest(h.deps, record)).toBe("stopped");

    await settle();
    expect(await statusOf(h, requestId)).toBe("suspended");

    h.release("work");
    await work.finished;
    await until(async () => (await statusOf(h, requestId)) === "aborted");
    expect(h.overlapped).toBe(false);
  });

  it("the sweep's re-drive of an answered gate waits for the running request", async () => {
    const h = buildHost("queue", backend);
    const { requestId, gate } = await h.park();
    // Answered, and the process died before the turn moved on.
    await h.provider.suspend({ ...gate, status: "approved", resolvedAt: Date.now(), resolvedBy: "u_1" });
    const work = await h.startWork();

    expect(await redriveResolvedGate(h.deps, (await h.provider.loadSuspension(requestId, gate.suspensionId))!)).toBe(
      "redriven"
    );
    await settle();
    expect(h.live.has("resumed")).toBe(false);

    h.release("work");
    await work.finished;
    await until(() => h.live.has("resumed"));
    h.release("resumed");
    await until(async () => (await statusOf(h, requestId)) === "completed");
    expect(h.overlapped).toBe(false);
  });
});

describe("a resumed request under other policies", () => {
  it("under allow, a resume runs at once, as before", async () => {
    const h = buildHost("allow");
    const { requestId, gate } = await h.park();
    await h.startWork();
    expect((await approveViaRoute(h, requestId, gate)).status).toBe(202);
    await until(() => h.live.has("resumed"));
    expect(h.live.has("work")).toBe(true);
    h.release("work");
    h.release("resumed");
    await until(async () => (await statusOf(h, requestId)) === "completed");
  });

  it("under hold, a resume runs at once and marks the session held, as a new hold run does", async () => {
    const h = buildHost("hold");
    const { requestId, gate } = await h.park();
    await h.startWork();
    expect((await approveViaRoute(h, requestId, gate)).status).toBe(202);
    await until(() => h.live.has("resumed"));
    expect(h.live.has("work")).toBe(true);
    h.release("work");
    h.release("resumed");
    await until(async () => (await statusOf(h, requestId)) === "completed");
  });

  it("a resume in another session, or another tenant's same session id, does not wait", async () => {
    const h = buildHost("queue", "in-memory", "tenant_a");
    const { requestId, gate } = await h.park("s_2");
    await h.startWork("s_1");
    expect((await approveViaRoute(h, requestId, gate)).status).toBe(202);
    await until(() => h.live.has("resumed"));
    h.release("resumed");
    await until(async () => (await statusOf(h, requestId)) === "completed");
    h.release("work");

    // Two tenants, one session id: separate keys.
    const a = buildHost("queue", "in-memory", "tenant_a");
    const parked = await a.park("s_1");
    // Same arbiter, a run on tenant_b's "s_1".
    const other = a.host.dispatch({ ...a.envelope("work", "s_1"), tenantId: "tenant_b" });
    await until(() => a.live.has("work"));
    const route = await approveViaRoute(a, parked.requestId, parked.gate);
    expect(route.status).toBe(202);
    await until(() => a.live.has("resumed"));
    a.release("resumed");
    a.release("work");
    await other.finished;
  });

  it("a resume waiting its turn keeps its active-request entry warm, so the stale sweep does not reap it", async () => {
    const h = buildHost("queue", "in-memory", undefined, 20);
    const { requestId, gate } = await h.park();
    const work = await h.startWork();
    expect((await approveViaRoute(h, requestId, gate)).status).toBe(202);

    // Registered before the wait, then beaten while it lasts.
    await until(async () => (await h.stores.activeRequests.get(requestId)) !== undefined);
    const registeredAt = (await h.stores.activeRequests.get(requestId))!.lastHeartbeatAt;
    await until(
      async () => ((await h.stores.activeRequests.get(requestId))?.lastHeartbeatAt ?? 0) > registeredAt
    );
    expect(h.live.has("resumed")).toBe(false);

    h.release("work");
    await work.finished;
    await until(() => h.live.has("resumed"));
    h.release("resumed");
    await until(async () => (await statusOf(h, requestId)) === "completed");
  });

  it("a resume that cannot take its turn in time keeps the answer, frees the request, and is re-driven later", async () => {
    const h = buildHost("queue");
    const { requestId, gate } = await h.park();
    const work = await h.startWork();

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const resumed = await resumeUnderLease(
      { provider: h.provider, continueRequest: h.host.continueRequest },
      { requestId, holder: "resume", admit: async () => ({ suspension: gate }), action: "approve" }
    );
    expect(resumed.ok).toBe(true);
    const finished = (resumed as { handle: { finished: Promise<unknown> } }).handle.finished;
    const outcome = finished.then(
      () => "ran",
      (e: unknown) => e
    );
    await vi.advanceTimersByTimeAsync(QUEUE_WAIT_TIMEOUT_MS + 1_000);
    vi.useRealTimers();

    expect(await outcome).toMatchObject({ name: "ConcurrencyQueueTimeoutError" });
    expect(h.live.has("resumed")).toBe(false);
    expect((await h.provider.loadSuspension(requestId, gate.suspensionId))?.status).toBe("approved");
    expect(await statusOf(h, requestId)).toBe("suspended");
    expect(await h.stores.leases.get(requestId)).toBeNull();

    h.release("work");
    await work.finished;
    const current = (await h.provider.loadSuspension(requestId, gate.suspensionId))!;
    expect(await redriveResolvedGate(h.deps, current)).toBe("redriven");
    await until(() => h.live.has("resumed"));
    h.release("resumed");
    await until(async () => (await statusOf(h, requestId)) === "completed");
    expect(h.overlapped).toBe(false);
  });

  it("a resume that times out releases only its own lease, never one another process took after it lapsed", async () => {
    const h = buildHost("queue");
    const { requestId, gate } = await h.park();
    await h.startWork();

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const resumed = await resumeUnderLease(
      { provider: h.provider, continueRequest: h.host.continueRequest },
      { requestId, holder: "resume", admit: async () => ({ suspension: gate }), action: "approve" }
    );
    expect(resumed.ok).toBe(true);
    const outcome = (resumed as { handle: { finished: Promise<unknown> } }).handle.finished.catch(
      (e: unknown) => e
    );

    // The resume's lease lapses while it waits, and another process takes a
    // new one on the same request.
    const own = (await h.stores.leases.get(requestId))!;
    await h.stores.leases.release(requestId, own.leaseId);
    const newer = (await h.stores.leases.acquire(requestId, { holder: "other-process", durationMs: 60_000 }))!;

    await vi.advanceTimersByTimeAsync(QUEUE_WAIT_TIMEOUT_MS + 1_000);
    vi.useRealTimers();

    expect(await outcome).toMatchObject({ name: "ConcurrencyQueueTimeoutError" });
    expect((await h.stores.leases.get(requestId))?.leaseId).toBe(newer.leaseId);
  });
});
