/**
 * The review stop's data, read for a browser card.
 *
 * With `reviewChanges` on, a run that made commits stops with
 * `suspendForUser({ kind: "review" })`, and the stop's `data` holds its
 * branch, commit count, commit subjects, the judge's verdict, the checks
 * the phase ran (`commandCheck`), the ways an accept can land the work
 * (with the last landing that failed), what the task asked, the run's own
 * summary, the pull requests open on its branch and the files it changed. This reads
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
  // FIX-2782. Optional, as `lands` is, so a review built by hand needn't set them; the reader always does.
  /** What the task asked for: its goal. `null` when it had none. */
  goal?: string | null;
  /** The run's own summary: its final message, cut. `null` when it said nothing. */
  answer?: string | null;
  /** The pull requests open on the run's branch, to look at the work there. Empty when there are none. */
  pullRequests?: ReviewPullRequest[];
  /** Each file the commits changed and its lines, `null` when they couldn't be read. */
  files?: ReviewFile[] | null;
  /** How many files changed in all (the list may stop short of it); `null` when unread. */
  fileCount?: number | null;
  /** Lines added and removed in all; `null` when unread. */
  added?: number | null;
  removed?: number | null;
}

/** A pull request the review links to. */
export interface ReviewPullRequest {
  url: string;
  number: number;
}

/** One changed file: its path, and its lines (`null` for a binary file). */
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

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;
const countOrNull = (value: unknown): number | null => (isCount(value) ? value : null);
const textOrNull = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);

/** The pull requests, dropping any entry that isn't one. */
function pullRequestsOf(value: unknown): ReviewPullRequest[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((pr) => (isRecord(pr) && typeof pr.url === "string" && isCount(pr.number) ? [{ url: pr.url, number: pr.number }] : []));
}

/** The changed files, or `null` when they weren't read. */
function filesOf(value: unknown): ReviewFile[] | null {
  if (!Array.isArray(value)) return null;
  return value.flatMap((file) =>
    isRecord(file) && typeof file.path === "string" ? [{ path: file.path, added: countOrNull(file.added), removed: countOrNull(file.removed) }] : [],
  );
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
    goal: textOrNull(data.goal),
    answer: textOrNull(data.answer),
    pullRequests: pullRequestsOf(data.pullRequests),
    files: filesOf(data.files),
    fileCount: countOrNull(data.fileCount),
    added: countOrNull(data.added),
    removed: countOrNull(data.removed),
  };
  // Nothing readable is no review: the card then shows the stop's prompt instead.
  const readable = detail.branch !== null || detail.commits !== null || detail.subjects.length > 0 || detail.judge !== null || detail.checks !== null;
  return readable ? detail : null;
}
