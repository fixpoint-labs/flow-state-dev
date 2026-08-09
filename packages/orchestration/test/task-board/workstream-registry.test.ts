/**
 * The detached worker registry, and how it reaches the flow (FIX-982 P2).
 *
 * A detached wake arrives carrying a task row and nothing else — the request
 * that made the original routing decision is gone, possibly along with the
 * process. So the flow has to be able to answer "which block runs this
 * coordinate?" from strings alone, and it has to be able to answer it for a
 * board declared *anywhere* in the block tree, because nobody authors a
 * registry.
 *
 * That makes the load-bearing assertion a **negative** one: a board nested one
 * level deeper than the test author imagined must not silently drop out. A
 * dropped binding does not throw at definition time. It surfaces much later as a
 * detached task that is admitted, claimed, dispatched, and then never runs,
 * because the flow it woke into has no route for its coordinate. Each nesting
 * shape below is a rail the bindings have to survive.
 *
 * **No execution is asserted here.** P2 populates the registry; assembling the
 * entry a dispatch actually executes comes later. `flow.workstream` is still
 * `undefined` throughout, which is why the *off* state is pinned explicitly.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler, router, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import {
  defineTaskCollection,
  type TaskWorker,
} from "../../src/tasks";
import {
  coordinateKey,
  taskBoard,
  taskWorkerInputSchema,
  type WorkerCoordinate,
} from "../../src/task-board";

function worker(name: string): TaskWorker {
  return handler({
    name,
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.null(),
    execute: () => null,
  }) as TaskWorker;
}

const durable = defineTaskCollection({ id: "registry-tasks", scope: "user" });

/** A board with one detached worker under `assignee: implement`. */
function detachedBoard(options: { name: string; boardId: string; workerName?: string }) {
  return taskBoard({
    name: options.name,
    boardId: options.boardId,
    collection: durable,
    workers: {
      implement: {
        worker: worker(options.workerName ?? `${options.name}-implement`),
        dispatch: { mode: "detached" },
      },
    },
  });
}

const implementCoordinate: WorkerCoordinate = { kind: "assignee", name: "implement" };

/** The bindings a flow ended up with, as readable `boardId/label` pairs. */
function bindingSummary(flow: { workstreamBindings?: ReadonlyMap<string, { boardId: string; worker: { name: string } }> }) {
  return [...(flow.workstreamBindings?.values() ?? [])]
    .map((b) => `${b.boardId}:${b.worker.name}`)
    .sort();
}

describe("registry bubble-up — a board reaches the flow from wherever it sits", () => {
  it("carries bindings when the drain IS the action root", () => {
    const board = detachedBoard({ name: "issue-work", boardId: "issue-work" });
    const flow = defineFlow({
      kind: "board",
      actions: { run: { block: board.drain } },
    })({ id: "board" });

    expect(bindingSummary(flow)).toEqual(["issue-work:issue-work-implement"]);
  });

  it("carries bindings when the drain is a step inside another sequencer", () => {
    // The ordinary shape: an app wraps the drain with setup/teardown. If
    // bubbling only worked at the root this would pass a review and fail in
    // production.
    const board = detachedBoard({ name: "issue-work", boardId: "issue-work" });
    const outer = sequencer({ name: "outer" })
      .tap(handler({ name: "setup", execute: () => undefined }))
      .step(board.drain);

    const flow = defineFlow({
      kind: "board",
      actions: { run: { block: outer } },
    })({ id: "board" });

    expect(bindingSummary(flow)).toEqual(["issue-work:issue-work-implement"]);
  });

  it("carries bindings from two levels of nesting", () => {
    const board = detachedBoard({ name: "issue-work", boardId: "issue-work" });
    const inner = sequencer({ name: "inner" }).step(board.drain);
    const outer = sequencer({ name: "outer" }).step(inner);

    const flow = defineFlow({
      kind: "board",
      actions: { run: { block: outer } },
    })({ id: "board" });

    expect(bindingSummary(flow)).toEqual(["issue-work:issue-work-implement"]);
  });

  it("carries bindings from a board reached down one arm of a router", () => {
    // A router picks ONE route at runtime, but the registry is a definition-time
    // fact: the flow must be able to route to a board it might reach, not only
    // to one it did reach.
    const board = detachedBoard({ name: "issue-work", boardId: "issue-work" });
    const plain = handler({ name: "plain", execute: () => null });
    const route = router({
      name: "pick",
      routes: [board.drain as never, plain as never],
      execute: () => plain as never,
    });

    const flow = defineFlow({
      kind: "board",
      actions: { run: { block: route } },
    })({ id: "board" });

    expect(bindingSummary(flow)).toEqual(["issue-work:issue-work-implement"]);
  });

  it("merges bindings across two different actions", () => {
    const a = detachedBoard({ name: "issue-work", boardId: "issue-work" });
    const b = detachedBoard({ name: "review-work", boardId: "review-work" });

    const flow = defineFlow({
      kind: "board",
      actions: {
        runA: { block: a.drain },
        runB: { block: b.drain },
      },
    })({ id: "board" });

    expect(bindingSummary(flow)).toEqual([
      "issue-work:issue-work-implement",
      "review-work:review-work-implement",
    ]);
  });

  it("deduplicates one board drained from two actions", () => {
    // Same board, two entry points. This is a duplicate, not a conflict, and
    // must not throw — identity is the worker reference.
    const board = detachedBoard({ name: "issue-work", boardId: "issue-work" });

    const flow = defineFlow({
      kind: "board",
      actions: {
        runA: { block: board.drain },
        runB: { block: board.drain },
      },
    })({ id: "board" });

    expect(flow.workstreamBindings?.size).toBe(1);
  });

  it("keys a binding by board and coordinate", () => {
    const board = detachedBoard({ name: "issue-work", boardId: "issue-work" });
    const flow = defineFlow({
      kind: "board",
      actions: { run: { block: board.drain } },
    })({ id: "board" });

    const binding = [...(flow.workstreamBindings?.values() ?? [])][0];
    expect(binding?.boardId).toBe("issue-work");
    expect(binding?.coordinateKey).toBe(coordinateKey(implementCoordinate));
  });
});

describe("registry bubble-up — the off state (BP-030 / BP-035)", () => {
  it("leaves an ordinary flow with no bindings and no workstream core", () => {
    // Every flow that ships today. `workstream` staying undefined is the
    // security invariant FIX-999 relies on: detached resolution is terminal, so
    // an absent core is a refusal rather than a fall-through to `flow.actions`.
    const flow = defineFlow({
      kind: "plain",
      actions: { run: { block: handler({ name: "run", execute: () => null }) } },
    })({ id: "plain" });

    expect(flow.workstreamBindings).toBeUndefined();
    expect(flow.workstream).toBeUndefined();
  });

  it("leaves an inline board's flow with no bindings", () => {
    // A board with workers but no `dispatch` declares nothing detached, so it
    // must contribute nothing — otherwise every existing board in the codebase
    // would start populating a registry it never asked for.
    const board = taskBoard({
      name: "inline-board",
      workers: { summarize: worker("summarize") },
    });

    const flow = defineFlow({
      kind: "board",
      actions: { run: { block: board.drain } },
    })({ id: "board" });

    expect(flow.workstreamBindings).toBeUndefined();
  });

  it("does not populate the workstream core — that is not P2's to assemble", () => {
    const board = detachedBoard({ name: "issue-work", boardId: "issue-work" });
    const flow = defineFlow({
      kind: "board",
      actions: { run: { block: board.drain } },
    })({ id: "board" });

    expect(flow.workstreamBindings?.size).toBe(1);
    expect(flow.workstream).toBeUndefined();
  });
});

describe("registry bubble-up — an unanswerable coordinate is refused at definition", () => {
  it("throws when two boards share a boardId but bind different workers", () => {
    // A detached dispatch names only the coordinate. Two blocks at one
    // coordinate is not a duplicate to dedupe — it is a routing question with no
    // answer, and picking one silently runs the wrong worker for the loser's
    // tasks. Flow definition is the last point where the author can see both.
    const a = detachedBoard({ name: "board-a", boardId: "shared", workerName: "impl-a" });
    const b = detachedBoard({ name: "board-b", boardId: "shared", workerName: "impl-b" });

    expect(() =>
      defineFlow({
        kind: "board",
        actions: { runA: { block: a.drain }, runB: { block: b.drain } },
      })({ id: "board" })
    ).toThrow(/two different detached workers/);
  });

  it("names both workers and the coordinate, so the author can find them", () => {
    const a = detachedBoard({ name: "board-a", boardId: "shared", workerName: "impl-a" });
    const b = detachedBoard({ name: "board-b", boardId: "shared", workerName: "impl-b" });

    expect(() =>
      defineFlow({
        kind: "board",
        actions: { runA: { block: a.drain }, runB: { block: b.drain } },
      })({ id: "board" })
    ).toThrow(/impl-a[\s\S]*impl-b|impl-b[\s\S]*impl-a/);
  });

  it("allows the same worker name on two boards with distinct boardIds", () => {
    // Only the (boardId, coordinate) pair has to be unique. Two teams naming a
    // worker `implement` is normal and must not be refused.
    const a = detachedBoard({ name: "board-a", boardId: "board-a" });
    const b = detachedBoard({ name: "board-b", boardId: "board-b" });

    const flow = defineFlow({
      kind: "board",
      actions: { runA: { block: a.drain }, runB: { block: b.drain } },
    })({ id: "board" });

    expect(flow.workstreamBindings?.size).toBe(2);
  });
});
