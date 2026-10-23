/**
 * The lab's one way in and out. Every read and write the screen makes goes
 * through `LabAdapter`, and nothing else in `src/` touches a package.
 *
 * The functions are verbs. Until wiring, `createLabAdapter()` returns the
 * fixtures (`fixtures.ts`), which play the five-step script on a timer. At
 * wiring, each verb is bound to the package and the fixtures are deleted:
 *
 * | Verb            | Bound at wiring to                                                        |
 * |-----------------|---------------------------------------------------------------------------|
 * | `watchSessions` | the workforce client's list of a user's sessions of one worker          |
 * | `listProjects`  | the projects the person can read (FIX-2161)                               |
 * | `openSession`   | an ordinary new session on the mode's main worker's flow, on a project    |
 * | `send`          | the worker's door, `respond`, in that session                             |
 * | `interrupt`     | aborting the session's running request                                     |
 * | `watchThread`   | the session's items, live                                                  |
 * | `watchTasks`    | the conversation board's `listTasks` rows                                  |
 * | `watchTaskWork` | the items of a task's run session, read only                               |
 */
import { createFixtureLab } from "./fixtures";
import type { ModeId } from "./modes";

/** Stops a watch. */
export type Unsubscribe = () => void;

/** One row of the sessions list. */
export interface SessionRow {
  id: string;
  title: string;
  /** The session's main worker; its mode is read from it (`modeOfWorker`). */
  worker: string;
  /** When the session last changed, in ms. */
  updatedAt: number;
  /** A turn is running in it now. */
  running: boolean;
  /** The project the session works in (spec D3), or null when it has none and must ask. */
  projectId: string | null;
}

/** A project a session can work in: its checkout is where the session's tasks run. */
export interface ProjectRow {
  id: string;
  name: string;
}

/** One entry in a thread, in the order it happened. */
export type ThreadEntry =
  | { kind: "user"; id: string; text: string; queued?: boolean }
  | { kind: "assistant"; id: string; text: string }
  | { kind: "tool"; id: string; name: string; summary: string }
  | {
      kind: "result";
      id: string;
      taskId: string;
      title: string;
      status: TaskStatus;
      summary: string;
      /** The main session took it while a turn was running (step 4). */
      duringTurn: boolean;
    }
  | { kind: "interrupted"; id: string };

/** What a thread shows now. */
export interface ThreadView {
  entries: ThreadEntry[];
  running: boolean;
  /** When the running turn started, in ms. */
  turnStartedAt?: number;
}

/** A task's status, as the task tools name it. */
export type TaskStatus = "pending" | "in_progress" | "held" | "parked" | "completed" | "errored" | "cancelled";

/** One background task, as a `listTasks` row carries it. */
export interface TaskRow {
  id: string;
  title: string;
  goal: string;
  status: TaskStatus;
  assignee?: string;
  /** The worker's last one-line progress note. */
  statusNote?: string;
}

/** The read-only work of one task. */
export interface TaskWork {
  entries: ThreadEntry[];
}

/** Everything the screen reads and writes. */
export interface LabAdapter {
  watchSessions(onChange: (rows: SessionRow[]) => void): Unsubscribe;
  listProjects(): Promise<ProjectRow[]>;
  openSession(mode: ModeId, projectId: string): Promise<SessionRow>;
  send(sessionId: string, text: string): Promise<void>;
  interrupt(sessionId: string): Promise<void>;
  watchThread(sessionId: string, onChange: (view: ThreadView) => void): Unsubscribe;
  watchTasks(sessionId: string, onChange: (rows: TaskRow[]) => void): Unsubscribe;
  watchTaskWork(sessionId: string, taskId: string, onChange: (work: TaskWork) => void): Unsubscribe;
}

/** The adapter the app runs on. */
export function createLabAdapter(): LabAdapter {
  return createFixtureLab();
}
