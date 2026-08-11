/**
 * A router-less deployment can start detached work (FIX-1077).
 *
 * `createFlowRouteHandlers` was the only thing that ever assigned
 * `runtimeConfig.requestHost.startOperation`. A process that resolves its
 * runtime through `getRuntime()` and never asks for a router — `fsdev run` and
 * `fsdev chat`, which `AGENTS.md` names as the DEFAULT way to verify a flow
 * change — therefore met `no-start-operation` on every detached dispatch. The
 * team's primary verification tool was structurally blind to detached work.
 *
 * These tests drive the runtime the way `fsdev run` does: `getRuntime()`, then
 * `runAction` against `runtime.stores` with the runtime's config SPREAD (the CLI
 * overrides the logger and model resolver that way). The spread is part of the
 * subject, not incidental — the seam only reaches a request because a spread
 * copies the `requestHost` *reference*.
 *
 * Both directions are pinned (BP-035):
 *  - the in-process case starts a real child request, in this process;
 *  - `worker-only` — which has no inbound transport and no dispatcher by
 *    construction — still refuses `no-start-operation` BY NAME, because its
 *    start operation is a queue-backed enqueue owned by the queue's adapter.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler, requireRequestHost } from "@flow-state-dev/core";
import type { ModelResolver, StartDetachedResult } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "../../src";
import type { FlowStateRuntime, WorkerAdapter } from "../../src/flowstate/types";

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
async function until(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
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

  it("OUT OF SCOPE: a worker-only process still refuses by name", async () => {
    const observed: Observed = { children: [] };
    const flow = detachingFlow("worker-only-detached", observed);

    const state = createFlowState({
      flows: { detaching: flow },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: (() => undefined) as never,
      worker: stubWorker("worker-only")
    });

    const runtime = await state.getRuntime();
    await runLikeCli(runtime, flow, "s_parent");

    // No inbound transport and no dispatcher: a host built here would fall back
    // to in-process dispatch and run detached work inside the worker instead of
    // enqueuing it. Refusing is the honest answer, and the queue's own adapter
    // owns the fix.
    expect(observed.error).toBeUndefined();
    expect(observed.start).toEqual({
      ok: false,
      refused: "no-start-operation",
      detail: expect.any(String)
    });
    expect(observed.children).toEqual([]);

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

  it("a router-first init is left exactly as it was — the router wires its own", async () => {
    const observed: Observed = { children: [] };
    const flow = detachingFlow("router-first", observed);

    const state = createFlowState({
      flows: { detaching: flow },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: markerResolver("app-default")
    });

    // Next.js / `serve()` order: the router is the entry point, so
    // `createFlowRouteHandlers` covers the HTTP path and this change stays out
    // of that topology entirely.
    await state.getRouter();
    const runtime = await state.getRuntime();

    expect(runtime.runtimeConfig.requestHost?.startOperation).toBeUndefined();

    await state.dispose();
  });
});
