/**
 * The lab's one way in and out. Every read and write the screen makes goes
 * through `LabAdapter`, and nothing else in `src/` touches a package.
 *
 * Until wiring, `createLabAdapter()` returns the fixtures (`fixtures.ts`),
 * which play the script on a timer. At wiring, each function is bound to the
 * package call it stands for, by its post-refactor name, and the fixtures are
 * deleted:
 *
 * | Function            | Bound at wiring to                                                      |
 * |---------------------|-------------------------------------------------------------------------|
 * | `listWorkers`       | the workforce client's `roster()`                                       |
 * | `openConversation`  | `ensureWorkerSession({ worker })`: the worker's default conversation    |
 * | `send`              | the worker's `respond` entry in that conversation                       |
 * | `watchConversation` | the session's items, live (`@flow-state-dev/react`)                     |
 * | `watchTalk`         | the user's message log, as `sendMessage` and `receive` write its rows   |
 * | `watchActivity`     | `listSessionRequests` on the worker's conversation                      |
 * | `watchWindow`       | the mark the history window leaves where the turns read word for word begin |
 * | `listProjects`      | the user's projects, as the workforce client lists them                 |
 * | `watchWorkProject`  | the worker's `workProjectId`, on its default conversation (FIX-2161)    |
 * | `setWorkProject`    | FIX-2161's `setWorkProject(worker, project)`                            |
 * | `watchTasks`        | the conversation board's rows (`listTasks_tasks`)                       |
 * | `watchRun`          | the task row's `run` link, followed (`followRequest`, `useSession`)     |
 */
import { createFixtureLab } from "./fixtures";

/** Stops a watch. */
export type Unsubscribe = () => void;

/** One worker on the roster. */
export interface WorkerRow {
  /** The worker's address on the roster, e.g. `teammates.lead`. */
  id: string;
  /** The name a person reads. */
  name: string;
  /** Its `WORKER.md` description: the ongoing role. */
  role: string;
  /** It takes tasks only: it has no conversation, and work reaches it as a task. */
  takesTasks?: boolean;
  /** The coding harness its tasks run through, from its `WORKER.md` `harness` setting. */
  harness?: string;
}

/** One of the user's projects: where a worker's runs get their files. */
export interface ProjectRow {
  id: string;
  name: string;
}

/**
 * A task a conversation filed for a worker that takes tasks, from the board's
 * row. `needs-project` is a run refused `no-project` before any file existed.
 */
export interface BoardTask {
  id: string;
  /** The worker it was filed for. */
  to: string;
  title: string;
  status: "needs-project" | "running" | "done";
  /** The project its run works in; none when it was refused. */
  project?: string;
  /** What the run reported when it ended. */
  result?: string;
}

/** One step of a task's run, as the harness reported it. */
export interface RunStep {
  id: string;
  text: string;
}

/** One entry of a worker's conversation, in the order it happened. */
export type ConversationEntry =
  | { kind: "user"; id: string; text: string; queued?: boolean }
  | { kind: "assistant"; id: string; text: string }
  /** The worker messaged another worker (`sendMessage`). */
  | { kind: "sent"; id: string; messageId: string; to: string; text: string }
  /** A message another worker sent, as the `receive` turn that read it. */
  | { kind: "received"; id: string; messageId: string; from: string; text: string; inReplyTo?: string }
  /** The worker filed a task; the card reads the board's row by its id. */
  | { kind: "task"; id: string; taskId: string }
  /** A task it filed ended, as a line under the name of the worker that ran it. */
  | { kind: "result"; id: string; taskId: string; from: string; text: string };

/** What a conversation shows now. */
export interface ConversationView {
  entries: ConversationEntry[];
  /** The worker is answering in this conversation now. */
  running: boolean;
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
  /** Every message to or from `worker`, oldest first. */
  watchTalk(worker: string, onChange: (rows: TalkRow[]) => void): Unsubscribe;
  watchActivity(worker: string, onChange: (activity: Activity) => void): Unsubscribe;
  /** `undefined` while the whole conversation is inside the window. */
  watchWindow(sessionId: string, onChange: (mark: WindowMark | undefined) => void): Unsubscribe;
  listProjects(): Promise<ProjectRow[]>;
  /** The project `worker`'s runs work in; `undefined` until one is picked. */
  watchWorkProject(worker: string, onChange: (project: string | undefined) => void): Unsubscribe;
  setWorkProject(worker: string, project: string): Promise<void>;
  /** The tasks a conversation filed, oldest first. */
  watchTasks(sessionId: string, onChange: (tasks: BoardTask[]) => void): Unsubscribe;
  /** A task's run, read only: the worker that runs it takes no messages. */
  watchRun(taskId: string, onChange: (steps: RunStep[]) => void): Unsubscribe;
}

/** The adapter the app runs on. */
export function createLabAdapter(): LabAdapter {
  return createFixtureLab();
}
