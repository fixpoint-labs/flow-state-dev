/**
 * One client process of the goal: everything an app does, through one
 * `createClient`. `run.mts` starts it twice per leg, either side of a SIGKILL.
 *
 * - Phase 1 creates a session, sends the input's typed turns, reads the
 *   resource they wrote, sends an action that stops for a person, then one
 *   that holds on a latch. Once the held step has counted its run it writes
 *   what it saw to `GOAL_STATE`. Over HTTP it then exits; in-process it is the
 *   host too, so it stays up for `run.mts` to kill.
 * - Phase 2 finds the held request with `requests.interrupted()` and continues
 *   it, answers the stop through `request(savedId).resume(...)`, reads the
 *   resource and the session's requests, and streams the continued request.
 *   It prints what it saw on one `__GOAL__` line; `run.mts` grades it.
 *
 * Two instruments run in every process. Global `fetch` is replaced with a
 * recorder before anything else, and the client's fetcher calls the real one
 * it captured, so any call that reaches `fetch` went around the client's
 * fetcher. `createClient` itself is counted by a load-time patch `run.mts`
 * applies to the client package (`globalThis.__goalCreateClient`), so a second
 * client is counted however it is built.
 *
 * Env: GOAL_PHASE (1|2), GOAL_TRANSPORT (http|inproc), GOAL_ORIGIN (http),
 * GOAL_INPUT, GOAL_STATE, GOAL_USER, GOAL_COUNTER_FILE, GOAL_CONTROL; the
 * in-process host also reads GOAL_STORE, GOAL_NOTES_ID and GOAL_LATCH_FILE.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

// Before any other module can capture it.
const realFetch = globalThis.fetch.bind(globalThis);
const bypasses: string[] = [];
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  bypasses.push(input instanceof Request ? input.url : String(input));
  return realFetch(input, init);
}) as typeof fetch;

const { createClient, createSSEClientFromResponse } = await import("@flow-state-dev/client");
type ClientFetch = import("@flow-state-dev/client").ClientFetch;
type Client = import("@flow-state-dev/client").Client;
type RequestHandle = import("@flow-state-dev/client").RequestHandle;
type SupportFlow = typeof import("./fixtures/flows.mts").supportDefinition;

const env = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set`);
  return value;
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Input {
  flow: string;
  turns: string[];
  approve: { subject: string; kind: "approval" | "input" };
  answer: { action: "approve" | "submit"; data?: string };
  expectedAnswer: string;
  hold: string;
}

/** What phase 1 saw, and the ids an app would have saved. */
export interface PhaseOne {
  sessionId: string;
  replies: Array<{ id: string; status: string }>;
  transcript: string;
  approveId: string;
  approveStatus: string;
  holdId: string;
  clients: number;
  fetcherCalls: number;
  bypasses: string[];
}

/** What phase 2 saw. */
export interface PhaseTwo {
  firstRead: Array<{ id: string; actionName: string; sessionId?: string }>;
  secondRead: Array<{ id: string; actionName: string; sessionId?: string }>;
  heldId?: string;
  carriedOnAs?: string;
  carriedOnStatus?: string;
  resumedAs?: string;
  approveStatus?: string;
  transcript?: string;
  requests: Array<{ id: string; actionName: string; status: string; output?: unknown }>;
  stream: { events: number; statuses: string[]; error?: string };
  clients: number;
  fetcherCalls: number;
  bypasses: string[];
  errors: string[];
}

const phase = env("GOAL_PHASE");
const transport = env("GOAL_TRANSPORT");
const control = process.env.GOAL_CONTROL ?? "";
const userId = env("GOAL_USER");
const input = JSON.parse(readFileSync(env("GOAL_INPUT"), "utf8")) as Input;
const statePath = env("GOAL_STATE");

let fetcherCalls = 0;
const counted =
  (inner: ClientFetch): ClientFetch =>
  (request, init) => {
    fetcherCalls += 1;
    return inner(request, init);
  };

/** The options this process's client is built from: a URL over HTTP, or the in-process host. */
async function clientOptions(): Promise<{ options: Parameters<typeof createClient>[0]; origin: string }> {
  if (transport === "http") {
    const origin = env("GOAL_ORIGIN");
    return { options: { baseUrl: origin, userId, fetcher: counted((request, init) => realFetch(request, init)) }, origin };
  }
  const { createInProcessFetch } = await import("@flow-state-dev/engine");
  const { goalHost } = await import("./fixtures/host.mts");
  const host = goalHost();
  await host.ready();
  return { options: { userId, fetcher: counted(createInProcessFetch(host)) }, origin: "http://in-process.invalid" };
}

const clients = () => (globalThis as { __goalCreateClient?: number }).__goalCreateClient ?? 0;

async function phaseOne(fsd: Client): Promise<void> {
  const flow = fsd.flow<SupportFlow>(input.flow);
  const session = await flow.createSession();
  const replies: PhaseOne["replies"] = [];
  for (const text of input.turns) {
    const sent = await flow.send("reply", { text }, { sessionId: session.id });
    replies.push({ id: sent.id, status: (await sent.wait({ pollMs: 50, timeoutMs: 20_000 })).status });
  }
  const transcript = (await fsd.resources.getResourceContent(session.id, "transcript")).content;
  const approve = await flow.send("approve", input.approve, { sessionId: session.id });
  const approveStatus = (await approve.wait({ pollMs: 50, timeoutMs: 20_000 })).status;
  const hold = await flow.send("hold", { label: input.hold }, { sessionId: session.id });
  // Wait for the held step to have run, so the kill lands while it waits on the latch.
  const counter = env("GOAL_COUNTER_FILE");
  for (let i = 0; i < 400; i += 1) {
    if (existsSync(counter) && readFileSync(counter, "utf8").includes(`before:${input.hold}\n`)) break;
    await sleep(50);
  }
  const seen: PhaseOne = {
    sessionId: session.id,
    replies,
    transcript,
    approveId: approve.id,
    approveStatus,
    holdId: hold.id,
    clients: clients(),
    fetcherCalls,
    bypasses,
  };
  writeFileSync(`${statePath}.tmp`, JSON.stringify(seen));
  renameSync(`${statePath}.tmp`, statePath);
}

/** Read `id`'s stream until it reports an end, through the client or, under `stream-off-fetcher`, around it. */
async function readStream(fsd: Client, origin: string, flow: string, id: string): Promise<PhaseTwo["stream"]> {
  const seen: PhaseTwo["stream"] = { events: 0, statuses: [] };
  let done!: () => void;
  const ended = new Promise<void>((resolve) => (done = resolve));
  const callbacks = {
    onEvent: () => {
      seen.events += 1;
    },
    onRequestStatus: (event: { status: string }) => {
      seen.statuses.push(event.status);
      if (["completed", "failed", "aborted", "incomplete"].includes(event.status)) done();
    },
    onError: (error: Error) => {
      seen.error = error.message;
      done();
    },
  };
  let handle: { close(): void } | undefined;
  try {
    if (control === "stream-off-fetcher") {
      const url = `${origin}/api/flows/${encodeURIComponent(flow)}/requests/${encodeURIComponent(id)}/stream?userId=${encodeURIComponent(userId)}`;
      handle = createSSEClientFromResponse({ response: await fetch(url), ...callbacks });
    } else {
      handle = fsd.flow(flow).request(id).stream(callbacks);
    }
    await Promise.race([ended, sleep(10_000)]);
  } catch (error) {
    seen.error = (error as Error).message;
  } finally {
    handle?.close();
  }
  return seen;
}

async function phaseTwo(fsd: Client, origin: string, options: Parameters<typeof createClient>[0]): Promise<PhaseTwo> {
  const one = JSON.parse(readFileSync(statePath, "utf8")) as PhaseOne;
  const errors: string[] = [];
  const brief = (list: Awaited<ReturnType<Client["requests"]["interrupted"]>>) =>
    list.map((r) => ({ id: r.id, actionName: r.actionName, ...(r.sessionId === undefined ? {} : { sessionId: r.sessionId }) }));
  const isHeld = (r: { actionName: string; sessionId?: string }) => r.actionName === "hold" && r.sessionId === one.sessionId;

  // a. The held request, from the user's interrupted requests: no saved id.
  let firstRead = await fsd.requests.interrupted();
  for (let i = 0; i < 80 && !firstRead.some(isHeld); i += 1) {
    await sleep(250);
    firstRead = await fsd.requests.interrupted();
  }
  // The control builds a second client for recovery; the job needs none.
  const recovery = control === "two-clients" ? createClient(options) : fsd;
  const secondRead = await recovery.requests.interrupted();
  const held = secondRead.find(isHeld);
  const out: PhaseTwo = {
    firstRead: brief(firstRead),
    secondRead: brief(secondRead),
    requests: [],
    stream: { events: 0, statuses: [] },
    clients: 0,
    fetcherCalls: 0,
    bypasses,
    errors,
  };
  let carriedOn: RequestHandle | undefined;
  if (held !== undefined) {
    out.heldId = held.id;
    try {
      const next: RequestHandle = control === "retry-instead" ? await held.retry() : await held.continue();
      carriedOn = next;
      out.carriedOnAs = next.id;
      out.carriedOnStatus = (await next.wait({ pollMs: 100, timeoutMs: 30_000 })).status;
    } catch (error) {
      errors.push(`carry on: ${(error as Error).message}`);
    }
  }

  // b. The stop, answered through the id phase 1 saved.
  try {
    const listed = await fsd.sessions.requests(one.sessionId, { includeItems: true, limit: 100 });
    const stop = (listed.find((r) => r.id === one.approveId)?.items ?? []).filter(
      (item): item is typeof item & { suspensionId: string } => item.type === "suspension",
    ).at(-1);
    if (stop === undefined) throw new Error(`no suspension item on request ${one.approveId}`);
    const resumed = await fsd.flow(input.flow).request(one.approveId).resume({ suspensionId: stop.suspensionId, ...input.answer });
    out.resumedAs = resumed.id;
    out.approveStatus = (await resumed.wait({ pollMs: 100, timeoutMs: 30_000 })).status;
  } catch (error) {
    errors.push(`resume: ${(error as Error).message}`);
  }

  out.transcript = (await fsd.resources.getResourceContent(one.sessionId, "transcript")).content;
  out.requests = (await fsd.sessions.requests(one.sessionId, { includeResultOutput: true, limit: 100 })).map((r) => ({
    id: r.id,
    actionName: r.actionName,
    status: r.status,
    ...(r.result?.output === undefined ? {} : { output: r.result.output }),
  }));
  if (carriedOn !== undefined) out.stream = await readStream(fsd, origin, input.flow, carriedOn.id);
  out.clients = clients();
  out.fetcherCalls = fetcherCalls;
  return out;
}

const { options, origin } = await clientOptions();
const fsd = createClient(options);
if (phase === "1") {
  await phaseOne(fsd);
  // In-process this process is the host: it stays up, holding the request, until it is killed.
  if (transport === "inproc") await new Promise(() => {});
  process.exit(0);
} else {
  const line = `__GOAL__${JSON.stringify(await phaseTwo(fsd, origin, options))}\n`;
  // Exit once the line is flushed: `process.exit` drops a write still queued on a pipe.
  process.stdout.write(line, () => process.exit(0));
}
