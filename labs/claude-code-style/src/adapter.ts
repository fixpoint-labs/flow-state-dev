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
 * | `watchTasks`    | the conversation board's `listTasks` read, and the rows' open holds        |
 * |                 | again on each notice of the board, through `client.subscribe`; a failed   |
 * |                 | row's error from its `getTask`, once per attempt                           |
 * | `watchTaskWork` | the items of a task's run session, followed through `sessionFeed`, with   |
 * |                 | its `loadEarlier` too, from the moment the board's read names that session; |
 * |                 | while the task runs, the tool call in flight (the UI registry's            |
 * |                 | `working-status`) and harness-manager's `readRecordedWork`, for the plan  |
 * |                 | its harness recorded, read on each write to it                             |
 * | `sayInThread`   | the Inbox client's answer to the thread's open question, else the board's `steer` |
 * | `taskActions`   | the Inbox client's `board(at)` on the session that holds the board: `cancel`, |
 * |                 | `steer`, `release` and `retry`, each the board's own action                 |
 * | `resolve`       | the Inbox client's answer to the thread's review: `{ verdict: "accepted" }` |
 * | `requestChanges`| the same answer with `{ verdict: "revise", words }`                        |
 * | `watchPins`, `pin`, `unpin` | the lab's `pins` flow, your own user state; `watchPins` is its |
 * |                 | `listPins` read, again on each state notice of your user topic             |
 *
 * Every watch reads on a change, through `onNotice`.
 */
import { createClient, sessionFeed, topic, type Client, type SessionConnectionState, type SessionFeed, type WireNotice, type WireTopic } from "@flow-state-dev/client";
import { readBasePath, readBearerToken, readUserId, withBearerToken } from "@flow-state-dev/devtool/react";
import {
  createInboxClient,
  inboxItems,
  taskActionName,
  type BoardActions,
  type InboxAnswer,
  type InboxHold,
  type InboxRow,
  type TaskHold,
} from "@flow-state-dev/orchestration/inbox";
import { parseNotice, type TaskSpendView } from "@flow-state-dev/orchestration/tasks";
import { readRecordedWork, reviewDetail, type ReviewDetail } from "@flow-state-dev/harness-manager/browser";
import {
  createWorkforceClient,
  delegateAnswerOf,
  parseProjectRef,
  projectRef,
  WORK_PROJECT_STATE_KEY,
  WORKER_ID_STATE_KEY,
} from "@flow-state-dev/workforce/browser";
import { isSuspensionWait } from "@flow-state-dev/core/items";
import { OBSERVED_PLAN, OBSERVED_PLAN_LIST } from "@flow-state-dev/core/types";
import { modeById, modeOfWorker, MODES, type ModeId } from "./modes";
import { projectIdOf, refuseExisting } from "./lib/new-project";
import { waitingOnYou } from "./lib/columns";
import { resultSummary } from "./lib/result-summary";
import { toolRun, type ToolCallOf, type ToolRun } from "./lib/tool-steps";
import { toolInFlight, type PlanRowNow, type ToolCallNow } from "./components/flow-state/working-status";

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
  /** A run of consecutive tool calls in one turn, in words (`toolRun`): one line that opens to a line per call. */
  | ({ kind: "tool"; id: string } & ToolRun)
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
  /** When it started running, in ms: what its feed's elapsed time counts from. */
  startedAt?: number;
  /** What its runs spent, as the board's `listTasks` reads it (`taskSpendView`): model, harness, tokens; none before it runs. */
  spend?: TaskSpendView;
  /** Why its last attempt failed, as the board recorded it; only on a failed task. */
  error?: string;
}

/** A board's task changes, as the opened task's action row makes them: the board's own calls, refusals in its words. */
export type TaskBoardCalls = Pick<BoardActions, "cancel" | "steer" | "release" | "retry">;

/** A coding run's review stop's data, as harness-manager's browser reader reads it. */
export type { ReviewDetail };

/** The read-only work of one task. */
export interface TaskWork {
  entries: ThreadEntry[];
  /** Its run's latest review stop, when it made one. */
  review?: ReviewDetail;
  /** Present while the run holds items older than its first entry: adds the page before them. */
  loadEarlier?: () => Promise<void>;
  /** What its run is doing now, while the task runs. */
  working?: WorkingNow;
}

/** What a running task's run shows it doing now: the tool call still running, and the plan its harness recorded. */
export interface WorkingNow {
  inFlight?: ToolCallNow;
  /** `undefined` while the run records no plan. */
  plan?: PlanRowNow[];
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
  /** The task changes you make from an opened task, on the board of session `sessionId`. */
  taskActions(sessionId: string): TaskBoardCalls;
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

/** The conversation board's collection id: every task action the lab names is on it. */
const TASKS_BOARD = "tasks";

/** The action a row's hold is answered through, for the Inbox's reader: the board's `updateTask`. */
const UPDATE_TASK_ACTION = taskActionName("updateTask", TASKS_BOARD);

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
  /** A `tool_output` item's: the call it answers, and whether it is still going or threw. */
  toolCall?: { name?: string; arguments?: string };
  status?: string;
  /** A failed `tool_output` item's error: a `SUSPENSION` one is a call waiting on you (`isSuspensionWait`). */
  error?: { code?: string };
}


/** How often a session's task list reads on a timer, wherever push can miss a change. */
const TASKS_EVERY_MS = 2_000;
/** The ledgers a session's `listTasks` read returns: its board and its planning worker's steps. */
const BOARD_LEDGERS = ["tasks", "plan"] as const;

/**
 * A write to the plan a harness records (core's `observed-plan` rows and its
 * `observed-plan-list` markers). A row only its owner may read is published
 * unnamed, so an unnamed resource notice reads too.
 */
const isPlanWrite = (notice: WireNotice): boolean =>
  notice.kind === "resource" &&
  (notice.topic.resource === undefined ||
    notice.topic.resource.startsWith(`${OBSERVED_PLAN}/`) ||
    notice.topic.resource.startsWith(`${OBSERVED_PLAN_LIST}/`));

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
 * (FIX-2466), reporting a value only when it changed.
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

/** A `tool_output` item as the call it answers: its tool, its args, its status and its result. */
function callOf(item: Item): ToolCallOf {
  let args: unknown;
  try {
    args = JSON.parse(item.toolCall?.arguments ?? "{}");
  } catch {
    args = {};
  }
  const status = isSuspensionWait(item) ? "waiting" : item.status === "failed" ? "failed" : item.status === "in_progress" ? "running" : "done";
  return { id: item.id, name: item.toolCall?.name ?? item.blockName ?? "tool", args, status, ...(status === "done" ? { output: item.output } : {}) };
}

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
  const runs = new Map<string, ToolCallOf[]>();
  for (const item of items) {
    const requestId = item.requestId;
    const filed = threads ? filedTaskOf(item) : undefined;
    if (filed !== undefined) {
      entries.push({ kind: "thread", id: item.id, taskId: filed, requestId });
      continue;
    }
    if (item.type === "tool_output") {
      // A call right after another of the same turn joins its run.
      const last = entries[entries.length - 1];
      const calls = last?.kind === "tool" && last.requestId === requestId ? [...runs.get(last.id)!, callOf(item)] : [callOf(item)];
      const id = calls.length > 1 ? last!.id : item.id;
      runs.set(id, calls);
      const entry: ThreadEntry = { kind: "tool", id, ...toolRun(calls), requestId };
      if (calls.length > 1) entries[entries.length - 1] = entry;
      else entries.push(entry);
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

  /**
   * Keep `pending` under `key` in `cache` while it may succeed: a lookup that failed is dropped, so
   * the next read (a retry after a failure) asks again instead of failing on the kept rejection.
   */
  const keptUnlessFailed = <K, V>(cache: Map<K, Promise<V>>, key: K, pending: Promise<V>): Promise<V> => {
    cache.set(key, pending);
    pending.catch(() => {
      if (cache.get(key) === pending) cache.delete(key);
    });
    return pending;
  };

  /** The user's one session on a lab flow (`projects`, `pins`), found or made once. */
  const ownSessions = new Map<string, Promise<string>>();
  const ownSession = (flow: string) =>
    ownSessions.get(flow) ??
    keptUnlessFailed(
      ownSessions,
      flow,
      (async () => {
        const [latest] = (await fsd.sessions.list({ flowKind: flow, userId: fsd.userId })).sort((a, b) => b.updatedAt - a.updatedAt);
        return latest?.id ?? (await fsd.flow(flow).createSession()).id;
      })(),
    );
  const projects = () => ownSession("projects");

  /** Whether a session is threads mode's: its main worker is that mode's. Kept, since a session's worker never changes. */
  const threadsSessions = new Map<string, Promise<boolean>>();
  const isThreads = (sessionId: string) =>
    threadsSessions.get(sessionId) ??
    keptUnlessFailed(
      threadsSessions,
      sessionId,
      fsd.sessions.get(sessionId).then((detail) => {
        const worker = (detail.state as Record<string, unknown> | undefined)?.[WORKER_ID_STATE_KEY];
        return typeof worker === "string" && modeOfWorker(worker)?.pane === "board";
      }),
    );

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

  /**
   * One row of the sessions list. `complete` is false when its board couldn't be read: `waiting`
   * is then the count `held` showed (none for a row not shown yet), and the list reads it again.
   */
  type SessionRowRead = { row: SessionRow; complete: boolean };
  const rowOf = async (worker: string, sessionId: string, held?: SessionRow): Promise<SessionRowRead> => {
    const [detail, turns, title, waiting] = await Promise.all([
      fsd.sessions.get(sessionId),
      runningTurns(sessionId),
      titleOf(sessionId),
      waitingCountFor(sessionId),
    ]);
    const project = (detail.state as Record<string, unknown> | undefined)?.[WORK_PROJECT_STATE_KEY];
    return {
      row: {
        id: sessionId,
        title,
        worker,
        updatedAt: detail.updatedAt,
        running: turns.length > 0,
        waiting: waiting ?? held?.waiting ?? 0,
        projectId: typeof project === "string" ? project : null,
      },
      complete: waiting !== undefined,
    };
  };

  /**
   * How many of a session's tasks wait on you, read as the board reads them (its tasks and their
   * open holds), without the harness and review reads the board's cards add. A board that can't be
   * read is `undefined`, not none: the row keeps the count it showed, and the list reads it again
   * ({@link SessionRowRead}), so the list never fails on it and never shows a guess as read.
   */
  const waitingCountFor = async (sessionId: string): Promise<number | undefined> => {
    try {
      return waitingOnYou(await listedWithWaitingOn(sessionId));
    } catch (cause) {
      console.warn(`[claude-code-style] couldn't count what session ${sessionId} waits on you for:`, cause);
      return undefined;
    }
  };

  /** A listed task row, as much as the screen reads. */
  type Listed = TaskRow & { runSessionId?: string; run?: { sessionId: string; requestId: string }; holds?: TaskHold[]; attempts?: number };

  /** Each listed task's run session, by task id, as the last list saw it. */
  const runSessionOf = new Map<string, string>();
  /** Each running task's run (its session and request), by task id, as the last list saw it; none once it ended. */
  const runningRunOf = new Map<string, { sessionId: string; requestId: string }>();
  /** Told whenever a list moves a task's run session: a task's work follows the one the board names now. */
  const runLinkMoved = new Set<() => void>();

  /** The feed of each thread open on screen, by session id, so a send there can stream its answer into it. */
  const threadFeeds = new Map<string, SessionFeed>();

  /** A session's tasks, as its board's `listTasks` read answers them: a read, so a list stores no request. */
  const tasksOf = async (sessionId: string): Promise<Listed[]> => {
    const listed = await fsd
      .flow(await flowOfSession(sessionId))
      .read<{ ok: boolean; error?: string; tasks: any[] }>(taskActionName("listTasks", TASKS_BOARD), {}, { sessionId });
    if (!listed.ok) throw new Error(listed.error);
    let moved = false;
    for (const task of listed.tasks as any[]) {
      if (task.status === "in_progress" && typeof task.run?.sessionId === "string" && typeof task.run?.requestId === "string") {
        runningRunOf.set(task.id, { sessionId: task.run.sessionId, requestId: task.run.requestId });
      } else runningRunOf.delete(task.id);
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
      // The row's own start, else its run link's; rows before either carry neither (BP-030).
      ...(typeof (task.startedAt ?? task.run?.startedAt) === "number" ? { startedAt: task.startedAt ?? task.run.startedAt } : {}),
      ...(task.run?.sessionId === undefined ? {} : { runSessionId: task.run.sessionId, run: task.run }),
      ...(Array.isArray(task.holds) ? { holds: task.holds } : {}),
      ...(task.spend == null ? {} : { spend: task.spend }),
      ...(typeof task.attempts === "number" ? { attempts: task.attempts } : {}),
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
          .then((flow) => run(flow, sessionId, taskActionName("getTask", TASKS_BOARD), { id: task.id }))
          .then((read) => (read.task?.output?.review as TaskRow["review"]) ?? null),
      );
    }
    return reviews.get(task.id)!;
  };

  /**
   * Why a failed task's last attempt failed, from its `getTask` (a `listTasks` row carries no error).
   * Kept per attempt: a failed attempt's error never changes, and a retry is a new attempt.
   */
  const errors = new Map<string, Promise<string | undefined>>();
  const errorOf = (sessionId: string, task: Listed) => {
    const key = `${task.id}#${task.attempts ?? 0}`;
    return (
      errors.get(key) ??
      keptUnlessFailed(
        errors,
        key,
        flowOfSession(sessionId)
          .then((flow) => run(flow, sessionId, taskActionName("getTask", TASKS_BOARD), { id: task.id }))
          .then((read) => (typeof read.task?.error === "string" ? (read.task.error as string) : undefined)),
      )
    );
  };

  /** Session `sessionId`'s board, bound once its flow is known: every task change goes through it. */
  const boardAt = async (sessionId: string): Promise<BoardActions> =>
    inbox.board({ flowId: await flowOfSession(sessionId), sessionId, board: TASKS_BOARD });

  /** A session's board as the screen draws it: each row with what it waits on you for, its harness and its review. */
  const boardOf = async (sessionId: string) => {
    const listed = await listedWithWaitingOn(sessionId);
    const rows = await Promise.all(
      listed.map(async (task): Promise<TaskRow> => {
        const { runSessionId: _session, run: _run, holds: _holds, attempts: _attempts, ...row } = task;
        // The harness its run reported; until one reports, the assignee's `harness` setting.
        const harness = task.spend?.harness ?? (await harnessOf(task));
        const review = harness !== undefined && row.status === "completed" ? await reviewOf(sessionId, task) : undefined;
        const error = row.status === "errored" ? await errorOf(sessionId, task) : undefined;
        return {
          ...row,
          ...(harness === undefined ? {} : { harness }),
          ...(review === undefined ? {} : { review }),
          ...(error === undefined ? {} : { error }),
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
          let complete = true;
          try {
            if (relist) {
              relist = false;
              dirty.clear();
              const next = new Map<string, SessionRow>();
              for (const mode of modes) {
                const listed = await workforce.listWorkerSessions(mode.worker);
                for (const read of await Promise.all(listed.map((entry) => rowOf(mode.worker, entry.session.id, rows.get(entry.session.id))))) {
                  next.set(read.row.id, read.row);
                  complete &&= read.complete;
                }
              }
              rows = next;
            } else {
              const ids = [...dirty];
              dirty.clear();
              const reads = await Promise.all(ids.flatMap((id) => (rows.has(id) ? [rowOf(rows.get(id)!.worker, id, rows.get(id))] : [])));
              for (const read of reads) {
                if (rows.has(read.row.id)) rows.set(read.row.id, read.row);
                complete &&= read.complete;
              }
            }
            if (!live) break;
            tell();
            listen();
            // A row whose board couldn't be read is shown as it was, and read again like any failure.
            if (complete) retry.succeeded();
            else retry.failed();
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
    // The board's notices (FIX-2429): the topics are narrowed to the ledgers the read returns,
    // so every notice on them is the board's, and a reply streaming in the session never wakes it.
    watchTasks: (sessionId, onChange) =>
      onNotice(fsd, BOARD_LEDGERS.map((resource) => topic.session(sessionId, { resource })), () => true, () => boardOf(sessionId), onChange, TASKS_EVERY_MS),
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
        let work: TaskWork | undefined;
        let plan: PlanRowNow[] | undefined;
        const tell = () => {
          if (work === undefined) return;
          const { working: _, ...rest } = work;
          const inFlight = work.working?.inFlight;
          const working: WorkingNow = { ...(inFlight === undefined ? {} : { inFlight }), ...(plan === undefined ? {} : { plan }) };
          onChange(Object.keys(working).length === 0 ? rest : { ...rest, working });
        };
        const stopFeed = followItems(fsd, runSession, [...THREAD_ITEMS, "suspension"], (items, loadEarlier) => {
          const review = reviewStopOf(items);
          const inFlight = toolInFlight(items as never);
          work = {
            entries: entriesOf(items.filter((item) => item.type !== "suspension")),
            ...(review === undefined ? {} : { review }),
            ...(loadEarlier === undefined ? {} : { loadEarlier }),
            ...(inFlight === undefined ? {} : { working: { inFlight } }),
          };
          tell();
        }).stop;
        // A harness records its plan apart from the run's items: read again on each write to it, while the task runs.
        const stopPlan = onNotice(
          fsd,
          [topic.session(runSession)],
          isPlanWrite,
          async () => {
            const run = runningRunOf.get(taskId);
            if (run === undefined || run.sessionId !== runSession) return null;
            return (await readRecordedWork(fsd, run)).plan?.rows.map(({ title, status }) => ({ title, status })) ?? null;
          },
          (rows) => {
            plan = rows ?? undefined;
            tell();
          },
        );
        stopItems = () => {
          stopFeed();
          stopPlan();
        };
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
      await (await boardAt(sessionId)).steer(taskId, line);
    },
    // Bound per call, so the session's flow is read when a button is pressed, not when the row draws.
    taskActions: (sessionId) => ({
      cancel: async (id) => (await boardAt(sessionId)).cancel(id),
      steer: async (id, message) => (await boardAt(sessionId)).steer(id, message),
      release: async (id) => (await boardAt(sessionId)).release(id),
      retry: async (id) => (await boardAt(sessionId)).retry(id),
    }),
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
