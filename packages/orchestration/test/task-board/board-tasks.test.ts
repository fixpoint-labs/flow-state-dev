/**
 * The task entries a board's seats hand off to, and how the flow declares
 * them (FIX-982 P2, ported to the one-dispatch-protocol design).
 *
 * A hand-off dispatch arrives carrying a task row and nothing else — the
 * request that made the original routing decision is gone, possibly along
 * with the process. So the flow has to be able to answer "which block runs
 * this row?" from strings alone, which is what a task entry is for: a plain
 * `{ block }` under `defineFlow({ tasks })`, addressed by the
 * `dispatcher({ type: "task", target })` the board holds at the seat.
 *
 * **The gate.** The flow's entry is a plain block, but a `task` dispatch never
 * reaches it directly: `defineFlow` rebuilds every entry a reachable hand-off
 * addresses as that board's claim gate around the block. The board binds the
 * gate onto the hand-off it installs at each dispatcher seat, and the walk
 * applies it — so the instance carries the gated entry, scoped to the board's
 * id, with the author's policy riding beside it.
 *
 * **How `defineFlow` sees the hand-off through `board.drain`.** The drain's
 * hand-off block sits inside the per-worker pool `.forEach` builds from a
 * runtime factory (`(workerId) => makeWorker(workerId)`), which on its own is
 * invisible to a static walk of `childBlocks`. The pool therefore declares the
 * static blocks every worker is composed from (`blocks: [claimTask,
 * workerBody, checkBoard]`), and the worker router inside `workerBody` carries
 * the hand-off for each seat — so the walk reaches it from wherever the drain
 * is nested, and a flow that forgets the entry is refused at definition rather
 * than at the first hand-off.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, dispatcher, generator, handler, router, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { defineTaskCollection, type TaskWorker } from "../../src/tasks";
import { taskBoard, taskWorkerInputSchema } from "../../src/task-board";

function worker(name: string): TaskWorker {
  return handler({
    name,
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.null(),
    execute: () => null,
  }) as TaskWorker;
}

let seatCount = 0;
/** A seat that hands off to the task entry `target`. */
function seat(target: string, session: "per-task" | "per-worker" = "per-task"): TaskWorker {
  seatCount += 1;
  return dispatcher({
    name: `seat-${target}-${seatCount}`,
    type: "task",
    target,
    session,
  }) as unknown as TaskWorker;
}

/** One durable ledger, reused across every board in this file — safe because
 * `freezeLedgerAssignee` is idempotent and the resource merge only refuses
 * two DIFFERENT references under one accessor key, never the same one twice. */
const durable = defineTaskCollection({ id: "board-tasks-tasks", scope: "user" });

/** A board with one handed-off seat, addressed to the task entry `target`. */
function handOffBoard(options: { name: string; boardId: string; seat?: string; target?: string }) {
  const seatName = options.seat ?? "implement";
  return taskBoard({
    name: options.name,
    boardId: options.boardId,
    collection: durable,
    workers: { [seatName]: seat(options.target ?? seatName) },
  });
}

describe("the gated task entry — what the flow carries for a handed-off seat", () => {
  it("rebuilds the declared entry as the board's claim gate around its block", () => {
    const board = handOffBoard({ name: "issue-work", boardId: "issue-work" });
    const implement = worker("implement");

    const flow = defineFlow({
      kind: "board",
      actions: { run: { block: board.drain } },
      task: { actions: { implement: { block: implement, concurrency: "queue" } } },
    });

    const entry = flow.task?.actions.implement;
    expect(entry?.block.name).toBe("issue-work-implement-gate");
    expect(entry?.block.kind).toBe("sequencer");
    // The author's policy rides through beside the gate.
    expect(entry?.concurrency).toBe("queue");
    // The gate's input is the envelope, scoped to THIS board: a dispatch that
    // names another board is refused before the gate reads a row.
    const envelope = {
      boardId: "issue-work",
      seat: "implement",
      taskId: "t1",
      attempt: 1,
      createdAt: 1,
      payload: {},
    };
    expect(entry?.inputSchema?.safeParse(envelope).success).toBe(true);
    expect(entry?.inputSchema?.safeParse({ ...envelope, boardId: "reviews" }).success).toBe(false);
  });

  it("lets a seat hand off to an entry named differently from the seat", () => {
    const board = handOffBoard({ name: "issue-work", boardId: "issue-work", seat: "rework", target: "implement" });

    const flow = defineFlow({
      kind: "board",
      actions: { run: { block: board.drain } },
      task: { actions: { implement: { block: worker("implement") } } },
    });

    expect(board.handedOff[0]?.dispatch?.target).toBe("implement");
    expect(flow.task?.actions.implement.block.name).toBe("issue-work-implement-gate");
  });

  it("hands nothing off on an inline board", () => {
    const board = taskBoard({
      name: "inline-board",
      workers: { summarize: worker("summarize") },
    });

    expect(board.handedOff).toEqual([]);
    expect(() =>
      defineFlow({ kind: "inline", actions: { run: { block: board.drain } } })
    ).not.toThrow();
  });
});

describe("defineFlow({ task: { actions } }) — declaring the entries a board hands off to", () => {
  it("defines when the drain IS the action root", () => {
    const board = handOffBoard({ name: "issue-work", boardId: "issue-work" });

    const flow = defineFlow({
      kind: "board",
      actions: { run: { block: board.drain } },
      task: { actions: { implement: { block: worker("implement") } } },
    });

    expect(flow.task?.actions.implement).toBeDefined();
  });

  it("defines when the drain is a step inside another sequencer", () => {
    // The ordinary shape: an app wraps the drain with setup/teardown. A real
    // board's resource and schema validation must still pass at this depth.
    const board = handOffBoard({ name: "issue-work", boardId: "issue-work" });
    const outer = sequencer({ name: "outer" })
      .tap(handler({ name: "setup", execute: () => undefined }))
      .step(board.drain);

    expect(() =>
      defineFlow({
        kind: "board",
        actions: { run: { block: outer } },
        task: { actions: { implement: { block: worker("implement") } } },
      })
    ).not.toThrow();
  });

  it("defines from two levels of nesting", () => {
    const board = handOffBoard({ name: "issue-work", boardId: "issue-work" });
    const inner = sequencer({ name: "inner" }).step(board.drain);
    const outer = sequencer({ name: "outer" }).step(inner);

    expect(() =>
      defineFlow({
        kind: "board",
        actions: { run: { block: outer } },
        task: { actions: { implement: { block: worker("implement") } } },
      })
    ).not.toThrow();
  });

  it("defines from a board reached down one arm of a router", () => {
    const board = handOffBoard({ name: "issue-work", boardId: "issue-work" });
    const plain = handler({ name: "plain", execute: () => null });
    const route = router({
      name: "pick",
      routes: [board.drain as never, plain as never],
      execute: () => plain as never,
    });

    expect(() =>
      defineFlow({
        kind: "board",
        actions: { run: { block: route } },
        task: { actions: { implement: { block: worker("implement") } } },
      })
    ).not.toThrow();
  });

  it("defines once when a board is reached from two actions", () => {
    // Same board, two entry points — a diamond in the reachable set, not a
    // duplicate. The walk visits each block once (a `Set`), so this must not
    // throw on double-counted resources or a repeated visit.
    const board = handOffBoard({ name: "issue-work", boardId: "issue-work" });

    expect(() =>
      defineFlow({
        kind: "board",
        actions: {
          runA: { block: board.drain },
          runB: { block: board.drain },
        },
        task: { actions: { implement: { block: worker("implement") } } },
      })
    ).not.toThrow();
  });

  it("defines when two boards hand off to two entries", () => {
    const a = handOffBoard({ name: "issue-work", boardId: "issue-work", seat: "implement" });
    const b = handOffBoard({ name: "review-work", boardId: "review-work", seat: "review" });

    const flow = defineFlow({
      kind: "board",
      actions: { runA: { block: a.drain }, runB: { block: b.drain } },
      task: { actions: { implement: { block: worker("implement") }, review: { block: worker("review") } } },
    });

    expect(Object.keys(flow.task?.actions ?? {}).sort()).toEqual(["implement", "review"]);
    expect(flow.task?.actions.implement.block.name).toBe("issue-work-implement-gate");
    expect(flow.task?.actions.review.block.name).toBe("review-work-review-gate");
  });

  it('throws with the hand-off\'s coordinate when `tasks` is omitted', () => {
    // The real drain, nowhere else: the worker pool declares the blocks its
    // per-worker factory composes, so `defineFlow`'s walk reaches the hand-off
    // sitting in the worker router and refuses the flow before any request
    // could hand a row to an entry nobody declared.
    const board = handOffBoard({ name: "issue-work", boardId: "issue-work" });
    expect(() =>
      defineFlow({
        kind: "board",
        actions: { run: { block: board.drain } },
      })
    ).toThrow(/hands off to task:"implement".*declares no such task entry/);
  });

  it("throws the same way when the drain is nested and reached as a tool", () => {
    const board = handOffBoard({ name: "issue-work", boardId: "issue-work" });
    const agent = generator({
      name: "agent",
      model: "openai/gpt-5.4-mini",
      prompt: "drain the board",
      tools: [board.drain],
    });
    expect(() =>
      defineFlow({
        kind: "board-as-tool",
        actions: { run: { block: sequencer({ name: "run" }).step(agent) } },
      })
    ).toThrow(/hands off to task:"implement".*declares no such task entry/);
  });

  it("refuses two boards handing off to one entry — one entry settles against one ledger", () => {
    const a = handOffBoard({ name: "board-a", boardId: "board-a", seat: "implement" });
    const b = handOffBoard({ name: "board-b", boardId: "board-b", seat: "implement" });

    expect(() =>
      defineFlow({
        kind: "board",
        actions: { runA: { block: a.drain }, runB: { block: b.drain } },
        task: { actions: { implement: { block: worker("implement") } } },
      })
    ).toThrow(/handed off to by two boards, "board-[ab]" and "board-[ab]"/);
  });

  it("refuses two boards that spell one boardId over different ledgers, handing off to one entry", () => {
    // A `boardId` string is not a board. Two `taskBoard()` instances can share
    // it while claiming from different collections; only one of their gates
    // could front the entry, and a dispatch from the other would be checked
    // against the wrong ledger — starving as stale at best.
    const other = defineTaskCollection({ id: "board-tasks-other-ledger", scope: "user" });
    const a = handOffBoard({ name: "board-a", boardId: "shared-id", seat: "implement" });
    const b = taskBoard({
      name: "board-b",
      boardId: "shared-id",
      collection: other,
      workers: { implement: seat("implement") },
    });

    expect(() =>
      defineFlow({
        kind: "board",
        actions: { runA: { block: a.drain }, runB: { block: b.drain } },
        task: { actions: { implement: { block: worker("implement") } } },
      })
    ).toThrow(/two boards that both declare boardId "shared-id"/);
  });

  it("refuses a task entry no reachable board hands off to", () => {
    expect(() =>
      defineFlow({
        kind: "board",
        actions: {},
        task: { actions: { implement: { block: worker("implement") } } },
      })
    ).toThrow(/no task board reachable from the flow hands off to it/);
  });
});
