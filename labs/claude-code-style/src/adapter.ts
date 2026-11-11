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
 * | `send`          | the worker's door, `respond`, in that session, with the line's files       |
 * | `upload`        | the client's `upload`: a file the composer attached, stored, as its reference |
 * | `readFile`      | the server's read route for a file a line carries, through the page's fetcher |
 * | `interrupt`     | aborting each turn running in the session when it is called                |
 * | `retry`         | the client's `request(id).retry()` on the session's flow: a failed turn again |
 * | `watchThread`   | the session's items, followed through the client's `sessionFeed`          |
 * |                 | and that feed's connection state, for the connection bar; `loadEarlier`    |
 * |                 | is the feed's, for a thread longer than its first read; its running turn   |
 * |                 | and the turns you stopped are the session's recent requests, read on each  |
 * |                 | request notice; `backgroundRunning` is the feed's unfinished runs          |
 * | `watchTasks`    | the conversation board's task-list view, and the rows' open holds          |
 * |                 | again on each notice of the board, through `client.subscribe`; a failed   |
 * |                 | row's error from its `getTask`, once per attempt; a row waiting on its pull |
 * |                 | request (harness-manager's `pullRequestWait`), with each one's link from its |
 * |                 | run session's pull-request record                                            |
 * | `watchTaskWork` | the items of a task's run session, followed through `sessionFeed`, with   |
 * |                 | its `loadEarlier` too, from the moment the board's read names that session; |
 * |                 | while the task runs, the tool call in flight (the UI registry's            |
 * |                 | `working-status`), from the run request's own stream too, which sends a   |
 * |                 | call as it starts; and harness-manager's `readRecordedWork`, for the plan |
 * |                 | its harness recorded, read on each write to it and on a re-run's request  |
 * | `sayInThread`   | the Inbox client's answer to the thread's open question, else the board's `steer` |
 * | `taskActions`   | the Inbox client's `board(at)` on the session that holds the board: `cancel`, |
 * |                 | `steer`, `release` and `retry`, each the board's own action                 |
 * | `resolve`       | the Inbox client's answer to the thread's review: `{ verdict: "accepted" }`, naming its `land` when one is given |
 * | `requestChanges`| the same answer with `{ verdict: "revise", words }`                        |
 * | `watchPins`, `pin`, `unpin` | your `lab-pins` user resource: read by scope with no session, again on |
 * |                 | each notice of it on your user topic; written through the default write flow |
 * | `watchDismissed`, `dismiss` | your `lab-dismissals` user resource, read and written the way pins are |
 *
 * Every watch reads on a change, through the client's live read (`client.live`).
 */
import { bindStoreToCallbacks, createClient, createRequestStreamStore, sessionFeed, topic, type Client, type ClientFetch, type SessionConnectionStatus, type SessionFeed, type WireNotice, type WireTopic } from "@flow-state-dev/client";
import { readBasePath, readBearerToken, readUserId, withBearerToken } from "@flow-state-dev/devtool/react";
import {
  createInboxClient,
  inboxItems,
  taskActionName,
  taskListViewRef,
  type BoardActions,
  type InboxAnswer,
  type InboxHold,
  type InboxTaskInput,
  type TaskHold,
  type TaskView,
  taskView,
} from "@flow-state-dev/orchestration/inbox";
import { parseNotice, type TaskSpendView } from "@flow-state-dev/orchestration/tasks";
import {
  pullRequestWait,
  readSessionPullRequests,
  readRecordedWork,
  reviewDetail,
  type PullRequestRecordResourceState,
  type PullRequestWaitInput,
  type ReviewDetail,
} from "@flow-state-dev/harness-manager/browser";
import {
  createWorkforceClient,
  delegateAnswerOf,
  parseProjectRef,
  taskBriefOf,
  projectRef,
  WORK_PROJECT_STATE_KEY,
  WORKER_ID_STATE_KEY,
} from "@flow-state-dev/workforce/browser";
import { isSuspensionWait, type FileContent } from "@flow-state-dev/core/items";
import { OBSERVED_PLAN, OBSERVED_PLAN_LIST } from "@flow-state-dev/core/harness";
import { modeById, modeOfWorker, MODES, type ModeId } from "./modes";
import { projectIdOf, refuseExisting } from "./lib/new-project";
import type { HarnessReadinessChipRow } from "./components/flow-state/harness-readiness";
import type { LandedWork, ReviewAnswer, ReviewLand } from "./components/flow-state/review-hold";
import { dismissalKey, taskOfDismissal, waitingOnYou } from "./lib/columns";
import { labDismissals, labPins } from "../workforce/flows/user-marks.mts";
import { resultSummary } from "./lib/result-summary";
import { firstLineOfText, NEW_SESSION_TITLE, sessionTitle } from "./lib/session-title";
import { filedTaskOf, toolRun, type ToolCallOf, type ToolRun } from "./lib/tool-steps";
import { toolInFlight, type PlanRowNow, type ToolCallNow } from "./components/flow-state/working-status";
import type { AttachmentUploader } from "./components/flow-state/attachments";
import { parseBlobRef } from "@flow-state-dev/core/attachments";

/** Stops a watch. */
export type Unsubscribe = () => void;

/** One row of the sessions list. */
export interface LabSession {
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
export interface LabProject {
  id: string;
  name: string;
}

/** One entry in a thread, in the order it happened, with the request it came from when known. */
export type ThreadEntry = (
  | {
      kind: "user";
      id: string;
      text: string;
      /** The files the line carries, as references, in the order attached. */
      files?: FileContent[];
      /** Threads mode: the lead's turn filed threads for this line. */
      sentToThread?: boolean;
    }
  /** What a task's session was handed: its brief, as filed or re-queued. One folded line, never your line. */
  | { kind: "brief"; id: string; text: string }
  /** `incomplete` when its turn failed before the reply was finished. */
  | { kind: "assistant"; id: string; text: string; incomplete?: boolean }
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
  /** A turn you stopped: its request ended `aborted`. It follows that request's last entry. */
  | { kind: "stopped"; id: string }
  /**
   * A turn that failed, from the engine's `error` item: its reason, and `retryable` when Retry is
   * offered on it: it is the thread's newest turn, and one the engine will run again for you.
   */
  | { kind: "failed"; id: string; reason: string; code?: string; details?: Record<string, unknown>; retryable: boolean }
  /** Threads mode: a thread the lead filed, where its `createTask` call is. The card reads the task. */
  | { kind: "thread"; id: string; taskId: string }
) & { requestId?: string };

/** A session feed's connection: `lapsed` once a retry has failed, `stopped` once it gives up. */
export type ConnectionState = SessionConnectionStatus;

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
  /** From an `interrupt` until every turn it aborted has ended. */
  stopping: boolean;
  /**
   * The session's background work still running: its unfinished runs as the session stream names
   * them, whichever turn started them. `null` until the stream has named them: unknown is not zero.
   */
  backgroundRunning: number | null;
  /** Present while the thread holds items older than its first entry: adds the page before them. */
  loadEarlier?: () => Promise<void>;
}

/** A task's status, as the task tools name it. */
export type TaskStatus = "pending" | "in_progress" | "held" | "completed" | "errored" | "cancelled";

/** One background task, as a `listTasks` row carries it. */
export interface LabTask {
  id: string;
  title: string;
  goal: string;
  status: TaskStatus;
  assignee?: string;
  /** The worker's last one-line progress note. */
  statusNote?: string;
  /** What the task waits on you for: a question it holds on, or its run's stop for your approval or review. */
  openHold?: { kind: "approval" | "input" | "review" | "question"; prompt: string };
  /** The coding harness the assignee runs through, from its `harness` setting; none for a plain worker. */
  harness?: string;
  /**
   * The pull requests the task waits on to merge or close (harness-manager's
   * `awaitPullRequests`): its run is done and its work is not, so it stays
   * open. Each with its link when its run session's record has one. Absent
   * while it waits on none.
   */
  pullRequests?: { number: number | null; url: string | null; title: string | null }[];
  /**
   * How a harness run's review ended, from its output: `accepted` when you
   * resolved it, `deadline` when nobody answered by the review deadline
   * and it completed unreviewed, none when no review was asked.
   */
  review?: "accepted" | "deadline" | null;
  /**
   * For an accepted coding task, where its work went: the pull request opened, or the merge into
   * your checkout, as the run's output records it. Absent until a landing has happened.
   */
  landed?: LandedWork;
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
  /** How many attempts it has made, as the board counts them; a dismissal is kept per attempt (`dismissalKey`). */
  attempts?: number;
  /** The row as orchestration's `taskView` reads it, once per read: its state and times, for its time signal and the pane's counts. */
  view?: TaskView;
  /**
   * What the view doesn't carry, for the time signal: when this attempt's run started (its run link's
   * `startedAt`), and the row's lease deadline, which a live run keeps renewing. Each absent until the row has it.
   */
  run?: { startedAt?: number; leaseUntil?: number };
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
  /** The id of that stop: one per review round, so an accept can tell a new round from the one it answered. */
  reviewStop?: string;
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

/** One coding harness's readiness, as harness-manager's readiness action answers it. */
export type LabHarness = HarnessReadinessChipRow;

/** Whether a run could check a repository out on this machine: the projects flow's `checkRepository`. */
export type RepositoryCheck = { usable: true; how: "worktree" | "clone" } | { usable: false; problem: string };

/** Everything the screen reads and writes. */
export interface LabAdapter {
  /** The modes this adapter runs; the view switch shows the others disabled. */
  readonly modes: readonly ModeId[];
  watchSessions(onChange: (rows: LabSession[]) => void): Unsubscribe;
  listProjects(): Promise<LabProject[]>;
  /** A new project of yours on a git repository, which you may then work in. */
  createProject(name: string, repository: string): Promise<LabProject>;
  /** Whether a coding run could use `repository` here, and what happens to it; the same check `createProject` refuses with. */
  checkRepository(repository: string): Promise<RepositoryCheck>;
  /** Which coding harnesses can run on this machine; `refresh` checks them again (Re-check). */
  readHarnesses(refresh?: boolean): Promise<LabHarness[]>;
  openSession(mode: ModeId, projectId: string): Promise<LabSession>;
  /** Send a line to the session's main worker, with the files attached to it, as references (`upload`). */
  send(sessionId: string, text: string, attachments?: readonly FileContent[]): Promise<void>;
  /** Store a file the composer attached; resolves to its reference, which a line then carries. */
  upload: AttachmentUploader["upload"];
  /** The bytes of a file a line carries, for its thumbnail; rejects when the server won't serve it. */
  readFile(file: FileContent): Promise<Blob>;
  interrupt(sessionId: string): Promise<void>;
  /** Run a failed turn of the session again, as a new request the engine links to `requestId`. */
  retry(sessionId: string, requestId: string): Promise<void>;
  watchThread(sessionId: string, onChange: (view: ThreadView) => void): Unsubscribe;
  /**
   * The session's tasks, on each change; `onStale` hears `true` when a read fails (the
   * rows handed last are kept, so they may be old) and `false` when one succeeds again.
   */
  watchTasks(sessionId: string, onChange: (rows: LabTask[]) => void, onStale?: (stale: boolean) => void): Unsubscribe;
  watchTaskWork(sessionId: string, taskId: string, onChange: (work: TaskWork) => void): Unsubscribe;
  /** Talk inside a thread: a steer on its task, which answers its open question if it has one. */
  sayInThread(sessionId: string, taskId: string, line: string): Promise<void>;
  /** The task changes you make from an opened task, on the board of session `sessionId`. */
  taskActions(sessionId: string): TaskBoardCalls;
  /**
   * Accept a thread's work: answers its review wait. `land` names how the work lands (a pull
   * request, or a merge into your checkout); absent, the accept is plain.
   */
  resolve(sessionId: string, taskId: string, land?: ReviewLand): Promise<void>;
  /** Send a thread back to work: answers its review wait with your words. */
  requestChanges(sessionId: string, taskId: string, words: string): Promise<void>;
  /** Your pinned task ids. */
  watchPins(onChange: (taskIds: string[]) => void): Unsubscribe;
  pin(taskId: string): Promise<void>;
  unpin(taskId: string): Promise<void>;
  /** The failed attempts you dismissed, as `dismissalKey`s. */
  watchDismissed(onChange: (keys: string[]) => void): Unsubscribe;
  /** Dismiss a failed task's attempt: it leaves *Waiting on you* for *Resolved*. */
  dismiss(task: Pick<LabTask, "id" | "attempts">): Promise<void>;
}

/** The lab flow whose `read` action is harness-manager's readiness action (`fsdev.config.mts`). */
const READINESS_FLOW = "harness-readiness";

/** How often an open view reads again, in ms. */
const READ_EVERY_MS = 1500;

/** How many of a session's recent requests the thread reads for its turns' states. */
const RECENT_TURNS = 50;

/** The requests that are a turn of the main session: a user's line, or a background result after the turn. */
const TURN_ACTIONS = new Set(["respond", "onTaskSettled"]);

/**
 * The notices on a listed session's topic that may change its row: a turn (its running state, its
 * title), a board change (what it waits on you for), and a resource. Never `items`.
 */
const ROW_CHANGES: ReadonlySet<string> = new Set(["request", "board", "resource"]);

/** The conversation board's collection id: every task action the lab names is on it. */
const TASKS_BOARD = "tasks";

/** The action a row's hold is answered through, for the Inbox's reader: the board's `updateTask`. */
const UPDATE_TASK_ACTION = taskActionName("updateTask", TASKS_BOARD);

/** The flow a coding worker runs on: its run sessions answer which harness it is (`harness`). */
const CODING_FLOW = "harness-thread";

/**
 * The request sources the engine retries for a caller (`PUBLIC_REENTRY_SOURCES`): a turn that came
 * in another way, such as a worker's message (`internal`) or a task's run (`task`), it refuses.
 * A copy, since the page can't import the engine; a test pins it to the engine's.
 */
export const RETRYABLE_SOURCES: ReadonlySet<string> = new Set(["http", "mcp", "scheduled"]);

/** The item types a thread draws: a failed turn's `error` item too. */
const THREAD_ITEMS = ["message", "tool_output", "error"];

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
  /** An `error` item's: why its turn failed. */
  message?: string;
  code?: string;
  details?: Record<string, unknown>;
}


/** How often a session's task list reads on a timer, wherever push can miss a change. */
const TASKS_EVERY_MS = 2_000;

/**
 * A write to the plan a harness records (core's `observed-plan` rows and its
 * `observed-plan-list` markers), as a live read hears it. A row only its owner
 * may read is published unnamed, and the live read hears an unnamed resource
 * notice whatever its paths say.
 */
const PLAN_WRITES = {
  hear: (notice: WireNotice) => notice.kind === "resource",
  paths: [OBSERVED_PLAN, OBSERVED_PLAN_LIST],
};

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

/** A live read's failure, logged; the read tries again on its own (`client.live`). */
const logFailedRead = (error: unknown): void => console.warn("[claude-code-style]", error);

/**
 * A run's latest review stop, read with harness-manager's browser reader, or
 * undefined before it makes one. The latest wins: a run sent back for changes
 * stops for review again.
 */
export function reviewStopOf(items: readonly Item[]): ReviewDetail | undefined {
  const stop = latestReviewStop(items);
  return (stop && reviewDetail(stop.data)) ?? undefined;
}

/** The latest review stop's item, or undefined before the run makes one. */
const latestReviewStop = (items: readonly Item[]) => [...items].reverse().find((item) => item.type === "suspension" && item.kind === "review");

/**
 * The id of the latest review stop: one id per review round. A run sent back, or a landing retried,
 * stops for review again under a new id, which is how the accept tells a new round from the one it answered.
 */
export function reviewStopIdOf(items: readonly Item[]): string | undefined {
  return latestReviewStop(items)?.id;
}

/**
 * The verdict an accept sends: plain, or naming how the work lands. Without a `land` the key is
 * absent, so a plain accept on a run that can't land reads as it always did. Exported for its tests.
 */
export function acceptOf(land?: ReviewLand): ReviewAnswer {
  return land === undefined ? { verdict: "accepted" } : { verdict: "accepted", land };
}

/**
 * Where an accepted run's work went, from its output's `landed`, or nothing when it names none
 * readable. Exported for its tests.
 */
export function landedOf(value: unknown): LandedWork | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  if (v.kind === "pull-request" && typeof v.url === "string" && typeof v.number === "number" && typeof v.branch === "string" && typeof v.base === "string") {
    return { kind: "pull-request", url: v.url, number: v.number, branch: v.branch, base: v.base };
  }
  if (v.kind === "merge" && typeof v.branch === "string" && typeof v.commit === "string" && typeof v.checkout === "string" && typeof v.from === "string") {
    return { kind: "merge", branch: v.branch, commit: v.commit, checkout: v.checkout, from: v.from };
  }
  return undefined;
}

const textOf = (item: Item) => (item.content ?? []).map((part) => part.text ?? "").join("");

/** The files a message carries: its `file` parts, references to the stored bytes. */
const filesOf = (item: Item): FileContent[] =>
  (item.content ?? []).filter(
    (part): part is FileContent => part.type === "file" && typeof (part as Partial<FileContent>).data === "string" && typeof (part as Partial<FileContent>).mediaType === "string",
  );

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

/** The task a `createTask` item filed (`filedTaskOf`, the rule its start line reads too), or undefined. */
const filedTaskOfItem = (item: Item): string | undefined => (item.type === "tool_output" ? filedTaskOf(callOf(item)) : undefined);

/**
 * A thread's entries, from its items in order. A result is the line the main session took a task's ending as,
 * and so is a delegate's answer that landed in the conversation as written (a task filed with `resultTo:
 * "conversation"`): either way the task's reply is one line, not the session's own words.
 * In threads mode (`threads`), a task the lead filed is a thread card where its `createTask` call is, and
 * your line is marked when its turn filed one. A failed turn's `error` item is a failed entry, `retryable`
 * when it is the newest turn and one of `retryableTurns` (the requests the engine will retry), and a reply
 * that turn never finished is marked incomplete.
 */
export function entriesOf(items: readonly Item[], threads = false, retryableTurns: ReadonlySet<string> = new Set()): ThreadEntry[] {
  // A turn a user's line started holds that line; a notice's own turn holds none.
  const userTurns = new Set(
    items.filter((item) => item.type === "message" && item.role === "user" && taskBriefOf(item) === undefined).map((item) => item.requestId),
  );
  const filingTurns = new Set(items.filter((item) => filedTaskOfItem(item) !== undefined).map((item) => item.requestId));
  // A turn that failed; its reply, if it never finished, is marked incomplete. Retry is offered on the newest turn only.
  const failedTurns = new Set(items.filter((item) => item.type === "error").map((item) => item.requestId));
  const entries: ThreadEntry[] = [];
  const runs = new Map<string, ToolCallOf[]>();
  for (const item of items) {
    const requestId = item.requestId;
    const filed = threads ? filedTaskOfItem(item) : undefined;
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
    if (item.type === "error") {
      entries.push({
        kind: "failed",
        id: item.id,
        reason: item.message ?? "",
        ...(item.code === undefined ? {} : { code: item.code }),
        ...(item.details === undefined ? {} : { details: item.details }),
        retryable: false,
        requestId,
      });
      continue;
    }
    const text = textOf(item);
    // A task's brief is a `user` line for its model's history, but you never typed it.
    if (item.role === "user" && taskBriefOf(item) !== undefined) {
      entries.push({ kind: "brief", id: item.id, text, requestId });
      continue;
    }
    if (item.role === "user") {
      const files = filesOf(item);
      entries.push({
        kind: "user",
        id: item.id,
        text,
        requestId,
        ...(files.length > 0 ? { files } : {}),
        ...(threads && filingTurns.has(requestId) ? { sentToThread: true } : {}),
      });
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
    if (text.length > 0) {
      const incomplete = failedTurns.has(requestId) && item.status !== "completed";
      entries.push({ kind: "assistant", id: item.id, text, ...(incomplete ? { incomplete: true } : {}), requestId });
    }
  }
  // The newest turn is the one that drew the last entry: an item that draws none (a retried notice,
  // an empty message) does not move it.
  const newestTurn = entries[entries.length - 1]?.requestId;
  return entries.map((entry) =>
    entry.kind === "failed" && entry.requestId !== undefined && entry.requestId === newestTurn && retryableTurns.has(entry.requestId) ? { ...entry, retryable: true } : entry,
  );
}

/**
 * A thread's entries with a `stopped` line after the last entry of each turn you stopped (`stopped`,
 * its request ids). A stopped turn with no entry in the loaded window gets no line: there is nowhere
 * true to put it.
 */
function withStopped(entries: readonly ThreadEntry[], stopped: ReadonlySet<string>): ThreadEntry[] {
  if (stopped.size === 0) return [...entries];
  const lastOf = new Map<string, number>();
  entries.forEach((entry, at) => {
    if (entry.requestId !== undefined && stopped.has(entry.requestId)) lastOf.set(entry.requestId, at);
  });
  const after = new Map([...lastOf].map(([requestId, at]) => [at, requestId]));
  return entries.flatMap((entry, at) => {
    const requestId = after.get(at);
    return requestId === undefined ? [entry] : [entry, { kind: "stopped" as const, id: `stopped:${requestId}`, requestId }];
  });
}

/** The adapter the app runs on: the served lab, as the user the page was served for. */
export function createLabAdapter(): LabAdapter {
  const fetcher = withBearerToken(readBearerToken());
  return createWiredLab(createClient({ userId: readUserId(), baseUrl: readBasePath(), fetcher }), { basePath: readBasePath(), fetcher });
}

/** How the page reaches the server outside the client: where its API is mounted, and the fetch that authenticates. */
export interface LabConnection {
  basePath?: string;
  fetcher?: ClientFetch;
}

/**
 * A file's bytes through the server's read route. Read with the page's own fetch rather than a plain
 * `<img src>`, which can't carry the bearer token `fsdev dev` may serve the page with.
 */
function fileReader({ basePath = "", fetcher = (input, init) => fetch(input, init) }: LabConnection) {
  return async (file: FileContent): Promise<Blob> => {
    const id = parseBlobRef(file.data);
    if (id === undefined) throw new Error(`${file.filename ?? "The file"} is not a stored file.`);
    const response = await fetcher(`${basePath.replace(/\/+$/, "")}/api/flows/blobs/${id}`);
    if (!response.ok) throw new Error(`${file.filename ?? "The file"} couldn't be read (${response.status}).`);
    return await response.blob();
  };
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
  onRuns?: (count: number | null) => void,
): { feed: SessionFeed; stop: Unsubscribe } {
  const feed = sessionFeed(fsd, sessionId, { itemTypes: [...types] });
  const loadEarlier = () => feed.loadEarlier();
  let last: readonly unknown[] | undefined;
  let lastState: ConnectionState | undefined;
  let lastRuns: number | null | undefined;
  const stop = feed.subscribe(({ items, hasEarlier, state, runs }) => {
    if (state !== lastState) {
      lastState = state;
      onState?.(state);
    }
    const count = runs === null ? null : runs.length;
    if (count !== lastRuns) {
      lastRuns = count;
      onRuns?.(count);
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

/**
 * The tool calls of one request as its own stream sends them: each one as it
 * starts, not only once finished, as the session stream sends them. For what
 * a running task is in now. A dropped connection is opened again after a
 * backoff (1 s, doubling to 30 s), resuming after the last event it heard,
 * until the request ends or the watch stops. An answer that says the request
 * is not there for you (401, 403, 404) stops it; the session feed's finished
 * copies stand.
 */
function followRequestCalls(fsd: Client, flow: Promise<string>, requestId: string, onItems: (items: readonly Item[]) => void): Unsubscribe {
  const store = createRequestStreamStore();
  let live = true;
  let handle: { close(): void } | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  const open = (flowKind: string): void => {
    if (!live) return;
    const heard = store.lastSequenceNumber;
    handle = fsd.flow(flowKind).request(requestId).stream({
      ...(heard > 0 ? { startingAfter: heard } : {}),
      ...bindStoreToCallbacks(store, {
        itemFilter: (item) => item.type === "tool_output",
        onChange: () => {
          failures = 0;
          store.flushDeltas();
          if (live) onItems(store.getSorted() as unknown as Item[]);
        },
      }),
      onError: (error) => {
        handle?.close();
        handle = undefined;
        if (!live || store.status !== "in_progress" || STREAM_GONE.has((error as { status?: number }).status ?? 0)) return;
        retry = setTimeout(() => open(flowKind), Math.min(30_000, 1_000 * 2 ** failures));
        failures += 1;
      },
    });
  };
  flow.then(open, (error) => console.warn("[claude-code-style]", error));
  return () => {
    live = false;
    if (retry !== undefined) clearTimeout(retry);
    handle?.close();
  };
}

/** A request stream's answers that mean it is not there for this caller: opening it again cannot help. */
const STREAM_GONE: ReadonlySet<number> = new Set([401, 403, 404]);

/**
 * The call a run is in now, from both of its sources: the request's own
 * stream, which sends a call as it starts, and the session feed, whose
 * finished copy of a call wins over a streamed copy that never heard its end.
 * The feed's own candidates are the run request's only (`requestId`, else the
 * newest request's): a reused session keeps the call a crashed earlier request
 * left half-done for good, and that is not what the run is doing now.
 */
function inFlightOf(streamed: readonly Item[], fed: readonly Item[], requestId: string | null | undefined): ToolCallNow | undefined {
  const finished = new Set(fed.filter((item) => item.status !== "in_progress").map((item) => item.id));
  const request = requestId ?? fed[fed.length - 1]?.requestId;
  return toolInFlight(streamed.filter((item) => !finished.has(item.id)) as never) ?? toolInFlight(fed.filter((item) => item.requestId === request) as never);
}

/** The adapter over one client. */
export function createWiredLab(fsd: Client, connection: LabConnection = {}): LabAdapter {
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
    const { status, error, output: answered } = await started.result();
    if (status !== "completed") throw new Error(error?.message ?? `${action} ended ${status}`);
    const output = answered as { ok?: boolean; error?: string } | undefined;
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
  /** Of a session's requests, its turns still running, oldest first. */
  const turnsRunningIn = (requests: Awaited<ReturnType<typeof fsd.sessions.requests>>) =>
    requests
      .filter((request) => request.status === "in_progress" && TURN_ACTIONS.has(request.actionName))
      .sort((a, b) => (a.startedAtMs ?? 0) - (b.startedAtMs ?? 0));
  const runningTurns = async (sessionId: string) => turnsRunningIn(await fsd.sessions.requests(sessionId, { status: "in_progress", limit: 50 }));

  /**
   * Each session's stop under way: the turns an `interrupt` aborted (`ids`, `null` while it reads
   * which are running), until the thread's request read shows every one ended. `wake` tells the
   * session's open threads to draw again.
   */
  const stops = new Map<string, { ids: Set<string> | null }>();
  const stopWatchers = new Map<string, Set<() => void>>();
  const wake = (sessionId: string) => stopWatchers.get(sessionId)?.forEach((tell) => tell());

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

  /**
   * The first line of a session's first message: the fallback title (`sessionTitle`). Kept once
   * read, since a first line never changes; a session with no message yet is read again.
   */
  const firstLines = new Map<string, string>();
  const firstLineOf = async (sessionId: string): Promise<string | undefined> => {
    if (!firstLines.has(sessionId)) {
      const first = (await itemsOf(sessionId)).find((item) => item.role === "user");
      if (first === undefined) return undefined;
      firstLines.set(sessionId, firstLineOfText(textOf(first)));
    }
    return firstLines.get(sessionId);
  };

  /**
   * One row of the sessions list. `complete` is false when its board couldn't be read: `waiting`
   * is then the count `held` showed (none for a row not shown yet), and the list reads it again.
   */
  type LabSessionRead = { row: LabSession; complete: boolean };
  const rowOf = async (worker: string, sessionId: string, dismissed: ReadonlySet<string>, held?: LabSession): Promise<LabSessionRead> => {
    const [detail, turns, waiting] = await Promise.all([fsd.sessions.get(sessionId), runningTurns(sessionId), waitingCountFor(sessionId, dismissed)]);
    // The first message's first line is the fallback until the generated title lands.
    const firstLine = detail.title?.trim() ? undefined : await firstLineOf(sessionId);
    const project = (detail.state as Record<string, unknown> | undefined)?.[WORK_PROJECT_STATE_KEY];
    return {
      row: {
        id: sessionId,
        title: sessionTitle({ title: detail.title, firstLine }),
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
   * ({@link LabSessionRead}), so the list never fails on it and never shows a guess as read.
   */
  const waitingCountFor = async (sessionId: string, dismissed: ReadonlySet<string>): Promise<number | undefined> => {
    try {
      return waitingOnYou((await listedWithWaitingOn(sessionId)).tasks, dismissed);
    } catch (cause) {
      console.warn(`[claude-code-style] couldn't count what session ${sessionId} waits on you for:`, cause);
      return undefined;
    }
  };

  /** A listed task, as much as the screen reads. */
  type Listed = Omit<LabTask, "run"> & {
    runSessionId?: string;
    run?: { sessionId: string; requestId: string; startedAt?: number };
    holds?: TaskHold[];
    attempts?: number;
    leaseUntil?: number;
  };

  /** Each listed task's run session, by task id, as the last list saw it. */
  const runSessionOf = new Map<string, string>();
  /** Each running task's run (its session and request), by task id, as the last list saw it; none once it ended. */
  const runningRunOf = new Map<string, { sessionId: string; requestId: string }>();
  /** Told whenever a list moves a task's run session: a task's work follows the one the board names now. */
  const runLinkMoved = new Set<() => void>();

  /** The feed of each thread open on screen, by session id, so a send there can stream its answer into it. */
  const threadFeeds = new Map<string, SessionFeed>();

  /**
   * A session's tasks, as its board's task-list view answers them (a view, so a list stores no
   * request), and the topics a change to them publishes on, from the view's answer.
   */
  const tasksAndTopicsOf = async (sessionId: string): Promise<{ tasks: Listed[]; topics: WireTopic[] }> => {
    const answer = await fsd.view(taskListViewRef(await flowOfSession(sessionId), TASKS_BOARD), {}, { sessionId });
    const listed = answer.value as any[];
    let moved = false;
    for (const task of listed) {
      const ranAs = runningRunOf.get(task.id)?.requestId;
      if (task.status === "in_progress" && typeof task.run?.sessionId === "string" && typeof task.run?.requestId === "string") {
        runningRunOf.set(task.id, { sessionId: task.run.sessionId, requestId: task.run.requestId });
      } else runningRunOf.delete(task.id);
      // A re-run in the same session is a new request: what the task is in now moved with it.
      if (runningRunOf.get(task.id)?.requestId !== ranAs) moved = true;
      if (task.run?.sessionId === undefined || runSessionOf.get(task.id) === task.run.sessionId) continue;
      runSessionOf.set(task.id, task.run.sessionId);
      moved = true;
    }
    if (moved) for (const tell of [...runLinkMoved]) tell();
    const tasks = listed.map((task): Listed => ({
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
      ...(typeof task.leaseUntil === "number" ? { leaseUntil: task.leaseUntil } : {}),
      view: taskView({ ...task, board: sessionId }),
    }));
    return { tasks, topics: answer.topics };
  };
  /** A session's tasks, as {@link tasksAndTopicsOf} reads them. */
  const tasksOf = async (sessionId: string): Promise<Listed[]> => (await tasksAndTopicsOf(sessionId)).tasks;

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
    const rows: InboxTaskInput[] = listed.map((task) => ({
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

  /**
   * A session's tasks, each with what its first open hold waits on you for: the one place a hold
   * becomes a row's `openHold`. With the topics the board's view named.
   */
  const listedWithWaitingOn = async (sessionId: string): Promise<{ tasks: Listed[]; topics: WireTopic[] }> => {
    const { tasks: listed, topics } = await tasksAndTopicsOf(sessionId);
    const holds = await holdsOf(sessionId, listed);
    const tasks = listed.map((task) => {
      const hold = holds.get(task.id)?.[0];
      return hold === undefined
        ? task
        : { ...task, openHold: { kind: hold.ask.kind === "confirm" ? "input" : hold.ask.kind, prompt: hold.ask.prompt } };
    });
    return { tasks, topics };
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

  /**
   * A coding task's output as its `getTask` carries it (a `listTasks` row never does): how its review
   * ended, and where its work landed. Kept per status, so a status change reads it again; a read that
   * fails is tried again on the next poll.
   */
  const outputs = new Map<string, Promise<Record<string, unknown>>>();
  const outputOf = (sessionId: string, task: Listed) => {
    const key = `${task.id}#${task.attempts ?? 0}#${task.status}`;
    return (
      outputs.get(key) ??
      keptUnlessFailed(
        outputs,
        key,
        flowOfSession(sessionId)
          .then((flow) => run(flow, sessionId, taskActionName("getTask", TASKS_BOARD), { id: task.id }))
          .then((read) => (read.task?.output as Record<string, unknown> | undefined) ?? {}),
      )
    );
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

  /**
   * The rows of a run session's pull-request record (`readSessionPullRequests`), read once per
   * wait: `key` is the wait's hold id, which a new wait replaces, so a later run's pull request is
   * read then and the board's poll reads nothing more. A read that fails is tried again on the next
   * poll; until one succeeds the wait shows its numbers, without links.
   */
  const pullRequestReads = new Map<string, Promise<PullRequestRecordResourceState[]>>();
  const pullRequestRecords = async (runSession: string, key: string): Promise<PullRequestRecordResourceState[]> => {
    try {
      return await (pullRequestReads.get(key) ?? keptUnlessFailed(pullRequestReads, key, readSessionPullRequests(fsd, runSession)));
    } catch (cause) {
      console.warn(`[claude-code-style] couldn't read the pull requests of run session ${runSession}:`, cause);
      return [];
    }
  };

  /** What a listed task's open pull-request wait reads, or `undefined` when it waits on none. */
  const waitOf = (task: Listed, records: readonly PullRequestRecordResourceState[] = []) =>
    pullRequestWait({ status: task.status, holds: (task.holds ?? []) as unknown as PullRequestWaitInput["holds"] }, records);

  /** The pull requests a listed task waits on, each with its link from its run session's record; `undefined` when it waits on none. */
  const pullRequestsOf = async (task: Listed): Promise<LabTask["pullRequests"]> => {
    const wait = waitOf(task);
    if (wait === null) return undefined;
    const records = task.runSessionId === undefined ? [] : await pullRequestRecords(task.runSessionId, `${task.runSessionId}#${wait.holdId}`);
    return waitOf(task, records)?.pullRequests.map(({ number, url, title }) => ({ number, url, title }));
  };

  /** Session `sessionId`'s board, bound once its flow is known: every task change goes through it. */
  const boardAt = async (sessionId: string): Promise<BoardActions> =>
    inbox.board({ flowId: await flowOfSession(sessionId), sessionId, board: TASKS_BOARD });

  /** A session's board as the screen draws it: each row with what it waits on you for, its harness and its review. */
  /** A session's board as its cards show it, and the topics the board's view named. */
  const boardOf = async (sessionId: string) => {
    const { tasks: listed, topics } = await listedWithWaitingOn(sessionId);
    const rows = await Promise.all(
      listed.map(async (task): Promise<LabTask> => {
        const { runSessionId: _session, run: link, holds: _holds, leaseUntil, ...row } = task;
        const run = { ...(typeof link?.startedAt === "number" ? { startedAt: link.startedAt } : {}), ...(leaseUntil === undefined ? {} : { leaseUntil }) };
        // The harness its run reported; until one reports, the assignee's `harness` setting.
        const harness = task.spend?.harness ?? (await harnessOf(task));
        const pullRequests = await pullRequestsOf(task);
        // A coding task's output says how its review ended and where its work landed. Landing happens on an accept,
        // so the output is read once the run is done, or while it waits on a pull request it opened.
        const output = harness !== undefined && (row.status === "completed" || pullRequests !== undefined) ? await outputOf(sessionId, task) : undefined;
        const review = harness !== undefined && row.status === "completed" ? ((output?.review as LabTask["review"]) ?? null) : undefined;
        const landed = landedOf(output?.landed);
        const error = row.status === "errored" ? await errorOf(sessionId, task) : undefined;
        return {
          ...row,
          ...(Object.keys(run).length === 0 ? {} : { run }),
          ...(harness === undefined ? {} : { harness }),
          ...(pullRequests === undefined ? {} : { pullRequests }),
          ...(review === undefined ? {} : { review }),
          ...(landed === undefined ? {} : { landed }),
          ...(error === undefined ? {} : { error }),
        };
      }),
    );
    return { value: rows, topics };
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

  /** Your pins and the failures you dismissed: user resources, read by scope with no session. */
  const pins = () => fsd.resource(labPins);
  const dismissals = () => fsd.resource(labDismissals);
  const readPins = async (): Promise<string[]> => (await pins().state()).pinned;
  const readDismissed = async (): Promise<string[]> => (await dismissals().state()).dismissed;

  return {
    modes: modes.map((mode) => mode.id),
    // Listed on open, and again when this tab opens a session. Each listed row reads again on its own
    // session's notices: a turn (request), a board change, a resource. Never on `items`, which a reply
    // sends per stored chunk. A session opened in another tab has no notice anyone hears yet, so it
    // joins at the next reload. Where push can miss a change, the whole list reads every 3 s.
    watchSessions: (onChange) => {
      let live = true;
      let rows = new Map<string, LabSession>();
      let last: string | undefined;
      let subscription: { close(): void } | undefined;
      // The listed ids the subscription hears; `null` before the first listing lands, so an empty
      // listing still subscribes (no topics, and the fallback timer where push can miss a change).
      let subscribed: string | null = null;
      let relist = true;
      const dirty = new Set<string>();
      // Your dismissals, read once per pass for every row's count; `marks` is a user-state notice,
      // which a pin sends too, so the rows are counted again only when the dismissals changed.
      let dismissed: ReadonlySet<string> = new Set();
      let dismissedKey: string | null = null;
      let marks = false;
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
          // Your user topic too: a dismissal changes what each session waits on you for.
          [...ids.map((id) => topic.session(id)), topic.user()],
          {
            onChange: (notice) => {
              if (notice === null || notice.kind === "resync") relist = true;
              else if (notice.topic.scope === "session" && ROW_CHANGES.has(notice.kind)) dirty.add(notice.topic.id);
              else if (notice.topic.scope === "user" && notice.topic.resource === labDismissals.ref) marks = true;
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
        while (live && (relist || dirty.size > 0 || marks)) {
          let complete = true;
          try {
            marks = false;
            const read = await readDismissed().then(
              (keys) => keys,
              (cause) => {
                console.warn("[claude-code-style] couldn't read your dismissals:", cause);
                complete = false;
                return null;
              },
            );
            if (read !== null) {
              const key = JSON.stringify([...read].sort());
              // Changed since the last pass: every shown row's count may have.
              if (dismissedKey !== null && key !== dismissedKey) for (const id of rows.keys()) dirty.add(id);
              dismissedKey = key;
              dismissed = new Set(read);
            }
            if (relist) {
              relist = false;
              dirty.clear();
              const next = new Map<string, LabSession>();
              for (const mode of modes) {
                const listed = await workforce.listWorkerSessions(mode.worker);
                for (const read of await Promise.all(listed.map((entry) => rowOf(mode.worker, entry.session.id, dismissed, rows.get(entry.session.id))))) {
                  next.set(read.row.id, read.row);
                  complete &&= read.complete;
                }
              }
              rows = next;
            } else {
              const ids = [...dirty];
              dirty.clear();
              const reads = await Promise.all(ids.flatMap((id) => (rows.has(id) ? [rowOf(rows.get(id)!.worker, id, dismissed, rows.get(id))] : [])));
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
    checkRepository: async (repository) => await run("projects", await projects(), "checkRepository", { repository }),
    readHarnesses: async (refresh = false) =>
      (await run(READINESS_FLOW, await ownSession(READINESS_FLOW), "read", { refresh })).harnesses as LabHarness[],
    openSession: async (mode, projectId) => {
      const { worker } = modeById(mode);
      const project = parseProjectRef(projectId);
      if (project === undefined) throw new Error(`"${projectId}" names no project.`);
      const created = await fsd.flow(await flowOf(worker)).createSession({ state: { [WORKER_ID_STATE_KEY]: worker } });
      await workforce.setWorkProject(worker, project, { sessionId: created.id });
      for (const tell of [...sessionOpened]) tell();
      return { id: created.id, title: NEW_SESSION_TITLE, worker, updatedAt: created.updatedAt, running: false, waiting: 0, projectId };
    },
    send: async (sessionId, text, attachments = []) => {
      const flow = fsd.flow(await flowOfSession(sessionId));
      const feed = threadFeeds.get(sessionId);
      // With the thread open, stream the send so its answer shows as it is written.
      if (feed === undefined) {
        await flow.send("respond", { message: text }, { sessionId, attachments: [...attachments] });
        return;
      }
      const response = await flow.send("respond", { message: text }, { sessionId, stream: true, attachments: [...attachments] });
      if (!response.ok) throw new Error(`The send was refused (${response.status}).`);
      if (response.headers.get("content-type")?.includes("text/event-stream")) feed.followResponse(response);
    },
    upload: (request) => fsd.upload(request),
    readFile: fileReader(connection),
    interrupt: async (sessionId) => {
      // Stopping from the press; the turns it stops are those running now, not one started after.
      const stop: { ids: Set<string> | null } = { ids: null };
      stops.set(sessionId, stop);
      wake(sessionId);
      const done = () => {
        if (stops.get(sessionId) === stop) stops.delete(sessionId);
        wake(sessionId);
      };
      try {
        const turns = await runningTurns(sessionId);
        stop.ids = new Set(turns.map((turn) => turn.id));
        for (const turn of turns) {
          await fsd
            .flow(turn.flowId ?? turn.flowKind)
            .request(turn.id)
            .abort()
            .catch(async (error: unknown) => {
              // A 409 is a turn that ended meanwhile, or one an answer resumed first, which runs on:
              // the record decides. Still running, the server refused the stop.
              if ((error as { status?: number }).status !== 409) throw error;
              const now = (await fsd.sessions.requests(sessionId, { limit: RECENT_TURNS })).find((r) => r.id === turn.id);
              if (now?.status === "in_progress") throw new Error("The turn went on before the stop reached it. Press Stop again.");
            });
        }
      } catch (error) {
        done();
        throw error;
      }
      if (stop.ids.size === 0) done();
      else wake(sessionId);
    },
    retry: async (sessionId, requestId) => {
      await fsd.flow(await flowOfSession(sessionId)).request(requestId).retry();
    },
    watchThread: (sessionId, onChange) => {
      // Items come from the session feed. The running turn is still read: the feed's runs are
      // child sessions, not this session's own turns.
      let items: Item[] | undefined;
      let loadEarlier: (() => Promise<void>) | undefined;
      let connection: ConnectionState | undefined;
      let backgroundRunning: number | null = null;
      type TurnsRead = {
        /** The recent turns, any status, oldest first: what the stopped lines and a stop's end are read from. */
        turns: Awaited<ReturnType<typeof runningTurns>>;
        turn: Awaited<ReturnType<typeof runningTurns>>[number] | undefined;
        threads: boolean;
        retryable: string[];
      };
      let turnOf: TurnsRead | undefined;
      /** The entries, built again only when the items or the turns change: never for a runs-only change. */
      let entries: ThreadEntry[] = [];
      const stoppedSeen = new Set<string>();
      const build = () => {
        if (items === undefined || turnOf === undefined) return;
        // Kept for the view's life: a stopped line stays once its turn leaves the recent-turns read.
        for (const turn of turnOf.turns) if (turn.status === "aborted") stoppedSeen.add(turn.id);
        entries = withStopped(entriesOf(items, turnOf.threads, new Set(turnOf.retryable)), stoppedSeen);
      };
      let last: string | undefined;
      const tell = () => {
        if (items === undefined || turnOf === undefined) return;
        const { turn } = turnOf;
        // A stop ends once this read shows every turn it aborted ended.
        const stop = stops.get(sessionId);
        if (stop?.ids != null && [...stop.ids].every((id) => turnOf!.turns.some((t) => t.id === id && t.status !== "in_progress"))) {
          stops.delete(sessionId);
        }
        const view: ThreadView = {
          entries,
          running: turn !== undefined,
          stopping: stops.has(sessionId),
          backgroundRunning,
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
          build();
          tell();
        },
        (state) => {
          connection = state;
          tell();
        },
        (count) => {
          backgroundRunning = count;
          tell();
        },
      );
      threadFeeds.set(sessionId, feed);
      const watchers = stopWatchers.get(sessionId) ?? new Set<() => void>();
      stopWatchers.set(sessionId, watchers.add(tell));
      // A turn starts and ends as a request: a request notice on the session's topic. Never on
      // `items`, which a streaming reply sends once per stored chunk.
      const stopTurns = fsd.live([topic.session(sessionId)], {
        read: async (): Promise<TurnsRead> => {
          // One read of the latest requests, newest updated first, answers all three: the running turn
          // is among them, so are the stopped turns, and so is the turn a failed line could retry.
          const [recent, threads] = await Promise.all([fsd.sessions.requests(sessionId, { limit: RECENT_TURNS }), isThreads(sessionId)]);
          // The turns the engine would retry: a record with no source predates it, and came in over http.
          const retryable = recent.filter((request) => RETRYABLE_SOURCES.has(request.source ?? "http")).map((request) => request.id);
          const turns = recent.filter((request) => TURN_ACTIONS.has(request.actionName)).sort((a, b) => (a.startedAtMs ?? 0) - (b.startedAtMs ?? 0));
          return { turns, turn: turnsRunningIn(recent)[0], threads, retryable };
        },
        onValue: (next) => {
          turnOf = next;
          build();
          tell();
        },
        hear: (notice) => notice.kind === "request",
        pollIntervalMs: READ_EVERY_MS,
        onError: logFailedRead,
      }).close;
      return () => {
        watchers.delete(tell);
        if (threadFeeds.get(sessionId) === feed) threadFeeds.delete(sessionId);
        stopItems();
        stopTurns();
      };
    },
    // The board is a view, so listing it every tick while the pane is open stores nothing.
    // Its answer names the topics a change to it publishes on, and the live read hears those.
    watchTasks: (sessionId, onChange, onStale) =>
      fsd.live<LabTask[]>([], {
        topicsFromResult: true,
        read: () => boardOf(sessionId),
        onValue: onChange,
        pollIntervalMs: TASKS_EVERY_MS,
        onStale: onStale,
        onError: logFailedRead,
      }).close,
    // Shown only inside the tasks pane or the threads board, whose watch keeps `runSessionOf` current.
    watchTaskWork: (_sessionId, taskId, onChange) => {
      // The task's run session is known once the board has listed it, and a re-run moves it: follow
      // whichever session the board names now, from the moment a list names it, and show no work
      // until one does. The run's items come from its session stream. While the task runs, what it
      // is in now follows the request the board names: its own stream for the call in flight, and
      // the plan it recorded, read again on each write to it. A re-run in the same session is a new
      // request, followed from the list that names it.
      let stopItems: Unsubscribe | undefined;
      let stopRun: Unsubscribe | undefined;
      let following: string | null | undefined;
      let followingRun: string | null | undefined;
      let work: TaskWork | undefined;
      let fed: readonly Item[] = [];
      let streamed: readonly Item[] = [];
      let plan: PlanRowNow[] | undefined;
      // What was last told: a stream delta that moves neither the work nor what it is doing now tells nothing.
      let toldWork: TaskWork | undefined;
      let toldWorking = "";
      const tell = () => {
        if (work === undefined) return;
        const inFlight = inFlightOf(streamed, fed, followingRun);
        const working: WorkingNow = { ...(inFlight === undefined ? {} : { inFlight }), ...(plan === undefined ? {} : { plan }) };
        const seen = JSON.stringify(working);
        if (work === toldWork && seen === toldWorking) return;
        toldWork = work;
        toldWorking = seen;
        onChange(Object.keys(working).length === 0 ? work : { ...work, working });
      };
      const followRun = (runSession: string) => {
        const run = runningRunOf.get(taskId);
        const requestId = run !== undefined && run.sessionId === runSession ? run.requestId : null;
        if (requestId === followingRun) return;
        followingRun = requestId;
        stopRun?.();
        stopRun = undefined;
        streamed = [];
        plan = undefined;
        tell();
        if (requestId === null) return;
        const stopCalls = followRequestCalls(fsd, flowOfSession(runSession), requestId, (items) => {
          streamed = items;
          tell();
        });
        const stopPlan = fsd.live([topic.session(runSession)], {
          read: async () => (await readRecordedWork(fsd, { sessionId: runSession, requestId })).plan?.rows.map(({ title, status }) => ({ title, status })) ?? null,
          onValue: (rows) => {
            plan = rows ?? undefined;
            tell();
          },
          ...PLAN_WRITES,
          pollIntervalMs: READ_EVERY_MS,
          onError: logFailedRead,
        }).close;
        stopRun = () => {
          stopCalls();
          stopPlan();
        };
      };
      const follow = () => {
        const runSession = runSessionOf.get(taskId) ?? null;
        if (runSession !== following) {
          following = runSession;
          stopItems?.();
          stopItems = undefined;
          stopRun?.();
          stopRun = undefined;
          followingRun = undefined;
          work = undefined;
          fed = [];
          streamed = [];
          plan = undefined;
          if (runSession === null) {
            onChange({ entries: [] });
            return;
          }
          stopItems = followItems(fsd, runSession, [...THREAD_ITEMS, "suspension"], (items, loadEarlier) => {
            const review = reviewStopOf(items);
            const reviewStop = reviewStopIdOf(items);
            fed = items;
            work = {
              entries: entriesOf(items.filter((item) => item.type !== "suspension")),
              ...(review === undefined ? {} : { review }),
              ...(reviewStop === undefined ? {} : { reviewStop }),
              ...(loadEarlier === undefined ? {} : { loadEarlier }),
            };
            tell();
          }).stop;
        }
        if (runSession !== null) followRun(runSession);
      };
      runLinkMoved.add(follow);
      follow();
      return () => {
        runLinkMoved.delete(follow);
        stopItems?.();
        stopRun?.();
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
    resolve: (sessionId, taskId, land) => answerReview(sessionId, taskId, { value: acceptOf(land) }),
    requestChanges: (sessionId, taskId, words) => answerReview(sessionId, taskId, { value: { verdict: "revise", words } }),
    // A notice of your pins on your user topic, from this tab or another, says they may have changed.
    watchPins: (onChange) => fsd.live([topic.user({ resource: labPins.ref })], {
      read: readPins,
      onValue: onChange,
      hear: (notice) => notice.topic.resource === labPins.ref,
      pollIntervalMs: 3000,
      onError: logFailedRead,
    }).close,
    // Each is one write at the version read; one another tab beat is read again and re-applied.
    pin: async (taskId) => {
      await pins().update((s) => ({ pinned: s.pinned.includes(taskId) ? s.pinned : [...s.pinned, taskId] }));
    },
    unpin: async (taskId) => {
      await pins().update((s) => ({ pinned: s.pinned.filter((id) => id !== taskId) }));
    },
    // Read the way pins are.
    watchDismissed: (onChange) => fsd.live([topic.user({ resource: labDismissals.ref })], {
      read: readDismissed,
      onValue: onChange,
      hear: (notice) => notice.topic.resource === labDismissals.ref,
      pollIntervalMs: 3000,
      onError: logFailedRead,
    }).close,
    // One key per task: a newer attempt's dismissal replaces the older one's.
    dismiss: async (task) => {
      const key = dismissalKey(task);
      await dismissals().update((s) => ({ dismissed: [...s.dismissed.filter((k) => taskOfDismissal(k) !== task.id), key] }));
    },
  };
}
