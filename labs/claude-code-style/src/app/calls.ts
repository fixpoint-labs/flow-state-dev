/**
 * The app's writes, and the project picker's one-off reads, over one client:
 * workforce's client (open a session, send, stop, retry), orchestration's
 * inbox (answer and act on a task), and your marks (pin, dismiss). What
 * `useApp()` hands a screen.
 */
import type { Client, ClientFetch, ViewValueOf } from "@flow-state-dev/client";
import { createInboxClient, type BoardActions, type InboxAnswer, type InboxHold } from "@flow-state-dev/orchestration/inbox";
import { codingBoardViewRef, harnessReadinessViewRef } from "@flow-state-dev/harness-manager/browser";
import { checkRepositoryView, createWorkforceClient, parseProjectRef, projectRef, PROJECTS_PATTERN } from "@flow-state-dev/workforce/browser";
import type { CreateProjectOutput } from "@flow-state-dev/workforce";
import type { FileContent } from "@flow-state-dev/core/items";
import { parseBlobRef } from "@flow-state-dev/core/attachments";
import { modeById, MODES, type ModeId } from "../modes";
import { projectIdOf, refuseExisting } from "../lib/new-project";
import { dismissalKey, taskOfDismissal } from "../lib/columns";
import { acceptOf } from "../lib/review-stop";
import { NEW_SESSION_TITLE } from "../lib/session-title";
import type { HarnessReadinessChipRow } from "../components/flow-state/harness-readiness";
import type { ReviewLand } from "../components/flow-state/review-hold";
import type { AttachmentUploader } from "../components/flow-state/attachments";
import { appDismissals, appPins } from "../../flows/user-marks.mts";
import { REPOSITORY_FIELD } from "../../flows/session-repository.mts";
import type { ThreadFeeds } from "./feed";
import type { AppSession } from "./sessions";
import { Stops } from "./stops";
import type { CodingBoardTask } from "@flow-state-dev/harness-manager/browser";
import type { TaskBoardCalls } from "./tasks";

/** A project a session can work in: the picker's row. */
export interface AppProject {
  id: string;
  name: string;
}

/** One coding harness's readiness, as harness-manager's readiness view answers it. */
export type AppHarness = HarnessReadinessChipRow;

/** Whether a run could check a repository out on this machine, as the projects flow's `checkRepository` view answers. */
export type RepositoryCheck = ViewValueOf<typeof checkRepositoryView>;

/** How the page reaches the server outside the client: where its API is mounted, and the fetch that authenticates. */
export interface AppConnection {
  basePath?: string;
  fetcher?: ClientFetch;
}

/** The app's writes, and the picker's one-off reads. */
export interface AppCalls {
  readonly modes: readonly ModeId[];
  listProjects(): Promise<AppProject[]>;
  createProject(name: string, repository: string): Promise<AppProject>;
  checkRepository(repository: string): Promise<RepositoryCheck>;
  readHarnesses(refresh?: boolean): Promise<AppHarness[]>;
  openSession(mode: ModeId, projectId: string): Promise<AppSession>;
  send(sessionId: string, text: string, attachments?: readonly FileContent[]): Promise<void>;
  upload: AttachmentUploader["upload"];
  readFile(file: FileContent): Promise<Blob>;
  interrupt(sessionId: string): Promise<void>;
  retry(sessionId: string, requestId: string): Promise<void>;
  /** A line in a thread: answers its open question, else steers its task. */
  sayInThread(sessionId: string, task: CodingBoardTask, line: string): Promise<void>;
  taskActions(sessionId: string): TaskBoardCalls;
  /** Accept the review task `task` holds you on in session `sessionId`'s board, landing it as `land` says. */
  resolve(sessionId: string, task: CodingBoardTask, land?: ReviewLand): Promise<void>;
  /** Ask for changes, in `words`, on the review task `task` holds you on in session `sessionId`'s board. */
  requestChanges(sessionId: string, task: CodingBoardTask, words: string): Promise<void>;
  pin(taskId: string): Promise<void>;
  unpin(taskId: string): Promise<void>;
  dismiss(task: Pick<CodingBoardTask, "id" | "attempts">): Promise<void>;
}

/** The conversation board's id. */
const TASKS_BOARD = "tasks";
/** The harness kit's readiness view. */
const READINESS_VIEW = harnessReadinessViewRef("harnesses");

/** A file's bytes through the server's read route, with the page's own fetch, which carries its bearer token. */
function fileReader({ basePath = "", fetcher = (input, init) => fetch(input, init) }: AppConnection) {
  return async (file: FileContent): Promise<Blob> => {
    const id = parseBlobRef(file.data);
    if (id === undefined) throw new Error(`${file.filename ?? "The file"} is not a stored file.`);
    const response = await fetcher(`${basePath.replace(/\/+$/, "")}/api/flows/blobs/${id}`);
    if (!response.ok) throw new Error(`${file.filename ?? "The file"} couldn't be read (${response.status}).`);
    return await response.blob();
  };
}

/**
 * The app's writes over one client: what `useApp()` hands a screen. Exported
 * for the tests that make no screen; a page gets them from `AppProvider`.
 */
export function appCalls(fsd: Client, connection: AppConnection = {}, stops: Stops = new Stops(), threadFeeds: ThreadFeeds = new Map()): AppCalls {
  const workforce = createWorkforceClient(fsd);
  const inbox = createInboxClient(fsd);
  // The instance of its flow that owns the session; its base flow for a session from before instance ownership.
  const flowOfSession = async (sessionId: string) => {
    const session = await fsd.sessions.get(sessionId);
    return session.flowId ?? session.flowKind;
  };
  const boardAt = async (sessionId: string): Promise<BoardActions> => inbox.board({ flowId: await flowOfSession(sessionId), sessionId, board: TASKS_BOARD });
  /** Every project of yours at `scope`, by scope with no session. */
  const everyProject = async (scope: "org" | "user") =>
    (await fsd.resource({ scope, pattern: PROJECTS_PATTERN }).listAll()).map(
      (entry) => entry.value as { id: string; title: string; members: string[]; repository: string | null },
    );
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
  const answerReview = async (sessionId: string, task: CodingBoardTask, answer: InboxAnswer) => {
    const review = await holdOn(sessionId, task.id, "review");
    if (review === undefined) throw new Error(`The thread "${task.id}" isn't waiting on your review.`);
    const drawn = task.asks?.find((hold) => hold.ask.kind === "review");
    if (drawn?.id !== review.id) throw new Error(`The thread "${task.id}" has a newer review; look it over first.`);
    await inbox.answerOne(review, answer);
  };
  const pins = () => fsd.resource(appPins);
  const dismissals = () => fsd.resource(appDismissals);

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
