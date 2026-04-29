/**
 * Dispatcher eligibility tests against an in-memory sequencer-backed
 * collection. Each standard dispatcher is exercised against a mixed-
 * status task set + a HITL-status check (every dispatcher must skip
 * `awaiting_review` per FIX-443 §10.1).
 */
import { describe, expect, it, beforeEach } from "vitest";
import type { BlockContext } from "@flow-state-dev/core/types";
import {
  classifierDispatcher,
  createSequencerBackedTaskCollection,
  eventDispatcher,
  fifoDispatcher,
  priorityDispatcher,
  topologicalDispatcher,
  type TaskCollectionRef,
} from "../../src";
import {
  createCapturedChanges,
  createFakeSequencerState,
} from "../helpers";

function buildCollection(): TaskCollectionRef {
  let clock = 0;
  const captured = createCapturedChanges();
  const sequencer = createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} });
  return createSequencerBackedTaskCollection({
    collectionId: "tasks",
    sequencer,
    onChange: captured.onChange,
    now: () => ++clock,
  });
}

const fakeCtx = {} as BlockContext;

describe("fifoDispatcher", () => {
  it("picks earliest-createdAt pending task", async () => {
    const c = buildCollection();
    await c.addTask({ id: "second", goal: "second" });
    await c.addTask({ id: "first", goal: "first" });
    // first was added second — but createdAt is monotonic in our clock,
    // so "second" has the lower createdAt. The fifo dispatcher picks the
    // earliest createdAt regardless of insertion order.
    const claimed = await fifoDispatcher.claim(c, "w", fakeCtx);
    expect(claimed?.id).toBe("second");
  });

  it("skips awaiting_review tasks", async () => {
    const c = buildCollection();
    await c.addTask({ id: "review-me", goal: "r" });
    await c.claim("w");
    await c.awaitReview("review-me");
    await c.addTask({ id: "ready", goal: "ok" });
    const claimed = await fifoDispatcher.claim(c, "w2", fakeCtx);
    expect(claimed?.id).toBe("ready");
  });
});

describe("topologicalDispatcher", () => {
  it("waits for deps to complete before claiming a downstream task", async () => {
    const c = buildCollection();
    await c.addTask({ id: "upstream", goal: "u" });
    await c.addTask({ id: "downstream", goal: "d", deps: ["upstream"] });

    // Downstream is not eligible yet.
    const first = await topologicalDispatcher.claim(c, "w", fakeCtx);
    expect(first?.id).toBe("upstream");

    // Mark upstream completed; downstream should now be eligible.
    await c.complete("upstream", "ok");
    const second = await topologicalDispatcher.claim(c, "w2", fakeCtx);
    expect(second?.id).toBe("downstream");
  });

  it("returns null when only blocked-deps tasks remain", async () => {
    const c = buildCollection();
    await c.addTask({ id: "u", goal: "u" });
    await c.addTask({ id: "d", goal: "d", deps: ["u"] });
    // Claim the upstream so only the dep-locked downstream is left.
    await topologicalDispatcher.claim(c, "w", fakeCtx);
    const second = await topologicalDispatcher.claim(c, "w2", fakeCtx);
    expect(second).toBeNull();
  });

  it("re-checks deps at claim time, not at list time", async () => {
    const c = buildCollection();
    await c.addTask({ id: "u", goal: "u" });
    await c.addTask({ id: "d", goal: "d", deps: ["u"] });
    // Two parallel dispatcher attempts after upstream completes.
    await c.claim("w");
    await c.complete("u", "ok");
    const [r1, r2] = await Promise.all([
      topologicalDispatcher.claim(c, "w1", fakeCtx),
      topologicalDispatcher.claim(c, "w2", fakeCtx),
    ]);
    const winners = [r1, r2].filter((x) => x !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]?.id).toBe("d");
  });

  it("skips awaiting_review tasks", async () => {
    const c = buildCollection();
    await c.addTask({ id: "a", goal: "a" });
    await c.claim("w");
    await c.awaitReview("a");
    await c.addTask({ id: "b", goal: "b" });
    const claimed = await topologicalDispatcher.claim(c, "w2", fakeCtx);
    expect(claimed?.id).toBe("b");
  });
});

describe("priorityDispatcher", () => {
  it("picks highest-priority pending task", async () => {
    const c = buildCollection();
    await c.addTask({ id: "low", goal: "low", priority: 1 });
    await c.addTask({ id: "hi", goal: "hi", priority: 9 });
    await c.addTask({ id: "mid", goal: "mid", priority: 5 });
    const claimed = await priorityDispatcher.claim(c, "w", fakeCtx);
    expect(claimed?.id).toBe("hi");
  });

  it("breaks ties on createdAt ascending", async () => {
    const c = buildCollection();
    await c.addTask({ id: "later", goal: "later", priority: 5 });
    await c.addTask({ id: "earlier", goal: "earlier", priority: 5 });
    const claimed = await priorityDispatcher.claim(c, "w", fakeCtx);
    expect(claimed?.id).toBe("later"); // later has the earlier createdAt
  });

  it("respects deps", async () => {
    const c = buildCollection();
    await c.addTask({ id: "u", goal: "u", priority: 1 });
    await c.addTask({ id: "d", goal: "d", priority: 99, deps: ["u"] });
    const claimed = await priorityDispatcher.claim(c, "w", fakeCtx);
    expect(claimed?.id).toBe("u");
  });

  it("skips awaiting_review tasks", async () => {
    const c = buildCollection();
    await c.addTask({ id: "hi", goal: "hi", priority: 9 });
    await c.claim("w");
    await c.awaitReview("hi");
    await c.addTask({ id: "low", goal: "low", priority: 1 });
    const claimed = await priorityDispatcher.claim(c, "w2", fakeCtx);
    expect(claimed?.id).toBe("low");
  });
});

describe("classifierDispatcher", () => {
  it("delegates the choice to the classify callback", async () => {
    const c = buildCollection();
    await c.addTask({ id: "a", goal: "a" });
    await c.addTask({ id: "b", goal: "b" });
    await c.addTask({ id: "c", goal: "c" });

    const dispatcher = classifierDispatcher({
      classify: async (candidates) => {
        const target = candidates.find((t) => t.goal === "c");
        return target?.id ?? null;
      },
    });

    const claimed = await dispatcher.claim(c, "w", fakeCtx);
    expect(claimed?.id).toBe("c");
  });

  it("returns null when classify returns null", async () => {
    const c = buildCollection();
    await c.addTask({ id: "a", goal: "a" });
    const dispatcher = classifierDispatcher({ classify: async () => null });
    const claimed = await dispatcher.claim(c, "w", fakeCtx);
    expect(claimed).toBeNull();
  });

  it("filters awaiting_review tasks before passing to classify", async () => {
    const c = buildCollection();
    await c.addTask({ id: "review-me", goal: "r" });
    await c.claim("w");
    await c.awaitReview("review-me");
    await c.addTask({ id: "ok", goal: "ok" });

    let observedIds: string[] = [];
    const dispatcher = classifierDispatcher({
      classify: async (candidates) => {
        observedIds = candidates.map((t) => t.id);
        return candidates[0]?.id ?? null;
      },
    });

    await dispatcher.claim(c, "w2", fakeCtx);
    expect(observedIds).toEqual(["ok"]);
  });
});

describe("eventDispatcher", () => {
  it("matches on metadata.topic against the published event", async () => {
    const c = buildCollection();
    await c.addTask({
      id: "user-msg",
      goal: "handle user",
      metadata: { topic: "user.message" },
    });
    await c.addTask({
      id: "tool-call",
      goal: "handle tool",
      metadata: { topic: "tool.invoked" },
    });

    const dispatcher = eventDispatcher({
      topicFor: (task) =>
        typeof task.metadata?.["topic"] === "string"
          ? (task.metadata["topic"] as string)
          : undefined,
      topic: "tool.invoked",
    });

    const claimed = await dispatcher.claim(c, "w", fakeCtx);
    expect(claimed?.id).toBe("tool-call");
  });

  it("returns null when no task matches the published topic", async () => {
    const c = buildCollection();
    await c.addTask({ id: "x", goal: "x", metadata: { topic: "other" } });
    const dispatcher = eventDispatcher({
      topicFor: (task) => task.metadata?.["topic"] as string | undefined,
      topic: "missing",
    });
    const claimed = await dispatcher.claim(c, "w", fakeCtx);
    expect(claimed).toBeNull();
  });

  it("supports a callback topic for late binding", async () => {
    const c = buildCollection();
    await c.addTask({ id: "a", goal: "a", metadata: { topic: "alpha" } });

    let currentTopic = "beta";
    const dispatcher = eventDispatcher({
      topicFor: (task) => task.metadata?.["topic"] as string | undefined,
      topic: () => currentTopic,
    });

    expect(await dispatcher.claim(c, "w", fakeCtx)).toBeNull();
    currentTopic = "alpha";
    expect((await dispatcher.claim(c, "w2", fakeCtx))?.id).toBe("a");
  });

  it("skips awaiting_review tasks", async () => {
    const c = buildCollection();
    await c.addTask({ id: "x", goal: "x", metadata: { topic: "t" } });
    await c.claim("w");
    await c.awaitReview("x");
    await c.addTask({ id: "y", goal: "y", metadata: { topic: "t" } });
    const dispatcher = eventDispatcher({
      topicFor: (task) => task.metadata?.["topic"] as string | undefined,
      topic: "t",
    });
    const claimed = await dispatcher.claim(c, "w2", fakeCtx);
    expect(claimed?.id).toBe("y");
  });
});
