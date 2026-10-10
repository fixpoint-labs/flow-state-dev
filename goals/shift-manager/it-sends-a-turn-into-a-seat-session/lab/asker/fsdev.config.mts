/**
 * The goal's fixture Lab, as Shift Manager's command loads it: one seat that
 * asks and hears (`asker.mts`), beside one coordinator, with the
 * organization's inventory open so the seat's row names its door. In-memory
 * stores and no credential, so every start is fresh. The check raises the ask
 * itself, through the Lab's own action route.
 *
 * The coordinator, `desk.front`, is a worker file on Workforce's `coordinator`
 * flow. The asker's flow takes no delegated posts, so a post to `desk.front`
 * reaches nobody, as the mailbox it replaced woke nobody.
 */
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { defineFlow } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import {
  COORDINATOR_KIND,
  defineCoordinatorFlow,
  inventorySeats,
  inventoryWriterActions,
  openInventory,
  type InventoryActionRequest,
} from "@flow-state-dev/workforce";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { fileURLToPath } from "node:url";
import { installWorkers } from "../../../../lib/workers.mts";
import { ASKER_KIND, defineAskerFlow } from "./asker.mts";

/** The one person this Lab runs as. */
const USER_ID = "u_turn_goal";

/**
 * The model best fit's one evaluator call would run on. `desk.front` routes
 * to everyone and never makes that call, but the flow names no default.
 */
const ROUTE_MODEL = "vercel/openai/gpt-5.4-mini";

/** The flow the inventory's seat rows are written from: the Lab's own, carrying the writer. */
const INVENTORY_WRITER_KIND = "inventory-writer";

const tree = await readDeclaredRoster(fileURLToPath(new URL("./workforce", import.meta.url)));
if (tree.problems.length > 0) throw new Error(`the asker tree did not load: ${tree.problems.map((p) => p.error.message).join("; ")}`);

const { installation, copies } = installWorkers(tree.workers, (installation) => ({
  [ASKER_KIND]: defineAskerFlow(installation),
  [COORDINATOR_KIND]: defineCoordinatorFlow({ installation, delegateFlows: [], routeModel: ROUTE_MODEL }),
}));
// The seat write takes caller-supplied rows, so it is internal only.
const writer = defineFlow({
  kind: INVENTORY_WRITER_KIND,
  internal: { actions: { ...inventoryWriterActions(INVENTORY_WRITER_KIND) } },
} as never) as unknown as FlowInstance;
const flows: Record<string, FlowInstance> = {
  ...Object.fromEntries(copies.map((copy) => [copy.id, copy])),
  [INVENTORY_WRITER_KIND]: writer,
};
const flowState = createFlowState({
  flows,
  stores: { default: { primary: inMemoryStores() } },
  durable: true,
  devtool: { userId: USER_ID },
} as never);

const runtime = await flowState.getRuntime();
const opened = await openInventory(
  { seats: inventorySeats(installation), mailboxes: [] },
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
    seatWriter: { flowKind: INVENTORY_WRITER_KIND },
    userId: USER_ID,
    orgId: DEFAULT_ORG_ID,
  },
);
if (opened.problems.length > 0) throw new Error(opened.problems.join("; "));

export default flowState;
