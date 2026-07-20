/**
 * FIX-621 — task-board worker idle-wait is event-driven, not busy-poll.
 *
 * Configures a 4-worker task-board with a single seeded `discoverer`
 * task that sleeps 500ms before enqueuing the first real work item.
 * The other three workers find nothing to claim and enter
 * `.waitForCondition`. With the old busy-poll (`idlePollMs: 50`), the
 * idle workers would emit ~10 `checkBoard` traces each over the 500ms
 * discovery window (≈30+ traces total). With the FIX-621 event-driven
 * wake, they sit blocked on `.waitForCondition` and only re-evaluate
 * on real `task-change` fan-outs — so the count stays well under
 * `concurrency * 3`.
 *
 * The test is deliberately liberal on the cap to absorb scheduler
 * jitter; the contrast with the legacy ~40 is what matters.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import {
  taskBoard,
  taskBoardStateSchema,
  taskWorkerInputSchema,
} from "@flow-state-dev/orchestration/task-board";
import { testFlow } from "@flow-state-dev/testing";
import { z } from "zod";
import { itemsByType } from "../helpers/assertions";

const CONCURRENCY = 4;
const DISCOVER_DELAY_MS = 500;

describe("FIX-621: task-board event-driven worker idle-wait", () => {
  it("idle workers don't busy-poll checkBoard while a slow discoverer runs", async () => {
    // Slow "discoverer" task gates three dependent tasks. The other
    // three workers find nothing claimable (dependents are blocked on
    // `discover`) and enter `.waitForCondition`. When the discoverer
    // completes, the fan-out wakes them — they each claim one
    // dependent and run.
    const worker = handler({
      name: "test-worker",
      inputSchema: taskWorkerInputSchema,
      outputSchema: z.object({ ok: z.string() }),
      execute: async (input) => {
        if (input.goal === "discover") {
          await new Promise((r) => setTimeout(r, DISCOVER_DELAY_MS));
        }
        return { ok: input.goal };
      },
    }) as Parameters<typeof taskBoard>[0]["workers"];

    const board = taskBoard({
      name: "ed-board",
      collection: { collectionId: "ed-board" },
      concurrency: CONCURRENCY,
      dispatcher: "topological",
      workers: worker,
      initialTasks: [
        { id: "discover", goal: "discover" },
        { id: "real-1", goal: "real-1", deps: ["discover"] },
        { id: "real-2", goal: "real-2", deps: ["discover"] },
        { id: "real-3", goal: "real-3", deps: ["discover"] },
      ],
      onIdle: "complete",
      // Tiny idle-poll would matter in the old (busy-poll) model.
      // With event-driven wake, the predicate doesn't re-fire until
      // a task-change item arrives — so this value should not drive
      // the trace count.
      idlePollMs: 50,
      maxIterations: 500,
    });

    const flow = defineFlow({
      kind: "fix621-event-driven",
      actions: {
        run: {
          block: sequencer({
            name: "ed-root",
            inputSchema: z.unknown(),
            stateSchema: taskBoardStateSchema,
          }).step(board.block),
        },
      },
    })({ id: "default" });

    const result = await testFlow({
      flow,
      action: "run",
      userId: "u",
      input: undefined,
      unmockedGeneratorPolicy: "allow",
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");

    // Count check-board traces — these are the idle-poll cost signal.
    const traces = itemsByType(result.items, "block_trace");
    const checkBoardTraces = traces.filter(
      (t) => t.blockName === "ed-board-worker-check-board"
    );

    // Old busy-poll: ~3 idle workers × (500ms / 50ms) ≈ 30 check-board
    // ticks during discovery, plus a couple from the working worker —
    // ~32–40 total. Event-driven: each idle worker wakes only on the
    // single `task-change` fan-out, so the working worker plus the
    // wake-then-claim cycle on each idler caps the count well below
    // `CONCURRENCY * 3 = 12`.
    expect(checkBoardTraces.length).toBeLessThan(CONCURRENCY * 3);
  });
});
