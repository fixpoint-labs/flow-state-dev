/**
 * The closure's Lab: the concept's cast as `WORKER.md` files only, on the built-in flows, on the
 * real engine and a SQLite store, served over HTTP by Shift Manager's own command. Alice and
 * Bob sign in with their own verified bearers (`files-and-splits-down-the-chain`'s
 * `people.mts`); a request with neither is refused.
 *
 * The tree is written by `run.mts` at run time (`GOAL_TREE`), so the topic, the held-out word
 * and the researcher's fact are picked per run: `launch` on the built-in coordinator, routing
 * everyone, whose one delegate is `writer`; `writer` and `researcher` on the built-in `agent`
 * flow, writer's delegate being researcher. The app adds no coordination code: two flows, the
 * tree, a store and a resolver.
 *
 * Read from the environment: `GOAL_STORE` (the store file), `GOAL_TREE` (the tree),
 * `GOAL_REAL_MODEL` (the model `goal/real` names) and `GOAL_TOOLS_LOG` (where the tools each
 * model call was handed are noted). `goal/broken` is a model that refuses every call, for leg
 * c's researcher, so its task fails out.
 *
 * Durable, so it keeps wakes and runs the durability sweeper (leg b).
 *
 * Nothing here writes a row, a session or a notice.
 */
import { appendFileSync } from "node:fs";
import * as engine from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import * as workforce from "@flow-state-dev/workforce";
import { readWorkforce } from "@flow-state-dev/workforce/loader";
import { ORG, PEOPLE } from "../../../workers/files-and-splits-down-the-chain/lab/people.mts";

const STORE = process.env.GOAL_STORE ?? "";
const TREE = process.env.GOAL_TREE ?? "";
const REAL_MODEL = process.env.GOAL_REAL_MODEL ?? "";
if (STORE === "" || TREE === "" || REAL_MODEL === "") throw new Error("GOAL_STORE, GOAL_TREE and GOAL_REAL_MODEL must each name something");

const tree = await readWorkforce(TREE);
if (tree.errors.length > 0) throw new Error(`the closure's tree did not load: ${JSON.stringify(tree.errors).slice(0, 600)}`);

/**
 * A model that refuses every call, after a while: leg c's researcher, whose task fails out once
 * writer has filed the task that depends on it, as a slow outage would.
 */
const BROKEN_AFTER_MS = 12_000;
const refuse = async (): Promise<never> => {
  await new Promise((resolve) => setTimeout(resolve, BROKEN_AFTER_MS));
  throw new Error("the research service is down");
};
const broken = { modelId: "goal/broken", generate: refuse, generateStep: refuse };

/**
 * The real model, noting the tools the engine handed each call (`GOAL_TOOLS_LOG`, one JSON line
 * per call: who the turn is, from its instructions' first line, and the tool names). A record of
 * what a turn was offered, never a change to it.
 */
const TOOLS_LOG = process.env.GOAL_TOOLS_LOG ?? "";
const noted = (model: any) => {
  const note = (options: any) => {
    if (TOOLS_LOG === "") return;
    const system = (options?.messages ?? []).find((m: any) => m?.role === "system");
    const who = /You are ([a-z]+\.[a-z]+)/.exec(typeof system?.content === "string" ? system.content : JSON.stringify(system?.content ?? ""))?.[1] ?? "?";
    appendFileSync(TOOLS_LOG, `${JSON.stringify({ who, tools: (options?.tools ?? []).map((t: any) => String(t?.name ?? "")), at: Date.now() })}\n`);
  };
  return Object.assign(Object.create(model), {
    generate: (options: any) => (note(options), model.generate(options)),
    ...(typeof model.generateStep === "function" ? { generateStep: (options: any) => (note(options), model.generateStep(options)) } : {}),
    ...(typeof model.streamStep === "function" ? { streamStep: (options: any) => (note(options), model.streamStep(options)) } : {}),
    ...(typeof model.stream === "function" ? { stream: (options: any) => (note(options), model.stream(options)) } : {}),
  });
};

const real = engine.createModelResolver();
const modelResolver = Object.assign(
  (id: string, block?: string) => (id === "goal/broken" ? broken : noted((real as any)(id === "goal/real" ? REAL_MODEL : id, block))),
  { resolveId: (id: string) => (id === "goal/real" ? REAL_MODEL : id) },
);

const wf = workforce as unknown as Record<string, any>;
let flows: Record<string, unknown> = {};
const installation = wf.createWorkerInstallation({ standardWorkers: tree.workers, workerFlows: () => flows });
flows = {
  agent: wf.defineAgentWorkerFlow({ installation }),
  coordinator: wf.defineCoordinatorFlow({ installation, routeModel: "goal/real" }),
};
const copies = wf.hireWorkforce(installation, {}) as Array<{ id: string }>;

const bearers = Object.values(PEOPLE).map((person) =>
  engine.createBearerSecretPrincipalResolver({ secret: person.bearer, principal: { userId: person.userId, orgId: ORG } }),
);
/** One secret per person; a request with none, or one nobody recognises, is refused. */
const resolvePrincipal = async (context: unknown) => {
  for (const verify of bearers) {
    try {
      const principal = await verify(context as never);
      if (principal !== null) return principal;
      break;
    } catch (error) {
      if (!(error instanceof engine.PrincipalResolutionError)) throw error;
    }
  }
  throw new engine.PrincipalResolutionError("no verified bearer");
};

export default engine.createFlowState({
  flows: Object.fromEntries(copies.map((copy) => [copy.id, copy])),
  stores: { default: { primary: sqliteStores({ filename: STORE }) } },
  // Durable execution keeps wakes, so a notice owed when the server dies is paid when it is back (leg b).
  durable: true,
  modelResolver,
  resolvePrincipal,
} as never);
