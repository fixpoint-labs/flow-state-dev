/**
 * The refusals a project write or a room entry gives, as one error type with a
 * `reason` a caller can branch on without matching message text — the same
 * shape the mailbox's own refusals use.
 */

/**
 * Why a project write or a room entry was refused. Each leaves the row, the
 * claims and the room as they were.
 *
 * - `not-a-member`: the session's owner is not in the row's `members`.
 * - `no-such-project`: no row holds the id.
 * - `project-id-held`: another owner's row holds the id.
 * - `invalid-project-id`: the id is `unassigned`, empty, or not one path segment.
 * - `unknown-workstream`: a workstream id is not a mailbox in the inventory.
 * - `workstream-claimed`: another project holds the workstream.
 * - `talk-not-bound`: a room entry ran on a session bound to no project.
 * - `talk-bound-elsewhere`: the session is already bound to another project.
 * - `talk-on-a-mailbox`: the session is a declared mailbox's; a project is joined from a session of its own.
 * - `author-on-a-person-post`: a person's line named an `author`; seats answer through `answer`.
 */
export type ProjectRefusalReason =
  | "not-a-member"
  | "no-such-project"
  | "project-id-held"
  | "invalid-project-id"
  | "unknown-workstream"
  | "workstream-claimed"
  | "talk-not-bound"
  | "talk-bound-elsewhere"
  | "talk-on-a-mailbox"
  | "author-on-a-person-post"
  | "answer-not-delivered"
  | "answer-not-yours"
  | "talk-session-not-listed";

/** A project write or room entry refused on the project's own terms. */
export class ProjectRefusedError extends Error {
  readonly reason: ProjectRefusalReason;

  constructor(reason: ProjectRefusalReason, detail: string) {
    super(`${reason}: ${detail}`);
    this.name = "ProjectRefusedError";
    this.reason = reason;
  }
}
