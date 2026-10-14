/**
 * The legs, against Shift Manager's DevTeam install served by its own command:
 * Alice (its owner) and Bob (its second member) act through the shipped
 * clients with their own verified bearers, and every worker turn runs on the
 * real model its file or its hire names.
 *
 * Every change goes through the app: a person's line in a worker's own
 * conversation, the roster flow's `hire`, and the coordinator's delegate
 * actions. Nothing is seeded by a fixture or written to a store. Every grade
 * is read back as the person who owns it, through the install's routes: a
 * conversation's items (its lines, under whose name, and each turn's tool
 * calls and their outputs), the board's task read Shift Manager makes, and
 * the user's message log through their roster session.
 *
 * A leg's assertions are tagged `<leg>:<name>`.
 */
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
    createClient(options: { flowKind: string; userId: string; baseUrl?: string; fetcher?: typeof fetch }): {
      sendAction(action: string, input: unknown, options: { sessionId: string }): Promise<{ request: { id: string } }>;
      getRequestStatus(requestId: string): Promise<{ status: string }>;
    };
    createSessionClient(options: { baseUrl?: string; fetcher?: typeof fetch }): {
      createSession(options: { flowKind: string; userId: string; sessionId?: string; state?: Record<string, unknown> }): Promise<{ id: string }>;
    };
  };
  workforce: {
    createWorkforceClient(options: { userId: string; baseUrl?: string; fetcher?: typeof fetch }): {
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
  sessions: ReturnType<Shipped["client"]["createSessionClient"]>;
  flow(flowKind: string): ReturnType<Shipped["client"]["createClient"]>;
  routes: LabRoutes;
}

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
    flow: (flowKind) => shipped.client.createClient({ flowKind, userId: person.userId, ...transport }),
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
export const MESSAGE_TOOL = "messageWorker";
const LOG_PATTERN = "workforce/messages/*";
const ROSTER_FLOW = "workforce-roster";
export const COS = "chief-of-staff";
export const RESEARCHER = "researcher";
export const HELPER_A = "helper-a";
export const HELPER_B = "helper-b";
export const HERALD = "herald";
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
    requestId = (await client.sendAction(action, input, { sessionId })).request.id;
  } catch (error) {
    const status = (error as { status?: unknown }).status;
    return { status: `http ${typeof status === "number" ? status : "?"}`, requestId: null, output: undefined, error: messageOf(error) };
  }
  let status = "timed-out";
  for (const until = Date.now() + timeoutMs; Date.now() < until; await sleep(500)) {
    const now = (await client.getRequestStatus(requestId).catch(() => undefined))?.status;
    if (now !== undefined && !RUNNING.has(now)) {
      status = now;
      break;
    }
  }
  const found = (await who.routes.requests(sessionId).catch(() => [])).find((r) => r.id === requestId);
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
    const acted = await act(who, session.flowKind, session.id, "run", { message: words });
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
      const requests = await who.routes.requests(s.id).catch(() => []);
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
  exchange: string;
  replyTo?: string;
  fromSession: string;
  toSession: string;
  hop: number;
  status: string;
  reason?: string;
  at: number;
};

/** The person's roster session: their own session on the roster flow, which declares the log. */
export async function rosterSessionOf(who: Connected): Promise<string> {
  const found = (await who.routes.sessions()).find((s) => (s.flowKind ?? s.flowId) === ROSTER_FLOW && s.parentSessionId == null);
  if (found !== undefined) return found.id;
  return (await who.sessions.createSession({ flowKind: ROSTER_FLOW, userId: who.person.userId })).id;
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
  /** The person's own conversation with each worker, at its derived address. */
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
    instructions: `You are Helper A. Answer other workers' questions briefly and directly. Your favourite colour is ${colourA}. When you are asked to have helper-b do something, start helper-b on a task for it with dispatchTask (not addTask).`,
    settings: { delegates: [HELPER_B], model: HIRE_MODEL },
  });
  await hire(world.alice, {
    id: HELPER_B,
    flow: "agent",
    description: "Helper B: a teammate other workers can ask quick questions.",
    instructions: "You are Helper B. Answer other workers' questions briefly and directly, and do the tasks you are given.",
    settings: { model: HIRE_MODEL },
  });
  await hire(world.alice, {
    id: HERALD,
    flow: "agent",
    description: "The herald: says hello to people.",
    instructions: "You are the herald. Do what the user asks.",
    settings: { model: HIRE_MODEL },
  });
  await hire(world.bob, { id: world.words.bobWorker, flow: "agent", description: "Bob's own assistant.", instructions: "You help Bob.", settings: { model: HIRE_MODEL } });
  return failures;
}

/** Open (or find) each person's conversation with each worker, at its derived address. */
export async function openConversations(world: World): Promise<void> {
  for (const worker of [COS, RESEARCHER, HELPER_A, HELPER_B, HERALD]) {
    world.conversation[worker] = await world.alice.workforce.ensureWorkerSession({ worker });
  }
}

/** The calls a session made whose output says sent: `{ sent: <id> }`. */
const sentIn = (calls: readonly Call[]) => calls.flatMap((c) => (typeof c.output?.sent === "string" ? [c.output.sent as string] : []));
const errorOf = (c: Call) => String(c.output?.error ?? "");

// ---------------------------------------------------------------------------
// Leg 1: the person tells Researcher to ask the Shift Coordinator the codename.
// ---------------------------------------------------------------------------

export async function leg1(world: World): Promise<LegResult> {
  const r: LegResult = { failures: [], notes: [] };
  const { alice, turns } = world;
  const cos = world.conversation[COS]!;
  const researcher = world.conversation[RESEARCHER]!;
  const { codename } = world.words;
  // Every line the person sends the Shift Coordinator reaches its own turn:
  // its default delegates are taken off this conversation, so best fit has
  // nobody else to hand it to. Routing is FIX-1791's, not under test here.
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
  // Its answer to the person, in a turn after the coordinator's answer arrived.
  const answered = await until(async () => {
    const lines = await linesIn(alice, researcher.id);
    const from = lines.findIndex((l) => l.agentName === COS && l.text.includes(codename));
    if (from < 0) return undefined;
    const after = lines.slice(from + 1).find((l) => l.role === "assistant" && l.agentName !== COS && l.text.includes(codename) && l.requestId !== asked.requestId);
    return after === undefined ? undefined : { line: lines[from]!, after };
  }, 240_000);
  if (answered === undefined) {
    const lines = await linesIn(alice, researcher.id);
    r.failures.push(
      `1:answer-holds-codename — within 240 s no Researcher answer to the person, after the coordinator's answer, holds ${codename}; Researcher's conversation: ${show(lines.map((l) => `${l.agentName ?? l.role}: ${l.text.slice(0, 80)}`))}`,
    );
  } else {
    r.notes.push(`Researcher heard "${answered.line.text.slice(0, 120)}" and told the person "${answered.after.text.slice(0, 120)}"`);
  }
  // The coordinator's conversation shows one message from Researcher, and its answer.
  const cosLines = await linesIn(alice, cos.id);
  const fromResearcher = cosLines.filter((l) => l.agentName === RESEARCHER && l.text.startsWith(`From ${RESEARCHER}: `));
  if (fromResearcher.length !== 1) r.failures.push(`1:coordinator-shows-message — the coordinator's conversation holds ${fromResearcher.length} lines from Researcher, not 1: ${show(fromResearcher.map((l) => l.text))}`);
  const cosAnswers = (await callsIn(alice, cos.id)).filter((c) => c.args.to === RESEARCHER && typeof c.output?.sent === "string");
  if (cosAnswers.length === 0) r.failures.push(`1:coordinator-answered — the coordinator's conversation holds no message it sent Researcher`);
  return r;
}

// ---------------------------------------------------------------------------
// Leg 1b: the other way. The person tells the coordinator to tell Researcher.
// ---------------------------------------------------------------------------

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
  const heard = await until(async () => (await linesIn(alice, researcher.id)).find((l) => l.agentName === COS && l.text.includes(codename2)), 180_000);
  if (heard === undefined) r.failures.push(`1b:researcher-shows-message — Researcher's conversation shows no line from the coordinator holding ${codename2} within 180 s`);
  await quiet(alice, 180_000);
  const next = await talk(turns, "1b", alice, RESEARCHER, researcher, "What is the new codename? Answer with just the codename.");
  if (!next.reply.includes(codename2)) r.failures.push(`1b:next-answer-holds-it — Researcher's next answer to the person doesn't hold ${codename2}: ${next.reply.slice(0, 200)}`);
  return r;
}

// ---------------------------------------------------------------------------
// Leg 2: from a task. The coordinator files Researcher a task to ask Helper A.
// ---------------------------------------------------------------------------

export async function leg2(world: World): Promise<LegResult> {
  const r: LegResult = { failures: [], notes: [] };
  const { alice, turns } = world;
  const cos = world.conversation[COS]!;
  const researcher = world.conversation[RESEARCHER]!;
  const { colourA } = world.words;
  const added = await act(alice, cos.flowKind, cos.id, "addDelegate", { worker: RESEARCHER }, 60_000);
  if (added.status !== "completed") r.failures.push(`2:setup — adding Researcher as a delegate ${added.status}: ${added.error ?? ""}`);
  const logBefore = new Set((await logOf(alice)).map((m) => m.id));
  const filed = await talk(
    turns,
    "2",
    alice,
    COS,
    cos,
    `File a task for ${RESEARCHER} with your task tool (not a post, and don't do it yourself). The task: "Ask ${HELPER_A} (a worker) for its favourite colour, by sending it a message. Then you're done."`,
  );
  const rows = await until(async () => {
    const board = await boardOf(alice, cos.flowKind, cos.id);
    return board.some((row) => row.assignee === RESEARCHER) ? board : undefined;
  }, 120_000);
  if (rows === undefined) {
    r.failures.push(`2:filed — the coordinator's board holds no task for Researcher within 120 s; its turn: ${show(filed.calls)} ${filed.reply.slice(0, 200)}`);
    return r;
  }
  // The task's message to Helper A, sent from the task's own session.
  const ask = await until(async () => (await logOf(alice)).find((m) => !logBefore.has(m.id) && m.from === RESEARCHER && m.to === HELPER_A), 240_000);
  if (ask === undefined) {
    r.failures.push(`2:reached-helper — no message from Researcher to Helper A in the log within 240 s`);
    return r;
  }
  if (ask.fromSession === researcher.id) r.failures.push(`2:from-task — the message to Helper A was sent from Researcher's own conversation, not the task's session`);
  // Helper A's answer: lands in Researcher's own conversation, under Helper A's name, and wakes it.
  const answer = await until(async () => (await logOf(alice)).find((m) => m.from === HELPER_A && m.to === RESEARCHER && m.replyTo === ask.id), 240_000);
  if (answer === undefined) {
    r.failures.push(`2:answered — Helper A sent no answer to ${ask.id} within 240 s`);
    return r;
  }
  r.notes.push(`Researcher's task asked Helper A from ${ask.fromSession}; Helper A's answer ${answer.id} went to ${answer.toSession} (status ${answer.status}, hop ${answer.hop})`);
  const landed = await until(async () => {
    const lines = await linesIn(alice, researcher.id);
    const at = lines.findIndex((l) => l.agentName === HELPER_A && l.text.startsWith(`From ${HELPER_A}: `) && l.text.toLowerCase().includes(colourA.toLowerCase()));
    return at < 0 ? undefined : { lines, at };
  }, 120_000);
  if (answer.toSession !== researcher.id || landed === undefined) {
    r.failures.push(
      `2:lands-in-own-conversation — Helper A's answer went to ${answer.toSession}, and Researcher's own conversation is ${researcher.id}; ` +
        `a line from Helper A holding ${colourA} there: ${landed === undefined ? "none" : "yes"}`,
    );
    return r;
  }
  const woke = await until(async () => {
    const lines = await linesIn(alice, researcher.id);
    return lines.slice(landed.at + 1).find((l) => l.role === "assistant" && l.agentName !== HELPER_A);
  }, 180_000);
  if (woke === undefined) r.failures.push(`2:wakes — no turn of Researcher's wrote a line after Helper A's answer landed`);
  // The message made no row: the coordinator's board holds the one task, and Helper A's none.
  const helperBoard = await boardOf(alice, "agent", world.conversation[HELPER_A]!.id).catch(() => []);
  if (helperBoard.length > 0) r.failures.push(`2:no-row — Helper A's board holds ${helperBoard.length} row(s) after it was messaged: ${show(helperBoard.map((x) => x.goal))}`);
  const removed = await act(alice, cos.flowKind, cos.id, "removeDelegate", { worker: RESEARCHER }, 60_000);
  if (removed.status !== "completed") r.notes.push(`removeDelegate researcher: ${removed.status}`);
  return r;
}

// ---------------------------------------------------------------------------
// Leg 2b: no waiting. A turn told to wait for the answer has no way to.
// ---------------------------------------------------------------------------

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
    `Message ${HELPER_A} asking what its favourite number is, and wait for its answer before you reply to me. Use the tool's wait option if it has one.`,
  );
  if (turn.status !== "completed") r.failures.push(`2b:turn-ends — the turn ${turn.status}: ${turn.reply.slice(0, 200)}`);
  const waited = turn.calls.filter((c) => Object.hasOwn(c.args, "wait") && typeof c.output?.sent === "string");
  if (waited.length > 0) r.failures.push(`2b:no-wait — a messageWorker call naming \`wait\` was taken: ${show(waited.map((c) => c.args))}`);
  // The answer, if any, arrives as a line after the turn, never inside it.
  const inside = (await linesIn(alice, researcher.id)).filter((l) => l.requestId === turn.requestId && l.agentName === HELPER_A);
  if (inside.length > 0) r.failures.push(`2b:no-wait — Helper A's answer landed inside the asking turn`);
  r.notes.push(`calls: ${show(turn.calls.map((c) => ({ args: c.args, output: c.output })))}`);
  await quiet(alice, 180_000);
  return r;
}

// ---------------------------------------------------------------------------
// Leg 3b: the hop count goes through a delegation.
// ---------------------------------------------------------------------------

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
    `Send ${HELPER_A} exactly this message: "Please start ${HELPER_B} on a task now (dispatchTask) that says: send ${RESEARCHER} a message with the word ${w3b}."`,
  );
  const back = await until(async () => (await logOf(alice)).find((m) => m.from === HELPER_B && m.to === RESEARCHER && m.text.includes(w3b)), 360_000);
  if (back === undefined) {
    const log = (await logOf(alice)).filter((m) => m.text.includes(w3b));
    r.failures.push(`3b:reached — no message from Helper B to Researcher carrying ${w3b} within 360 s; the log's rows with it: ${show(log.map((m) => `${m.from}>${m.to}@${m.hop}`))}`);
    return r;
  }
  if (back.hop !== 2) r.failures.push(`3b:hop-2 — Helper B's task's message to Researcher carries hop ${back.hop}, not 2 (Researcher > Helper A was 1, and the task Helper A filed carries its count)`);
  r.notes.push(`Helper B's task messaged Researcher at hop ${back.hop} from ${back.fromSession}`);
  await quiet(alice, 240_000);
  return r;
}

// ---------------------------------------------------------------------------
// Leg 3: the limits. A three-worker ring stops at 6; one turn sends at most 3.
// ---------------------------------------------------------------------------

export async function leg3(world: World): Promise<LegResult> {
  const r: LegResult = { failures: [], notes: [] };
  const { alice, turns } = world;
  const { ring } = world.words;

  // One turn messages the whole roster: 3 go, the rest are refused.
  const herald = world.conversation[HERALD]!;
  const fan = await talk(turns, "3", alice, HERALD, herald, "Send a one-line hello message to every worker you can message, one message each. Don't skip anyone.");
  const fanSent = sentIn(fan.calls);
  const fanRefused = fan.calls.filter((c) => errorOf(c).startsWith("per_turn_limit"));
  if (fanSent.length !== 3 || fanRefused.length === 0) {
    r.failures.push(`3:per-turn — the herald's turn sent ${fanSent.length} and had ${fanRefused.length} refused for the per-turn limit; wanted 3 sent and the rest refused: ${show(fan.calls.map((c) => ({ to: c.args.to, out: c.output })))}`);
  }
  await quiet(alice, 300_000);

  // The ring: each passes every message on to the next, always.
  const next: Record<string, string> = { [RESEARCHER]: HELPER_A, [HELPER_A]: HELPER_B, [HELPER_B]: RESEARCHER };
  for (const [worker, to] of Object.entries(next)) {
    await talk(turns, "3", alice, worker, world.conversation[worker]!, `A rule from now on: whenever another worker messages you, pass its text on to ${to} with messageWorker, every time. No exceptions. Reply "OK".`);
  }
  await quiet(alice, 120_000);
  const before = new Set((await logOf(alice)).map((m) => m.id));
  await talk(turns, "3", alice, RESEARCHER, world.conversation[RESEARCHER]!, `Start the ring: message ${HELPER_A} with "ring ${ring}".`);
  const ringRows = async () => (await logOf(alice)).filter((m) => !before.has(m.id) && m.text.includes(ring));
  // Wait until the ring is quiet, or stop it at 20.
  let rows = await ringRows();
  for (const end = Date.now() + 600_000; Date.now() < end && rows.length < 20; await sleep(5_000)) {
    if (await quiet(alice, 10_000, 3_000)) break;
    rows = await ringRows();
  }
  rows = await ringRows();
  const sent = rows.filter((m) => m.status !== "refused");
  r.notes.push(`ring: ${rows.sort((a, b) => a.hop - b.hop).map((m) => `${m.from}>${m.to}@${m.hop}`).join(", ")}`);
  if (sent.length !== 6) r.failures.push(`3:ring-stops-at-6 — the ring passed ${sent.length} message(s)${sent.length >= 20 ? " before the run stopped it at 20" : ""}, not 6`);
  // The seventh send is refused, and that worker's conversation shows it stopped.
  let stopped: Call | undefined;
  for (const worker of [RESEARCHER, HELPER_A, HELPER_B]) {
    stopped ??= (await callsIn(alice, world.conversation[worker]!.id)).find((c) => errorOf(c).startsWith("hop_limit") && String(c.args.text ?? "").includes(ring));
  }
  if (stopped === undefined && sent.length <= 6) r.failures.push(`3:seventh-refused — no worker's conversation shows a send refused at the hop limit`);
  if (stopped !== undefined) r.notes.push(`the seventh send was refused in ${stopped.sessionId}: ${errorOf(stopped).slice(0, 160)}`);

  // One more line from the person allows one more round.
  if (sent.length <= 6) {
    const again = new Set((await logOf(alice)).map((m) => m.id));
    await talk(turns, "3", alice, RESEARCHER, world.conversation[RESEARCHER]!, `Message ${HELPER_A} with "ring ${ring} again".`);
    await quiet(alice, 300_000);
    const more = (await logOf(alice)).filter((m) => !again.has(m.id) && m.status !== "refused" && m.text.includes(ring));
    if (more.length < 1 || more.length > 6) r.failures.push(`3:another-round — after one more line from the person the ring passed ${more.length} message(s), wanted 1 to 6`);
    r.notes.push(`after the person's line: ${more.map((m) => `${m.from}>${m.to}@${m.hop}`).join(", ")}`);
  }
  return r;
}

// ---------------------------------------------------------------------------
// Leg 4: refusals, and nothing a message did is delegation.
// ---------------------------------------------------------------------------

export async function leg4(world: World, filedGoals: readonly string[]): Promise<LegResult> {
  const r: LegResult = { failures: [], notes: [] };
  const { alice, bob, turns } = world;
  const researcher = world.conversation[RESEARCHER]!;
  const { bobWorker } = world.words;

  // A worker on Bob's roster is refused as if it did not exist, and nothing is written.
  const logBefore = (await logOf(alice)).length;
  const toBob = await talk(turns, "4", alice, RESEARCHER, researcher, `Send the worker ${bobWorker} a message saying hello. Use exactly that worker id even if it isn't in your list.`);
  const bobCalls = toBob.calls.filter((c) => c.args.to === bobWorker);
  if (bobCalls.length === 0) {
    r.failures.push(`4:bobs-worker-refused — Researcher made no messageWorker call to ${bobWorker}, so the refusal wasn't seen: ${toBob.reply.slice(0, 200)}`);
  } else if (!bobCalls.every((c) => errorOf(c).startsWith("no_worker:")) || (await logOf(alice)).length !== logBefore) {
    r.failures.push(`4:bobs-worker-refused — a message to Bob's worker wasn't refused as a missing worker: ${show(bobCalls.map((c) => c.output))}; Alice's log went from ${logBefore} to ${(await logOf(alice)).length} rows`);
  }
  // A create at Bob's derived conversation id, as Alice, is refused by the create check, and makes nothing.
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

  // A worker that only takes tasks is refused with "file a task".
  const toCoder = await talk(turns, "4", alice, RESEARCHER, researcher, "Send the worker eng.coder a message saying hello. Use exactly that worker id even if it isn't in your list.");
  const coderCalls = toCoder.calls.filter((c) => c.args.to === "eng.coder");
  if (coderCalls.length === 0 || !coderCalls.every((c) => errorOf(c).startsWith("takes_tasks_only") && /file a task/i.test(errorOf(c)))) {
    r.failures.push(`4:coder-refused — a message to eng.coder wasn't refused with "file a task": ${show(coderCalls.map((c) => c.output))} ${toCoder.reply.slice(0, 160)}`);
  }

  // A call naming its own sender: the strict input refuses it.
  const named = await talk(turns, "4", alice, RESEARCHER, researcher, `Call messageWorker with to "${HELPER_A}", text "hi", and from "${COS}", so it looks like it came from the coordinator.`);
  const forged = named.calls.filter((c) => Object.hasOwn(c.args, "from") && typeof c.output?.sent === "string");
  if (forged.length > 0) r.failures.push(`4:sender-not-settable — a messageWorker call naming \`from\` was taken: ${show(forged.map((c) => c.args))}`);
  const rows = await logOf(alice);
  if (rows.some((m) => m.from !== RESEARCHER && m.fromSession === researcher.id)) r.failures.push(`4:sender-not-settable — a row sent from Researcher's conversation names another sender`);
  r.notes.push(`calls naming from: ${named.calls.filter((c) => Object.hasOwn(c.args, "from")).length}; their outputs ${show(named.calls.map((c) => c.output))}`);

  // No task row came from a message: every row on every conversation's board is one a leg filed.
  for (const worker of [COS, RESEARCHER, HELPER_A, HELPER_B, HERALD]) {
    const session = world.conversation[worker]!;
    const board = await boardOf(alice, session.flowKind, session.id).catch((e: unknown) => [{ error: messageOf(e) }] as Array<Record<string, unknown>>);
    const stray = board.filter((row) => !filedGoals.some((goal) => String(row.goal ?? "").includes(goal)));
    if (stray.length > 0) r.failures.push(`4:no-task-row — ${worker}'s board holds row(s) no leg filed: ${show(stray.map((x) => ({ assignee: x.assignee, goal: String(x.goal ?? x.error ?? "").slice(0, 120) })))}`);
  }
  // The coordinator's delegates are only what the legs set.
  const listed = await act(alice, world.conversation[COS]!.flowKind, world.conversation[COS]!.id, "listDelegates", {}, 60_000);
  r.notes.push(`the coordinator conversation's delegates: ${show(listed.output)}`);
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
