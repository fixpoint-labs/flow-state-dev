/**
 * Legs a, c and d against the goal-local Lab (`lab/fsdev.config.mts`), served
 * by Shift Manager's command: two people, each signed in with their own
 * verified bearer, acting over HTTP through the shipped clients loaded from
 * the checkout under test. It only acts, and returns what each action
 * answered; `run.mts` grades, reading the store file the Lab writes.
 *
 * It never drains a board or reads one while it waits for a task: it waits
 * until the store holds no request running or waiting to run.
 */
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ORG, PEOPLE } from "./lab/people.mts";
import { requests } from "./store.mts";

/** How long leg a's delegate holds its answer, so the filing can be seen returning first. */
const HOLD_MS = 2_500;
/** How long leg c's slow task runs, so the other conversation's board runs while it does. */
const SLOW_MS = 4_000;
/** The wait after things go quiet, before the run reports and the store is read again. */
const GRACE_MS = 5_000;
/** The roster flow, which a person hires through. */
const ROSTER = "workforce-roster";

const RUNNING = new Set(["pending", "queued", "in_progress", "running"]);
const TERMINAL = new Set(["completed", "failed", "incomplete", "aborted", "interrupted"]);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const WORDS = ["heron", "copper", "lantern", "marble", "saffron", "willow", "ember", "glacier", "orchid", "tinsel"];
const word = () => `${WORDS[randomBytes(1)[0]! % WORDS.length]}${randomBytes(3).toString("hex")}`;
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The shipped clients, as the checkout under test exports them. */
export interface ScriptedClients {
  client: { createClient(options: Record<string, unknown>): any; createSessionClient(options: Record<string, unknown>): any };
  workforce: { createWorkforceClient(options: Record<string, unknown>): any };
}

/** Load the shipped clients from the checkout at `root`. */
export async function loadScriptedClients(root: string): Promise<ScriptedClients> {
  const client = (await import(pathToFileURL(join(root, "packages", "client", "src", "index.ts")).href)) as ScriptedClients["client"];
  const workforce = (await import(pathToFileURL(join(root, "packages", "workforce", "src", "browser.ts")).href)) as ScriptedClients["workforce"];
  return { client, workforce };
}

type Person = (typeof PEOPLE)[keyof typeof PEOPLE];

/** One action's end: how it ended, and what it answered or why it was refused. */
type Acted = { status: string; requestId: string | null; output: any; error: string | undefined; startedAt: number; endedAt: number };

/**
 * Run `legs` against the Lab at `origin`, writing `store`.
 * @returns What each leg's actions answered, for `run.mts` to grade.
 */
export async function scriptedLegs(o: { origin: string; store: string; shipped: ScriptedClients; legs: ReadonlySet<string> }): Promise<Record<string, any>> {
  const connect = (person: Person) => {
    const fetcher: typeof fetch = (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("authorization", `Bearer ${person.bearer}`);
      return fetch(input, { ...init, headers });
    };
    const transport = { baseUrl: o.origin, fetcher };
    return {
      person,
      sessions: o.shipped.client.createSessionClient(transport),
      workforce: o.shipped.workforce.createWorkforceClient({ userId: person.userId, ...transport }),
      flow: (flowKind: string) => o.shipped.client.createClient({ flowKind, userId: person.userId, ...transport }),
      get: (path: string) => fetcher(`${o.origin}/api/flows${path}`),
    };
  };
  type Connected = ReturnType<typeof connect>;

  const act = async (who: Connected, flowKind: string, sessionId: string, action: string, input: unknown): Promise<Acted> => {
    const startedAt = Date.now();
    const client = who.flow(flowKind);
    let requestId: string;
    try {
      requestId = (await client.sendAction(action, input, { sessionId })).request.id;
    } catch (error) {
      const status = (error as { status?: unknown }).status;
      return { status: `http ${typeof status === "number" ? status : "?"}`, requestId: null, output: undefined, error: messageOf(error), startedAt, endedAt: Date.now() };
    }
    let status = "timed-out";
    for (const until = Date.now() + 60_000; Date.now() < until; await sleep(25)) {
      const now = (await client.getRequestStatus(requestId).catch(() => undefined))?.status as string | undefined;
      if (now !== undefined && TERMINAL.has(now)) {
        status = now;
        break;
      }
    }
    const endedAt = Date.now();
    const listed = (await who.sessions.listSessionRequests(sessionId, { includeResultOutput: true, limit: 200 }).catch(() => [])) as any[];
    const found = listed.find((r) => r.id === requestId);
    return { status, requestId, output: found?.result?.output, error: found?.result?.error?.message, startedAt, endedAt };
  };

  /** Open a conversation with `worker` on the coordinator flow, as an app opens one. */
  const conversation = async (who: Connected, worker: string): Promise<string> =>
    (await who.sessions.createSession({ flowKind: "coordinator", userId: who.person.userId, state: { workerId: worker } })).id as string;

  /** The tool outputs one request's turn produced, in order, read through the session's items. */
  const toolOutputs = async (who: Connected, sessionId: string, requestId: string | null): Promise<Array<{ name: string; output: any }>> => {
    if (requestId === null) return [];
    const state = await who.sessions.getSessionState(sessionId, { includeItems: true, itemTypes: ["tool_output"], limit: 500 });
    return ((state.items ?? []) as any[])
      .filter((item) => item.requestId === requestId)
      .map((item) => ({ name: String(item.toolCall?.name ?? ""), output: parsed(item.output ?? item.error ?? null) }));
  };

  /** Nothing running or waiting to run in the store, three reads in a row. */
  const quiet = async (timeoutMs = 90_000): Promise<number> => {
    let calm = 0;
    for (const until = Date.now() + timeoutMs; Date.now() < until; await sleep(150)) {
      calm = requests(o.store).some((r) => RUNNING.has(r.status)) ? 0 : calm + 1;
      if (calm >= 3) return Date.now();
    }
    throw new Error(`the Lab kept running for ${timeoutMs / 1000} s`);
  };

  /** A conversation's `filingSessionId`, as its own `listDelegates` answers it: what an app finds its sessions by. */
  const filingOf = async (who: Connected, sessionId: string): Promise<string> => {
    const listed = await act(who, "coordinator", sessionId, "listDelegates", {});
    return (listed.output?.filingSessionId as string | undefined) ?? `(listDelegates answered ${listed.status}: ${listed.error ?? ""})`;
  };

  /** `findWorkerSession`, as the app calls it; what it threw, if it did. */
  const find = async (who: Connected, criteria: Record<string, string>): Promise<{ id: string | null; error?: string }> => {
    try {
      const found = await who.workforce.findWorkerSession(criteria);
      return { id: found?.id ?? null };
    } catch (error) {
      return { id: null, error: messageOf(error) };
    }
  };

  const taskIdOf = (acted: { output: any } | null | undefined) => (acted?.output?.ok === true ? (acted.output.taskId as string) : null);

  const alice = connect(PEOPLE.alice);
  const bob = connect(PEOPLE.bob);
  const out: Record<string, any> = { org: ORG, people: PEOPLE, holdMs: HOLD_MS, slowMs: SLOW_MS, graceMs: GRACE_MS };

  // a: Alice's coordinator files a task for her `agent` delegate, and a
  // delegate's task session splits its own task (FIX-1802 P2).
  if (o.legs.has("a")) {
    const conv = await conversation(alice, "desk.lead");
    const w = word();
    const filing = await act(alice, "coordinator", conv, "run", { message: `[file:desk.alpha] [slow:${HOLD_MS}] Summarize the ${w} notes` });
    const filed = await toolOutputs(alice, conv, filing.requestId);
    const taskId = filed.filter((t) => t.name === "addTask").map((t) => taskIdOf(t)).find((id) => id !== null) ?? null;
    const quietAt = await quiet();
    const filingSessionId = await filingOf(alice, conv);
    const found = taskId === null ? null : await find(alice, { worker: "desk.alpha", taskId, filingSessionId });

    // The split: desk.sub's task session files a piece for its own delegate, by its own tool and by the app.
    const w2 = word();
    const splitting = await act(alice, "coordinator", conv, "run", { message: `[file:desk.sub] [split:desk.alpha] Plan the ${w2} rollout` });
    const subFiled = await toolOutputs(alice, conv, splitting.requestId);
    const subTaskId = subFiled.filter((t) => t.name === "addTask").map((t) => taskIdOf(t)).find((id) => id !== null) ?? null;
    await quiet();
    const subSession = subTaskId === null ? null : await find(alice, { worker: "desk.sub", taskId: subTaskId, filingSessionId });
    const appSplit =
      subSession?.id == null ? null : await act(alice, "coordinator", subSession.id, "addTask_tasks", { goal: `another piece of the ${w2} rollout`, assignee: "desk.alpha" });
    await quiet();
    out.a = {
      conv,
      filingSessionId,
      word: w,
      filing,
      filed,
      taskId,
      quietAt,
      found,
      split: { word: w2, turn: splitting, filed: subFiled, taskId: subTaskId, session: subSession, app: appSplit },
    };
  }

  // c: two of Alice's conversations with one coordinator, each filing one
  // task; the first names the second's task once.
  if (o.legs.has("c")) {
    const c1 = await conversation(alice, "desk.lead");
    const c2 = await conversation(alice, "desk.lead");
    const words = { t1: word(), t2: word(), t3: word() };
    // Unassigned, with three delegates that take tasks: it waits to be assigned.
    const t2 = await act(alice, "coordinator", c2, "addTask_tasks", { goal: `[slow:${SLOW_MS}] Draft the ${words.t2} brief` });
    const t1 = await act(alice, "coordinator", c1, "addTask_tasks", { goal: `Tidy the ${words.t1} list`, assignee: "desk.alpha" });
    await quiet();
    // The first conversation names the second's task by its id.
    const reach = await act(alice, "coordinator", c1, "assignTask_tasks", { taskId: taskIdOf(t2) ?? "none", assignee: "desk.alpha" });
    await quiet();
    // The second assigns its own task, which runs for a while.
    const assign = await act(alice, "coordinator", c2, "assignTask_tasks", { taskId: taskIdOf(t2) ?? "none", assignee: "desk.beta" });
    await sleep(1_000);
    // While it runs, the first conversation files another.
    const t3 = await act(alice, "coordinator", c1, "addTask_tasks", { goal: `Check the ${words.t3} links`, assignee: "desk.alpha" });
    const quietAt = await quiet();
    // Each conversation's own read.
    const list1 = await act(alice, "coordinator", c1, "listTasks_tasks", {});
    const list2 = await act(alice, "coordinator", c2, "listTasks_tasks", {});
    const ids = { t1: taskIdOf(t1), t2: taskIdOf(t2), t3: taskIdOf(t3) };
    const filing = { c1: await filingOf(alice, c1), c2: await filingOf(alice, c2) };
    const finds: Record<string, { id: string | null; error?: string }> = {};
    for (const [label, worker, taskId] of [
      ["t1", "desk.alpha", ids.t1],
      ["t2", "desk.beta", ids.t2],
      ["t3", "desk.alpha", ids.t3],
    ] as const) {
      if (taskId === null) continue;
      finds[`${label}@c1`] = await find(alice, { worker, taskId, filingSessionId: filing.c1 });
      finds[`${label}@c2`] = await find(alice, { worker, taskId, filingSessionId: filing.c2 });
    }
    out.c = { c1, c2, filing, words, ids, filed: { t1, t2, t3 }, reach, assign, quietAt, list1, list2, finds };
  }

  // d: Bob reaches into Alice's conversation, and names her worker on his own.
  if (o.legs.has("d")) {
    const dA = await conversation(alice, "desk.lead");
    const hers = `alice-${word()}`;
    const roster =
      ((await alice.sessions.listSessions({ flowKind: ROSTER, userId: PEOPLE.alice.userId })) as Array<{ id: string }>)[0]?.id ??
      ((await alice.sessions.createSession({ flowKind: ROSTER, userId: PEOPLE.alice.userId })) as { id: string }).id;
    const hired = await act(alice, ROSTER, roster, "hire", { id: hers, flow: "agent", description: "Does Alice's errands." });
    const added = await act(alice, "coordinator", dA, "addDelegate", { worker: hers });
    const w = word();
    const herTask = await act(alice, "coordinator", dA, "addTask_tasks", { goal: `Sort the ${w} receipts`, assignee: hers });
    await quiet();
    await sleep(50);
    const bobStartedAt = Date.now();
    const opened = await bob.get(`/sessions/${encodeURIComponent(dA)}`);
    const open = { status: opened.status, body: (await opened.text()).slice(0, 300) };
    const post = await act(bob, "coordinator", dA, "run", { message: `[file:desk.alpha] Sort the ${w} receipts` });
    const file = await act(bob, "coordinator", dA, "addTask_tasks", { goal: `Sort the ${w} receipts`, assignee: "desk.alpha" });
    const dB = await conversation(bob, "desk.lead");
    const missingWorker = `nobody-${word()}`;
    const nameHers = await act(bob, "coordinator", dB, "addTask_tasks", { goal: `Sort the ${w} receipts`, assignee: hers });
    const nameMissing = await act(bob, "coordinator", dB, "addTask_tasks", { goal: `Sort the ${w} receipts`, assignee: missingWorker });
    const addHers = await act(bob, "coordinator", dB, "addDelegate", { worker: hers });
    const bw = word();
    const bobsOwn = await act(bob, "coordinator", dB, "addTask_tasks", { goal: `File the ${bw} invoices`, assignee: "desk.alpha" });
    const quietAt = await quiet();
    out.d = { dA, dB, hers, missingWorker, hired, added, herTask, bobStartedAt, open, post, file, nameHers, nameMissing, addHers, bobsOwn, word: w, bobWord: bw, quietAt };
  }

  // The grace: anything late (a second notice, a stray run) lands before the store is read again.
  await sleep(GRACE_MS);
  out.gracedAt = await quiet();
  return out;
}

function parsed(value: unknown): any {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
