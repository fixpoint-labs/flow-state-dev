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
 * | `watchTasks`    | the conversation board's `listTasks_tasks` rows, and their open holds      |
 * | `watchTaskWork` | the items of a task's run session, read only                               |
 * | `sayInThread`   | the Inbox client's answer to the thread's open question, else `updateTask_tasks` with your line |
 * | `resolve`       | the Inbox client's answer to the thread's review: `{ verdict: "accepted" }` |
 * | `requestChanges`| the same answer with `{ verdict: "revise", words }`                        |
 * | `watchPins`, `pin`, `unpin` | the lab's `pins` flow, your own user state                    |
 */
import { createClient, type Client, type SessionSummary } from "@flow-state-dev/client";
import { readBearerToken, readUserId, withBearerToken } from "@flow-state-dev/devtool/react";
import { createInboxClient, inboxItems, type InboxAnswer, type InboxQuestion, type InboxRow, type TaskQuestion } from "@flow-state-dev/orchestration/inbox";
import {
  createWorkforceClient,
  parseProjectRef,
  projectRef,
  WORK_PROJECT_STATE_KEY,
  WORKER_ID_STATE_KEY,
} from "@flow-state-dev/workforce/browser";
import { modeById, modeOfWorker, MODES, type ModeId } from "./modes";
import { resultSummary } from "./lib/result-summary";

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

/** The board action your line on a thread goes through: the task tools' `updateTask` on the conversation's board. */
const UPDATE_TASK_ACTION = "updateTask_tasks";

/** The flow a coding worker runs on: its run sessions answer which harness it is (`harness`). */
const CODING_FLOW = "harness-thread";

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

/** The task a `createTask` call filed, from its output, or undefined for any other tool or a refused call. */
function filedTaskOf(item: Item): string | undefined {
  if (item.blockName !== "createTask") return undefined;
  const output = item.output as { ok?: boolean; taskId?: unknown } | undefined;
  return output?.ok === true && typeof output.taskId === "string" ? output.taskId : undefined;
}

/**
 * A thread's entries, from its items in order. A result is the line the main session took a task's ending as.
 * In threads mode (`threads`), a task the lead filed is a thread card where its `createTask` call is, and
 * your line is marked when its turn filed one.
 */
function entriesOf(items: readonly Item[], threads = false): ThreadEntry[] {
  // A turn a user's line started holds that line; a notice's own turn holds none.
  const userTurns = new Set(items.filter((item) => item.type === "message" && item.role === "user").map((item) => item.requestId));
  const filingTurns = new Set(items.filter((item) => filedTaskOf(item) !== undefined).map((item) => item.requestId));
  const entries: ThreadEntry[] = [];
  for (const item of items) {
    const requestId = item.requestId;
    const filed = threads ? filedTaskOf(item) : undefined;
    if (filed !== undefined) {
      entries.push({ kind: "thread", id: item.id, taskId: filed, requestId });
      continue;
    }
    if (item.type === "tool_output") {
      entries.push({ kind: "tool", id: item.id, name: item.blockName ?? "tool", summary: summaryOf(item.output), requestId });
      continue;
    }
    const text = textOf(item);
    if (item.role === "user") {
      entries.push({ kind: "user", id: item.id, text, requestId, ...(threads && filingTurns.has(requestId) ? { sentToThread: true } : {}) });
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
        summary: resultSummary(summary ?? text),
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
  const inbox = createInboxClient(fsd);
  const modes = MODES;
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

  /** The user's one session on a lab flow (`projects`, `pins`), found or made once. */
  const ownSessions = new Map<string, Promise<string>>();
  const ownSession = (flow: string) => {
    if (!ownSessions.has(flow)) {
      ownSessions.set(
        flow,
        (async () => {
          const [latest] = (await fsd.sessions.list({ flowKind: flow, userId: fsd.userId })).sort((a, b) => b.updatedAt - a.updatedAt);
          return latest?.id ?? (await fsd.flow(flow).createSession()).id;
        })(),
      );
    }
    return ownSessions.get(flow)!;
  };
  const projects = () => ownSession("projects");

  /** Whether a session is threads mode's: its main worker is that mode's. Kept, since a session's worker never changes. */
  const threadsSessions = new Map<string, Promise<boolean>>();
  const isThreads = (sessionId: string) => {
    if (!threadsSessions.has(sessionId)) {
      threadsSessions.set(
        sessionId,
        fsd.sessions.get(sessionId).then((detail) => {
          const worker = (detail.state as Record<string, unknown> | undefined)?.[WORKER_ID_STATE_KEY];
          return typeof worker === "string" && modeOfWorker(worker)?.pane === "board";
        }),
      );
    }
    return threadsSessions.get(sessionId)!;
  };

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

  /** A listed task row, as much as the screen reads. */
  type Listed = TaskRow & { runSessionId?: string; run?: { sessionId: string; requestId: string }; questions?: TaskQuestion[] };

  /** Each listed task's run session, by task id, as the last list saw it. */
  const runSessionOf = new Map<string, string>();

  /** A session's tasks, as its board's `listTasks` answers them. */
  const tasksOf = async (sessionId: string): Promise<Listed[]> => {
    const listed = await run(await flowOfSession(sessionId), sessionId, "listTasks_tasks", {});
    for (const task of listed.tasks as any[]) if (task.run?.sessionId !== undefined) runSessionOf.set(task.id, task.run.sessionId);
    return (listed.tasks as any[]).map((task) => ({
      id: task.id,
      title: task.title ?? task.goal,
      goal: task.goal,
      status: task.status,
      ...(task.assignee === undefined ? {} : { assignee: task.assignee }),
      ...(task.statusNote == null ? {} : { statusNote: task.statusNote }),
      ...(typeof task.updatedAt === "number" ? { updatedAt: task.updatedAt } : {}),
      ...(task.run?.sessionId === undefined ? {} : { runSessionId: task.run.sessionId, run: task.run }),
      ...(Array.isArray(task.questions) ? { questions: task.questions } : {}),
    }));
  };

  /** The flow that owns each run session, where a hold's answer goes. Kept, since a session's flow never changes. */
  const runFlows = new Map<string, string | null>();

  /** Each task's open holds for you, as the Inbox reads them: what its answer takes and where it goes. */
  const holdsOf = async (sessionId: string, listed: readonly Listed[]): Promise<Map<string, InboxQuestion[]>> => {
    // A question is answered on the board's own session; a run's stop, in the run's session.
    if (!runFlows.has(sessionId)) runFlows.set(sessionId, await flowOfSession(sessionId));
    for (const task of listed) {
      if (task.runSessionId !== undefined && !runFlows.has(task.runSessionId)) {
        const detail = await fsd.sessions.get(task.runSessionId);
        runFlows.set(task.runSessionId, detail.flowId ?? detail.flowKind ?? null);
      }
    }
    const rows: InboxRow[] = listed.map((task) => ({
      board: sessionId,
      id: task.id,
      title: task.title,
      assignee: task.assignee ?? null,
      status: task.status,
      run: task.run ?? null,
      questions: task.questions ?? [],
      holder: { sessionId, action: UPDATE_TASK_ACTION },
    }));
    const items = inboxItems({ rows, suspensions: [], flowOf: (id) => runFlows.get(id) });
    return new Map(items.flatMap((item) => (item.task === null ? [] : [[item.task.taskId, [...item.questions]] as const])));
  };

  /** The harness each coding worker runs through, asked once of a run session of it. */
  const harnesses = new Map<string, Promise<string | undefined>>();
  const harnessOf = async (task: Listed): Promise<string | undefined> => {
    if (task.assignee === undefined || (await flowOf(task.assignee).catch(() => undefined)) !== CODING_FLOW) return undefined;
    if (task.runSessionId === undefined) return harnesses.get(task.assignee);
    if (!harnesses.has(task.assignee)) {
      const runSession = task.runSessionId;
      harnesses.set(task.assignee, flowOfSession(runSession).then((flow) => run(flow, runSession, "harness", {})).then((out) => out.harness as string, () => undefined));
    }
    return harnesses.get(task.assignee);
  };

  /** How a finished coding task's review ended, from its output. Kept, since a finished task's output never changes. */
  const reviews = new Map<string, Promise<TaskRow["review"]>>();
  const reviewOf = (sessionId: string, task: Listed) => {
    if (!reviews.has(task.id)) {
      reviews.set(
        task.id,
        flowOfSession(sessionId)
          .then((flow) => run(flow, sessionId, "getTask_tasks", { id: task.id }))
          .then((read) => (read.task?.output?.review as TaskRow["review"]) ?? null),
      );
    }
    return reviews.get(task.id)!;
  };

  /** A session's board as the screen draws it: each row with what it waits on you for, its harness and its review. */
  const boardOf = async (sessionId: string) => {
    const listed = await tasksOf(sessionId);
    const holds = await holdsOf(sessionId, listed);
    const rows = await Promise.all(
      listed.map(async (task): Promise<TaskRow> => {
        const { runSessionId: _session, run: _run, questions: _questions, ...row } = task;
        const hold = holds.get(row.id)?.[0];
        const harness = await harnessOf(task);
        const review = harness !== undefined && row.status === "completed" ? await reviewOf(sessionId, task) : undefined;
        return {
          ...row,
          ...(hold === undefined
            ? {}
            : { waitingOn: { kind: hold.ask.kind === "confirm" ? "input" : hold.ask.kind, prompt: hold.ask.prompt } }),
          ...(harness === undefined ? {} : { harness }),
          ...(review === undefined ? {} : { review }),
        };
      }),
    );
    return rows;
  };

  /** The open hold a thread's task holds you on that asks for `asks` (a question, a review), or undefined. */
  const holdOn = async (sessionId: string, taskId: string, asks: "question" | "review"): Promise<InboxQuestion | undefined> => {
    const holds = await holdsOf(sessionId, (await tasksOf(sessionId)).filter((task) => task.id === taskId));
    return holds.get(taskId)?.find((hold) => hold.ask.kind === asks);
  };

  /** Answer a thread's review with `answer`: the Inbox client's one answer call, to the run's own stop. */
  const answerReview = async (sessionId: string, taskId: string, answer: InboxAnswer) => {
    const review = await holdOn(sessionId, taskId, "review");
    if (review === undefined) throw new Error(`The thread "${taskId}" isn't waiting on your review.`);
    await inbox.answerOne(review, answer);
  };

  /** Your pins, as the `pins` flow keeps them. */
  const pinsDo = async (action: string, input: unknown): Promise<string[]> => (await run("pins", await ownSession("pins"), action, input)).pinned;

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
      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      const created = await run("projects", await projects(), "createProject", { id, title: name, visibility: "private", repository });
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
        const [items, turns, threads] = await Promise.all([itemsOf(sessionId), runningTurns(sessionId), isThreads(sessionId)]);
        const turn = turns[0];
        return {
          entries: entriesOf(items, threads),
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
        if (Date.now() < listUntil) rows = await boardOf(sessionId);
        return rows!;
      }, onChange, 2000);
    },
    // Shown only inside the tasks pane or the threads board, whose watch keeps `runSessionOf` current.
    watchTaskWork: (_sessionId, taskId, onChange) =>
      every(async () => {
        const runSession = runSessionOf.get(taskId);
        return { entries: runSession === undefined ? [] : entriesOf(await itemsOf(runSession)) };
      }, onChange, 2000),
    sayInThread: async (sessionId, taskId, line) => {
      // A line answers the question the thread holds you on; with none open, it is a steer on its task.
      const question = await holdOn(sessionId, taskId, "question");
      if (question !== undefined) {
        await inbox.answerOne(question, { text: line });
        return;
      }
      await run(await flowOfSession(sessionId), sessionId, UPDATE_TASK_ACTION, { id: taskId, message: line });
    },
    resolve: (sessionId, taskId) => answerReview(sessionId, taskId, { value: { verdict: "accepted" } }),
    requestChanges: (sessionId, taskId, words) => answerReview(sessionId, taskId, { value: { verdict: "revise", words } }),
    watchPins: (onChange) => every(() => pinsDo("listPins", {}), onChange, 3000),
    pin: async (taskId) => {
      await pinsDo("pin", { taskId });
    },
    unpin: async (taskId) => {
      await pinsDo("unpin", { taskId });
    },
  };
}
