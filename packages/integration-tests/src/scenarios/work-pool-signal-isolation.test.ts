/**
 * FIX-663 — background work signal isolation.
 *
 * `.work()` background tasks must be decoupled from the request's
 * transport-level abort signal. They survive transport teardown (a fired
 * `options.signal`, e.g. client disconnect / SSE close) but still abort on
 * explicit user-requested cancellation (the `/abort` endpoint, modelled here
 * by `abortRequest(requestId)`).
 *
 * Each test dispatches a slow `.work()` task, fires one of the two signals
 * from inside the main chain while the task is still in flight, then lets the
 * request drain. The background handler records whether ITS `ctx.signal` was
 * aborted by the time it finished — that is the signal substituted by the
 * sequencer DSL.
 *
 * The nested-sequencer case is the critical regression guard: it proves the
 * background signal propagates through `_withExecutionScope` to descendant
 * scopes. If propagation only reached one level, the deeply-nested handler
 * would inherit the (transport-aborted) root signal via closure capture and
 * the assertion would flip.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core";
import {
  runAction,
  abortRequest,
  createInMemoryStores
} from "@flow-state-dev/server";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { z } from "zod";

interface TaskMarker {
  ran: boolean;
  abortedWhenDone: boolean;
}

const SLOW_MS = 200;

/**
 * A background handler that waits ~SLOW_MS but resolves early if its signal
 * aborts, then records whether the signal was aborted when it finished.
 */
function slowTask(name: string, marker: TaskMarker) {
  return handler({
    name,
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
    execute: async (_input: unknown, ctx: BlockContext) => {
      await new Promise<void>((resolve) => {
        if (ctx.signal?.aborted) {
          resolve();
          return;
        }
        const timer = setTimeout(resolve, SLOW_MS);
        ctx.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true }
        );
      });
      marker.ran = true;
      marker.abortedWhenDone = ctx.signal?.aborted ?? false;
      return null;
    }
  });
}

/** Fires `options.signal` (transport-shape abort) from inside the chain. */
function fireTransport(controller: AbortController) {
  return handler({
    name: "fire-transport",
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
    execute: async () => {
      controller.abort();
      return null;
    }
  });
}

/** Fires the abort registry (explicit `/abort`) for the current request. */
const fireExplicitAbort = handler({
  name: "fire-explicit-abort",
  inputSchema: z.unknown(),
  outputSchema: z.unknown(),
  execute: async (_input: unknown, ctx: BlockContext) => {
    abortRequest(ctx.request.identity.id);
    return null;
  }
});

async function runWith(rootBlock: ReturnType<typeof sequencer>, signal?: AbortSignal) {
  const flow = defineFlow({
    kind: "fix663-signal-isolation",
    actions: { run: { block: rootBlock } }
  })({ id: "test" });

  return runAction({
    flow,
    actionName: "run",
    userId: "u",
    input: undefined,
    signal,
    modelResolver: createMockModelResolver({ policy: "allow" }),
    stores: createInMemoryStores()
  });
}

describe("FIX-663: background work signal isolation", () => {
  it("transport-level abort (options.signal) does NOT abort background .work()", async () => {
    const marker: TaskMarker = { ran: false, abortedWhenDone: false };
    const transport = new AbortController();

    const root = sequencer({ name: "root", inputSchema: z.unknown() })
      .work(slowTask("bg", marker))
      .tap(fireTransport(transport));

    const result = await runWith(root, transport.signal);

    expect(result.error).toBeUndefined();
    expect(marker.ran).toBe(true);
    // Background task ran to completion with a clean (non-aborted) signal.
    expect(marker.abortedWhenDone).toBe(false);
  });

  it("explicit abort (abortRequest) DOES abort background .work()", async () => {
    const marker: TaskMarker = { ran: false, abortedWhenDone: false };

    const root = sequencer({ name: "root", inputSchema: z.unknown() })
      .work(slowTask("bg", marker))
      .tap(fireExplicitAbort);

    await runWith(root);

    expect(marker.ran).toBe(true);
    // The background signal fired via the registry fan-out, so the task's
    // own ctx.signal was aborted.
    expect(marker.abortedWhenDone).toBe(true);
  });

  it("background signal propagates through nested scopes (transport abort)", async () => {
    const marker: TaskMarker = { ran: false, abortedWhenDone: false };
    const transport = new AbortController();

    // A nested sequencer inside the .work() task. The slow handler lives two
    // scopes deep, so its ctx.signal is set only if the override propagated
    // through every _withExecutionScope, not just the first.
    const inner = sequencer({ name: "inner", inputSchema: z.unknown() })
      .then(slowTask("deep-bg", marker));
    const nested = sequencer({ name: "nested", inputSchema: z.unknown() })
      .then(inner);

    const root = sequencer({ name: "root", inputSchema: z.unknown() })
      .work(nested)
      .tap(fireTransport(transport));

    const result = await runWith(root, transport.signal);

    expect(result.error).toBeUndefined();
    expect(marker.ran).toBe(true);
    // The deeply-nested handler saw the background signal (clean), proving the
    // override threaded through every scope rather than reverting to the
    // transport-aborted root signal one level down.
    expect(marker.abortedWhenDone).toBe(false);
  });

  it("background signal propagates to nested scope under explicit abort", async () => {
    const marker: TaskMarker = { ran: false, abortedWhenDone: false };

    const inner = sequencer({ name: "inner", inputSchema: z.unknown() })
      .then(slowTask("deep-bg", marker));
    const nested = sequencer({ name: "nested", inputSchema: z.unknown() })
      .then(inner);

    const root = sequencer({ name: "root", inputSchema: z.unknown() })
      .work(nested)
      .tap(fireExplicitAbort);

    await runWith(root);

    expect(marker.ran).toBe(true);
    // Explicit abort still reaches the deepest scope.
    expect(marker.abortedWhenDone).toBe(true);
  });
});
