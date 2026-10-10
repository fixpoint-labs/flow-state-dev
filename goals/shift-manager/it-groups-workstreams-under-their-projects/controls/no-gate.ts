/**
 * Control `no-gate`: the project writes with their membership check removed.
 *
 * Loaded into the served Lab in place of `packages/workforce/src/projects/
 * membership-gate.ts` (`swap-loader.mjs`). Every session's owner counts as a
 * member of every project, so anyone in the organization opens a workstream
 * in a shared project. The goal must fail at "the outsider's open is refused".
 */

/** Everyone is a member. */
export function isMember(_row: { members: string[] }, _sessionOwner: string | undefined): boolean {
  return true;
}
