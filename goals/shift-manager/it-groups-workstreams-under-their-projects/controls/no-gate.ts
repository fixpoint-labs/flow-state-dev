/**
 * Control `no-gate`: the room with its membership check removed.
 *
 * Loaded into the served Lab in place of `packages/workforce/src/projects/
 * membership-gate.ts` (`swap-loader.mjs`). Every session's owner counts as a
 * member of every project. The goal must fail at "the outsider is refused".
 */

/** Everyone is a member. */
export function isMember(_row: { members: string[] }, _sessionOwner: string | undefined): boolean {
  return true;
}
