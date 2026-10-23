/**
 * The app's two ways of working. A mode is which main worker a session is
 * with and which right pane it shows. A session's mode is never stored: it is
 * read from the session's main worker (spec D1). Session mode is the only one
 * built; threads mode adds a second entry and a status-board pane.
 */

/** A mode the app knows. */
export type ModeId = "session" | "threads";

/** What a mode is: who answers in its sessions, and what the right pane shows. */
export interface Mode {
  id: ModeId;
  label: string;
  /** The main worker every session of this mode is with. */
  worker: string;
  /** The right pane: the background tasks list, or the threads status board. */
  pane: "tasks" | "board";
  /** False until the mode is built; *New session* shows it disabled. */
  available: boolean;
  /** One line for *New session*'s menu. */
  blurb: string;
}

export const MODES: readonly Mode[] = [
  {
    id: "session",
    label: "Session",
    worker: "desk.main",
    pane: "tasks",
    available: true,
    blurb: "The main session works and starts background tasks.",
  },
  {
    id: "threads",
    label: "Threads",
    worker: "desk.lead",
    pane: "board",
    available: false,
    blurb: "The main session hands everything to threads. Coming soon.",
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
