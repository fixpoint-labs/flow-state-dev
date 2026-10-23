/**
 * The goal-local Lab: the FIX-1817 Lab's shape (a coordinator conversation's
 * board handing tasks to `agent` workers on a real model, on the real engine
 * and a SQLite store, served by Shift Manager's own command over HTTP), with
 * two delegates, so the delegate a task is for is picked at run time.
 *
 * - `desk.lead`, the coordinator, files nothing itself: the check records and
 *   releases through the app's `createTask_tasks` and `updateTask_tasks`.
 *   Its judgment turn, which a task's notice wakes, is scripted to note the
 *   notice and do nothing.
 * - `desk.ops` and `desk.dev` run on `vercel:openai/gpt-5.4-mini` through the
 *   AI Gateway, with no tools.
 *
 * The store is the file `GOAL_STORE` names. Nothing here writes a row, a
 * session or a notice.
 */
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createModelResolver } from "@flow-state-dev/core";
import * as engine from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import * as workforce from "@flow-state-dev/workforce";
import { readWorkforce } from "@flow-state-dev/workforce/loader";
import { ALICE, ORG } from "./people.mts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const STORE = process.env.GOAL_STORE ?? "";
if (STORE === "") throw new Error("GOAL_STORE names no store file");
const KEY = process.env.AI_GATEWAY_API_KEY ?? "";
if (KEY === "") throw new Error("AI_GATEWAY_API_KEY is not set");

const wf = workforce as unknown as Record<string, any>;
const tree = await readWorkforce(join(HERE, "..", "fixtures", "workforce"));
if (tree.errors.length > 0) throw new Error(`the goal-local tree did not load: ${JSON.stringify(tree.errors).slice(0, 600)}`);

// `goals/` cannot resolve the gateway package; kitchen-sink's node_modules can.
const ksRequire = createRequire(new URL("../../../../apps/kitchen-sink/package.json", import.meta.url));
const { createGateway } = (await import(ksRequire.resolve("@ai-sdk/gateway"))) as {
  createGateway: (options: { apiKey: string }) => unknown;
};
const real = createModelResolver({ gateways: { vercel: createGateway({ apiKey: KEY }) as never } });

/** The coordinator's judgment turn: a notice is noted, nothing more. */
const judgment = {
  modelId: "scripted/judgment",
  async generate() {
    throw new Error("the owned tool loop calls generateStep");
  },
  async generateStep() {
    return { text: "Noted.", finishReason: "stop" };
  },
};

const modelResolver = Object.assign(
  (id: string, block?: string, options?: unknown) =>
    block?.startsWith("coordinator-judgment") ? judgment : (real as any)(id, block, options),
  { resolveId: (id: string) => (id.startsWith("scripted/") ? id : real.resolveId(id)) },
);

let flows: Record<string, unknown> = {};
const installation = wf.createWorkerInstallation({ standardWorkers: tree.workers, workerFlows: () => flows });
const agent = wf.defineAgentWorkerFlow({ installation, catalog: {} });
const coordinator = wf.defineCoordinatorFlow({ installation, routeModel: "scripted/route" });
flows = { agent, coordinator };
const copies = wf.hireWorkforce(installation) as Array<{ id: string }>;

const verify = engine.createBearerSecretPrincipalResolver({ secret: ALICE.bearer, principal: { userId: ALICE.userId, orgId: ORG } });

export default engine.createFlowState({
  flows: Object.fromEntries(copies.map((copy) => [copy.id, copy])),
  stores: { default: { primary: sqliteStores({ filename: STORE }) } },
  modelResolver,
  resolvePrincipal: verify,
} as never);
