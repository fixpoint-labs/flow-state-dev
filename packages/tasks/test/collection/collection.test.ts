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
  type TaskChangeItem,
} from "../../src";
import {
  createCapturedEmitter,
  createFakeResourceCollection,
  createFakeSequencerState,
} from "../helpers";

type BackingFactory = () => {
  collection: TaskCollectionRef;
  events: TaskChangeItem[];
  /** Advance the test clock — both backings accept an injected `now`. */
  setNow: (n: number) => void;
};

function sequencerBacking(): BackingFactory {
  return () => {
    let clock = 1000;
    const sequencer = createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} });
    const captured = createCapturedEmitter();
    return {
      collection: createSequencerBackedTaskCollection({
        collectionId: "tasks",
        sequencer,
        emit: captured.emit,
        frame: captured.frame,
        now: () => clock,
      }),
      events: captured.items,
      setNow: (n) => {
        clock = n;
      },
    };
  };
}

function resourceBacking(): BackingFactory {
  return () => {
    let clock = 1000;
    const collection = createFakeResourceCollection();
    const captured = createCapturedEmitter();
    return {
      collection: createResourceBackedTaskCollection({
        collectionId: "tasks",
        collection,
        emit: captured.emit,
        frame: captured.frame,
        now: () => clock,
      }),
      events: captured.items,
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
  let events: TaskChangeItem[];
  let setNow: (n: number) => void;

  beforeEach(() => {
    const setup = factory();
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

    it("addTasks emits one task_change per task", async () => {
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

    it("emits task_change with kind=claimed and prevStatus=pending", async () => {
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

    it("cancel emits task_change with kind=cancelled when task is non-terminal", async () => {
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
      expect(t.assignee).toBeUndefined();
      expect(t.leaseUntil).toBeUndefined();
      expect(events.at(-1)?.kind).toBe("resumed");
      expect(events.at(-1)?.prevStatus).toBe("in_progress");
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

  describe("task_change emission", () => {
    it("every event carries collectionId, taskId, kind, task", async () => {
      await collection.addTask({ id: "t", goal: "t" });
      const evt = events.at(-1)!;
      expect(evt.type).toBe("task_change");
      expect(evt.collectionId).toBe("tasks");
      expect(evt.taskId).toBe("t");
      expect(evt.kind).toBe("added");
      expect(evt.task.id).toBe("t");
    });

    it("transient by default (no persistTaskEvents flag)", async () => {
      await collection.addTask({ id: "t", goal: "t" });
      expect(events.at(-1)?.transient).toBe(true);
    });
  });
});
