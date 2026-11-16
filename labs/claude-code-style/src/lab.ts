/**
 * The lab's reads and writes, in the app's words. Every read is a kit
 * package's view or a direct read, and every write a package call; nothing
 * here assembles what the server computes. The screen calls these hooks, and
 * no other file in `src/` reaches the server.
 *
 * | Hook or call       | What it is over                                                                  |
 * |--------------------|----------------------------------------------------------------------------------|
 * | `useSessions`      | workforce's worker sessions view, per mode's worker, less your dismissals        |
 * | `useTasks`         | harness-manager's coding board view, at user scope                               |
 * | `useThread`        | the session's items on the client's `sessionFeed`, and workforce's session turns view |
 * | `useTaskWork`      | a task's run session on `sessionFeed`, the run request's stream for the call in flight, and harness-manager's recorded work view |
 * | `usePins`, `useDismissed` | your `lab-pins` and `lab-dismissals` user resources, read by scope with no session |
 * | `useLab()`         | the writes: open a session, send, stop, retry, answer and act on a task, pin, dismiss, and the picker's reads |
 *
 * `LabProvider` holds the one client the hooks call through (`main.tsx`
 * builds it; a test builds one over the in-process host).
 */
import { createContext, createElement, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { bindStoreToCallbacks, createRequestStreamStore, readEveryCollectionPage, sessionFeed, topic, type Client, type ClientFetch, type SessionConnectionStatus, type SessionFeed, type ViewValueOf } from "@flow-state-dev/client";
import { useView } from "@flow-state-dev/react";
import { createInboxClient, taskView, type BoardActions, type InboxAnswer, type InboxHold, type TaskView } from "@flow-state-dev/orchestration/inbox";
import type { TaskSpendView } from "@flow-state-dev/orchestration/tasks";
import {
  codingBoardViewRef,
  harnessReadinessViewRef,
  recordedWorkViewRef,
  type CodingBoardTask,
  type ReviewDetail,
} from "@flow-state-dev/harness-manager/browser";
import {
  checkRepositoryView,
  createWorkforceClient,
  parseProjectRef,
  projectRef,
  PROJECTS_PATTERN,
  SET_SESSION_FIELDS_ACTION,
  sessionTurnsViewRef,
  WORK_PROJECT_STATE_KEY,
  WORKER_ID_STATE_KEY,
  workerSessionsViewRef,
} from "@flow-state-dev/workforce/browser";
import type { CreateProjectOutput } from "@flow-state-dev/workforce";
import type { FileContent } from "@flow-state-dev/core/items";
import { OBSERVED_PLAN, OBSERVED_PLAN_LIST } from "@flow-state-dev/core/harness";
import { parseBlobRef } from "@flow-state-dev/core/attachments";
import { modeById, MODES, type ModeId } from "./modes";
import { projectIdOf, refuseExisting } from "./lib/new-project";
import { dismissalKey, taskOfDismissal } from "./lib/columns";
import { entriesOf, RETRYABLE_SOURCES, reviewStopIdOf, reviewStopOf, THREAD_ITEMS, withStopped, acceptOf, type Item, type TaskStatus, type ThreadEntry } from "./lib/thread-entries";
import { NEW_SESSION_TITLE } from "./lib/session-title";
import { toolInFlight, type PlanRowNow, type ToolCallNow } from "./components/flow-state/working-status";
import type { HarnessReadinessChipRow } from "./components/flow-state/harness-readiness";
import type { LandedWork, ReviewLand } from "./components/flow-state/review-hold";
import type { AttachmentUploader } from "./components/flow-state/attachments";
import { labDismissals, labPins } from "../flows/user-marks.mts";
import { REPOSITORY_FIELD } from "../flows/session-repository.mts";

export type { ReviewDetail, TaskStatus, ThreadEntry };

/** One row of the sessions list: the worker sessions view's row, with what waits on you less your dismissals. */
export interface LabSession {
  id: string;
  title: string;
  /** The session's main worker; its mode is read from it (`modeOfWorker`). */
  worker: string;
  /** When the session last changed, in ms. */
  updatedAt: number;
  running: boolean;
  /** How many of its tasks wait on you: the view's waiting tasks, less the failures you dismissed. */
  waiting: number;
  /** The project the session was opened from, or null when it has none and must ask. */
  projectId: string | null;
}

/** A project a session can work in: the picker's row. */
export interface LabProject {
  id: string;
  name: string;
}

/** A session feed's connection: `lapsed` once a retry has failed, `stopped` once it gives up. */
export type ConnectionState = SessionConnectionStatus;

/** What a thread shows now. */
export interface ThreadView {
  entries: ThreadEntry[];
  running: boolean;
  connection?: ConnectionState;
  /** When the running turn started, in ms. */
  turnStartedAt?: number;
  /** The running turn's request. */
  requestId?: string;
  /** From a Stop until every turn it aborted has ended. */
  stopping: boolean;
  /** The session's unfinished runs as the session stream names them; `null` until it has. */
  backgroundRunning: number | null;
  /** Present while the thread holds items older than its first entry. */
  loadEarlier?: () => Promise<void>;
}

/**
 * One task as the screen draws it: the coding board view's row, in the
 * screen's optional fields, with the two things the screen computes from
 * it: its first open hold (`openHold`) and orchestration's `taskView`.
 */
export type LabTask = Pick<CodingBoardTask, "id" | "goal"> & {
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
  /** The run working it, or the one that last did: where its work is read. */
  runLink?: { sessionId: string; requestId: string };
};

/** A board's task changes, as the opened task's action row makes them. */
export type TaskBoardCalls = Pick<BoardActions, "cancel" | "steer" | "release" | "retry">;

/** The read-only work of one task. */
export interface TaskWork {
  entries: ThreadEntry[];
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

/** One coding harness's readiness, as harness-manager's readiness view answers it. */
export type LabHarness = HarnessReadinessChipRow;

/** Whether a run could check a repository out on this machine, as the projects flow's `checkRepository` view answers. */
export type RepositoryCheck = ViewValueOf<typeof checkRepositoryView>;

/** How the page reaches the server outside the client: where its API is mounted, and the fetch that authenticates. */
export interface LabConnection {
  basePath?: string;
  fetcher?: ClientFetch;
}

/** The lab's writes, and the picker's one-off reads. */
export interface LabCalls {
  readonly modes: readonly ModeId[];
  listProjects(): Promise<LabProject[]>;
  createProject(name: string, repository: string): Promise<LabProject>;
  checkRepository(repository: string): Promise<RepositoryCheck>;
  readHarnesses(refresh?: boolean): Promise<LabHarness[]>;
  openSession(mode: ModeId, projectId: string): Promise<LabSession>;
  send(sessionId: string, text: string, attachments?: readonly FileContent[]): Promise<void>;
  upload: AttachmentUploader["upload"];
  readFile(file: FileContent): Promise<Blob>;
  interrupt(sessionId: string): Promise<void>;
  retry(sessionId: string, requestId: string): Promise<void>;
  /** A line in a thread: answers its open question, else steers its task. */
  sayInThread(sessionId: string, task: LabTask, line: string): Promise<void>;
  taskActions(sessionId: string): TaskBoardCalls;
  resolve(task: LabTask, land?: ReviewLand): Promise<void>;
  requestChanges(task: LabTask, words: string): Promise<void>;
  pin(taskId: string): Promise<void>;
  unpin(taskId: string): Promise<void>;
  dismiss(task: Pick<LabTask, "id" | "attempts">): Promise<void>;
}

/** The conversation board's id. */
const TASKS_BOARD = "tasks";
/** How often a live read reads where push can miss a change, in ms. */
const READ_EVERY_MS = 3000;
/** How many recent requests a Stop's 409 check reads. */
const RECENT_TURNS = 50;
/** The harness kit's readiness view. */
const READINESS_VIEW = harnessReadinessViewRef("harnesses");
/** A request stream's answers that mean it is not there for this caller. */
const STREAM_GONE: ReadonlySet<number> = new Set([401, 403, 404]);
/** A write to the plan a harness records, as a live read hears it. */
const PLAN_PATHS = [OBSERVED_PLAN, OBSERVED_PLAN_LIST];

const logFailedRead = (error: unknown): void => console.warn("[claude-code-style]", error);

/** Each session's Stop under way: the turns it aborted (`null` while it reads which), until each has ended. */
class Stops {
  private readonly stops = new Map<string, { ids: Set<string> | null }>();
  private readonly listeners = new Set<() => void>();
  private version = 0;
  get(sessionId: string) {
    return this.stops.get(sessionId);
  }
  set(sessionId: string, stop: { ids: Set<string> | null } | undefined) {
    if (stop === undefined) this.stops.delete(sessionId);
    else this.stops.set(sessionId, stop);
    this.version += 1;
    for (const tell of [...this.listeners]) tell();
  }
  subscribe = (tell: () => void) => {
    this.listeners.add(tell);
    return () => this.listeners.delete(tell);
  };
  snapshot = () => this.version;
}

interface LabContextValue {
  client: Client;
  /** How often a read reads where push can miss a change, in ms. */
  pollIntervalMs: number;
  calls: LabCalls;
  stops: Stops;
  /** The feed of each thread open on screen, so a send there streams its answer into it. */
  threadFeeds: Map<string, SessionFeed>;
}

const LabContext = createContext<LabContextValue | null>(null);

function useLabContext(): LabContextValue {
  const value = useContext(LabContext);
  if (value === null) throw new Error("A lab hook ran outside <LabProvider>.");
  return value;
}

/** The lab's client and its calls, for everything under it. Pass a stable client. */
export function LabProvider({
  client,
  connection,
  pollIntervalMs = READ_EVERY_MS,
  children,
}: {
  client: Client;
  connection?: LabConnection;
  /** How often a read reads where push can miss a change, in ms; a host with no push socket (in process) reads on it. */
  pollIntervalMs?: number;
  children?: ReactNode;
}) {
  const value = useMemo(() => {
    const stops = new Stops();
    const threadFeeds = new Map<string, SessionFeed>();
    return { client, pollIntervalMs, stops, threadFeeds, calls: labCalls(client, connection, stops, threadFeeds) };
    // The connection is read once, with the client.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, pollIntervalMs]);
  return createElement(LabContext.Provider, { value }, children);
}

/** The lab's writes and one-off reads. */
export function useLab(): LabCalls {
  return useLabContext().calls;
}

/** A session's tasks, as the coding board view answers them; `stale` while its last read failed. */
export function useTasks(sessionId: string | undefined): { value: LabTask[] | undefined; stale: boolean } {
  const { client, pollIntervalMs } = useLabContext();
  const read = useView(codingBoardViewRef(), { sessionId: sessionId ?? "" }, { client, pollIntervalMs, enabled: sessionId !== undefined });
  const value = useMemo(() => (read.value === undefined || sessionId === undefined ? undefined : read.value.map((row) => labTaskOf(row, sessionId))), [read.value, sessionId]);
  return { value, stale: read.stale };
}

/** A coding board row in the screen's fields, with its first open hold and its `taskView`. Exported for its test. */
export function labTaskOf(row: CodingBoardTask, sessionId: string): LabTask {
  const hold = row.asks[0];
  const startedAt = row.startedAt ?? row.run?.startedAt;
  const run = { ...(typeof row.run?.startedAt === "number" ? { startedAt: row.run.startedAt } : {}), ...(typeof row.leaseUntil === "number" ? { leaseUntil: row.leaseUntil } : {}) };
  return {
    id: row.id,
    title: row.title ?? row.goal,
    goal: row.goal,
    status: row.status as TaskStatus,
    attempts: row.attempts,
    asks: row.asks,
    ...(row.assignee === undefined ? {} : { assignee: row.assignee }),
    ...(row.statusNote == null ? {} : { statusNote: row.statusNote }),
    ...(typeof row.updatedAt === "number" ? { updatedAt: row.updatedAt } : {}),
    ...(typeof startedAt === "number" ? { startedAt } : {}),
    ...(row.spend == null ? {} : { spend: row.spend }),
    ...(hold === undefined ? {} : { openHold: { kind: hold.ask.kind === "confirm" ? "input" : hold.ask.kind, prompt: hold.ask.prompt } }),
    ...(row.harness === null ? {} : { harness: row.harness }),
    ...(row.pullRequests.length === 0 ? {} : { pullRequests: row.pullRequests.map((number) => ({ number, url: null, title: null })) }),
    ...(row.harness !== null && row.status === "completed" ? { review: row.review } : {}),
    ...(row.landed === null ? {} : { landed: row.landed }),
    ...(row.error === null ? {} : { error: row.error }),
    ...(Object.keys(run).length === 0 ? {} : { run }),
    ...(typeof row.run?.sessionId === "string" && typeof row.run?.requestId === "string" ? { runLink: { sessionId: row.run.sessionId, requestId: row.run.requestId } } : {}),
    view: taskView({ ...row, board: sessionId } as Parameters<typeof taskView>[0]),
  };
}

/** A task's pull requests, each with its link from its run's recorded work. */
export function withPullRequestLinks(task: LabTask, work: TaskWork | undefined): LabTask {
  if (task.pullRequests === undefined || work?.pullRequests === undefined) return task;
  return { ...task, pullRequests: task.pullRequests.map((pr) => work.pullRequests!.find((opened) => opened.number === pr.number) ?? pr) };
}

/**
 * A task with its pull requests' links, read from its run's recorded work
 * only while it waits on one: what a card shows without following its run.
 */
export function usePullRequestLinks(task: LabTask): LabTask {
  const { client, pollIntervalMs } = useLabContext();
  const waits = task.pullRequests !== undefined && task.runLink !== undefined;
  const recorded = useView(recordedWorkViewRef(), { requestId: task.runLink?.requestId ?? "" }, { client, pollIntervalMs, sessionId: task.runLink?.sessionId, enabled: waits }).value;
  return useMemo(() => withPullRequestLinks(task, recorded === undefined ? undefined : { entries: [], pullRequests: recorded.pullRequests.rows }), [task, recorded]);
}

/** Your sessions with each mode's worker, newest first, from the worker sessions view. */
export function useSessions(): LabSession[] | undefined {
  const { client, pollIntervalMs } = useLabContext();
  const dismissed = useDismissed();
  // One watch per mode: the modes are the app's fixed config.
  const reads = MODES.map((mode) => useView(workerSessionsViewRef(), { worker: mode.worker }, { client, pollIntervalMs }));
  const values = reads.map((read) => read.value);
  return useMemo(() => {
    if (values.some((value) => value === undefined)) return undefined;
    const gone = new Set(dismissed ?? []);
    return values
      .flatMap((rows) => rows!)
      .map((row): LabSession => {
        const project = row.state[WORK_PROJECT_STATE_KEY];
        return {
          id: row.id,
          title: row.title,
          worker: row.worker,
          updatedAt: row.updatedAt,
          running: row.running,
          waiting: row.waiting.filter((task) => !gone.has(dismissalKey({ id: task.taskId, attempts: task.attempt }))).length,
          projectId: typeof project === "string" ? project : null,
        };
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...values, dismissed]);
}

/** Your pinned task ids. */
export function usePins(): string[] | undefined {
  const { client, pollIntervalMs } = useLabContext();
  return useUserMark(client, pollIntervalMs, labPins.ref, async () => (await client.resource(labPins).state()).pinned);
}

/** The failed attempts you dismissed, as `dismissalKey`s. */
export function useDismissed(): string[] | undefined {
  const { client, pollIntervalMs } = useLabContext();
  return useUserMark(client, pollIntervalMs, labDismissals.ref, async () => (await client.resource(labDismissals).state()).dismissed);
}

/** A user resource of yours, read again on each notice of it on your user topic. */
function useUserMark(client: Client, pollIntervalMs: number, ref: string, read: () => Promise<string[]>): string[] | undefined {
  const [value, setValue] = useState<string[]>();
  useEffect(
    () =>
      client.live([topic.user({ resource: ref })], {
        read,
        onValue: setValue,
        hear: (notice) => notice.topic.resource === ref,
        pollIntervalMs,
        onError: logFailedRead,
      }).close,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, ref, pollIntervalMs],
  );
  return value;
}

/** One session's items of `types` on the session feed, with its connection state and unfinished runs. */
function useFeed(client: Client, sessionId: string | null, types: readonly string[], onFeed?: (feed: SessionFeed | undefined) => void) {
  const [read, setRead] = useState<{ sessionId: string; items?: Item[]; loadEarlier?: () => Promise<void>; connection?: ConnectionState; runs: number | null }>();
  useEffect(() => {
    if (sessionId === null) return;
    const feed = sessionFeed(client, sessionId, { itemTypes: [...types] });
    onFeed?.(feed);
    const loadEarlier = () => feed.loadEarlier();
    const stop = feed.subscribe(({ items, hasEarlier, state, runs }) => {
      // No items until the history lands.
      const landed = !(items.length === 0 && state === "connecting");
      setRead((prev) => ({
        sessionId,
        ...(landed ? { items: items as unknown as Item[], ...(hasEarlier ? { loadEarlier } : {}) } : prev?.sessionId === sessionId ? { items: prev.items, loadEarlier: prev.loadEarlier } : {}),
        connection: state,
        runs: runs === null ? null : runs.length,
      }));
    });
    return () => {
      stop();
      feed.close();
      onFeed?.(undefined);
      setRead(undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, sessionId]);
  return read?.sessionId === sessionId ? read : undefined;
}

/** What a session's main thread shows: its items on the session feed, its turns from the session turns view. */
export function useThread(sessionId: string, threads: boolean): ThreadView | undefined {
  const { client, pollIntervalMs, stops, threadFeeds } = useLabContext();
  const feed = useFeed(client, sessionId, THREAD_ITEMS, (open) => {
    if (open === undefined) threadFeeds.delete(sessionId);
    else threadFeeds.set(sessionId, open);
  });
  const turns = useView(sessionTurnsViewRef(), { sessionId }, { client, pollIntervalMs }).value;
  useSyncExternalStore(stops.subscribe, stops.snapshot);
  // A stopped line stays once its turn leaves the turns read.
  const [stoppedSeen] = useState(() => new Set<string>());
  const entries = useMemo(() => {
    if (feed?.items === undefined || turns === undefined) return undefined;
    for (const turn of turns) if (turn.status === "aborted") stoppedSeen.add(turn.id);
    const retryable = new Set(turns.filter((turn) => RETRYABLE_SOURCES.has(turn.source)).map((turn) => turn.id));
    return withStopped(entriesOf(feed.items, threads, retryable), stoppedSeen);
  }, [feed?.items, turns, threads, stoppedSeen]);
  const stop = stops.get(sessionId);
  const ended = stop?.ids != null && turns !== undefined && [...stop.ids].every((id) => turns.some((turn) => turn.id === id && turn.status !== "in_progress"));
  useEffect(() => {
    if (ended && stops.get(sessionId) === stop) stops.set(sessionId, undefined);
  }, [ended, stop, stops, sessionId]);
  if (entries === undefined || feed === undefined || turns === undefined) return undefined;
  const turn = turns.find((t) => t.status === "in_progress");
  return {
    entries,
    running: turn !== undefined,
    stopping: stop !== undefined && !ended,
    backgroundRunning: feed.runs,
    ...(feed.connection === undefined ? {} : { connection: feed.connection }),
    ...(turn === undefined ? {} : { turnStartedAt: turn.startedAt, requestId: turn.id }),
    ...(feed.loadEarlier === undefined ? {} : { loadEarlier: feed.loadEarlier }),
  };
}

/**
 * A task's work: its run session's items, from the moment the board names
 * that session; while it runs, the tool call in flight (the run request's own
 * stream, which sends a call as it starts) and the plan its harness
 * recorded; and the pull requests its run opened, from the recorded work view.
 */
export function useTaskWork(task: LabTask | undefined): TaskWork | undefined {
  const { client, pollIntervalMs } = useLabContext();
  const runSession = task?.runLink?.sessionId ?? null;
  const running = task?.status === "in_progress" && task.runLink !== undefined ? task.runLink.requestId : null;
  const coding = task?.harness !== undefined && task.runLink !== undefined;
  const feed = useFeed(client, runSession, [...THREAD_ITEMS, "suspension"]);
  const recorded = useView(recordedWorkViewRef(), { requestId: task?.runLink?.requestId ?? "" }, { client, pollIntervalMs, sessionId: runSession ?? undefined, enabled: coding }).value;
  const streamed = useRequestCalls(client, runSession, running);
  return useMemo(() => {
    if (task === undefined) return undefined;
    if (runSession === null) return { entries: [] };
    if (feed?.items === undefined) return undefined;
    const fed = feed.items;
    const review = reviewStopOf(fed);
    const reviewStop = reviewStopIdOf(fed);
    const inFlight = running === null ? undefined : inFlightOf(streamed, fed, running);
    const plan = running === null ? undefined : recorded?.plan?.rows.map(({ title, status }) => ({ title, status }) as PlanRowNow);
    const working: WorkingNow = { ...(inFlight === undefined ? {} : { inFlight }), ...(plan === undefined ? {} : { plan }) };
    return {
      entries: entriesOf(fed.filter((item) => item.type !== "suspension")),
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
 * The tool calls of one running request as its own stream sends them, each
 * as it starts. A dropped connection opens again after a backoff (1 s,
 * doubling to 30 s), resuming after the last event it heard; an answer that
 * says the request is not there for you (401, 403, 404) stops it.
 */
function useRequestCalls(client: Client, runSession: string | null, requestId: string | null): readonly Item[] {
  const [calls, setCalls] = useState<{ requestId: string; items: readonly Item[] }>();
  useEffect(() => {
    if (runSession === null || requestId === null) return;
    const store = createRequestStreamStore();
    let live = true;
    let handle: { close(): void } | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const open = (flowKind: string): void => {
      if (!live) return;
      const heard = store.lastSequenceNumber;
      handle = client.flow(flowKind).request(requestId).stream({
        ...(heard > 0 ? { startingAfter: heard } : {}),
        ...bindStoreToCallbacks(store, {
          itemFilter: (item) => item.type === "tool_output",
          onChange: () => {
            failures = 0;
            store.flushDeltas();
            if (live) setCalls({ requestId, items: store.getSorted() as unknown as Item[] });
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
    client.sessions.get(runSession).then((detail) => open(detail.flowKind), logFailedRead);
    return () => {
      live = false;
      if (retry !== undefined) clearTimeout(retry);
      handle?.close();
    };
  }, [client, runSession, requestId]);
  return calls?.requestId === requestId ? calls.items : [];
}

/**
 * The call a run is in now: the request's own stream, which sends a call as it
 * starts, and the session feed, whose finished copy of a call wins. The feed's
 * own candidates are the run request's only.
 */
function inFlightOf(streamed: readonly Item[], fed: readonly Item[], requestId: string): ToolCallNow | undefined {
  const finished = new Set(fed.filter((item) => item.status !== "in_progress").map((item) => item.id));
  return toolInFlight(streamed.filter((item) => !finished.has(item.id)) as never) ?? toolInFlight(fed.filter((item) => item.requestId === requestId) as never);
}

/** A file's bytes through the server's read route, with the page's own fetch, which carries its bearer token. */
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
 * The lab's writes over one client: what `useLab()` hands a screen. Exported
 * for the tests that make no screen; a page gets them from `LabProvider`.
 */
export function labCalls(fsd: Client, connection: LabConnection = {}, stops: Stops = new Stops(), threadFeeds: Map<string, SessionFeed> = new Map()): LabCalls {
  const workforce = createWorkforceClient(fsd);
  const inbox = createInboxClient(fsd);
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
  const flowOfSession = async (sessionId: string) => (await fsd.sessions.get(sessionId)).flowKind;
  const boardAt = async (sessionId: string): Promise<BoardActions> => inbox.board({ flowId: await flowOfSession(sessionId), sessionId, board: TASKS_BOARD });
  /** Run one action in a session and hand back its output, or throw why it failed. */
  const run = async (flow: string, sessionId: string, action: string, input: unknown): Promise<unknown> => {
    const started = await fsd.flow(flow).send(action, input, { sessionId });
    const { status, error, output } = await started.result();
    if (status !== "completed") throw new Error(error?.message ?? `${action} ended ${status}`);
    if ((output as { ok?: boolean } | undefined)?.ok === false) throw new Error((output as { error?: string }).error);
    return output;
  };
  /** Every project of yours at `scope`, by scope with no session. */
  const everyProject = async (scope: "org" | "user") => {
    const collection = fsd.resource({ scope, pattern: PROJECTS_PATTERN });
    const pages = {
      listCollectionResources: async (_sessionId: string, _ref: string, options: { limit?: number; cursor?: string } = {}) => {
        const page = await collection.list(options);
        return { items: page.items.map((entry) => ({ topic: entry.topic, clientData: entry.value })), ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }) };
      },
    };
    return (await readEveryCollectionPage(pages, scope, PROJECTS_PATTERN)).map((row) => row.clientData as { id: string; title: string; members: string[]; repository: string | null });
  };
  /** A task's open hold that asks for `asks`, from the board row's `asks`. */
  const holdOf = (task: LabTask, asks: "question" | "review") => task.asks?.find((hold) => hold.ask.kind === asks);
  const answerReview = async (task: LabTask, answer: InboxAnswer) => {
    const review = holdOf(task, "review");
    if (review === undefined) throw new Error(`The thread "${task.id}" isn't waiting on your review.`);
    await inbox.answerOne(review, answer);
  };
  const pins = () => fsd.resource(labPins);
  const dismissals = () => fsd.resource(labDismissals);
  const runningTurns = async (sessionId: string) =>
    (await fsd.view(sessionTurnsViewRef(), { sessionId })).value.filter((turn) => turn.status === "in_progress");

  return {
    modes: MODES.map((mode) => mode.id),
    listProjects: async () => {
      const [shared, own] = await Promise.all([everyProject("org"), everyProject("user")]);
      return [
        // A shared project is listed to its members only.
        ...shared.filter((project) => project.members.includes(fsd.userId)).map((project) => ({ ...project, visibility: "shared" as const })),
        ...own.map((project) => ({ ...project, visibility: "private" as const })),
      ].map((project) => ({ id: projectRef(project), name: project.title }));
    },
    createProject: async (name, repository) => {
      const created = await fsd
        .resource({ scope: "user", pattern: PROJECTS_PATTERN })
        .send<CreateProjectOutput>("createProject", { id: projectIdOf(name), title: name, visibility: "private", repository });
      refuseExisting(created, name);
      return { id: projectRef({ visibility: created.visibility, id: created.project.id }), name: created.project.title };
    },
    checkRepository: async (repository) => (await fsd.view(checkRepositoryView, { repository })).value,
    readHarnesses: async (refresh = false) => (await fsd.view(READINESS_VIEW, { refresh })).value,
    openSession: async (mode, projectId) => {
      const { worker } = modeById(mode);
      const project = parseProjectRef(projectId);
      if (project === undefined) throw new Error(`"${projectId}" names no project.`);
      const flow = await flowOf(worker);
      const created = await fsd.flow(flow).createSession({ state: { [WORKER_ID_STATE_KEY]: worker } });
      await workforce.setWorkProject(worker, project, { sessionId: created.id });
      // The repository the session works in: the project's, written by the server, once, at open.
      const repository = (await everyProject(project.visibility === "shared" ? "org" : "user")).find((entry) => entry.id === project.id)?.repository;
      if (typeof repository === "string") await run(flow, created.id, SET_SESSION_FIELDS_ACTION, { worker, fields: { [REPOSITORY_FIELD]: repository } });
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
      const done = () => {
        if (stops.get(sessionId) === stop) stops.set(sessionId, undefined);
      };
      try {
        const turns = await runningTurns(sessionId);
        stop.ids = new Set(turns.map((turn) => turn.id));
        const flow = await flowOfSession(sessionId);
        for (const turn of turns) {
          await fsd
            .flow(flow)
            .request(turn.id)
            .abort()
            .catch(async (error: unknown) => {
              // A 409 is a turn that ended meanwhile, or one an answer resumed first: the record decides.
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
      else stops.set(sessionId, stop);
    },
    retry: async (sessionId, requestId) => {
      await fsd.flow(await flowOfSession(sessionId)).request(requestId).retry();
    },
    sayInThread: async (sessionId, task, line) => {
      // A line answers the question the thread holds you on; with none open, it is a steer on its task.
      const question = holdOf(task, "question");
      if (question !== undefined) {
        await inbox.answerOne(question, { text: line });
        return;
      }
      await (await boardAt(sessionId)).steer(task.id, line);
    },
    // Bound per call, so the session's flow is read when a button is pressed, not when the row draws.
    taskActions: (sessionId) => ({
      cancel: async (id) => (await boardAt(sessionId)).cancel(id),
      steer: async (id, message) => (await boardAt(sessionId)).steer(id, message),
      release: async (id) => (await boardAt(sessionId)).release(id),
      retry: async (id) => (await boardAt(sessionId)).retry(id),
    }),
    resolve: (task, land) => answerReview(task, { value: acceptOf(land) }),
    requestChanges: (task, words) => answerReview(task, { value: { verdict: "revise", words } }),
    pin: async (taskId) => {
      await pins().update((s) => ({ pinned: s.pinned.includes(taskId) ? s.pinned : [...s.pinned, taskId] }));
    },
    unpin: async (taskId) => {
      await pins().update((s) => ({ pinned: s.pinned.filter((id) => id !== taskId) }));
    },
    // One key per task: a newer attempt's dismissal replaces the older one's.
    dismiss: async (task) => {
      const key = dismissalKey(task);
      await dismissals().update((s) => ({ dismissed: [...s.dismissed.filter((k) => taskOfDismissal(k) !== task.id), key] }));
    },
  };
}

