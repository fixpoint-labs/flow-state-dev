/**
 * What the goal's people do, over HTTP, against the goal-local Lab
 * (`lab/fsdev.config.mts`) served by Shift Manager's command: two people,
 * each signed in with their own verified bearer, acting through the shipped
 * clients loaded from the checkout under test. It only acts, and returns what
 * each action answered; `run.mts` grades, reading the store file the Lab
 * writes.
 *
 * It never drains a board or reads one while it waits for a task: it waits
 * until the store holds no request running or waiting to run.
 */
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ORG, PEOPLE } from "./lab/people.mts";
import { requests, sessions } from "../../coordinators/files-tasks-down-the-owners-chain/store.mts";

/** The wait after things go quiet, before the run reports and the store is read again. */
export const GRACE_MS = 5_000;
/** The roster flow, which a person hires through. */
const ROSTER = "workforce-roster";

const RUNNING = new Set(["pending", "queued", "in_progress", "running"]);
const TERMINAL = new Set(["completed", "failed", "incomplete", "aborted", "interrupted"]);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const WORDS = ["heron", "copper", "lantern", "marble", "saffron", "willow", "ember", "glacier", "orchid", "tinsel"];
/** A word nobody wrote down before the run. */
export const word = () => `${WORDS[randomBytes(1)[0]! % WORDS.length]}${randomBytes(3).toString("hex")}`;
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The shipped clients, as the checkout under test exports them. */
export interface Shipped {
  client: { createClient(options: Record<string, unknown>): any };
}

/** Load the shipped clients from the checkout at `root`. */
export async function loadShipped(root: string): Promise<Shipped> {
  const client = (await import(pathToFileURL(join(root, "packages", "client", "src", "index.ts")).href)) as Shipped["client"];
  return { client };
}

type Person = (typeof PEOPLE)[keyof typeof PEOPLE];

/** One action's end: how it ended, and what it answered or why it was refused. */
export type Acted = { status: string; requestId: string | null; output: any; error: string | undefined; startedAt: number; endedAt: number };

/** A person signed in to the Lab at `origin`, and what they can do there. */
export function connect(shipped: Shipped, origin: string, store: string, person: Person) {
  const fetcher: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${person.bearer}`);
    return fetch(input, { ...init, headers });
  };
  const transport = { baseUrl: origin, fetcher };
  // One client, as the person.
  const fsd = shipped.client.createClient({ userId: person.userId, ...transport });
  const sessions = fsd.sessions;
  const flow = (flowKind: string) => fsd.flow(flowKind);

  /** Send `action` on `sessionId` and wait for it to end. */
  const act = async (flowKind: string, sessionId: string, action: string, input: unknown, timeoutMs = 90_000): Promise<Acted> => {
    const startedAt = Date.now();
    const client = flow(flowKind);
    let requestId: string;
    try {
      requestId = (await client.send(action, input, { sessionId })).id;
    } catch (error) {
      const status = (error as { status?: unknown }).status;
      return { status: `http ${typeof status === "number" ? status : "?"}`, requestId: null, output: undefined, error: messageOf(error), startedAt, endedAt: Date.now() };
    }
    let status = "timed-out";
    for (const until = Date.now() + timeoutMs; Date.now() < until; await sleep(50)) {
      const now = (await client.request(requestId).status().catch(() => undefined))?.status as string | undefined;
      if (now !== undefined && TERMINAL.has(now)) {
        status = now;
        break;
      }
    }
    const endedAt = Date.now();
    const listed = (await sessions.requests(sessionId, { includeResultOutput: true, limit: 500 }).catch(() => [])) as any[];
    const found = listed.find((r) => r.id === requestId);
    return { status, requestId, output: found?.result?.output, error: found?.result?.error?.message, startedAt, endedAt };
  };

  /** Open a conversation with `worker` on `flowKind`, as an app opens one. */
  const conversation = async (flowKind: string, worker: string): Promise<string> =>
    (await fsd.flow(flowKind).createSession({ state: { workerId: worker } })).id as string;

  /** Hire a worker of this person's own, through the roster flow. */
  const hire = async (input: Record<string, unknown>): Promise<Acted> => {
    const roster =
      ((await sessions.list({ flowKind: ROSTER, userId: person.userId })) as Array<{ id: string }>)[0]?.id ??
      ((await fsd.flow(ROSTER).createSession()) as { id: string }).id;
    return act(ROSTER, roster, "hire", input);
  };

  return { person, sessions, act, conversation, hire };
}
export type Connected = ReturnType<typeof connect>;

/** Nothing running or waiting to run in the store, three reads in a row. */
export async function quiet(store: string, timeoutMs = 180_000): Promise<number> {
  let calm = 0;
  for (const until = Date.now() + timeoutMs; Date.now() < until; await sleep(200)) {
    calm = requests(store).some((r) => RUNNING.has(r.status)) ? 0 : calm + 1;
    if (calm >= 3) return Date.now();
  }
  throw new Error(`the Lab kept running for ${timeoutMs / 1000} s`);
}

/** The one session of Alice's the store holds for `worker`, under `under` (a conversation), or `null`. */
function sessionOf(store: string, worker: string, under: string): string | null {
  const all = sessions(store);
  const inChain = new Set([under]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const s of all) if (s.parentSessionId !== null && inChain.has(s.parentSessionId) && !inChain.has(s.id)) (inChain.add(s.id), (grew = true));
  }
  const found = all.filter((s) => inChain.has(s.id) && s.state.workerId === worker && s.userId === PEOPLE.alice.userId);
  return found.length === 1 ? found[0]!.id : null;
}

/**
 * Legs a to d's model-free part against the Lab at `origin`, writing `store`.
 * @returns What each leg's actions answered, for `run.mts` to grade.
 */
export async function scriptedLegs(o: { origin: string; store: string; shipped: Shipped; legs: ReadonlySet<string> }): Promise<Record<string, any>> {
  const alice = connect(o.shipped, o.origin, o.store, PEOPLE.alice);
  const bob = connect(o.shipped, o.origin, o.store, PEOPLE.bob);
  const out: Record<string, any> = { org: ORG, people: PEOPLE, graceMs: GRACE_MS };
  /** Run one leg; what it threw is that leg's setup failure, and the next leg still runs. */
  const leg = async (name: string, body: () => Promise<void>) => {
    try {
      await body();
    } catch (error) {
      out[name] = { setup: error instanceof Error ? (error.stack ?? error.message).slice(0, 800) : String(error) };
    }
  };

  // a: Alice's own `agent` worker files a task for crew.planner, which splits
  // it for its two delegates. Bob has a worker of the same name, whose one
  // delegate is crew.one.
  if (o.legs.has("a"))
    await leg("a", async () => {
      const lead = `lead-${randomBytes(3).toString("hex")}`;
      const hired = {
        alice: await alice.hire({ id: lead, flow: "agent", description: "Leads Alice's launches.", settings: { model: "scripted/agent", delegates: ["crew.planner"] } }),
        bob: await bob.hire({ id: lead, flow: "agent", description: "Leads Bob's errands.", settings: { model: "scripted/agent", delegates: ["crew.one"] } }),
      };
      if (hired.alice.output?.id !== lead) throw new Error(`Alice's hire of an \`agent\` worker listing delegates was refused: ${hired.alice.error ?? hired.alice.status}`);
      const conv = await alice.conversation("agent", lead);
      const bobConv = await bob.conversation("agent", lead);
      const w = word();
      const bw = word();
      const turn = await alice.act("agent", conv, "respond", { message: `[file:crew.planner] [split:crew.one,crew.two] Plan the ${w} launch` });
      // While Alice's chain runs, Bob's worker of the same name tries her delegate, then files for its own.
      const bobTurn = await bob.act("agent", bobConv, "respond", { message: `[file:crew.planner] Plan the ${bw} launch` });
      const bobOwn = await bob.act("agent", bobConv, "respond", { message: `[file:crew.one] Sort the ${bw} receipts` });
      const quietAt = await quiet(o.store);
      out.a = { lead, hired, conv, bobConv, word: w, bobWord: bw, turn, bobTurn, bobOwn, quietAt };
    });

  // b: a worker on the goal-local app flow files for an `agent` delegate.
  if (o.legs.has("b"))
    await leg("b", async () => {
      const conv = await alice.conversation("foreman", "shop.foreman");
      const w = word();
      const turn = await alice.act("foreman", conv, "respond", { message: `[file:crew.one] Paint the ${w} shed` });
      const quietAt = await quiet(o.store);
      out.b = { conv, word: w, turn, quietAt };
    });

  // c: a routing coordinator whose one delegate takes no task, and a worker
  // with no delegates: each turn says which tools it was handed and tries to
  // file; the app tries to file on each conversation.
  if (o.legs.has("c"))
    await leg("c", async () => {
      const w = word();
      const c: Record<string, any> = { word: w };
      for (const [label, flowKind, worker] of [
        ["router", "coordinator", "desk.router"],
        ["solo", "agent", "crew.solo"],
      ] as const) {
        const conv = await alice.conversation(flowKind, worker);
        const turn = await alice.act(flowKind, conv, "respond", { message: `[tools] [try-file] Sort the ${w} pile` });
        const app = await alice.act(flowKind, conv, "createTask_tasks", { held: true, goal: `Sort the ${w} pile` });
        c[label] = { conv, flowKind, worker, turn, app };
      }
      c.quietAt = await quiet(o.store);
      out.c = c;
    });

  // d: a chain that hands on at every level, and a worker that fans out.
  if (o.legs.has("d"))
    await leg("d", async () => {
      const w = word();
      const conv = await alice.conversation("agent", "deep.d0");
      const marks = [1, 2, 3, 4, 5, 6].map((i) => `[file:deep.d${i}]`).join(" ");
      const turn = await alice.act("agent", conv, "respond", { message: `${marks} Dig the ${w} well` });
      await quiet(o.store);
      // The app files on the deepest board too: the session of the task on the fifth.
      const d5 = sessionOf(o.store, "deep.d5", conv);
      const deepApp = d5 === null ? null : await alice.act("agent", d5, "createTask_tasks", { goal: `Dig the ${w} well deeper`, assignee: "deep.d6" });
      const fw = word();
      const fanConv = await alice.conversation("agent", "wide.top");
      const fanTurn = await alice.act("agent", fanConv, "respond", { message: `[file:wide.fan] [fan:101] Count the ${fw} beans` }, 180_000);
      await quiet(o.store, 300_000);
      const fan = sessionOf(o.store, "wide.fan", fanConv);
      const fanApp = fan === null ? null : await alice.act("agent", fan, "createTask_tasks", { held: true, goal: `Count the ${fw} beans again` });
      const quietAt = await quiet(o.store);
      out.d = { word: w, conv, turn, d5, deepApp, fanWord: fw, fanConv, fanTurn, fan, fanApp, quietAt };
    });

  // The grace: anything late (a second notice, a stray run) lands before the store is read again.
  await sleep(GRACE_MS);
  out.gracedAt = await quiet(o.store);
  return out;
}

/** Leg d on a Lab whose app sets its chain cap: the fan files four. */
export async function capLeg(o: { origin: string; store: string; shipped: Shipped; cap: number }): Promise<Record<string, any>> {
  const alice = connect(o.shipped, o.origin, o.store, PEOPLE.alice);
  const fw = word();
  const fanConv = await alice.conversation("agent", "wide.top");
  const fanTurn = await alice.act("agent", fanConv, "respond", { message: `[file:wide.fan] [fan:${o.cap + 1}] Count the ${fw} beans` });
  await quiet(o.store);
  const fan = sessionOf(o.store, "wide.fan", fanConv);
  const fanApp = fan === null ? null : await alice.act("agent", fan, "createTask_tasks", { held: true, goal: `Count the ${fw} beans again` });
  await quiet(o.store);
  await sleep(GRACE_MS);
  const quietAt = await quiet(o.store);
  return { org: ORG, people: PEOPLE, cap: o.cap, fanWord: fw, fanConv, fanTurn, fan, fanApp, quietAt };
}
