/**
 * The goal's Lab: a goal-local worker tree on the real engine and a SQLite
 * store, served by Shift Manager's own command over HTTP, the way DevTeam is.
 * Two people sign in, each with their own verified bearer (`people.mts`); a
 * request with no bearer, or one nobody recognises, is refused.
 *
 * The tree (`../fixtures/workforce/`), on four flows: the built-in `agent`
 * flow and the coordinator, and two goal-local ones. `foreman` is an app's own
 * worker flow carrying the filing kit (`defineSessionBoard`): the task tools
 * on its model block, their actions, and the board's entries. `poster` takes
 * no task: its workers answer a person, and none can be a delegate.
 *
 * - `crew.planner` (`agent`) splits for `crew.one` and `crew.two`; `crew.solo`
 *   has no delegates.
 * - `desk.router`, a coordinator routing by judgment, whose one delegate,
 *   `desk.poster`, takes no task.
 * - `shop.foreman`, on `foreman`, files for `crew.one`.
 * - `deep.d0` to `deep.d6`, each handing on to the next.
 * - `wide.top` hands to `wide.fan`, which fans out for two delegates.
 * - `real.lead`, on a real model, files for `crew.one` and `crew.two`.
 *
 * No real model but `real.lead`'s: every other turn is scripted by marks in
 * what it reads (`[file:<worker>]`, `[split:<a>,<b>]`, `[fan:<n>]`,
 * `[try-file]`, `[tools]`), and a task's notice is noted and files nothing.
 * The scripted model files through the tools the engine handed its turn, and
 * says which tools those were, so the check reads the turn's tool list off
 * the session, never the prompt.
 *
 * Read from the environment: `GOAL_STORE` (the store file), `GOAL_CHAIN_LIMIT`
 * (the app's chain cap, `hireWorkforce`'s `taskChainLimit`; unset, the
 * default) and `GOAL_REAL_MODEL` (the model `real.lead`'s `goal/real` names).
 *
 * Nothing here writes a row, a session or a notice: every change is an action
 * a person sends, or what the system does with it. Against another commit,
 * `run.mts` copies this folder and `fixtures/` into that checkout's `goals/`,
 * so every import resolves to that commit's packages.
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@flow-state-dev/core";
import * as engine from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import * as workforce from "@flow-state-dev/workforce";
import { readWorkforce } from "@flow-state-dev/workforce/loader";
import { z } from "zod";
import { ORG, PEOPLE } from "./people.mts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const STORE = process.env.GOAL_STORE ?? "";
if (STORE === "") throw new Error("GOAL_STORE names no store file");
const CHAIN_LIMIT = process.env.GOAL_CHAIN_LIMIT === undefined || process.env.GOAL_CHAIN_LIMIT === "" ? undefined : Number(process.env.GOAL_CHAIN_LIMIT);
const REAL_MODEL = process.env.GOAL_REAL_MODEL ?? "";

const wf = workforce as unknown as Record<string, any>;
const missing = ["createWorkerInstallation", "defineAgentWorkerFlow", "defineCoordinatorFlow", "hireWorkforce", "workerConfigSchema"].filter(
  (name) => typeof wf[name] !== "function",
);
if (missing.length > 0) throw new Error(`this commit's @flow-state-dev/workforce exports no ${missing.join(", ")}`);

const tree = await readWorkforce(join(HERE, "..", "fixtures", "workforce"));
if (tree.errors.length > 0) throw new Error(`the goal-local tree did not load: ${JSON.stringify(tree.errors).slice(0, 600)}`);

// ---- the scripted model -------------------------------------------------------

type Message = { role?: string; content?: unknown };

/** A message's text, whatever shape its content takes. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => (typeof part?.text === "string" ? part.text : JSON.stringify(part?.output ?? part ?? ""))).join("");
  return JSON.stringify(content ?? "");
}

/** The last thing a person (or a notice) said in this turn, and the tool results since. */
function lastAsk(messages: Message[]): { asked: string; results: Message[] } {
  let at = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]!.role === "user") {
      at = i;
      break;
    }
  }
  return { asked: at < 0 ? "" : textOf(messages[at]!.content), results: messages.slice(at + 1).filter((m) => m.role === "tool") };
}

/** The ask with its marks taken out. */
const plain = (asked: string) => asked.replace(/\[(?:file|split|fan):[^\]]*\]|\[try-file\]|\[tools\]/g, "").replace(/\s+/g, " ").trim();

/**
 * One turn's script, read from the marks in what it was asked:
 *
 * - a task's notice (`Task "…`) is noted, and files nothing;
 * - `[file:<worker>]` (the first one) files the ask, less that mark, for that worker;
 * - `[split:<a>,<b>]` files one piece for each;
 * - `[fan:<n>]` files `n` unassigned pieces;
 * - `[try-file]` files the ask with no assignee;
 * - `[tools]` says which tools the turn was handed.
 *
 * Every filing is a call of the turn's own task tools: `createTask` for a piece with an owner, `createTask` with `held` for an unassigned one, which stays held. After the calls,
 * the turn says what they answered.
 */
const scripted = {
  modelId: "scripted/worker",
  async generate() {
    throw new Error("the owned tool loop calls generateStep");
  },
  async generateStep(options: { messages?: Message[]; tools?: Array<{ name?: string }> }) {
    const { asked, results } = lastAsk(options.messages ?? []);
    const tools = (options.tools ?? []).map((tool) => String(tool.name ?? "")).sort();
    const toolsLine = asked.includes("[tools]") ? ` tools=${JSON.stringify(tools)}` : "";
    if (asked.startsWith('Task "')) return { text: "Noted.", finishReason: "stop" };
    if (results.length > 0) {
      const answered = results.map((r) => textOf(r.content).slice(0, 300)).join(" | ");
      return { text: `The filings answered: ${answered}${toolsLine}`, finishReason: "stop" };
    }
    const calls: Array<{ toolCallId: string; toolName: string; args: Record<string, unknown> }> = [];
    const file = /\[file:([a-z0-9.-]+)\]/.exec(asked);
    const split = /\[split:([a-z0-9.,-]+)\]/.exec(asked);
    const fan = /\[fan:(\d+)\]/.exec(asked);
    if (file !== null) {
      calls.push({ toolCallId: "file-0", toolName: "createTask", args: { goal: asked.replace(file[0], "").replace(/\s+/g, " ").trim(), assignee: file[1]! } });
    } else if (split !== null) {
      split[1]!.split(",").forEach((assignee, i) => calls.push({ toolCallId: `split-${i}`, toolName: "createTask", args: { goal: `part ${i + 1} of: ${plain(asked)}`, assignee } }));
    } else if (fan !== null) {
      for (let i = 0; i < Number(fan[1]); i += 1) calls.push({ toolCallId: `fan-${i}`, toolName: "createTask", args: { held: true, goal: `piece ${i + 1} of: ${plain(asked)}` } });
    } else if (asked.includes("[try-file]")) {
      calls.push({ toolCallId: "try-0", toolName: "createTask", args: { held: true, goal: plain(asked) } });
    }
    if (calls.length > 0) return { toolCalls: calls, finishReason: "tool-calls" };
    return { text: `Done: ${plain(asked).slice(0, 200)}${toolsLine}`, finishReason: "stop" };
  },
};

const real = engine.createModelResolver();
const modelResolver = Object.assign(
  (id: string, block?: string) => {
    if (id === "goal/real" || (REAL_MODEL !== "" && id === REAL_MODEL)) {
      if (REAL_MODEL === "") throw new Error("GOAL_REAL_MODEL names no model for real.lead");
      return (real as any)(REAL_MODEL, block);
    }
    if (block?.startsWith("coordinator-route")) throw new Error(`the goal scripts no routing evaluation (block "${block}")`);
    return scripted;
  },
  { resolveId: (id: string) => id },
);

// ---- the app ------------------------------------------------------------------

const doorInput = z.object({ message: z.string() });

/**
 * `poster`: a worker flow that takes no task. Before FIX-2083 it took a
 * delegated post; a delegate is now a worker whose flow takes tasks, so a
 * worker on it is listed by `desk.router` and reaches no work.
 */
function posterFlow(installation: any) {
  const door = core.handler({
    name: "poster-run",
    inputSchema: z.unknown(),
    resources: { ...installation.resources },
    execute: async (_input: unknown, ctx: any) => `${(await installation.resolveWorker(ctx, "poster")).id} heard the post.`,
  });
  return core.defineFlow({
    kind: "poster",
    configSchema: wf.workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources },
    actions: { respond: { inputSchema: doorInput, block: door, userMessage: (i: { message: string }) => i.message } },
  } as never);
}

/**
 * `foreman`: an app's own worker flow, carrying the filing kit as an app
 * does. Its turn is one model block with the task tools in its `uses`.
 */
function foremanFlow(installation: any) {
  // A commit with no filing kit builds the flow without it: its worker then files nothing.
  const board = typeof wf.defineSessionBoard === "function" ? wf.defineSessionBoard({ installation, flowKind: "foreman" }) : undefined;
  const resolveWorker = core.handler({
    name: "foreman-resolve-worker",
    inputSchema: z.unknown(),
    outputSchema: z.object({ worker: z.string() }),
    resources: { ...installation.resources },
    execute: async (_input: unknown, ctx: any) => ({ worker: (await installation.resolveWorker(ctx, "foreman")).id }),
  });
  const answer = core.generator({
    name: "foreman-answer",
    model: "scripted/foreman",
    inputSchema: doorInput,
    ...(board === undefined ? {} : { uses: [board.tools] }),
    user: (input: { message: string }) => input.message,
  } as never);
  return core.defineFlow({
    kind: "foreman",
    configSchema: wf.workerConfigSchema(),
    session: board === undefined ? installation.session() : { ...installation.session(board.sessionStateShape), serverOwned: [...board.serverOwned] },
    resources: { ...installation.resources, ...(board?.resources ?? {}) },
    request: { onStarted: resolveWorker },
    actions: {
      respond: { inputSchema: doorInput.strict(), block: answer, userMessage: (input: { message: string }) => input.message },
      ...(board?.actions ?? {}),
    },
    internal: { actions: board === undefined ? {} : board.entries(answer) },
  } as never);
}

/** The four flows over one installation of `workers`, and the copies to register. */
function hire(workers: unknown[]): Array<{ id: string }> {
  let flows: Record<string, unknown> = {};
  const installation = wf.createWorkerInstallation({ standardWorkers: workers, workerFlows: () => flows });
  const agent = wf.defineAgentWorkerFlow({ installation });
  const poster = posterFlow(installation);
  const coordinator = wf.defineCoordinatorFlow({ installation, routeModel: "scripted/route" });
  // The foreman files its delegates' tasks.
  flows = { agent, coordinator, poster, foreman: { flow: foremanFlow(installation), roles: ["manager"] } };
  return wf.hireWorkforce(installation, CHAIN_LIMIT === undefined ? {} : { taskChainLimit: CHAIN_LIMIT }) as Array<{ id: string }>;
}

let copies: Array<{ id: string }>;
try {
  copies = hire(tree.workers);
} catch (error) {
  // An older commit, where only a coordinator declares `delegates:`, refuses
  // every other worker that lists them. Served without them there, so its
  // legs fail on what its workers do rather than on the load.
  if (!/"delegates" is not a declared setting/.test(String(error))) throw error;
  console.error("[goal lab] this commit refuses `delegates:` off the coordinator; serving those workers without them");
  copies = hire(
    tree.workers.map((worker: any) =>
      worker.declared?.flow === "coordinator" || worker.declared?.delegates === undefined
        ? worker
        : { ...worker, declared: Object.fromEntries(Object.entries(worker.declared).filter(([key]) => key !== "delegates")) },
    ),
  );
}

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
  modelResolver,
  resolvePrincipal,
} as never);
