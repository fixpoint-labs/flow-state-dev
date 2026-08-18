/**
 * LAB-133 spec-poc — the spec's readback example (§5), run for real.
 *
 * THROWAWAY. Never merges. See spec-poc/README.md.
 *
 * Claim under test: `GET /sessions/:id/workstreams` returns
 * `{ workstreams: [...] }` (not a bare array), and a workstream's own
 * `GET /sessions/:childId/requests` omits item logs unless
 * `include_items=true` is passed.
 *
 * Drives a REAL detached dispatch (same helpers as detached-three-way.mts)
 * so the rows read back are genuinely produced, not hand-seeded fixtures --
 * then hits the REAL HTTP router, exactly as a client would.
 *
 * Run: pnpm tsx spec-poc/LAB-133-decision-2-state-space/workstream-readback.mts
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
  runAction,
} from "@flow-state-dev/engine";
import type { StoreRegistry } from "@flow-state-dev/engine";
import { defineTaskCollection, type TaskWorkerInput } from "@flow-state-dev/orchestration/tasks";
import { taskBoard, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import { createMockModelResolver } from "@flow-state-dev/testing";

const USER_ID = "poc-user";
const KIND = "readback-demo";
const baseRuntimeConfig = () => ({ modelResolver: createMockModelResolver({}) });

function buildFlow() {
  const board = taskBoard({
    name: `${KIND}-board`,
    boardId: `${KIND}-board`,
    collection: defineTaskCollection({ id: `${KIND}-ledger`, scope: "user" }),
    onError: "skip",
    workers: {
      implement: {
        worker: handler({
          name: `${KIND}-worker`,
          inputSchema: taskWorkerInputSchema,
          outputSchema: z.unknown(),
          execute: async (_input: TaskWorkerInput) => ({ ok: true, note: "did the thing" }),
        }),
        dispatch: { mode: "detached" },
      },
    },
    initialTasks: [{ id: "target", goal: "LAB-133 readback demo", assignee: "implement" }],
  });

  return defineFlow({
    kind: KIND,
    actions: { start: { block: board.drain } },
  })({ id: KIND });
}

async function call(router: ReturnType<typeof createFlowApiRouter>, path: string[], query?: string) {
  const q = query === undefined ? "" : `?${query}`;
  return router.GET(new Request(`http://localhost/api/flows/${path.join("/")}${q}`), {
    params: { path },
  });
}

async function main() {
  const stores: StoreRegistry = createInMemoryStores();
  const flow = buildFlow();
  const PARENT_SESSION = "s_readback_parent";

  const dispatched: Array<{ sessionId: string; actionName: string; input: unknown }> = [];
  const parent = await runAction({
    flow: flow as never,
    actionName: "start",
    input: {},
    userId: USER_ID,
    sessionId: PARENT_SESSION,
    stores,
    runtimeConfig: {
      ...baseRuntimeConfig(),
      requestHost: {
        startOperation: async (spec: { sessionId: string; actionName: string; input: unknown }) => {
          dispatched.push(spec);
          return { requestId: "child_req_1" };
        },
      },
    } as never,
  });
  if (parent.error) throw new Error(`parent drain failed: ${parent.error.message}`);
  if (dispatched.length !== 1) {
    throw new Error(`expected exactly one detached dispatch, got ${dispatched.length}`);
  }

  const childSessionId = dispatched[0]!.sessionId;
  const child = await runAction({
    flow: flow as never,
    actionName: dispatched[0]!.actionName as "start",
    input: dispatched[0]!.input,
    userId: USER_ID,
    sessionId: childSessionId,
    source: "workstream",
    stores,
    runtimeConfig: baseRuntimeConfig() as never,
  });
  if (child.error) throw new Error(`child run failed: ${child.error.message}`);

  const registry = createFlowRegistry();
  registry.register(flow as never);
  const router = createFlowApiRouter({ registry, stores });

  // Claim 1: GET /sessions/:parentId/workstreams -- envelope, not a bare array.
  const wsRes = await call(router, ["sessions", PARENT_SESSION, "workstreams"]);
  const wsBody = (await wsRes.json()) as unknown;
  const isEnvelope =
    typeof wsBody === "object" &&
    wsBody !== null &&
    !Array.isArray(wsBody) &&
    Array.isArray((wsBody as { workstreams?: unknown }).workstreams);
  const workstreams = isEnvelope ? (wsBody as { workstreams: unknown[] }).workstreams : undefined;

  // Claim 2: GET /sessions/:childId/requests -- items omitted by default,
  // present with include_items=true.
  const reqWithoutItems = await call(router, ["sessions", childSessionId, "requests"]);
  const withoutBody = (await reqWithoutItems.json()) as {
    requests: Array<{ id: string; items?: unknown }>;
  };
  const reqWithItems = await call(router, ["sessions", childSessionId, "requests"], "include_items=true");
  const withBody = (await reqWithItems.json()) as {
    requests: Array<{ id: string; items?: unknown[] }>;
  };

  console.log("\n=== LAB-133 spec Part I S5 readback example -- run for real ===\n");
  console.log(`GET /sessions/${PARENT_SESSION}/workstreams -> HTTP ${wsRes.status}`);
  console.log(`  top-level shape: ${Array.isArray(wsBody) ? "BARE ARRAY" : "object"}`);
  console.log(`  { workstreams: [...] } envelope present: ${isEnvelope}`);
  console.log(`  row count: ${workstreams?.length ?? "n/a"}`);
  console.log(`  raw body: ${JSON.stringify(wsBody)}`);

  const withoutItemsValue = withoutBody.requests[0]?.items;
  const withItemsValue = withBody.requests[0]?.items;

  console.log(`\nGET /sessions/${childSessionId}/requests -> HTTP ${reqWithoutItems.status}`);
  console.log(`  requests[0].items key present WITHOUT include_items: ${withoutItemsValue !== undefined}`);
  console.log(
    `  requests[0].items value WITHOUT include_items: ${Array.isArray(withoutItemsValue) ? `array, length ${withoutItemsValue.length}` : JSON.stringify(withoutItemsValue)}`
  );
  console.log(`  full requests[0] WITHOUT include_items: ${JSON.stringify(withoutBody.requests[0])}`);

  console.log(`\nGET /sessions/${childSessionId}/requests?include_items=true -> HTTP ${reqWithItems.status}`);
  console.log(`  requests[0].items key present WITH include_items=true: ${withItemsValue !== undefined}`);
  console.log(`  requests[0].items length WITH include_items=true: ${withItemsValue?.length ?? "n/a"}`);

  console.log("\n=== raw JSON (for the verdict) ===\n");
  console.log(
    JSON.stringify(
      {
        workstreamsIsEnvelope: isEnvelope,
        workstreamsBody: wsBody,
        requestWithoutItemsFlag: withoutBody.requests[0],
        itemsKeyPresentWithoutFlag: withoutItemsValue !== undefined,
        itemsCountWithoutFlag: Array.isArray(withoutItemsValue) ? withoutItemsValue.length : null,
        itemsKeyPresentWithFlag: withItemsValue !== undefined,
        itemsCountWithFlag: withItemsValue?.length,
      },
      null,
      2
    )
  );
}

await main();
