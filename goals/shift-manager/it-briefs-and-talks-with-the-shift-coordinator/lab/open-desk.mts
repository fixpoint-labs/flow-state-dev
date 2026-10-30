/**
 * The goal's fixture Labs, opened the way Shift Manager's command loads
 * one: a tree with one team, `desk`, whose workers run the turn goal's `asker`
 * kind or the built-in `agent` kind with a real model, beside one coordinator,
 * `desk.front`, on Workforce's `coordinator` flow, whose delegates are the
 * desk's other workers. Each kind is one registered copy that every worker
 * naming it runs on, and a worker's sessions name it in their state. The
 * organization's inventory is open, written from a small `inventory-writer`
 * flow, so each worker's row names its door. In-memory stores and no
 * credential, so every start is fresh. The check raises the asks itself,
 * through the Lab's own action route, so the Lab reopens them when they are
 * answered.
 *
 * Nothing here files a task: the asker takes no posts and no tasks, and the
 * check posts nothing to `desk.front`. A post to it would reach the Shift
 * Coordinator, whose `agent` flow takes routed tasks.
 *
 * Three configs open it: `lab/fsdev.config.mts` over the desk with its
 * `shift-coordinator` worker, `lab-no-shift-coordinator/fsdev.config.mts` over a desk that
 * declares none, and `lab-old-name/fsdev.config.mts` over a desk whose worker has the retired
 * id `chief-of-staff`.
 *
 * The model is resolved by the framework's resolver from the environment
 * (`AI_GATEWAY_API_KEY` routes `openai/gpt-5.4-mini` through the gateway).
 */
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { createModelResolver, defineFlow, DEFAULT_ORG_ID } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
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
import { ASKER_FLOW, defineAskerFlow } from "../../it-sends-a-turn-into-a-worker-session/lab/asker/asker.mts";

/** The one person this Lab runs as. */
export const USER_ID = "u_cos_goal";

/**
 * The model best fit's one evaluator call would run on. `desk.front` routes
 * to everyone and never makes that call, but the flow names no default.
 */
const ROUTE_MODEL = "vercel:openai/gpt-5.4-mini";

/** The flow the inventory's worker rows are written from. */
const INVENTORY_WRITER_FLOW = "inventory-writer";

/**
 * Open the desk Lab over the tree at `root`.
 *
 * @param root The `workforce/` folder to read.
 * @returns The flow state a config default-exports.
 */
export async function openDesk(root: string) {
  const tree = await readDeclaredRoster(root);
  if (tree.problems.length > 0) throw new Error(`the desk tree did not load: ${tree.problems.map((p) => p.error.message).join("; ")}`);

  const { installation, copies } = installWorkers(tree.workers, (installation) => {
    const agent = defineAgentWorkerFlow({ installation });
    return {
      [ASKER_FLOW]: defineAskerFlow(installation),
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
    modelResolver: createModelResolver(),
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

  return flowState;
}
