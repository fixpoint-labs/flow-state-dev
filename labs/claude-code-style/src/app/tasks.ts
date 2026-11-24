/**
 * A session's tasks and each one's work: harness-manager's coding board view
 * at user scope, a task's run session (`useSessionFeed`), the run request's
 * stream for the call in flight (`useRequestStream`), and harness-manager's
 * recorded work view. A task is the view's row, `CodingBoardTask`, read as it
 * is: the screen keeps no row type of its own.
 */
import { useMemo } from "react";
import type { OutputItem } from "@flow-state-dev/core/items";
import { useRequestStream, useView } from "@flow-state-dev/react";
import type { BoardActions } from "@flow-state-dev/orchestration/inbox";
import { codingBoardViewRef, recordedWorkViewRef, type CodingBoardTask, type ReviewDetail } from "@flow-state-dev/harness-manager/browser";
import { reviewStopIdOf, reviewStopOf } from "../lib/review-stop";
import { toolInFlight, type PlanRowNow, type ToolCallNow } from "../components/flow-state/working-status";
import { useAppContext } from "./provider";
import { THREAD_ITEMS, useFeed } from "./feed";

/** A task's status, as the task tools name it. */
export type TaskStatus = "pending" | "in_progress" | "held" | "completed" | "errored" | "cancelled";

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
export function useTasks(sessionId: string | undefined): { value: CodingBoardTask[] | undefined; stale: boolean } {
  const { client, pollIntervalMs } = useAppContext();
  const read = useView(codingBoardViewRef(), { sessionId: sessionId ?? "" }, { client, pollIntervalMs, enabled: sessionId !== undefined });
  return { value: sessionId === undefined ? undefined : read.value, stale: read.stale };
}

/** The pull requests a task waits on, each with its link and title from its run's recorded work when that names it, else `null`. */
export function pullRequestLinks(task: Pick<CodingBoardTask, "pullRequests">, work: TaskWork | undefined): { number: number | null; url: string | null; title: string | null }[] {
  return task.pullRequests.map((number) => work?.pullRequests?.find((opened) => opened.number === number) ?? { number, url: null, title: null });
}

/**
 * A task's pull requests with their links, read from its run's recorded work
 * only while it waits on one: what a card shows without following its run.
 */
export function usePullRequestLinks(task: CodingBoardTask): ReturnType<typeof pullRequestLinks> {
  const { client, pollIntervalMs } = useAppContext();
  const waits = task.pullRequests.length > 0 && task.run !== undefined;
  const recorded = useView(recordedWorkViewRef(), { requestId: task.run?.requestId ?? "" }, { client, pollIntervalMs, sessionId: task.run?.sessionId, enabled: waits }).value;
  return useMemo(() => pullRequestLinks(task, recorded === undefined ? undefined : { items: [], pullRequests: recorded.pullRequests.rows }), [task, recorded]);
}

/**
 * Whether a task's run is a coding run whose recorded work is read: it runs
 * through a harness (`harness` is `null` for a plain worker's task) and a run
 * is linked. Exported for its test.
 */
export const readsRecordedWork = (task: Pick<CodingBoardTask, "harness" | "run"> | undefined): boolean => task?.harness != null && task.run !== undefined;

/**
 * A task's work: its run session's items, from the moment the board names
 * that session; while it runs, the tool call in flight (the run request's own
 * stream, which sends a call as it starts) and the plan its harness
 * recorded; and the pull requests its run opened, from the recorded work view.
 */
export function useTaskWork(task: CodingBoardTask | undefined): TaskWork | undefined {
  const { client, pollIntervalMs } = useAppContext();
  const runSession = task?.run?.sessionId ?? null;
  const running = task?.status === "in_progress" && task.run !== undefined ? task.run.requestId : null;
  const coding = readsRecordedWork(task);
  const feed = useFeed(client, runSession, [...THREAD_ITEMS, "suspension"]);
  const recorded = useView(recordedWorkViewRef(), { requestId: task?.run?.requestId ?? "" }, { client, pollIntervalMs, sessionId: runSession ?? undefined, enabled: coding }).value;
  const runFlow = task?.runFlow ?? undefined;
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
