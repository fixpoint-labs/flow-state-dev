/**
 * FIX-1026 — a cancel that only the request store carries must stop a
 * composed run.
 *
 * `/abort` on a process that is not running the work records
 * `abortRequested` on the request record and returns 202; the process that
 * owns the run picks the intent up on its heartbeat tick and fires the same
 * controller a local `/abort` would. This scenario stages that split by
 * writing the flag through the same store verb the route uses
 * (`setFieldsIfStatus`) and never touching the in-process abort registry, so
 * the only path from the flag to a cancelled run is the poll.
 *
 * Lives here rather than only in `packages/engine/test/abort.test.ts`
 * because two of its claims emerge from full `runAction` composition, which
 * the engine tier's single-handler action cannot show:
 *
 *   1. Delivery reaches a background `.work()` task's SUBSTITUTED signal.
 *      Background tasks deliberately do not inherit the request's transport
 *      signal (FIX-663) — they are decoupled from it and re-attached to the
 *      registry fan-out. A store-delivered cancel therefore has to travel
 *      flag → poll → `abortRequest` → fan-out → background scope to reach
 *      one, and nothing shorter than a composed flow has such a scope.
 *   2. The chain stops. The generator step after the cancellation point
 *      never runs — the pathology the fix exists for is that a detached run
 *      kept calling the model, and kept spending, after the user pressed
 *      stop.
 *
 * The no-cancel control is what makes both falsifiable: the same flow
 * self-completes, so an `aborted` result cannot be a hang and a silent
 * generator cannot be a broken fixture.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { createInMemoryStores } from "@flow-state-dev/engine";
import type { StoreRegistry } from "@flow-state-dev/engine";
import { mockGenerator, testFlow } from "@flow-state-dev/testing";
import { z } from "zod";
import { findMessage, messageText } from "../helpers/assertions";

/** Poll cadence. Delivery latency is bounded by one tick. */
const HEARTBEAT_MS = 20;

type SignalMarker = { ran: boolean; abortedWhenDone: boolean };

/**
 * Blocks until `ctx.signal` fires, or gives up after `selfCompleteMs`.
 *
 * The give-up path is the falsifier. Without it a delivered cancel and a
 * test that simply hangs produce the same observation; with it, a delivery
 * failure surfaces as a `completed` request rather than a timeout.
 */
function waitForSignal(
  ctx: BlockContext,
  selfCompleteMs: number
): Promise<"aborted" | "self-completed"> {
  return new Promise((resolve) => {
    // `addEventListener` never fires for an already-aborted signal, and a
    // poll can deliver before this block starts.
    if (ctx.signal?.aborted === true) {
      resolve("aborted");
      return;
    }
    const timer = setTimeout(() => resolve("self-completed"), selfCompleteMs);
    ctx.signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve("aborted");
      },
      { once: true }
    );
  });
}

/** A background `.work()` task that records the state of its OWN signal. */
function backgroundTask(marker: SignalMarker, selfCompleteMs: number) {
  return handler({
    name: "background-task",
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
    execute: async (_input: unknown, ctx: BlockContext) => {
      await waitForSignal(ctx, selfCompleteMs);
      marker.ran = true;
      marker.abortedWhenDone = ctx.signal?.aborted ?? false;
      return null;
    }
  });
}

/**
 * The cancellation point: optionally records remote abort intent, then parks
 * until its signal fires.
 *
 * Recording is exactly the conditional write `handleAbortRequest` performs
 * before its `hasActiveAbortController` check, and nothing after it. On a
 * second process that check is false, so the route returns 202 having fired
 * nothing locally — the write alone is the faithful stand-in, and using the
 * real route handler in-process would take the 204 branch and defeat the
 * point of the scenario.
 */
function cancelPoint(options: {
  stores: StoreRegistry;
  record: boolean;
  accepted: { applied?: boolean };
  selfCompleteMs: number;
}) {
  return handler({
    name: "cancel-point",
    inputSchema: z.unknown(),
    outputSchema: z.string(),
    execute: async (_input: unknown, ctx: BlockContext) => {
      if (options.record) {
        const result = await options.stores.request.setFieldsIfStatus(
          ctx.request.identity.id,
          { abortRequested: true },
          ["in_progress"],
          Date.now()
        );
        options.accepted.applied = result.applied;
      }
      if ((await waitForSignal(ctx, options.selfCompleteMs)) === "aborted") {
        throw new DOMException("Aborted", "AbortError");
      }
      return "reached the model";
    }
  });
}

/** The step after the cancellation point — a real generator call. */
const afterCancel = generator({
  name: "after-cancel",
  model: "intent/chat",
  prompt: "Reply to the message.",
  inputSchema: z.string(),
  user: (input) => input,
  outputSchema: z.string(),
  itemVisibility: { client: true, history: true }
});

function buildFlow(options: {
  kind: string;
  stores: StoreRegistry;
  record: boolean;
  accepted: { applied?: boolean };
  marker: SignalMarker;
  selfCompleteMs: number;
}) {
  const root = sequencer({ name: "root", inputSchema: z.unknown() })
    .work(backgroundTask(options.marker, options.selfCompleteMs))
    .step(cancelPoint(options))
    .step(afterCancel);

  return defineFlow({
    kind: options.kind,
    request: { heartbeatIntervalMs: HEARTBEAT_MS },
    actions: { run: { block: root } }
  })({ id: "test" });
}

function runScenario(options: {
  kind: string;
  stores: StoreRegistry;
  record: boolean;
  accepted: { applied?: boolean };
  marker: SignalMarker;
  selfCompleteMs: number;
}) {
  return testFlow({
    flow: buildFlow(options),
    action: "run",
    userId: "u_xproc",
    input: undefined,
    stores: options.stores,
    generators: {
      "after-cancel": mockGenerator({
        name: "after-cancel",
        script: [{ text: "the model ran" }]
      })
    },
    unmockedGeneratorPolicy: "error"
  });
}

describe("FIX-1026: cross-process abort delivery through a composed flow", () => {
  it("stops the chain and settles aborted when only the store carries the intent", async () => {
    const stores = createInMemoryStores();
    const marker: SignalMarker = { ran: false, abortedWhenDone: false };
    const accepted: { applied?: boolean } = {};

    const result = await runScenario({
      kind: "xproc-abort-composed",
      stores,
      record: true,
      accepted,
      marker,
      // A ceiling, not a wait: delivery is expected within one tick, and
      // reaching this bound is the failure mode the control test pins.
      selfCompleteMs: 3_000
    });

    // Precondition — the remote cancel was accepted against a running
    // record, so a null result below would mean undelivered, not unasked.
    expect(accepted.applied).toBe(true);

    expect(result.status).toBe("aborted");

    // The model was never reached. This is the spend the fix exists to stop.
    expect(findMessage(result.items, "assistant")).toBeUndefined();

    // Delivery crossed into the background scope, whose signal is
    // substituted rather than inherited.
    expect(marker.ran).toBe(true);
    expect(marker.abortedWhenDone).toBe(true);

    const record = await stores.request.get(result.requestId);
    expect(record?.status).toBe("aborted");
    expect(record?.abortRequested).toBe(true);
  });

  it("runs to completion through the same chain when nothing records intent", async () => {
    const stores = createInMemoryStores();
    const marker: SignalMarker = { ran: false, abortedWhenDone: false };
    const accepted: { applied?: boolean } = {};

    const result = await runScenario({
      kind: "xproc-abort-control",
      stores,
      record: false,
      accepted,
      marker,
      // Always spent here — this is the give-up path.
      selfCompleteMs: 200
    });

    expect(accepted.applied).toBeUndefined();
    expect(result.status).toBe("completed");

    // The generator runs, so the previous test's silence is the cancel.
    const assistant = findMessage(result.items, "assistant");
    expect(assistant).toBeDefined();
    expect(messageText(assistant!)).toContain("the model ran");

    // The background signal stays clean, so the previous test's aborted
    // background signal is the cancel too.
    expect(marker.ran).toBe(true);
    expect(marker.abortedWhenDone).toBe(false);

    const record = await stores.request.get(result.requestId);
    expect(record?.status).toBe("completed");
    expect(record?.abortRequested).toBeUndefined();
  });
});
