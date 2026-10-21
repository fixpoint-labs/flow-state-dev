/**
 * The retired-shape map (FIX-2080, epic FIX-2056 D3): the one read of a task
 * row stored in a shape the epic retires.
 *
 * A row in a persistent store is a user's open work, so a shape that stops
 * being written is still read, never dropped (BP-030). Every retired shape is
 * read here, at the collection's read boundary, beside the `parked` and `wait`
 * migrations (`withMigratedStatus`, `withMigratedWait`). No other module reads
 * a retired shape of its own.
 *
 * Six entries, each with its own switch. An entry is turned on in the change
 * that stops writing its shape, by that shape's owner:
 *
 * | Entry | Reads | As | On |
 * |---|---|---|---|
 * | `blocked` | status `blocked` | `held` | FIX-2080 |
 * | `recorded` | the recorded-not-started mark (`undispatched`) | `held` | FIX-2080 |
 * | `post` | a post row (`sealed.kind === "post"`) | a task in the delegate's ongoing session | FIX-2083 |
 * | `parked-split` | a row parked on its pieces (`metadata.splitInto`) | running, `waitingOn: "filed"`, no lease | FIX-2077 |
 * | `reopened` | a reopened row (`reopened`) | pending, unmarked | FIX-2086 |
 * | `parked-for-turn` | a row parked for a person's turn (`parkedForTurn`) | pending, uncharged | FIX-2086 |
 *
 * An entry that is off reads its shape as it is stored, which is what the
 * code that still writes it expects. Removed no earlier than FIX-2071.
 *
 * The map is a **fixed point**: a row it has read is returned unchanged by a
 * second read, and a row in no retired shape is returned as the same object,
 * so the common path allocates nothing.
 */

/** The retired shapes, one entry each. */
export type RetiredShape = "blocked" | "recorded" | "post" | "parked-split" | "reopened" | "parked-for-turn";

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
      const rest = without(row, "error");
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
  // A post row becomes a task routed to the delegate's ongoing session for the
  // conversation. FIX-2083 turns it on, and carries a workstream post's session
  // (a session by id) onto the field it adds for the session a filing resolved.
  post: {
    on: false,
    owner: "FIX-2083",
    read: (row) => {
      if (!isObject(row.sealed) || row.sealed.kind !== "post") return undefined;
      if (row.session === "ongoing") return undefined;
      return { ...row, session: "ongoing" };
    },
  },
  // A split task parked on its pieces stays running (FIX-2077), waiting on
  // them with no lease (`waitingOn: "filed"`), so no reclaim takes it back:
  // the request its last piece's ending wakes checks it, as for any task.
  "parked-split": {
    on: true,
    owner: "FIX-2077",
    read: (row) => {
      if (row.status !== "parked" || !isObject(row.metadata) || row.metadata.splitInto === undefined) return undefined;
      const { splitInto: _split, ...metadata } = row.metadata;
      return { ...without(row, "leaseUntil", "feedback"), status: "in_progress", waitingOn: "filed", metadata };
    },
  },
  // A reopened row is an ordinary pending row (FIX-2086, which adds its steers).
  reopened: {
    on: false,
    owner: "FIX-2086",
    read: (row) => {
      if (row.reopened !== true || row.status !== "pending") return undefined;
      return without(row, "reopened");
    },
  },
  // A row parked for a person's turn goes back to the queue, and its next
  // attempt is not charged against `maxAttempts`: one more turn re-entry.
  "parked-for-turn": {
    on: false,
    owner: "FIX-2086",
    read: (row) => {
      if (row.status !== "parked" || row.parkedForTurn !== true) return undefined;
      const rest = without(row, "parkedForTurn", "leaseUntil", "claimedBy");
      const reentries = typeof row.turnReentries === "number" ? row.turnReentries : 0;
      return { ...rest, status: "pending", turnReentries: reentries + 1 };
    },
  },
};

const ORDER: readonly RetiredShape[] = ["blocked", "recorded", "post", "parked-split", "reopened", "parked-for-turn"];

/**
 * Read one entry, whether or not it is on: what the row reads as once its
 * owner turns the entry on. For the owner's change and for tests; the read
 * boundary calls {@link withRetiredShapes}.
 */
export function readRetiredShape<T>(shape: RetiredShape, row: T): T {
  if (!isObject(row)) return row;
  return (RETIRED_SHAPES[shape].read(row) as T | undefined) ?? row;
}

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
