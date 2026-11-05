/**
 * The review stop's data, read for a browser card.
 *
 * With `reviewChanges` on, a run that made commits stops with
 * `suspendForUser({ kind: "review" })`, and the stop's `data` holds its
 * branch, commit count, commit subjects, the judge's verdict and the checks
 * the phase ran (`commandCheck`). This reads
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
   * The checks the phase ran before stopping for review (`commandCheck`), in
   * order: each command, how it ended and the end of its output. `null` when
   * none ran.
   */
  checks: ReviewCheck[] | null;
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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
    checks: checksOf(data.checks),
  };
  // Nothing readable is no review: the card then shows the stop's prompt instead.
  const readable = detail.branch !== null || detail.commits !== null || detail.subjects.length > 0 || detail.judge !== null || detail.checks !== null;
  return readable ? detail : null;
}
