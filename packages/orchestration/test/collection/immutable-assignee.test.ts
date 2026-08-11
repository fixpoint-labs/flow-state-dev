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
      collection: defineTaskCollection({ id: "wired-detached-coll", scope: "user" }),
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

/**
 * The policy belongs to the LEDGER, not to whichever ref reached it.
 *
 * The two routes above — the drain's factory and `ctx.cap.<board>` — are the two
 * a *single* board owns, and covering both is what makes the guard
 * unbypassable from inside that board. It says nothing about a second board.
 *
 * Two boards may bind the same `defineTaskCollection` value, and only one of them
 * need declare detached workers. They then share rows: the detached board routes
 * those rows by assignee, and the sibling holds a ref that was built with no such
 * rule. A `setAssignee` through the sibling succeeds, and the detached board
 * watches its routing coordinate move underneath it — the exact failure the guard
 * exists to prevent, reached by a ref the guard was never installed on.
 *
 * Construction order must not decide it either. Boards are declared in whatever
 * order a module happens to read, so the sibling is as likely to be built before
 * the detached board as after, and a policy captured when a board is constructed
 * would be a policy that depends on which line came first.
 */
describe("assignee immutability is a property of the shared ledger", () => {
  function workerBlock(name: string): TaskWorker {
    return handler({
      name,
      inputSchema: taskWorkerInputSchema,
      outputSchema: z.null(),
      execute: () => null,
    }) as TaskWorker;
  }

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

  it("declines through a sibling board that shares the ledger and declares nothing detached", async () => {
    // User-scoped, and every detached fixture below matches: a board with a
    // detached worker is refused at construction on a session-scoped collection,
    // because a Workstream runs in its own session and would resolve an empty
    // ledger. Scope is incidental to the freeze policy under test here — what
    // matters is that two boards share one ledger.
    const ledger = defineTaskCollection({ id: "shared-ledger-a", scope: "user" });

    taskBoard({
      name: "detached-owner-a",
      boardId: "detached-owner-a",
      collection: ledger,
      workers: {
        implement: { worker: workerBlock("owner-impl-a"), dispatch: { mode: "detached" } },
      },
    });

    const sibling = taskBoard({
      name: "sibling-a",
      collection: ledger,
      workers: { implement: workerBlock("sibling-impl-a") },
    });

    const result = await testBlock(reassignThroughCapability(sibling, "sibling-a"), {
      input: undefined,
    });

    expect(result.error).toBeNull();
    expect(result.output).toMatchObject({
      outcome: { outcome: "declined", reason: "immutable-assignee" },
      assignee: "implement",
    });
  });

  it("declines through a sibling declared BEFORE the detached board", async () => {
    // Order reversed. A policy captured at board-construction time passes the
    // case above and fails this one, so the two are not redundant.
    const ledger = defineTaskCollection({ id: "shared-ledger-b", scope: "user" });

    const sibling = taskBoard({
      name: "sibling-b",
      collection: ledger,
      workers: { implement: workerBlock("sibling-impl-b") },
    });

    taskBoard({
      name: "detached-owner-b",
      boardId: "detached-owner-b",
      collection: ledger,
      workers: {
        implement: { worker: workerBlock("owner-impl-b"), dispatch: { mode: "detached" } },
      },
    });

    const result = await testBlock(reassignThroughCapability(sibling, "sibling-b"), {
      input: undefined,
    });

    expect(result.error).toBeNull();
    expect(result.output).toMatchObject({
      outcome: { outcome: "declined", reason: "immutable-assignee" },
      assignee: "implement",
    });
  });

  it("leaves two boards sharing a ledger alone when neither is detached", async () => {
    // The promotion is driven by a detached declaration, not by sharing. Without
    // this, "freeze the ledger" could degrade into "freeze anything shared".
    const ledger = defineTaskCollection({ id: "shared-ledger-c", scope: "session" });

    taskBoard({
      name: "plain-first-c",
      collection: ledger,
      workers: { implement: workerBlock("plain-impl-c") },
    });

    const second = taskBoard({
      name: "plain-second-c",
      collection: ledger,
      workers: { implement: workerBlock("plain-impl-2-c") },
    });

    const result = await testBlock(reassignThroughCapability(second, "plain-second-c"), {
      input: undefined,
    });

    expect(result.error).toBeNull();
    expect(result.output).toMatchObject({
      outcome: { outcome: "recorded" },
      assignee: "review",
    });
  });

  it("does not freeze the ledger when the detached board failed to construct", async () => {
    // The freeze is one-way and outlives the call that set it, so it must not
    // run until every refusal has had its chance. `assertDetachedBoardSupported`
    // rejects a durable detached board with no `boardId` — and a caller that
    // catches that (a config fallback, a hot reload, a test asserting the
    // refusal) would otherwise be left holding a declaration that declines valid
    // reassignment for a board that never came into existence.
    const ledger = defineTaskCollection({ id: "shared-ledger-e", scope: "session" });

    expect(() =>
      taskBoard({
        name: "invalid-detached-e",
        // no boardId — refused
        collection: ledger,
        workers: {
          implement: { worker: workerBlock("owner-impl-e"), dispatch: { mode: "detached" } },
        },
      })
    ).toThrow(/no boardId/);

    const survivor = taskBoard({
      name: "survivor-e",
      collection: ledger,
      workers: { implement: workerBlock("survivor-impl-e") },
    });

    const result = await testBlock(reassignThroughCapability(survivor, "survivor-e"), {
      input: undefined,
    });

    expect(result.error).toBeNull();
    expect(result.output).toMatchObject({
      outcome: { outcome: "recorded" },
      assignee: "review",
    });
  });

  it("does not freeze when a detached worker is refused for its session state", async () => {
    // The second refusal that fires on a durable board, so the deferral cannot
    // be satisfied by special-casing the missing-boardId check alone.
    const ledger = defineTaskCollection({ id: "shared-ledger-f", scope: "user" });
    const statefulWorker = handler({
      name: "stateful-impl-f",
      inputSchema: taskWorkerInputSchema,
      outputSchema: z.null(),
      sessionStateSchema: z.object({ seen: z.number().nullable().default(null) }),
      execute: () => null,
    }) as TaskWorker;

    expect(() =>
      taskBoard({
        name: "invalid-detached-f",
        boardId: "invalid-detached-f",
        collection: ledger,
        workers: {
          implement: { worker: statefulWorker, dispatch: { mode: "detached" } },
        },
      })
    ).toThrow(/sessionStateSchema/);

    const survivor = taskBoard({
      name: "survivor-f",
      collection: ledger,
      workers: { implement: workerBlock("survivor-impl-f") },
    });

    const result = await testBlock(reassignThroughCapability(survivor, "survivor-f"), {
      input: undefined,
    });

    expect(result.error).toBeNull();
    expect(result.output).toMatchObject({
      outcome: { outcome: "recorded" },
      assignee: "review",
    });
  });

  it("does not leak the policy to a different ledger", async () => {
    // Identity is the declaration object, not the collection id or the mere fact
    // that some board somewhere is detached. A second ledger must be untouched.
    const detachedLedger = defineTaskCollection({ id: "shared-ledger-d", scope: "user" });
    const otherLedger = defineTaskCollection({ id: "other-ledger-d", scope: "session" });

    taskBoard({
      name: "detached-owner-d",
      boardId: "detached-owner-d",
      collection: detachedLedger,
      workers: {
        implement: { worker: workerBlock("owner-impl-d"), dispatch: { mode: "detached" } },
      },
    });

    const unrelated = taskBoard({
      name: "unrelated-d",
      collection: otherLedger,
      workers: { implement: workerBlock("unrelated-impl-d") },
    });

    const result = await testBlock(reassignThroughCapability(unrelated, "unrelated-d"), {
      input: undefined,
    });

    expect(result.error).toBeNull();
    expect(result.output).toMatchObject({
      outcome: { outcome: "recorded" },
      assignee: "review",
    });
  });
});
