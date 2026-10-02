/**
 * The room store: the one module that writes and reads a project's room.
 *
 * A room is `room-lines/<projectId>/<seq>`, one row per line, plus one counter
 * row, `room-seq/<projectId>` (`{ next, committed }`). Posting is three steps:
 *
 *   1. allocate `seq` by advancing `next` under compare-and-swap, retried past
 *      the engine's own budget (`cas-retry.ts`);
 *   2. `create` the line at its key, so no two writers can share one;
 *   3. advance `committed` through every contiguous written line.
 *
 * Readers return only `seq <= committed`. Without that watermark a reader
 * could see line 6 while line 5 is still being written, move its cursor to 6,
 * and never see line 5. A line still missing after a grace period — its writer
 * died between steps 1 and 2 — is filled by the next poster with a tombstone,
 * written with `create`, so exactly one of the line and its tombstone exists.
 * If the late writer then finds its key taken, it allocates again, so its post
 * is not lost.
 *
 * Reads are by key, never by listing: a page is at most `ROOM_PAGE_SIZE` point
 * reads after the cursor, so a read costs one page however long the room is.
 *
 * Nothing here checks membership. Every caller is a talk entry that has run
 * the gate first (`talk.ts`).
 */

import { withOutcome } from "@flow-state-dev/core/helpers";
import type { ResourceCollectionRef, ResourceRef } from "@flow-state-dev/core/types";
import { retryOnConflict } from "./cas-retry";
import { isAlreadyExists } from "./store-errors";
import { roomLineKey, type RoomLine, type RoomSeq } from "./collections";

/** The most lines one read returns: the collection route's own page. */
export const ROOM_PAGE_SIZE = 200;

/**
 * How long a missing line is waited for before the next poster tombstones it.
 * Far longer than a line write takes; it only matters when a writer died.
 */
export const ROOM_LINE_GRACE_MS = 10_000;

/** The two collections a room lives in, as a block's `ctx.resources` holds them. */
export type RoomCollections = {
  lines: ResourceCollectionRef<RoomLine>;
  seq: ResourceCollectionRef<RoomSeq>;
};

/** Tunables, for tests. */
export type RoomStoreOptions = {
  /** Defaults to {@link ROOM_LINE_GRACE_MS}. */
  graceMs?: number;
  /** Defaults to `Date.now`. */
  now?: () => number;
};

/** What a line is made of before it has a `seq`. */
export type RoomLineDraft = Pick<RoomLine, "projectId" | "userId" | "author" | "body">;

async function counterOf(rooms: RoomCollections, projectId: string): Promise<ResourceRef<RoomSeq>> {
  // `getOrCreate` folds a concurrent creator's row in rather than failing, so
  // the first two posters into a new room both get the one counter.
  return rooms.seq.getOrCreate(projectId, { next: 0, committed: 0, stalledSince: null });
}

/**
 * Hand out the room's next sequence number. Exported so a test can stand in
 * for a writer that allocated and has not written yet.
 */
export async function allocateSeq(rooms: RoomCollections, projectId: string): Promise<number> {
  const counter = await counterOf(rooms, projectId);
  const seq = await retryOnConflict(() =>
    // The outcome comes from the invocation that committed: a CAS updater may
    // run more than once.
    withOutcome(
      (mutator: (state: RoomSeq) => RoomSeq) => counter.updateState(mutator),
      (state: RoomSeq) => {
        const next = state.next + 1;
        return { state: { ...state, next }, result: next };
      }
    )
  );
  if (seq === undefined) throw new Error(`room "${projectId}": the counter write committed no sequence number`);
  return seq;
}

/**
 * Write a line at a sequence number already allocated to it.
 *
 * @returns `false` when the key is taken — a tombstone filled it after the
 *   grace period — so the caller allocates again.
 */
export async function writeLineAt(rooms: RoomCollections, line: RoomLineDraft, seq: number): Promise<boolean> {
  try {
    await rooms.lines.create(roomLineKey(line.projectId, seq), { ...line, seq, tombstone: false });
    return true;
  } catch (error) {
    if (isAlreadyExists(error)) return false;
    throw error;
  }
}

/**
 * Move `committed` through every contiguous written line. Stops at the first
 * missing one, unless that line has been missing past the grace period, in
 * which case it is tombstoned and the walk goes on.
 *
 * Safe to run from any poster at any time: lines are never deleted, so a walk
 * that saw a line can only move the watermark forward.
 */
export async function advanceCommitted(
  rooms: RoomCollections,
  projectId: string,
  options: RoomStoreOptions = {}
): Promise<void> {
  const graceMs = options.graceMs ?? ROOM_LINE_GRACE_MS;
  const now = options.now ?? Date.now;
  const counter = await counterOf(rooms, projectId);

  const filled = async (seq: number): Promise<boolean> =>
    (await rooms.lines.getOptional(roomLineKey(projectId, seq))) !== undefined;

  // A tombstone is a `create`, so it either lands or finds the line its writer
  // got in first. Either way the key now holds exactly one of them.
  const tombstone = async (seq: number): Promise<void> => {
    try {
      await rooms.lines.create(roomLineKey(projectId, seq), {
        projectId,
        seq,
        userId: "",
        author: null,
        body: "",
        tombstone: true
      });
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
  };

  await retryOnConflict(() =>
    counter.updateState(async (state: RoomSeq): Promise<RoomSeq> => {
      let committed = state.committed;
      while (committed < state.next) {
        const seq = committed + 1;
        if (await filled(seq)) {
          committed = seq;
          continue;
        }
        // Only the gap the stored clock is about: `stalledSince` was set while
        // `committed` sat exactly here.
        const graceOver =
          committed === state.committed && state.stalledSince !== null && now() - state.stalledSince >= graceMs;
        if (!graceOver) break;
        await tombstone(seq);
        committed = seq;
      }
      const stuck = committed < state.next;
      const stalledSince = !stuck
        ? null
        : committed === state.committed && state.stalledSince !== null
          ? state.stalledSince
          : now();
      return { ...state, committed, stalledSince };
    })
  );
}

/**
 * Post one line: allocate, write, advance. A key taken by a tombstone (this
 * writer was slower than the grace period) is allocated again, so the line
 * still lands.
 *
 * @returns the line as stored.
 */
export async function appendRoomLine(
  rooms: RoomCollections,
  line: RoomLineDraft,
  options: RoomStoreOptions = {}
): Promise<RoomLine> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const seq = await allocateSeq(rooms, line.projectId);
    if (await writeLineAt(rooms, line, seq)) {
      await advanceCommitted(rooms, line.projectId, options);
      return { ...line, seq, tombstone: false };
    }
  }
  throw new Error(`room "${line.projectId}": the line lost its sequence number to a tombstone three times`);
}

/** One page of a room, and where the next read starts. */
export type RoomPage = { lines: RoomLine[]; nextCursor: number };

/**
 * Read the committed lines after `after`, in order, tombstones skipped, at
 * most one page. `nextCursor` is the last sequence number this page covered;
 * pass it as the next `after`.
 */
export async function readRoom(rooms: RoomCollections, projectId: string, after: number): Promise<RoomPage> {
  const counter = await rooms.seq.getOptional(projectId);
  const committed = counter?.state.committed ?? 0;
  const through = Math.min(committed, after + ROOM_PAGE_SIZE);
  if (through <= after) return { lines: [], nextCursor: after };

  const seqs = Array.from({ length: through - after }, (_, i) => after + 1 + i);
  const refs = await Promise.all(seqs.map((seq) => rooms.lines.getOptional(roomLineKey(projectId, seq))));
  const lines = refs
    .map((ref) => ref?.state)
    .filter((line): line is RoomLine => line !== undefined && !line.tombstone)
    .map((line) => ({ ...line }));
  return { lines, nextCursor: through };
}
