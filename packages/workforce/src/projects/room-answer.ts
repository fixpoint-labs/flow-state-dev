/**
 * A seat's answer into a project's room, crash-safe and once per post and seat.
 *
 * The answer's claim is the durable record of its progress, not a lock. It is
 * created first, at `room-answers/<projectId>/<postId>/<author>`, holding the
 * sequence number allocated for the line and the line itself. Every step after
 * it is idempotent, so whichever run finds the claim finishes the job:
 *
 * 1. write the line at the claimed seq (`create`, so a second write finds it);
 * 2. advance the room's watermark (safe from any run, at any time).
 *
 * A run that dies anywhere after the claim leaves it for the next delivery of
 * the same answer to finish, and nothing ever deletes a claim, so a failure
 * can neither lose the answer nor let a retry write it twice. A seq allocated
 * and never written, by a run that died before its claim, is the gap the room
 * store's stall clock already tombstones after its grace period.
 */

import type { ResourceCollectionRef, ResourceRef } from "@flow-state-dev/core/types";
import { withOutcome } from "@flow-state-dev/core/helpers";
import { retryOnConflict } from "./cas-retry";
import { roomLineKey, type RoomAnswer, type RoomLine } from "./collections";
import { advanceCommitted, allocateSeq, writeLineAt, type RoomCollections, type RoomStoreOptions } from "./room-store";
import { isAlreadyExists } from "./store-errors";

/** One seat's answer to one post, before it has a seq. */
export type AnswerDraft = Omit<RoomAnswer, "seq">;

/** The claim's key: one per room, post and seat. */
export function answerKey(answer: Pick<RoomAnswer, "projectId" | "postId" | "author">): string {
  return `${answer.projectId}/${answer.postId}/${answer.author}`;
}

/**
 * The claim for `draft`: the existing one, or a new one holding a freshly
 * allocated seq. Of two runs creating it at once, one claim lands and both go
 * on with it; the loser's seq is a gap the stall clock tombstones.
 */
export async function claimAnswer(
  rooms: RoomCollections,
  claims: ResourceCollectionRef<RoomAnswer>,
  draft: AnswerDraft,
  options: RoomStoreOptions = {}
): Promise<ResourceRef<RoomAnswer>> {
  const key = answerKey(draft);
  const existing = await claims.getOptional(key);
  if (existing !== undefined) return existing;
  const seq = await allocateSeq(rooms, draft.projectId, options);
  try {
    return await claims.create(key, { ...draft, seq });
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
    return claims.get(key);
  }
}

/**
 * Land a seat's answer in the room, or finish one an earlier run claimed.
 *
 * The line written is the claim's, not `draft`'s: the first run to claim an
 * answer fixes its words. A tombstone at the claimed seq (the run was slower
 * than the grace period) moves the claim to a new seq, recorded before the
 * write, as a fresh post would allocate again.
 *
 * @returns the line, when this run wrote it; `null` when an earlier run had.
 */
export async function answerInRoom(
  rooms: RoomCollections,
  claims: ResourceCollectionRef<RoomAnswer>,
  draft: AnswerDraft,
  options: RoomStoreOptions = {}
): Promise<RoomLine | null> {
  const claim = await claimAnswer(rooms, claims, draft, options);
  const { projectId, userId, author, body } = claim.state;
  const line = { projectId, userId, author, body };
  let seq = claim.state.seq;
  let wrote = false;
  let landed = false;
  for (let attempt = 0; attempt < 3 && !landed; attempt += 1) {
    if (await writeLineAt(rooms, line, seq)) {
      wrote = true;
      landed = true;
      break;
    }
    // Only this answer's runs write at its claimed seq, so a line there that
    // is not a tombstone is this answer, landed by an earlier run.
    const at = await rooms.lines.getOptional(roomLineKey(projectId, seq));
    if (at !== undefined && !at.state.tombstone) {
      landed = true;
      break;
    }
    seq = await moveClaim(claim, seq, await allocateSeq(rooms, projectId, options));
  }
  if (!landed) throw new Error(`room "${projectId}": an answer lost its sequence number to a tombstone three times`);
  await advanceCommitted(rooms, projectId, options);
  return wrote ? { ...line, seq, tombstone: false } : null;
}

/** Move a claim off a tombstoned seq. Keeps a move another run already made, so the claim names one seq. */
async function moveClaim(claim: ResourceRef<RoomAnswer>, from: number, to: number): Promise<number> {
  const seq = await retryOnConflict(() =>
    withOutcome(
      (mutator: (state: RoomAnswer) => RoomAnswer) => claim.updateState(mutator),
      (state: RoomAnswer) =>
        state.seq === from ? { state: { ...state, seq: to }, result: to } : { state, result: state.seq }
    )
  );
  if (seq === undefined) throw new Error(`answer "${answerKey(claim.state)}": the claim move committed no seq`);
  return seq;
}
