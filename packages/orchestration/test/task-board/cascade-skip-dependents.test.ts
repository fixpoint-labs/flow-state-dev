/**
 * `cascadeSkipDependents` — the second terminal-labelling regression path
 * (FIX-976 / epic constraint A1).
 *
 * This block cancels a dep-blocked task and then labels it `"skipped"` **on the
 * line immediately after**, so its target is unambiguously terminal. Nothing
 * asserted that label directly before now, which mattered: the assignment
 * terminal guard added by FIX-976 must stay scoped to `setAssignee`, and a guard
 * bolted onto the shared patch helper instead would silently stop this label
 * landing.
 *
 * The label is not cosmetic. On a later invocation the block re-derives its
 * cascading set from `errored` tasks **plus** `cancelled` tasks carrying
 * `"skipped"`, so the label is what lets a multi-pass cascade keep walking a dep
 * chain across drains. That re-entry is the stronger of the two A1 bars — losing
 * it does not fail loudly, it just stops cascading one level down.
 */
import { describe, expect, it } from "vitest";
import { handler, sequencer } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import { getOrCreateTaskCollection } from "../../src/tasks";
import { createCascadeSkipDependents } from "../../src/task-board";

const COLLECTION = "cascade-regression";

/** Read the board back through the same request-backed collection the block uses. */
const taskShape = z.object({
  status: z.string(),
  labels: z.array(z.string()),
});

function reader(name: string, taskId: string) {
  return handler({
    name,
    inputSchema: z.unknown(),
    outputSchema: taskShape,
    execute: async (_input, ctx) => {
      const collection = await getOrCreateTaskCollection({
        ctx,
        backing: "request",
        collectionId: COLLECTION,
      });
      const task = collection.get(taskId);
      return { status: task?.status ?? "missing", labels: [...(task?.labels ?? [])] };
    },
  });
}

/** Seed `a` (errored) and `b` (pending, deps: [a]) so one cascade pass has work. */
const seed = handler({
  name: "seed",
  inputSchema: z.unknown(),
  execute: async (_input, ctx) => {
    const collection = await getOrCreateTaskCollection({
      ctx,
      backing: "request",
      collectionId: COLLECTION,
    });
    await collection.addTask({ id: "a", goal: "a" });
    await collection.addTask({ id: "b", goal: "b", deps: ["a"] });
    // Drive `a` to terminal `errored` through the real lifecycle.
    await collection.claim("w", { eligibility: (t) => t.id === "a" });
    await collection.fail("a", "worker blew up");
  },
});

/** Add `c` (deps: [b]) AFTER the first cascade pass, so pass two must re-derive. */
const addDependentOfSkipped = handler({
  name: "add-c",
  inputSchema: z.unknown(),
  execute: async (_input, ctx) => {
    const collection = await getOrCreateTaskCollection({
      ctx,
      backing: "request",
      collectionId: COLLECTION,
    });
    await collection.addTask({ id: "c", goal: "c", deps: ["b"] });
  },
});

const cascade = createCascadeSkipDependents({ name: COLLECTION });

describe("cascadeSkipDependents — the skipped label lands on the task it cancelled", () => {
  it("labels the cancelled dependent, on a task that is already terminal", async () => {
    const pipeline = sequencer({ name: "cascade-once" })
      .tap(seed)
      .tap(cascade)
      .step(reader("read-b", "b"));

    const result = await testBlock(pipeline, { input: undefined });

    expect(result.error).toBeNull();
    // `cancel` then `addLabel` — the label is written to a `cancelled` task.
    expect(result.output).toEqual({ status: "cancelled", labels: ["skipped"] });
  });

  it("keeps cascading on a second pass, which reads that label back", async () => {
    // The load-bearing half. `c` is added after pass one, so pass two can only
    // know `b` is a dead dependency by finding `skipped` on it. With the label
    // missing, `c` is left `pending` and the plan quietly has a hole in it.
    const pipeline = sequencer({ name: "cascade-twice" })
      .tap(seed)
      .tap(cascade)
      .tap(addDependentOfSkipped)
      .tap(cascade)
      .step(reader("read-c", "c"));

    const result = await testBlock(pipeline, { input: undefined });

    expect(result.error).toBeNull();
    expect(result.output).toEqual({ status: "cancelled", labels: ["skipped"] });
  });
});
