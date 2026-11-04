// fallow-ignore-file duplicate-export -- each lab is its own app, and both expose the same LabAdapter shape on purpose.
/**
 * The lab's one way in and out. Every read and write the screen makes goes
 * through `LabAdapter`, and nothing else in `src/` touches a package.
 *
 * Each verb is bound to a public package call (`createLabAdapter`):
 *
 * | Verb            | Package call                                                              |
 * |-----------------|---------------------------------------------------------------------------|
 * | `watchSessions` | the workforce client's `listWorkerSessions`, for each built mode's worker, |
 * |                 | and each row again on its session's notices, through `client.subscribe`  |
 * | `listProjects`  | the project blocks' `listProjects`: only projects the user may work in    |
 * | `createProject` | the project blocks' `createProject`, a private project on a repository   |
 * | `openSession`   | a new session on the mode's main worker, then `setWorkProject`            |
 * | `send`          | the worker's door, `respond`, in that session                             |
 * | `interrupt`     | aborting the session's running request                                     |
 * | `watchThread`   | the session's items, followed through the client's `sessionFeed`          |
 * |                 | and that feed's connection state, for the connection bar; `loadEarlier`    |
 * |                 | is the feed's, for a thread longer than its first read; its running turn   |
 * |                 | is the session's requests, read on each request notice                     |
 * | `watchTasks`    | the conversation board's `listTasks_tasks` read, and the rows' open holds  |
 * | `watchTaskWork` | the items of a task's run session, followed through `sessionFeed`, with   |
 * |                 | its `loadEarlier` too, from the moment the board's read names that session |
 * | `sayInThread`   | the Inbox client's answer to the thread's open question, else `updateTask_tasks` with your line |
 * | `resolve`       | the Inbox client's answer to the thread's review: `{ verdict: "accepted" }` |
 * | `requestChanges`| the same answer with `{ verdict: "revise", words }`                        |
 * | `watchPins`, `pin`, `unpin` | the lab's `pins` flow, your own user state; `watchPins` is its |
 * |                 | `listPins` read, again on each state notice of your user topic             |
 *
 * Every watch but `watchTasks` reads on a change; `watchTasks` still reads on a clock (`every`).
 */
import { createClient, sessionFeed, topic, type Client, type SessionConnectionState, type SessionFeed, type WireNotice, type WireTopic } from "@flow-state-dev/client";
import { readBasePath, readBearerToken, readUserId, withBearerToken } from "@flow-state-dev/devtool/react";
import { createInboxClient, inboxItems, type InboxAnswer, type InboxHold, type InboxRow, type TaskHold } from "@flow-state-dev/orchestration/inbox";
import { parseNotice, type TaskSpendView } from "@flow-state-dev/orchestration/tasks";
import { reviewDetail, type ReviewDetail } from "@flow-state-dev/harness-manager/browser";
import {
  createWorkforceClient,
  delegateAnswerOf,
  parseProjectRef,
  projectRef,
  WORK_PROJECT_STATE_KEY,
  WORKER_ID_STATE_KEY,
} from "@flow-state-dev/workforce/browser";
import { modeById, modeOfWorker, MODES, type ModeId } from "./modes";
import { projectIdOf, refuseExisting } from "./lib/new-project";
import { waitingOnYou } from "./lib/columns";
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
  /** How many of its tasks wait on you (`waitingOnYou`): a question, a review, or a failure to retry. */
  waiting: number;
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
  /** A tool call, by its tool's name; the thread says it in words (`toolLine`). */
  | { kind: "tool"; id: string; name: string }
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

/** A session feed's connection: `lapsed` once a retry has failed, `stopped` once it gives up. */
export type ConnectionState = SessionConnectionState;

/** What a thread shows now. */
export interface ThreadView {
  entries: ThreadEntry[];
  running: boolean;
  /** Whether the thread's feed still hears the server; none before the feed has said. */
  connection?: ConnectionState;
  /** When the running turn started, in ms. */
  turnStartedAt?: number;
  /** The running turn's request. */
  requestId?: string;
  /** Present while the thread holds items older than its first entry: adds the page before them. */
  loadEarlier?: () => Promise<void>;
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
  /** What its runs spent, as the board's `listTasks` reads it (`taskSpendView`): model, harness, tokens; none before it runs. */
  spend?: TaskSpendView;
}

/** A coding run's review stop's data, as harness-manager's browser reader reads it. */
export type { ReviewDetail };

/** The read-only work of one task. */
export interface TaskWork {
  entries: ThreadEntry[];
  /** Its run's latest review stop, when it made one. */
  review?: ReviewDetail;
  /** Present while the run holds items older than its first entry: adds the page before them. */
  loadEarlier?: () => Promise<void>;
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

/** The requests that are a turn of the main session: a user's line, or a background result after the turn. */
const TURN_ACTIONS = new Set(["respond", "onTaskSettled"]);

/**
 * The notices on a listed session's topic that may change its row: a turn (its running state, its
 * title), a board change (what it waits on you for, FIX-2429's `board`), and a resource. Never `items`.
 */
const ROW_CHANGES: ReadonlySet<string> = new Set(["request", "board", "resource"]);

/** The board action your line on a thread goes through: the task tools' `updateTask` on the conversation's board. */
const UPDATE_TASK_ACTION = "updateTask_tasks";

/** The flow a coding worker runs on: its run sessions answer which harness it is (`harness`). */
const CODING_FLOW = "harness-thread";

/** The item types a thread draws. */
const THREAD_ITEMS = ["message", "tool_output"];

/** One stored item, as far as the thread reads it. */
export interface Item {
  id: string;
  type: string;
  role?: string;
  requestId?: string;
  agentName?: string;
  blockName?: string;
  content?: { type: string; text?: string }[];
  output?: unknown;
  /** A `suspension` item's: what it waits on, and what it carries beside its prompt. */
  kind?: string;
  data?: Record<string, unknown>;
  /** A message's data a client reads: a task's line names its task here (`parseNotice`, `delegateAnswerOf`). */
  metadata?: Record<string, unknown>;
}


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

/**
 * A read again after a failed one, 1 s and doubling to 30 s, the shape of the
 * client's own reconnects. A view that reads on a notice has no clock to try
 * again on where push covers it, so a failed read would otherwise wait for a
 * change that may never come. `succeeded` resets the delay; `stop` drops a
 * waiting try.
 */
function retryAfterFailure(again: () => void): { failed(): void; succeeded(): void; stop(): void } {
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    failed() {
      clearTimeout(timer);
      timer = setTimeout(again, Math.min(30_000, 1_000 * 2 ** attempt));
      attempt += 1;
    },
    succeeded() {
      attempt = 0;
    },
    stop() {
      clearTimeout(timer);
    },
  };
}

/**
 * Read `read` now, and again whenever a notice under `topics` passes `hears`
 * (FIX-2466), reporting a value only when it changed, as {@link every} does.
 * A connect, a reconnect, a tick and a `resync` read too. One read at a time,
 * and one waiting for any number of notices. Wherever push can miss a change,
 * `client.subscribe` reads every `everyMs` instead, so the view keeps no
 * timer of its own. A failed read tries again on its own ({@link retryAfterFailure}).
 * A read still out when the watch stops reports nothing.
 */
function onNotice<T>(
  fsd: Client,
  topics: readonly WireTopic[],
  hears: (notice: WireNotice) => boolean,
  read: () => Promise<T>,
  onChange: (value: T) => void,
  everyMs = READ_EVERY_MS,
): Unsubscribe {
  let live = true;
  let last: string | undefined;
  let running = false;
  let queued = false;
  const retry = retryAfterFailure(() => void tick());
  const tick = async (): Promise<void> => {
    if (!live) return;
    if (running) {
      queued = true;
      return;
    }
    running = true;
    try {
      const value = await read();
      retry.succeeded();
      const key = JSON.stringify(value);
      if (live && key !== last) {
        last = key;
        onChange(value);
      }
    } catch (error) {
      console.warn("[claude-code-style]", error);
      if (live) retry.failed();
    }
    running = false;
    if (queued) {
      queued = false;
      void tick();
    }
  };
  const subscription = fsd.subscribe(topics, {
    onChange: (notice) => {
      if (notice === null || notice.kind === "resync" || hears(notice)) void tick();
    },
    pollIntervalMs: everyMs,
  });
  void tick();
  return () => {
    live = false;
    retry.stop();
    subscription.close();
  };
}

/**
 * A run's latest review stop, read with harness-manager's browser reader, or
 * undefined before it makes one. The latest wins: a run sent back for changes
 * stops for review again.
 */
export function reviewStopOf(items: readonly Item[]): ReviewDetail | undefined {
  const stop = [...items].reverse().find((item) => item.type === "suspension" && item.kind === "review");
  return (stop && reviewDetail(stop.data)) ?? undefined;
}

const textOf = (item: Item) => (item.content ?? []).map((part) => part.text ?? "").join("");

/** The task a `createTask` call filed, from its output, or undefined for any other tool or a refused call. */
function filedTaskOf(item: Item): string | undefined {
  if (item.blockName !== "createTask") return undefined;
  const output = item.output as { ok?: boolean; taskId?: unknown } | undefined;
  return output?.ok === true && typeof output.taskId === "string" ? output.taskId : undefined;
}

/**
 * A thread's entries, from its items in order. A result is the line the main session took a task's ending as,
 * and so is a delegate's answer that landed in the conversation as written (a task filed with `resultTo:
 * "conversation"`): either way the task's reply is one line, not the session's own words.
 * In threads mode (`threads`), a task the lead filed is a thread card where its `createTask` call is, and
 * your line is marked when its turn filed one.
 */
export function entriesOf(items: readonly Item[], threads = false): ThreadEntry[] {
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
      entries.push({ kind: "tool", id: item.id, name: item.blockName ?? "tool", requestId });
      continue;
    }
    const text = textOf(item);
    if (item.role === "user") {
      entries.push({ kind: "user", id: item.id, text, requestId, ...(threads && filingTurns.has(requestId) ? { sentToThread: true } : {}) });
      continue;
    }
    // A failure that runs again is not an ending; the others are the thread's own task statuses.
    const notice = parseNotice(item);
    if (notice !== undefined && notice.ending !== "retried") {
      entries.push({
        kind: "result",
        id: item.id,
        taskId: notice.taskId,
        title: notice.title,
        status: notice.ending,
        summary: resultSummary(notice.detail ?? text),
        duringTurn: userTurns.has(requestId),
        requestId,
      });
      continue;
    }
    const answer = delegateAnswerOf(item);
    if (answer !== undefined && text.length > 0) {
      // The line names who answered, by the worker's own name.
      const worker = answer.worker.split(".").pop()!;
      entries.push({ kind: "result", id: item.id, taskId: answer.taskId, title: `Answer from ${worker}`, status: "completed", summary: resultSummary(text), duringTurn: userTurns.has(requestId), requestId });
      continue;
    }
    if (text.length > 0) entries.push({ kind: "assistant", id: item.id, text, requestId });
  }
  return entries;
}

/** The adapter the app runs on: the served lab, as the user the page was served for. */
export function createLabAdapter(): LabAdapter {
  return createWiredLab(createClient({ userId: readUserId(), baseUrl: readBasePath(), fetcher: withBearerToken(readBearerToken()) }));
}

/**
 * Follow one session's items of `types` through the client's `sessionFeed`,
 * calling `onItems` once the history lands and on every change after, with
 * the feed's `loadEarlier` while the session holds older items, and
 * `onState` on each change of the connection's state. The
 * feed holds one connection; `stop` closes it. The session stream sends an
 * item once it is finished, so an answer being written reaches the feed only
 * through `feed.followResponse`.
 */
function followItems(
  fsd: Client,
  sessionId: string,
  types: readonly string[],
  onItems: (items: Item[], loadEarlier: (() => Promise<void>) | undefined) => void,
  onState?: (state: ConnectionState) => void,
): { feed: SessionFeed; stop: Unsubscribe } {
  const feed = sessionFeed(fsd, sessionId, { itemTypes: [...types] });
  const loadEarlier = () => feed.loadEarlier();
  let last: readonly unknown[] | undefined;
  let lastState: ConnectionState | undefined;
  const stop = feed.subscribe(({ items, hasEarlier, state }) => {
    if (state !== lastState) {
      lastState = state;
      onState?.(state);
    }
    // Nothing until the history lands, and nothing when only the connection state moved.
    if ((items.length === 0 && state === "connecting") || items === last) return;
    last = items;
    onItems(items as unknown as Item[], hasEarlier ? loadEarlier : undefined);
  });
  return {
    feed,
    stop: () => {
      stop();
      feed.close();
    },
  };
}

/** The adapter over one client. */
export function createWiredLab(fsd: Client): LabAdapter {
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

  /** Every item of a session of the types a thread draws (or `types`), every page. */
  const itemsOf = async (sessionId: string, types: readonly string[] = THREAD_ITEMS): Promise<Item[]> => {
    const items: Item[] = [];
    for (let offset = 0; ; ) {
      const page = (await fsd.sessions.state(sessionId, { includeItems: true, itemTypes: [...types], offset, limit: 100 })) as {
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

  const rowOf = async (worker: string, sessionId: string): Promise<SessionRow> => {
    const [detail, turns, title, waiting] = await Promise.all([
      fsd.sessions.get(sessionId),
      runningTurns(sessionId),
      titleOf(sessionId),
      waitingCountFor(sessionId),
    ]);
    const project = (detail.state as Record<string, unknown> | undefined)?.[WORK_PROJECT_STATE_KEY];
    return {
      id: sessionId,
      title,
      worker,
      updatedAt: detail.updatedAt,
      running: turns.length > 0,
      waiting,
      projectId: typeof project === "string" ? project : null,
    };
  };

  /**
   * How many of a session's tasks wait on you, read as the board reads them (its tasks and their
   * open holds), without the harness and review reads the board's cards add. A board that can't be
   * read counts none and says why in the console, so the list never fails on it.
   */
  const waitingCountFor = async (sessionId: string): Promise<number> => {
    try {
      return waitingOnYou(await listedWithWaitingOn(sessionId));
    } catch (cause) {
      console.warn(`[claude-code-style] couldn't count what session ${sessionId} waits on you for:`, cause);
      return 0;
    }
  };

  /** A listed task row, as much as the screen reads. */
  type Listed = TaskRow & { runSessionId?: string; run?: { sessionId: string; requestId: string }; holds?: TaskHold[] };

  /** Each listed task's run session, by task id, as the last list saw it. */
  const runSessionOf = new Map<string, string>();
  /** Told whenever a list moves a task's run session: a task's work follows the one the board names now. */
  const runLinkMoved = new Set<() => void>();

  /** The feed of each thread open on screen, by session id, so a send there can stream its answer into it. */
  const threadFeeds = new Map<string, SessionFeed>();

  /** A session's tasks, as its board's `listTasks` read answers them: a read, so a list stores no request. */
  const tasksOf = async (sessionId: string): Promise<Listed[]> => {
    const listed = await fsd
      .flow(await flowOfSession(sessionId))
      .read<{ ok: boolean; error?: string; tasks: any[] }>("listTasks_tasks", {}, { sessionId });
    if (!listed.ok) throw new Error(listed.error);
    let moved = false;
    for (const task of listed.tasks as any[]) {
      if (task.run?.sessionId === undefined || runSessionOf.get(task.id) === task.run.sessionId) continue;
      runSessionOf.set(task.id, task.run.sessionId);
      moved = true;
    }
    if (moved) for (const tell of [...runLinkMoved]) tell();
    return (listed.tasks as any[]).map((task) => ({
      id: task.id,
      title: task.title ?? task.goal,
      goal: task.goal,
      status: task.status,
      ...(task.assignee === undefined ? {} : { assignee: task.assignee }),
      ...(task.statusNote == null ? {} : { statusNote: task.statusNote }),
      ...(typeof task.updatedAt === "number" ? { updatedAt: task.updatedAt } : {}),
      ...(task.run?.sessionId === undefined ? {} : { runSessionId: task.run.sessionId, run: task.run }),
      ...(Array.isArray(task.holds) ? { holds: task.holds } : {}),
      ...(task.spend == null ? {} : { spend: task.spend }),
    }));
  };

  /** The flow that owns each run session, where a hold's answer goes. Kept, since a session's flow never changes. */
  const runFlows = new Map<string, string | null>();

  /** Each task's open holds for you, as the Inbox reads them: what its answer takes and where it goes. */
  const holdsOf = async (sessionId: string, listed: readonly Listed[]): Promise<Map<string, InboxHold[]>> => {
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
      holds: task.holds ?? [],
      holder: { sessionId, action: UPDATE_TASK_ACTION },
    }));
    const items = inboxItems({ rows, suspensions: [], flowOf: (id) => runFlows.get(id) });
    return new Map(items.flatMap((item) => (item.task === null ? [] : [[item.task.taskId, [...item.holds]] as const])));
  };

  /** A session's tasks, each with what its first open hold waits on you for: the one place a hold becomes a row's `waitingOn`. */
  const listedWithWaitingOn = async (sessionId: string): Promise<Listed[]> => {
    const listed = await tasksOf(sessionId);
    const holds = await holdsOf(sessionId, listed);
    return listed.map((task) => {
      const hold = holds.get(task.id)?.[0];
      return hold === undefined
        ? task
        : { ...task, waitingOn: { kind: hold.ask.kind === "confirm" ? "input" : hold.ask.kind, prompt: hold.ask.prompt } };
    });
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
    const listed = await listedWithWaitingOn(sessionId);
    const rows = await Promise.all(
      listed.map(async (task): Promise<TaskRow> => {
        const { runSessionId: _session, run: _run, holds: _holds, ...row } = task;
        // The harness its run reported; until one reports, the assignee's `harness` setting.
        const harness = task.spend?.harness ?? (await harnessOf(task));
        const review = harness !== undefined && row.status === "completed" ? await reviewOf(sessionId, task) : undefined;
        return {
          ...row,
          ...(harness === undefined ? {} : { harness }),
          ...(review === undefined ? {} : { review }),
        };
      }),
    );
    return rows;
  };

  /** The open hold a thread's task holds you on that asks for `asks` (a question, a review), or undefined. */
  const holdOn = async (sessionId: string, taskId: string, asks: "question" | "review"): Promise<InboxHold | undefined> => {
    const holds = await holdsOf(sessionId, (await tasksOf(sessionId)).filter((task) => task.id === taskId));
    return holds.get(taskId)?.find((hold) => hold.ask.kind === asks);
  };

  /** Answer a thread's review with `answer`: the Inbox client's one answer call, to the run's own stop. */
  const answerReview = async (sessionId: string, taskId: string, answer: InboxAnswer) => {
    const review = await holdOn(sessionId, taskId, "review");
    if (review === undefined) throw new Error(`The thread "${taskId}" isn't waiting on your review.`);
    await inbox.answerOne(review, answer);
  };

  /** Told when this tab opens a session, so the sessions list reads it in at once. */
  const sessionOpened = new Set<() => void>();

  /** Your pins, as the `pins` flow keeps them. */
  const pinsDo = async (action: string, input: unknown): Promise<string[]> => (await run("pins", await ownSession("pins"), action, input)).pinned;
  /** Your pins, through the flow's read: reading them stores no request. */
  const readPins = async (): Promise<string[]> =>
    (await fsd.flow("pins").read<{ pinned: string[] }>("listPins", {}, { sessionId: await ownSession("pins") })).pinned;

  return {
    modes: modes.map((mode) => mode.id),
    // Listed on open, and again when this tab opens a session. Each listed row reads again on its own
    // session's notices: a turn (request), a board change, a resource. Never on `items`, which a reply
    // sends per stored chunk. A session opened in another tab has no notice anyone hears yet, so it
    // joins at the next reload (FIX-2466 D1). Where push can miss a change, the whole list reads
    // every 3 s, as it always has.
    watchSessions: (onChange) => {
      let live = true;
      let rows = new Map<string, SessionRow>();
      let last: string | undefined;
      let subscription: { close(): void } | undefined;
      // The listed ids the subscription hears; `null` before the first listing lands, so an empty
      // listing still subscribes (no topics, and the fallback timer where push can miss a change).
      let subscribed: string | null = null;
      let relist = true;
      const dirty = new Set<string>();
      let running = false;
      // A failed listing or row read lists again on its own: with push up there may be no notice to wake it.
      const retry = retryAfterFailure(() => {
        relist = true;
        void pump();
      });
      const tell = () => {
        const list = [...rows.values()].sort((a, b) => b.updatedAt - a.updatedAt);
        const key = JSON.stringify(list);
        if (key === last) return;
        last = key;
        onChange(list);
      };
      const listen = () => {
        const ids = [...rows.keys()].sort();
        const key = ids.join("\u0000");
        if (key === subscribed) return;
        subscribed = key;
        subscription?.close();
        subscription = fsd.subscribe(
          ids.map((id) => topic.session(id)),
          {
            onChange: (notice) => {
              if (notice === null || notice.kind === "resync") relist = true;
              else if (notice.topic.scope === "session" && ROW_CHANGES.has(notice.kind)) dirty.add(notice.topic.id);
              else return;
              void pump();
            },
            pollIntervalMs: 3000,
          },
        );
      };
      // One read at a time; what arrives meanwhile waits for the next.
      const pump = async (): Promise<void> => {
        // Nothing is lost by returning: a wake while a pass runs has already set `relist` or `dirty`,
        // and the running loop checks both again before it stops.
        if (running) return;
        running = true;
        while (live && (relist || dirty.size > 0)) {
          try {
            if (relist) {
              relist = false;
              dirty.clear();
              const next = new Map<string, SessionRow>();
              for (const mode of modes) {
                const listed = await workforce.listWorkerSessions(mode.worker);
                for (const row of await Promise.all(listed.map((entry) => rowOf(mode.worker, entry.session.id)))) next.set(row.id, row);
              }
              rows = next;
            } else {
              const ids = [...dirty];
              dirty.clear();
              const read = await Promise.all(ids.flatMap((id) => (rows.has(id) ? [rowOf(rows.get(id)!.worker, id)] : [])));
              for (const row of read) if (rows.has(row.id)) rows.set(row.id, row);
            }
            if (!live) break;
            retry.succeeded();
            tell();
            listen();
          } catch (error) {
            console.warn("[claude-code-style]", error);
            if (live) retry.failed();
          }
        }
        running = false;
      };
      const opened = () => {
        relist = true;
        void pump();
      };
      sessionOpened.add(opened);
      void pump();
      return () => {
        live = false;
        retry.stop();
        sessionOpened.delete(opened);
        subscription?.close();
      };
    },
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
      for (const tell of [...sessionOpened]) tell();
      return { id: created.id, title: "New session", worker, updatedAt: created.updatedAt, running: false, waiting: 0, projectId };
    },
    send: async (sessionId, text) => {
      const flow = fsd.flow(await flowOfSession(sessionId));
      const feed = threadFeeds.get(sessionId);
      // With the thread open, stream the send so its answer shows as it is written.
      if (feed === undefined) {
        await flow.send("respond", { message: text }, { sessionId });
        return;
      }
      const response = await flow.send("respond", { message: text }, { sessionId, stream: true });
      if (!response.ok) throw new Error(`The send was refused (${response.status}).`);
      if (response.headers.get("content-type")?.includes("text/event-stream")) feed.followResponse(response);
    },
    interrupt: async (sessionId) => {
      for (const turn of await runningTurns(sessionId)) {
        // A turn that ended meanwhile answers 409, which is the stop already done.
        await fsd.flow(turn.flowId ?? turn.flowKind).request(turn.id).abort().catch(() => undefined);
      }
    },
    watchThread: (sessionId, onChange) => {
      // Items come from the session feed. The running turn is still read: the feed's runs are
      // child sessions, not this session's own turns.
      let items: Item[] | undefined;
      let loadEarlier: (() => Promise<void>) | undefined;
      let connection: ConnectionState | undefined;
      let turnOf: { turn: Awaited<ReturnType<typeof runningTurns>>[number] | undefined; threads: boolean } | undefined;
      let last: string | undefined;
      const tell = () => {
        if (items === undefined || turnOf === undefined) return;
        const { turn, threads } = turnOf;
        const view: ThreadView = {
          entries: entriesOf(items, threads),
          running: turn !== undefined,
          ...(connection === undefined ? {} : { connection }),
          ...(turn?.startedAtMs === undefined ? {} : { turnStartedAt: turn.startedAtMs }),
          ...(turn === undefined ? {} : { requestId: turn.id }),
          ...(loadEarlier === undefined ? {} : { loadEarlier }),
        };
        // A function drops out of JSON: whether there is more before is said in the key.
        const key = JSON.stringify({ ...view, earlier: loadEarlier !== undefined });
        if (key === last) return;
        last = key;
        onChange(view);
      };
      const { feed, stop: stopItems } = followItems(
        fsd,
        sessionId,
        THREAD_ITEMS,
        (next, earlier) => {
          items = next;
          loadEarlier = earlier;
          tell();
        },
        (state) => {
          connection = state;
          tell();
        },
      );
      threadFeeds.set(sessionId, feed);
      // A turn starts and ends as a request: a request notice on the session's topic. Never on
      // `items`, which a streaming reply sends once per stored chunk.
      const stopTurns = onNotice(
        fsd,
        [topic.session(sessionId)],
        (notice) => notice.kind === "request",
        async () => {
          const [turns, threads] = await Promise.all([runningTurns(sessionId), isThreads(sessionId)]);
          return { turn: turns[0], threads };
        },
        (next) => {
          turnOf = next;
          tell();
        },
      );
      return () => {
        if (threadFeeds.get(sessionId) === feed) threadFeeds.delete(sessionId);
        stopItems();
        stopTurns();
      };
    },
    // The board is a read, so listing it every tick while the pane is open stores nothing.
    watchTasks: (sessionId, onChange) => every(() => boardOf(sessionId), onChange, 2000),
    // Shown only inside the tasks pane or the threads board, whose watch keeps `runSessionOf` current.
    watchTaskWork: (_sessionId, taskId, onChange) => {
      // The task's run session is known once the board has listed it, and a re-run moves it: follow
      // whichever session the board names now, from the moment a list names it, and show no work
      // until one does. The run's items come from its session stream.
      let stopItems: Unsubscribe | undefined;
      let following: string | null | undefined;
      const follow = () => {
        const runSession = runSessionOf.get(taskId) ?? null;
        if (runSession === following) return;
        following = runSession;
        stopItems?.();
        stopItems = undefined;
        if (runSession === null) {
          onChange({ entries: [] });
          return;
        }
        stopItems = followItems(fsd, runSession, [...THREAD_ITEMS, "suspension"], (items, loadEarlier) => {
          const review = reviewStopOf(items);
          onChange({
            entries: entriesOf(items.filter((item) => item.type !== "suspension")),
            ...(review === undefined ? {} : { review }),
            ...(loadEarlier === undefined ? {} : { loadEarlier }),
          });
        }).stop;
      };
      runLinkMoved.add(follow);
      follow();
      return () => {
        runLinkMoved.delete(follow);
        stopItems?.();
      };
    },
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
    // Pins are your user state: a state notice on your topic, from this tab or another, says they may have changed.
    watchPins: (onChange) => onNotice(fsd, [topic.user()], (notice) => notice.kind === "state", readPins, onChange, 3000),
    pin: async (taskId) => {
      await pinsDo("pin", { taskId });
    },
    unpin: async (taskId) => {
      await pinsDo("unpin", { taskId });
    },
  };
}
