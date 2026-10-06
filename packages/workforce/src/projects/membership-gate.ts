/**
 * The membership gate: may this session's owner read and post this project's
 * room?
 *
 * One function, in a module of its own, so it is the one place the answer is
 * given and the one thing a test swaps to prove the room has no other fence
 * (the `no-gate` control). Every room entry calls it before it reads or writes
 * a line.
 *
 * It reads exactly two things: the row's `members`, and the session's owner as
 * the engine recorded it when the session was created (from the verified
 * principal, never from the request body). It never reads session state or a
 * caller's input. Session state is written by the caller at create, so a
 * `resourceId` in it proves nothing; that is why the gate looks the row up
 * instead (BP-031).
 */

import type { ProjectRow } from "./collections";

/**
 * Whether `sessionOwner` is one of the project's members.
 *
 * @param row The project row, as stored.
 * @param sessionOwner The session's owner from the engine's session record:
 *   `ctx.session.identity.userId`. A session with no owner is never a member.
 */
export function isMember(row: Pick<ProjectRow, "members">, sessionOwner: string | undefined): boolean {
  return sessionOwner !== undefined && sessionOwner.length > 0 && row.members.includes(sessionOwner);
}
