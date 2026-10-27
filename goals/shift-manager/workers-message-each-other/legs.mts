/** The legs. Assertions are tagged `<leg>:<name>`. See goal.md. */
import type { Client, CreateClientOptions } from "@flow-state-dev/client";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { labRoutes, type LabRoutes, type StoredItem } from "../../lib/shift-manager.mts";

/** One person the run acts as. */
export interface Person {
  label: string;
  userId: string;
  bearer: string;
}

type SessionSummary = { id: string; flowKind: string };

/** The shipped clients, as the checkout under test exports them. */
export interface Shipped {
  client: {
    createClient(options: CreateClientOptions): Client;
  };
  workforce: {
    createWorkforceClient(client: Client): {
      roster(): Promise<Array<{ id: string; flow: string; standard: boolean }>>;
      ensureWorkerSession(criteria: { worker: string }): Promise<SessionSummary>;
    };
    deriveWorkerSessionId?(input: { userId: string; orgId: string; flow: string; criteria: { worker: string } }): Promise<string>;
  };
}

/** Load the shipped clients from the checkout at `root`. */
export async function loadShipped(root: string): Promise<Shipped> {
  const client = (await import(pathToFileURL(join(root, "packages", "client", "src", "index.ts")).href)) as Shipped["client"];
  const workforce = (await import(pathToFileURL(join(root, "packages", "workforce", "src", "browser.ts")).href)) as Shipped["workforce"];
  return { client, workforce };
}

/** A person connected to the served install. */
export interface Connected {
  person: Person;
  workforce: ReturnType<Shipped["workforce"]["createWorkforceClient"]>;
  sessions: Client["sessions"];
  flow(flowKind: string): ReturnType<Client["flow"]>;
  routes: LabRoutes;
}

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
    sessions: client.sessions,
    flow: (flowKind) => client.flow(flowKind),
    routes: labRoutes(origin, { userId: person.userId, bearer: person.bearer }),
  };
}

const RUNNING = new Set(["pending", "queued", "in_progress", "running"]);
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const hex = () => randomBytes(3).toString("hex");
const WORDS = ["heron", "copper", "lantern", "marble", "saffron", "willow", "ember", "glacier", "orchid", "tinsel"];
/** A held-out word, fresh per run. */
export const word = () => `${WORDS[randomBytes(1)[0]! % WORDS.length]}${hex()}`;
const show = (value: unknown) => JSON.stringify(value)?.slice(0, 500);

/** The tool and its log, by the names Workforce gives them. */
export const MESSAGE_TOOL = "sendMessage";
const LOG_PATTERN = "workforce/messages/*";
const ROSTER_FLOW = "workforce-roster";
export const COS = "chief-of-staff";
export const RESEARCHER = "researcher";
export const HELPER_A = "helper-a";
export const HELPER_B = "helper-b";
export const HERALD = "herald";
/** A coordinator Alice hires that hands every line on in turn (`routing: round-robin`). */
export const RR_LEAD = "rr-lead";
/** The client item a received message lands as. */
const RECEIVED = "workforce:received";
/** The DevTeam coordinators' model (the Shift Coordinator's file), for the round-robin hire. */
const COORDINATOR_MODEL = "anthropic/claude-haiku-5-5";
/** The model a hire names: DevTeam's agent workers' own (Researcher's file), since the install sets no default. */
export const HIRE_MODEL = "openai/gpt-5.4-mini";

/** One action's end, read back from the store. */
export interface Acted {
  status: string;
  requestId: string | null;
  output: any;
  error: string | undefined;
}

export async function act(who: Connected, flowKind: string, sessionId: string, action: string, input: unknown, timeoutMs = 240_000): Promise<Acted> {
  const client = who.flow(flowKind);
  let requestId: string;
  try {
    requestId = (await client.send(action, input, { sessionId })).id;
  } catch (error) {
    const status = (error as { status?: unknown }).status;
    return { status: `http ${typeof status === "number" ? status : "?"}`, requestId: null, output: undefined, error: messageOf(error) };
  }
  let status = "timed-out";
  for (const until = Date.now() + timeoutMs; Date.now() < until; await sleep(500)) {
    const now = (await client.request(requestId).status().catch(() => undefined))?.status;
    if (now !== undefined && !RUNNING.has(now)) {
      status = now;
      break;
    }
  }
  const found = (await who.routes.requests(sessionId).catch((): Array<Record<string, any>> => [])).find((r) => r.id === requestId);
  return { status, requestId, output: found?.result?.output, error: found?.result?.error?.message };
}

export function textOf(item: StoredItem | undefined): string {
  if (item === undefined) return "";
  const c = item.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => String((p as { text?: unknown }).text ?? "")).join("\n");
  return JSON.stringify(c ?? "");
}

function parsed(value: unknown): any {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** One message call a turn made: who to, its arguments, and what the tool answered. */
export interface Call {
  sessionId: string;
  requestId: string | undefined;
  args: Record<string, unknown>;
  output: any;
}

/** The message calls in one session, in stored order. */
export async function callsIn(who: Connected, sessionId: string): Promise<Call[]> {
  return (await who.routes.items(sessionId, "tool_output"))
    .filter((i) => i.toolCall?.name === MESSAGE_TOOL)
    .map((i) => ({ sessionId, requestId: i.requestId, args: (parsed(i.toolCall?.arguments ?? "{}") ?? {}) as Record<string, unknown>, output: parsed(i.output ?? (i.error === undefined ? null : { error: i.error.message })) }));
}

/** A line in a conversation: its text, whose name it is under, and the request that wrote it. */
export interface Line {
  id: string;
  role: string;
  agentName: string | null;
  text: string;
  requestId: string | undefined;
}

/** Every message line in one session, in stored order. */
export async function linesIn(who: Connected, sessionId: string): Promise<Line[]> {
  return (await who.routes.items(sessionId, "message")).map((i) => ({
    id: i.id,
    role: String(i.role ?? ""),
    agentName: typeof (i as { agentName?: unknown }).agentName === "string" ? String((i as { agentName?: unknown }).agentName) : null,
    text: textOf(i),
    requestId: i.requestId,
  }));
}

/** A received message's item, as an app draws it: the message's id, sender, text, the message it answers and the budget left. */
export interface Received {
  itemId: string;
  requestId: string | undefined;
  id: string;
  from: string;
  text: string;
  inReplyTo?: string;
  budget?: number;
}

/** Every received-message item in one session, in stored order. */
export async function receivedIn(who: Connected, sessionId: string): Promise<Received[]> {
  return (await who.routes.items(sessionId, "component"))
    .filter((i) => (i as { component?: unknown }).component === RECEIVED)
    .map((i) => {
      const data = (i.data ?? {}) as Record<string, unknown>;
      return {
        itemId: i.id,
        requestId: i.requestId,
        id: String(data.id ?? ""),
        from: String(data.from ?? ""),
        text: String(data.text ?? ""),
        ...(typeof data.inReplyTo === "string" ? { inReplyTo: data.inReplyTo } : {}),
        ...(typeof data.budget === "number" ? { budget: data.budget } : {}),
      };
    });
}

/** Whether a turn ran in the request a received item landed in: an assistant line or a tool call there. */
async function turnRanFor(who: Connected, sessionId: string, item: Received): Promise<boolean> {
  if (item.requestId === undefined) return false;
  const lines = await linesIn(who, sessionId);
  if (lines.some((l) => l.requestId === item.requestId && l.role === "assistant")) return true;
  return (await who.routes.items(sessionId, "tool_output")).some((i) => i.requestId === item.requestId);
}

/** One person's line to a worker, and the turn it ran, read back by its request id. */
export interface Turn {
  leg: string;
  worker: string;
  words: string;
  sessionId: string;
  requestId: string | null;
  status: string;
  reply: string;
  calls: Call[];
}

const providerError = (text: string) => /rate.?limit|429|5\d\d |overloaded|timed? ?out|ECONNRESET|fetch failed|provider|gateway|unavailable|stream failed/i.test(text);

/** Say `words` to `worker` in its conversation `session`. A provider error re-runs it once. */
export async function talk(turns: Turn[], leg: string, who: Connected, worker: string, session: SessionSummary, words: string): Promise<Turn> {
  const once = async (): Promise<Turn> => {
    const acted = await act(who, session.flowKind, session.id, "respond", { message: words });
    const turn: Turn = { leg, worker, words, sessionId: session.id, requestId: acted.requestId, status: acted.status, reply: "", calls: [] };
    if (acted.requestId === null) {
      turn.reply = `refused: ${acted.error ?? ""}`;
      return turn;
    }
    const mine = (await linesIn(who, session.id)).filter((l) => l.requestId === acted.requestId && l.role === "assistant");
    turn.reply = mine.at(-1)?.text ?? acted.error ?? `no reply (${acted.status})`;
    turn.calls = (await callsIn(who, session.id)).filter((c) => c.requestId === acted.requestId);
    return turn;
  };
  let turn = await once();
  if (turn.status !== "completed" && providerError(turn.reply)) turn = await once();
  turns.push(turn);
  return turn;
}

/** Poll `probe` until it returns a value, or `undefined` after `timeoutMs`. */
export async function until<T>(probe: () => Promise<T | undefined>, timeoutMs: number, everyMs = 2_000): Promise<T | undefined> {
  for (const end = Date.now() + timeoutMs; Date.now() < end; await sleep(everyMs)) {
    const got = await probe().catch(() => undefined);
    if (got !== undefined) return got;
  }
  return undefined;
}

/**
 * Wait until no request runs in any of the person's sessions, twice in a row
 * `everyMs` apart, or `timeoutMs`. The engine's request read, only to wait.
 */
export async function quiet(who: Connected, timeoutMs = 300_000, everyMs = 4_000): Promise<boolean> {
  let calm = 0;
  for (const end = Date.now() + timeoutMs; Date.now() < end; await sleep(everyMs)) {
    const sessions = await who.routes.sessions().catch(() => []);
    let running = false;
    for (const s of sessions) {
      const requests = await who.routes.requests(s.id).catch((): Array<Record<string, any>> => []);
      if (requests.some((r) => RUNNING.has(String(r.status)))) {
        running = true;
        break;
      }
    }
    calm = running ? 0 : calm + 1;
    if (calm >= 2) return true;
  }
  return false;
}

/** A message row, as the user's log holds it. */
export type Row = {
  id: string;
  from: string;
  to: string;
  text: string;
  inReplyTo?: string;
  fromSession: string;
  toSession: string;
  hop: number;
  chain?: string;
  status: string;
};

/** The person's roster session: their own session on the roster flow, which declares the log. */
export async function rosterSessionOf(who: Connected): Promise<string> {
  const found = (await who.routes.sessions()).find((s) => (s.flowKind ?? s.flowId) === ROSTER_FLOW && s.parentSessionId == null);
  if (found !== undefined) return found.id;
  return (await who.flow(ROSTER_FLOW).createSession()).id;
}

/** The person's message log, read through their roster session. */
export async function logOf(who: Connected): Promise<Row[]> {
  const roster = await rosterSessionOf(who);
  return (await who.routes.collection(roster, LOG_PATTERN)) as Row[];
}

/** The rows on a conversation's own board, as Shift Manager's task read returns them. */
export async function boardOf(who: Connected, flowKind: string, sessionId: string): Promise<Array<Record<string, unknown>>> {
  const read = await who.routes.act(flowKind, sessionId, "listTasks_tasks", {});
  if (read.error !== undefined) {
    // A conversation whose worker has no delegates keeps no board.
    if (/no_delegation_board/.test(read.error)) return [];
    throw new Error(`the task read of ${sessionId} failed: ${read.error}`);
  }
  return ((read.output as { tasks?: Array<Record<string, unknown>> } | undefined)?.tasks ?? []) as Array<Record<string, unknown>>;
}

/** One leg's result. */
export interface LegResult {
  failures: string[];
  notes: string[];
}

/** What every leg shares: the people, their conversations, and the run's held-out words. */
export interface World {
  shipped: Shipped;
  alice: Connected;
  bob: Connected;
  turns: Turn[];
  say: (line: string) => void;
  /** The person's own conversation with each worker, at its derived address; `cos2` is a second one with the Shift Coordinator. */
  conversation: Record<string, SessionSummary>;
  words: { codename: string; codename2: string; colourA: string; w3b: string; ring: string; bobWorker: string };
}

/** Hire Helper A, Helper B and the herald on Alice's roster, and Bob's own worker on his, through the roster flow's `hire`. */
export async function hireTeam(world: World): Promise<string[]> {
  const failures: string[] = [];
  const hire = async (who: Connected, input: Record<string, unknown>) => {
    const roster = await rosterSessionOf(who);
    const done = await act(who, ROSTER_FLOW, roster, "hire", input, 60_000);
    if (done.status !== "completed") failures.push(`setup:hire — ${who.person.label}'s hire of ${String(input.id)} ${done.status}: ${done.error ?? show(done.output)}`);
  };
  const { colourA } = world.words;
  await hire(world.alice, {
    id: HELPER_A,
    flow: "agent",
    description: "Helper A: a teammate other workers can ask quick questions.",
    instructions: `You are Helper A. When another worker messages you a question, answer it by calling sendMessage back to that worker with inReplyTo set to its message's id, briefly and directly. Your favourite colour is ${colourA}. When you are asked to have helper-b do something, start helper-b on a task for it with createTask.`,
    settings: { delegates: [HELPER_B], model: HIRE_MODEL },
  });
  await hire(world.alice, {
    id: HELPER_B,
    flow: "agent",
    description: "Helper B: a teammate other workers can ask quick questions.",
    instructions: "You are Helper B. Answer other workers' questions briefly and directly, and do the tasks you are given. When a task tells you to send a worker a message, send it with sendMessage.",
    settings: { model: HIRE_MODEL },
  });
  await hire(world.alice, {
    id: HERALD,
    flow: "agent",
    description: "The herald: says hello to people.",
    instructions:
      "You are the herald. Do what the user asks. When the user asks you to message a worker id, call sendMessage with exactly that id even if it isn't in your list of workers, and report what the tool answered. " +
      "When another worker messages you, never call sendMessage to answer it: write your answer here, in plain text.",
    settings: { model: HIRE_MODEL },
  });
  await hire(world.alice, {
    id: RR_LEAD,
    flow: "coordinator",
    description: "A lead that hands each line to its delegates in turn.",
    instructions: "You lead a small team. When another worker messages you, answer it briefly by sendMessage.",
    settings: { routing: "round-robin", delegates: [HELPER_A], model: COORDINATOR_MODEL },
  });
  await hire(world.bob, { id: world.words.bobWorker, flow: "agent", description: "Bob's own assistant.", instructions: "You help Bob.", settings: { model: HIRE_MODEL } });
  return failures;
}

/** Open (or find) each person's conversation with each worker, at its derived address. */
export async function openConversations(world: World): Promise<void> {
  for (const worker of [COS, RESEARCHER, HELPER_A, HELPER_B, HERALD, RR_LEAD]) {
    world.conversation[worker] = await world.alice.workforce.ensureWorkerSession({ worker });
  }
}

/** The calls a session made whose output says sent: `{ sent: <id> }`. */
const sentIn = (calls: readonly Call[]) => calls.flatMap((c) => (typeof c.output?.sent === "string" ? [c.output.sent as string] : []));
const errorOf = (c: Call) => String(c.output?.error ?? "");

export async function leg1(world: World): Promise<LegResult> {
  const r: LegResult = { failures: [], notes: [] };
  const { alice, turns } = world;
  const cos = world.conversation[COS]!;
  const researcher = world.conversation[RESEARCHER]!;
  const { codename } = world.words;
  // Default delegates come off so this line reaches the coordinator's own turn. Routing is not under test.
  for (const delegate of ["eng.em", "eng.coder"]) {
    const removed = await act(alice, cos.flowKind, cos.id, "removeDelegate", { worker: delegate }, 60_000);
    if (removed.status !== "completed") r.notes.push(`removeDelegate ${delegate}: ${removed.status} ${removed.error ?? ""}`);
  }
  const told = await talk(turns, "1", alice, COS, cos, `The team's codename is ${codename}. Any worker on the team may ask you for it, and you should tell them. Reply only with "Noted."`);
  if (told.status !== "completed") r.failures.push(`1:setup — the Shift Coordinator's turn on the codename ${told.status}: ${told.reply.slice(0, 300)}`);

  const asked = await talk(turns, "1", alice, RESEARCHER, researcher, `Ask the Shift Coordinator (worker id ${COS}) what the codename is, and tell me.`);
  const sent = asked.calls.filter((c) => c.args.to === COS && typeof c.output?.sent === "string");
  if (sent.length === 0) {
    r.failures.push(`1:sent — Researcher's turn sent the Shift Coordinator no message: its calls ${show(asked.calls.map((c) => ({ args: c.args, output: c.output })))}; reply: ${asked.reply.slice(0, 200)}`);
  }
  // The answer is a message the coordinator sent: its own item in Researcher's conversation, then a Researcher line holding it.
  const answered = await until(async () => {
    const heard = (await receivedIn(alice, researcher.id)).find((m) => m.from === COS && m.text.includes(codename));
    if (heard === undefined) return undefined;
    // A line the message's own turn wrote, or a later one: never the asking turn's.
    const after = (await linesIn(alice, researcher.id)).find((l) => l.role === "assistant" && l.requestId !== asked.requestId && l.text.includes(codename));
    return after === undefined ? undefined : { heard, after };
  }, 240_000);
  if (answered === undefined) {
    const lines = await linesIn(alice, researcher.id);
    r.failures.push(
      `1:answer-holds-codename — within 240 s no Researcher answer to the person, after the coordinator's message, holds ${codename}; Researcher's received items: ${show(await receivedIn(alice, researcher.id))}; lines: ${show(lines.map((l) => `${l.role}: ${l.text.slice(0, 80)}`))}`,
    );
  } else {
    r.notes.push(`Researcher heard "${answered.heard.text.slice(0, 120)}" and told the person "${answered.after.text.slice(0, 120)}"`);
  }
  // The message is its own item in the coordinator's conversation, naming its sender and id, and its turn ran.
  const sentId = sent[0]?.output?.sent as string | undefined;
  const inCos = (await receivedIn(alice, cos.id)).filter((m) => m.from === RESEARCHER);
  if (inCos.length !== 1 || (sentId !== undefined && inCos[0]!.id !== sentId) || inCos[0]!.inReplyTo !== undefined) {
    r.failures.push(`1:own-item — the coordinator's conversation holds ${inCos.length} received item(s) from Researcher, not one with id ${sentId} and no inReplyTo: ${show(inCos)}`);
  } else if (!(await turnRanFor(alice, cos.id, inCos[0]!))) {
    r.failures.push(`1:own-item — the coordinator's turn didn't run for Researcher's message (request ${inCos[0]!.requestId})`);
  }
  const cosAnswers = (await callsIn(alice, cos.id)).filter((c) => c.args.to === RESEARCHER && typeof c.output?.sent === "string");
  if (cosAnswers.length === 0) r.failures.push(`1:coordinator-answered — the coordinator's conversation holds no message it sent Researcher`);
  await quiet(alice, 180_000);

  // No relay: the herald answers a message in plain text, and that text reaches no one.
  const herald = world.conversation[HERALD]!;
  const toHerald = await talk(turns, "1", alice, RESEARCHER, researcher, `Send the herald (worker id ${HERALD}) exactly this message: "What is two plus two?" Then tell me you sent it.`);
  if (!toHerald.calls.some((c) => c.args.to === HERALD && typeof c.output?.sent === "string")) {
    r.failures.push(`1:no-relay — Researcher's turn sent the herald no message, so there's nothing to relay: ${toHerald.reply.slice(0, 200)}`);
    return r;
  }
  const heardByHerald = await until(async () => {
    const item = (await receivedIn(alice, herald.id)).find((m) => m.from === RESEARCHER);
    return item !== undefined && (await turnRanFor(alice, herald.id, item)) ? item : undefined;
  }, 180_000);
  if (heardByHerald === undefined) r.failures.push(`1:no-relay — the herald's turn never ran for Researcher's message within 180 s`);
  await quiet(alice, 180_000);
  const relayed: string[] = [];
  for (const session of await alice.routes.sessions()) {
    for (const m of await receivedIn(alice, session.id).catch(() => [])) if (m.from === HERALD) relayed.push(`${session.id}: ${m.text.slice(0, 80)}`);
  }
  if (relayed.length > 0) r.failures.push(`1:no-relay — a received item from the herald reached a session though it answered in plain text: ${show(relayed)}`);
  const heraldReply = (await linesIn(alice, herald.id)).filter((l) => l.role === "assistant" && l.requestId === heardByHerald?.requestId).at(-1);
  r.notes.push(`the herald's plain answer: ${heraldReply?.text.slice(0, 120) ?? "none"}`);
  return r;
}

export async function leg1b(world: World): Promise<LegResult> {
  const r: LegResult = { failures: [], notes: [] };
  const { alice, turns } = world;
  const cos = world.conversation[COS]!;
  const researcher = world.conversation[RESEARCHER]!;
  const { codename2 } = world.words;
  const told = await talk(turns, "1b", alice, COS, cos, `Tell Researcher (worker id ${RESEARCHER}) that the new codename is ${codename2}. Send it as a message.`);
  if (!told.calls.some((c) => c.args.to === RESEARCHER && typeof c.output?.sent === "string")) {
    r.failures.push(`1b:sent — the coordinator's turn sent Researcher no message: ${show(told.calls.map((c) => ({ args: c.args, output: c.output })))}; reply: ${told.reply.slice(0, 200)}`);
  }
  const heard = await until(async () => (await receivedIn(alice, researcher.id)).find((m) => m.from === COS && m.text.includes(codename2)), 180_000);
  if (heard === undefined) r.failures.push(`1b:researcher-shows-message — Researcher's conversation shows no received item from the coordinator holding ${codename2} within 180 s`);
  await quiet(alice, 180_000);
  const next = await talk(turns, "1b", alice, RESEARCHER, researcher, "What is the new codename? Answer with just the codename.");
  if (!next.reply.includes(codename2)) r.failures.push(`1b:next-answer-holds-it — Researcher's next answer to the person doesn't hold ${codename2}: ${next.reply.slice(0, 200)}`);

  // An answer lands in the session that asked: a second conversation with the coordinator, not its default one.
  const second = await alice.flow(cos.flowKind).createSession({ state: { workerId: COS } });
  const cos2: SessionSummary = { id: second.id, flowKind: cos.flowKind };
  world.conversation.cos2 = cos2;
  for (const delegate of ["eng.em", "eng.coder"]) {
    const removed = await act(alice, cos2.flowKind, cos2.id, "removeDelegate", { worker: delegate }, 60_000);
    if (removed.status !== "completed") r.notes.push(`cos2 removeDelegate ${delegate}: ${removed.status} ${removed.error ?? ""}`);
  }
  const asked = await talk(turns, "1b", alice, COS, cos2, `Send ${HELPER_A} (worker id ${HELPER_A}) a message asking what its favourite colour is. Don't do anything else.`);
  const question = asked.calls.find((c) => c.args.to === HELPER_A && typeof c.output?.sent === "string")?.output?.sent as string | undefined;
  if (question === undefined) {
    r.failures.push(`1b:in-reply-to — the coordinator's turn in its second conversation sent Helper A no message: ${show(asked.calls.map((c) => c.output))} ${asked.reply.slice(0, 160)}`);
    return r;
  }
  const answer = await until(async () => (await logOf(alice)).find((m) => m.from === HELPER_A && m.inReplyTo === question), 240_000);
  const landed = await until(async () => (await receivedIn(alice, cos2.id)).find((m) => m.from === HELPER_A && m.inReplyTo === question), answer === undefined ? 1_000 : 120_000);
  if (answer === undefined || answer.toSession !== cos2.id || landed === undefined) {
    r.failures.push(
      `1b:in-reply-to — Helper A's answer to ${question} ${answer === undefined ? "never came" : `went to ${answer.toSession}`}; the asking conversation is ${cos2.id} (the default is ${cos.id}); an item there naming ${question}: ${landed === undefined ? "none" : "yes"}`,
    );
  } else {
    r.notes.push(`Helper A's answer ${answer.id} landed in the second conversation ${cos2.id}, naming ${question}`);
  }
  await quiet(alice, 180_000);
  return r;
}

export async function leg2(world: World): Promise<LegResult> {
  const r: LegResult = { failures: [], notes: [] };
  const { alice, turns } = world;
  // Filed from the coordinator's second conversation (leg 1b opens it), so "the filing session" isn't its default one.
  const cos2 = world.conversation.cos2 ?? world.conversation[COS]!;
  const cosDefault = world.conversation[COS]!;
  const researcher = world.conversation[RESEARCHER]!;
  const { colourA } = world.words;
  if (world.conversation.cos2 === undefined) r.notes.push("leg 1b didn't run: filing from the coordinator's default conversation, so 2:to-filer can't tell the two apart");
  const added = await act(alice, cos2.flowKind, cos2.id, "addDelegate", { worker: RESEARCHER }, 60_000);
  if (added.status !== "completed") r.failures.push(`2:setup — adding Researcher as a delegate ${added.status}: ${added.error ?? ""}`);
  const logBefore = new Set((await logOf(alice)).map((m) => m.id));
  const filed = await talk(
    turns,
    "2",
    alice,
    COS,
    cos2,
    `File a task for ${RESEARCHER} with your task tool (not a post, and don't do it yourself). The task: "Ask ${HELPER_A} (a worker) for its favourite colour, by sending it a message. Then send ${COS} a message saying you asked. Then you're done."`,
  );
  const rows = await until(async () => {
    const board = await boardOf(alice, cos2.flowKind, cos2.id);
    return board.some((row) => row.assignee === RESEARCHER) ? board : undefined;
  }, 120_000);
  if (rows === undefined) {
    r.failures.push(`2:filed — the coordinator's board holds no task for Researcher within 120 s; its turn: ${show(filed.calls)} ${filed.reply.slice(0, 200)}`);
    return r;
  }
  const ask = await until(async () => (await logOf(alice)).find((m) => !logBefore.has(m.id) && m.from === RESEARCHER && m.to === HELPER_A), 240_000);
  if (ask === undefined) {
    r.failures.push(`2:reached-helper — no message from Researcher to Helper A in the log within 240 s`);
    return r;
  }
  if (ask.fromSession === researcher.id) r.failures.push(`2:from-task — the message to Helper A was sent from Researcher's own conversation, not the task's session`);
  // To its filer: the task's message to the coordinator lands in the conversation that filed it.
  const toFiler = await until(async () => (await logOf(alice)).find((m) => !logBefore.has(m.id) && m.from === RESEARCHER && m.to === COS && m.fromSession === ask.fromSession), 240_000);
  if (toFiler === undefined) {
    r.failures.push(`2:to-filer — the task sent the coordinator no message within 240 s`);
  } else if (toFiler.toSession !== cos2.id) {
    r.failures.push(`2:to-filer — the task's message to its filer went to ${toFiler.toSession}, not the filing conversation ${cos2.id} (the coordinator's default is ${cosDefault.id})`);
  }
  const answer = await until(async () => (await logOf(alice)).find((m) => m.from === HELPER_A && m.to === RESEARCHER && m.inReplyTo === ask.id), 240_000);
  if (answer === undefined) {
    r.failures.push(`2:answered — Helper A sent no answer to ${ask.id} within 240 s`);
    return r;
  }
  r.notes.push(`Researcher's task asked Helper A from ${ask.fromSession}; Helper A's answer ${answer.id} went to ${answer.toSession} (status ${answer.status}, hop ${answer.hop})`);
  // The answer lands in the task's session, after the task ended, and a turn runs there.
  const landed = await until(async () => {
    const item = (await receivedIn(alice, ask.fromSession)).find((m) => m.from === HELPER_A && m.inReplyTo === ask.id);
    return item !== undefined && (await turnRanFor(alice, ask.fromSession, item)) ? item : undefined;
  }, 180_000);
  if (answer.toSession !== ask.fromSession || landed === undefined) {
    r.failures.push(
      `2:lands-in-task-session — Helper A's answer went to ${answer.toSession}, and the task's session is ${ask.fromSession}; ` +
        `an item there naming ${ask.id} with a turn after it: ${landed === undefined ? "none" : "yes"}`,
    );
  } else if (!landed.text.toLowerCase().includes(colourA.toLowerCase())) {
    r.notes.push(`Helper A's answer doesn't hold ${colourA}: ${landed.text.slice(0, 120)}`);
  }
  const inOwn = (await receivedIn(alice, researcher.id)).filter((m) => m.inReplyTo === ask.id);
  if (inOwn.length > 0) r.failures.push(`2:lands-in-task-session — Helper A's answer also landed in Researcher's own conversation`);
  const helperBoard = await boardOf(alice, "agent", world.conversation[HELPER_A]!.id).catch(() => []);
  if (helperBoard.length > 0) r.failures.push(`2:no-row — Helper A's board holds ${helperBoard.length} row(s) after it was messaged: ${show(helperBoard.map((x) => x.goal))}`);
  const removed = await act(alice, cos2.flowKind, cos2.id, "removeDelegate", { worker: RESEARCHER }, 60_000);
  if (removed.status !== "completed") r.notes.push(`removeDelegate researcher: ${removed.status}`);
  return r;
}

export async function leg2b(world: World): Promise<LegResult> {
  const r: LegResult = { failures: [], notes: [] };
  const { alice, turns } = world;
  const researcher = world.conversation[RESEARCHER]!;
  const turn = await talk(
    turns,
    "2b",
    alice,
    RESEARCHER,
    researcher,
    `Send ${HELPER_A} a message with sendMessage (not a task) asking what its favourite number is, and wait for its answer before you reply to me. Use sendMessage's wait option if it has one.`,
  );
  if (turn.status !== "completed") r.failures.push(`2b:turn-ends — the turn ${turn.status}: ${turn.reply.slice(0, 200)}`);
  // Not waiting only counts if a message went out: a turn with no message tool never waits either.
  // A task it files and waits on is a different tool's wait, so the leg names sendMessage.
  if (sentIn(turn.calls).length === 0) r.failures.push(`2b:sent — Researcher's turn sent Helper A no message: ${turn.reply.slice(0, 200)}`);
  const waited = turn.calls.filter((c) => Object.hasOwn(c.args, "wait") && typeof c.output?.sent === "string");
  if (waited.length > 0) r.failures.push(`2b:no-wait — a sendMessage call naming \`wait\` was taken: ${show(waited.map((c) => c.args))}`);
  const inside = (await linesIn(alice, researcher.id)).filter((l) => l.requestId === turn.requestId && l.agentName === HELPER_A);
  if (inside.length > 0) r.failures.push(`2b:no-wait — Helper A's answer landed inside the asking turn`);
  r.notes.push(`calls: ${show(turn.calls.map((c) => ({ args: c.args, output: c.output })))}`);
  await quiet(alice, 180_000);
  return r;
}

export async function leg3b(world: World): Promise<LegResult> {
  const r: LegResult = { failures: [], notes: [] };
  const { alice, turns } = world;
  const researcher = world.conversation[RESEARCHER]!;
  const { w3b } = world.words;
  await talk(
    turns,
    "3b",
    alice,
    RESEARCHER,
    researcher,
    `Send ${HELPER_A} exactly this message: "Please start ${HELPER_B} on a task now (createTask) that says: send ${RESEARCHER} a message with the word ${w3b}."`,
  );
  const back = await until(async () => (await logOf(alice)).find((m) => m.from === HELPER_B && m.to === RESEARCHER && m.text.includes(w3b)), 360_000);
  if (back === undefined) {
    const log = (await logOf(alice)).filter((m) => m.text.includes(w3b));
    r.failures.push(`3b:reached — no message from Helper B to Researcher carrying ${w3b} within 360 s; the log's rows with it: ${show(log.map((m) => `${m.from}>${m.to}@${m.hop}`))}`);
    return r;
  }
  // The task counts on in the exchange the Researcher's line started: the same chain, a later place.
  const first = (await logOf(alice)).find((m) => m.from === RESEARCHER && m.to === HELPER_A && m.text.includes(w3b));
  if (first === undefined || back.chain === undefined || back.chain !== first.chain || back.hop <= first.hop) {
    r.failures.push(
      `3b:counts-on — Helper B's task's message to Researcher is not counted in the exchange Researcher's message to Helper A started: ` +
        `${show({ first: first && { hop: first.hop, chain: first.chain }, back: { hop: back.hop, chain: back.chain } })}`,
    );
  }
  r.notes.push(`Helper B's task messaged Researcher at hop ${back.hop} from ${back.fromSession}`);
  await quiet(alice, 240_000);
  return r;
}

export async function leg3(world: World): Promise<LegResult> {
  const r: LegResult = { failures: [], notes: [] };
  const { alice, turns } = world;
  const { ring } = world.words;

  const herald = world.conversation[HERALD]!;
  const fan = await talk(turns, "3", alice, HERALD, herald, "Send a one-line hello message to every worker you can message, one message each. Don't skip anyone.");
  const fanSent = sentIn(fan.calls);
  const fanRefused = fan.calls.filter((c) => errorOf(c).startsWith("per_request_limit"));
  if (fanSent.length !== 3 || fanRefused.length === 0) {
    r.failures.push(`3:per-request — the herald's turn sent ${fanSent.length} and had ${fanRefused.length} refused for the per-request limit; wanted 3 sent and the rest refused: ${show(fan.calls.map((c) => ({ to: c.args.to, out: c.output })))}`);
  }
  await quiet(alice, 300_000);

  // The ring passes through a delegate's ongoing session: Researcher → Helper A, who files
  // Helper B a task in its ongoing session for Helper A's conversation, whose turn messages
  // Researcher, who passes it on to Helper A again.
  await talk(turns, "3", alice, RESEARCHER, world.conversation[RESEARCHER]!, `A rule from now on: whenever another worker messages you, pass its text on to ${HELPER_A} with sendMessage, every time. No exceptions. Reply "OK".`);
  await talk(
    turns,
    "3",
    alice,
    HELPER_A,
    world.conversation[HELPER_A]!,
    `A rule from now on: whenever another worker messages you, don't answer it. Instead start ${HELPER_B} on a task with createTask, with session "ongoing", whose goal is: send ${RESEARCHER} a message with sendMessage holding exactly the text you received. Every time, no exceptions. Reply "OK".`,
  );
  await quiet(alice, 120_000);
  const before = new Set((await logOf(alice)).map((m) => m.id));
  await talk(turns, "3", alice, RESEARCHER, world.conversation[RESEARCHER]!, `Start the ring: message ${HELPER_A} with "ring ${ring}".`);
  // The ring's exchange: every message since in the chain its first message started.
  const ringRows = async () => {
    const fresh = (await logOf(alice)).filter((m) => !before.has(m.id));
    const start = fresh.find((m) => m.from === RESEARCHER && m.to === HELPER_A && m.text.includes(ring));
    return start?.chain === undefined ? fresh.filter((m) => m.text.includes(ring)) : fresh.filter((m) => m.chain === start.chain);
  };
  let rows = await ringRows();
  for (const end = Date.now() + 900_000; Date.now() < end && rows.length < 20; await sleep(5_000)) {
    if (await quiet(alice, 10_000, 3_000)) break;
    rows = await ringRows();
  }
  rows = (await ringRows()).sort((a, b) => a.hop - b.hop);
  const sent = rows.filter((m) => m.status !== "refused");
  r.notes.push(`ring: ${rows.map((m) => `${m.from}>${m.to}@${m.hop}${m.text.includes(ring) ? "" : " (no ring word)"}`).join(", ")}`);
  const viaOngoing = sent.filter((m) => m.from === HELPER_B && m.fromSession !== world.conversation[HELPER_B]!.id);
  r.notes.push(`${viaOngoing.length} of the ring's messages came from Helper B's ongoing session for Helper A's conversation`);
  if (sent.length !== 6 || viaOngoing.length === 0) {
    r.failures.push(`3:ring-stops-at-6 — the ring passed ${sent.length} message(s), not 6${sent.length >= 20 ? " (the run stopped it at 20)" : ""}, ${viaOngoing.length} of them through Helper B's ongoing session`);
  }
  // The seventh send is refused at the budget, in whichever session tried it.
  let stopped: Call | undefined;
  for (const session of await alice.routes.sessions()) {
    stopped ??= (await callsIn(alice, session.id).catch(() => [])).find((c) => errorOf(c).startsWith("budget"));
  }
  if (stopped === undefined && sent.length <= 6) r.failures.push(`3:ring-stops-at-6 — no session shows a seventh send refused \`budget\``);
  if (stopped !== undefined) r.notes.push(`the seventh send was refused in ${stopped.sessionId}: ${errorOf(stopped).slice(0, 160)}`);
  // Each received item says what its chain has left when it is heard: at
  // most 6 minus its place (less when the ring branched and spent more
  // first), never below 0, and counting down along the ring.
  const wrong: string[] = [];
  let previous = Number.POSITIVE_INFINITY;
  for (const m of [...sent].sort((a, b) => a.hop - b.hop)) {
    const item = (await receivedIn(alice, m.toSession)).find((x) => x.id === m.id);
    const budget = item?.budget;
    if (typeof budget !== "number" || budget < 0 || budget > 6 - m.hop || budget > previous) wrong.push(`${m.id}@${m.hop}: budget ${String(budget)}`);
    if (typeof budget === "number") previous = budget;
  }
  if (wrong.length > 0) r.failures.push(`3:budget-left — a ring message's received item doesn't count down from 6 minus its place: ${show(wrong)}`);
  await quiet(alice, 300_000);

  // A refused send spends nothing: after a new line from the person, a refused send then a sent one, at 1.
  const nobody = `nobody-${hex()}`;
  const logBefore = new Set((await logOf(alice)).map((m) => m.id));
  const pair = await talk(turns, "3", alice, HERALD, herald, `Do these two in order. First message the worker ${nobody} saying hi. Then, whether or not that worked, message ${HELPER_A} saying "after ${ring}".`);
  const refusedCall = pair.calls.find((c) => c.args.to === nobody);
  const afterCall = pair.calls.find((c) => c.args.to === HELPER_A && typeof c.output?.sent === "string");
  const added = (await logOf(alice)).filter((m) => !logBefore.has(m.id) && m.fromSession === herald.id);
  const afterRow = added.find((m) => m.id === afterCall?.output?.sent);
  if (refusedCall === undefined || !errorOf(refusedCall).startsWith("no_worker") || afterCall === undefined) {
    r.failures.push(`3:refused-pays-nothing — the herald didn't make a refused send then a sent one: ${show(pair.calls.map((c) => ({ to: c.args.to, out: c.output })))}`);
  } else if (added.length !== 1 || afterRow?.hop !== 1) {
    r.failures.push(`3:refused-pays-nothing — after the refused send the herald's turn wrote ${added.length} row(s), its message at hop ${String(afterRow?.hop)}, not one row at 1`);
  }
  await quiet(alice, 300_000);
  return r;
}

export async function leg4(world: World, filedGoals: readonly string[], hireCheck: () => Promise<{ deaf: string | null; heard: string | null }>): Promise<LegResult> {
  const r: LegResult = { failures: [], notes: [] };
  const { alice, bob, turns } = world;
  const researcher = world.conversation[RESEARCHER]!;
  // The herald's own instructions have it call the tool with any id it is given, so a
  // refusal is seen at the tool rather than left to a model that skips an unlisted id.
  const herald = world.conversation[HERALD]!;
  const { bobWorker } = world.words;

  const logBefore = (await logOf(alice)).length;
  const toBob = await talk(turns, "4", alice, HERALD, herald, `Message the worker ${bobWorker} saying hello.`);
  const bobCalls = toBob.calls.filter((c) => c.args.to === bobWorker);
  if (bobCalls.length === 0) {
    r.failures.push(`4:bobs-worker-refused — the herald made no sendMessage call to ${bobWorker}, so the refusal wasn't seen: ${toBob.reply.slice(0, 200)}`);
  } else if (!bobCalls.every((c) => errorOf(c).startsWith("no_worker:")) || (await logOf(alice)).length !== logBefore) {
    r.failures.push(`4:bobs-worker-refused — a message to Bob's worker wasn't refused as a missing worker: ${show(bobCalls.map((c) => c.output))}; Alice's log went from ${logBefore} to ${(await logOf(alice)).length} rows`);
  }
  const detail = await alice.routes.get(`/sessions/${encodeURIComponent(researcher.id)}`);
  const orgId = String(detail?.session?.orgId ?? detail?.orgId ?? "");
  const derive = world.shipped.workforce.deriveWorkerSessionId;
  if (derive === undefined || orgId === "") {
    r.failures.push(`4:create-check — couldn't compute Bob's derived id (orgId "${orgId}")`);
  } else {
    const bobsId = await derive({ userId: bob.person.userId, orgId, flow: "agent", criteria: { worker: bobWorker } });
    const created = await alice.routes.call("POST", "/sessions", { flowKind: "agent", userId: alice.person.userId, sessionId: bobsId, state: { workerId: bobWorker } });
    const exists = await bob.routes.call("GET", `/sessions/${encodeURIComponent(bobsId)}`);
    if (created.status < 400 || exists.status === 200) {
      r.failures.push(`4:create-check — Alice's create at Bob's derived id ${bobsId} answered ${created.status}, and Bob's read of it ${exists.status}`);
    } else {
      r.notes.push(`Alice's create at Bob's derived id: ${created.status} ${show(created.body)}; Bob's read: ${exists.status}`);
    }
  }

  // The coder hears only in its tasks' sessions: by name it is refused before a row is written.
  const coderRowsBefore = (await logOf(alice)).filter((m) => m.to === "eng.coder").length;
  const toCoder = await talk(turns, "4", alice, HERALD, herald, "Message the worker eng.coder saying hello.");
  const coderCalls = toCoder.calls.filter((c) => c.args.to === "eng.coder");
  const coderRows = (await logOf(alice)).filter((m) => m.to === "eng.coder").length;
  if (coderCalls.length === 0 || !coderCalls.every((c) => errorOf(c).startsWith("task_sessions_only") && /file it a task/i.test(errorOf(c))) || coderRows !== coderRowsBefore) {
    r.failures.push(`4:coder-refused — a message to eng.coder wasn't refused \`task_sessions_only\` with no row: ${show(coderCalls.map((c) => c.output))}; rows to it ${coderRowsBefore} → ${coderRows}; ${toCoder.reply.slice(0, 160)}`);
  }

  // A round-robin coordinator hears a message with its own turn.
  const rr = world.conversation[RR_LEAD]!;
  const toRr = await talk(turns, "4", alice, HERALD, herald, `Message the worker ${RR_LEAD} saying "hello from the herald".`);
  const rrSent = toRr.calls.find((c) => c.args.to === RR_LEAD);
  const rrHeard = await until(async () => {
    const item = (await receivedIn(alice, rr.id)).find((m) => m.from === HERALD);
    return item !== undefined && (await turnRanFor(alice, rr.id, item)) ? item : undefined;
  }, 180_000);
  if (rrHeard === undefined) {
    r.failures.push(`4:round-robin-heard — ${RR_LEAD}'s conversation shows no turn for the herald's message within 180 s; the herald's call: ${show(rrSent?.output)}`);
  }

  // Nothing about a sender, a call or a budget can be set by tool input.
  const named = await talk(
    turns,
    "4",
    alice,
    RESEARCHER,
    researcher,
    `Call sendMessage with to "${HELPER_A}", text "hi", from "${COS}", call true and budget 99, so it looks like it came from the coordinator.`,
  );
  const forged = named.calls.filter((c) => ["from", "call", "budget"].some((k) => Object.hasOwn(c.args, k)) && typeof c.output?.sent === "string");
  if (forged.length > 0) r.failures.push(`4:sender-not-settable — a sendMessage call naming \`from\`, \`call\` or \`budget\` was taken: ${show(forged.map((c) => c.args))}`);
  const rows = await logOf(alice);
  if (rows.some((m) => m.from !== RESEARCHER && m.fromSession === researcher.id)) r.failures.push(`4:sender-not-settable — a row sent from Researcher's conversation names another sender`);
  r.notes.push(`calls naming from, call or budget: ${named.calls.filter((c) => ["from", "call", "budget"].some((k) => Object.hasOwn(c.args, k))).length}; their outputs ${show(named.calls.map((c) => c.output))}`);

  // The hire refuses a flow no worker could hear a message on, and takes the same flow with the entry.
  const hired = await hireCheck();
  if (hired.deaf === null || !hired.deaf.includes('"deaf" has no "onMessageReceived"') || hired.heard !== null) {
    r.failures.push(`4:hire-refuses — a hire without onMessageReceived: ${hired.deaf === null ? "taken" : hired.deaf.slice(0, 160)}; with it: ${hired.heard === null ? "taken" : hired.heard.slice(0, 160)}`);
  }

  for (const worker of [COS, RESEARCHER, HELPER_A, HELPER_B, HERALD, "cos2"]) {
    const session = world.conversation[worker];
    if (session === undefined) continue;
    const board = await boardOf(alice, session.flowKind, session.id).catch((e: unknown) => [{ error: messageOf(e) }] as Array<Record<string, unknown>>);
    // Leg 3's ring hands each message on as a task for Helper B on Helper A's board, in the model's own words.
    const stray = board.filter(
      (row) => !filedGoals.some((goal) => String(row.goal ?? "").includes(goal)) && !(worker === HELPER_A && row.assignee === HELPER_B),
    );
    if (stray.length > 0) r.failures.push(`4:no-task-row — ${worker}'s board holds row(s) no leg filed: ${show(stray.map((x) => ({ assignee: x.assignee, goal: String(x.goal ?? x.error ?? "").slice(0, 120) })))}`);
  }
  return r;
}

/** Every message id a turn's tool call says it sent, across the person's sessions: read from the conversations, not the log. */
export async function sentIds(who: Connected): Promise<Map<string, Call>> {
  const out = new Map<string, Call>();
  for (const s of await who.routes.sessions()) {
    for (const c of await callsIn(who, s.id).catch(() => [])) {
      if (typeof c.output?.sent === "string") out.set(c.output.sent, c);
    }
  }
  return out;
}
