/**
 * Assignee immutability on a board that hands off (FIX-982 P2), narrowed to
 * the task an attempt holds (FIX-1780 BR-16b).
 *
 * The assignee is what a handed-off task's routing key derives from, and the
 * key is what addresses the child session the work runs in. Once that session
 * is keyed, reassigning the task redirects nothing: the work already dispatched
 * keeps running under the old key, and the new one addresses a session nothing
 * will ever wake.
 *
 * Only a task an attempt holds is frozen: *in progress*, and *parked*, whose
 * attempt can still settle it. A pending or blocked task is claimed afresh
 * before it runs again, and that claim reads whatever assignee the row then
 * holds, so moving it strands nothing. A parked task is moved once `unpark`
 * has ended its attempt.
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
import { dispatcher, handler } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  createResourceBackedTaskCollection,
  defineTaskCollection,
  ticketForClaim,
  type TaskCollectionRef,
  type TaskWorker,
  type TaskWriteOutcome,
} from "../../src/tasks";
import { taskBoard, taskWorkerInputSchema } from "../../src/task-board";
import type { JsonObject } from "@flow-state-dev/core";
import type { ResourceRef } from "@flow-state-dev/core/types";
import { createFakeResourceCollection } from "../helpers";

async function board(options: { immutableAssignee?: boolean } = {}): Promise<TaskCollectionRef> {
  return createResourceBackedTaskCollection({
    collectionId: "tasks",
    collection: createFakeResourceCollection(),
    ...options,
  });
}

/** A seat that hands off — what makes a board freeze its assignees. */
function seat(name: string): TaskWorker {
  return dispatcher({
    name,
    type: "task",
    action: "implement",
    session: "per-task",
  }) as unknown as TaskWorker;
}

/** Add one task and claim it, so an attempt holds it (`in_progress`). */
async function running(tasks: TaskCollectionRef) {
  const task = await tasks.addTask({ goal: "implement", assignee: "implement" });
  await tasks.claim("w1");
  expect(tasks.get(task.id)?.status).toBe("in_progress");
  return task;
}

describe("setAssignee on a board that hands off", () => {
  it("declines the reassignment of a running task and names immutable-assignee", async () => {
    const tasks = await board({ immutableAssignee: true });
    const task = await running(tasks);

    const outcome = await tasks.setAssignee(task.id, "review");

    expect(outcome).toEqual({
      outcome: "declined",
      reason: "immutable-assignee",
      status: "in_progress",
    });
  });

  it("leaves a running task's assignee actually unchanged — a decline is not a soft write", async () => {
    // The whole point is that the routing key cannot move under a dispatch in
    // flight. A decline that still wrote would report honestly and strand it.
    const tasks = await board({ immutableAssignee: true });
    const task = await running(tasks);

    await tasks.setAssignee(task.id, "review");

    expect(tasks.get(task.id)?.assignee).toBe("implement");
  });

  it("declines on a running task even when the assignee would not change", async () => {
    // An idempotent call answers `unchanged` on an ordinary board. Here the
    // honest answer is still the refusal: the operation is not available while
    // the attempt runs, and `unchanged` would imply another value would be taken.
    const tasks = await board({ immutableAssignee: true });
    const task = await running(tasks);

    expect(await tasks.setAssignee(task.id, "implement")).toMatchObject({
      outcome: "declined",
      reason: "immutable-assignee",
    });
  });

  it("moves a pending task: nothing has been dispatched for it yet", async () => {
    // BR-16b. A coordinator moving a waiting task to another worker is the case
    // the freeze used to refuse. The next claim reads the new assignee, so the
    // hand-off goes to the new worker rather than stranding anything.
    const tasks = await board({ immutableAssignee: true });
    const task = await tasks.addTask({ goal: "implement", assignee: "implement" });

    expect(await tasks.setAssignee(task.id, "review")).toEqual({ outcome: "recorded" });
    expect(tasks.get(task.id)?.assignee).toBe("review");
  });

  it("names a worker for a pending task that had none", async () => {
    // FIX-1777's "the task waits; assign it" depends on exactly this write.
    const tasks = await board({ immutableAssignee: true });
    const task = await tasks.addTask({ goal: "implement" });

    expect(await tasks.setAssignee(task.id, "review")).toEqual({ outcome: "recorded" });
    expect(tasks.get(task.id)?.assignee).toBe("review");
  });

  it("declines a parked task: its attempt can still settle it", async () => {
    // `parked → completed` is legal for the attempt that parked, so moving the
    // row would let the old worker settle work now addressed to a new one.
    const tasks = await board({ immutableAssignee: true });
    const task = await running(tasks);
    await tasks.awaitReview(task.id, "which colour?");
    expect(tasks.get(task.id)?.status).toBe("parked");

    expect(await tasks.setAssignee(task.id, "review")).toEqual({
      outcome: "declined",
      reason: "immutable-assignee",
      status: "parked",
    });
    expect(tasks.get(task.id)?.assignee).toBe("implement");
  });

  it("moves a parked task once unpark ends its attempt, and the old claim can no longer settle it", async () => {
    const tasks = await board({ immutableAssignee: true });
    const task = await tasks.addTask({ goal: "implement", assignee: "implement" });
    const claimed = await tasks.claim("w1");
    const oldClaim = ticketForClaim(tasks.collectionId, claimed!);
    await tasks.awaitReview(task.id, "which colour?");

    await tasks.unpark(task.id);
    expect(await tasks.setAssignee(task.id, "review")).toEqual({ outcome: "recorded" });

    const late = await tasks.complete(task.id, "done", { claim: oldClaim });
    expect(late).toMatchObject({ outcome: "declined", reason: "lost-claim" });
    expect(tasks.get(task.id)).toMatchObject({ status: "pending", assignee: "review" });
  });

  it("moves a blocked task", async () => {
    const tasks = await board({ immutableAssignee: true });
    const task = await tasks.addTask({ goal: "implement", assignee: "implement" });
    await tasks.block(task.id, "waiting on a key");
    expect(tasks.get(task.id)?.status).toBe("blocked");

    expect(await tasks.setAssignee(task.id, "review")).toEqual({ outcome: "recorded" });
  });

  it("declines a claim's task once the claim lands, so a move cannot race a dispatch", async () => {
    // The status is read inside the same atomic write as the assignee. A move
    // that lost the race to a claim is refused, never written under the claim.
    const tasks = await board({ immutableAssignee: true });
    const task = await tasks.addTask({ goal: "implement", assignee: "implement" });

    const [claimed, outcome] = await Promise.all([
      tasks.claim("w1"),
      tasks.setAssignee(task.id, "review"),
    ]);

    const row = tasks.get(task.id);
    if (outcome.outcome === "recorded") {
      // The move landed first: the claim must have read the new assignee.
      expect(claimed?.assignee).toBe("review");
    } else {
      expect(outcome).toMatchObject({ reason: "immutable-assignee", status: "in_progress" });
      expect(row?.assignee).toBe("implement");
    }
  });

  it("reports terminal on a finished task — the assignee rule is about a running one", async () => {
    const tasks = await board({ immutableAssignee: true });
    const task = await running(tasks);
    await tasks.complete(task.id, null);

    expect(await tasks.setAssignee(task.id, "review")).toMatchObject({
      outcome: "declined",
      reason: "terminal",
    });
  });

  it("still throws for a task that does not exist", async () => {
    // Every sibling patch method throws on an unknown id. Answering "declined"
    // for a task that was never there would report a rule that did not fire and
    // hide a caller's bug.
    const tasks = await board({ immutableAssignee: true });

    await expect(tasks.setAssignee("no-such-task", "review")).rejects.toThrow(/not found/);
  });

  it("does not restrict the other patch methods on a running task", async () => {
    // Only the routing key is frozen. Labelling and re-prioritizing a
    // handed-off task are ordinary operations and must keep working.
    const tasks = await board({ immutableAssignee: true });
    const task = await running(tasks);

    expect(await tasks.setPriority(task.id, 5)).toEqual({ outcome: "recorded" });
    expect(await tasks.addLabel(task.id, "urgent")).toEqual({ outcome: "recorded" });
  });
});

describe("setAssignee judges the freeze against the committed row", () => {
  // A request reads a resource as the snapshot it first took. A decline thrown
  // from the updater skips the store's check of that snapshot, so without a
  // re-read a task another request has since moved off `in_progress` would
  // keep being refused. The fake below hands the updater one stale copy and
  // propagates its throw, as the engine's CAS driver does.
  it("moves a task whose cached copy is running but whose committed row is pending", async () => {
    const backing = createFakeResourceCollection<JsonObject>();
    const refs = new Map<string, ResourceRef<JsonObject>>();
    const create = backing.create.bind(backing);
    backing.create = async (key, initial) => {
      const ref = await create(key, initial);
      refs.set(ref.path, ref);
      return ref;
    };
    const tasks = await createResourceBackedTaskCollection({
      collectionId: "tasks",
      collection: backing,
      immutableAssignee: true,
    });
    const task = await tasks.addTask({ goal: "implement", assignee: "implement" });
    const ref = [...refs.values()][0]!;

    const committed = ref.updateState.bind(ref);
    let stale: JsonObject | undefined = { ...ref.state, status: "in_progress" };
    ref.updateState = async (updater) => {
      if (stale !== undefined) {
        const snapshot = stale;
        stale = undefined;
        await updater(snapshot as never);
      }
      return committed(updater);
    };

    expect(await tasks.setAssignee(task.id, "review")).toEqual({ outcome: "recorded" });
    expect(tasks.get(task.id)?.assignee).toBe("review");
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
 * `taskBoard` decides a board hands off and threads that decision down to the
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
        // Claimed, so an attempt holds it: the one status the freeze refuses.
        await tasks.claim("w1");
        const outcome: TaskWriteOutcome = await tasks.setAssignee(task.id, "review");
        return { outcome, assignee: tasks.get(task.id)?.assignee ?? null };
      },
    });
  }

  it("declines reassignment through the board capability when a seat hands off", async () => {
    const name = "wired-hand-off-board";
    const boardHandle = taskBoard({
      name,
      boardId: "wired-hand-off",
      collection: defineTaskCollection({ id: "wired-hand-off-coll", scope: "user" }),
      workers: { implement: seat("wired-impl") },
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

  it("leaves reassignment working on a durable board with no dispatcher seat", async () => {
    // Same backing, same resolution path — only the seat differs. Without
    // this, a guard keyed on "durable" rather than "hands off"
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
 * need declare a dispatcher seat. They then share rows: the handed-off board routes
 * those rows by assignee, and the sibling holds a ref that was built with no such
 * rule. A `setAssignee` through the sibling succeeds, and the handed-off board
 * watches its routing key move underneath it — the exact failure the guard
 * exists to prevent, reached by a ref the guard was never installed on.
 *
 * Construction order must not decide it either. Boards are declared in whatever
 * order a module happens to read, so the sibling is as likely to be built before
 * the handed-off board as after, and a policy captured when a board is constructed
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
        // Claimed, so an attempt holds it: the one status the freeze refuses.
        await tasks.claim("w1");
        const outcome: TaskWriteOutcome = await tasks.setAssignee(task.id, "review");
        return { outcome, assignee: tasks.get(task.id)?.assignee ?? null };
      },
    });
  }

  it("declines through a sibling board that shares the ledger and hands nothing off", async () => {
    // User-scoped, and every hand-off fixture below matches: a board with a
    // dispatcher seat is refused at construction on a session-scoped collection,
    // because a child session runs in its own session and would resolve an empty
    // ledger. Scope is incidental to the freeze policy under test here — what
    // matters is that two boards share one ledger.
    const ledger = defineTaskCollection({ id: "shared-ledger-a", scope: "user" });

    taskBoard({
      name: "hand-off-owner-a",
      boardId: "hand-off-owner-a",
      collection: ledger,
      workers: { implement: seat("owner-impl-a") },
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

  it("declines through a sibling declared BEFORE the handed-off board", async () => {
    // Order reversed. A policy captured at board-construction time passes the
    // case above and fails this one, so the two are not redundant.
    const ledger = defineTaskCollection({ id: "shared-ledger-b", scope: "user" });

    const sibling = taskBoard({
      name: "sibling-b",
      collection: ledger,
      workers: { implement: workerBlock("sibling-impl-b") },
    });

    taskBoard({
      name: "hand-off-owner-b",
      boardId: "hand-off-owner-b",
      collection: ledger,
      workers: { implement: seat("owner-impl-b") },
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

  it("leaves two boards sharing a ledger alone when neither hands off", async () => {
    // The promotion is driven by a dispatcher seat, not by sharing. Without
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

  it("does not freeze the ledger when the handed-off board failed to construct", async () => {
    // The freeze is one-way and outlives the call that set it, so it must not
    // run until every refusal has had its chance. `assertHandOffBoardSupported`
    // rejects a durable handed-off board with no `boardId` — and a caller that
    // catches that (a config fallback, a hot reload, a test asserting the
    // refusal) would otherwise be left holding a declaration that declines valid
    // reassignment for a board that never came into existence.
    const ledger = defineTaskCollection({ id: "shared-ledger-e", scope: "session" });

    expect(() =>
      taskBoard({
        name: "invalid-hand-off-e",
        // no boardId — refused
        collection: ledger,
        workers: { implement: seat("owner-impl-e") },
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

  it("does not freeze when a hand-off is refused for its session-scoped ledger", async () => {
    // The second refusal that fires on a durable board, so the deferral cannot
    // be satisfied by special-casing the missing-boardId check alone.
    const ledger = defineTaskCollection({ id: "shared-ledger-f", scope: "session" });

    expect(() =>
      taskBoard({
        name: "invalid-hand-off-f",
        boardId: "invalid-hand-off-f",
        collection: ledger,
        workers: { implement: seat("owner-impl-f") },
      })
    ).toThrow(/session-scoped collection/);

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
    // that some board somewhere hands off. A second ledger must be untouched.
    const handOffLedger = defineTaskCollection({ id: "shared-ledger-d", scope: "user" });
    const otherLedger = defineTaskCollection({ id: "other-ledger-d", scope: "session" });

    taskBoard({
      name: "hand-off-owner-d",
      boardId: "hand-off-owner-d",
      collection: handOffLedger,
      workers: { implement: seat("owner-impl-d") },
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
