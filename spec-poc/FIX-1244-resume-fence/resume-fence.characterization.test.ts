/**
 * Characterization POC for FIX-1244 — what `resumeFromReview` does TODAY.
 *
 * Throwaway. Lives on the never-merged spec branch and never ships. It exists
 * because the spec's whole first decision rests on one claim about shipped
 * behaviour, and a claim that load-bearing should be runnable rather than read:
 *
 *   `resumeFromReview` has no `requireFrom`, so it re-pends ANY row it is
 *   pointed at — including one a live worker is holding — and reports
 *   `recorded` while doing it.
 *
 * Run it from the repo root:
 *
 *   pnpm exec vitest run spec-poc/FIX-1244-resume-fence/resume-fence.characterization.test.ts
 *
 * (The package-filtered form does NOT work: `@flow-state-dev/orchestration`'s vitest
 * include globs stay inside the package, so the file is never collected and the run
 * reports no tests rather than failing. Use the root form above.)
 *
 * Result when this spec was written, on `main` @ 1d818af22: all four
 * expectations below pass, i.e. the defect is present exactly as described.
 */
import { describe, expect, it } from "vitest";
import { createResourceBackedTaskCollection } from "../../packages/orchestration/src/tasks";
import {
  createCapturedChanges,
  createFakeResourceCollection,
} from "../../packages/orchestration/test/helpers";

async function board() {
  const resource = createFakeResourceCollection();
  const captured = createCapturedChanges();
  const collection = await createResourceBackedTaskCollection({
    collectionId: "tasks",
    collection: resource,
    onChange: captured.onChange,
    now: () => 1000,
  });
  return { collection, events: captured.events };
}

describe("FIX-1244 — how resumeFromReview behaves today", () => {
  it("re-pends a row a live worker is holding, and calls it `recorded`", async () => {
    const { collection, events } = await board();
    await collection.addTask({ id: "t1", goal: "g" });
    const claimed = await collection.claim("worker-1");
    expect(claimed?.status).toBe("in_progress");

    const outcome = await collection.resumeFromReview("t1", "the human's answer");

    // The write is reported as a real change...
    expect(outcome).toEqual({ outcome: "recorded" });
    // ...and the row a worker is actively running is now back in the queue.
    expect(collection.get("t1")?.status).toBe("pending");
    expect(events.map((e) => e.kind)).toEqual(["added", "claimed", "resumed"]);
  });

  it("is not fixable by the caller passing `ifAllowed` — the edge is legal", async () => {
    const { collection } = await board();
    await collection.addTask({ id: "t2", goal: "g" });
    await collection.claim("worker-1");

    // `in_progress -> pending` is in ALLOWED_TRANSITIONS (it is `reclaim`'s
    // edge), and `resumeFromReview` passes no `requireFrom` to narrow it. So
    // the advisory flag changes nothing: there is no guard for it to trip.
    const outcome = await collection.resumeFromReview("t2", "answer", { ifAllowed: true });
    expect(outcome).toEqual({ outcome: "recorded" });
    expect(collection.get("t2")?.status).toBe("pending");
  });

  it("takes a SECOND answer to an already-answered question, silently", async () => {
    // The §9 duplicate-answer case, on the real path: park the row, answer it,
    // then answer it again. An earlier draft of this test skipped the park and
    // so proved only overwrite-on-the-wrong-state, which is a different fact.
    const { collection } = await board();
    await collection.addTask({ id: "t3", goal: "g" });
    await collection.claim("worker-1");
    await collection.awaitReview("t3", "which option?");
    expect(collection.get("t3")?.status).toBe("awaiting_review");

    const first = await collection.resumeFromReview("t3", "option A", { ifAllowed: true });
    expect(first).toEqual({ outcome: "recorded" });
    expect(collection.get("t3")?.status).toBe("pending");

    // The row is no longer parked, so nothing is waiting on this answer — and
    // the verb takes it anyway, overwriting the answer that already landed.
    const second = await collection.resumeFromReview("t3", "option B", { ifAllowed: true });
    expect(second).toEqual({ outcome: "recorded" });
    expect(collection.get("t3")?.feedback).toBe("option B");

    // After the fence: `second` is `{ outcome: "declined", reason: "disallowed",
    // status: "pending" }` and `feedback` still reads "option A".
  });

  it("a parked row cannot be claimed, so the resume MUST go via `pending`", async () => {
    const { collection } = await board();
    await collection.addTask({ id: "t4", goal: "g" });
    await collection.claim("worker-1");
    await collection.awaitReview("t4", "please decide");

    // `awaiting_review -> in_progress` is not a legal transition and
    // `isClaimable` does not admit a parked row: there is no one-write path
    // from parked to running, which is why the verb re-queues rather than
    // dispatching the row itself.
    expect(await collection.claim("worker-2")).toBeNull();
    expect(collection.get("t4")?.status).toBe("awaiting_review");
  });
});
