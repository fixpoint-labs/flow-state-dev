/**
 * The refusals a project or workstream write gives, as one error type with a
 * `reason` a caller can branch on without matching message text — the same
 * shape Workforce's other refusals use.
 */

/**
 * Why a project or workstream write was refused. Each leaves the row and the
 * entries as they were.
 *
 * - `not-a-member`: the session's owner is not in the row's `members`.
 * - `no-such-project`: no row holds the id at that visibility. Another user's
 *   private project is not there to find, so it gets this too.
 * - `private-has-members`: a private create named someone besides its owner.
 * - `invalid-workstream-id`: a workstream id is empty or not one path segment.
 * - `no-such-worker`: the lead is not a worker on the caller's roster. Another
 *   user's worker gets this too.
 * - `cannot-lead`: the lead's flow can't lead a workstream.
 * - `lead-doesnt-fit`: the fit check answered that none fits a worker's pick
 *   of lead: its own description says it does a different sort of work.
 * - `lead-differs`: the workstream is open already, with another lead.
 * - `no-such-workstream`: the caller has no such workstream in the project.
 * - `not-a-workstream-session`: the lead's tool ran on a session that leads no workstream.
 * - `project-id-held`: another owner's row holds the id.
 * - `invalid-project-id`: the id is `unassigned`, empty, or not one path segment.
 * - `invalid-repository`: the repository is a path, starts with `-`, or carries a
 *   credential. The refusal never repeats the value.
 * - `too-many-workstreams`: the owner has as many open workstreams in the project
 *   as their project coordinator holds delegates.
 * - `other-project`: an open from a conversation linked to one project
 *   named another.
 * - `invalid-mcp-server`: an MCP server is not a bare name (lowercase
 *   letters, digits and hyphens). The refusal never repeats the value.
 * - `unknown-mcp-server`: the server doesn't offer an MCP server of that name.
 */
export type ProjectRefusalReason =
  | "not-a-member"
  | "no-such-project"
  | "private-has-members"
  | "invalid-workstream-id"
  | "no-such-worker"
  | "cannot-lead"
  | "lead-doesnt-fit"
  | "lead-differs"
  | "no-such-workstream"
  | "not-a-workstream-session"
  | "project-id-held"
  | "invalid-project-id"
  | "invalid-repository"
  | "too-many-workstreams"
  | "other-project"
  | "invalid-mcp-server"
  | "unknown-mcp-server"
  | "invalid-check";

/** A project or workstream write refused on the project's own terms. */
export class ProjectRefusedError extends Error {
  readonly reason: ProjectRefusalReason;

  constructor(reason: ProjectRefusalReason, detail: string) {
    super(`${reason}: ${detail}`);
    this.name = "ProjectRefusedError";
    this.reason = reason;
  }
}
