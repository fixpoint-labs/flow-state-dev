/**
 * Legs a, c and d's Lab: a goal-local coordinator tree on the real engine and
 * a SQLite store, served by Shift Manager's own command over HTTP, the way
 * DevTeam is. Two people sign in, each with their own verified bearer
 * (`people.mts`); a request with no bearer, or one nobody recognises, is
 * refused. No real model: the coordinators' judgment and the `agent` workers'
 * turns are scripted by marks in what they read.
 *
 * The tree (`../fixtures/workforce/`): `desk.lead`, a coordinator whose
 * delegates are `desk.alpha` and `desk.beta` (both on `agent`) and
 * `desk.sub`, a coordinator. Scripts:
 *
 * - a coordinator's turn files a `[file:<worker>]` message as a task for that
 *   worker, with the message less that mark as its goal, through its own
 *   `addTask` tool; a `[split:<worker>]` message it tries to split, filing a
 *   piece for that worker; a line that tells it a task ended it notes, and
 *   files nothing; anything else it notes;
 * - an `agent` worker's turn holds its answer for `[slow:<ms>]`, fails on
 *   `[fail]`, and otherwise answers `Done: <the task>`.
 *
 * The store is the file `GOAL_STORE` names. Nothing here writes a row, a
 * session or a notice: every change is an action a person sends, or what the
 * system does with it. Against another commit, `run.mts` copies this folder
 * and `fixtures/` into that checkout's `goals/`, so every import resolves to
 * that commit's packages.
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as engine from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import * as workforce from "@flow-state-dev/workforce";
import { readWorkforce } from "@flow-state-dev/workforce/loader";
import { ORG, PEOPLE } from "./people.mts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const STORE = process.env.GOAL_STORE ?? "";
if (STORE === "") throw new Error("GOAL_STORE names no store file");

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const wf = workforce as unknown as Record<string, any>;
const missing = ["createWorkerInstallation", "defineAgentWorkerFlow", "defineCoordinatorFlow", "hireWorkforce"].filter(
  (name) => typeof wf[name] !== "function",
);
if (missing.length > 0) throw new Error(`this commit's @flow-state-dev/workforce exports no ${missing.join(", ")}`);

const tree = await readWorkforce(join(HERE, "..", "fixtures", "workforce"));
if (tree.errors.length > 0) throw new Error(`the goal-local tree did not load: ${JSON.stringify(tree.errors).slice(0, 600)}`);

// ---- the scripted models ----------------------------------------------------

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

const judgment = {
  modelId: "scripted/judgment",
  async generate() {
    throw new Error("the owned tool loop calls generateStep");
  },
  async generateStep(options: { messages?: Message[] }) {
    const { asked, results } = lastAsk(options.messages ?? []);
    // A notice that a task ended: noted, and nothing filed.
    if (asked.startsWith('Task "')) return { text: "Noted.", finishReason: "stop" };
    if (results.length === 0) {
      const file = /\[file:([a-z.-]+)\]/.exec(asked);
      if (file !== null) {
        const goal = asked.replace(file[0], "").trim();
        return { toolCalls: [{ toolCallId: "file-0", toolName: "addTask", args: { goal, assignee: file[1] } }], finishReason: "tool-calls" };
      }
      const split = /\[split:([a-z.-]+)\]/.exec(asked);
      if (split !== null) {
        const goal = `a piece of: ${asked.replace(split[0], "").trim()}`;
        return { toolCalls: [{ toolCallId: "split-0", toolName: "addTask", args: { goal, assignee: split[1] } }], finishReason: "tool-calls" };
      }
      return { text: "Noted.", finishReason: "stop" };
    }
    return { text: `The filing answered: ${textOf(results.at(-1)!.content).slice(0, 400)}`, finishReason: "stop" };
  },
};

const agentModel = {
  modelId: "scripted/agent",
  async generate() {
    throw new Error("the owned tool loop calls generateStep");
  },
  async generateStep(options: { messages?: Message[] }) {
    const { asked } = lastAsk(options.messages ?? []);
    const slow = /\[slow:(\d+)\]/.exec(asked);
    if (slow !== null) await sleep(Number(slow[1]));
    if (asked.includes("[fail]")) throw new Error(`the scripted worker could not do: ${asked.slice(0, 120)}`);
    return { text: `Done: ${asked.slice(0, 200)}`, finishReason: "stop" };
  },
};

const modelResolver = Object.assign(
  (_id: string, block?: string) => {
    if (block?.startsWith("coordinator-judgment")) return judgment;
    if (block?.startsWith("agent-answer")) return agentModel;
    throw new Error(`the goal scripts no model for block "${block}"`);
  },
  { resolveId: (id: string) => id },
);

// ---- the app ----------------------------------------------------------------

let flows: Record<string, unknown> = {};
const installation = wf.createWorkerInstallation({ standardWorkers: tree.workers, workerFlows: () => flows });
const agent = wf.defineAgentWorkerFlow({ installation });
const coordinator = wf.defineCoordinatorFlow({ installation, delegateFlows: [agent], routeModel: "scripted/route" });
flows = { agent, coordinator };
const copies = wf.hireWorkforce(installation) as Array<{ id: string }>;

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
