/**
 * The goal-local Lab: a coordinator conversation's board handing tasks to
 * `desk.ops`, an `agent` worker on a real model, on the real engine and a
 * SQLite store, served by Shift Manager's own command over HTTP. One person
 * signs in with a verified bearer (`people.mts`).
 *
 * - `desk.lead`, the coordinator, files nothing itself: the check files
 *   through the app's `addTask_tasks`. Its judgment turn, which a task's
 *   notice wakes, is scripted to note the notice and do nothing.
 * - `desk.ops` runs on `vercel/openai/gpt-5.4-mini` through the AI Gateway,
 *   with one goal-local tool, `drawTicket`: each call draws a fresh random
 *   ticket. Only the session that drew it can name it, which is what the
 *   check grades.
 *
 * The store is the file `GOAL_STORE` names. Nothing here writes a row, a
 * session or a notice.
 */
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createModelResolver, handler } from "@flow-state-dev/core";
import * as engine from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import * as workforce from "@flow-state-dev/workforce";
import { readWorkforce } from "@flow-state-dev/workforce/loader";
import { z } from "zod";
import { ALICE, ORG } from "./people.mts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const STORE = process.env.GOAL_STORE ?? "";
if (STORE === "") throw new Error("GOAL_STORE names no store file");
const KEY = process.env.AI_GATEWAY_API_KEY ?? "";
if (KEY === "") throw new Error("AI_GATEWAY_API_KEY is not set");

const wf = workforce as unknown as Record<string, any>;
const tree = await readWorkforce(join(HERE, "..", "fixtures", "workforce"));
if (tree.errors.length > 0) throw new Error(`the goal-local tree did not load: ${JSON.stringify(tree.errors).slice(0, 600)}`);

// ---- models ----------------------------------------------------------------

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

// ---- the ticket tool ---------------------------------------------------------

/** Draws a fresh ticket on every call: a value only the session that called it holds. */
const drawTicket = handler({
  name: "drawTicket",
  description: "Draw a deployment ticket. Returns a new ticket id each time it is called.",
  inputSchema: z.object({}),
  outputSchema: z.object({ ticket: z.string() }),
  execute: () => ({ ticket: `TCK-${randomBytes(3).toString("hex").toUpperCase()}` }),
});

// ---- the app -----------------------------------------------------------------

let flows: Record<string, unknown> = {};
const installation = wf.createWorkerInstallation({ standardWorkers: tree.workers, workerFlows: () => flows });
const agent = wf.defineAgentWorkerFlow({ installation, catalog: { drawTicket } });
const coordinator = wf.defineCoordinatorFlow({ installation, delegateFlows: [agent], routeModel: "scripted/route" });
flows = { agent, coordinator };
const copies = wf.hireWorkforce(installation) as Array<{ id: string }>;

const verify = engine.createBearerSecretPrincipalResolver({ secret: ALICE.bearer, principal: { userId: ALICE.userId, orgId: ORG } });

export default engine.createFlowState({
  flows: Object.fromEntries(copies.map((copy) => [copy.id, copy])),
  stores: { default: { primary: sqliteStores({ filename: STORE }) } },
  modelResolver,
  resolvePrincipal: verify,
} as never);
