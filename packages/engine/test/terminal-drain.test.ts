/**
 * FIX-1001 — a request must not report itself finished while its own
 * background work is still writing.
 *
 * The success path already drains the request work pool before writing its
 * terminal record. The three failure paths (`failed` / `interrupted` /
 * `aborted`) wrote their record and returned with the pool still running, so
 * on an ephemeral host (Vercel `waitUntil`, Next `after()`, Lambda) the
 * container could freeze with a memory write in flight.
 *
 * The load-bearing assertion in every path test below is that `runAction` has
 * **not settled** while a `.work()` task is still parked on a test-controlled
 * gate. Asserting only "the record says failed" or "the task eventually ran"
 * passes with or without the drain — the task would finish on its own a
 * microsecond later. Parking the task and proving the run is still pending is
 * what makes the drain observable.
 */
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import type { SpeakChunk, VoiceProvider } from "@flow-state-dev/core/types";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { createInMemoryStores, runAction } from "../src";
import { detectInterruptedRequests } from "../src/execution/request-recovery";
import { handleAbortRequest } from "../src/routes/abort-routes";



type Deferred<T = void> = { promise: Promise<T>; resolve: (value: T) => void };
function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Let queued microtasks and timers land before snapshotting. */
async function flush(ticks = 3): Promise<void> {
  for (let i = 0; i < ticks; i += 1) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

/**
 * Track settlement of an in-flight `runAction` without awaiting it, so a test
 * can assert the run is still pending while a background task is parked.
 */
function trackSettlement(promise: Promise<unknown>): () => boolean {
  let settled = false;
  void promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    }
  );
  return () => settled;
}

/**
 * A background task parked on a gate, plus the flow that queues it and then
 * drives the request to a terminal outcome.
 *
 * `outcome` selects how the request ends:
 *  - `throw`   → the failure path (`failed`)
 *  - `park`    → the step waits on `ctx.signal`, so the caller's abort of the
 *                composed signal produces `aborted` or `interrupted` depending
 *                on whether `abortRequested` is set on the record.
 *  - `succeed` → the success path (`completed`), the control case.
 */
function buildFlow(options: {
  kind: string;
  outcome: "throw" | "park" | "succeed";
  gate: Promise<void>;
  onBackgroundDone: () => void;
  onBackgroundStart?: () => void;
  heartbeatIntervalMs?: number;
}) {
  const background = handler({
    name: "background",
    inputSchema: z.any(),
    outputSchema: z.any(),
    execute: async () => {
      options.onBackgroundStart?.();
      await options.gate;
      options.onBackgroundDone();
      return { ok: true };
    }
  });

  const main = handler({
    name: "main",
    inputSchema: z.any(),
    outputSchema: z.any(),
    execute: async (_input, ctx) => {
      if (options.outcome === "throw") {
        throw new Error("main step boom");
      }
      if (options.outcome === "park") {
        await new Promise((_resolve, reject) => {
          ctx.signal.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }
      return { ok: true };
    }
  });

  return defineFlow({
    kind: options.kind,
    ...(options.heartbeatIntervalMs !== undefined
      ? { request: { heartbeatIntervalMs: options.heartbeatIntervalMs } }
      : {}),
    actions: {
      run: {
        inputSchema: z.any(),
        block: sequencer({ name: "seq" }).work(background).step(main)
      }
    }
  })();
}

describe("FIX-1001 — terminal paths drain background work before writing the record", () => {
  it("failure path: runAction stays pending while a background task is parked", async () => {
    const gate = deferred();
    let backgroundDone = false;
    const stores = createInMemoryStores();

    const flow = buildFlow({
      kind: "drain-failed",
      outcome: "throw",
      gate: gate.promise,
      onBackgroundDone: () => {
        backgroundDone = true;
      }
    });

    const runPromise = runAction({
      flow,
      actionName: "run",
      input: {},
      requestId: "req_drain_failed",
      userId: "u1",
      sessionId: "s1",
      stores,
      runtimeConfig: {}
    });
    const hasSettled = trackSettlement(runPromise);

    // The main step has thrown by now; the background task is parked.
    await flush();
    // A real macrotask tick, so a no-drain regression has every chance to
    // settle the run before we assert it has not.
    await new Promise((r) => setTimeout(r, 10));

    expect(backgroundDone).toBe(false);
    // THE assertion: without the drain, runAction has already written `failed`
    // and returned while this task is still running.
    expect(hasSettled()).toBe(false);
    // And the record must not be terminal yet either.
    expect((await stores.request.get("req_drain_failed"))?.status).toBe("in_progress");

    gate.resolve();
    await runPromise;

    expect(backgroundDone).toBe(true);
    expect((await stores.request.get("req_drain_failed"))?.status).toBe("failed");
  });

  it("disconnect path: runAction stays pending while a background task is parked", async () => {
    const gate = deferred();
    let backgroundDone = false;
    const stores = createInMemoryStores();
    const transport = new AbortController();

    const flow = buildFlow({
      kind: "drain-interrupted",
      outcome: "park",
      gate: gate.promise,
      onBackgroundDone: () => {
        backgroundDone = true;
      }
    });

    const runPromise = runAction({
      flow,
      actionName: "run",
      input: {},
      requestId: "req_drain_interrupted",
      userId: "u1",
      sessionId: "s1",
      signal: transport.signal,
      stores,
      runtimeConfig: {}
    });
    const hasSettled = trackSettlement(runPromise);

    await flush();
    // Client went away: no `abortRequested` flag, so this classifies as
    // `interrupted`, not `aborted`.
    transport.abort();
    await flush();
    await new Promise((r) => setTimeout(r, 10));

    expect(backgroundDone).toBe(false);
    expect(hasSettled()).toBe(false);
    expect((await stores.request.get("req_drain_interrupted"))?.status).toBe("in_progress");

    gate.resolve();
    await runPromise;

    expect(backgroundDone).toBe(true);
    expect((await stores.request.get("req_drain_interrupted"))?.status).toBe("interrupted");
  });

  it("abort path: runAction stays pending while a background task is parked", async () => {
    const gate = deferred();
    let backgroundDone = false;
    const stores = createInMemoryStores();
    const transport = new AbortController();

    const flow = buildFlow({
      kind: "drain-aborted",
      outcome: "park",
      gate: gate.promise,
      onBackgroundDone: () => {
        backgroundDone = true;
      }
    });

    const runPromise = runAction({
      flow,
      actionName: "run",
      input: {},
      requestId: "req_drain_aborted",
      userId: "u1",
      sessionId: "s1",
      signal: transport.signal,
      stores,
      runtimeConfig: {}
    });
    const hasSettled = trackSettlement(runPromise);

    await flush();
    // Explicit stop: durable intent recorded, then the signal fires.
    await stores.request.setFieldsIfStatus(
      "req_drain_aborted",
      { abortRequested: true },
      ["in_progress"],
      Date.now()
    );
    transport.abort();
    await flush();
    await new Promise((r) => setTimeout(r, 10));

    expect(backgroundDone).toBe(false);
    expect(hasSettled()).toBe(false);

    gate.resolve();
    await runPromise;

    expect(backgroundDone).toBe(true);
    expect((await stores.request.get("req_drain_aborted"))?.status).toBe("aborted");
  });

  it("multi-instance abort: intent delivered by the poll, not a local controller", async () => {
    // The 202 path — another instance accepted the stop, so `abortRequested`
    // is on the record but this process's abort controller was never fired
    // locally. `pollAbortIntent` (on the heartbeat timer) is what delivers it.
    // This is the variant the background signal never covered, so it is the
    // one that justifies draining the abort branch at all.
    const gate = deferred();
    let backgroundDone = false;
    const stores = createInMemoryStores();

    const flow = buildFlow({
      kind: "drain-aborted-remote",
      outcome: "park",
      gate: gate.promise,
      heartbeatIntervalMs: 20,
      onBackgroundDone: () => {
        backgroundDone = true;
      }
    });

    const runPromise = runAction({
      flow,
      actionName: "run",
      input: {},
      requestId: "req_drain_remote",
      userId: "u1",
      sessionId: "s1",
      stores,
      runtimeConfig: {}
    });
    const hasSettled = trackSettlement(runPromise);

    await flush();
    // No local `abortController.abort()` — only the durable flag.
    await stores.request.setFieldsIfStatus(
      "req_drain_remote",
      { abortRequested: true },
      ["in_progress"],
      Date.now()
    );

    // Let the heartbeat poll pick the intent up and fire the controller.
    await new Promise((r) => setTimeout(r, 80));

    expect(backgroundDone).toBe(false);
    expect(hasSettled()).toBe(false);

    gate.resolve();
    await runPromise;

    expect(backgroundDone).toBe(true);
    expect((await stores.request.get("req_drain_remote"))?.status).toBe("aborted");
  });

  it("success path is unchanged (control)", async () => {
    const gate = deferred();
    let backgroundDone = false;
    const stores = createInMemoryStores();

    const flow = buildFlow({
      kind: "drain-completed",
      outcome: "succeed",
      gate: gate.promise,
      onBackgroundDone: () => {
        backgroundDone = true;
      }
    });

    const runPromise = runAction({
      flow,
      actionName: "run",
      input: {},
      requestId: "req_drain_completed",
      userId: "u1",
      sessionId: "s1",
      stores,
      runtimeConfig: {}
    });
    const hasSettled = trackSettlement(runPromise);

    await flush();
    await new Promise((r) => setTimeout(r, 10));

    expect(hasSettled()).toBe(false);

    gate.resolve();
    await runPromise;

    expect(backgroundDone).toBe(true);
    expect((await stores.request.get("req_drain_completed"))?.status).toBe("completed");
  });
});

describe("FIX-1001 — the drain runs to quiescence, not one pass", () => {
  it("awaits work queued by a task that is itself being drained", async () => {
    // The only test that separates a quiescence loop from a single
    // `drainAll()` — and it only separates them if the nested task is queued
    // AFTER the drain's first splice. A nested `.work()` dispatched before the
    // terminal drain begins is already in `entries` and a single pass catches
    // it, which makes the obvious version of this test pass either way.
    //
    // So the outer task parks first: the drain splices [outer] and blocks on
    // it, and only then is the outer released to queue the grandchild. That
    // lands in the pool after the splice. One pass returns with the grandchild
    // still parked; the loop takes a second pass and finds it.
    const outerGate = deferred();
    const grandchildGate = deferred();
    let grandchildDone = false;
    const stores = createInMemoryStores();

    const waitForOuterGate = handler({
      name: "wait-outer",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async () => {
        await outerGate.promise;
        return { ok: true };
      }
    });

    const grandchild = handler({
      name: "grandchild",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async () => {
        await grandchildGate.promise;
        grandchildDone = true;
        return { ok: true };
      }
    });

    // The background task is itself a sequencer: it parks on its first step,
    // and dispatches `.work(grandchild)` into the same request-scoped pool
    // only once released — i.e. while the terminal drain is already running.
    const nesting = sequencer({ name: "nesting" }).step(waitForOuterGate).work(grandchild);

    const boom = handler({
      name: "boom",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async () => {
        throw new Error("main step boom");
      }
    });

    const flow = defineFlow({
      kind: "drain-nested",
      actions: {
        run: {
          inputSchema: z.any(),
          block: sequencer({ name: "seq" }).work(nesting).step(boom)
        }
      }
    })();

    const runPromise = runAction({
      flow,
      actionName: "run",
      input: {},
      requestId: "req_drain_nested",
      userId: "u1",
      sessionId: "s1",
      stores,
      runtimeConfig: {}
    });
    const hasSettled = trackSettlement(runPromise);

    // `boom` has thrown and the drain is now parked on the outer task, which
    // has not yet queued anything.
    await flush();
    await new Promise((r) => setTimeout(r, 10));
    expect(hasSettled()).toBe(false);

    // Release the outer task: it now queues the grandchild, after the first
    // pass already took its snapshot.
    outerGate.resolve();
    await flush();
    await new Promise((r) => setTimeout(r, 10));

    expect(grandchildDone).toBe(false);
    // A single-pass drain has returned by now and the request is terminal.
    expect(hasSettled()).toBe(false);

    grandchildGate.resolve();
    await runPromise;

    expect(grandchildDone).toBe(true);
    expect((await stores.request.get("req_drain_nested"))?.status).toBe("failed");
  });

  it("logs the failure of a task that settled before the drain began", async () => {
    // The case a `pendingCount() > 0` guard would skip entirely: the task is
    // no longer pending, but its entry is still in the pool carrying a failure
    // we owe a log line. The first drain pass is unconditional for this.
    const stores = createInMemoryStores();
    const errors: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args);
    });

    try {
      const failing = handler({
        name: "failing-bg",
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: async () => {
          throw new Error("background boom");
        }
      });
      const slowFail = handler({
        name: "main",
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: async () => {
          // Give the background task time to settle before we reach the drain.
          await new Promise((r) => setTimeout(r, 20));
          throw new Error("main step boom");
        }
      });

      const flow = defineFlow({
        kind: "drain-settled-early",
        actions: {
          run: {
            inputSchema: z.any(),
            block: sequencer({ name: "seq" }).work(failing).step(slowFail)
          }
        }
      })();

      await runAction({
        flow,
        actionName: "run",
        input: {},
        requestId: "req_drain_settled",
        userId: "u1",
        sessionId: "s1",
        stores,
        runtimeConfig: {}
      });

      expect((await stores.request.get("req_drain_settled"))?.status).toBe("failed");
      const logged = errors.some((args) =>
        args.some((a) => typeof a === "string" && a.includes('Background work "failing-bg" failed'))
      );
      expect(logged).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("FIX-1001 — orderings the drain forces", () => {
  it("keeps the heartbeat alive through the drain, so the recovery sweep leaves it alone", async () => {
    // The drain window is unbounded. If the heartbeat were still cleared on
    // the first line of the catch, the request would go stale during its own
    // drain and another process's sweep would write `interrupted` over a live
    // request — the same false terminal, relocated.
    const gate = deferred();
    const stores = createInMemoryStores();

    const flow = buildFlow({
      kind: "drain-heartbeat",
      outcome: "throw",
      gate: gate.promise,
      heartbeatIntervalMs: 10,
      onBackgroundDone: () => {}
    });

    const runPromise = runAction({
      flow,
      actionName: "run",
      input: {},
      requestId: "req_drain_heartbeat",
      userId: "u1",
      sessionId: "s1",
      stores,
      runtimeConfig: {}
    });
    const hasSettled = trackSettlement(runPromise);

    // Sit in the drain for several multiples of the stale threshold.
    await new Promise((r) => setTimeout(r, 150));
    expect(hasSettled()).toBe(false);

    const swept = await detectInterruptedRequests({ stores, staleThresholdMs: 40 });
    expect(swept.map((s) => s.requestId)).not.toContain("req_drain_heartbeat");
    expect((await stores.request.get("req_drain_heartbeat"))?.status).toBe("in_progress");

    gate.resolve();
    await runPromise;
    expect((await stores.request.get("req_drain_heartbeat"))?.status).toBe("failed");
  });

  it("writes the record before publishing the terminal event", async () => {
    // The defect is a client caching `in_progress`: it closes its stream on
    // the terminal event and immediately re-reads the record, and if the
    // record has not been patched yet there is nothing left to re-fetch.
    //
    // Asserting that from a live subscriber alone has no teeth — the in-memory
    // bus delivers on a later microtask, by which time the patch has landed
    // even when it was issued second, so the test passes with the ordering
    // inverted. (Verified: inverting the order leaves a subscriber-only
    // assertion green.) So the ordering is pinned at the two store seams the
    // client's two reads actually hit: `persistEvents`, which is what makes
    // the terminal event visible to a subscriber, and `set`, which is what
    // `patchRequestRecord` writes through.
    const gate = deferred();
    const stores = createInMemoryStores();
    const order: string[] = [];

    const realPersistEvents = stores.request.persistEvents.bind(stores.request);
    stores.request.persistEvents = (requestId, events) => {
      if (events.some((e) => e.type === "request.failed")) order.push("event");
      return realPersistEvents(requestId, events);
    };

    const realSet = stores.request.set.bind(stores.request);
    stores.request.set = async (id, record, expectedVersion) => {
      if ((record as { status?: string }).status === "failed") order.push("patch");
      return realSet(id, record as never, expectedVersion as never);
    };

    const flow = buildFlow({
      kind: "drain-record-first",
      outcome: "throw",
      gate: gate.promise,
      onBackgroundDone: () => {}
    });

    const runPromise = runAction({
      flow,
      actionName: "run",
      input: {},
      requestId: "req_drain_order",
      userId: "u1",
      sessionId: "s1",
      stores,
      runtimeConfig: {}
    });

    // A live subscriber too, to pin the user-visible consequence: at the
    // moment the terminal event arrives, a re-read already sees the record
    // terminal.
    let statusAtTerminalEvent: string | undefined;
    const watcher = (async () => {
      for await (const event of stores.request.subscribeToEvents("req_drain_order", {
        fromSequence: 0
      })) {
        if (event.type === "request.failed") {
          statusAtTerminalEvent = (await stores.request.get("req_drain_order"))?.status;
          break;
        }
      }
    })();

    await flush();
    gate.resolve();
    await runPromise;
    await watcher;

    // The teeth: the record was written before the news went out.
    expect(order).toEqual(["patch", "event"]);
    expect(statusAtTerminalEvent).toBe("failed");
  });

  it("terminalizes even when TTS teardown rejects", async () => {
    // Moving `ttsHook.cancel()` above the drain also moved it above the
    // terminal write. A rejection there would skip the drain AND the record
    // patch, leaving the request `in_progress` with its background work still
    // running — this issue's own defect, re-entering through the teardown
    // path. Tearing down synthesis nobody will receive must not decide
    // whether the request terminalizes.
    //
    // The rejection is produced the way a real provider produces it: the
    // pipeline cancels active iterators with `void it.return?.().catch(...)`,
    // so a *synchronous* throw from `return()` escapes before that `.catch`
    // is attached and surfaces as a rejection from `cancel()`.
    const gate = deferred();
    const stores = createInMemoryStores();

    const provider: VoiceProvider = {
      providerName: "throwing-teardown",
      abilities: { speak: false, speakStream: true, transcribe: false, listVoices: false },
      speakStream: () => ({
        [Symbol.asyncIterator]() {
          return {
            async next() {
              // Park so the iterator is still active when cancel() runs.
              await new Promise(() => {});
              return { done: true as const, value: undefined };
            },
            return(): never {
              throw new Error("iterator return exploded");
            }
          } as unknown as AsyncIterator<SpeakChunk>;
        }
      })
    };

    const speaking = handler({
      name: "speaking",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async (_input, ctx) => {
        // Assistant content is what feeds the TTS pipeline.
        ctx.emit.message([{ type: "output_text", text: "Hello there. This is spoken." }]);
        await new Promise((r) => setTimeout(r, 20));
        throw new Error("main step boom");
      }
    });

    const background = handler({
      name: "background",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async () => {
        await gate.promise;
        return { ok: true };
      }
    });

    const flow = defineFlow({
      kind: "drain-tts-teardown",
      voice: { tts: { model: "mock-tts", voice: "alloy" } },
      actions: {
        run: {
          inputSchema: z.any(),
          block: sequencer({ name: "seq" }).work(background).step(speaking)
        }
      }
    })();

    const runPromise = runAction({
      flow,
      actionName: "run",
      input: {},
      requestId: "req_drain_tts",
      userId: "u1",
      sessionId: "s1",
      stores,
      metadata: { voice: { ttsEnabled: true } },
      runtimeConfig: { voiceProvider: provider }
    });
    const hasSettled = trackSettlement(runPromise);

    await flush();
    await new Promise((r) => setTimeout(r, 30));

    // The drain still happened: the request is waiting on the parked task
    // rather than having blown past everything on the cancel rejection.
    expect(hasSettled()).toBe(false);

    gate.resolve();
    await runPromise;

    // And the record is terminal, not stranded `in_progress`.
    expect((await stores.request.get("req_drain_tts"))?.status).toBe("failed");
  });

  it("an abort accepted during the drain wins over the branch already chosen", async () => {
    // Decision 7. The branch is picked before a wait that now lasts as long as
    // the background work, and `/abort` keeps being accepted for all of it —
    // the record is still `in_progress`, so the endpoint applies and the user
    // is told the stop was accepted. Landing `failed` after that would be the
    // same lie this issue removes.
    const gate = deferred();
    const stores = createInMemoryStores();

    const flow = buildFlow({
      kind: "drain-late-abort",
      outcome: "throw",
      gate: gate.promise,
      onBackgroundDone: () => {}
    });

    const runPromise = runAction({
      flow,
      actionName: "run",
      input: {},
      requestId: "req_drain_late_abort",
      userId: "u1",
      sessionId: "s1",
      stores,
      runtimeConfig: {}
    });
    const hasSettled = trackSettlement(runPromise);

    // The main step has thrown: the run is routed into the `failed` branch and
    // is now parked in the drain.
    await flush();
    await new Promise((r) => setTimeout(r, 10));
    expect(hasSettled()).toBe(false);

    // The user hits stop, mid-drain. The endpoint accepts it, because the
    // record is still in progress.
    const response = await handleAbortRequest(
      new Request(
        "http://localhost/api/flows/drain-late-abort/requests/req_drain_late_abort/abort",
        { method: "POST" }
      ),
      {
        kind: "abort_request",
        flowKind: "drain-late-abort",
        requestId: "req_drain_late_abort"
      },
      { stores }
    );
    expect([202, 204]).toContain(response.status);

    gate.resolve();
    await runPromise;

    // Accepted stop wins over the in-flight `failed` classification.
    expect((await stores.request.get("req_drain_late_abort"))?.status).toBe("aborted");
  });
});
