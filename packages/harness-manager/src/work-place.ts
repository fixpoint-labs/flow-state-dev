/**
 * Where a coding run's work went, read the same way for both places a run
 * reports it: a board task's output (the manager's `branch`, `commits`,
 * `baseCommit`, `path`) and a worktree's row in the user's list
 * (`worktreesCollection` in `@flow-state-dev/workspace`), which a harness
 * session points at from `state.workspace.worktree`. Both name their fields
 * the same way.
 *
 * Browser-safe: no import at all, so a page calls it on what it already holds.
 * It returns the branch, the commit count and the commands a person copies to
 * reach the work, each shell-quoted, plus what a row says of the worktree:
 * its name, its state, and whose it is when the viewer is not the owner.
 */

/** The commands that take a person to a run's work. */
export interface WorkPlaceCommands {
  /** `git switch <branch>`, run in the repository the branch lives in. */
  readonly switch: string;
  /** `cd <path>` into the run's own checkout; `null` when the source names none. */
  readonly cd: string | null;
  /** `git log <baseCommit>..<branch>`, the run's commits; `null` when no base was recorded. */
  readonly log: string | null;
}

/** Where a run's work went. */
export interface WorkPlace {
  readonly branch: string;
  /** The worktree's descriptive name, when the source is a worktree row. */
  readonly name: string | null;
  /** The run's checkout, or `null` when the source names none. */
  readonly path: string | null;
  /** The commit the branch was cut at, or `null` when none was recorded. */
  readonly baseCommit: string | null;
  /** How many commits the branch has past its base; `null` when unknown, never a guessed zero. */
  readonly commits: number | null;
  /** The row's state (`ready`, `removed`, `lost`, ...), or `null` when the source has none. */
  readonly state: string | null;
  /** The session that owns the worktree, when the viewer is another session attached to it; else `null`. */
  readonly attachedTo: string | null;
  readonly commands: WorkPlaceCommands;
}

/** Who is looking: the viewing session, so a row owned by another session says whose it is. */
export interface WorkPlaceViewer {
  readonly session?: string;
}

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;

/** One shell word: as it is when it is plainly safe, else single-quoted. */
export function shellWord(value: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

/** The owning session, when a row's owner is a session other than the viewer. */
function attachedTo(owner: unknown, viewer: WorkPlaceViewer | undefined): string | null {
  if (viewer?.session === undefined || owner === null || typeof owner !== "object") return null;
  const { kind, id } = owner as Record<string, unknown>;
  return kind === "session" && typeof id === "string" && id !== viewer.session ? id : null;
}

/**
 * Where a run's work went, from a task's output or a worktree row. `null` when
 * the source names no branch: a run with only kept files, a detached HEAD, a
 * session not yet provisioned, or anything else.
 *
 * @example
 *   workPlace(task.output);
 *   workPlace(worktreeRow, { session: sessionId });
 */
export function workPlace(source: unknown, viewer?: WorkPlaceViewer): WorkPlace | null {
  if (source === null || typeof source !== "object") return null;
  const fields = source as Record<string, unknown>;
  const branch = text(fields.branch);
  if (branch === null) return null;
  const path = text(fields.path);
  const baseCommit = text(fields.baseCommit);
  // A task's output says when git couldn't read its count; that count is a fallback zero.
  const commits = fields.commitsVerified === false ? null : count(fields.commits);
  return {
    branch,
    name: text(fields.name),
    path,
    baseCommit,
    commits,
    state: text(fields.state),
    attachedTo: attachedTo(fields.owner, viewer),
    commands: {
      switch: `git switch ${shellWord(branch)}`,
      cd: path === null ? null : `cd ${shellWord(path)}`,
      log: baseCommit === null ? null : `git log ${shellWord(`${baseCommit}..${branch}`)}`,
    },
  };
}
