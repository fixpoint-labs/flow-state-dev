/**
 * What a row in a list of sessions says about its session: its
 * label, the state of its latest request, and how long ago it changed.
 *
 * Shared by `FlowNavigator` and any host that draws its own rows over
 * `useSessionList`, so two rails over one read say the same thing.
 */
import type { RequestStatus } from "@flow-state-dev/core/types";
import type { SessionSummary } from "@flow-state-dev/client";

const ENGINE_ID = /^([a-z]+)_\d{13}_([0-9a-f]{6,})$/;

/**
 * What a session row reads: its title, else an engine-minted id shortened to
 * its prefix and its last six characters (`sess_…3df102`), else the id whole.
 * The tail is kept rather than the head because ids minted months apart share
 * their first digits.
 */
export function sessionLabel(session: Pick<SessionSummary, "id" | "title">): string {
  if (session.title != null && session.title.trim() !== "") return session.title;
  const match = ENGINE_ID.exec(session.id);
  return match === null ? session.id : `${match[1]}_…${match[2]!.slice(-6)}`;
}

/** A row's state, by its latest request's status: what the user reads, and whether it needs them. */
export type SessionRowState = {
  readonly status: RequestStatus;
  /** What the user reads: "Running", "Waiting on you", … */
  readonly label: string;
  /** A one-character mark, since the package ships no icon set. */
  readonly mark: string;
  /** The session needs its user: waiting on them, lost to a restart, failed, or cut short. */
  readonly needsYou: boolean;
};

const STATES: Record<RequestStatus, Omit<SessionRowState, "status"> | null> = {
  in_progress: { label: "Running", mark: "●", needsYou: false },
  suspended: { label: "Waiting on you", mark: "◆", needsYou: true },
  interrupted: { label: "Interrupted", mark: "!", needsYou: true },
  failed: { label: "Failed", mark: "✕", needsYou: true },
  incomplete: { label: "Incomplete", mark: "!", needsYou: true },
  // A finished turn and a stop the user made say nothing: the quiet rows.
  completed: null,
  aborted: null
};

const WAITING_ON_WORK: Omit<SessionRowState, "status"> = { label: "Waiting", mark: "◇", needsYou: false };

/**
 * The row's state, or `null` for a session with nothing to say: no request
 * yet, a finished one, one its user stopped, or a listing not asked for
 * status.
 */
export function sessionRowState(
  session: Pick<SessionSummary, "requestStatus" | "requestWaitsForUser">
): SessionRowState | null {
  const status = session.requestStatus;
  if (status == null) return null;
  // A stop on other work (a reply from another worker) resumes by itself.
  // A row that doesn't say reads as waiting on you, the safer miss.
  if (status === "suspended" && session.requestWaitsForUser === false) return { status, ...WAITING_ON_WORK };
  const state = STATES[status];
  return state === null || state === undefined ? null : { status, ...state };
}

/** How long ago `updatedAt` was, short: `now`, `4m`, `3h`, `2d`, `5w`. */
export function sessionAge(updatedAt: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - updatedAt) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d` : `${Math.floor(days / 7)}w`;
}
