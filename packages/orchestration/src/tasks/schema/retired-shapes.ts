/**
 * The retired-shape map (FIX-2080, epic FIX-2056 D3): the one read of a task
 * row stored in a shape the epic retires.
 *
 * A row in a persistent store is a user's open work, so a shape that stops
 * being written is still read, never dropped (BP-030). Every retired shape is
 * read here, at the collection's read boundary, beside the `wait` migration
 * (`withMigratedWait`). No other module reads a retired shape of its own.
 *
 * The `parked` status is not read at all (FIX-2131): stores were reset when it
 * was retired, so no row parked before it is read (the owner's call for epic
 * FIX-2058).
 *
 * Five entries, each with its own switch. An entry is turned on in the change
 * that stops writing its shape, by that shape's owner:
 *
 * | Entry | Reads | As | On |
 * |---|---|---|---|
 * | `blocked` | status `blocked` | `held` | FIX-2080 |
 * | `recorded` | the recorded-not-started mark (`undispatched`) | `held` | FIX-2080 |
 * | `post` | a post row (`sealed.kind === "post"`) | a task in the delegate's ongoing session, its result to the conversation | FIX-2083 |
 * | `reopened` | a reopened row (`reopened`) | unmarked, with one steer pointing at the session's latest line | FIX-2086 |
 * | `queued` | a running row held open for a message queued to its session (`keptOpenBy: "queued"`) | running, `keptOpenBy: "filed"`, no lease | FIX-2103 |
 *
 * An entry that is off reads its shape as it is stored, which is what the
 * code that still writes it expects. Removed no earlier than FIX-2071.
 *
 * The map is a **fixed point**: a row it has read is returned unchanged by a
 * second read, and a row in no retired shape is returned as the same object,
 * so the common path allocates nothing.
 */
import { isTerminalStatus, type TaskStatus } from "./task-status";

/**
 * The steer a row reopened before FIX-2086 reads with: the person's line is
 * already the latest in the task's session, so it points there.
 */
const REOPENED_STEER =
  "The user wrote to you about this task after you had finished it; their message is the latest line in this session. Pick the task up again from there.";

/** The wait a row held open for a queued message stored (`keptOpenBy`), which no write makes now. */
export const QUEUED_WAIT = "queued";

/** The retired shapes, one entry each. */
export type RetiredShape = "blocked" | "recorded" | "post" | "reopened" | "queued";

/** One entry: whether it is read, who turns it on, and how it reads a row. */
export interface RetiredShapeEntry {
  /** Read at the boundary. Off until the shape's owner stops writing it. */
  readonly on: boolean;
  /** The issue that turns it on (and, for an entry off, still writes it). */
  readonly owner: string;
  /** The row read in the current shape, or `undefined` when the row is not in this shape. */
  readonly read: (row: Readonly<Record<string, unknown>>) => Record<string, unknown> | undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The row without `keys`, as a new object. */
function without(row: Readonly<Record<string, unknown>>, ...keys: string[]): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...row };
  for (const key of keys) delete rest[key];
  return rest;
}

/** The entries. Only {@link withRetiredShapes} and the tests read this table. */
export const RETIRED_SHAPES: Readonly<Record<RetiredShape, RetiredShapeEntry>> = {
  // `blocked` and `held` mean the same: filed, not started, until someone says
  // go (D1). The reason `block` stored as `error` moves to `metadata.heldReason`:
  // an `error` on a row that never ended reads as a failure, and `feedback` is
  // handed to the row's worker as what to fix.
  blocked: {
    on: true,
    owner: "FIX-2080",
    read: (row) => {
      if (row.status !== "blocked") return undefined;
      // `heldFromBlocked` marks the row for the one release a started held
      // row may take (FIX-2081): nothing else makes such a row.
      const rest = { ...without(row, "error"), heldFromBlocked: true };
      if (typeof row.error !== "string") return { ...rest, status: "held" };
      const metadata = row.metadata !== null && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : {};
      return { ...rest, status: "held", metadata: { ...metadata, heldReason: row.error } };
    },
  },
  // The recorded-not-started mark (`dispatchTask`'s, FIX-1875) is a held row:
  // it starts when something releases it, and not before.
  recorded: {
    on: true,
    owner: "FIX-2080",
    read: (row) => {
      if (row.undispatched !== true) return undefined;
      const rest = without(row, "undispatched");
      return row.status === "pending" ? { ...rest, status: "held" } : rest;
    },
  },
  // A post row is a routed task: worked in the delegate's ongoing session for
  // the conversation, its result to the conversation. A workstream post's
  // session (a session by id) is the session its filing resolved
  // (`targetSessionId`). Its payload is the routed task's brief as it was.
  post: {
    on: true,
    owner: "FIX-2083",
    read: (row) => {
      if (!isObject(row.sealed) || row.sealed.kind !== "post") return undefined;
      if (row.session === "ongoing") return undefined;
      const session = isObject(row.sealed.session) ? row.sealed.session : undefined;
      const byId = typeof session?.id === "string" ? session.id : undefined;
      return {
        ...row,
        session: "ongoing",
        resultTo: "conversation",
        ...(byId !== undefined && row.targetSessionId === undefined ? { targetSessionId: byId } : {}),
      };
    },
  },
  // A row a person's line reopened before FIX-2086 (FIX-1764): the line is the
  // latest in the task's session. Still open, it reads unmarked with one
  // untaken steer pointing at that line, so the attempt that picks it up (or
  // the request running it) is told, and the task can't settle before it is.
  // Its output is replaced once more, by that attempt, the last time. Finished
  // again, it only loses the mark: a finished task takes no steer.
  reopened: {
    on: true,
    owner: "FIX-2086",
    read: (row) => {
      if (row.reopened !== true) return undefined;
      const rest = without(row, "reopened");
      if (typeof row.status === "string" && isTerminalStatus(row.status as TaskStatus)) return rest;
      const steers = Array.isArray(row.steers) ? row.steers : [];
      const at = typeof row.updatedAt === "number" ? row.updatedAt : 0;
      return { ...rest, steers: [...steers, { id: "reopened", message: REOPENED_STEER, from: "user", at }] };
    },
  },
  // A running row a queued message held open: its work had answered, and the
  // answer is kept as its output. A message no longer holds a task, so it
  // reads as a task whose request answered and that waits on its filed work,
  // with no lease: no lapse runs the answered work again, and the check its
  // session runs next (the upgrade's backfill owes one) settles it with the
  // kept answer once no filed work holds it.
  queued: {
    on: true,
    owner: "FIX-2103",
    read: (row) => (row.keptOpenBy === QUEUED_WAIT ? { ...without(row, "leaseUntil"), keptOpenBy: "filed" } : undefined),
  },
};

const ORDER: readonly RetiredShape[] = ["blocked", "recorded", "post", "reopened", "queued"];

/**
 * A stored row read in the current shapes: every entry that is on, in order.
 * Call it once, at the read boundary, so every consumer downstream (the
 * transition guard, a filter, the claim, a screen) sees one vocabulary. A row
 * in no retired shape is returned as the same object.
 */
export function withRetiredShapes<T>(row: T): T {
  if (!isObject(row)) return row;
  let current: Record<string, unknown> = row;
  for (const shape of ORDER) {
    const entry = RETIRED_SHAPES[shape];
    if (!entry.on) continue;
    const read = entry.read(current);
    if (read !== undefined) current = read;
  }
  return current as T;
}
