/**
 * The live inventory's three org-scoped collections — what is actually open
 * right now, as opposed to what the tree declares.
 *
 * The declared layer answers "what did somebody write down": a folder of
 * `WORKER.md` and `CHANNEL.md` files, read at boot. It cannot answer "which
 * channels is this seat in", because a block does not walk folders, and it
 * cannot answer "which of these are open", because a file has no idea. These
 * rows are that second answer. The two layers join on one thing, the record's
 * `id`, and nothing else — no mapping table, no second identity.
 *
 * Three collections rather than one, because they answer three questions, and a
 * question that cannot be expressed as a key prefix ends up as a loop over
 * everything:
 *
 *   inventory/seats/<seatId>                which seats exist in this org
 *   inventory/channels/<channelId>          which channels are open, and who is in them
 *   inventory/members/<seatId>/<channelId>  which channels one seat is in
 *
 * The third is the second one indexed the other way round. Its key shape is the
 * whole point: the seat id is a complete path segment ahead of the channel id,
 * so "which channels is this seat in" is answerable from the key rather than
 * from a `members` array inside a channel row's value. That is a statement
 * about what a prefix can reach, NOT about reading less — see
 * {@link membershipPrefix}, which measures it. {@link membershipPrefix} spells
 * that prefix; {@link membershipKey} spells the row.
 *
 * These keys are a public surface. Moving one is a breaking change for any app
 * whose rows are already persisted, because nothing here ever deletes a row.
 */

import { defineResourceCollection } from "@flow-state-dev/core";
import { z } from "zod";

/**
 * One registered seat: the thing a `WORKER.md` declared and `hireWorkforce`
 * turned into a flow copy.
 *
 * Closed on purpose, unlike the skills collection's passthrough schema — that
 * one holds heterogeneous entries (manifests beside plain supporting files) and
 * has to tolerate anything. These rows have one writer and one shape, so an
 * unknown key is a mistake rather than a payload, and Zod's default strip drops
 * it on the way in.
 *
 * `id` and `kind` are required rather than defaulted. A row that lost them is
 * not a thinner row, it is a row that cannot be joined, and a default of `""`
 * would hand a consumer something that looks structurally fine and matches
 * nothing. Required means the framework's read path surfaces such a row as
 * empty instead, which is visible.
 */
export const seatInventoryRowSchema = z.object({
  /** The seat's id — the same id the declared record carries. The join key. */
  id: z.string(),
  /** The flow kind this seat was hired into, e.g. the built-in `"agent"`. */
  kind: z.string(),
});

/** One row of the seat inventory. @see seatInventoryRowSchema */
export type SeatInventoryRow = z.infer<typeof seatInventoryRowSchema>;

/**
 * One open channel: its identity, the kind that minted it, who is in it, and
 * when it opened.
 *
 * `members` is the live set — read from the channel's own session state by the
 * channel itself, never copied from the tree. A member list taken from the
 * declared record would be a file-time answer wearing a live name.
 *
 * `members` and `openedAt` carry defaults so a row written before either
 * existed still reads (BP-030); `openedAt` is nullable with a `null` default
 * per BP-023, so consumers `== null`-guard it rather than parsing `""`.
 */
export const channelInventoryRowSchema = z.object({
  /** The channel's id, `"<teamId>.<name>"` — also its session id. The join key. */
  id: z.string(),
  /** The channel kind that minted it: the built-in `"channel"`, or an app's own. */
  kind: z.string(),
  /** Seat ids currently in the channel, from the channel's own session state. */
  members: z.array(z.string()).default([]),
  /** ISO timestamp of when the channel opened, or `null` on a row that predates the field. */
  openedAt: z.string().nullable().default(null),
});

/** One row of the channel inventory. @see channelInventoryRowSchema */
export type ChannelInventoryRow = z.infer<typeof channelInventoryRowSchema>;

/**
 * One membership, keyed seat-first so a seat's channels are a prefix read.
 *
 * Both fields are already in the key. They are on the row as well so a listed
 * row answers for itself without the caller re-parsing storage keys — the key
 * shape is the index, not the payload.
 */
export const membershipIndexRowSchema = z.object({
  /** The seat in the channel. The first path segment of the row's key. */
  seatId: z.string(),
  /** The channel it is in. The second. */
  channelId: z.string(),
});

/** One row of the membership index. @see membershipIndexRowSchema */
export type MembershipIndexRow = z.infer<typeof membershipIndexRowSchema>;

/**
 * `flowIsolation: false`, spelled out on every collection here rather than
 * omitted.
 *
 * The skills collection deliberately leaves it unset, so an app that isolates
 * its org state wholesale gets an isolated skills catalog too. That is right
 * for a catalog each flow may reasonably want its own copy of. It is wrong
 * here. An inventory read by only the flow that wrote it answers nothing: the
 * point of these rows is that a seat's flow, a channel's flow and an app's own
 * flow all see the same ones.
 *
 * Left undefined, `effectiveStorageTuple` (`packages/core/src/flow/defineFlow.ts`)
 * promotes an org-scoped entry to isolated whenever the declaring flow sets
 * `isolateOrgState`. Every reader but the writer would then read empty, because
 * of an app-level flag set for an unrelated reason, with nothing at this layer
 * saying so. An explicit `false` short-circuits that promotion.
 */
const SHARED_ACROSS_FLOWS = false;

/**
 * The seat inventory — one row per registered seat, at `inventory/seats/*`.
 *
 * Install it under any block's `resources` map. Org-scoped: every flow in the
 * org reads the same rows, and a flow under a different `orgId` reads none.
 *
 * Takes no options. The prefix, the scope and the sharing are the contract
 * other layers join against, not app settings.
 *
 * @example
 *   resources: { seats: defineSeatInventoryCollection() }
 */
export function defineSeatInventoryCollection() {
  return defineResourceCollection({
    pattern: "inventory/seats/*",
    scope: "org",
    flowIsolation: SHARED_ACROSS_FLOWS,
    stateSchema: seatInventoryRowSchema,
  });
}

/**
 * The channel inventory — one row per open channel, at `inventory/channels/*`.
 *
 * Install it under any block's `resources` map. Org-scoped and option-free on
 * the same terms as {@link defineSeatInventoryCollection}.
 *
 * @example
 *   resources: { channels: defineChannelInventoryCollection() }
 */
export function defineChannelInventoryCollection() {
  return defineResourceCollection({
    pattern: "inventory/channels/*",
    scope: "org",
    flowIsolation: SHARED_ACROSS_FLOWS,
    stateSchema: channelInventoryRowSchema,
  });
}

/**
 * The membership index — one row per seat-in-channel, at
 * `inventory/members/<seatId>/<channelId>`.
 *
 * A deep pattern rather than a flat one because the key carries two segments,
 * and the first of them is what a seat's channels are read by. Build keys with
 * {@link membershipKey} and prefixes with {@link membershipPrefix}.
 *
 * @example
 *   resources: { memberships: defineMembershipIndexCollection() }
 */
export function defineMembershipIndexCollection() {
  return defineResourceCollection({
    pattern: "inventory/members/**",
    scope: "org",
    flowIsolation: SHARED_ACROSS_FLOWS,
    stateSchema: membershipIndexRowSchema,
  });
}

/**
 * The membership index key for one seat in one channel, relative to the
 * collection's prefix — what `upsert` and `get` take.
 *
 * @throws when either id is empty, contains a path separator, or is a dot
 * segment. A seat id with a slash in it would file the row under a different
 * seat's prefix and read back as that seat's membership, which no later check
 * would catch: the row is well-formed, just filed under the wrong seat.
 */
export function membershipKey(seatId: string, channelId: string): string {
  return `${idSegment(seatId, "seatId")}/${idSegment(channelId, "channelId")}`;
}

/**
 * The prefix that lists one seat's memberships, relative to the collection's
 * prefix — what `list` takes.
 *
 * The trailing slash is load-bearing. Without it, `"eng.lead"` also matches
 * `"eng.leadership"`, so a seat would read another seat's channels.
 *
 * What this does *not* buy, measured rather than assumed: the narrowing is not
 * pushed into the store. The runtime loads the collection's own prefix and
 * applies this one in memory after — a `list(membershipPrefix("eng.lead"))`
 * issues a single `getByPrefix("inventory/members/")`. So this is not the
 * cheaper way to answer the question today.
 *
 * What the key shape buys is a read that CAN get narrower later. A `members`
 * array lives inside a channel row's value, where no prefix reaches it now or
 * after any storage change; a seat id in the key is something a store could
 * push down. Do not restate this as the index moving less data — whether it
 * does depends on how many members a channel has, and on a realistic roster it
 * moves more.
 *
 * @throws on the same ids {@link membershipKey} refuses.
 */
export function membershipPrefix(seatId: string): string {
  return `${idSegment(seatId, "seatId")}/`;
}

/** Reject an id that cannot be one whole path segment. */
function idSegment(value: string, label: string): string {
  if (value.length === 0) {
    throw new Error(`Inventory ${label} must not be empty`);
  }
  if (value.includes("/") || value.includes("\\")) {
    throw new Error(
      `Inventory ${label} "${value}" must not contain a path separator — it is one whole ` +
        `segment of the membership key, and a separator would file the row under another seat`,
    );
  }
  if (value === "." || value === "..") {
    throw new Error(`Inventory ${label} must not be "${value}"`);
  }
  return value;
}
