/**
 * The app's two ways of working. A mode is which main worker a session is
 * with and which right pane it shows. The view a person is in sets the mode:
 * the Sessions view is session mode and the Projects view is threads mode. A
 * session's mode is never stored: it is read from the session's main worker.
 * Threads mode differs only in its main worker, a coordinator, and its right
 * pane, a status board of the threads it files.
 */

/** A mode the app knows. */
export type ModeId = "session" | "threads";

/** What a mode is: who answers in its sessions, and what the right pane shows. */
export interface Mode {
  id: ModeId;
  label: string;
  /** The view that works in this mode, as the left pane's switch names it. */
  view: string;
  /** The main worker every session of this mode is with. */
  worker: string;
  /** The right pane: the background tasks list, or the threads status board. */
  pane: "tasks" | "board";
  /** False while the mode isn't built; the view switch shows its view disabled. */
  available: boolean;
}

export const MODES: readonly Mode[] = [
  {
    id: "session",
    label: "Session",
    view: "Sessions",
    worker: "desk.main",
    pane: "tasks",
    available: true,
  },
  {
    id: "threads",
    label: "Tasks",
    view: "Projects",
    worker: "desk.lead",
    pane: "board",
    available: true,
  },
];

/** The mode whose main worker is `worker`, or undefined for a worker no mode names. */
export function modeOfWorker(worker: string): Mode | undefined {
  return MODES.find((m) => m.worker === worker);
}

/** The mode named `id`. */
export function modeById(id: ModeId): Mode {
  const mode = MODES.find((m) => m.id === id);
  if (!mode) throw new Error(`unknown mode: ${id}`);
  return mode;
}
