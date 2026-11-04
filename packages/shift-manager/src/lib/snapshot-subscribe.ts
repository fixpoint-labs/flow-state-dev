/**
 * What the snapshot hears: the topics its provider subscribes, and which of
 * their notices read the Lab again (FIX-2409).
 *
 * A notice says *that* something changed, never what, so the snapshot hears
 * only what its read covers:
 *
 * | Topic | Acts on |
 * |---|---|
 * | the user's | `resource` in a collection the read covers: the board ledger, private projects, the roster's own and standard workers |
 * | the org's | `resource` in a collection the read covers: the worker inventory, the org's projects |
 * | each listed session but Shift Manager's own | `request` and `run` |
 * | any | `resync` |
 *
 * Never `items`: a reply sends one per stored item, and the snapshot would
 * read per chunk. Never another resource under the user or the org: Usage
 * writes its readings there, and messages between workers land there.
 *
 * Shift Manager's own sessions (each flow's reading session and the usage
 * session) never enter the list: Schedules and Usage run an action on them
 * on every snapshot read, so hearing them would make each read start the
 * next. A run's request writes reach its parent's topic as `run`, so a
 * listed session whose parent is heard is left out; a root is always heard.
 */
import { topic, type SessionSummary, type WireNotice, type WireTopic } from "@flow-state-dev/client";
import { USAGE_SESSION_PREFIX } from "./ids";
import { readerSessionId } from "./reads";

/**
 * The pace the snapshot reads at wherever push can miss a change: no push, the
 * socket down, or a bus that doesn't cross processes. The lapsed retry's
 * ceiling; the snapshot is the Lab's widest read.
 */
export const SNAPSHOT_POLL_MS = 30_000;

/**
 * The storage prefixes of the collections the snapshot reads, per scope: the
 * board ledger (`tasks/**`), projects (`projects/*`), the roster's own
 * (`workforce/workers/*`) and standard (`workforce/standard-workers/*`)
 * workers, and the org's worker inventory (`inventory/workers/*`).
 */
const READ_PREFIXES = {
  user: ["tasks", "projects", "workforce/workers", "workforce/standard-workers"],
  org: ["inventory/workers", "projects"],
} as const;

/** Whether `session` is one Shift Manager opens for itself: a flow's reading session, or the usage session. */
export function isOwnSession(session: Pick<SessionSummary, "id" | "flowKind">, userId: string): boolean {
  return session.id === readerSessionId(userId, session.flowKind) || session.id.startsWith(`${USAGE_SESSION_PREFIX}-`);
}

/**
 * The listed sessions the snapshot subscribes, by id, sorted: every one but
 * Shift Manager's own, less a run whose parent is subscribed, since its
 * request writes reach that parent as `run`. A run's writes reach only its
 * direct parent, so a run whose parent is itself left out is subscribed.
 */
export function heardSessionIds(sessions: readonly SessionSummary[], userId: string): string[] {
  const parentOf = new Map(sessions.filter((session) => !isOwnSession(session, userId)).map((session) => [session.id, session.parentSessionId]));
  const decided = new Map<string, boolean>();
  const subscribed = (id: string, path: ReadonlySet<string>): boolean => {
    const known = decided.get(id);
    if (known !== undefined) return known;
    const parent = parentOf.get(id);
    // No parent, one the snapshot doesn't hear, or a loop in the listing: this one is subscribed.
    const yes = parent == null || !parentOf.has(parent) || path.has(parent) || !subscribed(parent, new Set(path).add(parent));
    decided.set(id, yes);
    return yes;
  };
  return [...parentOf.keys()].filter((id) => subscribed(id, new Set([id]))).sort();
}

/** The topics the snapshot subscribes: the user's, the org's, and each heard session's. */
export function snapshotTopics(sessionIds: readonly string[]): WireTopic[] {
  return [topic.user(), topic.org(), ...sessionIds.map((id) => topic.session(id))];
}

/** Whether a change at storage path `path` is under `root`. */
const under = (path: string, root: string) => path === root || path.startsWith(`${root}/`);

/**
 * Whether `notice` changes what the snapshot shows. A resource notice that
 * names no path (an owner-private row) may be one the read covers, so it is heard.
 */
export function heard(notice: WireNotice): boolean {
  if (notice.kind === "resync") return true;
  if (notice.topic.scope === "session") return notice.kind === "request" || notice.kind === "run";
  if (notice.kind !== "resource") return false;
  const path = notice.topic.resource;
  return path === undefined || READ_PREFIXES[notice.topic.scope].some((root) => under(path, root));
}
