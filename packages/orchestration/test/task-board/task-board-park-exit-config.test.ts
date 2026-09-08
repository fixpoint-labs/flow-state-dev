/**
 * `onReview` — the declaration surface and its construction-time refusals
 * (FIX-1234).
 *
 * Two properties carry the weight here, and they are the same two the hand-off
 * declaration surface is held to:
 *
 * - **The off state.** A board that says nothing about `onReview` behaves
 *   exactly as it did before this option existed — including a durable one, a
 *   handed-off one, and one on a non-default `onIdle`. Every refusal below is one
 *   bad predicate away from firing on an ordinary board, so the off state is
 *   asserted rather than assumed (BP-030 / BP-035).
 *
 * - **Refusals are loud, by name, and carry their own diagnosis.** The two
 *   `onIdle` refusals are the ones a caller is most likely to meet with a
 *   coherent intent, so each assertion pins the *reason* in the message. A
 *   refusal that starts firing for a different cause is then a test failure
 *   rather than a passing test about the wrong thing.
 */
import { describe, expect, it } from "vitest";
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { defineTaskCollection, type TaskWorker } from "../../src/tasks";
import { taskBoard, taskWorkerInputSchema } from "../../src/task-board";

const noop = handler({
  name: "park-exit-config-worker",
  inputSchema: taskWorkerInputSchema,
  outputSchema: z.null(),
  execute: () => null,
}) as TaskWorker;

/** A fresh durable declaration per board — ids must not collide across tests. */
function durable(id: string) {
  return defineTaskCollection({ id, scope: "session" });
}

describe("onReview — the off state (BP-030 / BP-035)", () => {
  it("leaves an ordinary request-backed board buildable with no mention of it", () => {
    const board = taskBoard({ name: "park-off-default", workers: noop });
    expect(board.backing).toBe("request");
  });

  it("does not fire any refusal on the configurations it refuses in `exit` mode", () => {
    // Same three shapes the refusals below reject — accepted, every one of
    // them, while the mode is off. This is the guard against a predicate that
    // forgets to check `onReview` at all.
    expect(() =>
      taskBoard({ name: "park-off-request", workers: noop, onReview: "hold" })
    ).not.toThrow();
    expect(() =>
      taskBoard({
        name: "park-off-wait",
        workers: noop,
        collection: durable("park-off-wait"),
        onIdle: "wait",
        shouldExit: () => false,
      })
    ).not.toThrow();
    expect(() =>
      taskBoard({
        name: "park-off-idless",
        workers: noop,
        collection: durable("park-off-idless"),
        initialTasks: [{ goal: "no id here" }],
      })
    ).not.toThrow();
  });

  it("accepts the mode on the one configuration it supports", () => {
    expect(() =>
      taskBoard({
        name: "park-supported",
        workers: noop,
        collection: durable("park-supported"),
        // Default `onIdle`, durable backing, every seed carrying an id.
        initialTasks: [{ id: "ask", goal: "ask a human" }],
        onReview: "exit",
      })
    ).not.toThrow();
  });
});

describe("onReview: 'exit' — the three construction refusals", () => {
  it("refuses a board whose tasks do not outlive the request, naming the fix", () => {
    expect(() =>
      taskBoard({ name: "park-request-backed", workers: noop, onReview: "exit" })
    ).toThrow(/"park-request-backed"[\s\S]*request-backed collection/);
    expect(() =>
      taskBoard({ name: "park-request-backed-2", workers: noop, onReview: "exit" })
    ).toThrow(/defineTaskCollection/);
  });

  it("refuses `onIdle: \"wait\"` because the option would be a total no-op", () => {
    const build = () =>
      taskBoard({
        name: "park-wait",
        workers: noop,
        collection: durable("park-wait"),
        onIdle: "wait",
        shouldExit: () => false,
        onReview: "exit",
      });
    expect(build).toThrow(/"park-wait"/);
    // The diagnosis, not just the rule: that mode never reads the counts the
    // option modifies.
    expect(build).toThrow(/never consults the in-flight counts/);
    expect(build).toThrow(/shouldExit/);
  });

  it("refuses `onIdle: \"complete\"` and names the dependent case and the fix", () => {
    const build = () =>
      taskBoard({
        name: "park-complete",
        workers: noop,
        collection: durable("park-complete"),
        onIdle: "complete",
        onReview: "exit",
      });
    expect(build).toThrow(/"park-complete"/);
    // The whole reason this is a refusal rather than a documented limitation:
    // the mode would work on a parked leaf and stop working the day that task
    // gained a dependent.
    expect(build).toThrow(/depends on the parked one still holds the drain open/);
    expect(build).toThrow(/gains a dependent/);
    expect(build).toThrow(/complete-or-blocked/);
  });

  it("refuses id-less `initialTasks`, naming the duplicate the re-seed would grow", () => {
    const build = () =>
      taskBoard({
        name: "park-idless",
        workers: noop,
        collection: durable("park-idless"),
        initialTasks: [{ id: "has-one", goal: "fine" }, { goal: "no id" }],
        onReview: "exit",
      });
    expect(build).toThrow(/"park-idless"/);
    expect(build).toThrow(/no stable id/);
    expect(build).toThrow(/duplicate task/);
  });

  it("refuses the non-durable backing first, so a board with two problems is told the deepest one", () => {
    // A request-backed board with an id-less seed fails both conditions. The
    // backing is the one that cannot be worked around, so it is what the
    // caller hears about.
    expect(() =>
      taskBoard({
        name: "park-two-problems",
        workers: noop,
        initialTasks: [{ goal: "no id" }],
        onReview: "exit",
      })
    ).toThrow(/request-backed collection/);
  });
});
