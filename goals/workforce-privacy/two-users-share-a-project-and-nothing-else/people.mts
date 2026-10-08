/**
 * Alice and Bob (and Alice in her second organization), each acting through
 * the shipped clients with only their own verified bearer.
 *
 * Every change a step makes goes through these: the workforce client
 * (`createWorkforceClient`: the roster, `ensureWorkerSession`), the session
 * and resource clients, and an action client per flow. They are loaded from
 * the checkout under test, so a run on a fix's merge commit uses that
 * commit's clients, not this branch's.
 *
 * What a step grades is read separately, through the install's routes as the
 * same user (`labRoutes`, the oracle): never from Shift Manager's own state.
 */
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Client, ResourceClient, SessionClient, SessionDetail, SessionSummary } from "@flow-state-dev/client";
import { labRoutes, type LabRoutes, type StoredItem } from "../../lib/shift-manager.mts";
import { messageOf, type RunRecord, type Turn } from "./record.mts";

/** A person the run acts as. */
export interface Person {
  /** How the report names them. */
  label: string;
  userId: string;
  bearer: string;
}

/** One worker on a roster, as `createWorkforceClient().roster()` returns it. */
export type RosterEntry = { id: string; flow: string; standard: boolean; description: string | null };

/** The workforce client's surface this goal uses. */
interface WorkforceClient {
  roster(): Promise<RosterEntry[]>;
  findWorkerSession(criteria: { worker: string }): Promise<SessionSummary | undefined>;
  ensureWorkerSession(criteria: { worker: string }): Promise<SessionSummary>;
}

/** The shipped clients, as the checkout under test exports them. */
export interface Shipped {
  client: typeof import("@flow-state-dev/client");
  workforce: {
    createWorkforceClient(options: { userId: string; baseUrl?: string; fetcher?: typeof fetch }): WorkforceClient;
    deriveWorkerSessionId(input: { userId: string; orgId: string; flow: string; criteria: { worker: string } }): Promise<string>;
    ROSTER_FLOW_KIND: string;
    WORKER_ID_STATE_KEY: string;
  };
}

/**
 * Load the shipped clients from the checkout at `root`.
 *
 * @throws Naming the export the commit doesn't have.
 */
export async function loadShipped(root: string): Promise<Shipped> {
  const client = (await import(pathToFileURL(join(root, "packages", "client", "src", "index.ts")).href)) as Shipped["client"];
  const workforce = (await import(pathToFileURL(join(root, "packages", "workforce", "src", "browser.ts")).href)) as Shipped["workforce"];
  for (const name of ["createWorkforceClient", "deriveWorkerSessionId", "ROSTER_FLOW_KIND", "WORKER_ID_STATE_KEY"] as const) {
    if (workforce[name] === undefined) throw new Error(`the commit's @flow-state-dev/workforce/browser exports no ${name}`);
  }
  return { client, workforce };
}

/** A person connected to one served install. */
export interface Connected {
  person: Person;
  workforce: WorkforceClient;
  sessions: SessionClient;
  resources: ResourceClient;
  /** An action client on `flowKind`, as this person. `bodyUserId` forges the body's user id (the bearer stays theirs). */
  flow(flowKind: string, bodyUserId?: string): Client;
  /** The oracle: the install's routes, read as this person. */
  routes: LabRoutes;
}

/** Connect `person` to the install at `origin`: every request carries their bearer and nothing else. */
export function connect(shipped: Shipped, origin: string, person: Person): Connected {
  const fetcher: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${person.bearer}`);
    return fetch(input, { ...init, headers });
  };
  const transport = { baseUrl: origin, fetcher };
  return {
    person,
    workforce: shipped.workforce.createWorkforceClient({ userId: person.userId, ...transport }),
    sessions: shipped.client.createSessionClient(transport),
    resources: shipped.client.createResourceClient(transport),
    flow: (flowKind, bodyUserId) => shipped.client.createClient({ flowKind, userId: bodyUserId ?? person.userId, ...transport }),
    routes: labRoutes(origin, { userId: person.userId, bearer: person.bearer }),
  };
}

/** The HTTP status a shipped client's call was refused with, or `undefined` when it wasn't refused. */
export async function refusal(call: () => Promise<unknown>): Promise<{ status: number | undefined; error: string | undefined; value?: unknown }> {
  try {
    return { status: undefined, error: undefined, value: await call() };
  } catch (error) {
    const status = (error as { status?: unknown }).status;
    return { status: typeof status === "number" ? status : -1, error: messageOf(error) };
  }
}

/** The request states a turn is still running in. */
const RUNNING = new Set(["pending", "queued", "in_progress", "running"]);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** One action's end: its status, and its output or error, read back from the store. */
export interface Acted {
  status: string;
  requestId: string | null;
  output: unknown;
  error: string | undefined;
}

/**
 * Run `action` on `sessionId` through the shipped action client and wait for
 * it to end. A refusal at the door comes back as `http <status>`.
 */
export async function act(who: Connected, flowKind: string, sessionId: string, action: string, input: unknown, timeoutMs = 120_000): Promise<Acted> {
  const client = who.flow(flowKind);
  let requestId: string;
  try {
    requestId = (await client.sendAction(action, input, { sessionId })).request.id;
  } catch (error) {
    const status = (error as { status?: unknown }).status;
    return { status: `http ${typeof status === "number" ? status : "?"}`, requestId: null, output: undefined, error: messageOf(error) };
  }
  let status = "timed-out";
  for (const until = Date.now() + timeoutMs; Date.now() < until; await sleep(400)) {
    const now = (await client.getRequestStatus(requestId).catch(() => undefined))?.status as string | undefined;
    if (now !== undefined && !RUNNING.has(now)) {
      status = now;
      break;
    }
  }
  const found = (await who.routes.requests(sessionId).catch(() => [])).find((r) => r.id === requestId);
  return { status, requestId, output: found?.result?.output, error: found?.result?.error?.message };
}

/** The text of a stored message item. */
export function textOf(item: StoredItem | undefined): string {
  if (item === undefined) return "";
  const c = item.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => String((p as { text?: unknown }).text ?? "")).join("\n");
  return JSON.stringify(c ?? "");
}

/** A provider error: the model never answered (QR-10), as opposed to a worker that answered wrong. */
function providerError(text: string): boolean {
  return /rate.?limit|429|5\d\d |overloaded|timed? ?out|ECONNRESET|fetch failed|provider|gateway|unavailable|AI SDK stream failed/i.test(text);
}

/** The talk action a worker flow takes a person's message through: `run` on `agent`, else `message`. */
export function talkAction(actions: readonly string[]): string | undefined {
  return ["run", "message"].find((a) => actions.includes(a));
}

/**
 * Say `words` to a worker in its session, as `who`, through the app's talk
 * action, and read the turn back from the store by request id. Graded once;
 * a provider error re-runs that one turn and is reported (QR-10).
 */
export async function talk(record: RunRecord, step: string, who: Connected, session: { id: string; flowKind: string }, action: string, words: string): Promise<Turn> {
  const once = async (): Promise<Turn> => {
    const acted = await act(who, session.flowKind, session.id, action, { message: words }, 240_000);
    const turn: Turn = { step, who: who.person.label, words, sessionId: session.id, requestId: acted.requestId, status: acted.status, tools: [], reply: "", replyItemId: null };
    if (acted.requestId === null) {
      turn.reply = `refused: ${acted.error ?? ""}`;
      return turn;
    }
    const mine = (await who.routes.items(session.id, "")).filter((i) => i.requestId === acted.requestId);
    turn.tools = mine
      .filter((i) => i.type === "tool_output")
      .map((i) => ({ itemId: i.id, name: String(i.toolCall?.name ?? ""), args: String(i.toolCall?.arguments ?? "").slice(0, 300), output: JSON.stringify(i.output ?? i.error ?? null).slice(0, 300) }));
    const reply = mine.filter((i) => i.type === "message" && i.role === "assistant").at(-1);
    const error = mine.find((i) => i.type === "error");
    turn.reply = reply !== undefined ? textOf(reply) : error !== undefined ? `error: ${JSON.stringify(error.error ?? error).slice(0, 300)}` : (acted.error ?? "");
    if (reply === undefined) turn.items = mine.map((i) => `${i.type}${i.role === undefined ? "" : `/${i.role}`}#${i.id}`);
    turn.replyItemId = reply?.id ?? null;
    return turn;
  };
  let turn = await once();
  if (turn.status !== "completed" && providerError(turn.reply)) {
    const first = turn.reply;
    turn = await once();
    turn.providerRetry = first.slice(0, 200);
  }
  record.turns.push(turn);
  return turn;
}

/** The most recent of `rows`. */
export function mostRecent<T extends { updatedAt?: number; createdAt: number }>(rows: readonly T[]): T | undefined {
  return [...rows].sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt) || b.createdAt - a.createdAt)[0];
}

/** Everything one session holds that a person could read back: its state and every item, as one string. */
export async function everythingIn(who: Connected, sessionId: string): Promise<string> {
  const state = await who.routes.get(`/sessions/${encodeURIComponent(sessionId)}/state`).catch((e) => ({ unreadable: messageOf(e) }));
  const items = await who.routes.items(sessionId, "").catch(() => []);
  return JSON.stringify({ state, items });
}

export type { SessionDetail, SessionSummary };
