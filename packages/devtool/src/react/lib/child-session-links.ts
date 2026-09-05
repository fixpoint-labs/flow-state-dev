/**
 * Reading a ChildSession's two server-stamped labels, and matching a ChildSession
 * to the board tasks it is doing (FIX-1071).
 *
 * A ChildSession is a session first. It carries a `topic` and a `coordinate`, both
 * display-only, both optional, and neither of them a task reference — a
 * ChildSession started by anything other than a task board has no task at all, and
 * a legacy record has no labels either. Everything here therefore *derives* an
 * association where one is visible and returns nothing where it is not; nothing
 * in the panel is gated on a match existing.
 *
 * ## What the labels contain
 *
 * The dispatch seam (`engine/src/context/create-request-host.ts`,
 * `resolveChildSession`) stamps both labels when it mints a child, from the
 * values it has just used to derive the child's id:
 *
 * - `topic` is the **session key** the child was derived from. For a task
 *   board's hand-off that key is what `taskSessionKeyFor`
 *   (`core/src/types/dispatch.ts`) returns for the seat's session policy:
 *   - `per-task` → `task|framed(boardId)|framed(taskId)`
 *   - `per-worker` → `worker|framed(boardId)|framed(seat)`
 *   - `{ key }` → whatever non-empty string the flow computed, used as returned
 *   where `framed(v)` is `` `${v.length}:${v}` ``.
 * - `coordinate` is `<dispatchType>:<target>` — the entry the child was
 *   dispatched for, e.g. `task:implement`. It names the worker's entry, not a
 *   board or a row, so it is displayed and never used to pair.
 *
 * Both are decoded here rather than rendered raw, because a hashed `dsx_…` id
 * beside `task|10:issue-work|6:task-a` tells a developer nothing.
 *
 * ## What the key says, and what it cannot
 *
 * A preset key names the board and either the row (`per-task`) or the seat
 * (`per-worker`), so the task side has something to compare on each:
 *
 * - **Task** (`per-task`) — comparable. A task carries `id`, and exactly one row
 *   on the child's board has it.
 * - **Seat** (`per-worker`) — comparable. A task carries `assignee`, and the
 *   child is shared by every row the seat runs, so it pairs with all of them.
 * - **Board** — NOT comparable, in either direction of the data. The key carries
 *   `boardId`, but nothing on the task side does: `task-change` and
 *   `task-board-meta` emit `collectionId`, which `taskBoard` documents as a
 *   deliberately different string. Its disagreement is therefore detected
 *   rather than checked — see `linkChildSessionsToTasks`'s second pass.
 *
 * A `{ key }` policy's string is opaque by contract: the flow chose it, and
 * nothing here can say what it names. Such a child decodes to `null` and pairs
 * with nothing — "cannot tell" rather than a guess. The same goes for a child
 * that is not a board's at all (an `internal:` dispatch), for a record stamped
 * before the labels existed, and for a label whose framing does not check out.
 * One consequence is a bound: a custom key that happens to spell the preset
 * grammar is indistinguishable from the preset, and pairs as if it were one.
 *
 * A link is drawn only when the pairing is unambiguous on every part that can
 * be read, and only when no second board is contending for it.
 *
 * That uniqueness is PAGE-LOCAL. The panel reads one page of the ChildSession
 * listing (a budget fixed in `docs/architecture/server-and-client.md`), so
 * "unambiguous" means unambiguous among the rows loaded. Nothing here can see
 * beyond that, and nothing here tries to: the caller knows how much of the
 * index it holds, and the Tasks tab marks both a match and an absence as
 * unverified whenever that is less than all of it. Withholding matches instead
 * would delete the feature on any session large enough to page.
 *
 * ## The bound: this pairing is best-effort, and cannot be made otherwise here
 *
 * Board ownership is not verifiable from what the server sends, so the match is
 * as strong as the data permits and no stronger. Contention between claimants is
 * detected and refused, but a SINGLE claimant is taken as the owner — and a
 * single *wrong* claimant is undetectable: a collection from another board that
 * happens to hold the same task id, or a seat of the same name, is the sole
 * claimant when the child's own board is not in the item stream, and it gets
 * the link.
 *
 * Read a link accordingly: it is a **navigation affordance, not an assertion of
 * provenance**. It says "this is probably the session doing this work, go look",
 * not "this session provably owns this task".
 *
 * That bound is about identity, and it is separate from FRESHNESS. Everything
 * here resolves against whatever snapshot of a task `groupCollections` produced,
 * and that fold keeps the newest change per task (see `task-collection-state`),
 * so a row reassigned between two requests pairs on the seat it has now, not
 * the one it had. An unverifiable board is unverifiable however fresh the row
 * is, but ambiguity reflects a real gap in the data rather than a stale read.
 *
 * Refusing to link without verified attribution is not an option that leaves the
 * feature standing — attribution is not merely absent from the payload, it is
 * inexpressible from it, so that rule would draw no link ever. The fix belongs
 * in the substrate: **FIX-1088** tracks emitting the owning board's id on task
 * events. Once attribution is verifiable the rules here get SIMPLER, and the
 * contention pass is retired rather than extended.
 */
import { readFramed as readFramedField } from "@flow-state-dev/core";
import type { ChildSessionSummary } from "@flow-state-dev/client";
import type { CollectionView, Task } from "./task-collection-state";

/**
 * A ChildSession's `topic` label, decoded as the session key a task board's
 * hand-off writes. Which of the two preset policies produced it, and what it
 * names on that board.
 */
export type ChildSessionKey =
  | {
      policy: "per-task";
      /** The declaring board's stable id. */
      boardId: string;
      /** The one row this child runs. */
      taskId: string;
    }
  | {
      policy: "per-worker";
      /** The declaring board's stable id. */
      boardId: string;
      /** The seat whose every row this child runs — the task's `assignee`. */
      seat: string;
    };

/** A ChildSession's `coordinate` label, split into the entry it was dispatched for. */
export type ChildSessionEntry = {
  /** The dispatch type — `task` for a board's hand-off, `internal` otherwise. */
  type: string;
  /** The entry name on that type's map, e.g. `implement`. */
  target: string;
};

/**
 * Read one length-framed field with the codec `taskSessionKeyFor` writes with
 * (`readFramed` from core), refusing an empty value: every field the writer
 * frames into a task key is `z.string().min(1)` on the envelope, so an empty
 * one was not written by it.
 */
function readFramed(input: string, at: number): { value: string; next: number } | null {
  const field = readFramedField(input, at);
  return field === null || field.value.length === 0 ? null : field;
}

/**
 * Decode a `topic` label as a task board's session key.
 *
 * Accepts exactly the two preset spellings of `taskSessionKeyFor` —
 * `task|framed(boardId)|framed(taskId)` and `worker|framed(boardId)|framed(seat)`
 * — with nothing trailing. `null` for an absent label and for anything else:
 * a `{ key }` policy's string, another dispatcher's key, a label the framing
 * does not fit. Guessing at a half-parsed value would name a board or a row
 * that does not exist.
 */
export function decodeChildSessionKey(
  topic: string | undefined | null
): ChildSessionKey | null {
  // `== null` rather than a truthiness check: a store that nulls absent keys
  // hands back `null`, an older record `undefined`, and both mean unlabelled
  // (BP-030).
  if (topic == null || topic.length === 0) return null;

  const tag = topic.startsWith("task|")
    ? "per-task"
    : topic.startsWith("worker|")
      ? "per-worker"
      : null;
  if (tag === null) return null;

  const board = readFramed(topic, topic.indexOf("|") + 1);
  if (board === null) return null;
  if (topic[board.next] !== "|") return null;

  const second = readFramed(topic, board.next + 1);
  if (second === null || second.next !== topic.length) return null;

  return tag === "per-task"
    ? { policy: "per-task", boardId: board.value, taskId: second.value }
    : { policy: "per-worker", boardId: board.value, seat: second.value };
}

/**
 * Split a `coordinate` label into the dispatch type and entry it names.
 *
 * The seam writes `<type>:<target>`, and a dispatch type never contains `:`,
 * so the first one is the separator; a target may contain any character.
 * `null` for an absent label and for one with no separator — display only,
 * never a pairing input.
 */
export function decodeChildSessionEntry(
  coordinate: string | undefined | null
): ChildSessionEntry | null {
  if (coordinate == null || coordinate.length === 0) return null;
  const separator = coordinate.indexOf(":");
  if (separator <= 0 || separator === coordinate.length - 1) return null;
  return { type: coordinate.slice(0, separator), target: coordinate.slice(separator + 1) };
}

/** A task and the board it was rendered under, so a link can name both. */
export type LinkedTask = {
  /** The board's `collectionId`, as the Tasks panel shows it. */
  collectionId: string;
  task: Task;
};

/**
 * Does this task fit the decoded key?
 *
 * A `per-task` key names one row by id. A `per-worker` key names a seat, and a
 * task sits on it when its `assignee` is that seat — `== null`-guarded, since a
 * store that writes absent keys as `null` hands one back (BP-030). An
 * unassigned row fits no seat: the board routes a row to a seat's dispatcher
 * only once it is assigned there, so the absence is a statement about where
 * the row has not gone, not a gap in what is known.
 */
function fits(key: ChildSessionKey, task: Task): boolean {
  if (key.policy === "per-task") return task.id === key.taskId;
  return task.assignee != null && task.assignee === key.seat;
}

/**
 * Pair the session's ChildSessions with the board tasks they are addressed by.
 *
 * Both directions come out of one pass because both panels need one of them and
 * neither should re-derive the other's.
 */
export function linkChildSessionsToTasks(
  childSessions: readonly ChildSessionSummary[],
  collections: readonly CollectionView[]
): {
  /** ChildSession for a task, keyed `${collectionId}<NUL>${taskId}`. */
  byTask: Map<string, ChildSessionSummary>;
  /** Every task one ChildSession covers, keyed by childSession id. */
  byChildSession: Map<string, LinkedTask[]>;
} {
  // Pass 1 — the parts that CAN be compared: the row (`per-task`) or the seat
  // (`per-worker`) the child's key names, against every task in every
  // collection. A child whose key does not decode contributes nothing.
  const claims: Array<{ collectionId: string; task: Task; childSession: ChildSessionSummary }> = [];
  for (const childSession of childSessions) {
    const key = decodeChildSessionKey(childSession.topic);
    if (key === null) continue;
    for (const collection of collections) {
      for (const entry of collection.tasks) {
        if (!fits(key, entry.task)) continue;
        claims.push({ collectionId: collection.id, task: entry.task, childSession });
      }
    }
  }

  // Pass 2 — the BOARD leg, which cannot be compared and so is detected instead.
  //
  // A ChildSession belongs to exactly one board: its key frames `boardId` in
  // beside the row or the seat. The board id is on the key, but NOTHING on the
  // task side carries one — `task-change` and `task-board-meta` emit
  // `collectionId`, and `taskBoard` documents that as a deliberately different
  // string from `boardId`. So board equality can never be verified the way the
  // row and the seat can.
  //
  // What is observable is CONTENTION, in both directions:
  //
  // - Tasks in more than one collection fit the same ChildSession. At most one
  //   of those boards owns it and nothing on the wire says which, so none of
  //   them gets a link.
  // - More than one ChildSession fits the same task — two boards each holding
  //   a row with this id, or a seat of this name, and only one rendered
  //   collection to hang them on. At most one is running it, so neither is
  //   linked.
  //
  // That is the same rule the readable parts follow (a part that cannot decide
  // is ambiguous, and ambiguity draws nothing), applied to the only part whose
  // disagreement is invisible.
  const boardsClaimedBy = new Map<string, Set<string>>();
  const childrenClaiming = new Map<string, Set<string>>();
  for (const claim of claims) {
    add(boardsClaimedBy, claim.childSession.id, claim.collectionId);
    add(childrenClaiming, taskLinkKey(claim.collectionId, claim.task.id), claim.childSession.id);
  }

  const byTask = new Map<string, ChildSessionSummary>();
  const byChildSession = new Map<string, LinkedTask[]>();
  for (const claim of claims) {
    const key = taskLinkKey(claim.collectionId, claim.task.id);
    if ((boardsClaimedBy.get(claim.childSession.id)?.size ?? 0) > 1) continue;
    if ((childrenClaiming.get(key)?.size ?? 0) > 1) continue;
    byTask.set(key, claim.childSession);
    const linked = byChildSession.get(claim.childSession.id);
    const value: LinkedTask = { collectionId: claim.collectionId, task: claim.task };
    if (linked === undefined) byChildSession.set(claim.childSession.id, [value]);
    else linked.push(value);
  }

  return { byTask, byChildSession };
}

/** Add `value` to the set at `key`, creating the set on first sight. */
function add(index: Map<string, Set<string>>, key: string, value: string): void {
  const bucket = index.get(key);
  if (bucket === undefined) index.set(key, new Set([value]));
  else bucket.add(value);
}

/**
 * The `byTask` key. A NUL join rather than `:` — a `collectionId` and a task id
 * are both free-form, so any printable separator can appear inside one of them.
 *
 * Written as the escape sequence, never, never as a literal NUL byte. Git sniffs the
 * first 8000 bytes of a file for one and renders the whole file as `Bin` if it
 * finds it, so a raw separator here silently costs every reviewer the diff of
 * this file — and does it intermittently, depending on whether the file has
 * grown enough to push the byte past the sniff window.
 */
export function taskLinkKey(collectionId: string, taskId: string): string {
  return `${collectionId}\u0000${taskId}`;
}
