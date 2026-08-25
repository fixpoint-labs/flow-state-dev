/**
 * A carried action core cannot smuggle in an unroutable detached board
 * (FIX-982).
 *
 * A dynamic schedule (`schedules.resolve`) produces its handler block at
 * dispatch time, so that block is not reachable from the flow definition and
 * `defineFlow` never sees its declarations. If it contains a task board with a
 * detached worker, the board's routing never reached `flow.workstream` — and
 * nothing notices until the board has already claimed a row and tries to spawn.
 * Then `startDetached` refuses `no-workstream-core`, or the workstream core
 * routes on a `boardId` it has no route for, and the row either fails or cycles
 * through lease recovery.
 *
 * That is the class this epic keeps closing: work that stalls without erroring.
 * The refusal moves to the moment the core is adopted — before any block runs,
 * so before anything is claimed — where the predicate is exact: this core
 * declares a detached board, and this flow cannot route it.
 */
import { describe, it, expect } from "vitest";
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { declareWorkstreamBindings } from "@flow-state-dev/core/types";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z } from "zod";
import { createInMemoryStores, runAction } from "../../src";
import { createMockModelResolver } from "@flow-state-dev/testing";

const SCHEDULED_SOURCE = "scheduled";

/** A board-shaped block: a sequencer carrying a detached binding, as `taskBoard()` stamps. */
function stampedDrain(boardId: string, workerName: string) {
  const worker = handler({ name: workerName, execute: () => null });
  const runner = handler({ name: `runner-${boardId}`, execute: () => null });
  const drain = sequencer({ name: `drain-${workerName}` }).tap(
    handler({ name: `work-${workerName}`, execute: () => undefined })
  );
  declareWorkstreamBindings(drain as unknown as BlockDefinition, [
    {
      boardId,
      coordinateKey: `assignee|${workerName.length}:${workerName}`,
      worker: worker as unknown as BlockDefinition,
      runner: runner as unknown as BlockDefinition,
    },
  ]);
  return drain;
}

/** A flow that declares nothing detached — the case a resolver smuggles into. */
function plainFlow() {
  return defineFlow({
    kind: "carried-core",
    actions: {
      run: {
        inputSchema: z.object({}).passthrough(),
        block: handler({ name: "plain-action", execute: () => ({ ok: true }) }),
      },
    },
  } as never)({ id: "carried-core" });
}

const baseRuntimeConfig = () => ({ modelResolver: createMockModelResolver({}) });

function runCarried(flow: ReturnType<typeof plainFlow>, block: unknown) {
  return runAction({
    flow,
    actionName: "resolved-at-dispatch" as never,
    input: {},
    userId: "u_1",
    sessionId: "s_1",
    source: SCHEDULED_SOURCE,
    metadata: { schedule: { scheduleId: "nightly" } },
    resolvedActionCore: { block: block as never },
    stores: createInMemoryStores(),
    runtimeConfig: baseRuntimeConfig(),
  });
}

describe("a dispatch-time core carrying a detached board is refused by name", () => {
  // REJECTS rather than resolving with an `error`, and that is the right shape:
  // the core is adopted before the request is registered, so there is no record
  // to fail. The dispatch itself fails — nothing claimed, nothing written,
  // nothing left behind to recover.
  it("refuses when the flow declares no workstream core at all", async () => {
    await expect(
      runCarried(plainFlow(), stampedDrain("issue-work", "implement"))
    ).rejects.toThrow(/issue-work/);
  });

  it("names the worker, so the message points at what would not run", async () => {
    await expect(
      runCarried(plainFlow(), stampedDrain("issue-work", "implement"))
    ).rejects.toThrow(/implement/);
  });

  it("names the flow, so an operator knows which definition is missing the board", async () => {
    await expect(
      runCarried(plainFlow(), stampedDrain("issue-work", "implement"))
    ).rejects.toThrow(/carried-core/);
  });

  it("refuses a board mounted on the core's onCompleted observer", async () => {
    // `runAction` executes the observers as real blocks, so a board under one
    // claims work exactly as a board under the root does. Checking only
    // `core.block` left the observers as a way in.
    await expect(
      runAction({
        flow: plainFlow(),
        actionName: "resolved-at-dispatch" as never,
        input: {},
        userId: "u_1",
        sessionId: "s_1",
        source: SCHEDULED_SOURCE,
        metadata: { schedule: { scheduleId: "nightly" } },
        resolvedActionCore: {
          block: handler({ name: "ordinary-root", execute: () => ({ ok: true }) }) as never,
          onCompleted: stampedDrain("issue-work", "implement") as never,
        },
        stores: createInMemoryStores(),
        runtimeConfig: baseRuntimeConfig(),
      })
    ).rejects.toThrow(/issue-work/);
  });

  it("refuses a board mounted on the core's onErrored observer", async () => {
    await expect(
      runAction({
        flow: plainFlow(),
        actionName: "resolved-at-dispatch" as never,
        input: {},
        userId: "u_1",
        sessionId: "s_1",
        source: SCHEDULED_SOURCE,
        metadata: { schedule: { scheduleId: "nightly" } },
        resolvedActionCore: {
          block: handler({ name: "ordinary-root-2", execute: () => ({ ok: true }) }) as never,
          onErrored: stampedDrain("issue-work", "implement") as never,
        },
        stores: createInMemoryStores(),
        runtimeConfig: baseRuntimeConfig(),
      })
    ).rejects.toThrow(/issue-work/);
  });

  it("allows a carried core whose board the flow already routes", async () => {
    // THE CONTROL, and the reason the check compares bindings rather than
    // merely asking "does this core carry any". A resolver may legitimately
    // return a core built around a board the flow also declares statically —
    // refusing that would outlaw the combination rather than the hole.
    const drain = stampedDrain("issue-work", "implement");
    const flow = defineFlow({
      kind: "carried-core",
      actions: {
        run: { inputSchema: z.object({}).passthrough(), block: drain },
      },
    } as never)({ id: "carried-core" });

    const result = await runCarried(flow as never, drain);
    expect(result.error?.message ?? "").not.toMatch(/cannot route the detached/);
  });

  it("leaves a carried core that declares nothing detached alone", async () => {
    const result = await runCarried(
      plainFlow(),
      handler({ name: "ordinary-scheduled-handler", execute: () => ({ ok: true }) })
    );
    expect(result.error).toBeUndefined();
  });
});
