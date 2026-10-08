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
 * - `no-such-project`: no row holds the id at that visibility. Another user's
 *   private project is not there to find, so it gets this too.
 * - `private-has-members`: a private create named someone besides its owner.
 * - `private-has-workstreams`: a private create listed workstreams by mailbox
 *   id, which only a shared project holds.
 * - `invalid-workstream-id`: a workstream id is empty or not one path segment.
 * - `no-such-worker`: the lead is not a worker on the caller's roster. Another
 *   user's worker gets this too.
 * - `cannot-lead`: the lead's flow can't lead a workstream.
 * - `lead-differs`: the workstream is open already, with another lead.
 * - `no-such-workstream`: the caller has no such workstream in the project.
 * - `not-a-workstream-session`: the lead's tool ran on a session that leads no workstream.
 * - `project-id-held`: another owner's row holds the id.
 * - `invalid-project-id`: the id is `unassigned`, empty, or not one path segment.
 * - `invalid-repository`: the repository is a path, starts with `-`, or carries a
 *   credential. The refusal never repeats the value.
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
  | "private-has-members"
  | "private-has-workstreams"
  | "invalid-workstream-id"
  | "no-such-worker"
  | "cannot-lead"
  | "lead-differs"
  | "no-such-workstream"
  | "not-a-workstream-session"
  | "project-id-held"
  | "invalid-project-id"
  | "invalid-repository"
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
