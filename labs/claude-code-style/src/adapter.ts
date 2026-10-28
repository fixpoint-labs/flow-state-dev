/**
 * The lab's one way in and out. Every read and write the screen makes goes
 * through `LabAdapter`, and nothing else in `src/` touches a package.
 *
 * Each verb is bound to a public package call (`createLabAdapter`):
 *
 * | Verb            | Package call                                                              |
 * |-----------------|---------------------------------------------------------------------------|
 * | `watchSessions` | the workforce client's `listWorkerSessions`, for each built mode's worker |
 * | `listProjects`  | the project blocks' `listProjects`: only projects the user may work in    |
 * | `createProject` | the project blocks' `createProject`, a private project on a repository   |
 * | `openSession`   | a new session on the mode's main worker, then `setWorkProject`            |
 * | `send`          | the worker's door, `respond`, in that session                             |
 * | `interrupt`     | aborting the session's running request                                     |
 * | `watchThread`   | the session's items, read again while it is open                          |
 * | `watchTasks`    | the conversation board's `listTasks_tasks` rows                           |
 * | `watchTaskWork` | the items of a task's run session, read only                               |
 *
 * Threads mode's verbs (`sayInThread`, `resolve`, `requestChanges`, pins) are
 * not bound yet, so `modes` names session mode only and the Projects view
 * shows disabled.
 */
import { createClient, type Client, type SessionSummary } from "@flow-state-dev/client";
import { readBearerToken, readUserId, withBearerToken } from "@flow-state-dev/devtool/react";
import {
  createWorkforceClient,
  parseProjectRef,
  projectRef,
  WORK_PROJECT_STATE_KEY,
  WORKER_ID_STATE_KEY,
} from "@flow-state-dev/workforce/browser";
import { modeById, MODES, type ModeId } from "./modes";
import { projectIdOf, refuseExisting } from "./lib/new-project";

/** Stops a watch. */
export type Unsubscribe = () => void;

/** One row of the sessions list. */
export interface SessionRow {
  id: string;
  title: string;
  /** The session's main worker; its mode is read from it (`modeOfWorker`). */
  worker: string;
  /** When the session last changed, in ms. */
  updatedAt: number;
  /** A turn is running in it now. */
  running: boolean;
  /** The project the session works in (spec D3), or null when it has none and must ask. */
  projectId: string | null;
}

/** A project a session can work in: its checkout is where the session's tasks run. */
export interface ProjectRow {
  id: string;
  name: string;
}

/** One entry in a thread, in the order it happened, with the request it came from when known. */
export type ThreadEntry = (
  | {
      kind: "user";
      id: string;
      text: string;
      queued?: boolean;
      /** Threads mode: the lead's turn filed threads for this line. */
      sentToThread?: boolean;
    }
  | { kind: "assistant"; id: string; text: string }
  | { kind: "tool"; id: string; name: string; summary: string }
  | {
      kind: "result";
      id: string;
      taskId: string;
      title: string;
      status: TaskStatus;
      summary: string;
      /** The main session took it while a turn was running (step 4). */
      duringTurn: boolean;
    }
  | { kind: "interrupted"; id: string }
  /** Threads mode: a thread the lead filed, where its `createTask` call is. The card reads the task row. */
  | { kind: "thread"; id: string; taskId: string }
) & { requestId?: string };

/** What a thread shows now. */
export interface ThreadView {
  entries: ThreadEntry[];
  running: boolean;
  /** When the running turn started, in ms. */
  turnStartedAt?: number;
  /** The running turn's request. */
  requestId?: string;
}

/** A task's status, as the task tools name it. */
export type TaskStatus = "pending" | "in_progress" | "held" | "completed" | "errored" | "cancelled";

/** One background task, as a `listTasks` row carries it. */
export interface TaskRow {
  id: string;
  title: string;
  goal: string;
  status: TaskStatus;
  assignee?: string;
  /** The worker's last one-line progress note. */
  statusNote?: string;
  /** What the task waits on you for: a question it holds on, or its run's stop for your approval or review. */
  waitingOn?: { kind: "approval" | "input" | "review" | "question"; prompt: string };
  /** The coding harness the assignee runs through, from its `harness` setting; none for a plain worker. */
  harness?: string;
  /**
   * How a harness run's review ended, from its output: `accepted` when you
   * resolved it, `deadline` when nobody answered by the review deadline
   * and it completed unreviewed, none when no review was asked.
   */
  review?: "accepted" | "deadline" | null;
  /** Steps done of total, when known. */
  steps?: { done: number; total: number };
  /** When the task last changed, in ms. */
  updatedAt?: number;
}

/** The read-only work of one task. */
export interface TaskWork {
  entries: ThreadEntry[];
}

/** Everything the screen reads and writes. */
export interface LabAdapter {
  /** The modes this adapter runs; the view switch shows the others disabled. */
  readonly modes: readonly ModeId[];
  watchSessions(onChange: (rows: SessionRow[]) => void): Unsubscribe;
  listProjects(): Promise<ProjectRow[]>;
  /** A new project of yours on a git repository, which you may then work in. */
  createProject(name: string, repository: string): Promise<ProjectRow>;
  openSession(mode: ModeId, projectId: string): Promise<SessionRow>;
  send(sessionId: string, text: string): Promise<void>;
  interrupt(sessionId: string): Promise<void>;
  watchThread(sessionId: string, onChange: (view: ThreadView) => void): Unsubscribe;
  watchTasks(sessionId: string, onChange: (rows: TaskRow[]) => void): Unsubscribe;
  watchTaskWork(sessionId: string, taskId: string, onChange: (work: TaskWork) => void): Unsubscribe;
  /** Talk inside a thread: a steer on its task, which answers its open question if it has one. */
  sayInThread(sessionId: string, taskId: string, line: string): Promise<void>;
  /** Accept a thread's work: answers its review wait. */
  resolve(sessionId: string, taskId: string): Promise<void>;
  /** Send a thread back to work: answers its review wait with your words. */
  requestChanges(sessionId: string, taskId: string, words: string): Promise<void>;
  /** Your pinned task ids. */
  watchPins(onChange: (taskIds: string[]) => void): Unsubscribe;
  pin(taskId: string): Promise<void>;
  unpin(taskId: string): Promise<void>;
}

/** How often an open view reads again, in ms. */
const READ_EVERY_MS = 1500;

/**
 * How long the tasks pane keeps listing after the board last could move. `listTasks` is an
 * action, so each list is a request the server records; the pane lists only while a turn
 * runs or a task is open, and for this long after.
 */
const TASKS_TAIL_MS = 10_000;

/** The statuses a task can still move from. */
const OPEN_TASK = new Set<TaskStatus>(["pending", "in_progress", "held"]);

/** The requests that are a turn of the main session: a user's line, or a background result after the turn. */
const TURN_ACTIONS = new Set(["respond", "onTaskSettled"]);

/** The item types a thread draws. */
const THREAD_ITEMS = ["message", "tool_output"];

/** One stored item, as far as the thread reads it. */
interface Item {
  id: string;
  type: string;
  role?: string;
  requestId?: string;
  agentName?: string;
  blockName?: string;
  content?: { type: string; text?: string }[];
  output?: unknown;
}

/**
 * How the settled notice the main session takes names a task and its ending: orchestration's
 * `noticeText` (`tasks/notice/task-notice.ts`), where a cancel may add "; it cancelled …".
 */
const RESULT_LINE = /^Task "([\s\S]+?)" \(([^)\s]+)\) (completed by [^:]+|failed for good with [^:]+|was cancelled)(?:[:;] ([\s\S]*))?$/;

/**
 * Read `read` now and every `everyMs`, reporting a value only when it
 * changed. A failed read is logged and tried again on the next tick.
 */
function every<T>(read: () => Promise<T>, onChange: (value: T) => void, everyMs = READ_EVERY_MS): Unsubscribe {
  let live = true;
  let last: string | undefined;
  let timer: ReturnType<typeof setTimeout>;
  const tick = async () => {
    try {
      const value = await read();
      const key = JSON.stringify(value);
      if (live && key !== last) {
        last = key;
        onChange(value);
      }
    } catch (error) {
      console.warn("[claude-code-style]", error);
    }
    if (live) timer = setTimeout(tick, everyMs);
  };
  timer = setTimeout(tick, 0);
  return () => {
    live = false;
    clearTimeout(timer);
  };
}

const textOf = (item: Item) => (item.content ?? []).map((part) => part.text ?? "").join("");

/** One line for a tool call's output: a task's id when it names one, else the start of what it said. */
function summaryOf(output: unknown): string {
  if (typeof output === "object" && output !== null && "taskId" in output) return String(output.taskId);
  const text = typeof output === "string" ? output : JSON.stringify(output ?? null);
  return text.split("\n")[0]!.slice(0, 120);
}

/** A thread's entries, from its items in order. A result is the line the main session took a task's ending as. */
function entriesOf(items: readonly Item[]): ThreadEntry[] {
  // A turn a user's line started holds that line; a notice's own turn holds none.
  const userTurns = new Set(items.filter((item) => item.type === "message" && item.role === "user").map((item) => item.requestId));
  const entries: ThreadEntry[] = [];
  for (const item of items) {
    const requestId = item.requestId;
    if (item.type === "tool_output") {
      entries.push({ kind: "tool", id: item.id, name: item.blockName ?? "tool", summary: summaryOf(item.output), requestId });
      continue;
    }
    const text = textOf(item);
    if (item.role === "user") {
      entries.push({ kind: "user", id: item.id, text, requestId });
      continue;
    }
    const result = RESULT_LINE.exec(text);
    if (result !== null) {
      const [, title, taskId, ending, summary] = result;
      const status: TaskStatus = ending!.startsWith("completed") ? "completed" : ending!.startsWith("failed") ? "errored" : "cancelled";
      entries.push({
        kind: "result",
        id: item.id,
        taskId: taskId!,
        title: title!,
        status,
        summary: summary ?? text,
        duringTurn: userTurns.has(requestId),
        requestId,
      });
      continue;
    }
    if (text.length > 0) entries.push({ kind: "assistant", id: item.id, text, requestId });
  }
  return entries;
}

/** The adapter the app runs on: the served lab, as the user the page was served for. */
export function createLabAdapter(): LabAdapter {
  return createWiredLab(createClient({ userId: readUserId(), baseUrl: "", fetcher: withBearerToken(readBearerToken()) }));
}

/** The adapter over one client. */
function createWiredLab(fsd: Client): LabAdapter {
  const workforce = createWorkforceClient(fsd);
  const modes = MODES.filter((mode) => mode.id === "session");
  const flows = new Map<string, Promise<string>>();
  /** The flow a worker's sessions run on, from the roster. */
  const flowOf = (worker: string) => {
    if (!flows.has(worker)) {
      flows.set(
        worker,
        workforce.roster().then((roster) => {
          const found = roster.find((entry) => entry.id === worker);
          if (found === undefined) throw new Error(`No worker "${worker}" on your roster.`);
          return found.flow;
        }),
      );
    }
    return flows.get(worker)!;
  };
  /** The flow a session runs on. */
  const flowOfSession = async (sessionId: string) => (await fsd.sessions.get(sessionId)).flowKind;

  /** Run one action in a session and hand back its output, or throw why it failed. */
  const run = async (flow: string, sessionId: string, action: string, input: unknown): Promise<any> => {
    const started = await fsd.flow(flow).send(action, input, { sessionId });
    const { status } = await started.wait();
    const found = (await fsd.sessions.requests(sessionId, { includeResultOutput: true, limit: 20 })).find((r) => r.id === started.id);
    if (status !== "completed") throw new Error(found?.result?.error?.message ?? `${action} ended ${status}`);
    const output = found?.result?.output as { ok?: boolean; error?: string } | undefined;
    if (output?.ok === false) throw new Error(output.error);
    return output;
  };

  /** The user's one session on the projects flow, found or made once. */
  let projectsSession: Promise<string> | undefined;
  const projects = () =>
    (projectsSession ??= (async () => {
      const [latest] = (await fsd.sessions.list({ flowKind: "projects", userId: fsd.userId })).sort((a, b) => b.updatedAt - a.updatedAt);
      return latest?.id ?? (await fsd.flow("projects").createSession()).id;
    })());

  /** The turns running in a session, oldest first. */
  const runningTurns = async (sessionId: string) =>
    (await fsd.sessions.requests(sessionId, { status: "in_progress", limit: 50 }))
      .filter((request) => TURN_ACTIONS.has(request.actionName))
      .sort((a, b) => (a.startedAtMs ?? 0) - (b.startedAtMs ?? 0));

  /** Every item of a session of the types a thread draws, every page. */
  const itemsOf = async (sessionId: string): Promise<Item[]> => {
    const items: Item[] = [];
    for (let offset = 0; ; ) {
      const page = (await fsd.sessions.state(sessionId, { includeItems: true, itemTypes: THREAD_ITEMS, offset, limit: 100 })) as {
        items?: Item[];
        pagination?: { hasMore: boolean; nextOffset: number };
      };
      items.push(...(page.items ?? []));
      if (page.pagination?.hasMore !== true) return items;
      offset = page.pagination.nextOffset;
    }
  };

  /** A session's title: its first line, once it has one. Kept, since a first line never changes. */
  const titles = new Map<string, string>();
  const titleOf = async (sessionId: string) => {
    if (!titles.has(sessionId)) {
      const first = (await itemsOf(sessionId)).find((item) => item.role === "user");
      if (first === undefined) return "New session";
      titles.set(sessionId, textOf(first).split("\n")[0]!.slice(0, 60));
    }
    return titles.get(sessionId)!;
  };

  const rowOf = async (worker: string, session: SessionSummary): Promise<SessionRow> => {
    const [detail, turns, title] = await Promise.all([fsd.sessions.get(session.id), runningTurns(session.id), titleOf(session.id)]);
    const project = (detail.state as Record<string, unknown> | undefined)?.[WORK_PROJECT_STATE_KEY];
    return {
      id: session.id,
      title,
      worker,
      updatedAt: session.updatedAt,
      running: turns.length > 0,
      projectId: typeof project === "string" ? project : null,
    };
  };

  /** Each listed task's run session, by task id, as the last list saw it. */
  const runSessionOf = new Map<string, string>();

  /** A session's tasks, as its board's `listTasks` answers them. */
  const tasksOf = async (sessionId: string): Promise<(TaskRow & { runSessionId?: string })[]> => {
    const listed = await run(await flowOfSession(sessionId), sessionId, "listTasks_tasks", {});
    for (const task of listed.tasks as any[]) if (task.run?.sessionId !== undefined) runSessionOf.set(task.id, task.run.sessionId);
    return (listed.tasks as any[]).map((task) => ({
      id: task.id,
      title: task.title ?? task.goal,
      goal: task.goal,
      status: task.status,
      ...(task.assignee === undefined ? {} : { assignee: task.assignee }),
      ...(task.statusNote == null ? {} : { statusNote: task.statusNote }),
      ...(task.run?.sessionId === undefined ? {} : { runSessionId: task.run.sessionId }),
    }));
  };

  const notWired = async (): Promise<never> => {
    throw new Error("Threads mode isn't wired to the package yet.");
  };

  return {
    modes: modes.map((mode) => mode.id),
    watchSessions: (onChange) =>
      every(async () => {
        const rows: SessionRow[] = [];
        for (const mode of modes) {
          const listed = await workforce.listWorkerSessions(mode.worker);
          rows.push(...(await Promise.all(listed.map((entry) => rowOf(mode.worker, entry.session)))));
        }
        return rows.sort((a, b) => b.updatedAt - a.updatedAt);
      }, onChange, 3000),
    listProjects: async () => {
      const listed = await run("projects", await projects(), "listProjects", {});
      return (listed.projects as { visibility: "shared" | "private"; id: string; title: string }[]).map((project) => ({
        id: projectRef(project),
        name: project.title,
      }));
    },
    createProject: async (name, repository) => {
      const created = await run("projects", await projects(), "createProject", { id: projectIdOf(name), title: name, visibility: "private", repository });
      refuseExisting(created, name);
      return { id: projectRef({ visibility: created.visibility, id: created.project.id }), name: created.project.title };
    },
    openSession: async (mode, projectId) => {
      const { worker } = modeById(mode);
      const project = parseProjectRef(projectId);
      if (project === undefined) throw new Error(`"${projectId}" names no project.`);
      const created = await fsd.flow(await flowOf(worker)).createSession({ state: { [WORKER_ID_STATE_KEY]: worker } });
      await workforce.setWorkProject(worker, project, { sessionId: created.id });
      return { id: created.id, title: "New session", worker, updatedAt: created.updatedAt, running: false, projectId };
    },
    send: async (sessionId, text) => {
      await fsd.flow(await flowOfSession(sessionId)).send("respond", { message: text }, { sessionId });
    },
    interrupt: async (sessionId) => {
      for (const turn of await runningTurns(sessionId)) {
        // A turn that ended meanwhile answers 409, which is the stop already done.
        await fsd.flow(turn.flowId ?? turn.flowKind).request(turn.id).abort().catch(() => undefined);
      }
    },
    watchThread: (sessionId, onChange) =>
      every(async () => {
        const [items, turns] = await Promise.all([itemsOf(sessionId), runningTurns(sessionId)]);
        const turn = turns[0];
        return {
          entries: entriesOf(items),
          running: turn !== undefined,
          ...(turn?.startedAtMs === undefined ? {} : { turnStartedAt: turn.startedAtMs }),
          ...(turn === undefined ? {} : { requestId: turn.id }),
        };
      }, onChange),
    watchTasks: (sessionId, onChange) => {
      // Only a turn files or changes a task, and a task settling starts a turn, so the board
      // can move only while a turn runs or a task is open. Otherwise the last list stands.
      // A turn that started and ended between two reads still counts: its id is new.
      let rows: TaskRow[] | undefined;
      let turnsSeen: string | undefined;
      let listUntil = 0;
      return every(async () => {
        const turns = (await fsd.sessions.requests(sessionId, { limit: 50 }))
          .filter((request) => TURN_ACTIONS.has(request.actionName))
          .map((request) => `${request.id}:${request.status}`)
          .sort()
          .join(",");
        const live = rows === undefined || rows.some((row) => OPEN_TASK.has(row.status)) || turns !== turnsSeen || turns.includes(":in_progress");
        turnsSeen = turns;
        if (live) listUntil = Date.now() + TASKS_TAIL_MS;
        if (Date.now() < listUntil) rows = (await tasksOf(sessionId)).map(({ runSessionId: _run, ...row }) => row);
        return rows!;
      }, onChange, 2000);
    },
    // Shown only inside the tasks pane, whose watch keeps `runSessionOf` current.
    watchTaskWork: (_sessionId, taskId, onChange) =>
      every(async () => {
        const runSession = runSessionOf.get(taskId);
        return { entries: runSession === undefined ? [] : entriesOf(await itemsOf(runSession)) };
      }, onChange, 2000),
    sayInThread: notWired,
    resolve: notWired,
    requestChanges: notWired,
    watchPins: (onChange) => {
      onChange([]);
      return () => undefined;
    },
    pin: notWired,
    unpin: notWired,
  };
}
