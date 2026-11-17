/**
 * The tasks a conversation files: the board's rows as task cards, what each
 * waits on you for and your answer, and the board's actions on them (cancel,
 * steer, release, retry, and `refile` for a re-run).
 */
import { answerTextOf } from "@flow-state-dev/workforce/browser";
import { isTerminalStatus, type TaskSpendView } from "@flow-state-dev/orchestration/tasks";
import {
  inboxItems,
  taskActionName,
  taskListViewRef,
  taskView,
  type InboxAnswer,
  type InboxHold,
  type InboxTaskInput,
  type RefileOverrides,
  type RefiledTask,
  type TaskView,
} from "@flow-state-dev/orchestration/inbox";
import { pullRequestWait, type PullRequestWaitInput } from "@flow-state-dev/harness-manager/browser";
import type { LandedWork, ReviewLand } from "../components/flow-state/review-hold";
import { harnessName } from "../lib/harness";
import { stableList } from "../lib/stable";
import type { Item } from "./items";
import { logFailedRead, POLL_MS, type Unsubscribe } from "./reads";
import type { AppState } from "./state";

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
  /** The request that is its latest run, in {@link runSessionId}: what the run recorded is read by the two. */
  runRequestId?: string;
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
export type TaskAnswer = { text: string } | { verdict: "accepted"; land?: ReviewLand; words?: string } | { verdict: "revise"; words: string };

/**
 * How long this attempt ran: from its start (the run link's, so a retry times
 * itself, not the task's first start) to when the task ended. `undefined`
 * while it runs, or when either end is missing.
 */
export function attemptDurationMs(task: Pick<BoardTask, "status" | "startedAt" | "view">): number | undefined {
  const end = task.view?.times.completedAt;
  if (task.status === "running" || task.startedAt === undefined || end == null || end < task.startedAt) return undefined;
  return end - task.startedAt;
}

/** The keyed data item a conversation's board emits for each row it changes. */
const TASK_CHANGE = "task-change";
/** What a board row's task-list view never carries: an ended task's output and error, read from the row's other copies. */
const UNPROJECTED = ["output", "error"] as const;
/** Nor the brief a re-run copies beside its goal and title, read from those copies too, open or ended. */
const BRIEF = ["context", "labels", "priority"] as const;
/** The board a conversation files its tasks on: Workforce's `"tasks"`. */
const TASK_BOARD = "tasks";
/** The board's action a question on a row is answered through, on the conversation that filed it. */
const UPDATE_TASK = taskActionName("updateTask", TASK_BOARD);
/** The board's one-task read: a re-run copies the whole brief from it. */
const GET_TASK = taskActionName("getTask", TASK_BOARD);

/** Whether `copy` of a row is of the same attempt (try count and run) as `row`: a retry's copies speak only for it. */
function sameAttempt(copy: Record<string, any> | undefined, row: Record<string, any>): boolean {
  return copy !== undefined && (copy.attempts ?? 0) === (row.attempts ?? 0) && (copy.run?.sessionId ?? null) === (row.run?.sessionId ?? null);
}

/** The latest copy of each board row in a conversation's items, oldest filing first. */
export function boardCopies(items: readonly Item[]): Map<string, Record<string, any>> {
  const rows = new Map<string, Record<string, any>>();
  for (const item of items) {
    if (item.type === "data" && item.dataType === TASK_CHANGE && item.value?.task?.id) rows.set(item.value.task.id, item.value.task);
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
    ...(typeof row.run?.sessionId === "string" && typeof row.run?.requestId === "string" ? { runRequestId: row.run.requestId } : {}),
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
  const wait = pullRequestWait(row as PullRequestWaitInput);
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
export function holdsOfTasks(sessionId: string, rows: readonly Record<string, any>[], flowOf: (sessionId: string) => string | undefined): Map<string, InboxHold[]> {
  const inboxRows: InboxTaskInput[] = rows.map((row) => ({
    ...(row as InboxTaskInput),
    board: sessionId,
    holder: { sessionId, action: UPDATE_TASK },
  }));
  const items = inboxItems({ rows: inboxRows, suspensions: [], flowOf });
  return new Map(items.flatMap((item) => (item.task === null ? [] : [[item.task.taskId, [...item.holds]] as const])));
}

/**
 * A {@link TaskAnswer} as the Inbox client's answer for the hold it answers.
 * An accept's `words` (the note on Open a PR or Retry) go with it, so a failed
 * landing hands them to the coding session. Exported for its tests.
 */
export function inboxAnswerOf(answer: TaskAnswer): InboxAnswer {
  if ("text" in answer) return { text: answer.text };
  if (answer.verdict === "revise") return { value: { verdict: "revise", words: answer.words } };
  return {
    value: {
      verdict: "accepted",
      ...(answer.land === undefined ? {} : { land: answer.land }),
      ...(answer.words === undefined ? {} : { words: answer.words }),
    },
  };
}

/** The harness by its name (the run's, else the worker's), and the run's model. */
function harnessAndModel(spend: TaskSpendView | null, setting: string | undefined): { harness?: string; model?: string } {
  const harness = spend?.harness ?? setting;
  return {
    ...(harness == null ? {} : { harness: harnessName(harness) }),
    ...(spend?.model == null ? {} : { model: spend.model }),
  };
}

/** The tasks a conversation filed, what they wait on you for, and the board's actions on them. */
export interface TaskCalls {
  /**
   * The tasks a conversation filed, oldest first. `onStale` hears `true` when the board's read
   * fails (the rows handed last are kept, so they may be old) and `false` when one succeeds again.
   */
  watchTasks(sessionId: string, onChange: (tasks: BoardTask[]) => void, onStale?: (stale: boolean) => void): Unsubscribe;
  /** Answer what a task waits on you for; the run goes on, or the task completes on an accept. */
  answerOpenHold(sessionId: string, taskId: string, answer: TaskAnswer): Promise<void>;
  /** The board's actions on the tasks conversation `sessionId` filed, sent to that conversation's board. */
  taskActions(sessionId: string): TaskActions;
}

/** {@link TaskCalls} over the app's shared state. */
export function taskCalls(state: AppState): TaskCalls {
  const { client, inbox, flowOfSession, runFlows, openHolds, watchFeed } = state;
  return {
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
          const stop = watchFeed(runSession, boardCopies, (read) => {
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
        const holds = holdsOfTasks(sessionId, current, flowOf);
        openHolds.set(sessionId, holds);
        show(current.map((row) => toBoardTask(row, (worker) => state.harnesses.get(worker), holds.get(row.id) ?? [])));
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
      // The board's view, on the conversation's flow: its answer names the topics to hear next.
      const stopBoard = client.live<Array<Record<string, any>>>([], {
        topicsFromResult: true,
        read: async () => {
          const flow = flowOfSession.get(sessionId) ?? (await client.sessions.get(sessionId)).flowKind;
          // Its answer says what it hears under those topics, too: a reply streaming in the conversation reads nothing.
          const { value, topics, hears } = await client.view(taskListViewRef(flow, TASK_BOARD), {}, { sessionId });
          return { value, topics, ...(hears === undefined ? {} : { hears }) };
        },
        onValue: (tasks) => {
          if (stopped) return;
          listed = new Map(tasks.map((task) => [task.id as string, task]));
          publish();
        },
        pollIntervalMs: POLL_MS,
        onStale: (stale) => {
          if (!stopped) onStale?.(stale);
        },
        onError: logFailedRead,
      }).close;
      const stopFeed = watchFeed(sessionId, boardCopies, (read) => {
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
  };
}
