/**
 * LAB-133 spec-poc — Decision 2 state-space map.
 *
 * THROWAWAY. Never merges. See spec-poc/README.md.
 *
 * Settles: for every task-board settlement route decision 2 touches or is
 * adjacent to (complete, fail-with-budget, fail-without-budget,
 * fail-exhausted, cancel), what actually happens to:
 *   1. the task's status
 *   2. whether a REAL dependent task (deps: [target]) gets unblocked and runs
 *   3. what the board's `task-board-meta` completed item reports
 *   4. whether the row is claimable by a fresh attempt
 *   5. whether anything is retried automatically, with no external trigger
 *
 * Real board, real collection ("request" backing), real recordSuccess /
 * recordError blocks -- the same ones the detached runner uses (see
 * detached-runner.mts for the detached-specific claims). Nothing here is
 * mocked except the model resolver, which nothing in this file calls.
 *
 * Run: pnpm tsx spec-poc/LAB-133-decision-2-state-space/route-map.mts
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { runAction, createInMemoryStores } from "@flow-state-dev/engine";
import { taskBoard, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import {
  getOrCreateTaskCollection,
  ticketForClaim,
  type TaskWorkerInput,
} from "@flow-state-dev/orchestration/tasks";
import { createMockModelResolver } from "@flow-state-dev/testing";

const USER_ID = "poc-user";
const baseRuntimeConfig = () => ({ modelResolver: createMockModelResolver({}) });

type TaskRow = {
  id?: string;
  status?: string;
  attempts?: number;
  error?: string;
  retryLedger?: { granted?: number; deniedByBudget?: boolean };
};
type ComponentRow = {
  type?: string;
  data?: {
    collectionId?: string;
    task?: TaskRow;
    status?: string;
    terminationReason?: string;
    counts?: Record<string, number>;
  };
};

function extractOutcome(items: unknown[], collectionId: string) {
  const rows = (items as ComponentRow[]).filter(
    (i) => i.type === "component" && i.data?.collectionId === collectionId
  );
  const latestTask = new Map<string, TaskRow>();
  let meta: { terminationReason?: string; counts?: Record<string, number> } | undefined;
  for (const row of rows) {
    if (row.data?.task?.id !== undefined) {
      latestTask.set(row.data.task.id, row.data.task);
    } else if (row.data?.status === "completed") {
      meta = { terminationReason: row.data.terminationReason, counts: row.data.counts };
    }
  }
  return { latestTask, meta };
}

interface ScenarioResult {
  name: string;
  targetStatus: string | undefined;
  targetAttempts: number | undefined;
  retryLedger: string;
  dependentRan: boolean;
  terminationReason: string | undefined;
  autoRetried: boolean;
  notes: string;
}

async function runScenario(opts: {
  name: string;
  targetMaxAttempts?: number;
  targetWorker: (collectionId: string) => (input: TaskWorkerInput, ctx: unknown) => Promise<unknown>;
}): Promise<ScenarioResult> {
  const collectionId = `route-map-${opts.name}`;
  const targetId = "target";
  const stores = createInMemoryStores();

  const board = taskBoard({
    name: collectionId,
    collection: { backing: "request", collectionId },
    workers: {
      [targetId]: {
        worker: handler({
          name: `${opts.name}-target-worker`,
          inputSchema: taskWorkerInputSchema,
          outputSchema: z.unknown(),
          execute: opts.targetWorker(collectionId),
        }),
      },
      dep: {
        worker: handler({
          name: `${opts.name}-dep-worker`,
          inputSchema: taskWorkerInputSchema,
          outputSchema: z.object({ echoed: z.string() }),
          execute: async (input: TaskWorkerInput) => ({ echoed: input.goal }),
        }),
      },
    },
    initialTasks: [
      {
        id: targetId,
        goal: targetId,
        assignee: targetId,
        ...(opts.targetMaxAttempts !== undefined ? { maxAttempts: opts.targetMaxAttempts } : {}),
      },
      { id: "dep", goal: "dep", assignee: "dep", deps: [targetId] },
    ],
    onError: "skip",
    concurrency: 4,
    maxIterations: 200,
  });

  const flow = defineFlow({
    kind: collectionId,
    actions: { run: { block: board.drain } },
  })({ id: "default" });

  const result = await runAction({
    flow: flow as never,
    actionName: "run",
    input: {},
    userId: USER_ID,
    stores,
    runtimeConfig: baseRuntimeConfig() as never,
  });

  const { latestTask, meta } = extractOutcome(result.items, collectionId);
  const target = latestTask.get(targetId);
  const dep = latestTask.get("dep");

  return {
    name: opts.name,
    targetStatus: target?.status,
    targetAttempts: target?.attempts,
    retryLedger: target?.retryLedger
      ? `granted=${target.retryLedger.granted ?? 0} deniedByBudget=${String(target.retryLedger.deniedByBudget ?? false)}`
      : "(none)",
    dependentRan: dep?.status === "completed",
    terminationReason: meta?.terminationReason,
    autoRetried: (target?.attempts ?? 0) > 1,
    notes: "",
  };
}

async function runDisplacedClaimScenario(): Promise<ScenarioResult> {
  const collectionId = "route-map-displaced-claim";
  const stores = createInMemoryStores();
  const flow = defineFlow({
    kind: collectionId,
    actions: {
      run: {
        block: handler({
          name: "displaced-claim-probe",
          inputSchema: z.unknown(),
          outputSchema: z.unknown(),
          execute: async (_input: unknown, ctx: never) => {
            const collection = await getOrCreateTaskCollection({
              ctx,
              backing: "request",
              collectionId,
            });
            await collection.addTask({ id: "target", goal: "target", maxAttempts: 5 });

            // Claim #1 with a short lease so it can genuinely lapse.
            const claim1 = await collection.claim("worker-1", { leaseDurationMs: 1000 });
            if (claim1 === null) throw new Error("expected claim #1 to succeed");
            const ticket1 = ticketForClaim(collectionId, claim1);

            await new Promise((resolve) => setTimeout(resolve, 1150));

            // Successor recovers the abandoned row -- a REAL lease lapse, not a
            // simulated one.
            const claim2 = await collection.claim("worker-2");
            if (claim2 === null) throw new Error("expected successor claim to recover the lapsed row");
            const ticket2 = ticketForClaim(collectionId, claim2);

            // The displaced original worker tries to fail() against its stale ticket.
            const staleOutcome = await collection.fail(
              "target",
              "worker-1 believes it lost the run",
              { ifAllowed: true, claim: ticket1 }
            );
            const afterStaleWrite = collection.get("target");

            // The successor settles the row for real.
            const successorOutcome = await collection.complete("target", { ok: true }, {
              ifAllowed: true,
              claim: ticket2,
            });
            const final = collection.get("target");

            return {
              claim1Attempts: claim1.attempts,
              claim2Attempts: claim2.attempts,
              abandonments: claim2.abandonments ?? 0,
              staleOutcome,
              rowStatusAfterStaleWrite: afterStaleWrite?.status,
              rowAttemptsAfterStaleWrite: afterStaleWrite?.attempts,
              successorOutcome,
              finalStatus: final?.status,
            };
          },
        }),
      },
    },
  })({ id: "default" });

  const result = await runAction({
    flow: flow as never,
    actionName: "run",
    input: {},
    userId: USER_ID,
    stores,
    runtimeConfig: baseRuntimeConfig() as never,
  });
  if (result.error) {
    throw new Error(`displaced-claim scenario action failed: ${result.error.message}`);
  }
  const out = result.output as {
    claim1Attempts: number;
    claim2Attempts: number;
    abandonments: number;
    staleOutcome: { outcome: string; reason?: string };
    rowStatusAfterStaleWrite: string | undefined;
    rowAttemptsAfterStaleWrite: number | undefined;
    successorOutcome: { outcome: string };
    finalStatus: string | undefined;
  };

  const staleDeclinedCorrectly =
    out.staleOutcome.outcome === "declined" && out.staleOutcome.reason === "lost-claim";
  const rowWasUntouchedByStaleWrite =
    out.rowStatusAfterStaleWrite === "in_progress" &&
    out.rowAttemptsAfterStaleWrite === out.claim2Attempts;
  const successorOwnsIt =
    out.successorOutcome.outcome === "recorded" && out.finalStatus === "completed";

  return {
    name: "displaced-claim",
    targetStatus: out.finalStatus,
    targetAttempts: out.claim2Attempts,
    retryLedger: `abandonments=${out.abandonments}`,
    dependentRan: false, // not modeled in this scenario
    terminationReason: undefined,
    autoRetried: false,
    notes:
      `claim1.attempts=${out.claim1Attempts} claim2.attempts=${out.claim2Attempts} ` +
      `stale-fail-declined=${staleDeclinedCorrectly} (${out.staleOutcome.outcome}/${out.staleOutcome.reason ?? "-"}) ` +
      `row-untouched=${rowWasUntouchedByStaleWrite} successor-owns-it=${successorOwnsIt}`,
  };
}

async function main() {
  const results: ScenarioResult[] = [];

  // 1. Plain success.
  results.push(
    await runScenario({
      name: "success",
      targetWorker: () => async () => ({ ok: true }),
    })
  );

  // 2. THE decisive case: an agent-side failure that RETURNS (decision 2's
  // proposed signal for "failed on its own terms"), with retry budget
  // present -- to see whether it's consulted at all.
  results.push(
    await runScenario({
      name: "agent-failure-RETURNS",
      targetMaxAttempts: 5,
      targetWorker: () => async () => ({
        ok: false,
        resultSubtype: "error_during_execution",
        reason: "agent gave up on its own terms",
      }),
    })
  );

  // 3. Lost run (rethrow), retry budget remaining: does a FRESH ATTEMPT
  // actually pick the row up and finish the work.
  results.push(
    await runScenario({
      name: "lost-rethrow-budget-remaining",
      targetMaxAttempts: 3,
      targetWorker: () => async (input: TaskWorkerInput) => {
        if (input.attempts === 1) throw new Error("simulated lost run (abort) on attempt 1");
        return { ok: true, recoveredOnAttempt: input.attempts };
      },
    })
  );

  // 4. Lost run (rethrow), maxAttempts UNSET (the default) -- the corrected
  // claim: written off on the first failure.
  results.push(
    await runScenario({
      name: "lost-rethrow-no-budget(default)",
      targetWorker: () => async () => {
        throw new Error("simulated lost run (abort), no retry allowance configured");
      },
    })
  );

  // 5. Lost run (rethrow), maxAttempts SET but exhausted after repeated
  // failures -- distinct code path from #4 even though both end terminal.
  results.push(
    await runScenario({
      name: "lost-rethrow-budget-exhausted",
      targetMaxAttempts: 2,
      targetWorker: () => async () => {
        throw new Error("simulated lost run (abort), every attempt");
      },
    })
  );

  // 6. cancel() -- the route nobody in this thread had examined. Worker
  // cancels its own row mid-run (mirrors the already-proven
  // goals/task-board/contains-a-worker-outcome-.../run.mts pattern) then
  // returns normally, so we also see whether the late complete() clobbers it.
  results.push(
    await runScenario({
      name: "cancel",
      targetMaxAttempts: 5,
      targetWorker: (collectionId) => async (input: TaskWorkerInput, ctx: never) => {
        const collection = await getOrCreateTaskCollection({ ctx, backing: "request", collectionId });
        await collection.cancel(input.taskId, "operator cancelled mid-run");
        return { ok: true, lateReturnAfterSelfCancel: true };
      },
    })
  );

  // 7. Claim already displaced -- fail(ifAllowed, staleClaim) at the fence.
  results.push(await runDisplacedClaimScenario());

  console.log(
    "\n=== LAB-133 Decision 2 -- task-board settlement-route state-space map ===\n"
  );
  const header = [
    "route",
    "status",
    "attempts",
    "retryLedger",
    "depRan?",
    "board-meta reason",
    "auto-retried?",
  ];
  console.log(header.join(" | "));
  for (const r of results) {
    console.log(
      [
        r.name,
        r.targetStatus,
        r.targetAttempts,
        r.retryLedger,
        r.dependentRan,
        r.terminationReason ?? "-",
        r.autoRetried,
      ].join(" | ")
    );
    if (r.notes) console.log(`    ${r.notes}`);
  }
  console.log("\n=== raw JSON (for the verdict) ===\n");
  console.log(JSON.stringify(results, null, 2));
}

await main();
