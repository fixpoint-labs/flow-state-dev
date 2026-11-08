// fallow-ignore-file duplicate-export -- each lab is its own app, and both expose the same LabAdapter shape on purpose.
/**
 * The lab's one way in and out. Every read and write the screen makes goes
 * through `LabAdapter`, and nothing else in `src/` touches a package. Each
 * function is bound to the package call it stands for:
 *
 * | Function            | Bound to                                                                     |
 * |---------------------|------------------------------------------------------------------------------|
 * | `watchWorkers`      | the workforce client's `watchRoster()`: every hire, edit and fire, anywhere   |
 * | `openConversation`  | `ensureWorkerSession({ worker })`: the worker's default conversation         |
 * | `send`              | the worker's door, `respond`, streamed, so its answer shows as it is written  |
 * | `watchConversation` | the session's items, from its snapshot and then its stream (`sessionFeed`), |
 * |                     | each run of tool calls named by the UI registry's `tool-naming` and        |
 * |                     | `tool-grouping`, and its requests (is it answering) on each request notice, |
 * |                     | via `client.subscribe`                                                     |
 * | `watchConnection`   | the same feed's connection state: `live`, `lapsed` once a retry has failed…  |
 * | `answerApproval`    | the request's `answer`: approve or reject a `user_approval` stop             |
 * | `retry`             | the request's `retry()` on the conversation's flow: a failed turn again      |
 * | `watchTalk`         | the user's message log (`workforceMessages`), as `sendMessage` writes it     |
 * | `watchActivity`     | `listSessionRequests` on the worker's conversation, on each request notice   |
 * | `watchWindow`       | the last answering request's `historyStart`, and the session's `historySummary` |
 * |                     | on each request notice and each notice of that resource                      |
 * | `hire`              | the workforce client's `hire`: a row on the user's roster                     |
 * | `editInstructions`  | the workforce client's `edit`, on one of the user's own workers               |
 * | `fire`              | the workforce client's `fire`, on one of the user's own workers               |
 * | `watchTasks`        | the board's rows, as the conversation's stream carries each one (`task-change`) |
 * |                     | and the board's `listTasks` read (`taskActionName`), on each notice of the     |
 * |                     | conversation's board                                                          |
 * |                     | and each linked run's session, where the run writes its row (its holds)      |
 * |                     | and `taskView` with the Inbox's holds (`inboxItems`), for what it waits on |
 * |                     | you for, and what its runs spent (the harness and model they reported)       |
 * | `answerOpenHold`        | the Inbox client's `answerOne`, on the task's open question or review         |
 * | `taskActions`       | the Inbox client's `board(at)` on the conversation that filed the task, its   |
 * |                     | `"tasks"` board: cancel, steer, release, retry, and `refile` for a re-run      |
 * | `watchReview`       | the run's review stop, read by harness-manager's browser `reviewDetail`        |
 * | `watchRun`          | the items of the session the task's row names as its run, each tool call      |
 * |                     | named by the UI registry's `tool-naming` (`components/flow-state/`)           |
 * | `watchExchange`     | the receiving worker's conversation: the turn that read one message          |
 * | `watchWorking`      | the run session's items and its run request's own stream (which sends a call |
 * |                     | as it starts), for the tool call in flight (the UI registry's               |
 * |                     | `working-status`), and harness-manager's browser `readRecordedWork`, for the |
 * |                     | plan its harness recorded, read on each write to it                          |
 *
 * `watchTalk` still reads on a clock (`poll`); every other watch reads on a change.
 *
 * A received message is drawn from its own item (`workforce:received`), which
 * carries its message id, so the pending line joins the log to the
 * conversation by id (gap G2, shipped with FIX-2070).
 *
 * The page acts as the user `fsdev dev` hands it (the config's `devtool`
 * block), with the bearer token when there is one, on the server it came from.
 */
import {
  bindStoreToCallbacks,
  createClient,
  createRequestStreamStore,
  readEveryCollectionPage,
  topic,
  type Client,
  type SessionConnectionState,
  type SessionRequestSummary,
  type WireNotice,
  type WireTopic,
} from "@flow-state-dev/client";
import { isSuspensionWait, type OutputItem } from "@flow-state-dev/core/items";
import { OBSERVED_PLAN, OBSERVED_PLAN_LIST } from "@flow-state-dev/core/harness";
import { readBasePath, readBearerToken, readUserId, withBearerToken } from "@flow-state-dev/devtool/react";
import {
  answerTextOf,
  createWorkforceClient,
  delegateAnswerOf,
  RECEIVED_MESSAGE_COMPONENT,
  SEND_MESSAGE_TOOL,
  WORKER_MESSAGES_RESOURCE,
  workerMessageRowSchema,
  type RosterEntry,
  type WorkforceClient,
} from "@flow-state-dev/workforce/browser";
import { isTerminalStatus, parseNotice, type TaskSpendView } from "@flow-state-dev/orchestration/tasks";
import {
  createInboxClient,
  inboxItems,
  taskActionName,
  taskView,
  type InboxAnswer,
  type InboxHold,
  type InboxTaskInput,
  type RefileOverrides,
  type RefiledTask,
  type TaskView,
} from "@flow-state-dev/orchestration/inbox";
import { pullRequestWait, readRecordedWork, readSessionPullRequests, reviewDetail, type PullRequestWaitRow, type ReviewDetail } from "@flow-state-dev/harness-manager/browser";
import type { LandedWork, ReviewLand } from "./components/flow-state/review-hold";
import { CODER_FLOW } from "./lib/coder-flow";
import { toolIntent, toolSubject } from "./components/flow-state/tool-naming";
import {
  composeToolGroupLabel,
  toolRunOpen,
  toolRunState,
  toolStepState,
  withToolState,
  type ToolCallStatus,
  type ToolStepState,
} from "./components/flow-state/tool-grouping";
import { toolInFlight, type PlanRowNow, type ToolCallNow } from "./components/flow-state/working-status";
import { harnessName } from "./lib/harness";
import { sessionFeeds, type SessionFeed } from "./lib/session-feed";
import { stableList } from "./lib/stable";
import type { HarnessReadinessChipRow } from "./components/flow-state/harness-readiness";

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
  /** One line on what it does: Lead reads it to know who to ask. */
  role: string;
  instructions: string;
}

/** A task a conversation filed, from the board's row. */
export interface BoardTask {
  id: string;
  /** The worker it was filed for. */
  to: string;
  title: string;
  /** `cancelled` is its own ending: a task someone withdrew did not fail. */
  status: "running" | "done" | "failed" | "cancelled";
  /**
   * The row's own board status (`pending`, `held`, `in_progress`, `completed`,
   * `errored`, `cancelled`), which `status` folds for the screen. The task's
   * actions follow this one, since the board decides by it.
   */
  boardStatus: string;
  /** What the run reported when it completed: a teammate's text answer, or a coding run's `answer`. Absent when blank. */
  result?: string;
  /** Why it failed, or the reason it was cancelled with, when the row says one. */
  error?: string;
  /** What the task is to do: its goal as filed. A re-run files it again. */
  goal: string;
  /** The brief it was filed with beside its goal, when it has one. */
  context?: string;
  /** Its labels, as filed. */
  labels?: string[];
  /** Its priority, as filed. */
  priority?: number;
  /** The session its run works in, once it started. */
  runSessionId?: string;
  /** For a coding task, the harness it runs on: the one its run reported, else its worker's `harness:`. */
  harness?: string;
  /** The model its run reported, when it reported one; never guessed. */
  model?: string;
  /** What its runs spent, as orchestration's task view folds it (`taskView`); absent before any ran. */
  spend?: TaskSpendView;
  /** What it waits on you for, while something does: its oldest open hold. */
  waiting?: TaskWaiting;
  /** For an accepted coding task, where its work went: the pull request opened, or the merge into your checkout. */
  landed?: LandedWork;
  /**
   * For a coding task whose work is a pull request, the ones it waits on to
   * merge or close (harness-manager's `awaitPullRequests`), by number: its run
   * is done and its work is not, so it stays open. Absent while it waits on none.
   */
  pullRequests?: { number: number | null }[];
  /** The row as orchestration's `taskView` reads it, once per read: its state and times, for its time signal and the panel's counts. */
  view?: TaskView;
  /**
   * What the view doesn't carry, for the time signal: when this attempt's run started (its run link's
   * `startedAt`), and the row's lease deadline, which a live run keeps renewing. Each absent until the row has it.
   */
  run?: { startedAt?: number; leaseUntil?: number };
  /** The one-line note its run last reported while it ran (`statusNote`). */
  note?: string;
  /** When it started running, in ms: what its feed's elapsed time counts from. */
  startedAt?: number;
  /** The request its run is, in its run session, once it started. */
  runRequestId?: string;
}

/** What a running task's run shows it doing now: the tool call still running, and the plan its harness recorded. */
export interface WorkingNow {
  inFlight?: ToolCallNow;
  /** `undefined` while the run records no plan. */
  plan?: PlanRowNow[];
}

/**
 * What a task waits on you for: a question its run asked, a review of the
 * changes its run committed, or another stop. `unanswerable` says why it
 * can't be answered from here, when it can't.
 */
export interface TaskWaiting {
  kind: "question" | "review" | "other";
  prompt: string;
  unanswerable: string | null;
  /** The hold's id (a stop's suspension id): a review asked again is a new hold. */
  holdId?: string;
}

/** A coding run's review: its branch, commits and the judge's verdict. */
export type { ReviewDetail };

/**
 * The board's actions on the tasks one conversation filed, each resolving on
 * the board's yes and rejecting with its own words on a refusal. Shaped as the
 * registry's `task-actions` row takes them, plus `rerun`.
 */
export interface TaskActions {
  /** Cancel a task. Resolves to the ids of the waiting tasks the board cancelled with it. */
  cancel(taskId: string): Promise<string[]>;
  /** Send words to an open task's run: they join its brief. */
  steer(taskId: string, message: string): Promise<void>;
  /** Release a held task: it goes back to pending. */
  release(taskId: string): Promise<void>;
  /** Run a failed or cancelled task again, as the same task. */
  retry(taskId: string): Promise<void>;
  /**
   * File `task` again as a new task on `worker`, its brief kept and a line
   * naming the task it re-runs added ({@link rerunOverrides}). The old task
   * stays as it was. Resolves to the new task's id.
   */
  rerun(task: BoardTask, worker: string): Promise<string>;
}

/** Your answer to what a task waits on: the words to a question, or a review's verdict, an accept naming how its work lands. */
export type TaskAnswer = { text: string } | { verdict: "accepted"; land?: ReviewLand } | { verdict: "revise"; words: string };

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
  /** For `tool`, how it stands: running, waiting, done, or failed (thrown, or a result that says so). */
  state?: ToolStepState;
  /** For `said`, while it is still being written. */
  streaming?: boolean;
}

/** One entry of a worker's conversation, in the order it happened. */
export type ConversationEntry =
  | { kind: "user"; id: string; text: string; queued?: boolean }
  /** `streaming` while the answer is still being written; `incomplete` when its turn failed before it was finished. */
  | { kind: "assistant"; id: string; text: string; streaming?: boolean; incomplete?: boolean }
  /**
   * A turn that failed, from the engine's `error` item: its reason, its request, and `retryable`
   * when Retry is offered on it: it is the conversation's newest turn, and one the engine will run
   * again for you (a worker's message it was answering is not).
   */
  | { kind: "failed"; id: string; requestId: string; reason: string; code?: string; details?: Record<string, unknown>; retryable: boolean }
  /** The worker messaged another worker (`sendMessage`). */
  | { kind: "sent"; id: string; messageId: string; to: string; text: string }
  /** A message another worker sent, as the `receive` turn that read it. */
  | { kind: "received"; id: string; messageId: string; from: string; text: string; inReplyTo?: string; noAnswer?: boolean }
  /** The worker filed a task; the card reads the board's row by its id, and draws `title` until the row arrives. */
  | { kind: "task"; id: string; taskId: string; title: string; to: string }
  /** A task it filed ended, as a line under the name of the worker that ran it; `title` is the task's, once its row is read. */
  | { kind: "result"; id: string; taskId: string; from: string; text: string; title?: string; failed?: boolean; cancelled?: boolean }
  /** The worker waits for your yes (`suspendForUser` with an approval); `resolution` once answered. */
  | { kind: "approval"; id: string; requestId: string; suspensionId: string; text: string; resolution?: string }
  /** A run of tool calls one turn made in a row, drawn inline as one line ({@link StepRun}) that opens to each. */
  | ({ kind: "steps"; id: string; steps: SessionStep[] } & StepRun);

/**
 * A run of tool steps as one line: what it did ("Read 2 files and searched
 * the code"; the step in flight while it runs, "Read src/a.ts…"), how it
 * stands, and whether it shows open. Open while it runs, folded once it
 * doesn't: the registry's `toolRunOpen`.
 */
export interface StepRun {
  label: string;
  state: ToolStepState;
  open: boolean;
}

/** One line for a run of tool steps, in the UI registry's words: {@link StepRun}. */
export function stepRun(steps: readonly SessionStep[]): StepRun {
  const states = steps.map((step) => step.state ?? "completed");
  const state = toolRunState(states);
  const now = state === "running" ? [...steps].reverse().find((step) => step.state === "running") : undefined;
  const label =
    steps.length === 1
      ? withToolState(steps[0]!.text, state)
      : now !== undefined
        ? withToolState(now.text, "running")
        : withToolState(composeToolGroupLabel(steps.map((step) => step.tool ?? step.text)), state, states.filter((s) => s === state).length, steps.length);
  return { label, state, open: toolRunOpen(state) };
}

/** What a conversation shows now. */
export interface ConversationView {
  entries: ConversationEntry[];
  /** The worker is answering in this conversation now. */
  running: boolean;
  /** Present while the conversation holds turns older than its first entry: adds the page before them. */
  loadEarlier?: () => Promise<void>;
  /** When the conversation's first loaded item was written, in ms. A message sent before it is outside the window. */
  since?: number;
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
  /** It landed: as a received line in one of the recipient's conversations, or as a waited send's result, which lands as no line. */
  delivered?: boolean;
  /** The sender asked for a reply: one answer comes back, as a message or as a waited send's result. */
  replyRequested?: boolean;
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

/** One coding harness's readiness, as harness-manager's readiness action answers it. */
export type HarnessRow = HarnessReadinessChipRow;

/** What the lab works on and with, from its `lab-context` flow: the context strip and the first run read it. */
export interface LabContext {
  /** The working folder. */
  folder: string;
  /** Why a coding run's checkout of the folder would be refused, or `null`. */
  folderProblem: string | null;
  model: string;
  /** The harness a coding worker whose file names none runs on. */
  harness: string;
  /** Each worker's declared delegates, by id: ids, or `"all"`. */
  delegates: Record<string, "all" | string[]>;
}

/** Everything the screen reads and writes. */
export interface LabAdapter {
  /**
   * The roster's rows, and again each time a hire, an edit or a fire, from
   * any tab or any worker's turn, changes them. `onError` hears a failed read;
   * the next read that lands reports the rows.
   */
  watchWorkers(onChange: (workers: WorkerRow[]) => void, onError?: (error: unknown) => void): Unsubscribe;
  listWorkers(): Promise<WorkerRow[]>;
  /** What the lab works on and with, read once for the context strip. */
  readContext(): Promise<LabContext>;
  /** Which coding harnesses can run on this machine; `refresh` checks them again (Re-check). */
  readHarnesses(refresh?: boolean): Promise<HarnessRow[]>;
  /** The worker's one conversation; the same id every time. */
  openConversation(worker: string): Promise<string>;
  send(sessionId: string, text: string): Promise<void>;
  watchConversation(sessionId: string, onChange: (view: ConversationView) => void): Unsubscribe;
  /** Whether the conversation's feed still hears the server, in the session feed's words. */
  watchConnection(sessionId: string, onChange: (state: SessionConnectionState) => void): Unsubscribe;
  /** Say yes or no to what an approval entry asks; the worker's turn carries on. */
  answerApproval(sessionId: string, approval: { requestId: string; suspensionId: string }, approve: boolean): Promise<void>;
  /** Run a failed turn of the conversation again, as a new request the engine links to `requestId`. */
  retry(sessionId: string, requestId: string): Promise<void>;
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
  /**
   * The tasks a conversation filed, oldest first. `onStale` hears `true` when the board's read
   * fails (the rows handed last are kept, so they may be old) and `false` when one succeeds again.
   */
  watchTasks(sessionId: string, onChange: (tasks: BoardTask[]) => void, onStale?: (stale: boolean) => void): Unsubscribe;
  /** A task's run, by the session its row names, read only: the worker that runs it takes no messages. */
  watchRun(runSessionId: string, onChange: (steps: SessionStep[]) => void): Unsubscribe;
  /**
   * The pull requests a run session's record holds (`observed-pull-requests`), with their links:
   * what a task waiting on one links to. Empty when the session keeps none or it can't be read.
   */
  readPullRequests(runSessionId: string): Promise<{ number: number; url: string; title: string | null }[]>;
  /** The run's latest review, read from its stop; `undefined` until it stops for one. */
  watchReview(runSessionId: string, onChange: (review: ReviewDetail | undefined) => void): Unsubscribe;
  /** Answer what a task waits on you for; the run goes on, or the task completes on an accept. */
  answerOpenHold(sessionId: string, taskId: string, answer: TaskAnswer): Promise<void>;
  /** The board's actions on the tasks conversation `sessionId` filed, sent to that conversation's board. */
  taskActions(sessionId: string): TaskActions;
  /**
   * What `worker` did with one message it was sent: the turn in its own
   * conversation that read it, from the message to the turn's end, live.
   * Empty until the message is read.
   */
  watchExchange(worker: string, messageId: string, onChange: (steps: SessionStep[]) => void): Unsubscribe;
  /** What a run is doing now, live: read only while a task's feed shows it running. */
  watchWorking(run: { sessionId: string; requestId?: string }, onChange: (now: WorkingNow) => void): Unsubscribe;
}

/**
 * The request sources the engine retries for a caller (`PUBLIC_REENTRY_SOURCES`): a turn that came
 * in another way, such as a worker's message (`internal`) or a task's run (`task`), it refuses.
 * A copy, since the page can't import the engine; a test pins it to the engine's.
 */
export const RETRYABLE_SOURCES: ReadonlySet<string> = new Set(["http", "mcp", "scheduled"]);

/** How often the reads with no stream are read again. */
const POLL_MS = 1_500;
/** The keyed item a conversation's board emits for each row it changes. */
const TASK_CHANGE = "task-change";
/** The tool a worker files a task with. */
const CREATE_TASK = "createTask";
/** What a board row's `listTasks` read never carries: an ended task's output and error, read from the row's other copies. */
const UNPROJECTED = ["output", "error"] as const;
/** Nor the brief a re-run copies beside its goal and title, read from those copies too, open or ended. */
const BRIEF = ["context", "labels", "priority"] as const;
/** The board a conversation files its tasks on: Workforce's `"tasks"`. */
const TASK_BOARD = "tasks";
/** The board's read of its rows, on a conversation's flow. */
const LIST_TASKS = taskActionName("listTasks", TASK_BOARD);
/** The ledgers that read returns: the conversation's board and its planning worker's steps. */
const BOARD_LEDGERS = ["tasks", "plan"] as const;
/** The board's action a question on a row is answered through, on the conversation that filed it. */
const UPDATE_TASK = taskActionName("updateTask", TASK_BOARD);
/** The board's one-task read: a re-run copies the whole brief from it. */
const GET_TASK = taskActionName("getTask", TASK_BOARD);
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
export interface WindowRead {
  /** The first turn the window held, when earlier turns had left it. */
  historyStart?: string;
  /** The newest turn folded into the summary, once one was. */
  summarizedThrough?: string;
  /** Whether the summary covers every turn before its mark; one with a hole can't be called that. */
  summaryComplete?: boolean;
}

/** The public face of the session's history summary resource. */
export interface HistorySummaryFace {
  clientData?: { throughRequestId?: string | null; complete?: boolean };
}

/**
 * Where the worker's last turn began reading word for word, from the
 * session's requests and its history summary.
 *
 * @param requests The session's recent requests, any order.
 * @param summary The session's history summary resource, when it has one.
 */
export function windowReadOf(requests: readonly SessionRequestSummary[], summary: HistorySummaryFace | undefined): WindowRead {
  // The latest turn of the worker's own that read a window, by when it started: the one the worker read last.
  // A turn still starting has no mark yet; the window only moves forward, so the one before it still holds.
  const answering = requests.filter((r) => !QUIET_ACTIONS.has(r.actionName) && r.historyStart != null);
  const latest = answering.reduce<SessionRequestSummary | undefined>((a, r) => (a === undefined || (r.startedAtMs ?? 0) > (a.startedAtMs ?? 0) ? r : a), undefined);
  const through = summary?.clientData?.throughRequestId;
  return {
    ...(latest?.historyStart == null ? {} : { historyStart: latest.historyStart.requestId }),
    // The worker reads after the mark whether or not the summary has a hole; a hole only changes the label.
    ...(through == null ? {} : { summarizedThrough: through, summaryComplete: summary?.clientData?.complete === true }),
  };
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
 * reporting a value only when it changed, as {@link poll} does.
 * A connect, a reconnect, a tick and a `resync` read too. One read at a time,
 * and one waiting for any number of notices. Wherever push can miss a change,
 * `client.subscribe` reads every `everyMs` instead, so the view keeps no timer
 * of its own. A failed read tries again on its own ({@link retryAfterFailure}).
 * A read still out when the watch stops reports nothing. `onStale` hears `true`
 * when a read fails and `false` when one succeeds after it.
 */
function onNotice<T>(
  client: Client,
  topics: readonly WireTopic[],
  hears: (notice: WireNotice) => boolean,
  read: () => Promise<T>,
  onValue: (value: T) => void,
  everyMs = POLL_MS,
  onStale?: (stale: boolean) => void,
): Unsubscribe {
  let live = true;
  let last = "";
  let stale = false;
  let running = false;
  let queued = false;
  const retry = retryAfterFailure(() => void run());
  const run = async (): Promise<void> => {
    if (!live) return;
    if (running) {
      queued = true;
      return;
    }
    running = true;
    try {
      const value = await read();
      retry.succeeded();
      const seen = JSON.stringify(value);
      if (live && seen !== last) {
        last = seen;
        onValue(value);
      }
      if (live && stale) {
        stale = false;
        onStale?.(false);
      }
    } catch (error) {
      console.error("teammates: a read failed", error);
      if (live) retry.failed();
      if (live && !stale) {
        stale = true;
        onStale?.(true);
      }
    }
    running = false;
    if (queued) {
      queued = false;
      void run();
    }
  };
  const subscription = client.subscribe(topics, {
    onChange: (notice) => {
      if (notice === null || notice.kind === "resync" || hears(notice)) void run();
    },
    pollIntervalMs: everyMs,
  });
  void run();
  return () => {
    live = false;
    retry.stop();
    subscription.close();
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
function followRequestCalls(client: Client, flow: Promise<string>, requestId: string, onItems: (items: readonly OutputItem[]) => void): Unsubscribe {
  const store = createRequestStreamStore();
  let live = true;
  let handle: { close(): void } | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  const open = (flowId: string): void => {
    if (!live) return;
    const heard = store.lastSequenceNumber;
    handle = client.flow(flowId).request(requestId).stream({
      ...(heard > 0 ? { startingAfter: heard } : {}),
      ...bindStoreToCallbacks(store, {
        itemFilter: (item) => item.type === "tool_output",
        onChange: () => {
          failures = 0;
          store.flushDeltas();
          if (live) onItems(store.getSorted());
        },
      }),
      onError: (error) => {
        handle?.close();
        handle = undefined;
        if (!live || store.status !== "in_progress" || STREAM_GONE.has((error as { status?: number }).status ?? 0)) return;
        retry = setTimeout(() => open(flowId), Math.min(30_000, 1_000 * 2 ** failures));
        failures += 1;
      },
    });
  };
  flow.then(open, (error) => console.error("teammates: a run's request couldn't be followed", error));
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
 */
function inFlightOf(streamed: readonly OutputItem[], fed: readonly OutputItem[], requestId: string | undefined): ToolCallNow | undefined {
  const finished = new Set(fed.filter((item) => item.status !== "in_progress").map((item) => item.id));
  // The feed's own candidates are the run request's only, else the newest request's: a reused session keeps
  // the call a crashed earlier request left half-done for good, and that is not what the run is doing now.
  const request = requestId ?? fed[fed.length - 1]?.requestId;
  return toolInFlight(streamed.filter((item) => !finished.has(item.id))) ?? toolInFlight(fed.filter((item) => item.requestId === request));
}

/** A request notice: one of the session's requests was created, moved or deleted. Never `items`, sent per stored chunk. */
const isRequest = (notice: WireNotice): boolean => notice.kind === "request";

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

/** Whether `copy` of a row is of the same attempt (try count and run) as `row`: a retry's copies speak only for it. */
function sameAttempt(copy: Record<string, any> | undefined, row: Record<string, any>): boolean {
  return copy !== undefined && (copy.attempts ?? 0) === (row.attempts ?? 0) && (copy.run?.sessionId ?? null) === (row.run?.sessionId ?? null);
}

/** The latest copy of each board row in a conversation's items, oldest filing first. */
function boardRows(items: readonly Item[]): Map<string, Record<string, any>> {
  const rows = new Map<string, Record<string, any>>();
  for (const item of items) {
    if (item.type === "component" && item.component === TASK_CHANGE && item.data?.task?.id) rows.set(item.data.task.id, item.data.task);
  }
  return rows;
}

/**
 * A board row as a task card. Exported for its tests.
 *
 * @param harnessOf A worker's `harness:` setting, for a coding task whose run hasn't reported one yet.
 */
export function toBoardTask(
  row: Record<string, any>,
  harnessOf: (worker: string) => string | undefined = () => undefined,
  holds?: readonly InboxHold[],
): BoardTask {
  const error = typeof row.error === "string" ? row.error : undefined;
  const status: BoardTask["status"] =
    row.status === "completed" ? "done" : row.status === "errored" ? "failed" : row.status === "cancelled" ? "cancelled" : "running";
  // A teammate's answer is the output as is; a coding run's is its output's `answer`. Blank is none.
  const answer = answerTextOf(row.output);
  // One read of the row as orchestration's task view: its folded spend, and its oldest open hold.
  const view = typeof row.id === "string" && typeof row.status === "string" ? taskView({ ...row, board: row.board ?? "" } as InboxTaskInput, holds) : null;
  const spend = view?.spend ?? null;
  return {
    id: row.id,
    to: row.assignee ?? "",
    title: row.title ?? row.goal ?? row.id,
    status,
    boardStatus: String(row.status ?? ""),
    goal: String(row.goal ?? ""),
    ...(answer === undefined ? {} : { result: answer }),
    ...(error === undefined ? {} : { error }),
    ...(typeof row.context === "string" ? { context: row.context } : {}),
    ...(Array.isArray(row.labels) ? { labels: row.labels.filter((label: unknown): label is string => typeof label === "string") } : {}),
    ...(typeof row.priority === "number" ? { priority: row.priority } : {}),
    ...(typeof row.run?.sessionId === "string" ? { runSessionId: row.run.sessionId } : {}),
    ...(typeof row.run?.requestId === "string" ? { runRequestId: row.run.requestId } : {}),
    ...(typeof row.statusNote === "string" ? { note: row.statusNote } : {}),
    ...startedAtOf(row),
    ...harnessAndModel(spend, harnessOf(row.assignee ?? "")),
    ...(spend === null ? {} : { spend }),
    ...waitingOf(view),
    ...(view === null ? {} : { view }),
    ...runOf(row),
    ...landedOf(row.output?.landed),
    ...pullRequestsOf(row),
  };
}

/** A row's open pull-request wait, as harness-manager's browser reader reads it: the pull requests by number, or nothing. */
function pullRequestsOf(row: Record<string, any>): Pick<BoardTask, "pullRequests"> {
  const wait = pullRequestWait(row as PullRequestWaitRow);
  return wait === null ? {} : { pullRequests: wait.pullRequests.map(({ number }) => ({ number })) };
}

/** Where an accepted run's work went, from harness-manager's output, or nothing when it names none readable. */
function landedOf(value: unknown): { landed?: LandedWork } {
  if (typeof value !== "object" || value === null) return {};
  const v = value as Record<string, unknown>;
  if (v.kind === "pull-request" && typeof v.url === "string" && typeof v.number === "number" && typeof v.branch === "string" && typeof v.base === "string") {
    return { landed: { kind: "pull-request", url: v.url, number: v.number, branch: v.branch, base: v.base } };
  }
  if (v.kind === "merge" && typeof v.branch === "string" && typeof v.commit === "string" && typeof v.checkout === "string" && typeof v.from === "string") {
    return { landed: { kind: "merge", branch: v.branch, commit: v.commit, checkout: v.checkout, from: v.from } };
  }
  return {};
}

/** A row's run start and lease deadline, each only when the row has it. */
function runOf(row: Record<string, any>): Pick<BoardTask, "run"> {
  const run = {
    ...(typeof row.run?.startedAt === "number" ? { startedAt: row.run.startedAt as number } : {}),
    ...(typeof row.leaseUntil === "number" ? { leaseUntil: row.leaseUntil as number } : {}),
  };
  return Object.keys(run).length === 0 ? {} : { run };
}

/** When this attempt's run started: its run link's start, else the task's own (rows before either carry neither, BP-030). */
function startedAtOf(row: Record<string, any>): { startedAt?: number } {
  // This attempt's start: a retry keeps the task's own `startedAt` (its first start), so the run's comes first.
  const at = typeof row.run?.startedAt === "number" ? row.run.startedAt : row.startedAt;
  return typeof at === "number" ? { startedAt: at } : {};
}

/** The fields a re-file copies from a task, as the board's `refile` takes them. */
function refileRowOf(task: BoardTask): RefiledTask {
  return { goal: task.goal, title: task.title, context: task.context ?? null, assignee: task.to, labels: task.labels ?? null, priority: task.priority ?? null };
}

/**
 * What a re-run sets over the copied task: the worker it now goes to, and its
 * brief with one line added naming the task it re-runs, by title, so the old
 * brief is kept and the link shows. Exported for its tests.
 */
export function rerunOverrides(task: BoardTask, worker: string): RefileOverrides {
  const ended = task.status === "cancelled" ? "was cancelled" : "failed";
  const line = `This re-runs the task "${task.title}", which ${ended}${task.harness === undefined ? "" : ` on ${task.harness}`}.`;
  return { assignee: worker, context: task.context === undefined || task.context === "" ? line : `${task.context}\n\n${line}` };
}

/** What a row waits on you for, as `taskView` reads it: its oldest open hold, or nothing. */
function waitingOf(view: TaskView | null): { waiting?: TaskWaiting } {
  const hold = view?.hold ?? null;
  if (hold === null) return {};
  const kind = hold.ask.kind === "question" || hold.ask.kind === "review" ? hold.ask.kind : "other";
  return { waiting: { kind, prompt: hold.ask.prompt, unanswerable: hold.unanswerable, holdId: hold.id } };
}

/**
 * Each row's open holds, as the Inbox reads them, so each knows where its
 * answer goes: a question to the board's `updateTask` on the conversation
 * that filed it, a run's stop to the run's own flow. Exported for its tests.
 *
 * @param flowOf The flow that owns a session: the conversation's, or a run's.
 */
export function holdsOfRows(sessionId: string, rows: readonly Record<string, any>[], flowOf: (sessionId: string) => string | undefined): Map<string, InboxHold[]> {
  const inboxRows: InboxTaskInput[] = rows.map((row) => ({
    ...(row as InboxTaskInput),
    board: sessionId,
    holder: { sessionId, action: UPDATE_TASK },
  }));
  const items = inboxItems({ rows: inboxRows, suspensions: [], flowOf });
  return new Map(items.flatMap((item) => (item.task === null ? [] : [[item.task.taskId, [...item.holds]] as const])));
}

/**
 * A run's latest review stop, read with harness-manager's browser reader; the
 * latest wins, since a run sent back for changes stops for review again.
 * Exported for its tests.
 */
export function reviewOf(items: readonly Item[]): ReviewDetail | undefined {
  const stop = [...items].reverse().find((item) => item.type === "suspension" && item.kind === "review");
  return stop === undefined ? undefined : (reviewDetail(stop.data) ?? undefined);
}

/** A {@link TaskAnswer} as the Inbox client's answer for the hold it answers. */
function inboxAnswerOf(answer: TaskAnswer): InboxAnswer {
  if ("text" in answer) return { text: answer.text };
  if (answer.verdict === "revise") return { value: { verdict: "revise", words: answer.words } };
  return { value: answer.land === undefined ? { verdict: "accepted" } : { verdict: "accepted", land: answer.land } };
}

/** The harness by its name (the run's, else the worker's), and the run's model. */
function harnessAndModel(spend: TaskSpendView | null, setting: string | undefined): { harness?: string; model?: string } {
  const harness = spend?.harness ?? setting;
  return {
    ...(harness == null ? {} : { harness: harnessName(harness) }),
    ...(spend?.model == null ? {} : { model: spend.model }),
  };
}

/**
 * A conversation's items as the entries the screen draws. `ended` names the
 * requests the server lists as over: a step their turn left running (a turn
 * that crashed mid-call) reads failed, not running for good. A failed turn's
 * `error` item is a failed entry, `retryable` when it is the newest turn that drew one and one of
 * `retryableTurns`, the requests the engine will retry.
 */
export function toEntries(
  items: readonly Item[],
  workers: ReadonlySet<string>,
  ended: readonly string[] = [],
  retryableTurns: ReadonlySet<string> = new Set(),
): ConversationEntry[] {
  const rows = boardRows(items);
  const entries: ConversationEntry[] = [];
  /** The turn the last run of steps belongs to: a run never spans two. */
  let runTurn: unknown;
  // A turn that failed; its reply, if it never finished, is marked incomplete.
  const failedTurns = new Set(items.filter((item) => item.type === "error").map((item) => item.requestId));
  /** The newest turn that drew an entry: a board pass that drew none is not a turn you saw. Retry is offered on it only. */
  let newestTurn: unknown;
  const drawEntry = (item: Item): void => {
    if (item.type === "error") {
      entries.push({
        kind: "failed",
        id: item.id,
        requestId: item.requestId,
        reason: typeof item.message === "string" ? item.message : "",
        ...(typeof item.code === "string" ? { code: item.code } : {}),
        ...(item.details === undefined ? {} : { details: item.details }),
        retryable: false,
      });
    } else if (item.type === "message" && item.role === "user") {
      entries.push({ kind: "user", id: item.id, text: textOf(item) });
    } else if (item.type === "message" && item.role === "assistant" && workers.has(item.agentName)) {
      // A task it filed ended: the board's line under the worker that ran it, which names its task
      // in its data. A completed task's answer said as is (`resultTo: "conversation"`) names the
      // task it answered; one stored before answers were marked names none.
      const notice = parseNotice(item);
      const taskId = notice?.taskId ?? delegateAnswerOf(item)?.taskId ?? "";
      const row = rows.get(taskId);
      const task = row === undefined ? undefined : toBoardTask(row);
      // An answer is a finished task, never one drawn as failed.
      const cancelled = task?.status === "cancelled";
      const failed = notice !== undefined && task?.status !== "done" && !cancelled;
      entries.push({
        kind: "result",
        id: item.id,
        taskId,
        from: item.agentName,
        text: task?.result ?? task?.error ?? textOf(item),
        ...(task?.title === undefined ? {} : { title: task.title }),
        ...(failed ? { failed: true } : {}),
        ...(cancelled ? { cancelled: true } : {}),
      });
    } else if (item.type === "message" && item.role === "assistant") {
      const text = textOf(item);
      const incomplete = failedTurns.has(item.requestId) && item.status !== "completed";
      if (text.trim() !== "")
        entries.push({ kind: "assistant", id: item.id, text, ...(incomplete ? { incomplete: true } : item.status === "in_progress" ? { streaming: true } : {}) });
    } else if (item.type === "tool_output" && item.toolCall?.name === SEND_MESSAGE_TOOL && sentTo(item) !== undefined) {
      const args = parseArgs(item);
      entries.push({ kind: "sent", id: item.id, messageId: item.output.sent, to: String(args.to), text: String(args.text ?? "") });
    } else if (item.type === "tool_output" && item.toolCall?.name === CREATE_TASK && item.output?.ok === true) {
      const args = parseArgs(item);
      entries.push({ kind: "task", id: item.id, taskId: item.output.taskId, title: String(args.title ?? args.goal ?? ""), to: String(args.assignee ?? "") });
    } else if (item.type === "tool_output" && typeof item.toolCall?.name === "string") {
      // Any other call is a step of the turn, inline: a call in a row with the last one, in the same turn, joins its run.
      const step = toolStep(item, ended);
      const last = entries[entries.length - 1];
      if (last?.kind === "steps" && runTurn === item.requestId) {
        const steps = [...last.steps, step];
        entries[entries.length - 1] = { kind: "steps", id: last.id, steps, ...stepRun(steps) };
      } else {
        entries.push({ kind: "steps", id: item.id, steps: [step], ...stepRun([step]) });
        runTurn = item.requestId;
      }
    } else if (item.type === "suspension" && item.reason === "user_approval") {
      entries.push({ kind: "approval", id: item.id, requestId: item.requestId, suspensionId: item.suspensionId, text: item.message });
    } else if (item.type === "suspension_resume") {
      const asked = entries.find((e) => e.kind === "approval" && e.suspensionId === item.suspensionId);
      if (asked?.kind === "approval") asked.resolution = item.resolution;
    } else if (item.type === "component" && item.component === RECEIVED_MESSAGE_COMPONENT) {
      const { id, from, text, inReplyTo, noAnswer } = item.data ?? {};
      entries.push({ kind: "received", id: item.id, messageId: id, from, text, ...(inReplyTo === undefined ? {} : { inReplyTo }), ...(noAnswer === true ? { noAnswer: true } : {}) });
    }
  };
  for (const item of items) {
    const drawn = entries.length;
    drawEntry(item);
    if (entries.length !== drawn) newestTurn = item.requestId;
  }
  return entries.map((entry) =>
    entry.kind === "failed" && entry.requestId === newestTurn && retryableTurns.has(entry.requestId) ? { ...entry, retryable: true } : entry,
  );
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

/** Who a `sendMessage` output went to, when it sent one: a refused send sent nothing. */
function sentTo(item: Item): string | undefined {
  const to = parseArgs(item).to;
  const messageId = item.output?.sent;
  return typeof messageId === "string" && typeof to === "string" ? to : undefined;
}

/**
 * A tool call's status as the registry reads it: a call parked on an approval
 * or a question waits, and one still marked running in a turn that is over
 * (`ended`) failed.
 */
function callStatus(item: Item, ended: readonly string[]): ToolCallStatus {
  if (isSuspensionWait(item as never)) return "waiting";
  if (item.status === "in_progress") return ended.includes(item.requestId) ? "failed" : "running";
  // A call that never finished (`incomplete`) did not work.
  return item.status === "completed" ? "done" : "failed";
}

/**
 * A tool call as a step, in the UI registry's words: what it said it was doing,
 * else what it acted on, with its result once it has one ("Read …/src/a.ts",
 * `Search "x" · 3 matches`, the command it ran), else the tool it used; and how
 * it stands, a refused call failed as a thrown one is. The same on every
 * harness, since the registry names each one's tools.
 */
function toolStep(item: Item, ended: readonly string[] = []): SessionStep {
  const tool: string = item.toolCall.name;
  const args = parseArgs(item);
  const status = callStatus(item, ended);
  const output = status === "done" ? item.output : undefined;
  const intent = toolIntent(tool, args);
  const subject = intent === undefined ? toolSubject(tool, args, output) : undefined;
  return {
    id: item.id,
    kind: "tool",
    tool,
    text: intent ?? subject?.text ?? `Used ${tool}`,
    ...(subject?.code ? { code: true } : {}),
    state: toolStepState(status, tool, output),
  };
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
      steps.push(toolStep(item));
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
  return createClient({ userId: readUserId(), baseUrl: readBasePath(), fetcher: withBearerToken(readBearerToken()) });
}

/** The adapter the app runs on: the package, through one client. */
export function createLabAdapter(client: Client = connect()): LabAdapter {
  const workforce: WorkforceClient = createWorkforceClient(client);
  const inbox = createInboxClient(client);
  /** The flow each run session belongs to, where a run's stop is answered. Kept, since a session's flow never changes. */
  const runFlows = new Map<string, string>();
  /** Each conversation's tasks' open holds, from its last read: what `answerOpenHold` answers. */
  const openHolds = new Map<string, Map<string, InboxHold[]>>();
  const feeds = sessionFeeds(client);
  /** Each worker's conversation, and the flow it runs on, once opened. */
  const conversations = new Map<string, { sessionId: string; flow: string }>();
  /** Told each time a conversation opens, so a worker's activity is watched from then. */
  const conversationOpened = new Set<() => void>();
  const flowOfSession = new Map<string, string>();
  /** The workers, by id, so a line under a worker's name reads as a task's ending. */
  let workerIds = new Set<string>();
  /** Each coding worker's `harness:`, from the last roster the watch reported. */
  let harnesses = new Map<string, string>();

  const conversationOf = async (worker: string) => {
    const known = conversations.get(worker);
    if (known !== undefined) return known;
    const session = await workforce.ensureWorkerSession({ worker });
    const opened = { sessionId: session.id, flow: session.flowKind };
    conversations.set(worker, opened);
    flowOfSession.set(session.id, session.flowKind);
    for (const tell of [...conversationOpened]) tell();
    return opened;
  };

  /** Any conversation of the user's: the message log is read through one. */
  const anyConversation = async () => conversations.values().next().value ?? (await conversationOf((await workforce.roster()).find((w) => w.flow !== CODER_FLOW)!.id));

  const watchFeed = <T>(sessionId: string, map: (items: Item[]) => T, onChange: (value: T) => void): Unsubscribe =>
    (feeds(sessionId) as SessionFeed).watch((items: readonly OutputItem[]) => onChange(map(items as unknown as Item[])));

  /** The user's one session on a lab flow (`harness-readiness`, `lab-context`), found or made once. */
  const labSessions = new Map<string, Promise<string>>();
  const labSession = (flow: string) => {
    const known = labSessions.get(flow);
    if (known !== undefined) return known;
    const made = (async () => {
      const [latest] = (await client.sessions.list({ flowKind: flow, userId: client.userId })).sort((a, b) => b.updatedAt - a.updatedAt);
      return latest?.id ?? (await client.flow(flow).createSession()).id;
    })();
    labSessions.set(flow, made);
    made.catch(() => labSessions.delete(flow));
    return made;
  };
  /** Run one of a lab flow's actions and hand back its output, or throw why it failed. */
  const runLab = async (flow: string, action: string, input: unknown): Promise<any> => {
    const sessionId = await labSession(flow);
    const sent = await client.flow(flow).send(action, input, { sessionId });
    const { status, error, output } = await sent.result();
    if (status !== "completed") throw new Error(error?.message ?? `${action} ended ${status}`);
    return output;
  };

  return {
    watchWorkers(onChange, onError) {
      return workforce.watchRoster(
        (roster) => {
          workerIds = new Set(roster.map((w) => w.id));
          harnesses = new Map(roster.flatMap((w) => (typeof w.settings?.harness === "string" ? [[w.id, w.settings.harness] as const] : [])));
          onChange(roster.map(toWorkerRow));
        },
        onError === undefined ? undefined : { onError },
      );
    },
    async readContext() {
      return (await runLab("lab-context", "read", {})) as LabContext;
    },
    async readHarnesses(refresh = false) {
      return ((await runLab("harness-readiness", "read", { refresh })) as { harnesses: HarnessRow[] }).harnesses;
    },
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
    async retry(sessionId, requestId) {
      const flow = flowOfSession.get(sessionId) ?? (await client.sessions.get(sessionId)).flowKind;
      await client.flow(flow).request(requestId).retry();
    },
    watchConnection(sessionId, onChange) {
      return feeds(sessionId).watchState(onChange);
    },
    watchConversation(sessionId, onChange) {
      let entries: ConversationEntry[] = [];
      let items: Item[] = [];
      let inProgress: string[] = [];
      let ended: string[] = [];
      let retryable = new Set<string>();
      let shown: ConversationView | undefined;
      // Unchanged entries keep their objects, so a streamed chunk redraws only the growing one.
      const reuse = stableList<ConversationEntry>((next) => {
        entries = next;
      });
      const feed = feeds(sessionId);
      const loadEarlier = () => feed.loadEarlier();
      const emit = () => {
        const running = answeringOf(items, inProgress, ended);
        const earlier = feed.hasEarlier();
        const since: number | undefined = items[0]?.ts;
        if (shown?.entries === entries && shown.running === running && (shown.loadEarlier !== undefined) === earlier && shown.since === since) return;
        shown = { entries, running, ...(earlier ? { loadEarlier } : {}), ...(since === undefined ? {} : { since }) };
        onChange(shown);
      };
      const stopFeed = watchFeed(sessionId, (next) => next, (next) => {
        items = next;
        reuse(toEntries(items, workerIds, ended, retryable));
        emit();
      });
      const stopPoll = onNotice(
        client,
        [topic.session(sessionId)],
        isRequest,
        () => client.sessions.requests(sessionId, { limit: 20 }),
        (requests) => {
          const answering = requests.filter((r) => !QUIET_ACTIONS.has(r.actionName));
          inProgress = answering.filter((r) => r.status === "in_progress").map((r) => r.id);
          ended = requests.filter((r) => r.status !== "in_progress").map((r) => r.id);
          // The turns the engine would retry: a record with no source predates it, and came in over http.
          retryable = new Set(requests.filter((r) => RETRYABLE_SOURCES.has(r.source ?? "http")).map((r) => r.id));
          // A turn that ended with a call still marked running reads that call failed.
          reuse(toEntries(items, workerIds, ended, retryable));
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
              ...(m.noAnswer === true ? { noAnswer: true } : {}),
              ...(m.status === "refused" || m.status === "undeliverable" ? { undelivered: true } : {}),
              ...(m.status === "delivered" ? { delivered: true } : {}),
            }));
        },
        onChange,
      );
    },
    watchActivity(worker, onChange) {
      // A worker that takes tasks only has no conversation: it is idle here. One that has one is
      // watched from the moment it opens, on its conversation's request notices.
      let live = true;
      let stopRead: Unsubscribe | undefined;
      const follow = () => {
        const known = conversations.get(worker);
        if (!live || known === undefined || stopRead !== undefined) return;
        stopRead = onNotice(client, [topic.session(known.sessionId)], isRequest, async () => activityOf(await client.sessions.requests(known.sessionId, { limit: 20 })), onChange);
      };
      if (conversations.has(worker)) follow();
      else onChange({ running: false, lastActiveAt: 0 });
      conversationOpened.add(follow);
      return () => {
        live = false;
        conversationOpened.delete(follow);
        stopRead?.();
      };
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
      // The window moves with a turn (a request notice), and the summary's mark with its resource.
      const stopPoll = onNotice(
        client,
        [topic.session(sessionId)],
        (notice) => isRequest(notice) || (notice.kind === "resource" && notice.topic.resource === HISTORY_SUMMARY),
        async (): Promise<WindowRead> => {
          const requests = await client.sessions.requests(sessionId, { limit: 20 });
          const summary = (await client.sessions.state(sessionId, { includeItems: false })).resources?.session?.[HISTORY_SUMMARY] as
            | HistorySummaryFace
            | undefined;
          return windowReadOf(requests, summary);
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
    watchTasks(sessionId, onChange, onStale) {
      const show = stableList(onChange);
      let rows = new Map<string, Record<string, any>>();
      /** Each row as the board's last read answered it: a task settles, and its run links, on its own session. */
      let listed = new Map<string, Record<string, any>>();
      /**
       * Each linked run's own copy of its row. A run writes its row on its own session (its link, its
       * questions, its review), and the conversation hears of those only when the task ends, so the
       * run's session is followed too.
       */
      const runRows = new Map<string, Record<string, any>>();
      const runFeeds = new Map<string, Unsubscribe>();
      /**
       * A row is the board read's: every committed write of a row sends a board notice, so the read
       * is never more than one notice behind, and a field it leaves out is cleared (an answered hold). Until the first read lands, the conversation's copy, else
       * the run's, stands in. The copies add only what the read never carries: {@link BRIEF} and
       * {@link UNPROJECTED}.
       */
      const rowOf = (id: string): Record<string, any> => {
        const board = listed.get(id);
        if (board === undefined) return rows.get(id) ?? runRows.get(id)!;
        const kept: Record<string, unknown> = {};
        for (const field of BRIEF) {
          const value = runRows.get(id)?.[field] ?? rows.get(id)?.[field];
          if (value !== undefined) kept[field] = value;
        }
        // An ended task's output and error are its last attempt's: a copy from before a retry says nothing of this one.
        if (isTerminalStatus(board.status)) {
          const current = [runRows.get(id), rows.get(id)].filter((copy) => sameAttempt(copy, board));
          for (const field of UNPROJECTED) {
            const value = current.find((copy) => copy![field] !== undefined)?.[field];
            if (value !== undefined) kept[field] = value;
          }
        }
        return { ...board, ...kept };
      };
      const followRuns = (current: readonly Record<string, any>[]) => {
        for (const row of current) {
          const runSession = row.run?.sessionId;
          if (typeof runSession !== "string") continue;
          // An ended task's run is let go once the run's own copy says it ended (it carries the output
          // the board read doesn't), or never followed when no copy of it was ever read.
          const copy = runRows.get(row.id);
          if (isTerminalStatus((sameAttempt(copy, row) ? copy! : row).status)) {
            runFeeds.get(runSession)?.();
            runFeeds.set(runSession, () => {});
            continue;
          }
          if (runFeeds.has(runSession)) continue;
          // Claimed before the watch starts: a feed already loaded calls back at once, and that publish follows runs again.
          runFeeds.set(runSession, () => {});
          const stop = watchFeed(runSession, boardRows, (read) => {
            const fromRun = read.get(row.id);
            if (fromRun === undefined) return;
            runRows.set(row.id, fromRun);
            publish();
          });
          runFeeds.set(runSession, stop);
        }
      };
      /** Every row, the conversation's order first, each as {@link rowOf} settles it. */
      const merged = (): Record<string, any>[] => [...new Set([...rows.keys(), ...listed.keys()])].map(rowOf);
      // Set once the watch stops: a read or a flow lookup that lands after it shows nothing and follows no run.
      let stopped = false;
      const publish = () => {
        if (stopped) return;
        const current = merged();
        const flowOf = (id: string) => (id === sessionId ? flowOfSession.get(sessionId) : runFlows.get(id));
        const holds = holdsOfRows(sessionId, current, flowOf);
        openHolds.set(sessionId, holds);
        show(current.map((row) => toBoardTask(row, (worker) => harnesses.get(worker), holds.get(row.id) ?? [])));
        learnFlows(current);
        followRuns(current);
      };
      /** A hold's answer goes to the flow that owns its session: learn each one once, then read again. */
      const learnFlows = (current: readonly Record<string, any>[]) => {
        const unknown = [
          ...(flowOfSession.has(sessionId) ? [] : [sessionId]),
          ...current.flatMap((row) => (typeof row.run?.sessionId === "string" && !runFlows.has(row.run.sessionId) && (row.holds?.length ?? 0) > 0 ? [row.run.sessionId as string] : [])),
        ];
        if (unknown.length === 0) return;
        void Promise.all(
          unknown.map(async (id) => {
            const detail = await client.sessions.get(id);
            const flow = detail.flowId ?? detail.flowKind;
            if (id === sessionId) flowOfSession.set(id, flow);
            else runFlows.set(id, flow);
          }),
        ).then(publish, (error) => console.error("teammates: a session's flow couldn't be read", error));
      };
      // Topics narrowed to the ledgers the read returns: every notice on them is the board's,
      // so a reply streaming in the conversation never wakes the read.
      const stopBoard = onNotice(
        client,
        BOARD_LEDGERS.map((resource) => topic.session(sessionId, { resource })),
        () => true,
        async () => {
          const flow = flowOfSession.get(sessionId) ?? (await client.sessions.get(sessionId)).flowKind;
          const read = await client.flow(flow).read<{ ok: boolean; error?: string; tasks: Array<Record<string, any>> }>(LIST_TASKS, {}, { sessionId });
          if (!read.ok) throw new Error(read.error);
          return read.tasks;
        },
        (tasks) => {
          if (stopped) return;
          listed = new Map(tasks.map((task) => [task.id as string, task]));
          publish();
        },
        POLL_MS,
        (stale) => {
          if (!stopped) onStale?.(stale);
        },
      );
      const stopFeed = watchFeed(sessionId, boardRows, (read) => {
        rows = read;
        publish();
      });
      return () => {
        stopped = true;
        stopFeed();
        stopBoard();
        for (const stop of runFeeds.values()) stop();
      };
    },
    watchRun(runSessionId, onChange) {
      return watchFeed(runSessionId, runSteps, stableList(onChange));
    },
    async readPullRequests(runSessionId) {
      try {
        const rows = await readSessionPullRequests(client, runSessionId);
        return rows.map(({ number, url, title }) => ({ number, url, title }));
      } catch (error) {
        console.warn(`teammates: the pull requests of run session ${runSessionId} couldn't be read`, error);
        return [];
      }
    },
    watchReview(runSessionId, onChange) {
      let last: string | undefined;
      return watchFeed(runSessionId, reviewOf, (review) => {
        const seen = JSON.stringify(review ?? null);
        if (seen === last) return;
        last = seen;
        onChange(review);
      });
    },
    taskActions(sessionId) {
      // The board is the conversation's own: its flow, the session that filed the task, and its `"tasks"` collection.
      const flowOf = async () => {
        let flowId = flowOfSession.get(sessionId);
        if (flowId === undefined) {
          const detail = await client.sessions.get(sessionId);
          flowId = detail.flowId ?? detail.flowKind;
          flowOfSession.set(sessionId, flowId);
        }
        return flowId;
      };
      const board = async () => inbox.board({ flowId: await flowOf(), sessionId, board: TASK_BOARD });
      /**
       * `task` with its brief as the board holds it. The list read leaves the brief out, and an old
       * task's copy in the conversation may be past the loaded history, so a re-run reads it whole
       * rather than file the task again without it.
       */
      const withBrief = async (task: BoardTask): Promise<BoardTask> => {
        const flow = client.flow(await flowOf());
        const { id: requestId } = await flow.send(GET_TASK, { id: task.id }, { sessionId });
        const { status, error, output: answered } = await flow.request(requestId).result();
        const output = answered as { ok?: boolean; error?: string; task?: Record<string, any> } | undefined;
        if (status !== "completed" || output?.ok === false || output?.task === undefined) {
          throw new Error(output?.error ?? error?.message ?? "The task couldn't be read, so it wasn't filed again.");
        }
        const held = output.task;
        const { context: _context, labels: _labels, priority: _priority, ...rest } = task;
        return {
          ...rest,
          ...(typeof held.context === "string" ? { context: held.context } : {}),
          ...(Array.isArray(held.labels) ? { labels: held.labels as string[] } : {}),
          ...(typeof held.priority === "number" ? { priority: held.priority } : {}),
        };
      };
      return {
        cancel: async (taskId) => (await board()).cancel(taskId),
        steer: async (taskId, message) => (await board()).steer(taskId, message),
        release: async (taskId) => (await board()).release(taskId),
        retry: async (taskId) => (await board()).retry(taskId),
        rerun: async (task, worker) => {
          const whole = await withBrief(task);
          return (await board()).refile(refileRowOf(whole), rerunOverrides(whole, worker));
        },
      };
    },
    async answerOpenHold(sessionId, taskId, answer) {
      const kind = "text" in answer ? "question" : "review";
      const hold = openHolds.get(sessionId)?.get(taskId)?.find((h) => h.ask.kind === kind);
      if (hold === undefined) throw new Error(`This task isn't waiting on your ${kind === "question" ? "answer" : "review"} any more.`);
      await inbox.answerOne(hold, inboxAnswerOf(answer));
    },
    watchWorking(run, onChange) {
      let now: WorkingNow = {};
      let last = "";
      const tell = (next: WorkingNow) => {
        now = next;
        const seen = JSON.stringify(now);
        if (seen === last) return;
        last = seen;
        onChange(now);
      };
      // The session stream sends a call once it is finished; the run request's own stream sends it as it starts.
      let fed: readonly OutputItem[] = [];
      let streamed: readonly OutputItem[] = [];
      const tellInFlight = () => {
        const inFlight = inFlightOf(streamed, fed, run.requestId);
        const { inFlight: _, ...rest } = now;
        tell(inFlight === undefined ? rest : { ...rest, inFlight });
      };
      const stopFeed = watchFeed(run.sessionId, (items) => items as unknown as OutputItem[], (items) => {
        fed = items;
        tellInFlight();
      });
      const requestId = run.requestId;
      const stopCalls =
        requestId === undefined
          ? () => {}
          : followRequestCalls(
              client,
              client.sessions.get(run.sessionId).then((detail) => detail.flowId ?? detail.flowKind),
              requestId,
              (items) => {
                streamed = items;
                tellInFlight();
              },
            );
      // A harness records its plan apart from the run's items: read again on each write to it.
      const stopPlan =
        requestId === undefined
          ? () => {}
          : onNotice(
              client,
              [topic.session(run.sessionId)],
              isPlanWrite,
              () => readRecordedWork(client, { sessionId: run.sessionId, requestId }),
              (work) => {
                const { plan: _, ...rest } = now;
                tell(work.plan === null ? rest : { ...rest, plan: work.plan.rows.map(({ title, status }) => ({ title, status })) });
              },
            );
      return () => {
        stopFeed();
        stopCalls();
        stopPlan();
      };
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
