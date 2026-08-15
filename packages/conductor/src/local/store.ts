/**
 * The local review record — real directories and real files under the checkout.
 *
 * A local source needs somewhere for the parts of a review process that git does
 * not hold: *this branch has been submitted for review*, *this human's verdict
 * on it*, *what they said about it*, *what the checks concluded*. GitHub keeps
 * those in a database behind an API. Locally they are files, and that is the
 * whole trick — a human opens their editor, writes a verdict, saves, and the
 * next observation reads it.
 *
 * ```
 * <repoRoot>/.conductor/local/
 *   submissions/
 *     1/
 *       submission.json          { number, branch, base, openedAt }
 *       reviews/alice.json       { reviewer, state, sha? }   ← a human writes this
 *       comments/alice.1.md      free prose                  ← and this
 *   checks/<sha>.json            { conclusion, at }          ← a real check run writes this
 * ```
 *
 * Checks sit beside the submissions rather than inside one because a check run
 * is about a *commit*. That is not tidiness: the base branch's status is the
 * same question asked of a different commit, and a base branch has no
 * submission to file it under.
 *
 * Two properties this layout exists to hold:
 *
 * - **Nothing here is scripted.** Every file is written by a human, by a real
 *   check run, or by {@link openSubmission} recording that a branch was put up
 *   for review. There is no fixture and no canned result: an empty inbox means
 *   nobody has reviewed anything, which is a true statement about the world
 *   rather than a stubbed one.
 * - **The inbox is human-only by construction.** Conductor never writes into
 *   `reviews/` or `comments/`, which is why the local source can treat every
 *   entry as human without an identity check. GitHub needs `isHumanActor`
 *   because conductor and the reviewer share one comment stream; here they do
 *   not share a directory.
 *
 * **Numbering lives on the write side, exactly as GitHub's does.** A submission
 * gets its number when it is opened ({@link openSubmission}), from the numbers
 * already on disk — not when it is read. An observer that minted identity while
 * reading would be inventing the thing it is supposed to be reporting.
 */

import fs from "node:fs/promises";
import path from "node:path";

import type { ReviewFacts } from "../model/world";

/** Where the local review record lives, relative to the repo root. */
const LOCAL_ROOT = ".conductor/local";

/** How many times {@link openSubmission} will re-scan after losing a race. */
const OPEN_ATTEMPTS = 5;

/** A branch put up for review, as its `submission.json` records it. */
export interface LocalSubmission {
  /** The submission's identity. Assigned once, at open, from what is on disk. */
  readonly number: number;
  /** The branch under review. Its head, ancestry, and mergeability are read from git. */
  readonly branch: string;
  /** The branch it is proposed against. */
  readonly base: string;
  readonly openedAt: string;
}

/** What a real check run concluded about one commit. */
export interface LocalCheckRecord {
  readonly conclusion: "pending" | "success" | "failure";
  readonly at: string;
  /** What produced the conclusion, for a human reading the file back. */
  readonly command?: string;
}

/** One comment, as a file in the inbox. */
export interface LocalComment {
  /** Stable within a submission: the file's name. */
  readonly id: string;
  readonly author: string;
  /** The file's modification time — when the human actually wrote it. */
  readonly at: string;
}

/** Absolute path of one submission's directory. */
export function submissionDir(repoRoot: string, number: number): string {
  return path.join(path.resolve(repoRoot), LOCAL_ROOT, "submissions", String(number));
}

/** Read a JSON file, or `null` when it is not there. */
async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * The same read, but a file that is not valid JSON is treated as absent.
 *
 * Only for the inbox. A reviewer's directory is written by hand, so a truncated
 * save or a stray file is an ordinary occurrence — and the same rule `decide`
 * holds applies: **unknown input is inert, never fatal.** One malformed verdict
 * must not wedge the tick that would have read the twelve good ones beside it.
 * A record conductor itself wrote (`submission.json`) gets no such leniency,
 * because a malformed one there means something is corrupting the store.
 */
async function readJsonIfValid<T>(file: string): Promise<T | null> {
  try {
    return await readJson<T>(file);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

/**
 * Timestamps at second precision, the form every other timestamp in conductor
 * carries.
 *
 * Signals are ordered by comparing `at` as strings, so a source that emitted
 * milliseconds and one that did not would interleave by lexicographic accident
 * rather than by time — `…:00.000Z` sorts before `…:00Z` for the same instant.
 */
function isoSeconds(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}

/** Directory entries, oldest name first, or `[]` when the directory is absent. */
async function listFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** The submission with this number, or `null` when nothing has been opened under it. */
export async function readSubmission(
  repoRoot: string,
  number: number,
): Promise<LocalSubmission | null> {
  return readJson<LocalSubmission>(
    path.join(submissionDir(repoRoot, number), "submission.json"),
  );
}

/**
 * A review's identity: the file it lives in, when it was saved, and the verdict
 * it carried at that moment.
 *
 * **The file name alone is not identity.** A reviewer changing their mind edits
 * `alice.json` in place — GitHub would call that a second review with a second
 * id, and `reconcile` skips any review whose id conductor has already reduced
 * over. Keyed on the name alone, the edit from `CHANGES_REQUESTED` to
 * `APPROVED` produces no signal and the entity waits on a gate the world has
 * already satisfied.
 *
 * The two extra components are values this reader already derives, so the
 * reviewer still writes nothing but their verdict — no id, no revision counter,
 * nothing to keep in step with a file they edit by hand:
 *
 * - **When it was saved** (`at`) is the act itself. Re-filing the same verdict
 *   against a new head is a real second review — the author pushed a fix and
 *   the reviewer looked again — and only the timestamp separates them. It also
 *   means a bare `touch` reads as a re-review, which is the same rule the head
 *   resolution below already applies: touching the file moves the commit the
 *   verdict points at, so it *is* a claim about a different head, and the signal
 *   agrees with the world rather than contradicting it.
 * - **The verdict** (`state`) covers what the timestamp cannot: a reviewer who
 *   pins `at` by hand, or two saves inside the one second `at` resolves to.
 *
 * The resolved SHA is deliberately not part of it. A submission's reviews are
 * re-resolved against the last known head once it merges, which would flip every
 * id at merge time and synthesize approvals nobody filed.
 */
function reviewId(name: string, at: string, state: string): string {
  return `${name}@${at}#${state}`;
}

/**
 * Every review filed against a submission, as `ReviewFacts`.
 *
 * `sha` may be omitted by the reviewer, and usually is — asking a human to paste
 * a commit hash into a file is friction that buys nothing, because the answer is
 * already derivable. `resolveSha` is handed the file's modification time and
 * returns the head the branch stood at then (see `./git`'s `headShaAt`), so an
 * approval written before a push keeps pointing at the head it actually saw and
 * the staleness rule holds without anyone having to cooperate with it.
 *
 * `isHuman` is `true` for every entry: conductor never writes into this
 * directory, so there is no machine author to filter out.
 *
 * @param repoRoot The checkout under management.
 * @param number The submission whose inbox to read.
 * @param resolveSha Resolves the reviewed head from a review's timestamp.
 */
export async function readReviews(
  repoRoot: string,
  number: number,
  resolveSha: (at: string) => Promise<string | null>,
): Promise<ReviewFacts[]> {
  const dir = path.join(submissionDir(repoRoot, number), "reviews");
  const out: ReviewFacts[] = [];

  for (const name of await listFiles(dir)) {
    // A verdict is structured data, so it is a `.json` file. Anything else in
    // the directory — a scratch note, an editor's swap file — is not a review
    // that failed to parse; it is not a review.
    if (!name.endsWith(".json")) continue;

    const file = path.join(dir, name);
    const payload = await readJsonIfValid<{
      reviewer?: string;
      state?: string;
      sha?: string;
      at?: string;
    }>(file);
    if (!payload) continue;

    const state = (payload.state ?? "").toUpperCase();
    // Same rule the GitHub reader applies: only the three states a reviewer
    // actually stands behind become facts. Anything else is a malformed file,
    // and a malformed file is not a verdict.
    if (state !== "APPROVED" && state !== "CHANGES_REQUESTED" && state !== "COMMENTED") {
      continue;
    }

    const at = payload.at ?? isoSeconds((await fs.stat(file)).mtime);
    const sha = payload.sha ?? (await resolveSha(at)) ?? "";

    out.push({
      id: reviewId(name, at, state),
      reviewer: payload.reviewer ?? name.replace(/\.json$/, ""),
      isHuman: true,
      state,
      sha,
      at,
    });
  }

  return out;
}

/**
 * Every comment in a submission's inbox.
 *
 * The author is the file name's first dot-separated segment — `alice.1.md` is
 * alice's first comment — and the timestamp is the file's modification time. Both
 * are real properties of a file a human wrote, which is what keeps this from
 * needing a format nobody would want to type.
 */
export async function readComments(
  repoRoot: string,
  number: number,
): Promise<LocalComment[]> {
  const dir = path.join(submissionDir(repoRoot, number), "comments");
  const out: LocalComment[] = [];

  for (const name of await listFiles(dir)) {
    const stat = await fs.stat(path.join(dir, name));
    out.push({
      id: name,
      author: name.split(".")[0] ?? name,
      at: isoSeconds(stat.mtime),
    });
  }

  return out;
}

/** Where a commit's check conclusion is recorded. */
function checkFile(repoRoot: string, sha: string): string {
  return path.join(
    path.resolve(repoRoot),
    LOCAL_ROOT,
    "checks",
    `${encodeURIComponent(sha)}.json`,
  );
}

/**
 * What a real check run recorded for one commit, or `null` when none has run.
 *
 * Keyed by commit rather than by submission, because that is what a check run is
 * about. It also makes `baseRed` fall out of the same read: a base branch is not
 * a submission and has no inbox, but its head is a commit like any other.
 */
export async function readCheck(
  repoRoot: string,
  sha: string,
): Promise<LocalCheckRecord | null> {
  return readJson<LocalCheckRecord>(checkFile(repoRoot, sha));
}

/**
 * Record what a check run concluded about a commit.
 *
 * Written by whatever actually ran the checks — a git hook, the goal harness, a
 * developer running the suite by hand. Conductor reads it; conductor does not
 * decide it, and there is no path here that invents a conclusion for a commit
 * nothing has run against. A commit with no record reports `null`, which the
 * `awaiting_ci` gate already reads as "no CI here" rather than as a failure.
 */
export async function writeCheck(
  repoRoot: string,
  sha: string,
  record: LocalCheckRecord,
): Promise<void> {
  const file = checkFile(repoRoot, sha);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(record, null, 2)}\n`);
}

/** Submission numbers already on disk, ascending. */
async function existingNumbers(repoRoot: string): Promise<number[]> {
  const dir = path.join(path.resolve(repoRoot), LOCAL_ROOT, "submissions");
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
      .map((entry) => Number(entry.name))
      .sort((a, b) => a - b);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/**
 * Put a branch up for review, or return the submission it already has.
 *
 * The local analogue of opening a pull request, and the only place a submission
 * number comes from. Numbers are assigned from what is on disk, so they are
 * stable across restarts and mean the same thing to a human reading the
 * directory as they do to conductor reading the ledger.
 *
 * Idempotent on `branch`: submitting the same branch twice returns the first
 * submission rather than opening a second one, which is what makes a re-entered
 * phase safe to run.
 *
 * An exclusive create is the concurrency guard: two ticks racing cannot both
 * claim a number, because the loser's `O_EXCL` fails on a file the winner has
 * already written. The loser re-scans rather than adopting the record it
 * collided with — that record belongs to the *other* branch, and returning it
 * would hand one branch's submission to another's phase.
 *
 * @param repoRoot The checkout under management.
 * @param branch The branch being submitted.
 * @param base What it is proposed against.
 * @param now When it was submitted, ISO-8601.
 * @throws When the number cannot be claimed after {@link OPEN_ATTEMPTS} tries,
 *   which means something other than a race is writing this directory.
 */
export async function openSubmission(
  repoRoot: string,
  branch: string,
  base: string,
  now: string,
): Promise<LocalSubmission> {
  for (let attempt = 0; attempt < OPEN_ATTEMPTS; attempt += 1) {
    const numbers = await existingNumbers(repoRoot);
    for (const number of numbers) {
      const existing = await readSubmission(repoRoot, number);
      if (existing?.branch === branch) return existing;
    }

    const submission: LocalSubmission = {
      number: (numbers.at(-1) ?? 0) + 1,
      branch,
      base,
      openedAt: now,
    };
    const dir = submissionDir(repoRoot, submission.number);
    await fs.mkdir(dir, { recursive: true });

    try {
      await fs.writeFile(
        path.join(dir, "submission.json"),
        `${JSON.stringify(submission, null, 2)}\n`,
        { flag: "wx" },
      );
      return submission;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // Someone else took this number. Re-scan: they may have taken it for a
      // different branch, in which case the next one is ours.
    }
  }

  throw new Error(
    `Could not claim a local submission number for ${branch} after ${OPEN_ATTEMPTS} ` +
      `attempts. Check ${path.join(LOCAL_ROOT, "submissions")} for a partially written record.`,
  );
}
