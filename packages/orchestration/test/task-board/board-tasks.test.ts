/**
 * The task entries a board produces, and how the flow declares them
 * (FIX-982 P2, ported to the one-message-protocol dispatch design).
 *
 * A hand-off dispatch arrives carrying a task row and nothing else — the
 * request that made the original routing decision is gone, possibly along
 * with the process. So the flow has to be able to answer "which block runs
 * this seat?" from strings alone, which is what `board.tasks` is for: a
 * plain value `taskBoard()` computes at construction time, spread into
 * `defineFlow({ tasks: board.tasks })` by the author.
 *
 * **How `defineFlow` sees the hand-off through `board.drain`.** The drain's
 * hand-off block sits inside the per-worker pool `.forEach` builds from a
 * runtime factory (`(workerId) => makeWorker(workerId)`), which on its own is
 * invisible to a static walk of `childBlocks`. The pool therefore declares the
 * static blocks every worker is composed from (`blocks: [claimTask,
 * workerBody, checkBoard]`), and the worker router inside `workerBody` carries
 * the hand-off for each seat — so the walk reaches it from wherever the drain
 * is nested, and a flow that forgets `tasks: board.tasks` is refused at
 * definition rather than at the first hand-off.
 *
 * The "defines" cases below nest the real `board.drain` at each depth with
 * `tasks: board.tasks` alongside it; the refusal cases omit or mis-declare the
 * map and expect the walk's own error. The seat-collision case uses
 * `createHandOff` directly — the same factory the drain calls — to put two
 * boards' hand-offs where one flow can reach both.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, generator, handler, router, sequencer } from "@flow-state-dev/core";
import { isTaskEntry, TASK_ENTRY } from "@flow-state-dev/core/types";
import { z } from "zod";
import { defineTaskCollection, type TaskWorker } from "../../src/tasks";
import { taskBoard, taskWorkerInputSchema } from "../../src/task-board";
import { createHandOff } from "../../src/task-board/blocks/hand-off";

function worker(name: string): TaskWorker {
  return handler({
    name,
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.null(),
    execute: () => null,
  }) as TaskWorker;
}

/** One durable ledger, reused across every board in this file — safe because
 * `freezeLedgerAssignee` is idempotent and the resource merge only refuses
 * two DIFFERENT references under one accessor key, never the same one twice. */
const durable = defineTaskCollection({ id: "board-tasks-tasks", scope: "user" });

/** A board with one handed-off seat. */
function handOffBoard(options: {
  name: string;
  boardId: string;
  seat?: string;
  workerBlock?: TaskWorker;
}) {
  const seat = options.seat ?? "implement";
  return taskBoard({
    name: options.name,
    boardId: options.boardId,
    collection: durable,
    workers: {
      [seat]: {
        block: options.workerBlock ?? worker(`${options.name}-${seat}`),
        session: "per-task",
      },
    },
  });
}

/** The hand-off block a board's own drain would install for this seat — see
 * the file header for why this stand-in, rather than `board.drain`, is what
 * the walk actually needs to reach. */
function handOffStep(boardId: string, seat: string) {
  return createHandOff({ name: `${boardId}-hand-off-${seat}`, boardId, seat, session: "per-task" });
}

describe("board.tasks — the entries a board produces", () => {
  it("produces a branded task entry for the handed-off seat", () => {
    const board = handOffBoard({ name: "issue-work", boardId: "issue-work" });

    expect(isTaskEntry(board.tasks.implement)).toBe(true);
    expect(board.tasks.implement![TASK_ENTRY]).toEqual({
      boardId: "issue-work",
      block: board.tasks.implement!.block,
    });
  });

  it("produces no task entries and hands nothing off on an inline board", () => {
    const board = taskBoard({
      name: "inline-board",
      workers: { summarize: worker("summarize") },
    });

    expect(board.tasks).toEqual({});
    expect(board.handedOff).toEqual([]);
  });
});

describe("defineFlow({ tasks: board.tasks }) — declaring the board's entries", () => {
  it("defines when the drain IS the action root", () => {
    const board = handOffBoard({ name: "issue-work", boardId: "issue-work" });

    const flow = defineFlow({
      kind: "board",
      actions: { run: { block: board.drain } },
      tasks: board.tasks,
    });

    expect(flow.tasks?.implement).toBe(board.tasks.implement);
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
        tasks: board.tasks,
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
        tasks: board.tasks,
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
        tasks: board.tasks,
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
        tasks: board.tasks,
      })
    ).not.toThrow();
  });

  it("defines when two boards' entries are spread together", () => {
    const a = handOffBoard({ name: "issue-work", boardId: "issue-work", seat: "implement" });
    const b = handOffBoard({ name: "review-work", boardId: "review-work", seat: "review" });

    const flow = defineFlow({
      kind: "board",
      actions: { runA: { block: a.drain }, runB: { block: b.drain } },
      tasks: { ...a.tasks, ...b.tasks },
    });

    expect(Object.keys(flow.tasks ?? {}).sort()).toEqual(["implement", "review"]);
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

  it("refuses two boards sharing a seat name — the merged entry belongs to the other board", () => {
    // Both boards declare a seat named "implement". Spreading `{ ...a.tasks,
    // ...b.tasks }` keeps only b's entry under that key, so a's hand-off
    // (still addressed to board "board-a") finds an entry branded for
    // "board-b" — the exact shadowing `defineFlow`'s walk exists to catch.
    const a = handOffBoard({ name: "board-a", boardId: "board-a", seat: "implement" });
    const b = handOffBoard({ name: "board-b", boardId: "board-b", seat: "implement" });

    expect(() =>
      defineFlow({
        kind: "board",
        actions: {
          run: { block: sequencer({ name: "run" }).step(handOffStep("board-a", "implement")) },
        },
        tasks: { ...a.tasks, ...b.tasks },
      })
    ).toThrow(/belongs to board "board-b"/);
  });
});
