/**
 * The lab's one way in and out. Every read and write the screen makes goes
 * through `LabAdapter`, and nothing else in `src/` touches a package. Each
 * function is bound to the package call it stands for:
 *
 * | Function            | Bound to                                                                     |
 * |---------------------|------------------------------------------------------------------------------|
 * | `listWorkers`       | the workforce client's `roster()`                                            |
 * | `openConversation`  | `ensureWorkerSession({ worker })`: the worker's default conversation         |
 * | `send`              | the worker's door, `respond`, streamed, so its answer shows as it is written  |
 * | `watchConversation` | the session's items, from its snapshot and then its stream                   |
 * | `answerApproval`    | the request's `answer`: approve or reject a `user_approval` stop             |
 * | `watchTalk`         | the user's message log (`workforceMessages`), as `sendMessage` writes it     |
 * | `watchActivity`     | `listSessionRequests` on the worker's conversation                           |
 * | `watchWindow`       | the last answering request's `historyStart`, and the session's `historySummary` |
 * | `hire`              | the workforce client's `hire`: a row on the user's roster                     |
 * | `editInstructions`  | the workforce client's `edit`, on one of the user's own workers               |
 * | `fire`              | the workforce client's `fire`, on one of the user's own workers               |
 * | `watchTasks`        | the board's rows, as the conversation's stream carries each one (`task-change`) |
 * |                     | and, while a running row names no run, the board's `listTasks` read for its run |
 * |                     | and `taskSpendView` on a row, for the harness and model its run reported      |
 * | `watchRun`          | the items of the session the task's row names as its run, each tool call      |
 * |                     | named by the UI registry's `tool-naming` (`components/flow-state/`)           |
 * | `watchExchange`     | the receiving worker's conversation: the turn that read one message          |
 *
 * A received message is drawn from its own item (`workforce:received`), which
 * carries its message id, so the pending line joins the log to the
 * conversation by id (gap G2, shipped with FIX-2070).
 *
 * The page acts as the user `fsdev dev` hands it (the config's `devtool`
 * block), with the bearer token when there is one, on the server it came from.
 */
import { createClient, readEveryCollectionPage, type Client, type SessionRequestSummary } from "@flow-state-dev/client";
import type { OutputItem } from "@flow-state-dev/core/items";
import { readBearerToken, readUserId, withBearerToken } from "@flow-state-dev/devtool/react";
import {
  createWorkforceClient,
  RECEIVED_MESSAGE_COMPONENT,
  SEND_MESSAGE_TOOL,
  WORKER_MESSAGES_RESOURCE,
  workerMessageRowSchema,
  type RosterEntry,
  type WorkforceClient,
} from "@flow-state-dev/workforce/browser";
import { taskSpendView } from "@flow-state-dev/orchestration/tasks";
import { CODER_FLOW } from "./lib/coder-flow";
import { toolIntent, toolSubject } from "./components/flow-state/tool-naming";
import { harnessName } from "./lib/harness";
import { sessionFeeds, type SessionFeed } from "./lib/session-feed";
import { stableList } from "./lib/stable";

/** Stops a watch. */
export type Unsubscribe = () => void;

/** One worker on the roster. */
export interface WorkerRow {
  /** The worker's address on the roster, e.g. `teammates.chief-of-staff`. */
  id: string;
  /** The name the user reads. */
  name: string;
  /** Its `WORKER.md` description: the ongoing role. */
  role: string;
  /** Coding tasks run on it: it is not a teammate, so it is off the list and has no conversation. */
  takesTasks?: boolean;
  /** The user hired it: they can change its instructions or fire it. The files' workers can't be. */
  own?: boolean;
  /** For a coding worker, its file's `harness:`, from the roster row's shown settings. */
  harness?: string;
  /** Its file's `icon:`, from the roster row's shown settings. */
  icon?: string;
  /** Its file's `color:`, a name from the lab's palette, from the roster row's shown settings. */
  color?: string;
}

/** A teammate to hire from the page. */
export interface NewTeammate {
  /** Its name, which is its id on the roster: one word, lowercase. */
  name: string;
  /** One line on what it does: Chief of Staff reads it to know who to ask. */
  role: string;
  instructions: string;
}

/** A task a conversation filed, from the board's row. */
export interface BoardTask {
  id: string;
  /** The worker it was filed for. */
  to: string;
  title: string;
  status: "running" | "done" | "failed";
  /** What the run reported when it ended, or why it failed. */
  result?: string;
  /** The session its run works in, once it started. */
  runSessionId?: string;
  /** For a coding task, the harness it runs on: the one its run reported, else its worker's `harness:`. */
  harness?: string;
  /** The model its run reported, when it reported one; never guessed. */
  model?: string;
}

/**
 * One step of a session as a popup draws it: a line given to the worker (a
 * task's brief, or a message), what the worker wrote, a message it sent, a
 * tool it ran, or the harness a coding run went through.
 */
export interface SessionStep {
  id: string;
  kind: "given" | "said" | "sent" | "tool" | "harness";
  text: string;
  /** For `sent`, the worker it went to. */
  to?: string;
  /** For `tool`, the tool's own name, which a run of steps is summed up by. */
  tool?: string;
  /** For `tool`, the step is a shell command, shown as code. */
  code?: boolean;
  /** For `said`, while it is still being written. */
  streaming?: boolean;
}

/** One entry of a worker's conversation, in the order it happened. */
export type ConversationEntry =
  | { kind: "user"; id: string; text: string; queued?: boolean }
  /** `streaming` while the answer is still being written. */
  | { kind: "assistant"; id: string; text: string; streaming?: boolean }
  /** The worker messaged another worker (`sendMessage`). */
  | { kind: "sent"; id: string; messageId: string; to: string; text: string }
  /** A message another worker sent, as the `receive` turn that read it. */
  | { kind: "received"; id: string; messageId: string; from: string; text: string; inReplyTo?: string; noAnswer?: boolean }
  /** The worker filed a task; the card reads the board's row by its id, and draws `title` until the row arrives. */
  | { kind: "task"; id: string; taskId: string; title: string; to: string }
  /** A task it filed ended, as a line under the name of the worker that ran it; `title` is the task's, once its row is read. */
  | { kind: "result"; id: string; taskId: string; from: string; text: string; title?: string; failed?: boolean }
  /** The worker waits for your yes (`waitForUser` with an approval); `resolution` once answered. */
  | { kind: "approval"; id: string; requestId: string; suspensionId: string; text: string; resolution?: string };

/** What a conversation shows now. */
export interface ConversationView {
  entries: ConversationEntry[];
  /** The worker is answering in this conversation now. */
  running: boolean;
}

/** One row of the message log: one message from one worker to another. */
export interface TalkRow {
  id: string;
  from: string;
  to: string;
  text: string;
  /** The message this one answers. */
  inReplyTo?: string;
  /** When it was sent, in ms. */
  at: number;
  /** It was refused, or nobody took it in time: it will never land. */
  undelivered?: boolean;
  /** The sender asked for a reply and went on: an answer comes back as a message. */
  replyRequested?: boolean;
  /** A call the recipient answered: its reply was the call's result, never a message of its own. */
  callAnswered?: boolean;
  /** The framework's "no answer" to the message it replies to: the recipient's turn gave none. */
  noAnswer?: boolean;
}

/** Whether a worker is busy, read from its conversation's requests. */
export interface Activity {
  /** A request is running in the worker's conversation. */
  running: boolean;
  /** When its last request ended or started, in ms. */
  lastActiveAt: number;
}

/** Where the turns the worker reads word for word begin. */
export interface WindowMark {
  /** The first entry inside the history window. Entries before it are out of the worker's view. */
  firstVerbatimEntryId: string;
  /** The turns before it were summarized for the worker, rather than dropped. */
  summarized: boolean;
}

/** Everything the screen reads and writes. */
export interface LabAdapter {
  listWorkers(): Promise<WorkerRow[]>;
  /** The worker's one conversation; the same id every time. */
  openConversation(worker: string): Promise<string>;
  send(sessionId: string, text: string): Promise<void>;
  watchConversation(sessionId: string, onChange: (view: ConversationView) => void): Unsubscribe;
  /** Say yes or no to what an approval entry asks; the worker's turn carries on. */
  answerApproval(sessionId: string, approval: { requestId: string; suspensionId: string }, approve: boolean): Promise<void>;
  /** Every message to or from `worker`, oldest first. */
  watchTalk(worker: string, onChange: (rows: TalkRow[]) => void): Unsubscribe;
  watchActivity(worker: string, onChange: (activity: Activity) => void): Unsubscribe;
  /** `undefined` while the whole conversation is inside the window. */
  watchWindow(sessionId: string, onChange: (mark: WindowMark | undefined) => void): Unsubscribe;
  /** Hire a teammate onto the user's roster, on the built-in agent flow. */
  hire(teammate: NewTeammate): Promise<WorkerRow>;
  /** Replace one of the user's own teammates' instructions, from its next turn on. */
  editInstructions(worker: string, instructions: string): Promise<void>;
  /** Fire one of the user's own teammates: it leaves the roster, and its conversation stays readable. */
  fire(worker: string): Promise<void>;
  /** The tasks a conversation filed, oldest first. */
  watchTasks(sessionId: string, onChange: (tasks: BoardTask[]) => void): Unsubscribe;
  /** A task's run, by the session its row names, read only: the worker that runs it takes no messages. */
  watchRun(runSessionId: string, onChange: (steps: SessionStep[]) => void): Unsubscribe;
  /**
   * What `worker` did with one message it was sent: the turn in its own
   * conversation that read it, from the message to the turn's end, live.
   * Empty until the message is read.
   */
  watchExchange(worker: string, messageId: string, onChange: (steps: SessionStep[]) => void): Unsubscribe;
}

/** How often the reads with no stream are read again. */
const POLL_MS = 1_500;
/** The keyed item a conversation's board emits for each row it changes. */
const TASK_CHANGE = "task-change";
/** The tool a worker files a task with. */
const CREATE_TASK = "createTask";
/** The board's read of its rows, on a conversation's flow. */
const LIST_TASKS = "listTasks_tasks";
/** Requests that are a worker answering: everything but the board's own passes. */
const QUIET_ACTIONS = new Set(["dispatch"]);
/** The harness a run's items came from, by the block that emitted them: each harness block's own name, which the host keeps. */
const HARNESS_LABEL: Record<string, string> = { "claude-code-agent": "Claude Code", "codex-agent": "Codex", "cursor-agent": "Cursor" };

/** An item, read loosely: each read below checks the fields it uses. */
type Item = Record<string, any>;

/** The text of a message item. */
const textOf = (item: Item): string =>
  (Array.isArray(item.content) ? item.content : [])
    .map((part: { text?: unknown }) => (typeof part.text === "string" ? part.text : ""))
    .join("");

const parseArgs = (item: Item): Record<string, unknown> => {
  try {
    return JSON.parse(String(item.toolCall?.arguments ?? "{}")) as Record<string, unknown>;
  } catch {
    return {};
  }
};

/** The session resource the lab's history summary keeps; its public face carries the mark. */
const HISTORY_SUMMARY = "historySummary";

/** What the screen reads of where the worker's last turn began reading word for word. */
interface WindowRead {
  /** The first turn the window held, when earlier turns had left it. */
  historyStart?: string;
  /** The newest turn folded into the summary, once one was. */
  summarizedThrough?: string;
  /** Whether the summary covers every turn before its mark; one with a hole can't be called that. */
  summaryComplete?: boolean;
}

/**
 * The divider, from the items: before the first entry the worker read word
 * for word. That is the window's first turn, or the first turn after the
 * summary's mark when the summary reaches past it: the capability starts the
 * reads there, so no turn is read twice. Turns go in the order they started,
 * as history reads them: overlapping turns interleave their items, so the
 * summarized turn's last item can sit after a newer turn's first.
 */
export function windowMarkOf(items: readonly Item[], entries: readonly ConversationEntry[], read: WindowRead): WindowMark | undefined {
  const firstOf = (requestId: string) => items.findIndex((i) => i.requestId === requestId);
  const turns = [...new Set(items.map((i) => i.requestId))];
  /** The first item of the turn that started after `requestId`; past the end when none did. */
  const turnAfter = (requestId: string) => {
    const at = turns.indexOf(requestId);
    if (at < 0) return -1;
    const next = turns[at + 1];
    return next === undefined ? items.length : firstOf(next);
  };
  const start = read.historyStart === undefined ? -1 : firstOf(read.historyStart);
  const folded = read.summarizedThrough === undefined ? -1 : turnAfter(read.summarizedThrough);
  const from = Math.max(start, folded);
  if (from < 0) return undefined;
  const drawn = new Set(entries.map((e) => e.id));
  const first = items.slice(from).find((i) => drawn.has(i.id));
  return first === undefined ? undefined : { firstVerbatimEntryId: first.id, summarized: read.summaryComplete !== false && folded >= 0 && folded >= start };
}

/** Read `read` now and every `everyMs` until stopped; a failed read keeps the last value. */
function poll<T>(read: () => Promise<T>, onValue: (value: T) => void, everyMs = POLL_MS): Unsubscribe {
  let live = true;
  let last = "";
  const tick = async () => {
    try {
      const value = await read();
      const seen = JSON.stringify(value);
      if (live && seen !== last) {
        last = seen;
        onValue(value);
      }
    } catch (error) {
      console.error("teammates: a read failed", error);
    }
    if (live) timer = setTimeout(() => void tick(), everyMs);
  };
  let timer = setTimeout(() => void tick(), 0);
  return () => {
    live = false;
    clearTimeout(timer);
  };
}

/** The latest copy of each board row in a conversation's items, oldest filing first. */
function boardRows(items: readonly Item[]): Map<string, Record<string, any>> {
  const rows = new Map<string, Record<string, any>>();
  for (const item of items) {
    if (item.type === "component" && item.component === TASK_CHANGE && item.data?.task?.id) rows.set(item.data.task.id, item.data.task);
  }
  return rows;
}

/** What a row's spend says ran it: the harness and model its run reported, or nothing. */
function spendOf(row: Record<string, any>): { harness?: string; model?: string } {
  try {
    const view = taskSpendView(row as never);
    return { ...(view?.harness == null ? {} : { harness: view.harness }), ...(view?.model == null ? {} : { model: view.model }) };
  } catch {
    return {};
  }
}

/**
 * A board row as a task card.
 *
 * @param harnessOf A worker's `harness:` setting, for a coding task whose run hasn't reported one yet.
 */
function toBoardTask(row: Record<string, any>, harnessOf: (worker: string) => string | undefined = () => undefined): BoardTask {
  const error = typeof row.error === "string" ? row.error : undefined;
  const status: BoardTask["status"] =
    row.status === "completed" ? "done" : row.status === "errored" || row.status === "cancelled" ? "failed" : "running";
  const answer = typeof row.output?.answer === "string" ? row.output.answer : undefined;
  return {
    id: row.id,
    to: row.assignee ?? "",
    title: row.title ?? row.goal ?? row.id,
    status,
    ...((answer ?? error) === undefined ? {} : { result: answer ?? error }),
    ...(typeof row.run?.sessionId === "string" ? { runSessionId: row.run.sessionId } : {}),
    ...harnessAndModel(spendOf(row), harnessOf(row.assignee ?? "")),
  };
}

/** The harness by its name (the run's, else the worker's), and the run's model. */
function harnessAndModel(spend: { harness?: string; model?: string }, setting: string | undefined): { harness?: string; model?: string } {
  const harness = spend.harness ?? setting;
  return {
    ...(harness === undefined ? {} : { harness: harnessName(harness) }),
    ...(spend.model === undefined ? {} : { model: spend.model }),
  };
}

/** A conversation's items as the entries the screen draws. */
export function toEntries(items: readonly Item[], workers: ReadonlySet<string>): ConversationEntry[] {
  const rows = boardRows(items);
  const entries: ConversationEntry[] = [];
  for (const item of items) {
    if (item.type === "message" && item.role === "user") {
      entries.push({ kind: "user", id: item.id, text: textOf(item) });
    } else if (item.type === "message" && item.role === "assistant" && workers.has(item.agentName)) {
      // A task it filed ended: the board's line under the worker that ran it.
      const taskId = /\((task_[^)\s]+)\)/.exec(textOf(item))?.[1] ?? "";
      const row = rows.get(taskId);
      const task = row === undefined ? undefined : toBoardTask(row);
      // A line with no task id is a completed task's answer, said as is (`resultTo: "conversation"`).
      const failed = taskId !== "" && task?.status !== "done";
      entries.push({
        kind: "result",
        id: item.id,
        taskId,
        from: item.agentName,
        text: task?.result ?? textOf(item),
        ...(task?.title === undefined ? {} : { title: task.title }),
        ...(failed ? { failed: true } : {}),
      });
    } else if (item.type === "message" && item.role === "assistant") {
      const text = textOf(item);
      if (text.trim() !== "") entries.push({ kind: "assistant", id: item.id, text, ...(item.status === "in_progress" ? { streaming: true } : {}) });
    } else if (item.type === "tool_output" && item.toolCall?.name === SEND_MESSAGE_TOOL) {
      const args = parseArgs(item);
      const messageId = item.output?.sent ?? item.output?.callId;
      if (typeof messageId === "string" && typeof args.to === "string") {
        entries.push({ kind: "sent", id: item.id, messageId, to: args.to, text: String(args.text ?? "") });
      }
    } else if (item.type === "tool_output" && item.toolCall?.name === CREATE_TASK && item.output?.ok === true) {
      const args = parseArgs(item);
      entries.push({ kind: "task", id: item.id, taskId: item.output.taskId, title: String(args.title ?? args.goal ?? ""), to: String(args.assignee ?? "") });
    } else if (item.type === "suspension" && item.reason === "user_approval") {
      entries.push({ kind: "approval", id: item.id, requestId: item.requestId, suspensionId: item.suspensionId, text: item.message });
    } else if (item.type === "suspension_resume") {
      const asked = entries.find((e) => e.kind === "approval" && e.suspensionId === item.suspensionId);
      if (asked?.kind === "approval") asked.resolution = item.resolution;
    } else if (item.type === "component" && item.component === RECEIVED_MESSAGE_COMPONENT) {
      const { id, from, text, inReplyTo, noAnswer } = item.data ?? {};
      entries.push({ kind: "received", id: item.id, messageId: id, from, text, ...(inReplyTo === undefined ? {} : { inReplyTo }), ...(noAnswer === true ? { noAnswer: true } : {}) });
    }
  }
  return entries;
}

/**
 * Whether the worker is answering, from the conversation's items and the
 * requests the server lists as in progress. The list is read on a timer, so
 * it trails the items: an item of the newest request still being written is
 * an answer under way before the list says so, unless the requests already
 * show that request ended (`ended`): a failed or aborted turn leaves its
 * half-written item so for good. A finished answer does not end its request
 * here, since one request can answer more than once (a worker that drains its
 * own plan answers again); only the list does.
 */
export function answeringOf(items: readonly Item[], inProgress: readonly string[], ended: readonly string[] = []): boolean {
  // Only the newest request, or one the list names: an item a crashed turn left half-written stays so for good.
  const newest = items[items.length - 1]?.requestId;
  const live = (requestId: string) => inProgress.includes(requestId) || (requestId === newest && !ended.includes(requestId));
  return inProgress.length > 0 || items.some((i) => i.status === "in_progress" && live(i.requestId));
}

/** Who a `sendMessage` output went to, when it sent one: a wait-again or a refused call sent nothing. */
function sentTo(item: Item): string | undefined {
  const to = parseArgs(item).to;
  const messageId = item.output?.sent ?? item.output?.callId;
  return typeof messageId === "string" && typeof to === "string" ? to : undefined;
}

/**
 * A tool call as a step, in the UI registry's words: what it said it was doing,
 * else what it acted on ("Read …/src/a.ts", the command it ran), else the tool
 * it used. The same on every harness, since the registry names each one's tools.
 */
function toolStep(id: string, tool: string, args: Record<string, unknown>): SessionStep {
  const intent = toolIntent(tool, args);
  const subject = intent === undefined ? toolSubject(tool, args) : undefined;
  return { id, kind: "tool", tool, text: intent ?? subject?.text ?? `Used ${tool}`, ...(subject?.code ? { code: true } : {}) };
}

/** A session's items as a popup's steps: what it was given, what it wrote, and the tools it ran. */
export function toSteps(items: readonly Item[]): SessionStep[] {
  const steps: SessionStep[] = [];
  for (const item of items) {
    if (item.type === "message" && textOf(item).trim() !== "") {
      steps.push({ id: item.id, kind: item.role === "user" ? "given" : "said", text: textOf(item), ...(item.status === "in_progress" ? { streaming: true } : {}) });
    } else if (item.type === "component" && item.component === RECEIVED_MESSAGE_COMPONENT && typeof item.data?.text === "string") {
      steps.push({ id: item.id, kind: "given", text: item.data.text });
    } else if (item.type === "tool_output" && item.toolCall?.name === SEND_MESSAGE_TOOL && sentTo(item) !== undefined) {
      steps.push({ id: item.id, kind: "sent", text: String(parseArgs(item).text ?? ""), to: sentTo(item) ?? "" });
    } else if (item.type === "tool_output" && typeof item.toolCall?.name === "string") {
      steps.push(toolStep(item.id, item.toolCall.name, parseArgs(item)));
    }
  }
  return steps;
}

/** A coding run's items as steps: the harness it started on, once it reports, then what it did. */
export function runSteps(items: readonly Item[]): SessionStep[] {
  const block = items.find((i) => HARNESS_LABEL[i.provenance?.blockName ?? ""] !== undefined)?.provenance?.blockName;
  return [...(block === undefined ? [] : [{ id: "harness", kind: "harness" as const, text: `Started on ${HARNESS_LABEL[block]}` }]), ...toSteps(items)];
}

/** The session a message was delivered to, from the message log; undefined while the log doesn't hold it. */
export function destinationOf(rows: readonly unknown[], messageId: string): string | undefined {
  for (const row of rows) {
    const parsed = workerMessageRowSchema.safeParse(row);
    if (parsed.success && parsed.data.id === messageId) return parsed.data.toSession;
  }
  return undefined;
}

/**
 * The turn of a conversation that read message `messageId`, as steps: the
 * message, then all that turn did. The last receipt: a taker that died is
 * taken over, and the turn that took over is the one that answered.
 */
export function exchangeOf(items: readonly Item[], messageId: string): SessionStep[] {
  const read = [...items].reverse().find((i) => i.type === "component" && i.component === RECEIVED_MESSAGE_COMPONENT && i.data?.id === messageId);
  return read === undefined ? [] : toSteps(items.filter((i) => i.requestId === read.requestId));
}

/** A roster entry as the screen lists it. */
function toWorkerRow(w: RosterEntry): WorkerRow {
  return {
    id: w.id,
    name: w.name ?? w.id.slice(w.id.lastIndexOf(".") + 1),
    role: w.description ?? "",
    ...(w.flow === CODER_FLOW ? { takesTasks: true } : {}),
    ...(w.standard ? {} : { own: true }),
    ...(typeof w.settings?.harness === "string" ? { harness: w.settings.harness } : {}),
    ...(typeof w.settings?.icon === "string" ? { icon: w.settings.icon } : {}),
    ...(typeof w.settings?.color === "string" ? { color: w.settings.color } : {}),
  };
}

/** Who a worker's conversation's requests say it is: answering now, and when it last did anything. */
function activityOf(requests: readonly SessionRequestSummary[]): Activity {
  const answering = requests.filter((r) => !QUIET_ACTIONS.has(r.actionName));
  return {
    running: answering.some((r) => r.status === "in_progress"),
    lastActiveAt: Math.max(0, ...answering.map((r) => r.completedAtMs ?? r.failedAtMs ?? r.startedAtMs ?? 0)),
  };
}

/** The connection `fsdev dev` served this page with. */
function connect(): Client {
  return createClient({ userId: readUserId(), baseUrl: "", fetcher: withBearerToken(readBearerToken()) });
}

/** The adapter the app runs on: the package, through one client. */
export function createLabAdapter(client: Client = connect()): LabAdapter {
  const workforce: WorkforceClient = createWorkforceClient(client);
  const feeds = sessionFeeds(client);
  /** Each worker's conversation, and the flow it runs on, once opened. */
  const conversations = new Map<string, { sessionId: string; flow: string }>();
  const flowOfSession = new Map<string, string>();
  /** The workers, by id, so a line under a worker's name reads as a task's ending. */
  let workerIds = new Set<string>();
  /** Each coding worker's `harness:`, from the last roster read. */
  let harnesses = new Map<string, string>();

  const conversationOf = async (worker: string) => {
    const known = conversations.get(worker);
    if (known !== undefined) return known;
    const session = await workforce.ensureWorkerSession({ worker });
    const opened = { sessionId: session.id, flow: session.flowKind };
    conversations.set(worker, opened);
    flowOfSession.set(session.id, session.flowKind);
    return opened;
  };

  /** Any conversation of the user's: the message log is read through one. */
  const anyConversation = async () => conversations.values().next().value ?? (await conversationOf((await workforce.roster()).find((w) => w.flow !== CODER_FLOW)!.id));

  const watchFeed = <T>(sessionId: string, map: (items: Item[]) => T, onChange: (value: T) => void): Unsubscribe =>
    (feeds(sessionId) as SessionFeed).watch((items: readonly OutputItem[]) => onChange(map(items as unknown as Item[])));

  return {
    async listWorkers() {
      const roster = await workforce.roster();
      workerIds = new Set(roster.map((w) => w.id));
      harnesses = new Map(roster.flatMap((w) => (typeof w.settings?.harness === "string" ? [[w.id, w.settings.harness] as const] : [])));
      return roster.map(toWorkerRow);
    },
    async openConversation(worker) {
      return (await conversationOf(worker)).sessionId;
    },
    async send(sessionId, text) {
      const flow = flowOfSession.get(sessionId);
      if (flow === undefined) throw new Error(`teammates: ${sessionId} is not an open conversation`);
      // Streamed, so the answer shows as it is written (the session stream sends it once finished).
      const response = await client.flow(flow).send("respond", { message: text }, { sessionId, stream: true });
      if (!response.ok) throw new Error(`teammates: the send was refused (${response.status})`);
      if (response.headers.get("content-type")?.includes("text/event-stream")) feeds(sessionId).followResponse(response);
    },
    async answerApproval(sessionId, approval, approve) {
      const flow = flowOfSession.get(sessionId);
      if (flow === undefined) throw new Error(`teammates: ${sessionId} is not an open conversation`);
      await client.flow(flow).request(approval.requestId).answer({ suspensionId: approval.suspensionId, action: approve ? "approve" : "reject" });
    },
    watchConversation(sessionId, onChange) {
      let entries: ConversationEntry[] = [];
      let items: Item[] = [];
      let inProgress: string[] = [];
      let ended: string[] = [];
      let shown: ConversationView | undefined;
      // Unchanged entries keep their objects, so a streamed chunk redraws only the growing one.
      const reuse = stableList<ConversationEntry>((next) => {
        entries = next;
      });
      const emit = () => {
        const running = answeringOf(items, inProgress, ended);
        if (shown?.entries === entries && shown.running === running) return;
        shown = { entries, running };
        onChange(shown);
      };
      const stopFeed = watchFeed(sessionId, (next) => next, (next) => {
        items = next;
        reuse(toEntries(items, workerIds));
        emit();
      });
      const stopPoll = poll(
        () => client.sessions.requests(sessionId, { limit: 20 }),
        (requests) => {
          const answering = requests.filter((r) => !QUIET_ACTIONS.has(r.actionName));
          inProgress = answering.filter((r) => r.status === "in_progress").map((r) => r.id);
          ended = requests.filter((r) => r.status !== "in_progress").map((r) => r.id);
          emit();
        },
      );
      return () => {
        stopFeed();
        stopPoll();
      };
    },
    watchTalk(worker, onChange) {
      return poll(
        async () => {
          const { sessionId } = await anyConversation();
          const rows = await readEveryCollectionPage(client.resources, sessionId, WORKER_MESSAGES_RESOURCE);
          return rows
            .map((row) => workerMessageRowSchema.safeParse(row.clientData))
            .flatMap((parsed) => (parsed.success ? [parsed.data] : []))
            .filter((m) => m.from === worker || m.to === worker)
            .sort((a, b) => a.at - b.at)
            .map((m) => ({
              id: m.id,
              from: m.from,
              to: m.to,
              text: m.text,
              at: m.at,
              ...(m.inReplyTo === undefined ? {} : { inReplyTo: m.inReplyTo }),
              ...(m.replyRequested === true ? { replyRequested: true } : {}),
              ...(m.call === true && m.repliedAt !== undefined ? { callAnswered: true } : {}),
              ...(m.noAnswer === true ? { noAnswer: true } : {}),
              ...(m.status === "refused" || m.status === "undeliverable" ? { undelivered: true } : {}),
            }));
        },
        onChange,
      );
    },
    watchActivity(worker, onChange) {
      return poll(async () => {
        const known = conversations.get(worker);
        // A worker that takes tasks only has no conversation: it is busy while a run it was handed is.
        if (known === undefined) return { running: false, lastActiveAt: 0 };
        return activityOf(await client.sessions.requests(known.sessionId, { limit: 20 }));
      }, onChange);
    },
    watchWindow(sessionId, onChange) {
      let items: Item[] = [];
      let read: WindowRead = {};
      let last = "";
      const emit = () => {
        const mark = windowMarkOf(items, toEntries(items, workerIds), read);
        const seen = JSON.stringify(mark ?? null);
        if (seen === last) return;
        last = seen;
        onChange(mark);
      };
      const stopFeed = watchFeed(sessionId, (next) => next, (next) => {
        items = next;
        emit();
      });
      const stopPoll = poll(
        async (): Promise<WindowRead> => {
          // The latest turn of the worker's own, by when it started: its window is the one the worker read last.
          const answering = (await client.sessions.requests(sessionId, { limit: 20 })).filter((r) => !QUIET_ACTIONS.has(r.actionName));
          const latest = answering.reduce<SessionRequestSummary | undefined>((a, r) => (a === undefined || (r.startedAtMs ?? 0) > (a.startedAtMs ?? 0) ? r : a), undefined);
          const summary = (await client.sessions.state(sessionId, { includeItems: false })).resources?.session?.[HISTORY_SUMMARY] as
            | { clientData?: { throughRequestId?: string | null; complete?: boolean } }
            | undefined;
          const through = summary?.clientData?.throughRequestId;
          return {
            ...(latest?.historyStart == null ? {} : { historyStart: latest.historyStart.requestId }),
            // The worker reads after the mark whether or not the summary has a hole; a hole only changes the label.
            ...(through == null ? {} : { summarizedThrough: through, summaryComplete: summary?.clientData?.complete === true }),
          };
        },
        (next) => {
          read = next;
          emit();
        },
      );
      return () => {
        stopFeed();
        stopPoll();
      };
    },
    async hire({ name, role, instructions }) {
      const written = await workforce.hire({ id: name, description: role, instructions });
      const hired = (await workforce.roster()).find((w) => w.id === written.id && !w.standard);
      if (hired === undefined) throw new Error(`teammates: "${name}" was hired but isn't on the roster`);
      workerIds.add(hired.id);
      return toWorkerRow(hired);
    },
    async editInstructions(worker, instructions) {
      await workforce.edit({ id: worker, instructions });
    },
    async fire(worker) {
      await workforce.fire(worker);
      conversations.delete(worker);
    },
    watchTasks(sessionId, onChange) {
      const show = stableList(onChange);
      let rows = new Map<string, Record<string, any>>();
      /** The run each running row's last board read named, by task id. */
      const runs = new Map<string, unknown>();
      let stopRead: Unsubscribe | undefined;
      const publish = () => show([...rows.values()].map((row) => toBoardTask(row.run == null && runs.has(row.id) ? { ...row, run: runs.get(row.id) } : row, (worker) => harnesses.get(worker))));
      // A run links itself on its own session, so the conversation hears of it only when the task ends:
      // while a running row names no run, the board is read until it does, and the run's steps show as they happen.
      const readWhileUnlinked = () => {
        const unlinked = [...rows.values()].some((row) => row.status !== "completed" && row.status !== "errored" && row.status !== "cancelled" && row.run == null && !runs.has(row.id));
        if (!unlinked) {
          stopRead?.();
          stopRead = undefined;
        } else if (stopRead === undefined) {
          stopRead = poll(
            async () => {
              const flow = flowOfSession.get(sessionId) ?? (await client.sessions.get(sessionId)).flowKind;
              const listed = await client.flow(flow).read<{ ok: boolean; error?: string; tasks: Array<Record<string, any>> }>(LIST_TASKS, {}, { sessionId });
              if (!listed.ok) throw new Error(listed.error);
              return listed.tasks.flatMap((task) => (task.run?.sessionId === undefined ? [] : [[task.id as string, task.run] as const]));
            },
            (linked) => {
              for (const [id, run] of linked) runs.set(id, run);
              publish();
              readWhileUnlinked();
            },
          );
        }
      };
      const stopFeed = watchFeed(sessionId, boardRows, (read) => {
        rows = read;
        publish();
        readWhileUnlinked();
      });
      return () => {
        stopFeed();
        stopRead?.();
      };
    },
    watchRun(runSessionId, onChange) {
      return watchFeed(runSessionId, runSteps, stableList(onChange));
    },
    watchExchange(worker, messageId, onChange) {
      let stop: Unsubscribe | undefined;
      let live = true;
      void (async () => {
        // A reply lands where the message it answers was sent from, a task's session included: the log row says where.
        // A failed log read falls back to the recipient's conversation rather than leaving the popup unwatched.
        const rows = await anyConversation()
          .then(({ sessionId: logSession }) => readEveryCollectionPage(client.resources, logSession, WORKER_MESSAGES_RESOURCE))
          .catch(() => []);
        const sessionId = destinationOf(rows.map((row) => row.clientData), messageId) ?? (await conversationOf(worker)).sessionId;
        if (!live) return;
        stop = watchFeed(sessionId, (items) => exchangeOf(items, messageId), stableList(onChange));
      })();
      return () => {
        live = false;
        stop?.();
      };
    },
  };
}
