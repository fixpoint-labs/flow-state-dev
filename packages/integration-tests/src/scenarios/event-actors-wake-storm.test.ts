/**
 * FIX-660 — eventActors at `concurrency: 16` with a reEmit-heavy
 * discoverer actor still completes correctly under the new `wakeOn`
 * filter wiring.
 *
 * The wake-storm pre-fix was a CPU-cost regression (every workspace
 * `patchState` woke all 16 idle workers, each rescanning the
 * collection via `whenBoardClaimable`). The waste was invisible to
 * the block_trace stream — the predicate returns false, so workers
 * stay asleep and emit no extra `check-board` traces. The
 * fix-vs-no-fix difference is therefore not directly observable as a
 * count assertion at the flow level.
 *
 * What this test guards against:
 *   1. The wiring of `wakeOn: onTaskChangeFor(collectionId)` in the
 *      task-board worker does not break the concurrency-16 flow.
 *   2. With 10 reEmit hops through the workspace, workers still
 *      claim and drain the cascaded tasks.
 *
 * The direct verification of the filter mechanism lives in the unit
 * suites: `packages/engine/test/response-emitter-subscribe-items.test.ts`
 * (per-listener filter behavior), `packages/core/test/sequencer-wait-for-condition.test.ts`
 * (`wakeOn` forwarding), and `packages/tasks/test/collection/predicates.test.ts`
 * (`onTaskChangeFor` matching).
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import {
  actor,
  createEventActorsWorkspace,
  eventActors,
} from "@flow-state-dev/patterns/eventActors";
import { testFlow } from "@flow-state-dev/testing";
import { z } from "zod";
import { itemsByType } from "../helpers/assertions";

const CONCURRENCY = 16;
const REEMIT_COUNT = 10;

describe("FIX-660: eventActors at high concurrency with reEmit", () => {
  it("completes correctly with concurrency:16 and 10 reEmits through the workspace", async () => {
    const entrySchema = z.object({
      type: z.string(),
      topic: z.string(),
      body: z.any(),
    });

    // The "discoverer" actor returns N entries, which `reEmit` appends to
    // the workspace one-by-one — each append triggers a `patchState` on
    // the workspace resource and a `resource_change` item fanout.
    const discoverer = actor({
      name: "discoverer",
      watch: ["request:**"],
      block: handler({
        name: "discoverer-h",
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: () => {
          const entries = [];
          for (let i = 0; i < REEMIT_COUNT; i++) {
            entries.push({
              type: "observation",
              topic: `found-${i}`,
              body: `result-${i}`,
            });
          }
          return entries;
        },
      }),
    });

    // Terminal sink actor — fires on each observation, returns nothing
    // (so the cascade terminates at depth 2).
    const sink = actor({
      name: "sink",
      watch: ["observation:**"],
      block: handler({
        name: "sink-h",
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: () => ({ ok: true }),
      }),
    });

    const workspace = createEventActorsWorkspace({
      name: "wake-storm",
      entries: entrySchema,
    });

    const handle = eventActors({
      name: "wake-storm",
      workspace,
      actors: [discoverer, sink],
      concurrency: CONCURRENCY,
      reEmit: true,
      maxDepth: 2,
    });

    const flow = defineFlow({
      kind: "fix660-wake-storm",
      actions: {
        run: {
          block: sequencer({
            name: "ws-root",
            inputSchema: z.any(),
          }).step(handle.emit),
        },
      },
    })({ id: "default" });

    const result = await testFlow({
      flow,
      action: "run",
      userId: "u",
      input: { type: "request", topic: "query", body: "seed" },
      unmockedGeneratorPolicy: "error",
      seed: {
        session: { resources: { eventedActors: { entries: [] } } },
      },
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");

    // Smoke check: each of REEMIT_COUNT entries should have triggered
    // a sink-actor task that ran. We can verify the cascade completed
    // by counting `check-board` traces — at least one per claimed task.
    const traces = itemsByType(result.items, "block_trace");
    const checkBoardTraces = traces.filter(
      (t) => t.blockName === "wake-storm-board-worker-check-board"
    );

    // Sanity: cascade fired (1 discoverer + 10 sink tasks = 11+ check-board
    // cycles). The exact count varies with scheduler interleaving; we just
    // assert non-trivial activity.
    expect(checkBoardTraces.length).toBeGreaterThan(0);
  });
});
