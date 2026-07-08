/**
 * Tests for router resume behavior (FIX-814).
 *
 * On same-request continuation a router re-runs its `execute` selector (so any
 * per-call route wrapper is preserved) and validates the fresh selection
 * against the durably recorded `router_decision` — a mismatch is fatal, never
 * a silent branch switch. The selected child dispatches through the
 * `executeBlock` replay seam so a branch that already completed injects its
 * recorded output instead of re-executing, and the router's pass-through `ref`
 * output falls back to the prior run's trace id when the branch completed via
 * the replay short-circuit.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { handler, router, RouteUnavailableError } from "../../src";
import { buildReplayLog } from "../../src/blocks/internal/replay-log";
import type { RuntimeItem } from "../../src/items/internal";
import { createMockContext, runForTest } from "../helpers";

const REQ = "req_1"; // createMockContext's request id

function completedTrace(path: string, output: unknown): RuntimeItem {
  const blockInstanceId = `${REQ}:${path}:0`;
  return {
    id: `trace_${path}`,
    type: "block_trace",
    status: "completed",
    blockName: "h",
    blockKind: "handler",
    blockInstanceId,
    requestId: REQ,
    itemIndex: 0,
    provenance: { blockName: "h", blockInstanceId, phase: "main" },
    ts: 0,
    output: { kind: "inline", value: output },
  } as RuntimeItem;
}

function routerDecision(path: string, selectedRoute: string, itemIndex = 0): RuntimeItem {
  const blockInstanceId = `${REQ}:${path}:0`;
  return {
    id: `decision_${path}`,
    type: "router_decision",
    status: "completed",
    requestId: REQ,
    itemIndex,
    provenance: { blockName: "route", blockInstanceId, phase: "main" },
    ts: 0,
    routerName: "route",
    selectedRoute,
  } as RuntimeItem;
}

function routes() {
  const lowExecute = vi.fn(async () => "low");
  const highExecute = vi.fn(async () => "high");
  const low = handler({ name: "low", inputSchema: z.any(), outputSchema: z.any(), execute: lowExecute });
  const high = handler({ name: "high", inputSchema: z.any(), outputSchema: z.any(), execute: highExecute });
  return { low, high, lowExecute, highExecute };
}

describe("router decision replay (FIX-814)", () => {
  it("proceeds when the re-run selector matches the recorded decision", async () => {
    const { low, high, lowExecute } = routes();
    const block = router({ name: "route", routes: [low, high], execute: () => low });
    const ctx = createMockContext();
    // Router runs at the root path in a mock context; its decision is keyed there.
    (ctx as any)._replayLog = buildReplayLog([routerDecision("root", "low")]);

    await expect(runForTest(block, 1, ctx)).resolves.toBe("low");
    expect(lowExecute).toHaveBeenCalledOnce();
  });

  it("throws RouteUnavailableError when the selector re-decides differently on resume", async () => {
    const { low, high, lowExecute, highExecute } = routes();
    const block = router({ name: "route", routes: [low, high], execute: () => high });
    const ctx = createMockContext();
    (ctx as any)._replayLog = buildReplayLog([routerDecision("root", "low")]);

    const err = await runForTest(block, 1, ctx).then(
      () => undefined,
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(RouteUnavailableError);
    expect((err as RouteUnavailableError).details).toMatchObject({
      routerName: "route",
      recordedRoute: "low",
      reselectedRoute: "high",
      recordedRouteDeclared: true,
    });
    // Never a silent branch switch: neither branch ran.
    expect(lowExecute).not.toHaveBeenCalled();
    expect(highExecute).not.toHaveBeenCalled();
  });

  it("throws RouteUnavailableError when the recorded route no longer exists in the route table", async () => {
    const { low, high } = routes();
    const block = router({ name: "route", routes: [low, high], execute: () => low });
    const ctx = createMockContext();
    (ctx as any)._replayLog = buildReplayLog([routerDecision("root", "removedRoute")]);

    const err = await runForTest(block, 1, ctx).then(
      () => undefined,
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(RouteUnavailableError);
    expect((err as RouteUnavailableError).details.recordedRouteDeclared).toBe(false);
  });

  it("executes normally under a ReplayLog that has no recorded decision", async () => {
    const { low, high, lowExecute } = routes();
    const block = router({ name: "route", routes: [low, high], execute: () => low });
    const ctx = createMockContext();
    (ctx as any)._replayLog = buildReplayLog([]);

    await expect(runForTest(block, 1, ctx)).resolves.toBe("low");
    expect(lowExecute).toHaveBeenCalledOnce();
  });

  it("preserves a per-call connectInput wrapper when the recorded decision validates by name", async () => {
    const inner = vi.fn(async (input: { doubled: number }) => input.doubled);
    const low = handler({
      name: "low",
      inputSchema: z.object({ doubled: z.number() }),
      outputSchema: z.any(),
      execute: inner,
    });
    const block = router({
      name: "route",
      routes: [low],
      // The wrapper is constructed per call — resume must re-run `execute` to
      // rebuild it, and validate by NAME (the wrapper keeps the route's name).
      execute: () => low.connectInput((n: number) => ({ doubled: n * 2 })),
    });
    const ctx = createMockContext();
    (ctx as any)._replayLog = buildReplayLog([routerDecision("root", "low")]);

    await expect(runForTest(block, 21, ctx)).resolves.toBe(42);
    expect(inner).toHaveBeenCalledWith({ doubled: 42 }, expect.anything());
  });
});

describe("router branch replay seam (FIX-814)", () => {
  it("injects a completed selected branch from the log without re-running it", async () => {
    const { low, high, lowExecute } = routes();
    const block = router({ name: "route", routes: [low, high], execute: () => low });
    const ctx = createMockContext();
    (ctx as any)._replayLog = buildReplayLog([
      routerDecision("root", "low"),
      completedTrace("root/branch[low]", "recorded-output"),
    ]);

    await expect(runForTest(block, 1, ctx)).resolves.toBe("recorded-output");
    expect(lowExecute).not.toHaveBeenCalled();
  });

  it("restores the pass-through ref output from the recorded trace id when the branch was replayed", async () => {
    const { low, high } = routes();
    const block = router({ name: "route", routes: [low, high], execute: () => low });
    const ctx = createMockContext();
    (ctx as any)._replayLog = buildReplayLog([
      completedTrace("root/branch[low]", "recorded-output"),
    ]);

    await runForTest(block, 1, ctx);

    // The replay short-circuit emits no fresh block_trace, so the current
    // response holds nothing to ref — the router must fall back to the prior
    // run's recorded trace id to keep the FIX-413 ref contract.
    expect((ctx as any)._blockOutputHint).toEqual({
      kind: "ref",
      sourceItemId: "trace_root/branch[low]",
    });
  });

  it("awaits the onRouteSelected decision anchor before dispatching the branch", async () => {
    const order: string[] = [];
    const low = handler({
      name: "low",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async () => {
        order.push("branch-run");
        return "low";
      },
    });
    const block = router({ name: "route", routes: [low], execute: () => low });
    const ctx = createMockContext();
    (ctx as any)._runtimeHooks = {
      onRouteSelected: () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            order.push("decision-durable");
            resolve();
          }, 10);
        }),
    };

    await runForTest(block, 1, ctx);

    // The suspension race (round-5): the branch must not start before the
    // router_decision anchor's write settles.
    expect(order).toEqual(["decision-durable", "branch-run"]);
  });
});

describe("router route-name uniqueness (FIX-814)", () => {
  it("rejects two different blocks sharing a route name at build time", () => {
    const a = handler({ name: "same", inputSchema: z.any(), outputSchema: z.any(), execute: async () => "a" });
    const b = handler({ name: "same", inputSchema: z.any(), outputSchema: z.any(), execute: async () => "b" });

    expect(() =>
      router({ name: "dup-routes", routes: [a, b], execute: () => a })
    ).toThrow(/duplicate route name "same"/);
  });

  it("tolerates the same block listed twice (reference-equal aliasing is unambiguous)", async () => {
    const shared = handler({ name: "shared", inputSchema: z.any(), outputSchema: z.any(), execute: async () => "ok" });

    const block = router({
      name: "aliased-routes",
      routes: [shared, shared],
      execute: () => shared,
    });

    const ctx = createMockContext();
    await expect(runForTest(block, 1, ctx)).resolves.toBe("ok");
  });
});
