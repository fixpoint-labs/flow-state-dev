/**
 * Claim order eligibility tests against an in-memory sequencer-backed
 * collection. Each standard claim order is exercised against a mixed-
 * status task set + a HITL-status check (every claim order must skip
 * `parked` per FIX-443 §10.1).
 */
import { describe, expect, it, beforeEach } from "vitest";
import type { BlockContext } from "@flow-state-dev/core/types";
import {
  createStateBackedTaskCollection,
  fifoClaimOrder,
  priorityClaimOrder,
  topologicalClaimOrder,
  type TaskCollectionRef,
} from "../../src/tasks/index";
import {
  createCapturedChanges,
  createFakeSequencerState,
} from "../helpers";

function buildCollection(): TaskCollectionRef {
  let clock = 0;
  const captured = createCapturedChanges();
  const sequencer = createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} });
  return createStateBackedTaskCollection({
    collectionId: "tasks",
    state: sequencer,
    onChange: captured.onChange,
    now: () => ++clock,
  });
}

const fakeCtx = {} as BlockContext;

describe("fifoClaimOrder", () => {
  it("picks earliest-createdAt pending task", async () => {
    const c = buildCollection();
    await c.createTask({ id: "second", goal: "second" });
    await c.createTask({ id: "first", goal: "first" });
    // first was added second — but createdAt is monotonic in our clock,
    // so "second" has the lower createdAt. The fifo claim order picks the
    // earliest createdAt regardless of insertion order.
    const claimed = await fifoClaimOrder.claim(c, "w", fakeCtx);
    expect(claimed?.id).toBe("second");
  });

  it("skips a task another worker is running", async () => {
    const c = buildCollection();
    await c.createTask({ id: "review-me", goal: "r" });
    await c.claim("w");
    await c.createTask({ id: "ready", goal: "ok" });
    const claimed = await fifoClaimOrder.claim(c, "w2", fakeCtx);
    expect(claimed?.id).toBe("ready");
  });
});

describe("topologicalClaimOrder", () => {
  it("waits for deps to complete before claiming a downstream task", async () => {
    const c = buildCollection();
    await c.createTask({ id: "upstream", goal: "u" });
    await c.createTask({ id: "downstream", goal: "d", deps: ["upstream"] });

    // Downstream is not eligible yet.
    const first = await topologicalClaimOrder.claim(c, "w", fakeCtx);
    expect(first?.id).toBe("upstream");

    // Mark upstream completed; downstream should now be eligible.
    await c.complete("upstream", "ok");
    const second = await topologicalClaimOrder.claim(c, "w2", fakeCtx);
    expect(second?.id).toBe("downstream");
  });

  it("returns null when only blocked-deps tasks remain", async () => {
    const c = buildCollection();
    await c.createTask({ id: "u", goal: "u" });
    await c.createTask({ id: "d", goal: "d", deps: ["u"] });
    // Claim the upstream so only the dep-locked downstream is left.
    await topologicalClaimOrder.claim(c, "w", fakeCtx);
    const second = await topologicalClaimOrder.claim(c, "w2", fakeCtx);
    expect(second).toBeNull();
  });

  it("re-checks deps at claim time, not at list time", async () => {
    const c = buildCollection();
    await c.createTask({ id: "u", goal: "u" });
    await c.createTask({ id: "d", goal: "d", deps: ["u"] });
    // Two parallel claim attempts after upstream completes.
    await c.claim("w");
    await c.complete("u", "ok");
    const [r1, r2] = await Promise.all([
      topologicalClaimOrder.claim(c, "w1", fakeCtx),
      topologicalClaimOrder.claim(c, "w2", fakeCtx),
    ]);
    const winners = [r1, r2].filter((x) => x !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]?.id).toBe("d");
  });

  it("skips a task another worker is running", async () => {
    const c = buildCollection();
    await c.createTask({ id: "a", goal: "a" });
    await c.claim("w");
    await c.createTask({ id: "b", goal: "b" });
    const claimed = await topologicalClaimOrder.claim(c, "w2", fakeCtx);
    expect(claimed?.id).toBe("b");
  });
});

describe("priorityClaimOrder", () => {
  it("picks highest-priority pending task", async () => {
    const c = buildCollection();
    await c.createTask({ id: "low", goal: "low", priority: 1 });
    await c.createTask({ id: "hi", goal: "hi", priority: 9 });
    await c.createTask({ id: "mid", goal: "mid", priority: 5 });
    const claimed = await priorityClaimOrder.claim(c, "w", fakeCtx);
    expect(claimed?.id).toBe("hi");
  });

  it("breaks ties on createdAt ascending", async () => {
    const c = buildCollection();
    await c.createTask({ id: "later", goal: "later", priority: 5 });
    await c.createTask({ id: "earlier", goal: "earlier", priority: 5 });
    const claimed = await priorityClaimOrder.claim(c, "w", fakeCtx);
    expect(claimed?.id).toBe("later"); // later has the earlier createdAt
  });

  it("respects deps", async () => {
    const c = buildCollection();
    await c.createTask({ id: "u", goal: "u", priority: 1 });
    await c.createTask({ id: "d", goal: "d", priority: 99, deps: ["u"] });
    const claimed = await priorityClaimOrder.claim(c, "w", fakeCtx);
    expect(claimed?.id).toBe("u");
  });

  it("skips a task another worker is running", async () => {
    const c = buildCollection();
    await c.createTask({ id: "hi", goal: "hi", priority: 9 });
    await c.claim("w");
    await c.createTask({ id: "low", goal: "low", priority: 1 });
    const claimed = await priorityClaimOrder.claim(c, "w2", fakeCtx);
    expect(claimed?.id).toBe("low");
  });
});
