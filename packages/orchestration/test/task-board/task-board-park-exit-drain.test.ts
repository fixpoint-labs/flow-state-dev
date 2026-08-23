/**
 * Park-exit on the real drain (FIX-1234 §10).
 *
 * No model, no generator, no network on this path, so the honest equivalent of
 * a goal check is a real-path drain test: a real board over a real durable
 * collection, parked and resumed by a sibling actor, asserting on what the
 * launching request observes. `durable-board-freshness.test.ts` is the harness
 * this builds on, and that file's own regression — a drain still running while
 * a task is parked — is the BP-030 guard for the mode being off. It passes here
 * unedited.
 *
 * ## Every assertion below is written as a flip
 *
 * "The drain returned" is not a test: a drain returns for all sorts of reasons,
 * including the iteration budget this change exists to stop relying on. So the
 * recording is the same in both arms — *had the drain finished before the
 * resume landed?* — and the two arms assert opposite answers. A build where the
 * option silently did nothing fails the `exit` arm; one where it fired
 * unconditionally fails the `hold` arm.
 *
 * ## Keeping the board's workers off the reviewer's task
 *
 * A parked row has to be `in_progress` first (`pending → awaiting_review` is not
 * a legal transition), so the sibling actor claims the task before parking it.
 * Between its `addTask` and its `claim` an idle board worker could take it
 * instead, which would make these tests flaky rather than wrong. The board's
 * dispatcher therefore narrows eligibility: a task the reviewer owns is
 * invisible to board workers until it has been claimed once (`attempts > 0`),
 * which is exactly the state a resumed task is in. So the race is closed and
 * the re-entry path — a board worker claiming the resumed row — still runs.
 */
import { describe, expect, it } from "vitest";
import { handler, sequencer } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  defineTaskCollection,
  type Task,
  type TaskCollectionRef,
  type TaskDispatcher,
  type TaskWorker,
} from "../../src/tasks";
import {
  taskBoard,
  taskBoardStateSchema,
  taskWorkerInputSchema,
  type TaskBoardOnReview,
} from "../../src/task-board";

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}
function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The assignee the sibling actor's tasks carry. */
const REVIEWER_OWNED = "reviewer-owned";

/**
 * `fifo`, narrowed so board workers cannot race the reviewer for a task it is
 * about to claim, and counting attempts so a spinning worker is measurable.
 */
function boardDispatcher(attempts: { total: number }): TaskDispatcher {
  return {
    async claim(collection, workerId) {
      attempts.total += 1;
      return collection.claim(workerId, {
        eligibility: (task: Task) =>
          task.assignee !== REVIEWER_OWNED || task.attempts > 0,
      });
    },
  };
}

interface Scenario {
  boardName: string;
  processed: string[];
  attempts: { total: number };
  observed: {
    drainDoneBeforeResume?: boolean;
    askStatusAtCheck?: string;
  };
  tasksAfter: () => TaskCollectionRef;
}

let scenarioSeq = 0;

/**
 * A durable board holding one gate task, plus a sibling actor that parks a
 * second task for review while the board's only worker is busy on the gate.
 *
 * The gate exists so the drain is provably still alive at the moment the park
 * lands — otherwise a board with nothing to do would have exited before the
 * actor got started, and the test would be about nothing.
 */
function buildScenario(config: {
  onReview: TaskBoardOnReview;
  idlePollMs?: number;
}): {
  root: ReturnType<typeof sequencer>;
  scenario: Scenario;
} {
  scenarioSeq += 1;
  const boardName = `park-exit-board-${scenarioSeq}`;
  const processed: string[] = [];
  const attempts = { total: 0 };
  const observed: Scenario["observed"] = {};
  const drain = { done: false };
  const gate = deferred();
  const gateClaimed = deferred();
  let collectionRef: TaskCollectionRef | undefined;

  const worker = handler({
    name: `${boardName}-worker`,
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ ok: z.string() }),
    execute: async (input) => {
      if (input.taskId === "gate") {
        gateClaimed.resolve();
        await gate.promise;
      }
      processed.push(input.taskId);
      return { ok: input.taskId };
    },
  }) as TaskWorker;

  const board = taskBoard({
    name: boardName,
    collection: defineTaskCollection({
      id: `park-exit-${scenarioSeq}`,
      scope: "session",
      stateSchema: z.object({ topic: z.string() }),
    }),
    concurrency: 1,
    dispatcher: boardDispatcher(attempts),
    workers: worker,
    initialTasks: [{ id: "gate", goal: "gate", input: { topic: "g" } }],
    onReview: config.onReview,
    idlePollMs: config.idlePollMs ?? 2,
    maxIterations: 20,
  });

  const actor = handler({
    name: `${boardName}-actor`,
    inputSchema: z.unknown(),
    uses: [board.capability],
    execute: async (_input, ctx) => {
      const tasks: TaskCollectionRef = await ctx.cap[boardName].tasks();
      collectionRef = tasks;

      // Ordered by the worker's own signal, not by a clock: the park must land
      // while the board is provably mid-drain.
      await gateClaimed.promise;

      await tasks.addTask({
        id: "ask",
        goal: "ask",
        assignee: REVIEWER_OWNED,
        input: { topic: "a" },
      });
      await tasks.claim("reviewer", { eligibility: (t) => t.id === "ask" });
      await tasks.awaitReview("ask", "needs a human");

      gate.resolve();

      // Long enough for a released drain to finish and return, and far short of
      // what a held one needs to exhaust its budget (20 iterations against a
      // 200ms idle wait).
      await delay(150);
      observed.drainDoneBeforeResume = drain.done;
      observed.askStatusAtCheck = tasks.get("ask")?.status;

      await tasks.resumeFromReview("ask", "approved, carry on");
    },
  });

  const markDrainDone = handler({
    name: `${boardName}-mark-done`,
    inputSchema: z.unknown(),
    outputSchema: z.null(),
    execute: () => {
      drain.done = true;
      return null;
    },
  });

  const root = sequencer({
    name: `${boardName}-root`,
    inputSchema: z.unknown(),
    stateSchema: taskBoardStateSchema,
  }).stepAll([
    sequencer({ name: `${boardName}-drain-branch`, inputSchema: z.unknown() })
      .tap(board.drain)
      .tap(markDrainDone),
    actor,
  ]);

  return {
    root,
    scenario: {
      boardName,
      processed,
      attempts,
      observed,
      tasksAfter: () => collectionRef!,
    },
  };
}

/** The `terminationReason` on the board's completion item. */
function reasonFrom(items: readonly unknown[]): string | undefined {
  type MetaItem = { type?: string; component?: string; data?: unknown };
  const meta = (items as MetaItem[]).find(
    (i) => i.type === "component" && i.component === "task-board-meta"
  );
  return (meta?.data as { terminationReason?: string } | undefined)?.terminationReason;
}

describe("onReview — the flip: does the drain outlive the park?", () => {
  it("holds the request open on the default, exactly as it does today", async () => {
    const { root, scenario } = buildScenario({ onReview: "hold" });

    const result = await testBlock(root, { input: undefined });

    expect(result.error).toBeNull();
    // The recording this whole file turns on: the drain had NOT finished when
    // the parked task was resumed.
    expect(scenario.observed.drainDoneBeforeResume).toBe(false);
    expect(scenario.observed.askStatusAtCheck).toBe("awaiting_review");
    // And it went on to do the work once the human answered.
    expect(scenario.processed).toEqual(["gate", "ask"]);
    expect(reasonFrom(result.items)).toBe("all-completed");
  });

  it("returns while the task is still parked when the board asks for it", async () => {
    const { root, scenario } = buildScenario({ onReview: "exit" });

    const result = await testBlock(root, { input: undefined });

    expect(result.error).toBeNull();
    // The same recording, the opposite answer. This is the assertion the mode
    // exists for, and it is the one a build where the option did nothing fails.
    expect(scenario.observed.drainDoneBeforeResume).toBe(true);
    // The row was still parked at that moment — the drain did not settle it,
    // cancel it, or otherwise tidy it away on the way out.
    expect(scenario.observed.askStatusAtCheck).toBe("awaiting_review");
    // Only the gate ran. The parked work was left for a later drain.
    expect(scenario.processed).toEqual(["gate"]);
    expect(reasonFrom(result.items)).toBe("parked-for-review");
    // The resume re-queued it and started nothing — the documented non-goal.
    expect(scenario.tasksAfter().get("ask")?.status).toBe("pending");
    // And it did not get there by burning its iteration budget.
    expect(scenario.attempts.total).toBeLessThan(10);
  });
});

describe("onReview: 'exit' — the second path: a worker asleep when the board becomes eligible", () => {
  /**
   * BP-035's reachable new path. The exit check and the wake predicate have to
   * agree, or a worker already parked in its idle wait sits there until the
   * timeout and the exit is *late* rather than absent — which is the shape of
   * defect a test that only checks "the drain returned" would miss entirely.
   *
   * So the idle-wait timeout is set to 20 seconds. A worker woken by the park
   * finishes in milliseconds; one that has to time out cannot come in under the
   * bound asserted below, whatever the machine.
   */
  it("wakes on the park instead of sleeping to its idle timeout", async () => {
    const boardName = "park-exit-asleep";
    const processed: string[] = [];
    const gate = deferred();
    const gateClaimed = deferred();
    const drain = { done: false };
    const timing: { parkedAt?: number; doneAt?: number } = {};
    const attempts = { total: 0 };

    const worker = handler({
      name: `${boardName}-worker`,
      inputSchema: taskWorkerInputSchema,
      outputSchema: z.object({ ok: z.string() }),
      execute: async (input) => {
        if (input.taskId === "gate") {
          gateClaimed.resolve();
          await gate.promise;
        }
        processed.push(input.taskId);
        return { ok: input.taskId };
      },
    }) as TaskWorker;

    const board = taskBoard({
      name: boardName,
      collection: defineTaskCollection({
        id: "park-exit-asleep",
        scope: "session",
        stateSchema: z.object({ topic: z.string() }),
      }),
      concurrency: 1,
      dispatcher: boardDispatcher(attempts),
      workers: worker,
      initialTasks: [{ id: "gate", goal: "gate", input: { topic: "g" } }],
      onReview: "exit",
      // 200ms poll ⇒ a 20s idle-wait timeout. Three orders of magnitude between
      // "woken by the park" and "woken by the clock".
      idlePollMs: 200,
      maxIterations: 20,
    });

    const actor = handler({
      name: `${boardName}-actor`,
      inputSchema: z.unknown(),
      uses: [board.capability],
      execute: async (_input, ctx) => {
        const tasks: TaskCollectionRef = await ctx.cap[boardName].tasks();
        await gateClaimed.promise;

        // Claimed but NOT parked yet, so the board still has a waitable row
        // when its worker finishes the gate and goes back to sleep.
        await tasks.addTask({
          id: "ask",
          goal: "ask",
          assignee: REVIEWER_OWNED,
          input: { topic: "a" },
        });
        await tasks.claim("reviewer", { eligibility: (t) => t.id === "ask" });

        gate.resolve();

        // Let the worker finish the gate, find nothing claimable, and settle
        // into its 20-second wait. Its next scheduled wake is far past the
        // bound this test asserts.
        await delay(200);
        expect(drain.done).toBe(false);

        timing.parkedAt = Date.now();
        await tasks.awaitReview("ask", "needs a human");
      },
    });

    const markDrainDone = handler({
      name: `${boardName}-mark-done`,
      inputSchema: z.unknown(),
      outputSchema: z.null(),
      execute: () => {
        drain.done = true;
        timing.doneAt = Date.now();
        return null;
      },
    });

    const root = sequencer({
      name: `${boardName}-root`,
      inputSchema: z.unknown(),
      stateSchema: taskBoardStateSchema,
    }).stepAll([
      sequencer({ name: `${boardName}-drain-branch`, inputSchema: z.unknown() })
        .tap(board.drain)
        .tap(markDrainDone),
      actor,
    ]);

    const result = await testBlock(root, { input: undefined });

    expect(result.error).toBeNull();
    expect(processed).toEqual(["gate"]);
    expect(reasonFrom(result.items)).toBe("parked-for-review");
    // The measurement. A wake predicate that did not learn about park-exit
    // leaves this at ~20_000.
    const wokenIn = timing.doneAt! - timing.parkedAt!;
    expect(wokenIn).toBeLessThan(3_000);
  }, 40_000);
});

describe("onReview: 'exit' — the return trip", () => {
  it("re-claims the resumed task on a second drain, and grows no duplicate", async () => {
    // The path the mode exists to create, walked end to end rather than
    // reasoned about: park → resume → a SECOND drain over the same durable
    // board. A test that stopped at the first drain's return would never
    // re-seed, and so could not see the duplicate-task defect the id-less-seed
    // refusal exists to prevent.
    const boardName = "park-exit-reentry";
    const processed: string[] = [];
    const gate = deferred();
    const gateClaimed = deferred();
    const attempts = { total: 0 };
    const checkpoint: {
      askStatus?: string;
      gateStatus?: string;
      elapsed?: number;
      taskCount?: number;
    } = {};
    const startedAt = Date.now();
    let collectionRef: TaskCollectionRef | undefined;

    const worker = handler({
      name: `${boardName}-worker`,
      inputSchema: taskWorkerInputSchema,
      outputSchema: z.object({ ok: z.string() }),
      execute: async (input) => {
        if (input.taskId === "gate") {
          gateClaimed.resolve();
          await gate.promise;
        }
        processed.push(input.taskId);
        return { ok: input.taskId };
      },
    }) as TaskWorker;

    const board = taskBoard({
      name: boardName,
      collection: defineTaskCollection({
        id: "park-exit-reentry",
        scope: "session",
        stateSchema: z.object({ topic: z.string() }),
      }),
      concurrency: 1,
      dispatcher: boardDispatcher(attempts),
      workers: worker,
      initialTasks: [{ id: "gate", goal: "gate", input: { topic: "g" } }],
      onReview: "exit",
      idlePollMs: 2,
      maxIterations: 20,
    });

    const parkIt = handler({
      name: `${boardName}-park-it`,
      inputSchema: z.unknown(),
      uses: [board.capability],
      execute: async (_input, ctx) => {
        const tasks: TaskCollectionRef = await ctx.cap[boardName].tasks();
        collectionRef = tasks;
        await gateClaimed.promise;
        await tasks.addTask({
          id: "ask",
          goal: "ask",
          assignee: REVIEWER_OWNED,
          input: { topic: "a" },
        });
        await tasks.claim("reviewer", { eligibility: (t) => t.id === "ask" });
        await tasks.awaitReview("ask", "needs a human");
        gate.resolve();
      },
    });

    // Runs between the two drains: the human's answer arriving after the
    // launching drain has already returned.
    const resumeIt = handler({
      name: `${boardName}-resume-it`,
      inputSchema: z.unknown(),
      outputSchema: z.null(),
      uses: [board.capability],
      execute: async (_input, ctx) => {
        const tasks: TaskCollectionRef = await ctx.cap[boardName].tasks();
        checkpoint.askStatus = tasks.get("ask")?.status;
        checkpoint.gateStatus = tasks.get("gate")?.status;
        checkpoint.elapsed = Date.now() - startedAt;
        checkpoint.taskCount = tasks.count();
        await tasks.resumeFromReview("ask", "approved, carry on");
        return null;
      },
    });

    const root = sequencer({
      name: `${boardName}-root`,
      inputSchema: z.unknown(),
      stateSchema: taskBoardStateSchema,
    }).stepAll([
      sequencer({ name: `${boardName}-drain-branch`, inputSchema: z.unknown() })
        .tap(board.drain)
        .tap(resumeIt)
        .tap(board.drain),
      parkIt,
    ]);

    const result = await testBlock(root, { input: undefined });

    expect(result.error).toBeNull();

    // The first drain returned with the row still parked, and it did not get
    // there by exhausting its budget — 20 iterations against a 200ms idle wait
    // could not be spent inside this bound.
    expect(checkpoint.askStatus).toBe("awaiting_review");
    expect(checkpoint.gateStatus).toBe("completed");
    expect(checkpoint.elapsed).toBeLessThan(2_000);
    expect(checkpoint.taskCount).toBe(2);

    // The second drain re-seeded, claimed the resumed row, and ran it.
    expect(processed).toEqual(["gate", "ask"]);
    expect(reasonFrom(result.items)).toBe("all-completed");

    // And the re-seed grew nothing. This is the assertion that needs the second
    // drain to exist at all.
    const tasks = collectionRef!;
    expect(tasks.count()).toBe(2);
    expect(tasks.list().map((t) => t.id).sort()).toEqual(["ask", "gate"]);
    expect(tasks.count({ status: "completed" })).toBe(2);
  });
});

describe("onReview: 'exit' — two drains of one board, concurrently, in one request", () => {
  /**
   * What this pins, and what it deliberately does not.
   *
   * The invocation-scope property itself — that a drain's reported reason is
   * the one *its own* pool decided — is asserted directly in
   * `task-board-park-exit-report.test.ts` ("reports two different reasons for
   * one collection read at one instant"), because it is the only place the two
   * candidate implementations can be told apart deterministically.
   *
   * The spec asked for a same-request pair of concurrent drains reporting
   * *different* reasons. That is not constructible on the real board, and the
   * reason is worth writing down rather than working around: two drains of one
   * board read one collection, and the exit question is a pure function of it,
   * so both drains answer identically at any instant either can ask. Forcing
   * them apart would need the state to change between two exit checks that fire
   * on the same event — a race, not a fixture.
   *
   * What IS worth walking here is that concurrent drains over one durable board
   * behave: neither runs the parked row, neither settles it, and both return.
   * Note that the assertion is on the drains' *behaviour*, never on the final
   * keyed snapshot of the completion item — two concurrent drains collapse to
   * one item under the shared collection key, which is FIX-1236's defect and
   * not this issue's to fix or to test.
   *
   * The board here declares no `initialTasks` and its work is added by the step
   * ahead of the drains, which is a deliberate detour around a **pre-existing**
   * defect this test found: two concurrent drains of one durable board both run
   * the seed step, and its replay dedupe is a read-then-write that is not atomic
   * across them, so the second `addTasks` throws `resource_already_exists`.
   * Reproduced with `onReview` left at its default and nothing parked anywhere,
   * so it predates park-exit and is out of scope here — reported on the PR.
   */
  it("both return, and neither runs nor settles the parked row", async () => {
    const boardName = "park-exit-concurrent";
    const processed: string[] = [];
    const gate = deferred();
    const gateClaimed = deferred();
    const attempts = { total: 0 };
    const finished: string[] = [];
    let collectionRef: TaskCollectionRef | undefined;

    const worker = handler({
      name: `${boardName}-worker`,
      inputSchema: taskWorkerInputSchema,
      outputSchema: z.object({ ok: z.string() }),
      execute: async (input) => {
        if (input.taskId === "gate") {
          gateClaimed.resolve();
          await gate.promise;
        }
        processed.push(input.taskId);
        return { ok: input.taskId };
      },
    }) as TaskWorker;

    const board = taskBoard({
      name: boardName,
      collection: defineTaskCollection({
        id: "park-exit-concurrent",
        scope: "session",
        stateSchema: z.object({ topic: z.string() }),
      }),
      concurrency: 1,
      dispatcher: boardDispatcher(attempts),
      workers: worker,
      onReview: "exit",
      idlePollMs: 2,
      maxIterations: 20,
    });

    // Seeds the gate before either drain starts, so both find work to do.
    const setup = handler({
      name: `${boardName}-setup`,
      inputSchema: z.unknown(),
      outputSchema: z.null(),
      uses: [board.capability],
      execute: async (_input, ctx) => {
        const tasks: TaskCollectionRef = await ctx.cap[boardName].tasks();
        await tasks.addTask({ id: "gate", goal: "gate", input: { topic: "g" } });
        return null;
      },
    });

    const markDone = (label: string) =>
      handler({
        name: `${boardName}-done-${label}`,
        inputSchema: z.unknown(),
        outputSchema: z.null(),
        execute: () => {
          finished.push(label);
          return null;
        },
      });

    const actor = handler({
      name: `${boardName}-actor`,
      inputSchema: z.unknown(),
      uses: [board.capability],
      execute: async (_input, ctx) => {
        const tasks: TaskCollectionRef = await ctx.cap[boardName].tasks();
        collectionRef = tasks;
        await gateClaimed.promise;
        await tasks.addTask({
          id: "ask",
          goal: "ask",
          assignee: REVIEWER_OWNED,
          input: { topic: "a" },
        });
        await tasks.claim("reviewer", { eligibility: (t) => t.id === "ask" });
        await tasks.awaitReview("ask", "needs a human");
        gate.resolve();
      },
    });

    const root = sequencer({
      name: `${boardName}-root`,
      inputSchema: z.unknown(),
      stateSchema: taskBoardStateSchema,
    })
      .step(setup)
      .stepAll([
        sequencer({ name: `${boardName}-branch-a`, inputSchema: z.unknown() })
          .tap(board.drain)
          .tap(markDone("a")),
        sequencer({ name: `${boardName}-branch-b`, inputSchema: z.unknown() })
          .tap(board.drain)
          .tap(markDone("b")),
        actor,
      ]);

    const startedAt = Date.now();
    const result = await testBlock(root, { input: undefined });
    const elapsed = Date.now() - startedAt;

    expect(result.error).toBeNull();
    // Both drains returned rather than one holding the request open.
    expect(finished.sort()).toEqual(["a", "b"]);
    // And they returned because the park released them, not because both burned
    // their iteration budgets — 20 iterations against a 200ms idle wait cannot
    // be spent inside this bound. Without it this test passes with the mode
    // doing nothing, which is the failure the epic keeps producing.
    expect(elapsed).toBeLessThan(2_000);
    // The gate ran once — CAS dispatch, not two pools doing the same work.
    expect(processed).toEqual(["gate"]);

    const tasks = collectionRef!;
    // The parked row is untouched by either drain.
    expect(tasks.get("ask")?.status).toBe("awaiting_review");
    expect(tasks.list().map((t) => t.id).sort()).toEqual(["ask", "gate"]);
  });
});
