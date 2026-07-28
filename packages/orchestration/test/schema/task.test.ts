import { describe, expect, it } from "vitest";
import {
  taskSchema,
  taskStatusSchema,
  isTerminalStatus,
  isTransitionAllowed,
  allowedTransitionsFrom,
  assertTransitionAllowed,
  IllegalTaskTransitionError,
  matchesFilter,
  type Task,
} from "../../src/tasks";

const baseTask = (overrides: Partial<Task> = {}): Task => ({
  id: "t1",
  goal: "do thing",
  status: "pending",
  attempts: 0,
  createdAt: 100,
  updatedAt: 100,
  ...overrides,
});

describe("task schema", () => {
  it("parses round-trip", () => {
    const task = baseTask({
      input: { x: 1 },
      labels: ["priority-high"],
      metadata: { foo: "bar" },
    });
    const parsed = taskSchema.parse(task);
    expect(parsed.id).toBe("t1");
    expect(parsed.status).toBe("pending");
    expect(parsed.attempts).toBe(0);
  });

  it("round-trips optional title and context (FIX-827)", () => {
    const task = baseTask({
      title: "Audit routes",
      context: "The 25 subdomains: a.example.com, b.example.com, …",
    });
    const parsed = taskSchema.parse(task);
    expect(parsed.title).toBe("Audit routes");
    expect(parsed.context).toBe("The 25 subdomains: a.example.com, b.example.com, …");
  });

  it("title and context are optional — a task without them still parses", () => {
    const parsed = taskSchema.parse(baseTask());
    expect(parsed.title).toBeUndefined();
    expect(parsed.context).toBeUndefined();
  });

  it("status enum locks the seven canonical statuses", () => {
    const values = taskStatusSchema.options;
    expect(new Set(values)).toEqual(
      new Set([
        "pending",
        "in_progress",
        "blocked",
        "awaiting_review",
        "completed",
        "errored",
        "cancelled",
      ])
    );
  });

});

describe("state machine validators", () => {
  it("classifies terminal statuses", () => {
    expect(isTerminalStatus("completed")).toBe(true);
    expect(isTerminalStatus("errored")).toBe(true);
    expect(isTerminalStatus("cancelled")).toBe(true);
    expect(isTerminalStatus("pending")).toBe(false);
    expect(isTerminalStatus("in_progress")).toBe(false);
    expect(isTerminalStatus("awaiting_review")).toBe(false);
  });

  it("allows pending → in_progress, in_progress → completed/errored/awaiting_review/cancelled/pending", () => {
    expect(isTransitionAllowed("pending", "in_progress")).toBe(true);
    expect(isTransitionAllowed("in_progress", "completed")).toBe(true);
    expect(isTransitionAllowed("in_progress", "errored")).toBe(true);
    expect(isTransitionAllowed("in_progress", "awaiting_review")).toBe(true);
    expect(isTransitionAllowed("in_progress", "pending")).toBe(true);
    expect(isTransitionAllowed("in_progress", "cancelled")).toBe(true);
  });

  it("rejects illegal transitions out of terminal statuses", () => {
    expect(isTransitionAllowed("completed", "in_progress")).toBe(false);
    expect(isTransitionAllowed("errored", "pending")).toBe(false);
    expect(isTransitionAllowed("cancelled", "pending")).toBe(false);
  });

  it("permits awaiting_review → pending (resumeFromReview) and → completed (approve)", () => {
    expect(isTransitionAllowed("awaiting_review", "pending")).toBe(true);
    expect(isTransitionAllowed("awaiting_review", "completed")).toBe(true);
    expect(isTransitionAllowed("awaiting_review", "cancelled")).toBe(true);
  });

  it("permits blocked → pending and blocked → cancelled only", () => {
    expect(isTransitionAllowed("blocked", "pending")).toBe(true);
    expect(isTransitionAllowed("blocked", "cancelled")).toBe(true);
    expect(isTransitionAllowed("blocked", "in_progress")).toBe(false);
  });

  it("returns reachable statuses for a given source", () => {
    const fromPending = allowedTransitionsFrom("pending");
    expect(new Set(fromPending)).toEqual(
      new Set(["in_progress", "blocked", "cancelled"])
    );
  });

  it("assertTransitionAllowed throws on illegal transition", () => {
    expect(() => assertTransitionAllowed("completed", "in_progress", "t1")).toThrow(
      /illegal status transition/
    );
  });

  it("assertTransitionAllowed throws a typed error carrying the refused move", () => {
    // The type is what lets the delegation tool boundary translate exactly this
    // failure into a recoverable result while every other throw propagates
    // (FIX-950). Direct collection callers still get the throw, so the class is
    // part of the package's public surface, not an internal detail.
    let caught: unknown;
    try {
      assertTransitionAllowed("completed", "in_progress", "t1");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(IllegalTaskTransitionError);
    expect(caught).toMatchObject({
      name: "IllegalTaskTransitionError",
      taskId: "t1",
      from: "completed",
      to: "in_progress",
    });
    // Message text is deliberately unchanged from the plain Error it replaced.
    expect((caught as Error).message).toBe(
      '[tasks] illegal status transition for task "t1": completed → in_progress'
    );
  });

  it("assertTransitionAllowed allows same-status no-op", () => {
    expect(() => assertTransitionAllowed("pending", "pending", "t1")).not.toThrow();
  });
});

describe("matchesFilter", () => {
  it("undefined filter matches everything", () => {
    expect(matchesFilter(baseTask())).toBe(true);
  });

  it("status filter as scalar", () => {
    expect(matchesFilter(baseTask(), { status: "pending" })).toBe(true);
    expect(matchesFilter(baseTask({ status: "completed" }), { status: "pending" })).toBe(false);
  });

  it("status filter as array", () => {
    expect(
      matchesFilter(baseTask({ status: "in_progress" }), {
        status: ["pending", "in_progress"],
      })
    ).toBe(true);
  });

  it("assignee filter", () => {
    expect(matchesFilter(baseTask({ assignee: "alice" }), { assignee: "alice" })).toBe(true);
    expect(matchesFilter(baseTask({ assignee: "bob" }), { assignee: "alice" })).toBe(false);
  });

  it("hasLabel filter", () => {
    expect(
      matchesFilter(baseTask({ labels: ["priority-high"] }), { hasLabel: "priority-high" })
    ).toBe(true);
    expect(matchesFilter(baseTask({ labels: [] }), { hasLabel: "x" })).toBe(false);
  });

  it("hasAllLabels filter", () => {
    expect(
      matchesFilter(baseTask({ labels: ["a", "b", "c"] }), {
        hasAllLabels: ["a", "b"],
      })
    ).toBe(true);
    expect(
      matchesFilter(baseTask({ labels: ["a"] }), { hasAllLabels: ["a", "b"] })
    ).toBe(false);
  });
});
