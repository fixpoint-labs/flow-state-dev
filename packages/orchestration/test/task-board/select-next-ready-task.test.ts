/**
 * `selectNextReadyTask` — the preview must name a task that will actually be
 * dispatched (FIX-1005).
 *
 * The block answers "what would the dispatcher pick next?", and answering it
 * takes both halves of the substrate's claim decision, not just the first:
 *
 * - **Admission** (`isClaimable`) — should the claim path look at this row?
 *   A `pending` row, or an `in_progress` one whose lease has lapsed.
 * - **Disposition** (`claimDisposition`) — what does the claim write do with
 *   it? Hand it out, or settle it `errored` because its abandonment allowance
 *   is spent and scan straight past it.
 *
 * A row that passes the first and fails the second is one no dispatcher will
 * ever run. Reporting it as `ready` tells a visualization and a dry-run planner
 * that work is about to start when nothing is, and — worse — hides the
 * genuinely claimable work queued behind it, because the exhausted row sorts
 * first on `createdAt`.
 */
import { describe, expect, it } from "vitest";
import type { BlockContext } from "@flow-state-dev/core/types";
import { runForTest } from "@flow-state-dev/testing";
import {
  createSequencerBackedTaskCollection,
  DEFAULT_MAX_ABANDONMENTS,
  MIN_LEASE_DURATION_MS,
  type TaskCollectionRef,
} from "../../src/tasks";
import { createSelectNextReadyTask } from "../../src/task-board";
import { createFakeSequencerState } from "../helpers";

const fakeCtx = {} as BlockContext;

/** A collection on a clock the test advances, so leases lapse on demand. */
function steppedCollection(): {
  collection: TaskCollectionRef;
  advancePastLease: () => void;
} {
  let clock = 1_000;
  const collection = createSequencerBackedTaskCollection({
    collectionId: "tasks",
    sequencer: createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} }),
    now: () => clock,
  });
  return {
    collection,
    advancePastLease: () => {
      clock += MIN_LEASE_DURATION_MS + 1;
    },
  };
}

/**
 * Strand `id` until its abandonment allowance is exactly spent: claimed, then
 * left with a lapsed lease, `DEFAULT_MAX_ABANDONMENTS + 1` times. The row ends
 * `in_progress` with `abandonments === DEFAULT_MAX_ABANDONMENTS` — still
 * admitted by `isClaimable`, but the next claim write settles it rather than
 * running it.
 */
async function exhaustAllowance(
  collection: TaskCollectionRef,
  advancePastLease: () => void
): Promise<void> {
  for (let i = 0; i < DEFAULT_MAX_ABANDONMENTS + 1; i += 1) {
    await collection.claim("worker-that-died", {
      leaseDurationMs: MIN_LEASE_DURATION_MS,
    });
    advancePastLease();
  }
}

describe("selectNextReadyTask does not promise a dispatch that cannot happen", () => {
  it("skips an exhausted row and names the task the dispatcher would really take", async () => {
    const { collection, advancePastLease } = steppedCollection();
    await collection.addTask({ id: "stranded", goal: "abandoned too many times" });
    await exhaustAllowance(collection, advancePastLease);

    // Queued behind it, and genuinely claimable. It sorts LATER on `createdAt`,
    // so admission alone would have returned the exhausted row instead.
    await collection.addTask({ id: "real-work", goal: "actually runnable" });

    const stranded = collection.get("stranded")!;
    expect(stranded.status).toBe("in_progress");
    expect(stranded.abandonments).toBe(DEFAULT_MAX_ABANDONMENTS);

    const preview = await runForTest(
      createSelectNextReadyTask({
        name: "preview",
        collection: async () => collection,
      }),
      undefined,
      fakeCtx
    );

    expect(preview.ready).toBe(true);
    expect(preview.task?.id).toBe("real-work");
  });

  it("reports nothing ready when the only candidate is one the claim write would settle", async () => {
    const { collection, advancePastLease } = steppedCollection();
    await collection.addTask({ id: "stranded", goal: "abandoned too many times" });
    await exhaustAllowance(collection, advancePastLease);

    const preview = await runForTest(
      createSelectNextReadyTask({
        name: "preview",
        collection: async () => collection,
      }),
      undefined,
      fakeCtx
    );

    // The board is not going to start anything. `claim()` agrees — it settles
    // this row `errored` and returns null.
    expect(preview.ready).toBe(false);
    expect(preview.task).toBeUndefined();
    expect(await collection.claim("next-worker")).toBeNull();
    expect(collection.get("stranded")?.status).toBe("errored");
  });

  it("still previews a recoverable row whose allowance is NOT spent", async () => {
    // The anti-vacuity guard: a preview that filtered out every `in_progress`
    // row would pass the two tests above and silently stop reporting the
    // recovery work this issue exists to make visible.
    const { collection, advancePastLease } = steppedCollection();
    await collection.addTask({ id: "recoverable", goal: "worker died once" });
    await collection.claim("worker-that-died", {
      leaseDurationMs: MIN_LEASE_DURATION_MS,
    });
    advancePastLease();

    const preview = await runForTest(
      createSelectNextReadyTask({
        name: "preview",
        collection: async () => collection,
      }),
      undefined,
      fakeCtx
    );

    expect(preview.ready).toBe(true);
    expect(preview.task?.id).toBe("recoverable");
  });
});
