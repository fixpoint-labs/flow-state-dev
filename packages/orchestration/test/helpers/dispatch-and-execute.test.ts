/**
 * dispatchAndExecute tests — covers happy path (claim → worker →
 * complete), the rescue path (worker throw → fail), registry
 * routing by `task.assignee`, and the reach of the lease-loss signal
 * into a composite worker's nested steps (FIX-1005).
 */
import { describe, expect, it } from "vitest";
import { handler, sequencer } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { runForTest } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  createSequencerBackedTaskCollection,
  dispatchAndExecuteBlock,
  fifoDispatcher,
  MIN_LEASE_DURATION_MS,
  type TaskCollectionRef,
  type TaskDispatcher,
} from "../../src/tasks";
import {
  createCapturedChanges,
  createFakeSequencerState,
} from "../helpers";

function buildCollection(): TaskCollectionRef {
  const captured = createCapturedChanges();
  const sequencer = createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} });
  return createSequencerBackedTaskCollection({
    collectionId: "tasks",
    sequencer,
    onChange: captured.onChange,
  });
}

const fakeCtx = {} as BlockContext;

describe("dispatchAndExecuteBlock", () => {
  it("claims, runs the worker, calls complete on success", async () => {
    const c = buildCollection();
    await c.addTask({ id: "t", goal: "do thing", input: { x: 2 } });

    const worker = handler({
      name: "worker",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: (input: { input?: { x: number } }) => ({ y: (input.input?.x ?? 0) * 2 }),
    });

    const result = await runForTest(
      dispatchAndExecuteBlock({ collection: c, dispatcher: fifoDispatcher, workers: worker }),
      undefined,
      fakeCtx
    );

    expect(result.claimed).toBe(true);
    expect(result.taskId).toBe("t");
    expect(result.output).toEqual({ y: 4 });
    expect(c.get("t")?.status).toBe("completed");
    expect(c.get("t")?.output).toEqual({ y: 4 });
  });

  it("packs title and context onto the worker input (FIX-827)", async () => {
    const c = buildCollection();
    await c.addTask({
      id: "t",
      goal: "research the listed subdomains",
      title: "Subdomain research",
      context: "Subdomains: a.example.com, b.example.com, c.example.com",
    });

    let seen: { title?: string; context?: string; goal?: string } | undefined;
    const worker = handler({
      name: "worker",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: (input: { title?: string; context?: string; goal?: string }) => {
        seen = input;
        return { ok: true };
      },
    });

    await runForTest(
      dispatchAndExecuteBlock({ collection: c, dispatcher: fifoDispatcher, workers: worker }),
      undefined,
      fakeCtx
    );

    expect(seen?.goal).toBe("research the listed subdomains");
    expect(seen?.title).toBe("Subdomain research");
    expect(seen?.context).toBe("Subdomains: a.example.com, b.example.com, c.example.com");
  });

  it("returns claimed=false when nothing is pending", async () => {
    const c = buildCollection();
    const worker = handler({
      name: "worker",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: () => null,
    });

    const result = await runForTest(
      dispatchAndExecuteBlock({ collection: c, dispatcher: fifoDispatcher, workers: worker }),
      undefined,
      fakeCtx
    );

    expect(result.claimed).toBe(false);
  });

  it("rescues worker throw → fails the task with the error message (onError: skip)", async () => {
    const c = buildCollection();
    await c.addTask({ id: "t", goal: "boom" });

    const worker = handler({
      name: "worker",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: () => {
        throw new Error("worker died");
      },
    });

    const result = await runForTest(
      dispatchAndExecuteBlock({ collection: c, dispatcher: fifoDispatcher, workers: worker }),
      undefined,
      fakeCtx
    );

    expect(result.claimed).toBe(true);
    expect(result.error).toBe("worker died");
    expect(c.get("t")?.status).toBe("errored");
    expect(c.get("t")?.error).toBe("worker died");
  });

  it("rethrows after fail when onError: fail", async () => {
    const c = buildCollection();
    await c.addTask({ id: "t", goal: "boom" });

    const worker = handler({
      name: "worker",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: () => {
        throw new Error("propagate");
      },
    });

    await expect(
      runForTest(
        dispatchAndExecuteBlock({
          collection: c,
          dispatcher: fifoDispatcher,
          workers: worker,
          onError: "fail",
        }),
        undefined,
        fakeCtx
      )
    ).rejects.toThrow(/propagate/);
    // The task is still marked errored even though the call rethrew.
    expect(c.get("t")?.status).toBe("errored");
  });

  it("registry: routes by task.assignee", async () => {
    const c = buildCollection();
    await c.addTask({ id: "r1", goal: "research", assignee: "researcher" });
    await c.addTask({ id: "w1", goal: "write", assignee: "writer" });

    const calls: string[] = [];
    const researcher = handler({
      name: "researcher",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: (input: { taskId: string }) => {
        calls.push(`researcher:${input.taskId}`);
        return "research-result";
      },
    });
    const writer = handler({
      name: "writer",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: (input: { taskId: string }) => {
        calls.push(`writer:${input.taskId}`);
        return "write-result";
      },
    });
    const registry = { researcher, writer };

    const block = dispatchAndExecuteBlock({
      collection: c,
      dispatcher: fifoDispatcher,
      workers: registry,
      workerId: "w-1",
    });
    await runForTest(block, undefined, fakeCtx);
    await runForTest(block, undefined, fakeCtx);

    expect(calls).toEqual(["researcher:r1", "writer:w1"]);
    expect(c.get("r1")?.output).toBe("research-result");
    expect(c.get("w1")?.output).toBe("write-result");
  });

  it("registry: throws when task has no assignee", async () => {
    const c = buildCollection();
    await c.addTask({ id: "t", goal: "no-assignee" });
    const worker = handler({
      name: "x",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: () => null,
    });
    await expect(
      runForTest(
        dispatchAndExecuteBlock({
          collection: c,
          dispatcher: fifoDispatcher,
          workers: { x: worker },
        }),
        undefined,
        fakeCtx
      )
    ).rejects.toThrow(/no assignee/);
  });

  it("registry: throws when no worker registered for assignee", async () => {
    const c = buildCollection();
    await c.addTask({ id: "t", goal: "missing", assignee: "ghost" });
    const worker = handler({
      name: "x",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: () => null,
    });
    await expect(
      runForTest(
        dispatchAndExecuteBlock({
          collection: c,
          dispatcher: fifoDispatcher,
          workers: { x: worker },
        }),
        undefined,
        fakeCtx
      )
    ).rejects.toThrow(/no worker registered/);
  });

  it("registry: a prototype-named assignee (FIX-943) does not resolve to Object.prototype", async () => {
    const c = buildCollection();
    await c.addTask({ id: "t1", goal: "evil", assignee: "constructor" });
    const worker = handler({
      name: "x",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: () => null,
    });
    await expect(
      runForTest(
        dispatchAndExecuteBlock({
          collection: c,
          dispatcher: fifoDispatcher,
          workers: { x: worker },
        }),
        undefined,
        fakeCtx
      )
    ).rejects.toThrow(/no worker registered/);
  });

  it("registry: another prototype key (toString) also takes the 'no worker registered' path (FIX-943)", async () => {
    const c = buildCollection();
    await c.addTask({ id: "t2", goal: "evil", assignee: "toString" });
    const worker = handler({
      name: "x",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: () => null,
    });
    await expect(
      runForTest(
        dispatchAndExecuteBlock({
          collection: c,
          dispatcher: fifoDispatcher,
          workers: { x: worker },
        }),
        undefined,
        fakeCtx
      )
    ).rejects.toThrow(/no worker registered/);
  });
});

/**
 * A stand-in for the server-installed execution scope, faithful in the one
 * respect this suite turns on: a child scope's signal is
 * `signalOverride ?? <the context this closure belongs to>.signal`.
 *
 * The engine builds that closure per context (`createExecutionContext`), so it
 * resolves children against the signal of the context it was BUILT for — not
 * of whatever spread copy it is invoked on. That is the whole defect:
 * `dispatchAndExecute` handed the worker a `{ ...ctx, signal }` copy, which
 * sets the worker's own `ctx.signal` but leaves this closure resolving
 * children against the original's. A leaf worker never notices; a sequencer
 * worker's nested steps kept the request signal.
 */
function installExecutionScope(base: BlockContext): BlockContext {
  const ctx = { ...base } as BlockContext;
  (ctx as {
    _withExecutionScope?: (
      parent: unknown,
      execute: (child: BlockContext) => Promise<unknown>,
      signalOverride?: AbortSignal
    ) => Promise<unknown>;
  })._withExecutionScope = async (_parent, execute, signalOverride) =>
    execute(installExecutionScope({ ...ctx, signal: signalOverride ?? ctx.signal }));
  return ctx;
}

/** Claims under the shortest permitted lease, so renewal ticks in ~333ms. */
const shortLeaseDispatcher: TaskDispatcher = {
  async claim(collection, workerId) {
    return collection.claim(workerId, { leaseDurationMs: MIN_LEASE_DURATION_MS });
  },
};

describe("losing the claim stops a COMPOSITE worker, not just its outermost step", () => {
  it("aborts a nested step of a sequencer worker when the claim is lost (FIX-1005)", async () => {
    // The point of the lease-loss signal is to stop a worker paying for work it
    // can no longer record. A sequencer worker is where that money actually
    // goes — its nested generators are the model calls — so a signal that stops
    // only the top-level context stops nothing that costs anything.
    //
    // Neuter `workerCtx` back to a plain `{ ...ctx, signal }` spread and this
    // fails with `ended: "timeout"`: the claim is long gone, renewal has
    // aborted, and the nested step is still running on the request's signal.
    const c = buildCollection();
    await c.addTask({ id: "t", goal: "expensive work" });

    // Never aborts. So the ONLY thing that can stop the nested step is the
    // lease-loss signal — which is what makes the assertion below mean
    // something rather than catching an incidental cancellation.
    const request = new AbortController();

    const nested = handler({
      name: "nested-step",
      inputSchema: z.any(),
      outputSchema: z.object({ ended: z.string() }),
      execute: async (_input: unknown, ctx: BlockContext) =>
        new Promise<{ ended: string }>((resolve) => {
          if (ctx.signal?.aborted === true) return resolve({ ended: "already" });
          ctx.signal?.addEventListener("abort", () => resolve({ ended: "aborted" }), {
            once: true,
          });
          setTimeout(() => resolve({ ended: "timeout" }), 3_000);
        }),
    });

    const compositeWorker = sequencer({
      name: "composite-worker",
      inputSchema: z.any(),
    }).step(nested);

    // Settle the row out from under the worker while it runs. The next renewal
    // tick is refused, and that refusal is what aborts the lease-loss signal.
    setTimeout(() => void c.fail("t", "settled by someone else"), 50);

    const result = await runForTest(
      dispatchAndExecuteBlock({
        collection: c,
        dispatcher: shortLeaseDispatcher,
        workers: compositeWorker as never,
      }),
      undefined,
      installExecutionScope({
        signal: request.signal,
        // `executeBlock` keys a child's block-instance id off this.
        request: { identity: { id: "test-request" } },
      } as unknown as BlockContext)
    );

    expect(result.error).toBeUndefined();
    expect(result.claimed).toBe(true);
    expect((result.output as { ended: string }).ended).toBe("aborted");
  }, 20_000);
});


/**
 * A background task's context, faithful in the one respect these tests turn on:
 * `.work()` / `.workIf()` / `.forEachBackground()` all resolve their child
 * scope through an EXPLICIT `signalOverride` — the request's background signal
 * — rather than through the parent context's own signal.
 *
 * That signal is deliberately decoupled from transport teardown (FIX-663), so
 * it does not fire when a client disconnects. It is therefore the only thing
 * standing between a displaced worker's background tasks and running to
 * completion: if the lease-loss signal is *replaced* by the override instead of
 * composed with it, nothing aborts them.
 */
function withBackgroundSignal(ctx: BlockContext, bg: AbortSignal): BlockContext {
  return {
    ...ctx,
    _requestBackgroundSignal: bg,
    // With no request-scoped work pool, the sequencer awaits its own background
    // tasks and reports progress through `emit.status`. Nothing here asserts on
    // items, so a no-op emitter is enough to let that path run.
    emit: new Proxy({}, { get: () => () => undefined }),
  } as unknown as BlockContext;
}

interface Probe {
  ended: string;
}

/**
 * A background block that records how it ended. The result is read off a
 * closed-over marker rather than the sequencer's work slot, because what is
 * under test is the signal the task RAN under, not how its value is collected.
 */
function backgroundProbe(name: string, probe: Probe) {
  return handler({
    name,
    inputSchema: z.any(),
    outputSchema: z.object({ ended: z.string() }),
    execute: async (_input: unknown, ctx: BlockContext) => {
      const ended = await new Promise<string>((resolve) => {
        if (ctx.signal?.aborted === true) return resolve("already");
        ctx.signal?.addEventListener("abort", () => resolve("aborted"), {
          once: true,
        });
        setTimeout(() => resolve("timeout"), 2_000);
      });
      probe.ended = ended;
      return { ended };
    },
  });
}

describe("losing the claim stops BACKGROUND work too, not just nested steps", () => {
  // A worker that has lost its claim can record nothing — the substrate's write
  // fence refuses every ticket-fenced write it makes. Its background tasks are
  // therefore pure cost: generators still calling models, side effects still
  // firing, for output that will be thrown away. The nested-step case above was
  // closed by re-binding the execution scope; these three forms were not,
  // because each supplies an explicit `signalOverride` and the re-bind deferred
  // to it instead of composing with it.
  //
  // One test per form on purpose. That is exactly the shape of the miss — a
  // single representative case would have passed while the other two stayed
  // broken.

  async function runBackgroundWorker(compositeWorker: unknown, probe: Probe) {
    const c = buildCollection();
    await c.addTask({ id: "t", goal: "expensive work" });

    // Neither of these ever fires on its own, so the lease-loss signal is the
    // only thing that can end the probe.
    const request = new AbortController();
    const background = new AbortController();

    // Settle the row out from under the worker while it runs. The next renewal
    // tick is refused, and that refusal aborts the lease-loss signal.
    setTimeout(() => void c.fail("t", "settled by someone else"), 50);

    const result = await runForTest(
      dispatchAndExecuteBlock({
        collection: c,
        dispatcher: shortLeaseDispatcher,
        workers: compositeWorker as never,
      }),
      undefined,
      withBackgroundSignal(
        installExecutionScope({
          signal: request.signal,
          request: { identity: { id: "test-request" } },
        } as unknown as BlockContext),
        background.signal
      )
    );

    expect(result.error).toBeUndefined();
    return probe;
  }

  it("aborts a .work() task when the claim is lost", async () => {
    const probe: Probe = { ended: "never-ran" };
    const worker = sequencer({ name: "work-worker", inputSchema: z.any() })
      .work(backgroundProbe("bg-work", probe))
      .map(() => ({ done: true }));

    expect((await runBackgroundWorker(worker, probe)).ended).toBe("aborted");
  }, 20_000);

  it("aborts a .workIf() task when the claim is lost", async () => {
    const probe: Probe = { ended: "never-ran" };
    const worker = sequencer({ name: "workif-worker", inputSchema: z.any() })
      .workIf(() => true, backgroundProbe("bg-workif", probe))
      .map(() => ({ done: true }));

    expect((await runBackgroundWorker(worker, probe)).ended).toBe("aborted");
  }, 20_000);

  it("aborts a .forEachBackground() task when the claim is lost", async () => {
    const probe: Probe = { ended: "never-ran" };
    const worker = sequencer({ name: "feb-worker", inputSchema: z.any() })
      .map(() => [1])
      .forEachBackground(backgroundProbe("bg-feb", probe))
      .map(() => ({ done: true }));

    expect((await runBackgroundWorker(worker, probe)).ended).toBe("aborted");
  }, 20_000);
});


describe("renewal covers the result write, not just the worker", () => {
  // `complete()` and `fail()` are fenced on the worker's claim ticket, and the
  // fence refuses a write on a row whose lease has already lapsed. So the
  // moment renewal stops is the moment the worker's result becomes refusable.
  // Stopping when the worker returns leaves the settlement itself unprotected:
  // a lease that expires during one store round trip turns a HEALTHY worker's
  // finished work into a lost claim, the task is recovered, and every side
  // effect it already committed runs again. That is the duplicate work the
  // lease exists to prevent, produced by the lease.
  //
  // The assertion is the boundary itself — was renewal still asserting
  // liveness at the instant the fenced write began — rather than a race that
  // would only fail some of the time.

  /** Wraps a collection so each settlement records whether renewal was live. */
  function watchSettlements(inner: TaskCollectionRef, seen: string[]) {
    let live = false;
    const wrapped = {
      ...inner,
      renewLease: async (...args: Parameters<TaskCollectionRef["renewLease"]>) => {
        live = true;
        return inner.renewLease(...args);
      },
      complete: async (...args: Parameters<TaskCollectionRef["complete"]>) => {
        seen.push(`complete:${live ? "renewing" : "stopped"}`);
        return inner.complete(...args);
      },
      fail: async (...args: Parameters<TaskCollectionRef["fail"]>) => {
        seen.push(`fail:${live ? "renewing" : "stopped"}`);
        return inner.fail(...args);
      },
    } as unknown as TaskCollectionRef;
    return {
      collection: wrapped,
      /** Renewal is "live" once it has written at least once and not stopped. */
      markStopped: () => {
        live = false;
      },
    };
  }

  it("is still renewing when complete() is called", async () => {
    const inner = buildCollection();
    await inner.addTask({ id: "t", goal: "work" });
    const seen: string[] = [];
    const { collection, markStopped } = watchSettlements(inner, seen);

    // Slow enough that at least one renewal tick lands before the worker
    // returns, so "renewing" is a fact this run established rather than an
    // assumption about the driver's internals.
    const slowWorker = handler({
      name: "slow-worker",
      inputSchema: z.any(),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async () => {
        await new Promise((r) => setTimeout(r, 500));
        return { ok: true };
      },
    });

    const result = await runForTest(
      dispatchAndExecuteBlock({
        collection,
        dispatcher: shortLeaseDispatcher,
        workers: slowWorker as never,
      }),
      undefined,
      { signal: undefined } as unknown as BlockContext
    );
    markStopped();

    expect(result.error).toBeUndefined();
    expect(seen).toEqual(["complete:renewing"]);
    expect(inner.get("t")!.status).toBe("completed");
  }, 20_000);

  it("is still renewing when fail() is called", async () => {
    const inner = buildCollection();
    await inner.addTask({ id: "t", goal: "work" });
    const seen: string[] = [];
    const { collection } = watchSettlements(inner, seen);

    const slowThrower = handler({
      name: "slow-thrower",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async () => {
        await new Promise((r) => setTimeout(r, 500));
        throw new Error("boom");
      },
    });

    const result = await runForTest(
      dispatchAndExecuteBlock({
        collection,
        dispatcher: shortLeaseDispatcher,
        workers: slowThrower as never,
      }),
      undefined,
      { signal: undefined } as unknown as BlockContext
    );

    expect(result.error).toBe("boom");
    expect(seen).toEqual(["fail:renewing"]);
    expect(inner.get("t")!.status).toBe("errored");
  }, 20_000);
});


describe("a worker's background work survives transport teardown", () => {
  // The other half of the composition, and the one that is easy to break while
  // fixing the first. Background work is decoupled from the transport signal on
  // purpose (FIX-663): a client disconnecting must not kill work already in
  // flight. Lease loss is a different question with the opposite answer.
  //
  // Folding the worker's foreground signal — which is request + lease-loss —
  // into the background channel satisfies the lease half and silently breaks
  // this one, because the transport signal rides along. So the raw lease signal
  // is what the background channel gets.

  it("does NOT abort a .work() task when only the request signal fires", async () => {
    const c = buildCollection();
    await c.addTask({ id: "t", goal: "work" });

    const request = new AbortController();
    const background = new AbortController();
    const probe: Probe = { ended: "never-ran" };

    const worker = sequencer({ name: "bg-survives", inputSchema: z.any() })
      .work(backgroundProbe("bg-survives-task", probe))
      .map(() => ({ done: true }));

    // Transport teardown while the worker runs. The claim is untouched.
    setTimeout(() => request.abort(), 50);

    const result = await runForTest(
      dispatchAndExecuteBlock({
        collection: c,
        dispatcher: shortLeaseDispatcher,
        workers: worker as never,
      }),
      undefined,
      withBackgroundSignal(
        installExecutionScope({
          signal: request.signal,
          request: { identity: { id: "test-request" } },
        } as unknown as BlockContext),
        background.signal
      )
    );

    expect(result.error).toBeUndefined();
    // Ran to completion rather than being aborted by the disconnect.
    expect(probe.ended).toBe("timeout");
  }, 20_000);

  it("still aborts it when the CLAIM is lost", async () => {
    // The control, so the test above cannot pass by the signal simply never
    // reaching the task at all.
    const c = buildCollection();
    await c.addTask({ id: "t", goal: "work" });

    const request = new AbortController();
    const background = new AbortController();
    const probe: Probe = { ended: "never-ran" };

    const worker = sequencer({ name: "bg-stops", inputSchema: z.any() })
      .work(backgroundProbe("bg-stops-task", probe))
      .map(() => ({ done: true }));

    setTimeout(() => void c.fail("t", "settled by someone else"), 50);

    const result = await runForTest(
      dispatchAndExecuteBlock({
        collection: c,
        dispatcher: shortLeaseDispatcher,
        workers: worker as never,
      }),
      undefined,
      withBackgroundSignal(
        installExecutionScope({
          signal: request.signal,
          request: { identity: { id: "test-request" } },
        } as unknown as BlockContext),
        background.signal
      )
    );

    expect(result.error).toBeUndefined();
    expect(probe.ended).toBe("aborted");
  }, 20_000);
});
