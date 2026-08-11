/**
 * Every topology a `FlowState` owns can start detached work (FIX-1077).
 *
 * `createFlowRouteHandlers` was the only thing that ever assigned
 * `runtimeConfig.requestHost.startOperation`, and it assigned it to the fresh
 * `requestHost` literal `createFlowApiRouter` had already forked — an object
 * nobody else held. So the operation reached HTTP requests and nothing else:
 * `fsdev run` and `fsdev chat` (which `AGENTS.md` names as the DEFAULT way to
 * verify a flow change) had none, and neither did the runtime handed to a
 * colocated queue worker.
 *
 * `createFlowState` now installs it on the SHARED config at construction, before
 * any fork exists, so every later copy inherits it. These tests exercise the
 * topologies that inheritance is supposed to reach — and they drive each one the
 * way its real host does, because that is the only thing that distinguishes
 * "the wiring is present" from "the topology works":
 *
 *  - `runAction` against `runtime.stores` with the config SPREAD, as `fsdev run`
 *    does — the spread is part of the subject, since the seam only reaches a
 *    request because a spread copies the `requestHost` *reference*;
 *  - a real HTTP POST through the router, for the parent to hold a concurrency
 *    key (`runAction` is unarbitrated, so a child dispatched from it never
 *    queues);
 *  - a colocated queue worker, with its dispatcher closing the loop the way a
 *    real adapter does.
 *
 * `worker-only` starts detached work too, rather than refusing it — see the
 * reasoning on that test. The child runs on the worker instead of the queue, so
 * it is not durable; it IS tracked for the shutdown drain, because it is
 * in-process work. Those two properties are independent.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler, requireRequestHost } from "@flow-state-dev/core";
import type { ModelResolver, StartDetachedResult } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "../../src";
import type { FlowStateRuntime, WorkerAdapter } from "../../src/flowstate/types";
import type { StoreAdapter } from "../../src/stores/store-adapter";

const USER_ID = "u_detached";

/** What the launching block saw, and what the child actually ran. */
type Observed = {
  start?: StartDetachedResult;
  error?: string;
  /** One entry per child request that executed the workstream core. */
  children: { sessionId: string; input: unknown; model?: string }[];
};

/** A resolver that reports its own identity, so the child's is observable. */
function markerResolver(marker: string): ModelResolver {
  const resolver = ((): unknown => ({ modelId: marker })) as unknown as ModelResolver;
  (resolver as unknown as { resolveId: (id: string) => string }).resolveId = (id) => id;
  return resolver;
}

/**
 * A flow whose action detaches, plus the workstream core the child enters.
 *
 * `workstream` is not an app-author surface — the framework assembles it from a
 * board's detached worker declarations — so it is attached directly here. That
 * is the precondition for a detached dispatch, not the thing under test:
 * without it `startDetached` refuses `no-workstream-core` long before it reaches
 * the start operation.
 */
function detachingFlow(
  kind: string,
  observed: Observed,
  options: {
    coreDelayMs?: number;
    /** The parent keeps running after detaching, so it keeps holding its key. */
    launcherDelayMs?: number;
    /** The child never finishes — a run blocked on something external. */
    coreNeverSettles?: boolean;
    concurrency?: { policy: "queue" | "reject" | "allow"; key: "user" | "session" };
  } = {}
) {
  const launcher = handler({
    name: "launch",
    inputSchema: z.object({}),
    outputSchema: z.object({}),
    execute: async (_input, ctx) => {
      try {
        observed.start = await requireRequestHost(ctx).startDetached({
          seed: { topic: "background" },
          input: { note: "detached-payload" }
        });
        // Keep running, and therefore keep holding this request's concurrency
        // key, so a child queued behind it is still queued at shutdown.
        if (options.launcherDelayMs !== undefined) {
          await new Promise((resolve) => setTimeout(resolve, options.launcherDelayMs));
        }
      } catch (err) {
        observed.error = err instanceof Error ? err.message : String(err);
      }
      return {};
    }
  });

  const core = handler({
    name: "core",
    inputSchema: z.object({}).passthrough(),
    outputSchema: z.object({}),
    execute: async (input, ctx) => {
      if (options.coreNeverSettles === true) {
        await new Promise(() => {});
      }
      // Deliberately slow when asked: a child that finishes inside the parent's
      // own turn cannot show whether anything waited for it.
      if (options.coreDelayMs !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, options.coreDelayMs));
      }
      const resolved = (await ctx.resolveModel("probe")) as { modelId?: string };
      observed.children.push({
        sessionId: ctx.session.identity.id,
        input,
        model: resolved?.modelId
      });
      return {};
    }
  });

  const flow = defineFlow({
    kind,
    actions: { launch: { inputSchema: z.object({}), block: launcher } },
    ...(options.concurrency !== undefined
      ? { request: { concurrency: options.concurrency } }
      : {})
  })({ id: kind });

  (flow as { workstream?: unknown }).workstream = { block: core };
  return flow;
}

/** Poll until `predicate` holds — the child runs fire-and-forget, unawaited. */
async function until(
  predicate: () => boolean | Promise<boolean>,
  label: string
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

/** A worker adapter in a given mode; nothing about the queue itself matters. */
function stubWorker(mode: WorkerAdapter["mode"]): WorkerAdapter {
  return {
    mode,
    createDispatcher: () => ({ dispatch: async () => ({ requestId: "req_queued" }) }),
    startWorker: () => ({ close: async () => undefined })
  } as WorkerAdapter;
}

/**
 * A worker adapter whose queue nobody is draining.
 *
 * `finished` never settles, which is not a broken dispatcher — it is what BullMQ
 * reports (`subscriber.completed`) for a job sitting in a queue with no worker
 * consuming it. A normal operational state, and one shutdown must survive.
 */
function stubWorkerWithNoConsumer(mode: WorkerAdapter["mode"]): WorkerAdapter {
  return {
    mode,
    createDispatcher: () => ({
      dispatch: async () => ({
        requestId: "req_never_consumed",
        finished: new Promise<never>(() => {})
      })
    }),
    startWorker: () => ({ close: async () => undefined })
  } as WorkerAdapter;
}

/**
 * A store adapter that really closes, like a pooled one.
 *
 * `inMemoryStores` has no `dispose`, so every write after shutdown quietly
 * succeeds and a record left `in_progress` by a swallowed error is invisible.
 * The finding this exists for turns on exactly that: a terminalizing write
 * landing AFTER the adapter closed, its error swallowed by a best-effort
 * `catch`, and the durable row never settling. Only a closeable adapter can
 * show it.
 */
function closingStores(
  inner: StoreAdapter
): StoreAdapter & { raw: () => Record<string, unknown> } {
  let closed = false;
  // The un-guarded registry, so the TEST can still read after the adapter has
  // closed to the runtime — otherwise the assertion trips over its own guard.
  let rawRegistry: Record<string, unknown> = {};
  const guard = <T extends object>(target: T): T =>
    new Proxy(target, {
      get(t, key) {
        const value = (t as Record<string | symbol, unknown>)[key];
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          if (closed) throw new Error(`[test] store closed: ${String(key)}()`);
          return (value as (...a: unknown[]) => unknown).apply(t, args);
        };
      }
    });

  return {
    capabilities: inner.capabilities,
    resolve: async (slots) => {
      const registry = await inner.resolve(slots);
      rawRegistry = registry as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(registry).map(([slot, store]) => [
          slot,
          store === undefined ? store : guard(store as object)
        ])
      ) as typeof registry;
    },
    dispose: async () => {
      closed = true;
      await inner.dispose?.();
    },
    raw: () => rawRegistry
  };
}

/** The `fsdev run` call shape: runtime config SPREAD, not passed by reference. */
async function runLikeCli(
  runtime: FlowStateRuntime,
  flow: ReturnType<typeof detachingFlow>,
  sessionId: string
): Promise<void> {
  await runAction({
    flow,
    actionName: "launch",
    input: {},
    userId: USER_ID,
    sessionId,
    stores: runtime.stores,
    runtimeConfig: { ...runtime.runtimeConfig }
  });
}

describe("detached start on a runtime-only init (FIX-1077)", () => {
  it("starts a real child request in this process — no router involved", async () => {
    const observed: Observed = { children: [] };
    const flow = detachingFlow("runtime-detached", observed);

    const state = createFlowState({
      flows: { detaching: flow },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: markerResolver("app-default")
    });

    // getRouter()/ready() is never called. This is the whole topology.
    const runtime = await state.getRuntime();
    await runLikeCli(runtime, flow, "s_parent");

    expect(observed.error).toBeUndefined();
    // Before this wiring the shipped answer here was
    // `{ ok: false, refused: "no-start-operation" }`.
    expect(observed.start).toMatchObject({ ok: true, adopted: false });

    // The launching request returned before the child did — detachment's whole
    // point — so the child is awaited here rather than assumed finished.
    await until(() => observed.children.length === 1, "the child to run");

    const child = observed.children[0]!;
    expect(child.input).toEqual({ note: "detached-payload" });
    // It ran in the child session the seam derived, not in the parent's.
    expect(child.sessionId).not.toBe("s_parent");
    expect(observed.start).toMatchObject({ sessionId: child.sessionId });

    // ...and that session is a persisted child of the launching one, so the
    // Workstream is discoverable rather than merely executed.
    const record = await runtime.stores.session.get(child.sessionId);
    expect(record?.parentSessionId).toBe("s_parent");
    expect(record?.userId).toBe(USER_ID);
    expect(record?.topic).toBe("background");

    await state.dispose();
  });

  it("launches a Workstream from inside a COLOCATED queue worker", async () => {
    const observed: Observed = { children: [] };
    const flow = detachingFlow("colocated-worker-launch", observed);

    // The runtime the worker adapter is handed — the object `startWorker` keeps
    // and runs every job against. `createFlowApiRouter` rebuilds `requestHost`
    // as a fresh literal, so anything the router stamped never reached here.
    let workerRuntime: FlowStateRuntime | undefined;
    const worker = {
      mode: "colocated",
      // A colocated queue, closed the whole way round: the dispatcher "enqueues"
      // and the worker in this same process picks the job up and runs it. A stub
      // that only returns a handle would leave the child forever unconsumed and
      // could never show a Workstream launching, which is the point here.
      createDispatcher: (runtime: FlowStateRuntime) => ({
        dispatch: async (envelope: {
          requestId: string;
          flowKind: string;
          actionName: string;
          input: unknown;
          userId: string;
          sessionId?: string;
          source?: string;
        }) => {
          const target = runtime.registry.get(envelope.flowKind)!;
          const finished = runAction({
            flow: target,
            actionName: envelope.actionName as never,
            input: envelope.input,
            userId: envelope.userId,
            sessionId: envelope.sessionId,
            source: envelope.source,
            stores: runtime.stores,
            runtimeConfig: runtime.runtimeConfig
          });
          return { requestId: envelope.requestId, finished };
        }
      }),
      startWorker: (runtime: FlowStateRuntime) => {
        workerRuntime = runtime;
        return { close: async () => undefined };
      }
    } as unknown as WorkerAdapter;

    const state = createFlowState({
      flows: { detaching: flow },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: markerResolver("app-default"),
      worker
    });

    // The documented colocated setup builds a router; the worker consumes the
    // queue in the same process.
    await state.getRouter();
    const captured = workerRuntime;
    expect(captured).toBeDefined();

    // The parent action exactly as the QUEUE WORKER runs it: against the
    // captured runtime, under the worker's own transport source. This is the
    // path nothing on this epic had ever exercised — every other test runs
    // in-process or replays a captured envelope.
    await runAction({
      flow,
      actionName: "launch",
      input: {},
      userId: USER_ID,
      sessionId: "s_worker",
      source: "bullmq",
      stores: captured!.stores,
      runtimeConfig: captured!.runtimeConfig
    });

    // Before this, the worker met `no-start-operation`: the only installer wrote
    // to the router's fork of `requestHost`, which this object is not.
    expect(observed.error).toBeUndefined();
    expect(observed.start).toMatchObject({ ok: true });

    // And the observable that matters — a Workstream actually launched and ran,
    // not merely that an operation was installed on a runtime.
    await until(() => observed.children.length === 1, "the Workstream to run");
    expect(observed.children[0]!.sessionId).not.toBe("s_worker");

    await state.dispose();
  });

  it("launches a Workstream from a worker-only process too", async () => {
    const observed: Observed = { children: [] };
    const flow = detachingFlow("worker-only-detached", observed);

    const state = createFlowState({
      flows: { detaching: flow },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: markerResolver("app-default"),
      worker: stubWorker("worker-only")
    });

    const runtime = await state.getRuntime();
    await runLikeCli(runtime, flow, "s_parent");

    // This assertion is INVERTED from what it was. It used to pin the refusal —
    // on the reasoning that a `worker-only` process has no dispatcher, so a host
    // built for it runs detached work in-process instead of enqueuing it. That
    // remains true and it is still better than refusing: the colocated and
    // worker-only queue topologies are documented as supported, and refusing
    // detached work in one of them is not supporting it.
    //
    // The cost is real and named: the child runs on this worker rather than
    // through the queue, so it is not durable the way an enqueued job is. A
    // queue-backed start operation owned by the queue's own adapter is the
    // better answer (FIX-1069); this is what the feature does until that exists.
    expect(observed.error).toBeUndefined();
    expect(observed.start).toMatchObject({ ok: true });
    await until(() => observed.children.length === 1, "the Workstream to run");

    await state.dispose();
  });

  it("a later router does not take the operation away again", async () => {
    const observed: Observed = { children: [] };
    const flow = detachingFlow("runtime-then-router", observed);

    const state = createFlowState({
      flows: { detaching: flow },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: markerResolver("app-default")
    });

    // The `fsdev serve` / `fsdev dev` order: the runtime resolves first (the
    // bind guard and the banner both read it), and only then is a router built.
    const runtime = await state.getRuntime();
    const wired = runtime.runtimeConfig.requestHost?.startOperation;
    expect(wired).toBeDefined();

    await state.getRouter();

    // The shared config is the only object a colocated worker or a direct
    // `runAction` reads, and `createFlowApiRouter` copies `requestHost` onto its
    // own config rather than mutating this one. So taking the operation off here
    // to let the router re-wire would hand the router a capability and remove it
    // from everything else in the process.
    expect(runtime.runtimeConfig.requestHost?.startOperation).toBe(wired);

    await runLikeCli(runtime, flow, "s_parent");
    expect(observed.start).toMatchObject({ ok: true });
    await until(() => observed.children.length === 1, "the child to run");

    await state.dispose();
  });

  it("dispose() waits for an in-flight child instead of closing the stores under it", async () => {
    const observed: Observed = { children: [] };
    // Slow enough that the child is provably mid-flight when the parent returns.
    const flow = detachingFlow("runtime-drain", observed, { coreDelayMs: 60 });

    const state = createFlowState({
      flows: { detaching: flow },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: markerResolver("app-default")
    });

    const runtime = await state.getRuntime();
    await runLikeCli(runtime, flow, "s_parent");
    expect(observed.start).toMatchObject({ ok: true });

    // The launching request returned first — that is detachment working, and it
    // is also the exact window in which the CLI used to tear everything down.
    expect(observed.children).toEqual([]);

    await state.dispose();

    // Without the drain, `fsdev run` disposed here: pooled stores closed while
    // the child was still writing, the child failed on a closed store, and its
    // task row was stranded `in_progress` forever. Nothing in the parent's own
    // output said so.
    expect(observed.children).toHaveLength(1);

    // And the child got far enough to do real work, not merely to start.
    expect(observed.children[0]!.input).toEqual({ note: "detached-payload" });
  });

  it("NEGATIVE: does not wait on an externally dispatched child, whose queue may have no consumer", async () => {
    const observed: Observed = { children: [] };
    const flow = detachingFlow("runtime-dispatch-only", observed);

    const state = createFlowState({
      flows: { detaching: flow },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: markerResolver("app-default"),
      // Router-less but queue-routed: the start operation is wired (this runtime
      // CAN dispatch), and the child runs somewhere else.
      worker: stubWorkerWithNoConsumer("dispatch-only")
    });

    const runtime = await state.getRuntime();
    await runLikeCli(runtime, flow, "s_parent");
    expect(observed.start).toMatchObject({ ok: true });

    // The whole assertion: this returns. Tracking a remote job's `finished` as
    // if it were local work blocks here forever whenever no worker is consuming
    // the queue — and nothing is stranded by not waiting, because an enqueued
    // job is durable and outliving this process is the point of enqueuing it.
    await state.dispose();

    // Vacuously-passing guard: if the child had somehow run in-process, the
    // dispatcher assumption above would be wrong and the test would prove
    // nothing about external dispatch.
    expect(observed.children).toEqual([]);
  });

  it(
    "NEGATIVE: a child that never settles cannot hang dispose, and is named on the way out",
    // A generous test-level timeout so the failure mode is legible: against the
    // unbounded drain this hangs rather than asserting, and without an explicit
    // bound well above the drain's own budget a reader cannot tell "the fix is
    // broken" from "the suite stalled".
    { timeout: 15_000 },
    async () => {
      const observed: Observed = { children: [] };
      const flow = detachingFlow("runtime-drain-wedged", observed, {
        // In-process, so it IS tracked — and never finishes. A Workstream
        // blocked on an external call looks exactly like this.
        coreNeverSettles: true
      });

      const state = createFlowState({
        flows: { detaching: flow },
        stores: { default: { primary: inMemoryStores() } },
        modelResolver: markerResolver("app-default"),
        // Short budget so the test measures the bound rather than the default.
        detachedDrainTimeoutMs: 250
      });

      const runtime = await state.getRuntime();
      await runLikeCli(runtime, flow, "s_parent");
      expect(observed.start).toMatchObject({ ok: true });

      // The give-up report deliberately bypasses the logger — it reports work
      // that may not have completed, which `--quiet` must not be able to hide.
      const reported: string[] = [];
      const restore = console.error;
      console.error = (...args: unknown[]) => {
        reported.push(args.map(String).join(" "));
      };

      const startedAt = Date.now();
      try {
        await state.dispose();
      } finally {
        console.error = restore;
      }
      const elapsed = Date.now() - startedAt;

      // THE ASSERTION THIS EXISTS FOR: the round cap bounded the number of
      // batches but not the wait inside one, so a single never-settling child
      // meant `dispose()` never returned at all.
      expect(elapsed).toBeLessThan(10_000);

      // And it did not go quietly. A count alone would be barely better than
      // silence, so the ids someone reads the rows back with have to be there.
      const truncation = reported.find((line) =>
        line.includes("shutdown cancelled")
      );
      expect(truncation).toBeDefined();
      expect(truncation).toContain("1 detached request(s)");
      const startedChild = observed.start as { sessionId?: string };
      expect(truncation).toContain(startedChild.sessionId!);
    }
  );

  it(
    "detachedDrainTimeoutMs is a true ceiling — including the documented 0",
    { timeout: 20_000 },
    async () => {
      // A budget the drain cannot possibly satisfy, so the only thing under test
      // is how long shutdown takes to give up.
      const measure = async (budget: number): Promise<number> => {
        const observed: Observed = { children: [] };
        const flow = detachingFlow(`runtime-ceiling-${budget}`, observed, {
          coreNeverSettles: true
        });
        const state = createFlowState({
          flows: { detaching: flow },
          stores: { default: { primary: inMemoryStores() } },
          modelResolver: markerResolver("app-default"),
          detachedDrainTimeoutMs: budget
        });
        const runtime = await state.getRuntime();
        await runLikeCli(runtime, flow, "s_parent");
        expect(observed.start).toMatchObject({ ok: true });

        const startedAt = Date.now();
        const restore = console.error;
        console.error = () => {};
        try {
          await state.dispose();
        } finally {
          console.error = restore;
        }
        return Date.now() - startedAt;
      };

      // `0` is documented as immediate shutdown. Waiting the unwind grace on top
      // of the budget made that simply false — it took ~2s.
      const immediate = await measure(0);
      expect(immediate).toBeLessThan(500);

      // And a real budget is not budget + a constant. 1000ms of ceiling means
      // ~1000ms, not ~3000ms.
      const bounded = await measure(1_000);
      expect(bounded).toBeLessThan(2_000);
      // Sanity: it did actually wait, rather than the ceiling being vacuous.
      expect(bounded).toBeGreaterThanOrEqual(500);
    }
  );

  it("the drain survives a queued concurrency policy instead of wedging on it", async () => {
    const observed: Observed = { children: [] };
    const flow = detachingFlow("runtime-drain-queued", observed, {
      coreDelayMs: 30,
      // The shape that makes a detached child queue on the same key its parent
      // would hold. A drain that waited for the child to be *executing* from
      // inside the parent would deadlock here — the child cannot start until the
      // key is free, and the key is not free until the parent returns.
      concurrency: { policy: "queue", key: "user" }
    });

    const state = createFlowState({
      flows: { detaching: flow },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: markerResolver("app-default")
    });

    const runtime = await state.getRuntime();
    await runLikeCli(runtime, flow, "s_parent");
    expect(observed.start).toMatchObject({ ok: true });

    // The drain runs at dispose, after the launching request has settled, so the
    // key it might have held is already released. Waiting here is a wait, never
    // a cycle.
    await state.dispose();
    expect(observed.children).toHaveLength(1);
  });

  it("routes the shutdown notice through the configured logger, so --quiet silences it", async () => {
    const observed: Observed = { children: [] };
    const flow = detachingFlow("runtime-quiet", observed, { coreDelayMs: 30 });

    const state = createFlowState({
      flows: { detaching: flow },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: markerResolver("app-default")
    });

    const runtime = await state.getRuntime();

    // What `--quiet` installs, and it is installed AFTER the runtime resolved —
    // the order the CLI actually works in, which is why the notice has to read
    // the logger at call time rather than capture it at construction.
    const warnings: string[] = [];
    runtime.runtimeConfig.logger = {
      warn: (message) => {
        warnings.push(message);
      }
    };

    await runLikeCli(runtime, flow, "s_parent");
    await state.dispose();

    // The child still drained — silencing the notice must not silence the work.
    expect(observed.children).toHaveLength(1);

    // ...and the notice went to the logger, which is what a silent one can then
    // suppress. Writing straight to `console` bypassed it entirely.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("detached request(s) to finish before shutdown");
  });

  it("a child cancelled while QUEUED never starts, even at a 0 ceiling", async () => {
    const observed: Observed = { children: [] };
    const flow = detachingFlow("queued-cancel", observed, {
      // The child queues behind the key its own parent holds. Until it leaves
      // the queue, `runAction` has not registered an abort controller, so a
      // cancel had nothing to find — and the run could wake AFTER dispose and
      // start against closed adapters.
      concurrency: { policy: "queue", key: "user" },
      // The parent outlives the 202, so the key is still held at dispose.
      launcherDelayMs: 400
    });

    const state = createFlowState({
      flows: { detaching: flow },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: markerResolver("app-default"),
      // Immediate shutdown: the ceiling wins, so nothing is waited for. The
      // cancel still has to APPLY — it is a decision the queued waiter re-reads,
      // not a wait, which is what lets both hold at once.
      detachedDrainTimeoutMs: 0
    });

    // The parent must go through the HOST to claim a concurrency key at all —
    // `runAction` (what `fsdev run` does) is unarbitrated, so a child dispatched
    // from it never queues and the window under test never opens.
    const router = await state.getRouter();
    // Memoized, so this is the same resolved store registry the router uses.
    const runtime = await state.getRuntime();
    const res = await router.POST(
      new Request("http://localhost/api/flows/queued-cancel/actions/launch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: USER_ID, sessionId: "s_http", input: {} })
      }),
      { params: { path: ["queued-cancel", "actions", "launch"] } }
    );
    // 202: the route acks and the parent keeps running, still holding the key.
    expect(res.status).toBe(202);

    await until(() => observed.start !== undefined, "the child to be dispatched");
    expect(observed.start).toMatchObject({ ok: true });
    // Queued, not started — the parent still holds the key.
    expect(observed.children).toEqual([]);

    const restore = console.error;
    console.error = () => {};
    try {
      await state.dispose();
    } finally {
      console.error = restore;
    }

    // Wait PAST the parent's remaining hold (400ms), so the key is genuinely
    // released and the queued child gets its chance to run. A shorter wait than
    // the hold makes this vacuous — the child would not have started either way.
    await new Promise((resolve) => setTimeout(resolve, 900));

    // If cancellation only reached started runs, this is where the queued child
    // wakes up and executes against stores `dispose()` has already closed.
    expect(observed.children).toEqual([]);

    // And it is recorded as what it was. `aborted` is a successful cancellation;
    // `failed` would tell clients, workstream summaries and recovery that an
    // execution broke, and recovery reads terminal statuses to decide what needs
    // attention. Two different events must not share one status.
    const childRequestId = (observed.start as { requestId?: string }).requestId!;
    const record = await runtime.stores.request.get(childRequestId);
    expect(record?.status).toBe("aborted");
    expect(record?.failedAtMs).toBeUndefined();
  });

  it(
    "leaves a cancelled queued child's row to recovery, and never starts it",
    { timeout: 20_000 },
    async () => {
      const observed: Observed = { children: [] };
      const flow = detachingFlow("queued-terminalize", observed, {
        concurrency: { policy: "queue", key: "user" },
        // The parent holds the key past shutdown, so the queued child's gate
        // callback — where it would notice its own cancellation — never runs
        // while the stores are open.
        launcherDelayMs: 1_500
      });

      const adapter = closingStores(inMemoryStores());
      const state = createFlowState({
        flows: { detaching: flow },
        stores: { default: { primary: adapter } },
        modelResolver: markerResolver("app-default"),
        detachedDrainTimeoutMs: 0
      });

      const router = await state.getRouter();
      const runtime = await state.getRuntime();

      const res = await router.POST(
        new Request("http://localhost/api/flows/queued-terminalize/actions/launch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId: USER_ID, sessionId: "s_http", input: {} })
        }),
        { params: { path: ["queued-terminalize", "actions", "launch"] } }
      );
      expect(res.status).toBe(202);

      await until(() => observed.start !== undefined, "the child to be dispatched");
      expect(observed.start).toMatchObject({ ok: true });

      const childRequestId = (observed.start as { requestId?: string }).requestId!;

      const restore = console.error;
      console.error = () => {};
      try {
        await state.dispose();
      } finally {
        console.error = restore;
      }

      // THE ASSERTION: it never starts. Wait past the parent's hold, so the key
      // genuinely releases and the queued child gets its chance.
      await new Promise((resolve) => setTimeout(resolve, 1_800));
      expect(observed.children).toEqual([]);

      // The row is deliberately NOT settled by shutdown. An earlier version
      // wrote a terminal status here and produced three defects doing it: the
      // write raced the child's own, it mislabelled the event, and the I/O made
      // the shutdown bound unenforceable. Settling a child's row is not the
      // parent's job — the substrate recovers it. `detectInterruptedRequests`
      // marks an abandoned `in_progress` record `interrupted` on the next start,
      // and a task row's lapsed lease makes it claimable again without ever
      // being terminalized here.
      //
      // Read through the raw registry, since the adapter is closed to callers.
      const requests = adapter.raw().request as {
        get: (id: string) => Promise<{ status?: string } | undefined>;
      };
      const record = await requests.get(childRequestId);
      expect(record?.status).toBe("in_progress");
    }
  );

  it("refuses to admit detached work once disposal has begun", async () => {
    const observed: Observed = { children: [] };
    const flow = detachingFlow("admission-closed", observed);

    const state = createFlowState({
      flows: { detaching: flow },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: markerResolver("app-default")
    });

    const runtime = await state.getRuntime();
    await state.dispose();

    // A parent still running when shutdown began — the worker draining its last
    // jobs is the shipped shape — reaching `startDetached` afterwards. Before
    // the gate this registered a child the drain had already walked past: never
    // waited for, never cancelled, never reported, and writing while the stores
    // closed underneath it.
    await runLikeCli(runtime, flow, "s_late");

    expect(observed.start).toMatchObject({
      ok: false,
      refused: "dispatch-rejected"
    });
    expect(observed.children).toEqual([]);
    // Refused as a value the caller can settle its own row from, not thrown.
    expect(observed.error).toBeUndefined();
  });

  it("the child inherits the CALLER's runtime config, not the host's", async () => {
    const observed: Observed = { children: [] };
    const flow = detachingFlow("runtime-config-inherit", observed);

    const state = createFlowState({
      flows: { detaching: flow },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: markerResolver("app-default")
    });

    const runtime = await state.getRuntime();

    // Exactly what `fsdev run --model` builds: the app's config with the
    // resolver swapped, handed to `runAction` as a DERIVED object. The host was
    // constructed with the pristine one, so a child that reads the host's
    // config silently runs the app's default model — which defeats the flag
    // whose entire purpose is choosing the model.
    await runAction({
      flow,
      actionName: "launch",
      input: {},
      userId: USER_ID,
      sessionId: "s_parent",
      stores: runtime.stores,
      runtimeConfig: {
        ...runtime.runtimeConfig,
        modelResolver: markerResolver("cli-override")
      }
    });

    expect(observed.start).toMatchObject({ ok: true });
    await until(() => observed.children.length === 1, "the child to run");
    expect(observed.children[0]!.model).toBe("cli-override");

    await state.dispose();
  });

  it("enforces a reject policy ACROSS the router and detached hosts, not once each", async () => {
    const observed: Observed = { children: [] };
    const flow = detachingFlow("runtime-arbiter-shared", observed, {
      // The parent holds this key for its whole run. A child dispatched under
      // the same key must meet it.
      concurrency: { policy: "reject", key: "user" }
    });

    const state = createFlowState({
      flows: { detaching: flow },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: markerResolver("app-default")
    });

    // The topology the split lives in: the runtime resolves first (so
    // `#wireDetachedStart` builds a host), and a router is built after (so a
    // second host exists). `fsdev serve` and `fsdev dev` both do this.
    await state.getRuntime();
    const router = await state.getRouter();

    // A real HTTP request, so the PARENT goes through the router's host and
    // holds the concurrency key there — which is the only way the two hosts can
    // be observed disagreeing.
    const res = await router.POST(
      new Request(
        "http://localhost/api/flows/runtime-arbiter-shared/actions/launch",
        {
          method: "POST",
          headers: { "content-type": "application/json", accept: "text/event-stream" },
          body: JSON.stringify({ userId: USER_ID, sessionId: "s_http", input: {} })
        }
      ),
      { params: { path: ["runtime-arbiter-shared", "actions", "launch"] } }
    );
    const reader = res.body?.getReader();
    while (reader !== undefined) {
      const { done } = await reader.read();
      if (done) break;
    }

    // With one arbiter the child's dispatch meets its parent's held key and is
    // rejected. With a private arbiter per host it sees a free key and runs, so
    // a declared `reject` policy is enforced once per host instead of once per
    // flow — policy belongs to the flow, not to whichever host took the
    // dispatch.
    expect(observed.children).toEqual([]);
    // The refusal reaches the block as a RETURNED value, not a throw: the host
    // refuses synchronously before dispatching, so the caller still owns the
    // work and can settle its own row rather than leaving it to lease recovery.
    expect(observed.start).toMatchObject({ ok: false, refused: "dispatch-rejected" });
    expect(observed.error).toBeUndefined();
  });

  it("drains a Workstream started over HTTP on the router-first path", async () => {
    const observed: Observed = { children: [] };
    // Slow enough to be provably mid-flight when the response comes back.
    const flow = detachingFlow("router-first-drain", observed, { coreDelayMs: 60 });

    const state = createFlowState({
      flows: { detaching: flow },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: markerResolver("app-default")
    });

    // The ordinary production topology: the router IS the entry point, so
    // nothing resolves the runtime first. Next.js route handlers and `serve()`
    // both land here, which makes this the path most deployments are on.
    const router = await state.getRouter();

    const res = await router.POST(
      new Request("http://localhost/api/flows/router-first-drain/actions/launch", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ userId: USER_ID, sessionId: "s_http", input: {} })
      }),
      { params: { path: ["router-first-drain", "actions", "launch"] } }
    );
    const reader = res.body?.getReader();
    while (reader !== undefined) {
      const { done } = await reader.read();
      if (done) break;
    }

    expect(observed.start).toMatchObject({ ok: true });
    // The launching request returned first — detachment working, and the window
    // in which shutdown used to close the stores under the child.
    expect(observed.children).toEqual([]);

    await state.dispose();

    // THE ASSERTION. When the router installed its own untracked start
    // operation, this child was never registered for the drain: `dispose()`
    // drained an empty set, returned immediately, and closed the stores while
    // the child was still running. Asserting that `onDispatched` is wired would
    // not have caught it — only asking whether the work actually survived does.
    expect(observed.children).toHaveLength(1);
    expect(observed.children[0]!.input).toEqual({ note: "detached-payload" });
  });

  it("a router-first init puts the TRACKED operation on the shared config", async () => {
    const observed: Observed = { children: [] };
    const flow = detachingFlow("router-first", observed);

    const state = createFlowState({
      flows: { detaching: flow },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: markerResolver("app-default")
    });

    // Next.js / `serve()` order: the router is the entry point.
    await state.getRouter();
    const runtime = await state.getRuntime();

    // This assertion is INVERTED from what it was, deliberately. It used to
    // assert `undefined` here — pinning that a router-first init was left to
    // `createFlowRouteHandlers` — and that was pinning the defect: the router's
    // operation carries no child tracking, so shutdown drained an empty set on
    // the topology most deployments run. The invariant worth holding is that
    // wherever a FlowState owns the config, the operation on it is the tracked
    // one, and that this is the object a colocated worker and a direct
    // `runAction` read.
    expect(runtime.runtimeConfig.requestHost?.startOperation).toBeDefined();

    await state.dispose();
  });

  /**
   * The other half of "shutdown does not settle a child's record".
   *
   * The drain deliberately leaves an abandoned row to the substrate, and the
   * request-record half of that promise is `detectInterruptedRequests`. Every
   * caller of it used to sit behind `createFlowApiRouter` — startup detection,
   * the periodic sweeper, and the recovery route alike — so a router-less
   * deployment had nothing that could ever reclassify an abandoned row. Which
   * is to say: on the exact topology this issue is about, the recovery the
   * removal was justified by did not run.
   *
   * Driven at the outcome. Seed a record the way an interrupted run leaves it,
   * initialize a SECOND runtime the way a later `fsdev run` does, and read the
   * status back.
   */
  it("sweeps a previous run's abandoned record on a runtime-only init", async () => {
    const observed: Observed = { children: [] };
    const flow = detachingFlow("runtime-sweep", observed);
    // One adapter instance, so both runtimes share a store the way two CLI
    // invocations against the same durable store do.
    const adapter = inMemoryStores();

    const first = createFlowState({
      flows: { detaching: flow },
      stores: { default: { primary: adapter } }
    });
    const runtime = await first.getRuntime();

    // What a run whose process walked away leaves: an `in_progress` record and
    // a registry entry whose heartbeat stopped long enough ago to be stale.
    const abandonedAt = Date.now() - 10 * 60_000;
    await runtime.stores.request.set(
      "req_abandoned",
      {
        requestId: "req_abandoned",
        sessionId: "s_abandoned",
        userId: USER_ID,
        flowKind: "runtime-sweep",
        actionName: "launch",
        status: "in_progress",
        createdAt: abandonedAt,
        updatedAt: abandonedAt
      } as never,
      "any"
    );
    await runtime.stores.activeRequests.register({
      requestId: "req_abandoned",
      sessionId: "s_abandoned",
      userId: USER_ID,
      flowKind: "runtime-sweep",
      actionName: "launch",
      startedAt: abandonedAt,
      lastHeartbeatAt: abandonedAt
    } as never);
    await first.dispose();

    // The later invocation. `getRouter()` is never called — that is the point.
    const second = createFlowState({
      flows: { detaching: flow },
      stores: { default: { primary: adapter } }
    });
    await second.getRuntime();

    await until(async () => {
      const record = await runtime.stores.request.get("req_abandoned");
      return record?.status === "interrupted";
    }, "the abandoned record to be swept to interrupted");

    const record = await runtime.stores.request.get("req_abandoned");
    // `interrupted`, not `failed` or `aborted`: the run was stopped by its
    // process going away, and `interrupted` is the resumable reading of that.
    expect(record?.status).toBe("interrupted");

    await second.dispose();
  });

  /**
   * A logger that throws must not strand the backend it was describing.
   *
   * The drain's waiting notice goes through a HOST-SUPPLIED `RuntimeLogger`.
   * Unguarded, a logger that throws rejects `dispose()` from inside the drain —
   * before the worker closes and before a single store adapter is released. The
   * process then exits holding open pools, and the diagnostic that was meant to
   * describe shutdown is what prevented it.
   */
  it("still releases adapters when the configured logger throws", async () => {
    const observed: Observed = { children: [] };
    // A child that never settles, so the drain is guaranteed to reach the
    // waiting notice rather than finishing before it prints anything.
    const flow = detachingFlow("logger-throws", observed, { coreNeverSettles: true });

    let disposed = false;
    const inner = inMemoryStores();
    const adapter: StoreAdapter = {
      capabilities: inner.capabilities,
      resolve: (slots) => inner.resolve(slots),
      dispose: async () => {
        disposed = true;
        await inner.dispose?.();
      }
    };

    const state = createFlowState({
      flows: { detaching: flow },
      stores: { default: { primary: adapter } },
      detachedDrainTimeoutMs: 50
    });

    const runtime = await state.getRuntime();
    // Installed after the runtime resolves, which is how a real host does it —
    // and is why the drain looks its logger up at call time.
    //
    // Scoped to the drain's own notice rather than throwing on every `warn`.
    // `runAction` also logs from inside an abort listener, and AbortSignal
    // invokes listeners outside any promise chain this file can guard — a
    // throw-on-everything logger surfaces from there as an uncaught exception
    // that has nothing to do with `dispose()`. That is a real gap and a wider
    // one than this issue; it is flagged separately rather than widened into
    // here, and the cancel loop guards its own synchronous half regardless.
    (runtime.runtimeConfig as { logger?: unknown }).logger = {
      warn: (message: string) => {
        if (message.includes("waiting for")) throw new Error("logger exploded");
      }
    };

    await runLikeCli(runtime, flow, "s_parent");
    await until(() => observed.start !== undefined, "the child to be dispatched");

    const restore = console.error;
    const errors: string[] = [];
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };
    try {
      // Must not reject. A throwing diagnostic is not a shutdown failure.
      await expect(state.dispose()).resolves.toBeUndefined();
    } finally {
      console.error = restore;
    }

    // Two assertions, because the two guards buy different things and a single
    // one would let either go unnoticed.
    //
    // Cleanup below the failed log line still happened — without the guard in
    // `dispose()`, the throw propagates out of the drain and no adapter is ever
    // released.
    expect(disposed).toBe(true);
    // And the drain still did its actual job. The waiting notice is emitted
    // BEFORE the cancel, so a throw that is caught only at the top of
    // `dispose()` abandons the rest of the drain — the child is never
    // cancelled, and this report never printed.
    expect(errors.some((line) => line.includes("shutdown cancelled"))).toBe(true);
  });
});
