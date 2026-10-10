/**
 * Leg e on Shift Manager's DevTeam install, served by Shift Manager's own
 * command over a fresh store, with its chief of staff on the real model its
 * `WORKER.md` names. It only acts and waits; `run.mts` grades from the store.
 *
 * Every change goes through the app: the roster flow's `hire`, the
 * conversation's `addDelegate`, and Alice's one line to the chief of staff.
 * The worker whose task fails is an ordinary hire whose `model:` names a model
 * the gateway doesn't serve, so each attempt fails on the provider's answer,
 * not on anything this goal scripts. The second hire names the chief of
 * staff's own model, so a task filed again for it can complete. Nothing is
 * seeded or written to a store.
 *
 * The clients are loaded from the checkout under test, so a run on another
 * commit drives that commit's own clients.
 */
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { requests } from "./store.mts";

/** The chief of staff's worker id. */
export const COS = "chief-of-staff";

/** One person the run acts as. */
export interface Person {
  label: string;
  userId: string;
  bearer: string;
}

type Client = {
  sendAction(action: string, input: unknown, options: { sessionId: string }): Promise<{ request: { id: string } }>;
  getRequestStatus(requestId: string): Promise<{ status: string }>;
};
type SessionClient = {
  createSession(options: { flowKind: string; userId: string; sessionId?: string; state?: Record<string, unknown> }): Promise<{ id: string }>;
  listSessions(options: { flowKind?: string; userId?: string }): Promise<Array<{ id: string }>>;
  listSessionRequests(sessionId: string, options: { includeResultOutput?: boolean; limit?: number }): Promise<Array<{ id: string; result?: { output?: unknown; error?: { message: string } } }>>;
};

/** The shipped clients, as the checkout under test exports them. */
export interface Shipped {
  createClient(options: { flowKind: string; userId: string; baseUrl?: string; fetcher?: typeof fetch }): Client;
  createSessionClient(options: { baseUrl?: string; fetcher?: typeof fetch }): SessionClient;
}

/** Load the shipped clients from the checkout at `root`. */
export async function loadShipped(root: string): Promise<Shipped> {
  return (await import(pathToFileURL(join(root, "packages", "client", "src", "index.ts")).href)) as Shipped;
}

const RUNNING = new Set(["pending", "queued", "in_progress", "running"]);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const WORDS = ["heron", "copper", "lantern", "marble", "saffron", "willow", "ember", "glacier", "orchid", "tinsel"];
const word = () => `${WORDS[randomBytes(1)[0]! % WORDS.length]}${randomBytes(3).toString("hex")}`;

/** One action's end: how it ended, and what it answered or why it was refused. */
export interface Acted {
  status: string;
  requestId: string | null;
  output: any;
  error: string | undefined;
}

function connect(shipped: Shipped, origin: string, person: Person) {
  const fetcher: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${person.bearer}`);
    return fetch(input, { ...init, headers });
  };
  const transport = { baseUrl: origin, fetcher };
  return {
    person,
    sessions: shipped.createSessionClient(transport),
    flow: (flowKind: string) => shipped.createClient({ flowKind, userId: person.userId, ...transport }),
  };
}
type Connected = ReturnType<typeof connect>;

async function act(who: Connected, flowKind: string, sessionId: string, action: string, input: unknown, timeoutMs = 120_000): Promise<Acted> {
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
    const now = (await client.getRequestStatus(requestId).catch(() => undefined))?.status;
    if (now !== undefined && !RUNNING.has(now)) {
      status = now;
      break;
    }
  }
  const listed: Awaited<ReturnType<SessionClient["listSessionRequests"]>> = await who.sessions
    .listSessionRequests(sessionId, { includeResultOutput: true, limit: 200 })
    .catch(() => []);
  const found = listed.find((r) => r.id === requestId);
  return { status, requestId, output: found?.result?.output, error: found?.result?.error?.message };
}

/** Wait until the store holds no request running or waiting to run, three reads in a row. */
async function quiet(store: string, timeoutMs: number): Promise<number> {
  let calm = 0;
  for (const until = Date.now() + timeoutMs; Date.now() < until; await sleep(1_000)) {
    calm = requests(store).some((r) => RUNNING.has(r.status)) ? 0 : calm + 1;
    if (calm >= 3) return Date.now();
  }
  throw new Error(`the Lab kept running for ${timeoutMs / 1000} s`);
}

/** What leg e did, for `run.mts` to grade from the store. */
export interface LegE {
  conv: string;
  broken: string;
  helper: string;
  /** The model the broken worker names, which the gateway doesn't serve. */
  badModel: string;
  goalWord: string;
  ask: string;
  hired: Acted[];
  added: Acted[];
  turn: Acted;
  quietAt: number;
  graceMs: number;
}

/**
 * Leg e: Alice hires two workers on `agent`, one naming a model nobody serves,
 * adds both to a new conversation with her chief of staff, and asks it to file
 * a task for the first and, if it fails, to file it again for the second.
 */
export async function legE(o: {
  origin: string;
  store: string;
  shipped: Shipped;
  alice: Person;
  ask: string;
  /** The model the second hire names: one the Lab serves, so a task filed again for it can complete. */
  helperModel: string;
  say: (s: string) => void;
}): Promise<LegE> {
  const alice = connect(o.shipped, o.origin, o.alice);
  const rosterKind = "workforce-roster";
  const roster =
    (await alice.sessions.listSessions({ flowKind: rosterKind, userId: o.alice.userId }))[0]?.id ??
    (await alice.sessions.createSession({ flowKind: rosterKind, userId: o.alice.userId })).id;
  const broken = `drafter-${word()}`;
  const helper = `scribe-${word()}`;
  const badModel = `openai/${word()}-unserved`;
  const hired = [
    await act(alice, rosterKind, roster, "hire", { id: broken, flow: "agent", description: "Drafts release notes.", settings: { model: badModel } }),
    await act(alice, rosterKind, roster, "hire", { id: helper, flow: "agent", description: "Drafts release notes.", settings: { model: o.helperModel } }),
  ];
  const conv = (await alice.sessions.createSession({ flowKind: "coordinator", userId: o.alice.userId, state: { workerId: COS } })).id;
  const added = [
    await act(alice, "coordinator", conv, "addDelegate", { worker: broken }),
    await act(alice, "coordinator", conv, "addDelegate", { worker: helper }),
  ];
  const goalWord = word();
  const ask = o.ask.replaceAll("{broken}", broken).replaceAll("{helper}", helper).replaceAll("{word}", goalWord);
  o.say(`leg e: "${ask}"`);
  const turn = await act(alice, "coordinator", conv, "run", { message: ask }, 240_000);
  // The task's two attempts, its notice, the turn that notice wakes, and any
  // task that turn files: wait for all of it to go quiet, then a grace.
  await sleep(2_000);
  await quiet(o.store, 360_000);
  const graceMs = 5_000;
  await sleep(graceMs);
  const quietAt = await quiet(o.store, 240_000);
  return { conv, broken, helper, badModel, goalWord, ask, hired, added, turn, quietAt, graceMs };
}
