/**
 * FIX-1005 PR (a) — `claimedBy`, the execution coordinate a claim records.
 *
 * The row records *where attempt N ran*. Two properties are load-bearing and
 * are asserted separately here, because they fail independently:
 *
 * 1. **Lifecycle.** Stamped inside the claim write, cleared wherever the claim
 *    ends, and deliberately KEPT across `awaitReview` — a parked row keeps the
 *    coordinate of the request that will resume it. Absent on a legacy row, and
 *    nothing infers from absence (BP-030).
 * 2. **It never reaches a client.** Schema membership is itself a publication:
 *    the factory spreads the whole post-mutation row into a `task-change`
 *    component item and the delegation board marks that stream client-visible.
 *    Without the omission at that boundary, a worker's session and request ids
 *    reach every subscribed browser on the first claim.
 *
 * This suite is deliberately self-contained: it asserts the field's lifecycle
 * only and must NOT reach for a lease renewal, a fence, or a lapsed row. Those
 * belong to the mechanism PR, and a `claimedBy` test that needs the mechanism
 * present has coupled two PRs that ship independently.
 */
import { describe, expect, it } from "vitest";
import { handler } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  createSequencerBackedTaskCollection,
  createResourceBackedTaskCollection,
  getOrCreateTaskCollection,
  taskSchema,
  toEmittedTask,
  IllegalTaskTransitionError,
  SERVER_ONLY_TASK_FIELDS,
  type Task,
  type TaskClaimIdentity,
  type TaskCollectionRef,
  type TaskChangeEvent,
} from "../../src/tasks";
import {
  createCapturedChanges,
  createFakeResourceCollection,
  createFakeSequencerState,
} from "../helpers";

const IDENTITY: TaskClaimIdentity = {
  sessionId: "sess_42",
  requestId: "req_88",
};

type Harness = {
  collection: TaskCollectionRef;
  events: TaskChangeEvent[];
};

/**
 * `null` means "construct the backing with no identity at all" — distinct from
 * omitting the argument, which takes the default. A plain `undefined` default
 * parameter cannot express the difference.
 */
type BackingFactory = (identity?: TaskClaimIdentity | null) => Promise<Harness>;

const sequencerBacking: BackingFactory = async (arg = IDENTITY) => {
  const identity = arg ?? undefined;
  const sequencer = createFakeSequencerState<{ tasks: Record<string, unknown> }>({
    tasks: {},
  });
  const captured = createCapturedChanges();
  return {
    collection: createSequencerBackedTaskCollection({
      collectionId: "tasks",
      sequencer,
      onChange: captured.onChange,
      now: () => 1000,
      claimIdentity: identity,
    }),
    events: captured.events,
  };
};

const resourceBacking: BackingFactory = async (arg = IDENTITY) => {
  const identity = arg ?? undefined;
  const captured = createCapturedChanges();
  return {
    collection: await createResourceBackedTaskCollection({
      collectionId: "tasks",
      collection: createFakeResourceCollection(),
      onChange: captured.onChange,
      now: () => 1000,
      claimIdentity: identity,
    }),
    events: captured.events,
  };
};

const backings: Array<[string, BackingFactory]> = [
  ["sequencer-backed", sequencerBacking],
  ["resource-backed", resourceBacking],
];

describe.each(backings)("claimedBy — %s", (_name, makeBacking) => {
  it("stamps the coordinate inside the claim write", async () => {
    const { collection } = await makeBacking();
    await collection.addTask({ goal: "do a thing" });

    const claimed = await collection.claim("worker-1");

    expect(claimed?.claimedBy).toEqual({ sessionId: "sess_42", requestId: "req_88" });
  });

  it("carries the tenant when the identity has one", async () => {
    const { collection } = await makeBacking({ ...IDENTITY, tenantId: "acme" });
    await collection.addTask({ goal: "do a thing" });

    const claimed = await collection.claim("worker-1");

    expect(claimed?.claimedBy?.tenantId).toBe("acme");
  });

  it("omits the tenant when the identity has none, rather than writing undefined", async () => {
    const { collection } = await makeBacking();
    await collection.addTask({ goal: "do a thing" });

    const claimed = await collection.claim("worker-1");

    expect(claimed?.claimedBy).not.toHaveProperty("tenantId");
  });

  it("records no coordinate when the backing was given no identity", async () => {
    // A directly-constructed backing in a test, or any caller with no context
    // to read. Absent is a supported state, not a half-filled coordinate.
    const { collection } = await makeBacking(null);
    await collection.addTask({ goal: "do a thing" });

    const claimed = await collection.claim("worker-1");

    expect(claimed?.claimedBy).toBeUndefined();
  });

  // Every path that ends a claim clears the lease today; the coordinate follows
  // exactly that list rather than a second one invented here.
  it("clears the coordinate when the task completes", async () => {
    const { collection } = await makeBacking();
    const [task] = await collection.addTasks([{ goal: "do a thing" }]);
    await collection.claim("worker-1");

    await collection.complete(task.id, { ok: true });

    expect(collection.get(task.id)?.claimedBy).toBeUndefined();
  });

  it("clears the coordinate when the task fails terminally", async () => {
    const { collection } = await makeBacking();
    const [task] = await collection.addTasks([{ goal: "do a thing" }]);
    await collection.claim("worker-1");

    await collection.fail(task.id, "boom");

    expect(collection.get(task.id)?.status).toBe("errored");
    expect(collection.get(task.id)?.claimedBy).toBeUndefined();
  });

  it("clears the coordinate when a failure re-pends the task for retry", async () => {
    const { collection } = await makeBacking();
    const [task] = await collection.addTasks([{ goal: "do a thing", maxAttempts: 3 }]);
    await collection.claim("worker-1");

    await collection.fail(task.id, "transient");

    // Re-pended, so no attempt holds it — and therefore no coordinate.
    expect(collection.get(task.id)?.status).toBe("pending");
    expect(collection.get(task.id)?.claimedBy).toBeUndefined();
  });

  it("clears the coordinate when the task is cancelled", async () => {
    const { collection } = await makeBacking();
    const [task] = await collection.addTasks([{ goal: "do a thing" }]);
    await collection.claim("worker-1");

    await collection.cancel(task.id, "no longer needed");

    expect(collection.get(task.id)?.claimedBy).toBeUndefined();
  });

  it("clears the coordinate when a stale lease is reclaimed", async () => {
    const { collection } = await makeBacking();
    const [task] = await collection.addTasks([{ goal: "do a thing" }]);
    await collection.claim("worker-1");

    // Well past the claim's lease — `reclaim` is the manual verb and is
    // untouched by this PR beyond clearing the field it now has to clear.
    const count = await collection.reclaim(9_999_999);

    expect(count).toBe(1);
    expect(collection.get(task.id)?.status).toBe("pending");
    expect(collection.get(task.id)?.claimedBy).toBeUndefined();
  });

  it("clears the coordinate when a review park is resumed", async () => {
    const { collection } = await makeBacking();
    const [task] = await collection.addTasks([{ goal: "do a thing" }]);
    await collection.claim("worker-1");
    await collection.awaitReview(task.id, "please look");

    await collection.resumeFromReview(task.id, "looks good");

    expect(collection.get(task.id)?.status).toBe("pending");
    expect(collection.get(task.id)?.claimedBy).toBeUndefined();
  });

  /**
   * The asymmetry, pinned so a later reader does not "fix" it.
   *
   * `awaitReview` does not clear `leaseUntil` either — a review park is an
   * explicit park, and the request that parked the row is the one that will
   * resume it. A reviewer who thinks a parked row should read as unclaimed is
   * disagreeing with something already shipped, not with this field.
   */
  it("KEEPS the coordinate across awaitReview", async () => {
    const { collection } = await makeBacking();
    const [task] = await collection.addTasks([{ goal: "do a thing" }]);
    await collection.claim("worker-1");

    await collection.awaitReview(task.id, "please look");

    expect(collection.get(task.id)?.status).toBe("awaiting_review");
    expect(collection.get(task.id)?.claimedBy).toEqual({
      sessionId: "sess_42",
      requestId: "req_88",
    });
  });

  /**
   * `unblock` owns ONE edge: `blocked → pending`.
   *
   * The status table maps status to status, not verb to edge, so it also calls
   * `in_progress → pending` and `awaiting_review → pending` legal — those are
   * `reclaim`'s and `resumeFromReview`'s edges, and both of those verbs clear
   * the lease and the coordinate. `unblock` clears neither, and correctly so:
   * `blocked` is reachable only from `pending`, and every path into `pending`
   * already clears both, so a genuinely blocked row holds neither field.
   *
   * Without the source guard, `unblock` on a claimed row is a `reclaim`
   * spelled wrong — it re-pends the task while leaving the previous attempt's
   * session and request ids on it, and a later reader takes that stale
   * coordinate for the current execution. The lease leaks the same way, which
   * is why both are asserted here.
   */
  it("refuses to unblock a claimed task, writing nothing", async () => {
    const { collection } = await makeBacking();
    const [task] = await collection.addTasks([{ goal: "do a thing" }]);
    await collection.claim("worker-1");
    const leaseBefore = collection.get(task.id)?.leaseUntil;

    await expect(collection.unblock(task.id)).rejects.toThrow(
      IllegalTaskTransitionError
    );

    // Nothing moved, and neither field was stranded onto a pending row.
    expect(collection.get(task.id)?.status).toBe("in_progress");
    expect(collection.get(task.id)?.claimedBy).toEqual({
      sessionId: "sess_42",
      requestId: "req_88",
    });
    expect(collection.get(task.id)?.leaseUntil).toBe(leaseBefore);
  });

  it("refuses to unblock a task parked for review, writing nothing", async () => {
    const { collection } = await makeBacking();
    const [task] = await collection.addTasks([{ goal: "do a thing" }]);
    await collection.claim("worker-1");
    await collection.awaitReview(task.id, "please look");

    await expect(collection.unblock(task.id)).rejects.toThrow(
      IllegalTaskTransitionError
    );

    expect(collection.get(task.id)?.status).toBe("awaiting_review");
  });

  it("still unblocks a genuinely blocked task, which carries neither field", async () => {
    // The control. A guard that refused everything would pass the two above.
    const { collection } = await makeBacking();
    const [task] = await collection.addTasks([{ goal: "do a thing" }]);
    await collection.block(task.id, "deps not ready");

    await collection.unblock(task.id);

    expect(collection.get(task.id)?.status).toBe("pending");
    expect(collection.get(task.id)?.claimedBy).toBeUndefined();
    expect(collection.get(task.id)?.leaseUntil).toBeUndefined();
  });

  it("declines rather than throws when the caller made the unblock advisory", async () => {
    // An advisory write must never throw for a refused transition — it reports.
    const { collection } = await makeBacking();
    const [task] = await collection.addTasks([{ goal: "do a thing" }]);
    await collection.claim("worker-1");

    expect(await collection.unblock(task.id, { ifAllowed: true })).toMatchObject({
      outcome: "declined",
      reason: "disallowed",
    });
    expect(collection.get(task.id)?.status).toBe("in_progress");
  });
});

describe("claimedBy — legacy rows (BP-030)", () => {
  it("round-trips a row persisted before the upgrade as absent", () => {
    // No `claimedBy` key at all — the shape an older writer persisted, and the
    // shape a mixed-version normalize leaves behind.
    const legacy = {
      id: "t1",
      goal: "do a thing",
      status: "in_progress",
      attempts: 1,
      createdAt: 1,
      updatedAt: 1,
    };

    const parsed = taskSchema.parse(legacy);

    expect(parsed.claimedBy).toBeUndefined();
    expect("claimedBy" in parsed).toBe(false);
  });

  it("rejects a coordinate missing its request id rather than half-reading it", () => {
    const result = taskSchema.safeParse({
      id: "t1",
      goal: "do a thing",
      status: "in_progress",
      attempts: 1,
      createdAt: 1,
      updatedAt: 1,
      claimedBy: { sessionId: "sess_42" },
    });

    expect(result.success).toBe(false);
  });
});

describe("claimedBy — the emission boundary (the leak this PR must not ship)", () => {
  it("omits only the server-only fields and leaves the rest of the row whole", () => {
    const task = {
      id: "t1",
      goal: "do a thing",
      status: "in_progress",
      attempts: 1,
      createdAt: 1,
      updatedAt: 2,
      leaseUntil: 3,
      claimedBy: { sessionId: "sess_42", requestId: "req_88" },
    } as unknown as Task;

    const emitted = toEmittedTask(task);

    // Both halves matter. Asserting only the absence passes against a
    // projection that narrowed the envelope — which FIX-1011 depends on.
    expect(emitted).not.toHaveProperty("claimedBy");
    expect(emitted).toEqual({
      id: "t1",
      goal: "do a thing",
      status: "in_progress",
      attempts: 1,
      createdAt: 1,
      updatedAt: 2,
      leaseUntil: 3,
    });
  });

  it("honours the named set rather than one hard-coded field name", () => {
    // The test is written against the set, so adding a server-only field is
    // one entry there rather than a rule someone has to remember.
    const task = Object.fromEntries(
      SERVER_ONLY_TASK_FIELDS.map((f) => [f, "secret"])
    ) as unknown as Task;

    const emitted = toEmittedTask({ ...task, id: "t1" } as Task);

    for (const field of SERVER_ONLY_TASK_FIELDS) {
      expect(emitted).not.toHaveProperty(field);
    }
    expect(emitted.id).toBe("t1");
  });

  /**
   * The end-to-end assertion, and the one that would have caught the leak.
   *
   * Driven through a real claim on a real context so the coordinate is
   * genuinely stamped, and asserted on the emitted item rather than on the
   * stored row — the row is *supposed* to carry it.
   *
   * `client: true` is set explicitly, because that is the configuration the
   * delegation surface ships and a redaction conditional on a visibility flag
   * would pass a test run without one.
   */
  it("does not publish the coordinate to a client-visible change stream", async () => {
    const block = handler({
      name: "claim-on-board",
      inputSchema: z.unknown(),
      outputSchema: z.object({ claimedBy: z.unknown() }),
      execute: async (_input, ctx) => {
        const collection = await getOrCreateTaskCollection({
          ctx,
          backing: "request",
          collectionId: "leak",
          changeVisibility: { client: true, history: false },
        });
        await collection.addTask({ goal: "do a thing" });
        const claimed = await collection.claim("worker-1");
        return { claimedBy: claimed?.claimedBy };
      },
    });

    const result = await testBlock(block, { input: undefined });
    expect(result.error).toBeNull();

    // The substrate really did stamp a coordinate — otherwise the assertion
    // below would pass vacuously against a build that never records one.
    const stamped = (result.output as { claimedBy?: TaskClaimIdentity }).claimedBy;
    expect(stamped?.requestId).toBeTruthy();
    expect(stamped?.sessionId).toBeTruthy();

    const changes = (
      result.items as Array<{
        type?: string;
        component?: string;
        data?: { kind?: string; task?: Record<string, unknown> };
      }>
    ).filter((i) => i.type === "component" && i.component === "task-change");

    const claimEvent = changes.find((i) => i.data?.kind === "claimed");
    expect(claimEvent).toBeDefined();
    expect(claimEvent?.data?.task).not.toHaveProperty("claimedBy");
    // ...and the envelope is still whole, which FIX-1011 relies on.
    expect(claimEvent?.data?.task?.status).toBe("in_progress");
    expect(claimEvent?.data?.task?.attempts).toBe(1);
    expect(claimEvent?.data?.task?.goal).toBe("do a thing");

    // No change event on this board publishes it, not just the claim.
    for (const change of changes) {
      expect(change.data?.task).not.toHaveProperty("claimedBy");
    }
  });
});
