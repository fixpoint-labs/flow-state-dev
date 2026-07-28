/**
 * TaskCollection lifecycle tests, parameterized over both backings.
 *
 * Both the sequencer-state-backed and resource-collection-backed
 * implementations are exercised against the same suite. The two
 * fakes match the production storage contracts closely enough that
 * any divergence in semantics shows up as a failing assertion.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  createSequencerBackedTaskCollection,
  createResourceBackedTaskCollection,
  type TaskCollectionRef,
  type TaskChangeEvent,
} from "../../src/tasks";
import {
  createCapturedChanges,
  createFakeResourceCollection,
  createFakeSequencerState,
} from "../helpers";

type BackingFactory = () => Promise<{
  collection: TaskCollectionRef;
  events: TaskChangeEvent[];
  /** Advance the test clock — both backings accept an injected `now`. */
  setNow: (n: number) => void;
}>;

function sequencerBacking(): BackingFactory {
  return async () => {
    let clock = 1000;
    const sequencer = createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} });
    const captured = createCapturedChanges();
    return {
      collection: createSequencerBackedTaskCollection({
        collectionId: "tasks",
        sequencer,
        onChange: captured.onChange,
        now: () => clock,
      }),
      events: captured.events,
      setNow: (n) => {
        clock = n;
      },
    };
  };
}

function resourceBacking(): BackingFactory {
  return async () => {
    let clock = 1000;
    const collection = createFakeResourceCollection();
    const captured = createCapturedChanges();
    return {
      collection: await createResourceBackedTaskCollection({
        collectionId: "tasks",
        collection,
        onChange: captured.onChange,
        now: () => clock,
      }),
      events: captured.events,
      setNow: (n) => {
        clock = n;
      },
    };
  };
}

describe.each([
  ["sequencer-backed", sequencerBacking()],
  ["resource-backed", resourceBacking()],
])("TaskCollection (%s)", (_label, factory) => {
  let collection: TaskCollectionRef;
  let events: TaskChangeEvent[];
  let setNow: (n: number) => void;

  beforeEach(async () => {
    const setup = await factory();
    collection = setup.collection;
    events = setup.events;
    setNow = setup.setNow;
  });

  describe("addTask / addTasks", () => {
    it("adds a task with defaults", async () => {
      const task = await collection.addTask({ goal: "do thing" });
      expect(task.goal).toBe("do thing");
      expect(task.status).toBe("pending");
      expect(task.attempts).toBe(0);
      expect(task.createdAt).toBe(1000);
      expect(events.at(-1)?.kind).toBe("added");
      expect(events.at(-1)?.task.id).toBe(task.id);
    });

    it("throws on id collision", async () => {
      await collection.addTask({ id: "x", goal: "first" });
      await expect(collection.addTask({ id: "x", goal: "second" })).rejects.toThrow(
        /already exists/
      );
    });

    it("addTasks emits one change event per task", async () => {
      events.length = 0;
      await collection.addTasks([
        { id: "a", goal: "A" },
        { id: "b", goal: "B" },
      ]);
      const added = events.filter((e) => e.kind === "added");
      expect(added.map((e) => e.taskId).sort()).toEqual(["a", "b"]);
    });
  });

  describe("claim", () => {
    it("only claims pending tasks", async () => {
      // task.assignee stays undefined when the user didn't seed one — claim's
      // workerId is for trace/lease, not the registry routing key.
      await collection.addTask({ id: "a", goal: "A" });
      const claimed = await collection.claim("worker-1");
      expect(claimed?.id).toBe("a");
      expect(claimed?.status).toBe("in_progress");
      expect(claimed?.assignee).toBeUndefined();
      expect(claimed?.leaseUntil).toBeGreaterThan(0);
      expect(claimed?.attempts).toBe(1);
    });

    it("preserves user-set assignee through claim (registry routing key)", async () => {
      await collection.addTask({ id: "a", goal: "A", assignee: "researcher" });
      const claimed = await collection.claim("worker-1");
      expect(claimed?.assignee).toBe("researcher");
    });

    it("returns null when nothing pending", async () => {
      const claimed = await collection.claim("worker-1");
      expect(claimed).toBeNull();
    });

    it("emits change event with kind=claimed and prevStatus=pending", async () => {
      await collection.addTask({ id: "a", goal: "A" });
      events.length = 0;
      await collection.claim("worker-1");
      const evt = events.find((e) => e.kind === "claimed");
      expect(evt?.prevStatus).toBe("pending");
    });

    it("respects createdAt ordering — earliest pending wins", async () => {
      setNow(1000);
      await collection.addTask({ id: "second", goal: "second" });
      setNow(500);
      await collection.addTask({ id: "first", goal: "first" });
      const claimed = await collection.claim("worker-1");
      expect(claimed?.id).toBe("first");
    });

    it("eligibility predicate filters out non-matching candidates", async () => {
      await collection.addTask({ id: "a", goal: "A", labels: ["low"] });
      await collection.addTask({ id: "b", goal: "B", labels: ["high"] });
      const claimed = await collection.claim("worker-1", {
        eligibility: (task) =>
          task.status === "pending" && (task.labels ?? []).includes("high"),
      });
      expect(claimed?.id).toBe("b");
    });

    it("two concurrent claim calls return distinct tasks", async () => {
      await collection.addTask({ id: "a", goal: "A" });
      await collection.addTask({ id: "b", goal: "B" });
      const [r1, r2] = await Promise.all([
        collection.claim("worker-1"),
        collection.claim("worker-2"),
      ]);
      const ids = [r1?.id, r2?.id].filter((x) => x !== undefined).sort();
      expect(ids).toEqual(["a", "b"]);
      expect(r1?.id).not.toBe(r2?.id);
    });

    it("two concurrent claim calls on a single task: one wins, one returns null", async () => {
      await collection.addTask({ id: "only", goal: "only" });
      const [r1, r2] = await Promise.all([
        collection.claim("worker-1"),
        collection.claim("worker-2"),
      ]);
      const winners = [r1, r2].filter((x) => x !== null);
      expect(winners).toHaveLength(1);
      expect(winners[0]?.id).toBe("only");
    });

    it("skips awaiting_review tasks under default eligibility", async () => {
      await collection.addTask({ id: "a", goal: "A" });
      await collection.addTask({ id: "b", goal: "B" });
      const first = await collection.claim("worker-1");
      await collection.awaitReview(first!.id);
      const second = await collection.claim("worker-2");
      expect(second?.id).not.toBe(first?.id);
    });
  });

  describe("complete / fail", () => {
    it("complete sets output, completedAt, status=completed", async () => {
      await collection.addTask({ id: "t", goal: "t" });
      await collection.claim("w");
      setNow(2000);
      await collection.complete("t", { result: 42 });
      const t = collection.get("t")!;
      expect(t.status).toBe("completed");
      expect(t.output).toEqual({ result: 42 });
      expect(t.completedAt).toBe(2000);
      expect(events.at(-1)?.kind).toBe("completed");
    });

    it("fail sets error, status=errored", async () => {
      await collection.addTask({ id: "t", goal: "t" });
      await collection.claim("w");
      await collection.fail("t", "boom");
      const t = collection.get("t")!;
      expect(t.status).toBe("errored");
      expect(t.error).toBe("boom");
      expect(events.at(-1)?.kind).toBe("errored");
    });
  });

  describe("fail retry semantics (maxAttempts)", () => {
    it("with maxAttempts unset, fail goes terminal (errored) on first failure", async () => {
      await collection.addTask({ id: "t", goal: "t" });
      await collection.claim("w");
      await collection.fail("t", "boom");
      expect(collection.get("t")?.status).toBe("errored");
    });

    it("with maxAttempts=3, fail re-pends with kind=retried until budget exhausts", async () => {
      await collection.addTask({ id: "t", goal: "t", maxAttempts: 3 });

      // attempt 1: claim → fail → re-pend
      await collection.claim("w1");
      expect(collection.get("t")?.attempts).toBe(1);
      await collection.fail("t", "err-1");
      expect(collection.get("t")?.status).toBe("pending");
      expect(collection.get("t")?.feedback).toBe("err-1");
      expect(collection.get("t")?.error).toBeUndefined();
      expect(events.at(-1)?.kind).toBe("retried");

      // attempt 2: claim → fail → re-pend
      await collection.claim("w2");
      expect(collection.get("t")?.attempts).toBe(2);
      await collection.fail("t", "err-2");
      expect(collection.get("t")?.status).toBe("pending");
      expect(collection.get("t")?.feedback).toBe("err-2");

      // attempt 3: claim → fail → terminal errored (budget exhausted)
      await collection.claim("w3");
      expect(collection.get("t")?.attempts).toBe(3);
      await collection.fail("t", "err-3");
      expect(collection.get("t")?.status).toBe("errored");
      expect(collection.get("t")?.error).toBe("err-3");
      expect(events.at(-1)?.kind).toBe("errored");
    });

    it("with maxAttempts=1, fail goes terminal on first failure", async () => {
      await collection.addTask({ id: "t", goal: "t", maxAttempts: 1 });
      await collection.claim("w");
      expect(collection.get("t")?.attempts).toBe(1);
      await collection.fail("t", "boom");
      expect(collection.get("t")?.status).toBe("errored");
      expect(events.at(-1)?.kind).toBe("errored");
    });

    it("each retry preserves the user-set assignee", async () => {
      await collection.addTask({
        id: "t",
        goal: "t",
        assignee: "worker-a",
        maxAttempts: 2,
      });
      await collection.claim("w");
      await collection.fail("t", "first error");
      expect(collection.get("t")?.assignee).toBe("worker-a");
      expect(collection.get("t")?.status).toBe("pending");
    });
  });

  describe("block / unblock / awaitReview / resumeFromReview / cancel", () => {
    it("block transitions pending → blocked", async () => {
      await collection.addTask({ id: "t", goal: "t" });
      await collection.block("t", "deps not ready");
      expect(collection.get("t")?.status).toBe("blocked");
      expect(events.at(-1)?.kind).toBe("blocked");
    });

    it("unblock returns to pending", async () => {
      await collection.addTask({ id: "t", goal: "t" });
      await collection.block("t");
      await collection.unblock("t");
      expect(collection.get("t")?.status).toBe("pending");
      expect(events.at(-1)?.kind).toBe("unblocked");
    });

    it("awaitReview moves in_progress → awaiting_review", async () => {
      await collection.addTask({ id: "t", goal: "t" });
      await collection.claim("w");
      await collection.awaitReview("t", "please review");
      expect(collection.get("t")?.status).toBe("awaiting_review");
      expect(collection.get("t")?.feedback).toBe("please review");
      expect(events.at(-1)?.kind).toBe("review_requested");
    });

    it("resumeFromReview returns to pending without incrementing attempts", async () => {
      await collection.addTask({ id: "t", goal: "t" });
      await collection.claim("w");
      const beforeReview = collection.get("t")!;
      const attempts = beforeReview.attempts;
      await collection.awaitReview("t");
      await collection.resumeFromReview("t", "do this instead");
      const t = collection.get("t")!;
      expect(t.status).toBe("pending");
      expect(t.attempts).toBe(attempts);
      expect(t.feedback).toBe("do this instead");
      expect(events.at(-1)?.kind).toBe("resumed");
    });

    it("cancel on terminal status is a no-op (no event emitted)", async () => {
      await collection.addTask({ id: "t", goal: "t" });
      await collection.claim("w");
      await collection.complete("t", "ok");
      events.length = 0;
      await collection.cancel("t");
      expect(events).toHaveLength(0);
    });

    it("cancel emits change event with kind=cancelled when task is non-terminal", async () => {
      await collection.addTask({ id: "t", goal: "t" });
      await collection.cancel("t", "user cancelled");
      expect(collection.get("t")?.status).toBe("cancelled");
      expect(events.at(-1)?.kind).toBe("cancelled");
    });

    it("rejects illegal transitions", async () => {
      await collection.addTask({ id: "t", goal: "t" });
      await collection.claim("w");
      await collection.complete("t", "ok");
      await expect(collection.block("t")).rejects.toThrow(/illegal status transition/);
    });
  });

  describe("reclaim", () => {
    it("resets stale-leased tasks back to pending", async () => {
      setNow(1000);
      await collection.addTask({ id: "t", goal: "t" });
      // Lease 30s.
      await collection.claim("w");
      events.length = 0;
      // Move past lease expiry.
      setNow(1000 + 60_000);
      const reclaimed = await collection.reclaim();
      expect(reclaimed).toBe(1);
      const t = collection.get("t")!;
      expect(t.status).toBe("pending");
      expect(t.leaseUntil).toBeUndefined();
      expect(events.at(-1)?.kind).toBe("resumed");
      expect(events.at(-1)?.prevStatus).toBe("in_progress");
    });

    it("preserves user-set assignee on reclaim (registry routing key)", async () => {
      // Regression test: an earlier version cleared `assignee` on
      // reclaim, which broke re-dispatch through a worker registry
      // because `assignee` is the registry routing key, not the
      // runtime worker identity.
      setNow(1000);
      await collection.addTask({ id: "t", goal: "t", assignee: "researcher" });
      await collection.claim("w");
      setNow(1000 + 60_000);
      await collection.reclaim();
      expect(collection.get("t")?.assignee).toBe("researcher");
    });

    it("does not reset still-leased tasks", async () => {
      setNow(1000);
      await collection.addTask({ id: "t", goal: "t" });
      await collection.claim("w");
      // Tick forward less than lease duration.
      setNow(1000 + 1000);
      const reclaimed = await collection.reclaim();
      expect(reclaimed).toBe(0);
      expect(collection.get("t")?.status).toBe("in_progress");
    });
  });

  describe("metadata / labels / priority / assignee mutations", () => {
    it("addLabel emits label_changed", async () => {
      await collection.addTask({ id: "t", goal: "t" });
      await collection.addLabel("t", "priority-high");
      expect(collection.get("t")?.labels).toContain("priority-high");
      expect(events.at(-1)?.kind).toBe("label_changed");
    });

    it("addLabel idempotent — duplicate add does not emit", async () => {
      await collection.addTask({ id: "t", goal: "t", labels: ["x"] });
      events.length = 0;
      await collection.addLabel("t", "x");
      expect(events).toHaveLength(0);
    });

    it("removeLabel emits when present", async () => {
      await collection.addTask({ id: "t", goal: "t", labels: ["x", "y"] });
      events.length = 0;
      await collection.removeLabel("t", "x");
      expect(collection.get("t")?.labels).toEqual(["y"]);
      expect(events.at(-1)?.kind).toBe("label_changed");
    });

    it("setAssignee emits assignee_changed", async () => {
      await collection.addTask({ id: "t", goal: "t" });
      events.length = 0;
      await collection.setAssignee("t", "alice");
      expect(events.at(-1)?.kind).toBe("assignee_changed");
    });

    it("setPriority emits priority_changed only on change", async () => {
      await collection.addTask({ id: "t", goal: "t", priority: 5 });
      events.length = 0;
      await collection.setPriority("t", 5);
      expect(events).toHaveLength(0);
      await collection.setPriority("t", 9);
      expect(events.at(-1)?.kind).toBe("priority_changed");
    });

    it("patchMetadata merges and emits metadata_changed", async () => {
      await collection.addTask({ id: "t", goal: "t", metadata: { a: 1 } });
      events.length = 0;
      await collection.patchMetadata("t", { b: 2 });
      expect(collection.get("t")?.metadata).toEqual({ a: 1, b: 2 });
      expect(events.at(-1)?.kind).toBe("metadata_changed");
    });
  });

  describe("query — list / count", () => {
    it("filters by status", async () => {
      await collection.addTask({ id: "a", goal: "A" });
      await collection.addTask({ id: "b", goal: "B" });
      await collection.claim("w");
      expect(collection.count({ status: "pending" })).toBe(1);
      expect(collection.count({ status: "in_progress" })).toBe(1);
      expect(collection.list({ status: ["pending", "in_progress"] })).toHaveLength(2);
    });

    it("filters by assignee", async () => {
      await collection.addTask({ id: "a", goal: "A", assignee: "alice" });
      await collection.addTask({ id: "b", goal: "B", assignee: "bob" });
      expect(collection.count({ assignee: "alice" })).toBe(1);
    });

    it("filters by hasLabel / hasAllLabels", async () => {
      await collection.addTask({ id: "a", goal: "A", labels: ["urgent"] });
      await collection.addTask({ id: "b", goal: "B", labels: ["urgent", "blocker"] });
      expect(collection.count({ hasLabel: "urgent" })).toBe(2);
      expect(collection.count({ hasAllLabels: ["urgent", "blocker"] })).toBe(1);
    });
  });

  describe("prototype-named task ids (FIX-965)", () => {
    // `taskId` reaches the collection straight off a model tool call
    // (`completeTask`/`failTask`/… take `taskId: z.string()`), and the
    // sequencer backing keeps tasks in a plain object. An inherited
    // `Object.prototype` member is truthy, so a falsity-only guard resolves
    // `"constructor"` to a function and the not-found path never fires.
    it.each(["constructor", "toString", "valueOf", "hasOwnProperty"])(
      "get(%j) is a miss, not an Object.prototype member",
      async (protoKey) => {
        await collection.addTask({ id: "real", goal: "real" });
        expect(collection.get(protoKey)).toBeUndefined();
      },
    );

    it.each(["constructor", "toString"])(
      "complete(%j) takes the not-found path",
      async (protoKey) => {
        await collection.addTask({ id: "real", goal: "real" });
        await expect(collection.complete(protoKey, "done")).rejects.toThrow(
          /not found/,
        );
      },
    );

    it("addTask does not report a prototype-named id as already existing", async () => {
      // The duplicate check is `tasks[id] !== undefined`; a prototype hit makes
      // a brand-new task look like a collision.
      await expect(
        collection.addTask({ id: "constructor", goal: "legit" }),
      ).resolves.toBeDefined();
      expect(collection.get("constructor")?.goal).toBe("legit");
    });
  });

  describe("change events", () => {
    it("every event carries collectionId, taskId, kind, task", async () => {
      await collection.addTask({ id: "t", goal: "t" });
      const evt = events.at(-1)!;
      expect(evt.collectionId).toBe("tasks");
      expect(evt.taskId).toBe("t");
      expect(evt.kind).toBe("added");
      expect(evt.task.id).toBe("t");
    });

    it("includes prevStatus on transitions and omits it on additions", async () => {
      await collection.addTask({ id: "t", goal: "t" });
      expect(events.at(-1)?.prevStatus).toBeUndefined();

      await collection.claim("worker-1");
      const claimed = events.at(-1)!;
      expect(claimed.kind).toBe("claimed");
      expect(claimed.prevStatus).toBe("pending");
    });
  });
});

// Async-construction + sync-mirror contract for the resource backing.
// The factory awaits one `collection.list()` to hydrate a mirror of
// resource refs; afterwards `list/get/count` read that mirror
// synchronously. These tests pin both the hydration behavior and the
// synchronous-read contract (no Promise leaks through the query surface).
describe("resource-backed sync mirror", () => {
  it("hydrates pre-existing instances so sync list() returns them without await", async () => {
    // Seed the underlying fake via a first resource-backed ref, then build
    // a SECOND ref over the same fake: its mirror must hydrate from the
    // instances already present at construction.
    const fake = createFakeResourceCollection();
    const seeder = await createResourceBackedTaskCollection({
      collectionId: "tasks",
      collection: fake,
      now: () => 1000,
    });
    await seeder.addTasks([
      { id: "a", goal: "A" },
      { id: "b", goal: "B" },
    ]);

    const tasks = await createResourceBackedTaskCollection({
      collectionId: "tasks",
      collection: fake,
      now: () => 1000,
    });

    // Sync read — no await — reflects the seeded instances via the mirror.
    const ids = tasks.list().map((t) => t.id).sort();
    expect(ids).toEqual(["a", "b"]);
    expect(tasks.count()).toBe(2);
    expect(tasks.get("a")?.goal).toBe("A");
  });

  it("reflects an awaited addTask in subsequent sync list()", async () => {
    const fake = createFakeResourceCollection();
    const tasks = await createResourceBackedTaskCollection({
      collectionId: "tasks",
      collection: fake,
      now: () => 1000,
    });

    expect(tasks.list()).toHaveLength(0);
    await tasks.addTask({ id: "new", goal: "fresh" });
    const ids = tasks.list().map((t) => t.id);
    expect(ids).toEqual(["new"]);
    expect(tasks.get("new")?.goal).toBe("fresh");
  });

  it("query methods return synchronous values, not Promises", async () => {
    const fake = createFakeResourceCollection();
    const tasks = await createResourceBackedTaskCollection({
      collectionId: "tasks",
      collection: fake,
      now: () => 1000,
    });
    await tasks.addTask({ id: "x", goal: "X" });

    // Defensive runtime guard: the sync-mirror contract must not leak the
    // underlying async ResourceCollectionRef reads through the query
    // surface. If a future change forwards to `collection.list()` again,
    // these become Promises and the assertions fail loudly.
    expect(tasks.list()).not.toBeInstanceOf(Promise);
    expect(tasks.count()).not.toBeInstanceOf(Promise);
    expect(tasks.get("x")).not.toBeInstanceOf(Promise);

    // Compile-time guard: ReturnType of the query methods is not a Promise.
    type ListReturn = ReturnType<TaskCollectionRef["list"]>;
    type CountReturn = ReturnType<TaskCollectionRef["count"]>;
    type GetReturn = ReturnType<TaskCollectionRef["get"]>;
    const _listNotPromise: ListReturn extends Promise<unknown> ? false : true = true;
    const _countNotPromise: CountReturn extends Promise<unknown> ? false : true = true;
    const _getNotPromise: GetReturn extends Promise<unknown> ? false : true = true;
    void _listNotPromise;
    void _countNotPromise;
    void _getNotPromise;
  });
});
