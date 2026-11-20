/**
 * A session's tasks and each one's work: harness-manager's coding board view
 * at user scope, a task's run session (`useSessionFeed`), the run request's
 * stream for the call in flight (`useRequestStream`), and harness-manager's
 * recorded work view.
 */
import { useMemo } from "react";
import type { OutputItem } from "@flow-state-dev/core/items";
import { useRequestStream, useView } from "@flow-state-dev/react";
import { taskView, type BoardActions, type InboxHold, type TaskView } from "@flow-state-dev/orchestration/inbox";
import type { TaskSpendView } from "@flow-state-dev/orchestration/tasks";
import { codingBoardViewRef, recordedWorkViewRef, type CodingBoardTask, type ReviewDetail } from "@flow-state-dev/harness-manager/browser";
import { reviewStopIdOf, reviewStopOf } from "../lib/review-stop";
import { toolInFlight, type PlanRowNow, type ToolCallNow } from "../components/flow-state/working-status";
import type { LandedWork } from "../components/flow-state/review-hold";
import { useAppContext } from "./provider";
import { THREAD_ITEMS, useFeed } from "./feed";

/** A task's status, as the task tools name it. */
export type TaskStatus = "pending" | "in_progress" | "held" | "completed" | "errored" | "cancelled";

/**
 * One task as the screen draws it: the coding board view's row, in the
 * screen's optional fields, with the two things the screen computes from
 * it: its first open hold (`openHold`) and orchestration's `taskView`.
 */
export type AppTask = Pick<CodingBoardTask, "id" | "goal"> & {
  title: string;
  status: TaskStatus;
  assignee?: string;
  statusNote?: string;
  /** What the task waits on you for: the first of the view's `asks`. */
  openHold?: { kind: "approval" | "input" | "review" | "question"; prompt: string };
  /** The view's `asks`: where each answer goes. */
  asks?: InboxHold[];
  harness?: string;
  /** The pull requests it waits on; each link is the recorded work view's (`withPullRequestLinks`). */
  pullRequests?: { number: number | null; url: string | null; title: string | null }[];
  review?: "accepted" | "deadline" | null;
  landed?: LandedWork;
  steps?: { done: number; total: number };
  updatedAt?: number;
  startedAt?: number;
  spend?: TaskSpendView;
  error?: string;
  attempts?: number;
  view?: TaskView;
  /** When this attempt's run started, and the row's lease deadline, for the time signal. */
  run?: { startedAt?: number; leaseUntil?: number };
  /** The run working it, or the one that last did: where its work is read, and the flow its session runs on, where its own stream is. */
  runLink?: { sessionId: string; requestId: string; flow?: string };
};

/** A board's task changes, as the opened task's action row makes them. */
export type TaskBoardCalls = Pick<BoardActions, "cancel" | "steer" | "release" | "retry">;

/** The read-only work of one task. */
export interface TaskWork {
  /** Its run session's items its lines are drawn from; the review stops are its review card's. */
  items: OutputItem[];
  review?: ReviewDetail;
  /** The id of the latest review stop: one per review round. */
  reviewStop?: string;
  loadEarlier?: () => Promise<void>;
  working?: WorkingNow;
  /** The pull requests its run opened, with their links, from the recorded work view. */
  pullRequests?: { number: number | null; url: string; title: string | null }[];
}

/** What a running task's run shows it doing now. */
export interface WorkingNow {
  inFlight?: ToolCallNow;
  plan?: PlanRowNow[];
}

/** The one item type a run request's own stream is read for: the tool call in flight. */
const TOOL_CALLS = { itemTypes: ["tool_output"] };

/** A session's tasks, as the coding board view answers them; `stale` while its last read failed. */
export function useTasks(sessionId: string | undefined): { value: AppTask[] | undefined; stale: boolean } {
  const { client, pollIntervalMs } = useAppContext();
  const read = useView(codingBoardViewRef(), { sessionId: sessionId ?? "" }, { client, pollIntervalMs, enabled: sessionId !== undefined });
  const value = useMemo(() => (read.value === undefined || sessionId === undefined ? undefined : read.value.map((task) => appTaskOf(task, sessionId))), [read.value, sessionId]);
  return { value, stale: read.stale };
}

/** A coding board row in the screen's fields, with its first open hold and its `taskView`. Exported for its test. */
export function appTaskOf(task: CodingBoardTask, sessionId: string): AppTask {
  const hold = task.asks[0];
  const startedAt = task.startedAt ?? task.run?.startedAt;
  const run = { ...(typeof task.run?.startedAt === "number" ? { startedAt: task.run.startedAt } : {}), ...(typeof task.leaseUntil === "number" ? { leaseUntil: task.leaseUntil } : {}) };
  return {
    id: task.id,
    title: task.title ?? task.goal,
    goal: task.goal,
    status: task.status as TaskStatus,
    attempts: task.attempts,
    asks: task.asks,
    ...(task.assignee === undefined ? {} : { assignee: task.assignee }),
    ...(task.statusNote == null ? {} : { statusNote: task.statusNote }),
    ...(typeof task.updatedAt === "number" ? { updatedAt: task.updatedAt } : {}),
    ...(typeof startedAt === "number" ? { startedAt } : {}),
    ...(task.spend == null ? {} : { spend: task.spend }),
    ...(hold === undefined ? {} : { openHold: { kind: hold.ask.kind === "confirm" ? "input" : hold.ask.kind, prompt: hold.ask.prompt } }),
    ...(task.harness === null ? {} : { harness: task.harness }),
    ...(task.pullRequests.length === 0 ? {} : { pullRequests: task.pullRequests.map((number) => ({ number, url: null, title: null })) }),
    ...(task.harness !== null && task.status === "completed" ? { review: task.review } : {}),
    ...(task.landed === null ? {} : { landed: task.landed }),
    ...(task.error === null ? {} : { error: task.error }),
    ...(Object.keys(run).length === 0 ? {} : { run }),
    ...(typeof task.run?.sessionId === "string" && typeof task.run?.requestId === "string"
      ? { runLink: { sessionId: task.run.sessionId, requestId: task.run.requestId, ...(task.runFlow === null ? {} : { flow: task.runFlow }) } }
      : {}),
    view: taskView({ ...task, board: sessionId } as Parameters<typeof taskView>[0]),
  };
}

/** A task's pull requests, each with its link from its run's recorded work. */
export function withPullRequestLinks(task: AppTask, work: TaskWork | undefined): AppTask {
  if (task.pullRequests === undefined || work?.pullRequests === undefined) return task;
  return { ...task, pullRequests: task.pullRequests.map((pr) => work.pullRequests!.find((opened) => opened.number === pr.number) ?? pr) };
}

/**
 * A task with its pull requests' links, read from its run's recorded work
 * only while it waits on one: what a card shows without following its run.
 */
export function usePullRequestLinks(task: AppTask): AppTask {
  const { client, pollIntervalMs } = useAppContext();
  const waits = task.pullRequests !== undefined && task.runLink !== undefined;
  const recorded = useView(recordedWorkViewRef(), { requestId: task.runLink?.requestId ?? "" }, { client, pollIntervalMs, sessionId: task.runLink?.sessionId, enabled: waits }).value;
  return useMemo(() => withPullRequestLinks(task, recorded === undefined ? undefined : { items: [], pullRequests: recorded.pullRequests.rows }), [task, recorded]);
}

/**
 * A task's work: its run session's items, from the moment the board names
 * that session; while it runs, the tool call in flight (the run request's own
 * stream, which sends a call as it starts) and the plan its harness
 * recorded; and the pull requests its run opened, from the recorded work view.
 */
export function useTaskWork(task: AppTask | undefined): TaskWork | undefined {
  const { client, pollIntervalMs } = useAppContext();
  const runSession = task?.runLink?.sessionId ?? null;
  const running = task?.status === "in_progress" && task.runLink !== undefined ? task.runLink.requestId : null;
  const coding = task?.harness !== undefined && task.runLink !== undefined;
  const feed = useFeed(client, runSession, [...THREAD_ITEMS, "suspension"]);
  const recorded = useView(recordedWorkViewRef(), { requestId: task?.runLink?.requestId ?? "" }, { client, pollIntervalMs, sessionId: runSession ?? undefined, enabled: coding }).value;
  const runFlow = task?.runLink?.flow;
  // The run request's own stream sends a call as it starts; a dropped one opens again, resuming where it was.
  // Each call shows as it lands, not on the next frame: a call is a line, not a token.
  const streamed = useRequestStream({ client, flowKind: runFlow, source: { requestId: running ?? "" }, filter: TOOL_CALLS, reconnect: true, flush: "immediate", enabled: running !== null && runFlow !== undefined })
    .items as readonly OutputItem[];
  return useMemo(() => {
    if (task === undefined) return undefined;
    if (runSession === null) return { items: [] };
    if (feed?.items === undefined) return undefined;
    const fed = feed.items;
    const review = reviewStopOf(fed);
    const reviewStop = reviewStopIdOf(fed);
    const inFlight = running === null ? undefined : inFlightOf(streamed, fed, running);
    const plan = running === null ? undefined : recorded?.plan?.rows.map(({ title, status }) => ({ title, status }) as PlanRowNow);
    const working: WorkingNow = { ...(inFlight === undefined ? {} : { inFlight }), ...(plan === undefined ? {} : { plan }) };
    return {
      items: fed.filter((item) => item.type !== "suspension"),
      ...(review === undefined ? {} : { review }),
      ...(reviewStop === undefined ? {} : { reviewStop }),
      ...(feed.loadEarlier === undefined ? {} : { loadEarlier: feed.loadEarlier }),
      ...(Object.keys(working).length === 0 ? {} : { working }),
      ...(recorded === undefined || recorded.pullRequests.rows.length === 0 ? {} : { pullRequests: recorded.pullRequests.rows }),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task === undefined, runSession, running, feed, recorded, streamed]);
}

/**
 * The call a run is in now: the request's own stream, which sends a call as it
 * starts, and the session feed, whose finished copy of a call wins. The feed's
 * own candidates are the run request's only.
 */
function inFlightOf(streamed: readonly OutputItem[], fed: readonly OutputItem[], requestId: string): ToolCallNow | undefined {
  const finished = new Set(fed.filter((item) => item.status !== "in_progress").map((item) => item.id));
  return toolInFlight(streamed.filter((item) => !finished.has(item.id))) ?? toolInFlight(fed.filter((item) => item.requestId === requestId));
}
