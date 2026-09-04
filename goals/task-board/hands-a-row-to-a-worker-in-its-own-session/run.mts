/**
 * Goal check — a board seat holding a dispatcher hands its claimed row to a
 * worker that runs in its own session, and the durable row comes back settled
 * with that worker's output.
 *
 * ## What is real here, and what the goal would prove nothing without
 *
 * - **A real `createFlowState` runtime.** The dispatch operation is installed by
 *   `createFlowState`; a script that only calls `runAction` has no request host,
 *   and every hand-off scenario in `integration-tests` supplies its own
 *   `dispatchOperation` stub and replays the envelope by hand. Those prove the
 *   claim/gate logic. They cannot prove that the real host accepts the dispatch,
 *   mints the child, and runs the entry — which is the whole seam.
 * - **A real child session.** Asserted, not assumed: the row settling proves
 *   work happened, not that it happened elsewhere. An inline seat would settle
 *   the same row from the drain's own session.
 * - **The real shutdown drain.** `dispose()` is what a host does on SIGTERM, and
 *   it is what waits for the dispatched children. Reading the rows before it
 *   returns would read them mid-flight.
 *
 * Held-out: the seat name, the entry name, the task ids and goals, and the salt
 * every worker echoes all come from fixtures/input.json. The seat and the entry
 * are deliberately DIFFERENT strings — a board that quietly addressed the entry
 * by its seat name would pass a fixture that spelled them the same.
 *
 * Run: pnpm tsx goals/task-board/hands-a-row-to-a-worker-in-its-own-session/run.mts
 */
import { defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { defineTaskCollection } from "@flow-state-dev/orchestration/tasks";
import type { TaskWorker, TaskWorkerInput } from "@flow-state-dev/orchestration/tasks";
import { taskBoard, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import { loadFixture, runGoal, silentLogger, stripIntentOverrides } from "../../lib/index.mts";

interface Fixture {
  salt: string;
  seat: string;
  entry: string;
  tasks: { id: string; goal: string }[];
}

const KIND = "goal-task-hand-off";
const COLLECTION_ID = `${KIND}-ledger`;
const BOARD_ID = `${KIND}-board`;
const USER_ID = "goal-user";
const PARENT_SESSION = "sess_goal_hand_off_parent";

/** A settled row, as the ledger stores it. */
type LedgerRow = {
  status?: string;
  output?: { receipt?: string; ranIn?: string };
};

// This flow declares no generator intents, so clear any pinned intent-ladder
// overrides before the engine builds its execution context.
stripIntentOverrides();

await runGoal(async () => {
  const fixture = loadFixture<Fixture>(import.meta.url);
  const failures: string[] = [];

  if (fixture.seat === fixture.entry) {
    return {
      failures: ["fixture must name the seat and the entry differently, or the indirection is untested"],
      evidence: "",
    };
  }

  // A real side effect, not item de-duplication: a board that re-dispatched a
  // row forever, or ran it twice, is only visible as a count.
  const runsByTask = new Map<string, number>();

  const worker = handler({
    name: "hand-off-goal-worker",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ receipt: z.string(), ranIn: z.string() }),
    execute: async (input: TaskWorkerInput, ctx) => {
      runsByTask.set(input.taskId, (runsByTask.get(input.taskId) ?? 0) + 1);
      // Written into the row so the session the work ran in is read back off
      // the ledger, not inferred from the runtime that wrote it.
      const ranIn = ctx.session.identity.id;
      return { receipt: `${input.goal}/${fixture.salt}`, ranIn };
    },
  }) as unknown as TaskWorker;

  const board = taskBoard({
    name: BOARD_ID,
    boardId: BOARD_ID,
    collection: defineTaskCollection({ id: COLLECTION_ID, scope: "user" }),
    workers: {
      // The seat is a dispatcher, so the rows it claims run elsewhere. The flow
      // below declares what runs there.
      [fixture.seat]: dispatcher({
        name: `${BOARD_ID}-hand-off`,
        type: "task",
        target: fixture.entry,
        session: "per-task",
      }) as unknown as TaskWorker,
    },
    initialTasks: fixture.tasks.map((t) => ({ ...t, assignee: fixture.seat })),
    onIdle: "complete",
    maxIterations: 200,
  });

  const flow = defineFlow({
    kind: KIND,
    actions: { run: { block: board.drain } },
    task: { actions: { [fixture.entry]: { block: worker } } },
  })({ id: KIND });

  if (board.handedOff.length !== 1) {
    failures.push(`expected the board to report one handed-off seat, got ${board.handedOff.length}`);
  }

  const { createFlowState, runAction, inMemoryStores } = await import("@flow-state-dev/engine");

  function neverResolvesAModel(): never {
    throw new Error("this goal declares no generator actions — nothing here resolves a model");
  }

  const state = createFlowState({
    flows: { [KIND]: flow },
    modelResolver: Object.assign(neverResolvesAModel, {
      resolveId: neverResolvesAModel,
    }) as never,
    stores: { prod: { primary: inMemoryStores() } },
    defaultProfile: "prod",
    logger: silentLogger,
  } as never);

  let parentStatus: string | undefined;
  let childSessions: { id: string; coordinate?: string; topic?: string }[] = [];
  let rows = new Map<string, LedgerRow | undefined>();

  try {
    const runtime = await state.getRuntime();
    const stores = runtime.stores as never as {
      request: { get(id: string): Promise<{ status?: string } | undefined> };
      session: {
        list(options?: { parentage?: { parentOf: string } }): Promise<
          { id: string; coordinate?: string; topic?: string }[]
        >;
      };
      resourceState: {
        get(scope: string, owner: string, key: string): Promise<{ state?: unknown } | undefined>;
      };
    };

    const result = await runAction({
      flow: flow as never,
      actionName: "run",
      input: {},
      userId: USER_ID,
      sessionId: PARENT_SESSION,
      stores: runtime.stores as never,
      runtimeConfig: runtime.runtimeConfig as never,
    });

    parentStatus = (await stores.request.get(result.requestId!))?.status;

    // The dispatched children run in this process and are tracked for the
    // shutdown drain. Rows read before this returns are read mid-flight.
    await state.dispose();

    childSessions = await stores.session.list({ parentage: { parentOf: PARENT_SESSION } });
    for (const task of fixture.tasks) {
      const record = await stores.resourceState.get("user", USER_ID, `${COLLECTION_ID}/${task.id}`);
      rows.set(task.id, record?.state as LedgerRow | undefined);
    }
  } finally {
    await state.dispose().catch(() => undefined);
  }

  if (parentStatus !== "completed") {
    failures.push(`expected the drain request to complete, got status "${parentStatus}"`);
  }

  // 1. The work actually happened: the row carries the held-out salt, not just
  //    a terminal status a board could write without running anything.
  for (const task of fixture.tasks) {
    const row = rows.get(task.id);
    if (row?.status !== "completed") {
      failures.push(`expected row "${task.id}" to settle completed, got "${row?.status}"`);
      continue;
    }
    if (row.output?.receipt !== `${task.goal}/${fixture.salt}`) {
      failures.push(
        `expected row "${task.id}" output to carry the held-out salt, got "${row.output?.receipt}"`
      );
    }
  }

  // 2. It happened ELSEWHERE: each row names a session that is not the drain's.
  //    An inline seat settles the same rows from the parent session and fails
  //    only here.
  for (const task of fixture.tasks) {
    const ranIn = rows.get(task.id)?.output?.ranIn;
    if (ranIn === undefined) continue;
    if (ranIn === PARENT_SESSION) {
      failures.push(`row "${task.id}" ran in the drain's own session — the seat did not hand off`);
    }
  }

  // 3. Exactly once per row. A redispatch loop settles the same rows and would
  //    pass every assertion above.
  for (const task of fixture.tasks) {
    const count = runsByTask.get(task.id) ?? 0;
    if (count !== 1) {
      failures.push(`expected the worker to run once for "${task.id}", ran ${count} times`);
    }
  }

  // 4. The children are the board's, addressed by the ENTRY name. A child
  //    coordinate spelling the seat would mean the entry was addressed by the
  //    wrong string and the fixture's differing names caught it.
  const perTask = childSessions.filter((s) => s.coordinate === `task:${fixture.entry}`);
  if (perTask.length !== fixture.tasks.length) {
    failures.push(
      `expected ${fixture.tasks.length} child sessions at coordinate "task:${fixture.entry}", got ` +
        `${perTask.length} of ${childSessions.length} children ` +
        `(coordinates: ${childSessions.map((s) => s.coordinate ?? "<none>").join(", ")})`
    );
  }

  const ranInIds = new Set(
    fixture.tasks.map((t) => rows.get(t.id)?.output?.ranIn).filter((v): v is string => v !== undefined)
  );
  if (ranInIds.size !== fixture.tasks.length) {
    failures.push(
      `expected one child session per row under \`per-task\`, got ${ranInIds.size} distinct sessions ` +
        `for ${fixture.tasks.length} rows`
    );
  }

  return {
    failures,
    evidence:
      `${fixture.tasks.length} rows handed off from seat "${fixture.seat}" to entry "${fixture.entry}", ` +
      `each settled completed with the held-out salt, each run exactly once in its own child session ` +
      `(${[...ranInIds].join(", ")}) distinct from the drain's "${PARENT_SESSION}"; ` +
      `${perTask.length} children at coordinate "task:${fixture.entry}"; drain status "${parentStatus}"`,
  };
});
