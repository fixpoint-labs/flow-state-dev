/**
 * The look check's desk Lab, as Shift Manager's command loads it: one
 * team, `desk`, whose worker `shift-coordinator` runs on the one copy of the
 * built-in `agent` flow the installation registers (its WORKER.md names
 * `flow: agent`), with no flow of its own: its sessions are on that copy and
 * name it in their state. Beside it, `desk.front`, a worker on Workforce's
 * `coordinator` flow whose one delegate is the Shift Coordinator. The
 * organization's inventory is open, written from a small `inventory-writer`
 * flow, so each worker's row names its door. In-memory stores and no
 * credential, so every start is fresh. Nothing files a task, so no
 * conversation board holds a row.
 *
 * No model key: the worker's model is `@flow-state-dev/testing`'s mock
 * resolver with one scripted reply, read from the check's fixture. The check
 * sends one line through the Shift Coordinator's door and reads the screen once
 * the reply is stored; a second generator call has no script and fails
 * rather than inventing one.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { defineFlow, DEFAULT_ORG_ID } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createMockModelResolver, mockGenerator } from "@flow-state-dev/testing";
import {
  AGENT_FLOW,
  COORDINATOR_FLOW,
  defineAgentWorkerFlow,
  defineCoordinatorFlow,
  inventoryWorkers,
  inventoryWriterActions,
  openInventory,
  type InventoryActionRequest,
} from "@flow-state-dev/workforce";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import { installWorkers } from "../../../lib/workers.mts";

/** The one person this Lab runs as. */
export const USER_ID = "u_look_goal";

/**
 * The model best fit's one evaluator call would run on. `desk.front` routes
 * to everyone and never makes that call, but the flow names no default.
 */
const ROUTE_MODEL = "vercel:openai/gpt-5.4-mini";

/** The flow the inventory's worker rows are written from. */
const INVENTORY_WRITER_FLOW = "inventory-writer";

const fixture = JSON.parse(readFileSync(fileURLToPath(new URL("../fixtures/input.json", import.meta.url)), "utf8")) as {
  desk: { reply: string };
};

const tree = await readDeclaredRoster(fileURLToPath(new URL("./workforce", import.meta.url)));
if (tree.problems.length > 0) throw new Error(`the desk tree did not load: ${tree.problems.map((p) => p.error.message).join("; ")}`);
// The Shift Coordinator's model, as its WORKER.md names it: the one id the mock answers for.
const modelId = tree.workers.map((w) => w.declared.model).find((m): m is string => typeof m === "string");
if (modelId === undefined) throw new Error("the desk tree's Shift Coordinator names no model");

const { installation, copies } = installWorkers(tree.workers, (installation) => {
  const agent = defineAgentWorkerFlow({ installation });
  return {
    [AGENT_FLOW]: agent,
    [COORDINATOR_FLOW]: defineCoordinatorFlow({ installation, routeModel: ROUTE_MODEL }),
  };
});
// The worker-row write takes caller-supplied rows, so it is internal only.
const writer = defineFlow({
  kind: INVENTORY_WRITER_FLOW,
  internal: { actions: { ...inventoryWriterActions() } },
} as never) as unknown as FlowInstance;
const flows: Record<string, FlowInstance> = {
  ...Object.fromEntries(copies.map((copy) => [copy.id, copy])),
  [INVENTORY_WRITER_FLOW]: writer,
};
const flowState = createFlowState({
  flows,
  stores: { default: { primary: inMemoryStores() } },
  durable: true,
  modelResolver: createMockModelResolver({
    models: { [modelId]: mockGenerator({ name: "shift-coordinator", script: [{ text: fixture.desk.reply }] }) },
  }),
  devtool: { userId: USER_ID },
} as never);

const runtime = await flowState.getRuntime();
const opened = await openInventory(
  { workers: inventoryWorkers(installation) },
  {
    run: async (request: InventoryActionRequest) => {
      const result = (await runAction({
        flow: flows[request.flowKind],
        actionName: request.action,
        input: request.input,
        userId: request.userId,
        orgId: request.orgId,
        sessionId: request.sessionId,
        source: request.source,
        stores: runtime.stores,
        runtimeConfig: runtime.runtimeConfig,
      } as never)) as { error?: unknown };
      if (result?.error !== undefined) throw new Error(String((result.error as Error).message ?? result.error));
      return result;
    },
    workerWriter: { flowKind: INVENTORY_WRITER_FLOW },
    userId: USER_ID,
    orgId: DEFAULT_ORG_ID,
  },
);
if (opened.problems.length > 0) throw new Error(opened.problems.join("; "));

export default flowState;
