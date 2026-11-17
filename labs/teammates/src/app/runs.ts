/**
 * A task's run, read only: its steps, its review, the pull requests and plan
 * it recorded, and what it is doing now, from its session's items and its
 * request's own stream, which sends a call as it starts.
 */
import { bindStoreToCallbacks, createRequestStreamStore, topic, type Client, type WireNotice } from "@flow-state-dev/client";
import type { OutputItem } from "@flow-state-dev/core/items";
import { OBSERVED_PLAN, OBSERVED_PLAN_LIST } from "@flow-state-dev/core/harness";
import { readRecordedWork, readSessionPullRequests, reviewDetail, type RecordedRun, type RecordedWork, type ReviewDetail } from "@flow-state-dev/harness-manager/browser";
import { toolInFlight, type PlanRowNow, type ToolCallNow } from "../components/flow-state/working-status";
import { stableList } from "../lib/stable";
import type { Item } from "./items";
import { logFailedRead, POLL_MS, type Unsubscribe } from "./reads";
import type { AppState } from "./state";
import { runSteps, type SessionStep } from "./steps";

/** What a running task's run shows it doing now: the tool call still running, and the plan its harness recorded. */
export interface WorkingNow {
  inFlight?: ToolCallNow;
  /** `undefined` while the run records no plan. */
  plan?: PlanRowNow[];
}

/** A coding run's review: its branch, commits and the judge's verdict. */
export type { ReviewDetail };

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
 * A run's latest review stop, read with harness-manager's browser reader; the
 * latest wins, since a run sent back for changes stops for review again.
 * Exported for its tests.
 */
export function reviewOf(items: readonly Item[]): ReviewDetail | undefined {
  const stop = [...items].reverse().find((item) => item.type === "suspension" && item.kind === "review");
  return stop === undefined ? undefined : (reviewDetail(stop.data) ?? undefined);
}

/** A task's run, read only. */
export interface RunCalls {
  /** A task's run, by the session its row names, read only: the worker that runs it takes no messages. */
  watchRun(runSessionId: string, onChange: (steps: SessionStep[]) => void): Unsubscribe;
  /**
   * The pull requests a run session's record holds (`observed-pull-requests`), with their links:
   * what a task waiting on one links to. Empty when the session keeps none or it can't be read.
   */
  readPullRequests(runSessionId: string): Promise<{ number: number; url: string; title: string | null }[]>;
  /** The run's latest review, read from its stop; `undefined` until it stops for one. */
  watchReview(runSessionId: string, onChange: (review: ReviewDetail | undefined) => void): Unsubscribe;
  /** What a run recorded (its files, plan and pull requests), by the run's session and request: harness-manager's reader. */
  recordedWork(run: RecordedRun): Promise<RecordedWork>;
  /** What a run is doing now, live: read only while a task's feed shows it running. */
  watchWorking(run: { sessionId: string; requestId?: string }, onChange: (now: WorkingNow) => void): Unsubscribe;
}

/** {@link RunCalls} over the app's shared state. */
export function runCalls(state: AppState): RunCalls {
  const { client, watchFeed } = state;
  return {
    watchRun(runSessionId, onChange) {
      return watchFeed(runSessionId, runSteps, stableList(onChange));
    },
    async readPullRequests(runSessionId) {
      try {
        const pullRequests = await readSessionPullRequests(client, runSessionId);
        return pullRequests.map(({ number, url, title }) => ({ number, url, title }));
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
    recordedWork(run) {
      return readRecordedWork(client, run);
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
          : client.live([topic.session(run.sessionId)], {
            read: () => readRecordedWork(client, { sessionId: run.sessionId, requestId }),
            onValue: (work) => {
              const { plan: _, ...rest } = now;
              tell(work.plan === null ? rest : { ...rest, plan: work.plan.rows.map(({ title, status }) => ({ title, status })) });
            },
            ...PLAN_WRITES,
            pollIntervalMs: POLL_MS,
            onError: logFailedRead,
          }).close;
      return () => {
        stopFeed();
        stopCalls();
        stopPlan();
      };
    },
  };
}
