/**
 * The lab's one way in and out. Every read and write the screen makes goes
 * through `LabAdapter`, and nothing else in `src/` touches a package. Each
 * function is bound to the package call it stands for:
 *
 * | Function            | Bound to                                                                     |
 * |---------------------|------------------------------------------------------------------------------|
 * | `listWorkers`       | the workforce client's `roster()`                                            |
 * | `openConversation`  | `ensureWorkerSession({ worker })`: the worker's default conversation         |
 * | `send`              | the worker's door, `respond`, in that conversation                           |
 * | `watchConversation` | the session's items, from its snapshot and then its stream                   |
 * | `watchTalk`         | the user's message log (`workforceMessages`), as `sendMessage` writes it     |
 * | `watchActivity`     | `listSessionRequests` on the worker's conversation                           |
 * | `watchWindow`       | the mark the history window leaves: gap G1 (FIX-1613), not yet in the package |
 * | `listProjects`      | the user's projects, read through their roster session                       |
 * | `watchWorkProject`  | the conversation's `workProjectId`, from the session read                    |
 * | `setWorkProject`    | the workforce client's `setWorkProject(worker, project)`                     |
 * | `watchTasks`        | the board's rows, as the conversation's stream carries each one (`task-change`) |
 * | `watchRun`          | the items of the session the task's row names as its run                     |
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
  parseProjectRef,
  RECEIVED_MESSAGE_COMPONENT,
  ROSTER_FLOW,
  SEND_MESSAGE_TOOL,
  SET_WORK_PROJECT_ACTION,
  WORK_PROJECT_STATE_KEY,
  WORKER_MESSAGES_RESOURCE,
  workerMessageRowSchema,
  type WorkforceClient,
} from "@flow-state-dev/workforce/browser";
import { CODER_FLOW } from "./lib/coder-flow";
import { sessionFeeds, type SessionFeed } from "./lib/session-feed";

/** Stops a watch. */
export type Unsubscribe = () => void;

/** One worker on the roster. */
export interface WorkerRow {
  /** The worker's address on the roster, e.g. `teammates.lead`. */
  id: string;
  /** The name the user reads. */
  name: string;
  /** Its `WORKER.md` description: the ongoing role. */
  role: string;
  /** It takes tasks only: it has no conversation, and work reaches it as a task. */
  takesTasks?: boolean;
}

/** One of the user's projects: where a worker's runs get their files. */
export interface ProjectRow {
  id: string;
  name: string;
}

/**
 * A task a conversation filed for a worker that takes tasks, from the board's
 * row. `needs-project` is a run refused `no-project` before any file existed.
 */
export interface BoardTask {
  id: string;
  /** The worker it was filed for. */
  to: string;
  title: string;
  status: "needs-project" | "running" | "done" | "failed";
  /** The project its run works in; none when it was refused. */
  project?: string;
  /** What the run reported when it ended, or why it failed. */
  result?: string;
  /** The session its run works in, once it started. */
  runSessionId?: string;
}

/** One step of a task's run, as the harness reported it. */
export interface RunStep {
  id: string;
  text: string;
}

/** One entry of a worker's conversation, in the order it happened. */
export type ConversationEntry =
  | { kind: "user"; id: string; text: string; queued?: boolean }
  | { kind: "assistant"; id: string; text: string }
  /** The worker messaged another worker (`sendMessage`). */
  | { kind: "sent"; id: string; messageId: string; to: string; text: string }
  /** A message another worker sent, as the `receive` turn that read it. */
  | { kind: "received"; id: string; messageId: string; from: string; text: string; inReplyTo?: string }
  /** The worker filed a task; the card reads the board's row by its id. */
  | { kind: "task"; id: string; taskId: string }
  /** A task it filed ended, as a line under the name of the worker that ran it. */
  | { kind: "result"; id: string; taskId: string; from: string; text: string; failed?: boolean };

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
  /** Every message to or from `worker`, oldest first. */
  watchTalk(worker: string, onChange: (rows: TalkRow[]) => void): Unsubscribe;
  watchActivity(worker: string, onChange: (activity: Activity) => void): Unsubscribe;
  /** `undefined` while the whole conversation is inside the window. */
  watchWindow(sessionId: string, onChange: (mark: WindowMark | undefined) => void): Unsubscribe;
  listProjects(): Promise<ProjectRow[]>;
  /** The project `worker`'s runs work in; `undefined` until one is picked. */
  watchWorkProject(worker: string, onChange: (project: string | undefined) => void): Unsubscribe;
  setWorkProject(worker: string, project: string): Promise<void>;
  /** The tasks a conversation filed, oldest first. */
  watchTasks(sessionId: string, onChange: (tasks: BoardTask[]) => void): Unsubscribe;
  /** A task's run, by the session its row names, read only: the worker that runs it takes no messages. */
  watchRun(runSessionId: string, onChange: (steps: RunStep[]) => void): Unsubscribe;
}

/** How often the reads with no stream are read again. */
const POLL_MS = 1_500;
/** The accessor the user's shared projects are read under, on their roster session. */
const PROJECTS = "projects";
/** The keyed item a conversation's board emits for each row it changes. */
const TASK_CHANGE = "task-change";
/** The tool a worker files a task with. */
const CREATE_TASK = "createTask";
/** Requests that are a worker answering: everything but the board's own passes and the project write. */
const QUIET_ACTIONS = new Set(["dispatch", SET_WORK_PROJECT_ACTION]);
/** The harness a run's items came from, by the block that emitted them. */
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

/** Read `read` now and every {@link POLL_MS} until stopped; a failed read keeps the last value. */
function poll<T>(read: () => Promise<T>, onValue: (value: T) => void): Unsubscribe {
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
    if (live) timer = setTimeout(() => void tick(), POLL_MS);
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

/** A board row as a task card. A run refused `no-project` is one that waits for a project. */
function toBoardTask(row: Record<string, any>): BoardTask {
  const filedIn = row.metadata?.filedInProject;
  const project = typeof filedIn === "string" ? filedIn.slice(filedIn.indexOf("/") + 1) : undefined;
  const error = typeof row.error === "string" ? row.error : undefined;
  const status: BoardTask["status"] =
    row.status === "completed"
      ? "done"
      : row.status === "errored" || row.status === "cancelled"
        ? error?.includes("(no-project)")
          ? "needs-project"
          : "failed"
        : "running";
  const answer = typeof row.output?.answer === "string" ? row.output.answer : undefined;
  return {
    id: row.id,
    to: row.assignee ?? "",
    title: row.title ?? row.goal ?? row.id,
    status,
    ...(project === undefined ? {} : { project }),
    ...((answer ?? error) === undefined ? {} : { result: answer ?? error }),
    ...(typeof row.run?.sessionId === "string" ? { runSessionId: row.run.sessionId } : {}),
  };
}

/** A conversation's items as the entries the screen draws. */
function toEntries(items: readonly Item[], workers: ReadonlySet<string>): ConversationEntry[] {
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
      entries.push({ kind: "result", id: item.id, taskId, from: item.agentName, text: task?.result ?? textOf(item), ...(task?.status === "done" ? {} : { failed: true }) });
    } else if (item.type === "message" && item.role === "assistant") {
      const text = textOf(item);
      if (text.trim() !== "") entries.push({ kind: "assistant", id: item.id, text });
    } else if (item.type === "tool_output" && item.toolCall?.name === SEND_MESSAGE_TOOL) {
      const args = parseArgs(item);
      const messageId = item.output?.sent ?? item.output?.callId;
      if (typeof messageId === "string" && typeof args.to === "string") {
        entries.push({ kind: "sent", id: item.id, messageId, to: args.to, text: String(args.text ?? "") });
      }
    } else if (item.type === "tool_output" && item.toolCall?.name === CREATE_TASK && item.output?.ok === true) {
      entries.push({ kind: "task", id: item.id, taskId: item.output.taskId });
    } else if (item.type === "component" && item.component === RECEIVED_MESSAGE_COMPONENT) {
      const { id, from, text, inReplyTo } = item.data ?? {};
      entries.push({ kind: "received", id: item.id, messageId: id, from, text, ...(inReplyTo === undefined ? {} : { inReplyTo }) });
    }
  }
  return entries;
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

/**
 * The project a conversation works in, as the screen names it: the id of the
 * `workProjectId` its session read shows. The screen lists only shared
 * projects, so it joins on visibility and id both, and a private one names none.
 */
export function workProjectOf(state: Readonly<Record<string, unknown>> | undefined): string | undefined {
  const stored = state?.[WORK_PROJECT_STATE_KEY];
  const ref = typeof stored === "string" ? parseProjectRef(stored) : undefined;
  return ref?.visibility === "shared" ? ref.id : undefined;
}

/**
 * `onChange`, called only when the value differs from the one it last passed on. A
 * watch fed both by reads and by a pick made on this page compares with what the
 * screen shows, not with the last read: a change made elsewhere back to that read
 * still reaches the screen.
 */
export function shownOnChange<T>(onChange: (value: T) => void): (value: T) => void {
  let shown: { value: T } | undefined;
  return (value) => {
    if (shown !== undefined && shown.value === value) return;
    shown = { value };
    onChange(value);
  };
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
  /** Each shared project's visibility, as listed. */
  const visibility = new Map<string, "shared" | "private">();
  /** Who watches each worker's project, told at once when a pick here is stored. */
  const projectWatchers = new Map<string, Set<(project: string | undefined) => void>>();

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
      return roster.map((w) => ({
        id: w.id,
        name: w.name ?? w.id.slice(w.id.lastIndexOf(".") + 1),
        role: w.description ?? "",
        ...(w.flow === CODER_FLOW ? { takesTasks: true } : {}),
      }));
    },
    async openConversation(worker) {
      return (await conversationOf(worker)).sessionId;
    },
    async send(sessionId, text) {
      const flow = flowOfSession.get(sessionId);
      if (flow === undefined) throw new Error(`teammates: ${sessionId} is not an open conversation`);
      await client.flow(flow).send("respond", { message: text }, { sessionId });
    },
    watchConversation(sessionId, onChange) {
      let entries: ConversationEntry[] = [];
      let running = false;
      const emit = () => onChange({ entries, running });
      const stopFeed = watchFeed(sessionId, (items) => toEntries(items, workerIds), (next) => {
        entries = next;
        emit();
      });
      const stopPoll = poll(
        () => client.sessions.requests(sessionId, { status: "in_progress" }),
        (requests) => {
          running = activityOf(requests).running;
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
    watchWindow(_sessionId, onChange) {
      // G1 (FIX-1613): the package leaves no mark yet, so no divider is drawn.
      onChange(undefined);
      return () => {};
    },
    async listProjects() {
      // Reading the roster opens the user's roster session, where their projects are kept.
      await workforce.roster();
      const roster = (await client.sessions.list({ flowKind: ROSTER_FLOW, userId: client.userId }))[0];
      if (roster === undefined) return [];
      const rows = await readEveryCollectionPage(client.resources, roster.id, PROJECTS);
      return rows.flatMap((row) => {
        const project = row.clientData as { id?: string; title?: string; members?: string[] } | undefined;
        if (typeof project?.id !== "string" || !(project.members ?? []).includes(client.userId)) return [];
        visibility.set(project.id, "shared");
        return [{ id: project.id, name: project.title ?? project.id }];
      });
    },
    watchWorkProject(worker, onChange) {
      // The project stored on the conversation, whoever set it: the session read shows it, read only.
      // A pick here shows at once, so each read is checked against what was last shown.
      const show = shownOnChange(onChange);
      const watchers = projectWatchers.get(worker) ?? new Set();
      projectWatchers.set(worker, watchers);
      watchers.add(show);
      let reads = 0;
      const stop = poll(async () => {
        const { sessionId } = await conversationOf(worker);
        // Numbered, so `poll` passes every read on rather than only a changed one.
        return { read: reads++, project: workProjectOf((await client.sessions.get(sessionId)).state) };
      }, ({ project }) => show(project));
      return () => {
        watchers.delete(show);
        stop();
      };
    },
    async setWorkProject(worker, project) {
      await workforce.setWorkProject(worker, { visibility: visibility.get(project) ?? "shared", id: project });
      // Stored: say so now rather than on the next read, which confirms it.
      for (const watcher of projectWatchers.get(worker) ?? []) watcher(project);
    },
    watchTasks(sessionId, onChange) {
      return watchFeed(sessionId, (items) => [...boardRows(items).values()].map(toBoardTask), onChange);
    },
    watchRun(runSessionId, onChange) {
      return watchFeed(runSessionId, (items) => {
        const steps: RunStep[] = [];
        const block = items.find((i) => HARNESS_LABEL[i.provenance?.blockName ?? ""] !== undefined)?.provenance?.blockName;
        if (block !== undefined) steps.push({ id: "harness", text: `on ${HARNESS_LABEL[block]}` });
        for (const item of items) {
          if (item.type === "message" && item.role === "assistant" && textOf(item).trim() !== "") steps.push({ id: item.id, text: textOf(item) });
          else if (item.type === "tool_output" && typeof item.toolCall?.name === "string") steps.push({ id: item.id, text: item.toolCall.name });
        }
        return steps;
      }, onChange);
    },
  };
}
