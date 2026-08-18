/**
 * LAB-133 spec-poc — Decision 2's three-way ending, on a REAL detached
 * runner, plus the coupling-harm demonstration.
 *
 * THROWAWAY. Never merges. See spec-poc/README.md.
 *
 * Unlike route-map.mts (inline dispatch, direct collection calls), every
 * scenario here goes through the actual `dispatch: { mode: "detached" }`
 * hand-off: a parent `runAction` claims the row and calls the real
 * `startDetached`-driven spawn block, and a SEPARATE `runAction` (source:
 * "workstream") then runs the real detached runner (start gate, ticket
 * re-mint, worker router, recordSuccess/recordError) exactly as production
 * would. The "worker" is a scripted stand-in -- we are testing the runner
 * and board's behaviour, not the Claude SDK.
 *
 * Settles:
 *   1. The three-way ending table, through the real detached path.
 *   2. The decisive coupling claim: with a retry allowance set, an
 *      agent-side failure that (wrongly) THROWS instead of returning gets
 *      dispatched again -- and again -- over the same task, each time as a
 *      genuine new detached child. Demonstrates the harm decision 2's
 *      return-vs-throw coupling exists to prevent.
 *
 * Run: pnpm tsx spec-poc/LAB-133-decision-2-state-space/detached-three-way.mts
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { createInMemoryStores, runAction } from "@flow-state-dev/engine";
import type { StoreRegistry } from "@flow-state-dev/engine";
import { defineTaskCollection, type Task, type TaskWorkerInput } from "@flow-state-dev/orchestration/tasks";
import { taskBoard, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import { createMockModelResolver } from "@flow-state-dev/testing";

const WORKSTREAM_SOURCE = "workstream";
const USER_ID = "poc-user";
const baseRuntimeConfig = () => ({ modelResolver: createMockModelResolver({}) });

type RecordedDispatch = { sessionId: string; actionName: string; input: unknown };
type FlowInstance = ReturnType<ReturnType<typeof defineFlow>>;

function buildFlow(
  kind: string,
  targetWorker: (input: TaskWorkerInput) => Promise<unknown>,
  maxAttempts?: number
): FlowInstance {
  const board = taskBoard({
    name: `${kind}-board`,
    boardId: `${kind}-board`,
    collection: defineTaskCollection({ id: `${kind}-ledger`, scope: "user" }),
    onError: "skip",
    workers: {
      implement: {
        worker: handler({
          name: `${kind}-worker`,
          inputSchema: taskWorkerInputSchema,
          outputSchema: z.unknown(),
          execute: targetWorker,
        }),
        dispatch: { mode: "detached" },
      },
    },
    initialTasks: [
      {
        id: "target",
        goal: "target task",
        assignee: "implement",
        ...(maxAttempts !== undefined ? { maxAttempts } : {}),
      },
    ],
  });

  return defineFlow({
    kind,
    actions: { start: { block: board.drain } },
  })({ id: kind }) as FlowInstance;
}

async function durableRow(stores: StoreRegistry, kind: string, taskId: string): Promise<Task | undefined> {
  const row = await stores.resourceState.get("user", USER_ID, `${kind}-ledger/${taskId}`);
  return row?.state as Task | undefined;
}

/** Drain the parent once. Returns whatever detached dispatches it produced. */
async function drainParent(flow: FlowInstance, stores: StoreRegistry, sessionId: string) {
  const dispatched: RecordedDispatch[] = [];
  const parent = await runAction({
    flow: flow as never,
    actionName: "start",
    input: {},
    userId: USER_ID,
    sessionId,
    stores,
    runtimeConfig: {
      ...baseRuntimeConfig(),
      requestHost: {
        startOperation: async (spec: { sessionId: string; actionName: string; input: unknown }) => {
          dispatched.push({ sessionId: spec.sessionId, actionName: spec.actionName, input: spec.input });
          return { requestId: `child_req_${dispatched.length}_${sessionId}` };
        },
      },
    } as never,
  });
  return { parent, dispatched };
}

/** Run one dispatched child exactly as the deployment's request host would. */
async function runChild(flow: FlowInstance, stores: StoreRegistry, dispatch: RecordedDispatch) {
  return runAction({
    flow: flow as never,
    actionName: dispatch.actionName as "start",
    input: dispatch.input,
    userId: USER_ID,
    sessionId: dispatch.sessionId,
    source: WORKSTREAM_SOURCE,
    stores,
    runtimeConfig: baseRuntimeConfig() as never,
  });
}

function isTerminal(status: string | undefined): boolean {
  return status === "completed" || status === "errored" || status === "cancelled";
}

/**
 * Drain the REAL detached path to settlement (or until `maxCycles` is
 * exhausted as a safety valve). Each cycle is: parent drains and dispatches
 * (or doesn't, if nothing is claimable) -> every dispatched child actually
 * runs, exactly as a deployment's next drain wake would do it. No external
 * "recovery" step -- a re-pended row is picked up by ordinary re-drainage.
 *
 * `dispatchCount` is the number of REAL, separate detached child sessions
 * spawned for this one task -- the number of times the agent itself would
 * have actually been invoked.
 */
async function runDetachedToSettlement(
  kind: string,
  targetWorker: (input: TaskWorkerInput) => Promise<unknown>,
  maxAttempts: number | undefined,
  maxCycles = 4
) {
  const stores = createInMemoryStores();
  const flow = buildFlow(kind, targetWorker, maxAttempts);
  const dispatchLog: RecordedDispatch[] = [];
  let row: Task | undefined;

  for (let cycle = 0; cycle < maxCycles; cycle++) {
    const { dispatched } = await drainParent(flow, stores, `s_${kind}_parent_${cycle}`);
    if (dispatched.length === 0) {
      row = await durableRow(stores, kind, "target");
      break;
    }
    dispatchLog.push(...dispatched);
    for (const d of dispatched) await runChild(flow, stores, d);
    row = await durableRow(stores, kind, "target");
    if (isTerminal(row?.status)) break;
  }

  return {
    kind,
    dispatchCount: dispatchLog.length,
    rowStatus: row?.status,
    rowAttempts: row?.attempts,
    rowError: row?.error,
    rowRetryLedger: row?.retryLedger,
  };
}

async function main() {
  const results: Array<Record<string, unknown>> = [];

  // (a) Succeeded.
  results.push(
    await runDetachedToSettlement("three-way-success", async () => ({ ok: true }), undefined)
  );

  // (b) Agent failed on its own terms -- RETURNS an errored handle (decision
  // 2's proposed signal). maxAttempts set deliberately, to see whether a
  // retry budget is consulted at all when the block returns.
  results.push(
    await runDetachedToSettlement(
      "three-way-agent-failure-RETURNS",
      async () => ({ ok: false, resultSubtype: "error_during_execution", reason: "agent gave up" }),
      5
    )
  );

  // (c) Run was lost -- RETHROWS, retry budget remaining. Genuine one-time
  // abort on attempt 1; succeeds on the attempt that recovers it. Proves
  // "recoverable" through the REAL detached hand-off (start gate + ticket
  // re-mint included), not just through the inline collection API.
  results.push(
    await runDetachedToSettlement(
      "three-way-lost-RETHROWS-budget-remaining",
      async (input: TaskWorkerInput) => {
        if (input.attempts === 1) throw new Error("simulated lost run (abort) on attempt 1");
        return { ok: true, recoveredOnAttempt: input.attempts };
      },
      3
    )
  );

  // (d) THE COUPLING-HARM DEMONSTRATION.
  // A retry allowance is set. The "agent-side failure" case is mis-signalled
  // as a THROW (the pre-decision-2, undisciplined behaviour) instead of a
  // return. If the coupling decision 2 states ("agent failures must return,
  // not throw") is dropped, this is exactly what happens: the board cannot
  // tell this apart from a genuinely lost run, so it re-pends and re-drains
  // dispatch it again -- a REAL new detached child, i.e. the agent running
  // again over a task it already gave up on.
  results.push(
    await runDetachedToSettlement(
      "COUPLING-HARM-agent-failure-mis-signalled-as-throw",
      async () => {
        throw new Error("agent decided it cannot complete the task (mis-signalled as a throw)");
      },
      3
    )
  );

  console.log("\n=== LAB-133 Decision 2 -- three-way ending, REAL detached runner ===\n");
  const header = ["scenario", "real dispatches", "final status", "attempts", "retryLedger"];
  console.log(header.join(" | "));
  for (const r of results) {
    console.log(
      [
        r.kind,
        r.dispatchCount,
        r.rowStatus,
        r.rowAttempts,
        r.rowRetryLedger ? JSON.stringify(r.rowRetryLedger) : "(none)",
      ].join(" | ")
    );
  }
  console.log("\n=== raw JSON (for the verdict) ===\n");
  console.log(JSON.stringify(results, null, 2));
}

await main();
