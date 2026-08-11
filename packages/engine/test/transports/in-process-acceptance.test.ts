/**
 * The two milestones an in-process dispatch reports ahead of completion
 * (FIX-982).
 *
 * `dispatchLocal` calls `runAction`, which is async — so it returns while the
 * run is still at its first await. The handle alone is not evidence of
 * anything, and the two things a caller might want to know are not the same
 * fact:
 *
 * - **`accepted`** — the request is registered and discoverable. One write.
 *   This is what an HTTP ack needs, and it must stay cheap: waiting any longer
 *   would hold the response across author-supplied work.
 * - **`started`** — the run reached execution. Between the two it still writes
 *   the session's `latestRequestId`, emits its opening events, builds a context
 *   that loads the flow's eager resources, and runs `request.onStarted`. A
 *   failure anywhere in there records nothing terminal and deregisters the
 *   entry on the way out, so the request leaves no trace — while a failure
 *   after it is a durable `failed`.
 *
 * The distinction is load-bearing for the caller that has no `finished` to fall
 * back on. A detached spawn releases a claimed task on the strength of the
 * dispatch; if it releases on `accepted` and setup then dies, nothing settles
 * the row, nothing records the failure, and the task reads as live background
 * work that is simply not moving until lease recovery finds it. So the tests
 * below fail a *real* step of the run after registration has committed, rather
 * than stubbing the boundary itself.
 */
import { describe, it, expect } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  createFlowRegistry,
  createInMemoryStores,
  createInboundTransportHost,
  defaultBodyUserIdPrincipalResolver
} from "../../src";
import type { ActiveRequestEntry, SessionRecord } from "../../src/stores/types";

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * A host whose one action parks forever until released, so "the run has not
 * finished" is a fact rather than a timing hope.
 */
function buildHost(options?: {
  /** Replace the registry write, to hold or fail the registration. */
  onRegister?: (
    entry: ActiveRequestEntry,
    real: (entry: ActiveRequestEntry) => Promise<void>
  ) => Promise<void>;
  /**
   * Replace the session read. `runAction` does this immediately AFTER
   * registration commits, to update `latestRequestId` — the first real setup
   * step in the window between the two milestones.
   */
  onSessionGet?: (key: string) => Promise<SessionRecord | undefined>;
}) {
  const registry = createFlowRegistry();
  const stores = createInMemoryStores();
  // Created up front, not when the block reaches it: acceptance lands long
  // before the block runs, so a gate minted on arrival would not exist yet when
  // the test releases it.
  let releaseRun: () => void = () => {};
  const runGate = new Promise<void>((resolve) => {
    releaseRun = resolve;
  });
  let ran = 0;

  registry.register(
    defineFlow({
      kind: "acceptance",
      actions: {
        run: {
          inputSchema: z.object({ value: z.string() }),
          block: handler<{ value: string }, { ok: true }>({
            name: "acceptance-run",
            execute: async () => {
              ran += 1;
              await runGate;
              return { ok: true };
            }
          })
        }
      }
    })({ id: "acceptance" })
  );

  if (options?.onRegister !== undefined) {
    const real = stores.activeRequests.register.bind(stores.activeRequests);
    stores.activeRequests.register = (entry: ActiveRequestEntry): Promise<void> =>
      options.onRegister!(entry, real);
  }
  if (options?.onSessionGet !== undefined) {
    stores.session.get = (key: string): Promise<SessionRecord | undefined> =>
      options.onSessionGet!(key);
  }

  const host = createInboundTransportHost({
    registry,
    stores,
    resolvePrincipal: defaultBodyUserIdPrincipalResolver,
    runtimeConfig: {}
  });

  return {
    host,
    stores,
    ranCount: () => ran,
    release: () => releaseRun(),
    envelope: {
      source: "http" as const,
      flowKind: "acceptance",
      action: "run",
      input: { value: "a" },
      sessionId: "s_accept",
      principal: { userId: "u_1" }
    }
  };
}

describe("in-process dispatch separates acceptance from completion", () => {
  it("accepts while the run is still in flight, with the request already discoverable", async () => {
    const h = buildHost();
    const handle = h.host.dispatch(h.envelope);

    expect(handle.accepted).toBeDefined();

    // The run cannot finish — it is parked — so acceptance winning this race is
    // the only way the assertion passes. An acceptance signal that settles with
    // the run would land on "neither" here, which is exactly the state a caller
    // that must not await the work is in.
    const first = await Promise.race([
      handle.accepted!.then(() => "accepted" as const),
      handle.finished.then(() => "finished" as const),
      wait(500).then(() => "neither" as const)
    ]);
    expect(first).toBe("accepted");

    // And "accepted" means the entry recovery and the stale sweeper key off is
    // committed — not that we intended to write it.
    const entry = await h.stores.activeRequests.get(handle.requestId);
    expect(entry?.requestId).toBe(handle.requestId);

    h.release();
    await handle.finished;
  });

  it("does not accept before the registration write commits", async () => {
    let releaseRegister: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      releaseRegister = resolve;
    });
    const h = buildHost({
      onRegister: async (entry, real) => {
        await held;
        return real(entry);
      }
    });

    const handle = h.host.dispatch(h.envelope);

    // Held open: the request is not discoverable yet, so acceptance must not
    // have been reported.
    const early = await Promise.race([
      handle.accepted!.then(() => "accepted" as const),
      wait(50).then(() => "pending" as const)
    ]);
    expect(early).toBe("pending");
    expect(h.ranCount()).toBe(0);

    releaseRegister();
    await handle.accepted;
    expect(await h.stores.activeRequests.get(handle.requestId)).toBeDefined();

    h.release();
    await handle.finished;
  });

  it("rejects acceptance when the registration fails, instead of only failing the run", async () => {
    // The failure a fire-and-forget caller cannot see any other way: it is not
    // holding `finished`, and the host marks that rejection handled. Without
    // acceptance the dispatch reports success and the run quietly does not
    // exist.
    const h = buildHost({
      onRegister: async () => {
        throw new Error("registry write failed");
      }
    });

    const handle = h.host.dispatch(h.envelope);

    await expect(handle.accepted).rejects.toThrow(/registry write failed/);
    await expect(handle.finished).rejects.toThrow(/registry write failed/);
    expect(h.ranCount()).toBe(0);
  });
});

describe("in-process dispatch reports execution separately from acceptance", () => {
  it("reaches started after accepted, and still while the run is in flight", async () => {
    const h = buildHost();
    const handle = h.host.dispatch(h.envelope);

    expect(handle.started).toBeDefined();

    // Order, not just presence: `started` is a strictly later fact, and a
    // `started` that resolved with `accepted` would be the same promise wearing
    // a second name — it would carry none of the setup window it exists to
    // cover.
    const order: string[] = [];
    handle.accepted!.then(() => order.push("accepted"));
    handle.started!.then(() => order.push("started"));

    const first = await Promise.race([
      handle.started!.then(() => "started" as const),
      handle.finished.then(() => "finished" as const),
      wait(500).then(() => "neither" as const)
    ]);
    // Still in flight: the block is parked, so this is execution having begun
    // rather than the run having ended.
    expect(first).toBe("started");
    expect(order).toEqual(["accepted", "started"]);
    expect(h.ranCount()).toBe(1);

    h.release();
    await handle.finished;
  });

  it("rejects started when setup fails after the request was already accepted", async () => {
    // THE WINDOW. Registration commits, so the request is discoverable and
    // `accepted` resolves — and then a real setup step fails. Nothing writes a
    // terminal record for it and the entry is deregistered on the way out, so a
    // caller that let go of work on `accepted` has handed it to a request that
    // now leaves no trace at all.
    //
    // The failing step is the session read `runAction` performs immediately
    // after registering, to update `latestRequestId`. An ordinary store outage,
    // not a contrived one.
    const h = buildHost({
      onSessionGet: async () => {
        throw new Error("session store unavailable");
      }
    });

    const handle = h.host.dispatch(h.envelope);

    // Accepted: the write that makes the request discoverable did land.
    await expect(handle.accepted).resolves.toBeUndefined();

    // But execution was never reached, and that is what a caller handing over
    // ownership has to learn.
    await expect(handle.started).rejects.toThrow(/session store unavailable/);
    await expect(handle.finished).rejects.toThrow(/session store unavailable/);
    expect(h.ranCount()).toBe(0);

    // The trace the window leaves behind, pinned so the cost of getting this
    // wrong stays visible: no terminal record, and the entry gone.
    const record = await h.stores.request.get(handle.requestId);
    expect(record).toBeUndefined();
    expect(await h.stores.activeRequests.get(handle.requestId)).toBeUndefined();
  });

  it("offers no started signal for a queued run, which cannot start inside this call", async () => {
    // A `queue` policy defers the start behind a concurrency key. Promising
    // execution there would mean promising to wait out the queue — and for a
    // detached child keyed on `user`, waiting for a run that cannot start until
    // its own caller returns. So the signal is absent and the caller falls back
    // to acceptance.
    const registry = createFlowRegistry();
    const stores = createInMemoryStores();
    let releaseRun: () => void = () => {};
    const runGate = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });

    registry.register(
      defineFlow({
        kind: "queued-start",
        actions: {
          run: {
            concurrency: "queue",
            inputSchema: z.object({ value: z.string() }),
            block: handler<{ value: string }, { ok: true }>({
              name: "queued-start-run",
              execute: async () => {
                await runGate;
                return { ok: true };
              }
            })
          }
        }
      })({ id: "queued-start" })
    );

    const host = createInboundTransportHost({
      registry,
      stores,
      resolvePrincipal: defaultBodyUserIdPrincipalResolver,
      runtimeConfig: {}
    });

    const handle = host.dispatch({
      source: "http" as const,
      flowKind: "queued-start",
      action: "run",
      input: { value: "a" },
      sessionId: "s_queued",
      principal: { userId: "u_1" }
    });

    expect(handle.started).toBeUndefined();
    // Acceptance is still offered — the enqueue-time writes are its own,
    // earlier milestone.
    await expect(handle.accepted).resolves.toBeUndefined();

    releaseRun();
    await handle.finished;
  });
});
