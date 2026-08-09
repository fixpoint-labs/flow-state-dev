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
