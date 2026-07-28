/**
 * Goal check — a board whose worker's result lands on an already-settled task
 * finishes the rest of its work instead of dying partway.
 *
 * Drives the REAL path: `runAction` over a real flow, a real `taskBoard`
 * draining real tasks through the real substrate, with the real engine's
 * stores and item stream. Nothing is mocked, and nothing needs to be — the
 * race is seeded deterministically by having one worker settle its own task
 * before returning, which is what a coordinator cancelling mid-flight
 * produces. See goal.md for why this goal is model-free.
 *
 * Held-out: the task names, the settle reason, and the salt every sibling
 * worker echoes all come from fixtures/input.json. Swap any of them and a
 * correct implementation still passes; nothing is asserted against a literal.
 *
 * Run: pnpm tsx goals/task-board/contains-a-worker-outcome-that-lands-on-a-settled-task/run.mts
 */
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { runAction } from "@flow-state-dev/engine";
import {
  taskBoard,
  taskBoardStateSchema,
  taskWorkerInputSchema,
} from "@flow-state-dev/orchestration/task-board";
import { getOrCreateTaskCollection } from "@flow-state-dev/orchestration";
import {
  durableStores,
  loadFixture,
  registryFor,
  runGoal,
  stripIntentOverrides,
} from "../../lib/index.mts";

interface Fixture {
  salt: string;
  settledTask: string;
  siblingTasks: string[];
  settleReason: string;
}

const COLLECTION_ID = "settled-task-board";

// This flow declares no generator intents, so clear any pinned intent-ladder
// overrides before the engine builds its execution context.
stripIntentOverrides();

await runGoal(async () => {
  const fixture = loadFixture<Fixture>(import.meta.url);
  const failures: string[] = [];

  if (fixture.siblingTasks.length < 2) {
    return {
      failures: ["fixture must supply at least two sibling tasks for abandonment to be visible"],
      evidence: "",
    };
  }

  const worker = handler({
    name: "settled-task-worker",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ receipt: z.string() }),
    execute: async (input, ctx) => {
      if (input.goal !== fixture.settledTask) {
        return { receipt: `${input.goal}/${fixture.salt}` };
      }
      // Settle the task out from under the worker still holding it, then
      // finish normally. Cancelling a task does not stop the worker already
      // running it, so a healthy worker returning here is the ordinary shape,
      // not the exotic one.
      const collection = await getOrCreateTaskCollection({
        ctx,
        backing: "request",
        collectionId: COLLECTION_ID,
      });
      await collection.cancel(input.taskId, fixture.settleReason);
      return { receipt: `${input.goal}/${fixture.salt}` };
    },
  }) as Parameters<typeof taskBoard>[0]["workers"];

  const board = taskBoard({
    name: COLLECTION_ID,
    collection: { backing: "request", collectionId: COLLECTION_ID },
    concurrency: 2,
    workers: worker,
    initialTasks: [
      { id: fixture.settledTask, goal: fixture.settledTask },
      ...fixture.siblingTasks.map((id) => ({ id, goal: id })),
    ],
    onError: "skip",
    onIdle: "complete",
    maxIterations: 200,
  });

  const flow = defineFlow({
    kind: "goal-settled-task-containment",
    actions: {
      run: {
        block: sequencer({
          name: "settled-task-root",
          inputSchema: z.unknown(),
          stateSchema: taskBoardStateSchema,
        }).step(board.drain),
      },
    },
  })({ id: "default" });

  const { stores, runtimeConfig } = durableStores();
  registryFor(flow);

  const result = await runAction({
    flow: flow as never,
    actionName: "run",
    input: {},
    userId: "goal-user",
    stores,
    runtimeConfig: runtimeConfig as never,
  });

  const record = await stores.request.get(result.requestId!);
  if (record?.status !== "completed") {
    failures.push(`expected the board run to complete, got status "${record?.status}"`);
  }

  // Read the outcome off the emitted `task-change` stream rather than off the
  // drain's return value: a board that abandoned its siblings still returns
  // something, so the return value cannot discriminate.
  type TaskChangeRow = {
    type?: string;
    data?: {
      collectionId?: string;
      task?: { id?: string; status?: string; output?: { receipt?: string }; error?: string };
    };
  };
  const changes = ((record?.items ?? []) as unknown as TaskChangeRow[]).filter(
    (i) => i.type === "component" && i.data?.collectionId === COLLECTION_ID
  );

  const latest = new Map<string, { status?: string; receipt?: string; error?: string }>();
  for (const change of changes) {
    // The board also emits a meta component on the same collection id; only
    // the per-task lifecycle rows carry a `task`.
    const task = change.data?.task;
    if (task?.id === undefined) continue;
    latest.set(task.id, {
      status: task.status,
      receipt: task.output?.receipt,
      error: task.error,
    });
  }

  // The settled task keeps the status its settler chose, with its own reason.
  const settled = latest.get(fixture.settledTask);
  if (settled?.status !== "cancelled") {
    failures.push(
      `expected "${fixture.settledTask}" to hold the status its settler chose (cancelled), got "${settled?.status}"`
    );
  }
  if (settled?.error !== fixture.settleReason) {
    failures.push(
      `expected the settler's own reason to survive the late worker result, got "${settled?.error}"`
    );
  }

  // Every sibling ran to completion AND carries the held-out salt. Asserting
  // the status alone would pass for a board that recorded a status without
  // ever running the worker.
  for (const id of fixture.siblingTasks) {
    const sibling = latest.get(id);
    if (sibling?.status !== "completed") {
      failures.push(`expected sibling "${id}" to reach completed, got "${sibling?.status}"`);
      continue;
    }
    if (sibling.receipt !== `${id}/${fixture.salt}`) {
      failures.push(
        `expected sibling "${id}" output to carry the held-out salt, got "${sibling.receipt}"`
      );
    }
  }

  return {
    failures,
    evidence: `${fixture.siblingTasks.length} siblings drained with the held-out salt; "${fixture.settledTask}" held cancelled with its settler's reason; run status "${record?.status}"`,
  };
});
