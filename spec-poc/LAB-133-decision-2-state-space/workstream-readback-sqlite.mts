/**
 * LAB-133 spec-poc — the include_items half of the readback claim, redone
 * on a store adapter that actually stores items separately.
 *
 * THROWAWAY. Never merges. See spec-poc/README.md.
 *
 * workstream-readback.mts's in-memory-store run left the include_items
 * claim UNDECIDED by construction: `RequestListOptions.withItems`'s own
 * doc says "adapters that store items inline ignore the flag" (see
 * packages/engine/src/stores/types.ts:362-367), and the in-memory adapter
 * is exactly that adapter. Re-run against `@flow-state-dev/store-sqlite`
 * (`:memory:`), which stores items in a separate `request_items` table and
 * DOES branch on `withItems` (packages/store-sqlite/src/request-store.ts:434).
 *
 * Run: pnpm tsx spec-poc/LAB-133-decision-2-state-space/workstream-readback-sqlite.mts
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { createFlowApiRouter, createFlowRegistry, runAction } from "@flow-state-dev/engine";
import type { StoreRegistry } from "@flow-state-dev/engine";
import { defineTaskCollection, type TaskWorkerInput } from "@flow-state-dev/orchestration/tasks";
import { taskBoard, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { createSQLiteStores } from "@flow-state-dev/store-sqlite";

const USER_ID = "poc-user";
const KIND = "readback-sqlite-demo";
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
    initialTasks: [{ id: "target", goal: "LAB-133 readback demo (sqlite)", assignee: "implement" }],
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
  const stores: StoreRegistry = createSQLiteStores({ filename: ":memory:" }) as unknown as StoreRegistry;
  const flow = buildFlow();
  const PARENT_SESSION = "s_readback_sqlite_parent";

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
  if (dispatched.length !== 1) throw new Error(`expected exactly one dispatch, got ${dispatched.length}`);

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

  const withoutRes = await call(router, ["sessions", childSessionId, "requests"]);
  const withoutBody = (await withoutRes.json()) as { requests: Array<{ id: string; items?: unknown[] }> };
  const withRes = await call(router, ["sessions", childSessionId, "requests"], "include_items=true");
  const withBody = (await withRes.json()) as { requests: Array<{ id: string; items?: unknown[] }> };

  const withoutItems = withoutBody.requests[0]?.items;
  const withItems = withBody.requests[0]?.items;

  console.log("\n=== LAB-133 readback claim, include_items, on store-sqlite (:memory:) ===\n");
  console.log(`GET /sessions/${childSessionId}/requests -> HTTP ${withoutRes.status}`);
  console.log(`  items key present WITHOUT include_items: ${withoutItems !== undefined}`);
  console.log(`  items value WITHOUT include_items: ${JSON.stringify(withoutItems)}`);
  console.log(`\nGET /sessions/${childSessionId}/requests?include_items=true -> HTTP ${withRes.status}`);
  console.log(`  items key present WITH include_items=true: ${withItems !== undefined}`);
  console.log(`  items length WITH include_items=true: ${withItems?.length ?? "n/a"}`);

  console.log("\n=== raw JSON (for the verdict) ===\n");
  console.log(
    JSON.stringify(
      {
        itemsOmittedByDefault: withoutItems === undefined,
        itemsCountWithoutFlag: Array.isArray(withoutItems) ? withoutItems.length : null,
        itemsPresentWithFlag: withItems !== undefined,
        itemsCountWithFlag: withItems?.length,
      },
      null,
      2
    )
  );
}

await main();
