// fallow-ignore-file duplicate-export -- each lab is its own app, and both expose the same LabAdapter shape on purpose.
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
 * | `watchConversation` | the session's items, from its snapshot and then its stream (`sessionFeed`), |
 * |                     | each run of tool calls named by the UI registry's `tool-naming` and        |
 * |                     | `tool-grouping`, and its requests (is it answering) on each request notice, |
 * |                     | via `client.subscribe`                                                     |
 * | `watchConnection`   | the same feed's connection state: `live`, `lapsed` once a retry has failed…  |
 * | `answerApproval`    | the request's `answer`: approve or reject a `user_approval` stop             |
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
 * |                     | and `taskSpendView` on a row, for the harness and model its run reported      |
 * |                     | and each linked run's session, where the run writes its row (its holds)      |
 * |                     | and `taskRowView` with the Inbox's holds (`inboxItems`), for what it waits on |
 * |                     | you for                                                                      |
 * | `answerTask`        | the Inbox client's `answerOne`, on the task's open question or review         |
 * | `taskActions`       | the Inbox client's `board(at)` on the conversation that filed the task, its   |
 * |                     | `"tasks"` board: cancel, steer, release, retry, and `refile` for a re-run      |
 * | `watchReview`       | the run's review stop, read by harness-manager's browser `reviewDetail`        |
 * | `watchRun`          | the items of the session the task's row names as its run, each tool call      |
 * |                     | named by the UI registry's `tool-naming` (`components/flow-state/`)           |
 * | `watchExchange`     | the receiving worker's conversation: the turn that read one message          |
 *
 * `watchTalk` and `watchTasks`' board read still read on a clock (`poll`); every other watch reads on a change.
 *
 * A received message is drawn from its own item (`workforce:received`), which
 * carries its message id, so the pending line joins the log to the
 * conversation by id (gap G2, shipped with FIX-2070).
 *
 * The page acts as the user `fsdev dev` hands it (the config's `devtool`
 * block), with the bearer token when there is one, on the server it came from.
 */
import {
  createClient,
  readEveryCollectionPage,
  topic,
  type Client,
  type SessionConnectionState,
  type SessionRequestSummary,
  type WireNotice,
  type WireTopic,
} from "@flow-state-dev/client";
import { isSuspensionWait, type OutputItem } from "@flow-state-dev/core/items";
import { readBasePath, readBearerToken, readUserId, withBearerToken } from "@flow-state-dev/devtool/react";
import {
  createWorkforceClient,
  delegateAnswerOf,
  RECEIVED_MESSAGE_COMPONENT,
  SEND_MESSAGE_TOOL,
  WORKER_MESSAGES_RESOURCE,
  workerMessageRowSchema,
  type RosterEntry,
  type WorkforceClient,
} from "@flow-state-dev/workforce/browser";
import { isTerminalStatus, parseNotice, taskSpendView, taskSpendViewSchema } from "@flow-state-dev/orchestration/tasks";
import {
  createInboxClient,
  inboxItems,
  taskActionName,
  taskRowView,
  type InboxAnswer,
  type InboxHold,
  type InboxRow,
  type RefileOverrides,
  type RefileRow,
} from "@flow-state-dev/orchestration/inbox";
import { reviewDetail, type ReviewDetail } from "@flow-state-dev/harness-manager/browser";
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
  /** `cancelled` is its own ending: a task someone withdrew did not fail. */
  status: "running" | "done" | "failed" | "cancelled";
  /**
   * The row's own board status (`pending`, `held`, `in_progress`, `completed`,
   * `errored`, `cancelled`), which `status` folds for the screen. The task's
   * actions follow this one, since the board decides by it.
   */
  boardStatus: string;
  /** What the run reported when it completed. */
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
  /** What it waits on you for, while something does: its oldest open hold. */
  waiting?: TaskWaiting;
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

/** Your answer to what a task waits on: the words to a question, or a review's verdict. */
export type TaskAnswer = { text: string } | { verdict: "accepted" } | { verdict: "revise"; words: string };

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
  /** `streaming` while the answer is still being written. */
  | { kind: "assistant"; id: string; text: string; streaming?: boolean }
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

/** Everything the screen reads and writes. */
export interface LabAdapter {
  listWorkers(): Promise<WorkerRow[]>;
  /** The worker's one conversation; the same id every time. */
  openConversation(worker: string): Promise<string>;
  send(sessionId: string, text: string): Promise<void>;
  watchConversation(sessionId: string, onChange: (view: ConversationView) => void): Unsubscribe;
  /** Whether the conversation's feed still hears the server, in the session feed's words. */
  watchConnection(sessionId: string, onChange: (state: SessionConnectionState) => void): Unsubscribe;
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
  /** The run's latest review, read from its stop; `undefined` until it stops for one. */
  watchReview(runSessionId: string, onChange: (review: ReviewDetail | undefined) => void): Unsubscribe;
  /** Answer what a task waits on you for; the run goes on, or the task completes on an accept. */
  answerTask(sessionId: string, taskId: string, answer: TaskAnswer): Promise<void>;
  /** The board's actions on the tasks conversation `sessionId` filed, sent to that conversation's board. */
  taskActions(sessionId: string): TaskActions;
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
 * (FIX-2466), reporting a value only when it changed, as {@link poll} does.
 * A connect, a reconnect, a tick and a `resync` read too. One read at a time,
 * and one waiting for any number of notices. Wherever push can miss a change,
 * `client.subscribe` reads every `everyMs` instead, so the view keeps no timer
 * of its own. A failed read tries again on its own ({@link retryAfterFailure}).
 * A read still out when the watch stops reports nothing.
 */
function onNotice<T>(
  client: Client,
  topics: readonly WireTopic[],
  hears: (notice: WireNotice) => boolean,
  read: () => Promise<T>,
  onValue: (value: T) => void,
  everyMs = POLL_MS,
): Unsubscribe {
  let live = true;
  let last = "";
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
    } catch (error) {
      console.error("teammates: a read failed", error);
      if (live) retry.failed();
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

/** A request notice: one of the session's requests was created, moved or deleted. Never `items`, sent per stored chunk. */
const isRequest = (notice: WireNotice): boolean => notice.kind === "request";

/** The latest copy of each board row in a conversation's items, oldest filing first. */
function boardRows(items: readonly Item[]): Map<string, Record<string, any>> {
  const rows = new Map<string, Record<string, any>>();
  for (const item of items) {
    if (item.type === "component" && item.component === TASK_CHANGE && item.data?.task?.id) rows.set(item.data.task.id, item.data.task);
  }
  return rows;
}

/**
 * What a row's spend says ran it: the harness and model its run reported, or nothing.
 *
 * A row reaches here in one of two shapes: the stored ledger (`spend.requests`), as a
 * `task-change` item carries it, or the view the board's `listTasks` read already folded
 * (`taskSpendViewSchema`). Folding a view again would read as nothing spent.
 */
function spendOf(row: Record<string, any>): { harness?: string; model?: string } {
  try {
    const folded = taskSpendViewSchema.safeParse(row.spend);
    const view = folded.success ? folded.data : taskSpendView(row as never);
    return { ...(view?.harness == null ? {} : { harness: view.harness }), ...(view?.model == null ? {} : { model: view.model }) };
  } catch {
    return {};
  }
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
  const answer = typeof row.output?.answer === "string" ? row.output.answer : undefined;
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
    ...harnessAndModel(spendOf(row), harnessOf(row.assignee ?? "")),
    ...waitingOf(row, holds),
  };
}

/** The fields a re-file copies from a task, as the board's `refile` takes them. */
function refileRowOf(task: BoardTask): RefileRow {
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

/** What a row waits on you for, as `taskRowView` reads it: its oldest open hold, or nothing. */
function waitingOf(row: Record<string, any>, holds: readonly InboxHold[] | undefined): { waiting?: TaskWaiting } {
  if (typeof row.id !== "string" || typeof row.status !== "string") return {};
  const hold = taskRowView({ ...row, board: row.board ?? "" } as InboxRow, holds).hold;
  if (hold === null) return {};
  const kind = hold.ask.kind === "question" || hold.ask.kind === "review" ? hold.ask.kind : "other";
  return { waiting: { kind, prompt: hold.ask.prompt, unanswerable: hold.unanswerable } };
}

/**
 * Each row's open holds, as the Inbox reads them, so each knows where its
 * answer goes: a question to the board's `updateTask` on the conversation
 * that filed it, a run's stop to the run's own flow. Exported for its tests.
 *
 * @param flowOf The flow that owns a session: the conversation's, or a run's.
 */
export function holdsOfRows(sessionId: string, rows: readonly Record<string, any>[], flowOf: (sessionId: string) => string | undefined): Map<string, InboxHold[]> {
  const inboxRows: InboxRow[] = rows.map((row) => ({
    ...(row as InboxRow),
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
  return { value: answer.verdict === "accepted" ? { verdict: "accepted" } : { verdict: "revise", words: answer.words } };
}

/** The harness by its name (the run's, else the worker's), and the run's model. */
function harnessAndModel(spend: { harness?: string; model?: string }, setting: string | undefined): { harness?: string; model?: string } {
  const harness = spend.harness ?? setting;
  return {
    ...(harness === undefined ? {} : { harness: harnessName(harness) }),
    ...(spend.model === undefined ? {} : { model: spend.model }),
  };
}

/**
 * A conversation's items as the entries the screen draws. `ended` names the
 * requests the server lists as over: a step their turn left running (a turn
 * that crashed mid-call) reads failed, not running for good.
 */
export function toEntries(items: readonly Item[], workers: ReadonlySet<string>, ended: readonly string[] = []): ConversationEntry[] {
  const rows = boardRows(items);
  const entries: ConversationEntry[] = [];
  /** The turn the last run of steps belongs to: a run never spans two. */
  let runTurn: unknown;
  for (const item of items) {
    if (item.type === "message" && item.role === "user") {
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
      if (text.trim() !== "") entries.push({ kind: "assistant", id: item.id, text, ...(item.status === "in_progress" ? { streaming: true } : {}) });
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
  /** Each conversation's tasks' open holds, from its last read: what `answerTask` answers. */
  const openHolds = new Map<string, Map<string, InboxHold[]>>();
  const feeds = sessionFeeds(client);
  /** Each worker's conversation, and the flow it runs on, once opened. */
  const conversations = new Map<string, { sessionId: string; flow: string }>();
  /** Told each time a conversation opens, so a worker's activity is watched from then. */
  const conversationOpened = new Set<() => void>();
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
    for (const tell of [...conversationOpened]) tell();
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
    watchConnection(sessionId, onChange) {
      return feeds(sessionId).watchState(onChange);
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
      const feed = feeds(sessionId);
      const loadEarlier = () => feed.loadEarlier();
      const emit = () => {
        const running = answeringOf(items, inProgress, ended);
        const earlier = feed.hasEarlier();
        if (shown?.entries === entries && shown.running === running && (shown.loadEarlier !== undefined) === earlier) return;
        shown = { entries, running, ...(earlier ? { loadEarlier } : {}) };
        onChange(shown);
      };
      const stopFeed = watchFeed(sessionId, (next) => next, (next) => {
        items = next;
        reuse(toEntries(items, workerIds, ended));
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
          // A turn that ended with a call still marked running reads that call failed.
          reuse(toEntries(items, workerIds, ended));
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
    watchTasks(sessionId, onChange) {
      const show = stableList(onChange);
      let rows = new Map<string, Record<string, any>>();
      /**
       * Each row as the board's last read answered it. A task settles, and its run links itself, in
       * the task's own session, which the conversation's stream doesn't carry; the board's notice
       * does, and the read says what changed.
       */
      let listed = new Map<string, Record<string, any>>();
      /**
       * Each linked run's own copy of its row. A run writes its row on its own session (its link, its
       * questions, its review), so the conversation hears of those only when the task ends: the run's
       * session is followed too.
       */
      const runRows = new Map<string, Record<string, any>>();
      const runFeeds = new Map<string, Unsubscribe>();
      /**
       * A row is the board read's (FIX-2429): every committed write of a row sends a board notice, so
       * the read is never more than one notice behind, and a field it leaves out is cleared (an
       * answered hold). Until the first read lands, the conversation's copy, else the run's, stands in.
       * The run's and the conversation's copies give only what the read never carries: the task's
       * brief ({@link BRIEF}), and an ended task's output and error ({@link UNPROJECTED}).
       */
      const rowOf = (id: string): Record<string, any> => {
        const board = listed.get(id);
        if (board === undefined) return rows.get(id) ?? runRows.get(id)!;
        const kept: Record<string, unknown> = {};
        for (const field of isTerminalStatus(board.status) ? [...BRIEF, ...UNPROJECTED] : BRIEF) {
          const value = runRows.get(id)?.[field] ?? rows.get(id)?.[field];
          if (value !== undefined) kept[field] = value;
        }
        return { ...board, ...kept };
      };
      const followRuns = (current: readonly Record<string, any>[]) => {
        for (const row of current) {
          const runSession = row.run?.sessionId;
          if (typeof runSession !== "string") continue;
          // An ended task's run is let go once the run's own copy says it ended (it carries the output
          // the board read doesn't), or never followed when no copy of it was ever read.
          if (isTerminalStatus((runRows.get(row.id) ?? row).status)) {
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
      // A run links itself, and a task settles, on its own session: the board's notice says so
      // (FIX-2429). The topics are narrowed to the ledgers the read returns, so every notice on
      // them is the board's: a reply streaming in the conversation never reaches them.
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
      const board = async () => {
        let flowId = flowOfSession.get(sessionId);
        if (flowId === undefined) {
          const detail = await client.sessions.get(sessionId);
          flowId = detail.flowId ?? detail.flowKind;
          flowOfSession.set(sessionId, flowId);
        }
        return inbox.board({ flowId, sessionId, board: TASK_BOARD });
      };
      return {
        cancel: async (taskId) => (await board()).cancel(taskId),
        steer: async (taskId, message) => (await board()).steer(taskId, message),
        release: async (taskId) => (await board()).release(taskId),
        retry: async (taskId) => (await board()).retry(taskId),
        rerun: async (task, worker) => (await board()).refile(refileRowOf(task), rerunOverrides(task, worker)),
      };
    },
    async answerTask(sessionId, taskId, answer) {
      const kind = "text" in answer ? "question" : "review";
      const hold = openHolds.get(sessionId)?.get(taskId)?.find((h) => h.ask.kind === kind);
      if (hold === undefined) throw new Error(`This task isn't waiting on your ${kind === "question" ? "answer" : "review"} any more.`);
      await inbox.answerOne(hold, inboxAnswerOf(answer));
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
