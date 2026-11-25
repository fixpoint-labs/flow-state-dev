/**
 * The review stop's data, read for a browser card.
 *
 * With `reviewChanges` on, a run that made commits stops with
 * `suspendForUser({ kind: "review" })`, and the stop's `data` holds its
 * branch, commit count, commit subjects, the judge's verdict, the checks
 * the phase ran (`commandCheck`), and the ways an accept can land the work
 * (with the last landing that failed). Beside them, what a person decides
 * on: the task's goal, the run's own summary, the task's pull requests (and
 * the one open from the branch, which an accept lands on), this
 * round's commits and the files the run changed. This reads
 * that data as {@link ReviewDetail}, the shape the registry's `review-hold`
 * card takes as plain props, so an app never spells this package's field
 * names itself. Browser-safe: it imports nothing.
 */

/** A coding run's review: what it committed, and what the judge said. `null` where the record had nothing readable. */
export interface ReviewDetail {
  /** The run's branch. */
  branch: string | null;
  /** How many commits it made over its base; `null` when git couldn't count them. */
  commits: number | null;
  /** Its commit subjects, newest first. */
  subjects: string[];
  /** The judge's verdict on the run, or `null` when no judge read it. */
  judge: { verdict: string; confidence: number; reason: string } | null;
  /**
   * The ways an accept can land the run's work on this host:
   * `pull-request` and `merge`, sent as the accept's `land`. Empty when the
   * host can't land, and then a plain accept is the only one. The reader always
   * sets it; optional so a review built by hand (a test double) needn't.
   */
  lands?: ReviewLand[];
  /** The last landing that failed, when the review is asked again for a retry; `null` otherwise. */
  landFailed?: { land: ReviewLand; message: string } | null;
  /**
   * Every try of the last landing, oldest first: the person's, and each one
   * after a step of the coding session fixing what stopped it. Empty when
   * none failed. Optional, as `lands` is.
   */
  landAttempts?: Array<{ land: ReviewLand; message: string }>;
  /**
   * The checks the phase ran before stopping for review (`commandCheck`), in
   * order: each command, how it ended and the end of its output. `null` when
   * none ran.
   */
  checks: ReviewCheck[] | null;
  // FIX-2782.
  /**
   * What was asked: the task's goal. The reader always sets this and the
   * fields below; optional so a review built by hand (a test double) needn't.
   */
  goal?: string | null;
  /** The run's own summary of what it did and why: its final message. */
  answer?: string | null;
  /** The task's pull requests, oldest first: where a person looks at the work. */
  pullRequests?: ReviewPullRequest[];
  // FIX-2920.
  /**
   * The pull request already open from the run's branch, which a
   * `pull-request` accept puts the work on rather than opening a second one.
   * `null` when none is open, or GitHub couldn't say. Optional, as `lands` is.
   */
  openPullRequest?: ReviewPullRequest | null;
  /**
   * The pull request the run's work is already on, as GitHub had it when the
   * review was asked: the one open from the branch, else the task's newest
   * recorded one, whatever its state. A card offers no second pull request
   * beside it. `null` when there is none. Optional, as `lands` is.
   */
  pullRequest?: ReviewWorkPullRequest | null;
  /**
   * This round's commits, when the branch had commits before it: how many
   * and their subjects, newest first. `null` when the round is the whole
   * branch, or they couldn't be read.
   */
  round?: { commits: number; subjects: string[] } | null;
  /** Each file the run changed and its lines; `null` when they couldn't be read. */
  files?: ReviewFile[] | null;
  /** How many files changed, listed or not; `null` when unread. */
  fileCount?: number | null;
  /** Lines added across every file; `null` when unread. */
  added?: number | null;
  /** Lines removed across every file; `null` when unread. */
  removed?: number | null;
}

/** A pull request the task's work is on. */
export interface ReviewPullRequest {
  number: number;
  url: string;
}

/** The pull request a run's work is already on, and what it lacks. */
export interface ReviewWorkPullRequest extends ReviewPullRequest {
  /** `open`, `merged` or `closed`; `null` when GitHub couldn't be asked. */
  state: "open" | "merged" | "closed" | null;
  /** How many of the branch's commits it lacks; `null` when that couldn't be told. */
  unpushed: number | null;
}

/** One file the run changed. `added`/`removed` are `null` for a binary file. */
export interface ReviewFile {
  path: string;
  added: number | null;
  removed: number | null;
}

/** One check the phase ran: the shape of `commandCheck`'s result, spelled here so this file imports nothing. */
export interface ReviewCheck {
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  skipped: boolean;
  durationMs: number;
  tail: string;
}

/** A way an accept lands a run's work: push and open a pull request, or merge into the person's checkout. */
export type ReviewLand = "pull-request" | "merge";

const isLand = (value: unknown): value is ReviewLand => value === "pull-request" || value === "merge";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** One landing's try, or `null` when the value isn't one. */
function landAttemptOf(value: unknown): { land: ReviewLand; message: string } | null {
  return isRecord(value) && isLand(value.land) && typeof value.message === "string" ? { land: value.land, message: value.message } : null;
}

/** The judge's verdict, or `null` when it isn't one. */
function judgeOf(value: unknown): ReviewDetail["judge"] {
  if (!isRecord(value)) return null;
  const { verdict, confidence, reason } = value;
  if (typeof verdict !== "string" || typeof confidence !== "number") return null;
  return { verdict, confidence, reason: typeof reason === "string" ? reason : "" };
}

/** One check, or `null` when the entry isn't one. */
function checkOf(value: unknown): ReviewCheck | null {
  if (!isRecord(value)) return null;
  const { command, exitCode, timedOut, skipped, durationMs, tail } = value;
  if (typeof command !== "string" || (exitCode !== null && typeof exitCode !== "number")) return null;
  if (typeof timedOut !== "boolean" || typeof skipped !== "boolean") return null;
  return { command, exitCode, timedOut, skipped, durationMs: typeof durationMs === "number" ? durationMs : 0, tail: typeof tail === "string" ? tail : "" };
}

/** The checks, or `null` when none ran (absent, not a list, or nothing readable in it). */
function checksOf(value: unknown): ReviewDetail["checks"] {
  if (!Array.isArray(value)) return null;
  const checks = value.map(checkOf).filter((c): c is ReviewCheck => c !== null);
  return checks.length > 0 ? checks : null;
}

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

/** A line count, or a binary file's `null`; `undefined` when the value is neither. */
const lineCountOf = (value: unknown): number | null | undefined => (value === null ? null : isCount(value) ? value : undefined);

/** One pull request, or `null` when the entry isn't one or its link isn't a web address. */
function pullRequestOf(value: unknown): ReviewPullRequest | null {
  return isRecord(value) && isCount(value.number) && typeof value.url === "string" && value.url.startsWith("https://")
    ? { number: value.number, url: value.url }
    : null;
}

/** The pull request the work is on, or `null` when the value isn't one. */
function workPullRequestOf(value: unknown): ReviewWorkPullRequest | null {
  const pr = pullRequestOf(value);
  if (pr === null || !isRecord(value)) return null;
  const state = value.state === "open" || value.state === "merged" || value.state === "closed" ? value.state : null;
  return { ...pr, state, unpushed: isCount(value.unpushed) ? value.unpushed : null };
}

/** This round's commits, or `null` when they aren't readable. */
function roundOf(value: unknown): ReviewDetail["round"] {
  if (!isRecord(value) || !isCount(value.commits)) return null;
  return { commits: value.commits, subjects: Array.isArray(value.subjects) ? value.subjects.filter((s): s is string => typeof s === "string") : [] };
}

/** One changed file, or `null` when the entry isn't one. */
function fileOf(value: unknown): ReviewFile | null {
  if (!isRecord(value) || typeof value.path !== "string") return null;
  const added = lineCountOf(value.added);
  const removed = lineCountOf(value.removed);
  return added === undefined || removed === undefined ? null : { path: value.path, added, removed };
}

/**
 * A review stop's `data` as {@link ReviewDetail}, or `null` when it isn't one
 * (not an object, or none of the review's fields readable). A field it can't read is
 * `null` (or `[]` for the subjects); it never throws.
 */
export function reviewDetail(data: unknown): ReviewDetail | null {
  if (!isRecord(data)) return null;
  const detail: ReviewDetail = {
    branch: typeof data.branch === "string" ? data.branch : null,
    commits: typeof data.commits === "number" && Number.isInteger(data.commits) && data.commits >= 0 ? data.commits : null,
    subjects: Array.isArray(data.subjects) ? data.subjects.filter((s): s is string => typeof s === "string") : [],
    judge: judgeOf(data.judge),
    lands: Array.isArray(data.lands) ? data.lands.filter(isLand) : [],
    landFailed: landAttemptOf(data.landFailed),
    landAttempts: Array.isArray(data.landAttempts)
      ? data.landAttempts.map(landAttemptOf).filter((attempt): attempt is { land: ReviewLand; message: string } => attempt !== null)
      : [],
    checks: checksOf(data.checks),
    goal: typeof data.goal === "string" ? data.goal : null,
    answer: typeof data.answer === "string" ? data.answer : null,
    pullRequests: Array.isArray(data.pullRequests)
      ? data.pullRequests.map(pullRequestOf).filter((pr): pr is ReviewPullRequest => pr !== null)
      : [],
    openPullRequest: pullRequestOf(data.openPullRequest),
    pullRequest: workPullRequestOf(data.pullRequest),
    round: roundOf(data.round),
    files: Array.isArray(data.files) ? data.files.map(fileOf).filter((file): file is ReviewFile => file !== null) : null,
    fileCount: isCount(data.fileCount) ? data.fileCount : null,
    added: isCount(data.added) ? data.added : null,
    removed: isCount(data.removed) ? data.removed : null,
  };
  // Nothing readable is no review: the card then shows the stop's prompt instead.
  const readable = detail.branch !== null || detail.commits !== null || detail.subjects.length > 0 || detail.judge !== null || detail.checks !== null;
  return readable ? detail : null;
}
