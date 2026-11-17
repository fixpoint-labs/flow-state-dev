/**
 * The lab's reads and writes, in the app's words. Every read is a package
 * hook over a kit package's view or a direct read, and every write a package
 * call; nothing here assembles what the server computes, opens a stream or
 * addresses a flow. The screen calls these hooks, and no file in `src/`
 * reaches the server itself (`test/inventory.test.ts`).
 *
 * | Hook or call       | What it is over                                                                  |
 * |--------------------|----------------------------------------------------------------------------------|
 * | `useSessions`      | workforce's worker sessions view (`useView`), per mode's worker, less your dismissals |
 * | `useTasks`         | harness-manager's coding board view, at user scope                               |
 * | `useThread`        | the session's items (react's `useSessionFeed`), and workforce's session turns view |
 * | `useTaskWork`      | a task's run session (`useSessionFeed`), the run request's stream for the call in flight (`useRequestStream`), and harness-manager's recorded work view |
 * | `usePins`, `useDismissed` | your `lab-pins` and `lab-dismissals` user resources (`useResource`), read by scope with no session |
 * | `useLab()`         | the writes, through workforce's client (open a session, send, stop, retry) and orchestration's inbox (answer and act on a task); pin, dismiss, and the picker's reads |
 *
 * `LabProvider` holds the one client the hooks call through (`main.tsx`
 * builds it; a test builds one over the in-process host).
 */
import { createContext, createElement, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Client, ClientFetch, SessionConnectionStatus, ViewValueOf } from "@flow-state-dev/client";
import { useRequestStream, useResource, useSessionFeed, useView } from "@flow-state-dev/react";
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
  sessionTurnsViewRef,
  WORK_PROJECT_STATE_KEY,
  workerSessionsViewRef,
} from "@flow-state-dev/workforce/browser";
import type { CreateProjectOutput } from "@flow-state-dev/workforce";
import type { FileContent } from "@flow-state-dev/core/items";
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
  /** The run working it, or the one that last did: where its work is read, and the flow its session runs on, where its own stream is. */
  runLink?: { sessionId: string; requestId: string; flow?: string };
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
  /** Accept the review task `task` holds you on in session `sessionId`'s board, landing it as `land` says. */
  resolve(sessionId: string, task: LabTask, land?: ReviewLand): Promise<void>;
  /** Ask for changes, in `words`, on the review task `task` holds you on in session `sessionId`'s board. */
  requestChanges(sessionId: string, task: LabTask, words: string): Promise<void>;
  pin(taskId: string): Promise<void>;
  unpin(taskId: string): Promise<void>;
  dismiss(task: Pick<LabTask, "id" | "attempts">): Promise<void>;
}

/** The conversation board's id. */
const TASKS_BOARD = "tasks";
/** How often a live read reads where push can miss a change, in ms. */
const READ_EVERY_MS = 3000;
/** The harness kit's readiness view. */
const READINESS_VIEW = harnessReadinessViewRef("harnesses");
/** The one item type a run request's own stream is read for: the tool call in flight. */
const TOOL_CALLS = { itemTypes: ["tool_output"] };

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
  /** Where each thread open on screen keeps a send's streamed answer, so a send there shows it as it is written. */
  threadFeeds: ThreadFeeds;
}

/** Each open thread's feed's `followResponse`, by session. */
type ThreadFeeds = Map<string, (response: Response) => void>;

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
    const threadFeeds: ThreadFeeds = new Map();
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
  const value = useMemo(() => (read.value === undefined || sessionId === undefined ? undefined : read.value.map((task) => labTaskOf(task, sessionId))), [read.value, sessionId]);
  return { value, stale: read.stale };
}

/** A coding board row in the screen's fields, with its first open hold and its `taskView`. Exported for its test. */
export function labTaskOf(task: CodingBoardTask, sessionId: string): LabTask {
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
      .flatMap((listed) => listed!)
      .map((session): LabSession => {
        const project = session.state[WORK_PROJECT_STATE_KEY];
        return {
          id: session.id,
          title: session.title,
          worker: session.worker,
          updatedAt: session.updatedAt,
          running: session.running,
          waiting: session.waiting.filter((task) => !gone.has(dismissalKey({ id: task.taskId, attempts: task.attempt }))).length,
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
  return useResource(labPins, { client, pollIntervalMs }).value?.pinned;
}

/** The failed attempts you dismissed, as `dismissalKey`s. */
export function useDismissed(): string[] | undefined {
  const { client, pollIntervalMs } = useLabContext();
  return useResource(labDismissals, { client, pollIntervalMs }).value?.dismissed;
}

/** One session's items of `types` on its feed, in the screen's words: `items` once the history landed, its connection and how many runs are unfinished. */
function useFeed(client: Client, sessionId: string | null, types: readonly string[]) {
  const feed = useSessionFeed(sessionId, { client, itemTypes: types });
  return useMemo(
    () =>
      feed === undefined
        ? undefined
        : {
            ...(feed.items === undefined ? {} : { items: feed.items as unknown as Item[], ...(feed.hasEarlier ? { loadEarlier: feed.loadEarlier } : {}) }),
            connection: feed.state as ConnectionState,
            runs: feed.runs === null ? null : feed.runs.length,
            followResponse: feed.followResponse,
          },
    [feed?.items, feed?.hasEarlier, feed?.state, feed?.runs, feed?.loadEarlier, feed?.followResponse],
  );
}

/** What a session's main thread shows: its items on the session feed, its turns from the session turns view. */
export function useThread(sessionId: string, threads: boolean): ThreadView | undefined {
  const { client, pollIntervalMs, stops, threadFeeds } = useLabContext();
  const feed = useFeed(client, sessionId, THREAD_ITEMS);
  const follow = feed?.followResponse;
  useEffect(() => {
    if (follow === undefined) return;
    threadFeeds.set(sessionId, follow);
    return () => {
      if (threadFeeds.get(sessionId) === follow) threadFeeds.delete(sessionId);
    };
  }, [threadFeeds, sessionId, follow]);
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
  const runFlow = task?.runLink?.flow;
  // The run request's own stream sends a call as it starts; a dropped one opens again, resuming where it was.
  const streamed = useRequestStream({ client, flowKind: runFlow, source: { requestId: running ?? "" }, filter: TOOL_CALLS, reconnect: true, enabled: running !== null && runFlow !== undefined }).items as unknown as readonly Item[];
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
export function labCalls(fsd: Client, connection: LabConnection = {}, stops: Stops = new Stops(), threadFeeds: ThreadFeeds = new Map()): LabCalls {
  const workforce = createWorkforceClient(fsd);
  const inbox = createInboxClient(fsd);
  const flowOfSession = async (sessionId: string) => (await fsd.sessions.get(sessionId)).flowKind;
  const boardAt = async (sessionId: string): Promise<BoardActions> => inbox.board({ flowId: await flowOfSession(sessionId), sessionId, board: TASKS_BOARD });
  /** Every project of yours at `scope`, by scope with no session, a page at a time. */
  const everyProject = async (scope: "org" | "user") => {
    const collection = fsd.resource({ scope, pattern: PROJECTS_PATTERN });
    const projects: { id: string; title: string; members: string[]; repository: string | null }[] = [];
    let cursor: string | undefined;
    do {
      const page = await collection.list(cursor === undefined ? {} : { cursor });
      projects.push(...page.items.map((entry) => entry.value as (typeof projects)[number]));
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    return projects;
  };
  /**
   * The open hold task `taskId` holds you on that asks for `asks`, read from the coding board now: the
   * row the screen drew can be older than a question or review stop opened since.
   */
  const holdOn = async (sessionId: string, taskId: string, asks: "question" | "review"): Promise<InboxHold | undefined> => {
    const tasks = (await fsd.view(codingBoardViewRef(), { sessionId })).value;
    return tasks.find((task) => task.id === taskId)?.asks.find((hold) => hold.ask.kind === asks);
  };
  /**
   * Answer the review round the screen drew, and only while the board still holds it: a verdict on a
   * round you never saw would land work nobody read, so a newer round is refused for the screen to draw.
   */
  const answerReview = async (sessionId: string, task: LabTask, answer: InboxAnswer) => {
    const review = await holdOn(sessionId, task.id, "review");
    if (review === undefined) throw new Error(`The thread "${task.id}" isn't waiting on your review.`);
    const drawn = task.asks?.find((hold) => hold.ask.kind === "review");
    if (drawn?.id !== review.id) throw new Error(`The thread "${task.id}" has a newer review; look it over first.`);
    await inbox.answerOne(review, answer);
  };
  const pins = () => fsd.resource(labPins);
  const dismissals = () => fsd.resource(labDismissals);

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
      // The repository the session works in: the project's, written by the server, once, at open.
      const repository = (await everyProject(project.visibility === "shared" ? "org" : "user")).find((entry) => entry.id === project.id)?.repository;
      const created = await workforce.startSession(worker, typeof repository === "string" ? { fields: { [REPOSITORY_FIELD]: repository } } : {});
      await workforce.setWorkProject(worker, project, { sessionId: created.id });
      return { id: created.id, title: NEW_SESSION_TITLE, worker, updatedAt: created.updatedAt, running: false, waiting: 0, projectId };
    },
    send: async (sessionId, text, attachments = []) => {
      const follow = threadFeeds.get(sessionId);
      // With the thread open, stream the send so its answer shows as it is written.
      if (follow === undefined) {
        await workforce.send(sessionId, text, { attachments: [...attachments] });
        return;
      }
      const response = await workforce.send(sessionId, text, { stream: true, attachments: [...attachments] });
      if (response.headers.get("content-type")?.includes("text/event-stream")) follow(response);
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
        stop.ids = new Set(await workforce.stopTurns(sessionId));
      } catch (error) {
        done();
        throw error;
      }
      if (stop.ids.size === 0) done();
      else stops.set(sessionId, stop);
    },
    retry: (sessionId, requestId) => workforce.retryTurn(sessionId, requestId),
    sayInThread: async (sessionId, task, line) => {
      // A line answers the question the thread holds you on; with none open, it is a steer on its task.
      const question = await holdOn(sessionId, task.id, "question");
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
    resolve: (sessionId, task, land) => answerReview(sessionId, task, { value: acceptOf(land) }),
    requestChanges: (sessionId, task, words) => answerReview(sessionId, task, { value: { verdict: "revise", words } }),
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

