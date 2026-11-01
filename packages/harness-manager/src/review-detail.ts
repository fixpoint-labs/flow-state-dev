/**
 * The review stop's data, read for a browser card.
 *
 * With `reviewChanges` on, a run that made commits stops with
 * `suspendForUser({ kind: "review" })`, and the stop's `data` holds its
 * branch, commit count, commit subjects and the judge's verdict. This reads
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

/**
 * A review stop's `data` as {@link ReviewDetail}, or `null` when it isn't one
 * (not an object, or none of the review's fields). A field it can't read is
 * `null` (or `[]` for the subjects); it never throws.
 */
export function reviewDetail(data: unknown): ReviewDetail | null {
  if (!isRecord(data) || !("branch" in data || "commits" in data || "subjects" in data || "judge" in data)) return null;
  return {
    branch: typeof data.branch === "string" ? data.branch : null,
    commits: typeof data.commits === "number" && Number.isInteger(data.commits) && data.commits >= 0 ? data.commits : null,
    subjects: Array.isArray(data.subjects) ? data.subjects.filter((s): s is string => typeof s === "string") : [],
    judge: judgeOf(data.judge),
  };
}
