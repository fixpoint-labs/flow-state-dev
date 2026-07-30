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
 *
 * Two cases pull in opposite directions on purpose, because reconciling the
 * record against the store has to satisfy both: a task removed underneath the
 * record must disappear from it, while a task added *while* a sibling
 * resolution is reading the store must survive. Merge-only fails the first;
 * replace-wholesale fails the second.
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

  it("drops a task removed through the underlying collection", async () => {
    // `TaskCollectionRef` has no `delete`, but the resource collection under it
    // does, and a capacity eviction removes an instance the same way — both
    // land as "the store no longer lists this key". A shared record that only
    // merged would keep serving the removed ref to every later resolution.
    const backing = createFakeResourceCollection();
    const refA = await createResourceBackedTaskCollection({
      collectionId: "tasks",
      collection: backing,
      now: () => 1000,
    });
    await refA.addTask({ id: "keep", goal: "keep" });
    await refA.addTask({ id: "gone", goal: "gone" });

    await backing.delete("gone");

    const refB = await createResourceBackedTaskCollection({
      collectionId: "tasks",
      collection: backing,
      now: () => 1000,
    });

    expect(refB.get("gone")).toBeUndefined();
    expect(refB.list().map((t) => t.id)).toEqual(["keep"]);
    expect(refB.count()).toBe(1);
    // The record is shared, so the earlier ref stops reporting the ghost too.
    expect(refA.get("gone")).toBeUndefined();
    expect(refA.count()).toBe(1);
  });

  it("keeps a task added while a concurrent resolution was reading the store", async () => {
    // The opposing direction to the case above, and why reconciliation cannot
    // just replace the record: the add lands after `collection.list()` took its
    // snapshot but before the hydration loop runs, so it is legitimately absent
    // from that snapshot. Treating "absent" as "removed" would delete exactly
    // the mid-flight add the shared record exists to keep.
    const backing = createFakeResourceCollection();
    const refA = await createResourceBackedTaskCollection({
      collectionId: "tasks",
      collection: backing,
      now: () => 1000,
    });
    await refA.addTask({ id: "early", goal: "early" });

    // Gate `list` on `backing` ITSELF rather than on a wrapper object: the
    // record is keyed on the collection instance, so a wrapper would get its
    // own record and the two resolutions would never contend for one.
    const realList = backing.list.bind(backing);
    let release = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    backing.list = async (prefix?: string) => {
      const snapshot = await realList(prefix);
      await held; // snapshot taken; now the add below lands "during" the read
      return snapshot;
    };

    const pendingRefB = createResourceBackedTaskCollection({
      collectionId: "tasks",
      collection: backing,
      now: () => 1000,
    });
    // Let the gated list() take its snapshot and park on the barrier.
    await Promise.resolve();
    backing.list = realList; // the add's own reads must not block
    await refA.addTask({ id: "during", goal: "during" });
    release();
    const refB = await pendingRefB;

    // Both refs read the one shared record, so the mid-flight add has to be
    // present through either of them.
    expect(refA.get("during")?.goal).toBe("during");
    expect(refA.list().map((t) => t.id).sort()).toEqual(["during", "early"]);
    expect(refB.get("during")?.goal).toBe("during");
    expect(refB.count()).toBe(2);
  });

  it("keeps a same-id task recreated while a concurrent resolution was reading the store", async () => {
    // The third direction, and the one that catches a key-based cleanup. A task
    // is removed and then recreated under the SAME id while a resolution's
    // `list()` snapshot is outstanding. The id is in the pre-read set and absent
    // from the snapshot, so a cleanup that asks "is this key still known?" would
    // delete the replacement the store actually holds. The question that has to
    // be asked is "is this still the exact ref I decided to retire?".
    const backing = createFakeResourceCollection();
    const refA = await createResourceBackedTaskCollection({
      collectionId: "tasks",
      collection: backing,
      now: () => 1000,
    });
    await refA.addTask({ id: "recycled", goal: "first" });

    // Removed underneath the record: the store drops it, the record still
    // holds the ref from before.
    await backing.delete("recycled");

    const realList = backing.list.bind(backing);
    let release = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    backing.list = async (prefix?: string) => {
      const snapshot = await realList(prefix); // taken WITHOUT "recycled"
      await held;
      return snapshot;
    };

    const pendingRefB = createResourceBackedTaskCollection({
      collectionId: "tasks",
      collection: backing,
      now: () => 1000,
    });
    await Promise.resolve();
    backing.list = realList;
    // Recreated under the same id while that snapshot is outstanding.
    await refA.addTask({ id: "recycled", goal: "second" });
    release();
    const refB = await pendingRefB;

    expect(refA.get("recycled")?.goal).toBe("second");
    expect(refB.get("recycled")?.goal).toBe("second");
    expect(refA.count()).toBe(1);
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
