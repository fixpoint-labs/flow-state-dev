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
import type { Client, FlowHandle, SessionSummary } from "@flow-state-dev/client";
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
  ensureWorkerSession(criteria: { worker: string }): Promise<SessionSummary>;
}

/** The shipped clients, as the checkout under test exports them. */
export interface Shipped {
  client: typeof import("@flow-state-dev/client");
  workforce: {
    createWorkforceClient(client: Client): WorkforceClient;
    deriveWorkerSessionId(input: { userId: string; orgId: string; flow: string; criteria: { worker: string } }): Promise<string>;
  };
}

/**
 * Load the shipped clients from the checkout at `root`.
 *
 * @param options.tolerateMissing For the pre-epic baseline: a missing workforce
 *   client export becomes one whose every call throws, naming it.
 * @throws Naming the export the commit doesn't have, unless tolerated.
 */
export async function loadShipped(root: string, options: { tolerateMissing?: boolean } = {}): Promise<Shipped> {
  const client = (await import(pathToFileURL(join(root, "packages", "client", "src", "index.ts")).href)) as Shipped["client"];
  // A copy: a module namespace can't take the stand-ins the baseline needs.
  const workforce = { ...(await import(pathToFileURL(join(root, "packages", "workforce", "src", "browser.ts")).href)) } as Shipped["workforce"];
  for (const name of ["createWorkforceClient", "deriveWorkerSessionId"] as const) {
    if (workforce[name] !== undefined) continue;
    if (!options.tolerateMissing) throw new Error(`the commit's @flow-state-dev/workforce/browser exports no ${name}`);
    // The pre-epic baseline predates the client: every call through it is refused, naming what's missing.
    const missing = () => {
      throw new Error(`the commit's @flow-state-dev/workforce/browser exports no ${name}`);
    };
    (workforce as Record<string, unknown>)[name] = name === "createWorkforceClient" ? () => ({ roster: missing, ensureWorkerSession: missing }) : missing;
  }
  return { client, workforce };
}

/** A person connected to one served install. */
export interface Connected {
  person: Person;
  workforce: WorkforceClient;
  /** The flows the install hosts, as this person reads them. */
  flows: Client["flows"];
  sessions: Client["sessions"];
  resources: Client["resources"];
  /** `flowKind`'s actions, as this person. `bodyUserId` forges the body's user id (the bearer stays theirs). */
  flow(flowKind: string, bodyUserId?: string): FlowHandle;
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
  // One client per person: their user, their credential.
  const client = shipped.client.createClient({ userId: person.userId, ...transport });
  return {
    person,
    workforce: shipped.workforce.createWorkforceClient(client),
    flows: () => client.flows(),
    sessions: client.sessions,
    resources: client.resources,
    // A forged body user is another client over the same credential: the probe a person's own client never sends.
    flow: (flowKind, bodyUserId) =>
      (bodyUserId === undefined ? client : shipped.client.createClient({ userId: bodyUserId, ...transport })).flow(flowKind),
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
    requestId = (await client.send(action, input, { sessionId })).id;
  } catch (error) {
    const status = (error as { status?: unknown }).status;
    return { status: `http ${typeof status === "number" ? status : "?"}`, requestId: null, output: undefined, error: messageOf(error) };
  }
  let status = "timed-out";
  for (const until = Date.now() + timeoutMs; Date.now() < until; await sleep(400)) {
    const now = (await client.request(requestId).status().catch(() => undefined))?.status as string | undefined;
    if (now !== undefined && !RUNNING.has(now)) {
      status = now;
      break;
    }
  }
  const found = (await who.routes.requests(sessionId).catch((): Array<Record<string, any>> => [])).find((r) => r.id === requestId);
  return { status, requestId, output: found?.result?.output, error: found?.result?.error?.message };
}

/** The delegates a coordinator's routing record for post `messageRequestId` delivered it to, among a request's items. */
function routedDelegates(items: readonly StoredItem[], messageRequestId: string): string[] {
  return items
    .filter((i) => i.type === "component" && (i as { component?: unknown }).component === "coordinator-route")
    .map((i) => i.data as { messageRequestId?: unknown; delegates?: Array<{ worker?: unknown; outcome?: unknown }> } | undefined)
    .filter((d) => d?.messageRequestId === messageRequestId)
    .flatMap((d) => (d?.delegates ?? []).filter((x) => x.outcome === "delivered").map((x) => String(x.worker)));
}

/**
 * The answer one of `delegates` gave post `messageRequestId` in `sessionId`: the first
 * assistant message after the post's own that names one of them as its
 * `agentName` (a delegate's first message is the one graded), read once
 * nothing runs in the session and its items stopped changing.
 *
 * At the `timeoutMs` cap it returns the answer it found even if the session
 * never settled, and `undefined` when none landed. With `act`'s own 240 s
 * wait before it, a routed turn can take up to about twice that. "Quiet" is
 * not "the board is done": a board pass due later can still write items
 * after this returns, which m2's exception for her board's own passes covers.
 */
async function delegateAnswer(who: Connected, sessionId: string, messageRequestId: string, delegates: readonly string[], timeoutMs: number): Promise<StoredItem | undefined> {
  let answer: StoredItem | undefined;
  let seen = -1;
  for (const until = Date.now() + timeoutMs; Date.now() < until; await sleep(500)) {
    const items = await who.routes.items(sessionId, "");
    const from = items.findIndex((i) => i.type === "message" && i.role === "user" && i.requestId === messageRequestId);
    if (from < 0) continue;
    answer = items.slice(from + 1).find((i) => i.type === "message" && i.role === "assistant" && delegates.includes(String((i as { agentName?: unknown }).agentName)));
    const running = (await who.routes.requests(sessionId)).some((r) => RUNNING.has(String(r.status)));
    if (answer !== undefined && !running && items.length === seen) return answer;
    seen = running ? -1 : items.length;
  }
  return answer;
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

/** The talk action a worker flow takes a person's message through: `respond`, on every worker flow. */
export function talkAction(actions: readonly string[]): string | undefined {
  return actions.includes("respond") ? "respond" : undefined;
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
    let reply = mine.filter((i) => i.type === "message" && i.role === "assistant").at(-1);
    // A coordinator that routed the post answers through its delegate, in a
    // request of its own once the delegate's turn ends (the coordinator
    // contract): the turn is graded on that answer, read once the session is quiet.
    const delegates = routedDelegates(mine, acted.requestId);
    if (reply === undefined && delegates.length > 0) {
      reply = await delegateAnswer(who, session.id, acted.requestId, delegates, 240_000);
      if (reply !== undefined) turn.answeredBy = String((reply as { agentName?: unknown }).agentName);
    }
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

export type { SessionSummary };
