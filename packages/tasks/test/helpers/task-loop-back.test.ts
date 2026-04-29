import { describe, expect, it } from "vitest";
import {
  createSequencerBackedTaskCollection,
  defaultTaskLoopUntil,
  taskLoopBack,
  DEFAULT_TASK_LOOP_MAX_ITERATIONS,
} from "../../src";
import {
  createCapturedEmitter,
  createFakeSequencerState,
} from "../helpers";

function buildCollection() {
  const captured = createCapturedEmitter();
  const sequencer = createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} });
  return createSequencerBackedTaskCollection({
    collectionId: "tasks",
    sequencer,
    emit: captured.emit,
    frame: captured.frame,
  });
}

describe("taskLoopBack", () => {
  it("continues while pending tasks remain", () => {
    const c = buildCollection();
    const handle = taskLoopBack();
    return c.addTask({ goal: "x" }).then(() => {
      expect(handle.shouldContinue(c)).toBe(true);
    });
  });

  it("continues while in_progress tasks remain", async () => {
    const c = buildCollection();
    await c.addTask({ id: "t", goal: "t" });
    await c.claim("w");
    expect(taskLoopBack().shouldContinue(c)).toBe(true);
  });

  it("treats awaiting_review as in-flight (HITL-aware termination)", async () => {
    const c = buildCollection();
    await c.addTask({ id: "t", goal: "t" });
    await c.claim("w");
    await c.awaitReview("t");
    expect(taskLoopBack().shouldContinue(c)).toBe(true);
  });

  it("terminates when only completed/errored/cancelled remain", async () => {
    const c = buildCollection();
    await c.addTask({ id: "a", goal: "a" });
    await c.claim("w");
    await c.complete("a", "ok");
    await c.addTask({ id: "b", goal: "b" });
    await c.claim("w");
    await c.fail("b", "boom");
    expect(taskLoopBack().shouldContinue(c)).toBe(false);
  });

  it("respects custom until predicate", async () => {
    const c = buildCollection();
    await c.addTask({ id: "t", goal: "t" });
    const handle = taskLoopBack({ until: () => false });
    expect(handle.shouldContinue(c)).toBe(false);
  });

  it("forwards maxIterations", () => {
    expect(taskLoopBack().maxIterations).toBe(DEFAULT_TASK_LOOP_MAX_ITERATIONS);
    expect(taskLoopBack({ maxIterations: 5 }).maxIterations).toBe(5);
  });
});

describe("defaultTaskLoopUntil", () => {
  it("returns true when any task is pending/in_progress/awaiting_review", () => {
    expect(
      defaultTaskLoopUntil([
        { id: "1", goal: "x", status: "pending", attempts: 0, createdAt: 0, updatedAt: 0 },
        { id: "2", goal: "y", status: "completed", attempts: 0, createdAt: 0, updatedAt: 0 },
      ])
    ).toBe(true);
  });

  it("returns false when every task is terminal", () => {
    expect(
      defaultTaskLoopUntil([
        { id: "1", goal: "x", status: "completed", attempts: 0, createdAt: 0, updatedAt: 0 },
        { id: "2", goal: "y", status: "errored", attempts: 0, createdAt: 0, updatedAt: 0 },
        { id: "3", goal: "z", status: "cancelled", attempts: 0, createdAt: 0, updatedAt: 0 },
      ])
    ).toBe(false);
  });
});
