/**
 * Assignee immutability on a board that runs detached work (FIX-982 P2).
 *
 * The assignee is what a detached task's routing coordinate derives from, and
 * the coordinate is what addresses the child session the work runs in. Once that
 * session is keyed, reassigning the task redirects nothing: the work already
 * dispatched keeps running under the old coordinate, and the new one addresses a
 * session nothing will ever wake.
 *
 * **The failure it prevents is a successful write.** `setAssignee` returns, the
 * task row shows the new assignee, and the task simply never runs — no throw, no
 * log, nothing to correlate. So the refusal has to be a *reported* decline
 * rather than a silent no-op: a caller that ignores the outcome behaves as it
 * always did, and a caller that reads it is told exactly which rule fired.
 *
 * The off state is asserted just as hard. This guard is one bad predicate away
 * from refusing reassignment on every ordinary board in the codebase, and
 * `setAssignee` on an inline board is a normal, used operation.
 */
import { describe, expect, it } from "vitest";
import { handler } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  createResourceBackedTaskCollection,
  defineTaskCollection,
  type TaskCollectionRef,
  type TaskWorker,
  type TaskWriteOutcome,
} from "../../src/tasks";
import { taskBoard, taskWorkerInputSchema } from "../../src/task-board";
import { createFakeResourceCollection } from "../helpers";

async function board(options: { immutableAssignee?: boolean } = {}): Promise<TaskCollectionRef> {
  return createResourceBackedTaskCollection({
    collectionId: "tasks",
    collection: createFakeResourceCollection(),
    ...options,
  });
}

describe("setAssignee on a detached board", () => {
  it("declines the reassignment and names immutable-assignee", async () => {
    const tasks = await board({ immutableAssignee: true });
    const task = await tasks.addTask({ goal: "implement", assignee: "implement" });

    const outcome = await tasks.setAssignee(task.id, "review");

    expect(outcome).toMatchObject({ outcome: "declined", reason: "immutable-assignee" });
  });

  it("leaves the assignee actually unchanged — a decline is not a soft write", async () => {
    // The whole point is that the routing coordinate cannot move. A decline
    // that still wrote would report honestly and strand the task anyway.
    const tasks = await board({ immutableAssignee: true });
    const task = await tasks.addTask({ goal: "implement", assignee: "implement" });

    await tasks.setAssignee(task.id, "review");

    expect(tasks.get(task.id)?.assignee).toBe("implement");
  });

  it("declines on a pending task, not only a terminal one", async () => {
    // `terminal` already refused finished tasks before this rule existed. The
    // new exposure is the LIVE task — the one whose Workstream is keyed and
    // running — so a test that only covered terminal tasks would pass against
    // an implementation that does nothing.
    const tasks = await board({ immutableAssignee: true });
    const task = await tasks.addTask({ goal: "implement", assignee: "implement" });

    const outcome = await tasks.setAssignee(task.id, "review");

    expect(outcome).toMatchObject({ outcome: "declined", status: "pending" });
  });

  it("reports immutable-assignee rather than terminal on a finished task", async () => {
    // Precedence. Reporting `terminal` here would tell a caller that a
    // non-terminal task could be reassigned, which on this board is false.
    const tasks = await board({ immutableAssignee: true });
    const task = await tasks.addTask({ goal: "implement", assignee: "implement" });
    await tasks.claim("w1");
    await tasks.complete(task.id, null);

    const outcome = await tasks.setAssignee(task.id, "review");

    expect(outcome).toMatchObject({ outcome: "declined", reason: "immutable-assignee" });
  });

  it("declines even when the assignee would not change", async () => {
    // An idempotent call answers `unchanged` on an ordinary board. Here the
    // honest answer is still the refusal: the operation is not available, and
    // reporting `unchanged` would imply a different value would have been taken.
    const tasks = await board({ immutableAssignee: true });
    const task = await tasks.addTask({ goal: "implement", assignee: "implement" });

    const outcome = await tasks.setAssignee(task.id, "implement");

    expect(outcome).toMatchObject({ outcome: "declined", reason: "immutable-assignee" });
  });

  it("still throws for a task that does not exist", async () => {
    // Every sibling patch method throws on an unknown id. Answering "declined"
    // for a task that was never there would report a rule that did not fire and
    // hide a caller's bug.
    const tasks = await board({ immutableAssignee: true });

    await expect(tasks.setAssignee("no-such-task", "review")).rejects.toThrow(/not found/);
  });

  it("does not restrict the other patch methods", async () => {
    // Only the routing coordinate is frozen. Labelling and re-prioritizing a
    // detached task are ordinary operations and must keep working.
    const tasks = await board({ immutableAssignee: true });
    const task = await tasks.addTask({ goal: "implement", assignee: "implement" });

    expect(await tasks.setPriority(task.id, 5)).toEqual({ outcome: "recorded" });
    expect(await tasks.addLabel(task.id, "urgent")).toEqual({ outcome: "recorded" });
  });
});

describe("setAssignee on an ordinary board — the off state (BP-035)", () => {
  it("still reassigns a pending task", async () => {
    const tasks = await board();
    const task = await tasks.addTask({ goal: "implement", assignee: "implement" });

    expect(await tasks.setAssignee(task.id, "review")).toEqual({ outcome: "recorded" });
    expect(tasks.get(task.id)?.assignee).toBe("review");
  });

  it("still answers unchanged when the assignee already matches", async () => {
    const tasks = await board();
    const task = await tasks.addTask({ goal: "implement", assignee: "implement" });

    expect(await tasks.setAssignee(task.id, "implement")).toEqual({ outcome: "unchanged" });
  });

  it("still declines a terminal task as terminal", async () => {
    // The pre-existing refusal must keep its own reason — the new arm must not
    // swallow it.
    const tasks = await board();
    const task = await tasks.addTask({ goal: "implement", assignee: "implement" });
    await tasks.claim("w1");
    await tasks.complete(task.id, null);

    expect(await tasks.setAssignee(task.id, "review")).toMatchObject({
      outcome: "declined",
      reason: "terminal",
    });
  });
});

/**
 * The wiring, on the real resolution path.
 *
 * The guard above is correct and could still never fire: it engages only if
 * `taskBoard` decides a board is detached and threads that decision down to the
 * collection. And a board is reachable two ways — the drain's own factory and
 * the `ctx.cap.<name>` accessor — over the *same* ledger. Guarding one of them
 * leaves the other as a way to the same write, so the accessor is what these
 * drive.
 */
describe("taskBoard wires assignee immutability onto its collection", () => {
  function workerBlock(name: string): TaskWorker {
    return handler({
      name,
      inputSchema: taskWorkerInputSchema,
      outputSchema: z.null(),
      execute: () => null,
    }) as TaskWorker;
  }

  /** Reassign a task through `ctx.cap.<board>`, reporting the outcome. */
  function reassignThroughCapability(
    boardHandle: ReturnType<typeof taskBoard>,
    boardName: string
  ) {
    return handler({
      name: `${boardName}-reassign`,
      inputSchema: z.unknown(),
      uses: [boardHandle.capability],
      execute: async (_input, ctx) => {
        const tasks: TaskCollectionRef = await (
          ctx.cap as Record<string, { tasks: () => Promise<TaskCollectionRef> }>
        )[boardName].tasks();
        const task = await tasks.addTask({ goal: "work", assignee: "implement" });
        const outcome: TaskWriteOutcome = await tasks.setAssignee(task.id, "review");
        return { outcome, assignee: tasks.get(task.id)?.assignee ?? null };
      },
    });
  }

  it("declines reassignment through the board capability when a worker is detached", async () => {
    const name = "wired-detached-board";
    const boardHandle = taskBoard({
      name,
      boardId: "wired-detached",
      collection: defineTaskCollection({ id: "wired-detached-coll", scope: "session" }),
      workers: {
        implement: { worker: workerBlock("wired-impl"), dispatch: { mode: "detached" } },
      },
    });

    const result = await testBlock(reassignThroughCapability(boardHandle, name), {
      input: undefined,
    });

    expect(result.error).toBeNull();
    expect(result.output).toMatchObject({
      outcome: { outcome: "declined", reason: "immutable-assignee" },
      assignee: "implement",
    });
  });

  it("leaves reassignment working on a durable board with nothing detached", async () => {
    // Same backing, same resolution path — only the dispatch declaration
    // differs. Without this, a guard keyed on "durable" rather than "detached"
    // would pass the test above and quietly freeze every durable board.
    const name = "wired-inline-board";
    const boardHandle = taskBoard({
      name,
      collection: defineTaskCollection({ id: "wired-inline-coll", scope: "session" }),
      workers: { implement: workerBlock("wired-inline-impl") },
    });

    const result = await testBlock(reassignThroughCapability(boardHandle, name), {
      input: undefined,
    });

    expect(result.error).toBeNull();
    expect(result.output).toMatchObject({
      outcome: { outcome: "recorded" },
      assignee: "review",
    });
  });
});
