/**
 * Channel boards — the ledger a channel holds, and the one place its identity
 * is minted.
 *
 * A `CHANNEL.md` declares `boards: [work]`: a plain local name, exactly as
 * `members:` is a plain list of names. The ledger's real identity is minted
 * here from the channel's own id — `<channelId>.<name>`, so `eng.feature`'s
 * `work` board is `eng.feature.work` — and no file ever writes it. That is the
 * whole of decision 1, and two things follow from it that the rest of this
 * module exists to keep true:
 *
 * 1. **A caller cannot reach another channel's rows.** The id is minted from
 *    the SESSION's own identity plus a local name, never from the payload, so
 *    naming a board another channel declared resolves this channel's id and
 *    misses (BP-031).
 * 2. **A minted id is unique across a roster** (the binder refuses a collision),
 *    which is what makes it safe to key a process-wide declaration registry on.
 *
 * **One declaration object per minted id, always through {@link channelBoard}.**
 * Two separate `defineTaskCollection` calls sharing an id share rows and NOT
 * policy: the handed-off board's assignee freeze is a `WeakSet` on the
 * declaration object, so a second declaration is a routing key that can still
 * be changed after a row was handed off. The channel's own actions and the
 * seat's board must therefore pass one value, which the memo below guarantees
 * inside one process. Across processes it does not reach, and
 * `define-task-collection.ts` parks that on the resource contract.
 *
 * A board name carries no dot. A dot is how a channel id is joined to a board
 * name, so a name containing one could mint an id belonging to a different
 * channel — `eng` declaring `feature.work` would address `eng.feature`'s
 * `work`. Refused by name rather than deduplicated later.
 */

import { defineCapability } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { buildTaskToolsList, type TaskCollectionResolver } from "@flow-state-dev/orchestration";
import {
  defineTaskCollection,
  getOrCreateTaskCollection,
  hasFrozenLedgerAssignee,
  resolveResourceCollection,
  type DefinedTaskCollection,
  type TaskCollectionRef
} from "@flow-state-dev/orchestration/tasks";

/**
 * The frontmatter key. **Pinned** — an author types it, and it joins the
 * closed list of keys a `CHANNEL.md` may declare.
 */
export const CHANNEL_BOARDS_KEY = "boards";

/**
 * The one canonical declaration of one channel board.
 *
 * A `DefinedTaskCollection` — pass it to `taskBoard({ collection })` and to a
 * flow's `resources` map — carrying its minted `id` so a caller declares one
 * thing rather than repeating a string:
 *
 * ```ts
 * const work = channelBoard("eng.feature", "work");
 * defineFlow({ kind: "coder", resources: { [work.id]: work }, ... });
 * ```
 */
export type ChannelBoardCollection = DefinedTaskCollection & {
  /** The minted ledger id, `<channelId>.<boardName>`. */
  readonly id: string;
};

/**
 * Mint a board's ledger id from its channel's id and its local name.
 *
 * **Pinned**, and the only spelling: a seat types this id to reach the same
 * rows, so the join is public surface. Dot-joined because a channel id already
 * is, and because a collection id may carry no path separator.
 */
export function channelBoardId(channelId: string, boardName: string): string {
  return `${channelId}.${boardName}`;
}

/** The rule, written once, so every door refuses a bad name in the same words. */
const BOARD_NAME_RULE =
  "a board name is a plain local name — not empty, no whitespace, no `.`, `/`, `*`, `[` or " +
  "`]`, and not a JavaScript prototype member. The ledger's id is minted " +
  "`<channelId>.<name>`, so a name carrying a `.` would address another channel's board.";

/** Names that would shadow or corrupt an object the id becomes a key on. */
const UNSAFE_NAMES = new Set(["__proto__", "prototype", "constructor"]);

/**
 * Say why a board name is unusable, or `undefined` when it is fine.
 *
 * Names no subject — the caller supplies what it can name, exactly as the
 * manifest module's refusal wordings do.
 */
export function channelBoardNameProblem(name: unknown): string | undefined {
  if (typeof name !== "string" || name.length === 0) {
    return `is not a name. ${BOARD_NAME_RULE}`;
  }
  if (/[\s./*[\]]/.test(name)) {
    return `is not a usable board name. ${BOARD_NAME_RULE}`;
  }
  if (UNSAFE_NAMES.has(name) || name in Object.prototype) {
    return `collides with a JavaScript object prototype member. ${BOARD_NAME_RULE}`;
  }
  return undefined;
}

/**
 * The process-wide declaration registry — one object per minted id.
 *
 * Keyed by the id rather than by object identity, which is exactly what D1
 * buys: the id is minted from where the channel sits and the binder refuses a
 * collision, so one id means one logical ledger and an id-keyed memo cannot
 * merge two unrelated boards.
 */
const ledgers = new Map<string, ChannelBoardCollection>();

/**
 * The canonical declaration for one already-minted board id.
 *
 * Internal: the binder holds minted ids, and everybody else holds a channel id
 * and a name. Public callers use {@link channelBoard}.
 */
export function channelBoardLedger(id: string): ChannelBoardCollection {
  const existing = ledgers.get(id);
  if (existing !== undefined) return existing;

  // `org` scope, derived and never declared: file-declared documents already
  // install at org scope, and a channel session is opened with an org for that
  // reason. `defineTaskCollection` asserts the id is a usable collection id, so
  // the second half of the name rule is enforced by the layer that owns it.
  const collection = Object.assign(defineTaskCollection({ id, scope: "org" as const }), {
    id
  }) as ChannelBoardCollection;
  ledgers.set(id, collection);
  return collection;
}

/**
 * The seat-side helper: the same ledger a channel holds, from the channel's id
 * and the board's local name.
 *
 * A seat declares one thing rather than a minted string, and it resolves
 * through the same memo the channel's own actions do — so a freeze the seat's
 * board sets is read by the channel's writes.
 *
 * @param channelId  The channel's id, as the tree minted it (`eng.feature`).
 * @param boardName  The local name the `CHANNEL.md` declared.
 * @returns The one declaration for that board. Declare it as a flow resource
 *   under its own `id`, and pass it to `taskBoard({ collection })`.
 * @throws If the board name is not a plain local name.
 */
export function channelBoard(channelId: string, boardName: string): ChannelBoardCollection {
  const problem = channelBoardNameProblem(boardName);
  if (problem !== undefined) {
    throw new Error(`channelBoard("${channelId}", "${String(boardName)}") — the board name ${problem}`);
  }
  return channelBoardLedger(channelBoardId(channelId, boardName));
}

/**
 * Which board names one channel holds, out of a roster's minted ids.
 *
 * A board id is its channel's id and a dot and a name that carries no dot, so
 * the split is exact rather than a guess: `eng.feature.work` belongs to
 * `eng.feature` and never to `eng`.
 */
export function channelBoardNamesFor(
  channelId: string,
  boardIds: readonly string[]
): string[] {
  const prefix = `${channelId}.`;
  return boardIds
    .filter((id) => id.startsWith(prefix) && !id.slice(prefix.length).includes("."))
    .map((id) => id.slice(prefix.length))
    .sort();
}

/**
 * Resolve one channel board's live ledger inside a running block, or
 * `undefined` when the flow this block runs in does not declare it.
 *
 * The frozen-assignee policy is read HERE, at resolution, off the shared
 * declaration — never captured when a board was constructed. That is what makes
 * the channel's writes and the seat's board agree: a boolean captured per call
 * site guards only that call site.
 */
export async function resolveChannelBoard<TInput = unknown, TOutput = unknown>(
  ctx: BlockContext,
  boardId: string
): Promise<TaskCollectionRef<TInput, TOutput> | undefined> {
  const collection = resolveResourceCollection(ctx, boardId);
  if (collection === undefined) return undefined;
  return getOrCreateTaskCollection<TInput, TOutput>({
    ctx,
    backing: "resource",
    collectionId: boardId,
    collection,
    immutableAssignee: hasFrozenLedgerAssignee(channelBoardLedger(boardId))
  });
}

/**
 * The model's door onto a channel board: the eight `taskTools` handlers, over
 * this board's ledger.
 *
 * Composed by the **seat's** kind (`uses: [channelBoardTaskTools(work)]`), not
 * by the channel — a channel has no generator, and D2 keeps execution on the
 * seat's side of the fence. The seat's flow must also declare the board as a
 * resource (`resources: { [work.id]: work }`), which is what this resolver
 * reads.
 *
 * **All eight, or none.** `taskTools` contributes its handlers as capability
 * *controls*, minted per resolver and therefore unnameable: a seat's `tools:`
 * list can neither grant them nor fence them out. Composing this capability IS
 * the declaration, so a seat that holds it holds `assignTask` and `updateTask`
 * alongside `addTask`. Narrowing the set means a different capability, not a
 * shorter `tools:` line.
 *
 * It also cannot be a block colocated in a seat's own folder: a channel board
 * is an org-scoped resource, and a seat-folder block declaring one is refused
 * by name at hire.
 *
 * @param board The declaration {@link channelBoard} handed back.
 * @returns The capability to list in a seat kind's `uses`.
 */
function resolveFor(board: ChannelBoardCollection): TaskCollectionResolver {
  return async (ctx) => resolveChannelBoard(ctx, board.id);
}

export function channelBoardTaskTools(board: ChannelBoardCollection) {
  return defineCapability({
    name: "channelBoardTasks",
    // Declared here, with the tools, rather than left for the consuming flow
    // to remember: a block holding the eight handlers and not the ledger they
    // reach answers every call `no_delegation_board`, which is a working tool
    // surface over nothing. A static `uses` entry's resources reach the flow
    // on their own, so composing this capability installs both halves.
    resources: { [board.id]: board },
    presets: {
      tools: {
        // `controlTools`, not `tools`: these are framework controls, minted per
        // resolver and therefore unnameable, so a seat's `tools:` list has no
        // stable key to fence them out with or to let them back in. Composing
        // the capability IS the declaration — which is why it is all eight or
        // none.
        controlTools: buildTaskToolsList(resolveFor(board))
      },
      default: ["tools"]
    }
  });
}
