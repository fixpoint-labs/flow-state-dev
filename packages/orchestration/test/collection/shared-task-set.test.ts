/**
 * Same-request freshness of the durable (resource-backed) task set (FIX-990).
 *
 * The mechanism backstop for the wake-staleness bug. A resource-backed
 * `TaskCollectionRef` keeps a synchronous view of *which* tasks exist; each
 * call to `createResourceBackedTaskCollection` used to hydrate that view into
 * a private map, so a task added through one resolution stayed invisible to
 * every resolution taken before it. A worker parked in `.waitForCondition`
 * holds exactly such an earlier resolution.
 *
 * These assertions are mechanism-level and carry no timing, which is what
 * makes them the primary evidence: the end-to-end latency guard in
 * `packages/integration-tests/src/scenarios/task-board-resource-wake-stale-ref.test.ts`
 * documents its own false-pass mode and is corroborating only.
 *
 * The isolation case pins the *keying* decision rather than reasoning about
 * it: the record hangs off the resource-collection instance (per request, per
 * scope instance), never off the `collectionId` string. Keyed on the string,
 * two tenants holding a same-named board would read one another's tasks.
 */
import { describe, expect, it } from "vitest";
import { createResourceBackedTaskCollection } from "../../src/tasks";
import { createFakeResourceCollection } from "../helpers";

describe("resource-backed task set: two resolutions in one request", () => {
  it("makes a task added through one resolution visible to a resolution taken earlier", async () => {
    const backing = createFakeResourceCollection();

    // Both refs resolve BEFORE the add — the shape of a worker that cached
    // its ref on entering the idle-wait. Resolving after the add has always
    // worked (the constructor hydrates), and would not exercise the defect.
    const refA = await createResourceBackedTaskCollection({
      collectionId: "tasks",
      collection: backing,
      now: () => 1000,
    });
    const refB = await createResourceBackedTaskCollection({
      collectionId: "tasks",
      collection: backing,
      now: () => 1000,
    });

    await refA.addTask({ id: "t1", goal: "g1" });

    expect(refA.count()).toBe(1);
    // The assertion the fix is for: 0 before, 1 after. No timing involved.
    expect(refB.count()).toBe(1);
    expect(refB.get("t1")?.goal).toBe("g1");
    expect(refB.list().map((t) => t.id)).toEqual(["t1"]);
  });

  it("keeps a task added through the earlier resolution visible to a later one", async () => {
    // The reverse direction: the shared record must not shadow what the
    // constructor's own hydration would have found anyway.
    const backing = createFakeResourceCollection();
    const refA = await createResourceBackedTaskCollection({
      collectionId: "tasks",
      collection: backing,
      now: () => 1000,
    });
    await refA.addTask({ id: "t1", goal: "g1" });

    const refB = await createResourceBackedTaskCollection({
      collectionId: "tasks",
      collection: backing,
      now: () => 1000,
    });
    expect(refB.count()).toBe(1);
  });

  it("reflects a status transition made through one resolution in the other", async () => {
    // Task *data* was never stale (each entry reads a live `.state` getter);
    // this pins that sharing the set did not cost that liveness.
    const backing = createFakeResourceCollection();
    const refA = await createResourceBackedTaskCollection({
      collectionId: "tasks",
      collection: backing,
      now: () => 1000,
    });
    const refB = await createResourceBackedTaskCollection({
      collectionId: "tasks",
      collection: backing,
      now: () => 1000,
    });

    await refA.addTask({ id: "t1", goal: "g1" });
    await refB.claim("w1");

    expect(refA.get("t1")?.status).toBe("in_progress");
    expect(refA.count({ status: ["in_progress"] })).toBe(1);
  });

  it("isolates two separate collection instances that share a collectionId", async () => {
    // Two scope instances (two sessions, users, or orgs) resolve the same
    // board id onto two different resource collections. Nothing may cross.
    const sessionOne = createFakeResourceCollection();
    const sessionTwo = createFakeResourceCollection();

    const refOne = await createResourceBackedTaskCollection({
      collectionId: "tasks",
      collection: sessionOne,
      now: () => 1000,
    });
    const refTwo = await createResourceBackedTaskCollection({
      collectionId: "tasks",
      collection: sessionTwo,
      now: () => 1000,
    });

    await refOne.addTask({ id: "mine", goal: "mine" });

    expect(refOne.count()).toBe(1);
    expect(refTwo.count()).toBe(0);
    expect(refTwo.get("mine")).toBeUndefined();
    expect(refTwo.list()).toEqual([]);
  });

  it("does not lose an entry when two resolutions add concurrently", async () => {
    const backing = createFakeResourceCollection();
    const refA = await createResourceBackedTaskCollection({
      collectionId: "tasks",
      collection: backing,
      now: () => 1000,
    });
    const refB = await createResourceBackedTaskCollection({
      collectionId: "tasks",
      collection: backing,
      now: () => 1000,
    });

    await Promise.all([
      refA.addTask({ id: "a", goal: "a" }),
      refB.addTask({ id: "b", goal: "b" }),
    ]);

    expect(refA.list().map((t) => t.id).sort()).toEqual(["a", "b"]);
    expect(refB.list().map((t) => t.id).sort()).toEqual(["a", "b"]);
  });
});
