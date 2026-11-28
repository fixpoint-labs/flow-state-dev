// FIX-2384; FIX-2163.
/**
 * What a run made on its branch: its commits (how many, and their subjects),
 * and what they changed (each file's added and removed lines, and one file's
 * patch).
 *
 * Read from the run's checkout, against the base its branch was cut from, by
 * one base rule for all three reads. Nothing here settles a row: a run's
 * output carries the count, a judge reads the subjects, and a person reviews
 * the files. So a checkout git cannot read answers none rather than failing
 * the run, and says it couldn't tell (`verified: false`), so a review
 * is never skipped on a count nobody read.
 *
 * Only what the run committed is read: a change left uncommitted in the
 * checkout is not on its branch, so it is not what a review accepts. A screen
 * that follows a run while it works asks for the working tree too
 * (`uncommitted`), and each file it adds is marked so.
 *
 * Every git read runs through `safe-git.ts`, which runs none of the commands
 * a run can name in its checkout; the working tree is read by
 * `working-tree.ts`, never through git's filters.
 */
import { z } from "zod";
import { checkoutGit as git } from "./safe-git";
import { countLines, workingChanges, workingPatch, type WorkingChange } from "./working-tree";

/** The most commit subjects reported for one run. */
export const MAX_COMMIT_SUBJECTS = 20;

/** One commit of a run's log: what a timeline draws for it. */
export interface RunCommitEntry {
  /** The full commit sha. */
  sha: string;
  subject: string;
  /** The author's name. */
  author: string;
  /** When it was authored, ISO 8601. */
  at: string;
  /** It has more than one parent: a merge, most often of the base into the branch. */
  merge: boolean;
}

/** {@link RunCommitEntry}, as a schema: what a review's data and a changes read carry. */
export const runCommitEntrySchema = z.object({ sha: z.string(), subject: z.string(), author: z.string(), at: z.string(), merge: z.boolean() });

/** The commits a run made: the count, and up to {@link MAX_COMMIT_SUBJECTS} subjects, newest first. */
export interface RunCommits {
  count: number;
  subjects: string[];
  /** The same commits as {@link RunCommitEntry}s, newest first: only when the read asked for it (`log`). */
  log?: RunCommitEntry[];
  /** Git read the count against a base. `false` when no base or no checkout could be read, and the count is a fallback zero. */
  verified: boolean;
}

/** The commit `cwd`'s checkout is on, or `null` when git can't read one there. */
export async function headCommit(cwd: string): Promise<string | null> {
  try {
    return (await git(cwd, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"])).trim() || null;
  } catch {
    return null;
  }
}

/**
 * The base a run's reads start from: the base branch's tip now (`tip`, as the
 * workspace host fetched it, `WorkspaceHost.baseTip`) when it has the recorded
 * cut in its history, else the cut. A run that merged the moved-on base into
 * its branch then owns none of the base's commits, as its pull request
 * doesn't. Any other tip (one that doesn't descend from the cut, one that
 * already has `cwd`'s HEAD in its history, one git can't read in `cwd`, or
 * none) leaves the cut, so a tip can only ever take the
 * base's own commits out of a read. `null` for a record with no cut: the reads
 * fall back to the base's named copies, as {@link readRunCommits} says.
 */
export async function effectiveCut(cwd: string, cut: string | null, tip: string | null): Promise<string | null> {
  if (cut === null || tip === null) return cut;
  try {
    await git(cwd, ["merge-base", "--is-ancestor", cut, tip]);
  } catch {
    return cut;
  }
  // A tip that already has the run's HEAD (a run that pushed its own branch to the base) would read its work as none.
  try {
    await git(cwd, ["merge-base", "--is-ancestor", "HEAD", tip]);
    return cut;
  } catch {
    return tip;
  }
}

/**
 * The copies of the base that exist in `cwd`, by the rule {@link readRunCommits}
 * documents. Empty when there is no base, or none of its copies is there.
 */
async function resolveBases(cwd: string, baseRef: string | null, baseCommit: string | null): Promise<string[]> {
  if (baseRef === null) return [];
  const bases: string[] = [];
  // In the run's own checkout, a bare `HEAD` is the run's branch, never its base.
  const copies =
    baseCommit !== null
      ? [baseCommit]
      : baseRef === "HEAD"
        ? [`refs/remotes/origin/HEAD`]
        : [`refs/remotes/origin/${baseRef}`, baseRef];
  for (const base of copies) {
    try {
      await git(cwd, ["rev-parse", "--verify", "--quiet", `${base}^{commit}`]);
      bases.push(base);
    } catch {
      // This copy of the base doesn't exist here.
    }
  }
  return bases;
}

/**
 * The commits on `cwd`'s HEAD that the base does not have.
 *
 * With `baseCommit`, the commit the run's branch was cut at, that commit alone
 * is the base. It comes from the run's record, never from the checkout: a run
 * shares the checkout's refs and config, so any named copy of the base is one
 * it could point at its own work. A record without it falls back to the named
 * copies: the remote's (`origin/<baseRef>`) and the local branch. No base, or
 * no checkout git can read, answers none, unverified. A caller passes
 * {@link effectiveCut} as `baseCommit`, so a run that merged the moved-on base
 * owns none of its commits.
 *
 * With `since`, only the commits past that one count too: a round's own. A
 * round needs both exclusions, the base (so the base's commits it merged in
 * aren't its work) and its start (so an earlier round's aren't), and one base
 * argument carries only the first.
 *
 * With `log`, the answer carries each of those commits (sha, author, time,
 * merge or not) as `log`, read in the same `git log`.
 */
export async function readRunCommits(
  cwd: string,
  baseRef: string | null,
  baseCommit: string | null = null,
  options: { since?: string | null; log?: boolean } = {},
): Promise<RunCommits> {
  const resolved = await resolveBases(cwd, baseRef, baseCommit);
  // `since` counts on its own too, as a round read always has: a record with no cut and no named copy still has its round.
  const bases = options.since == null || baseRef === null || resolved.includes(options.since) ? resolved : [...resolved, options.since];
  if (bases.length === 0) return { count: 0, subjects: [], verified: false };
  try {
    const count = Number.parseInt((await git(cwd, ["rev-list", "--count", "HEAD", "--not", ...bases])).trim(), 10);
    // One line a commit, its fields apart by the unit separator, which no subject or name holds.
    const lines = (await git(cwd, ["log", `--max-count=${MAX_COMMIT_SUBJECTS}`, "--format=%H%x1f%an%x1f%aI%x1f%P%x1f%s", "HEAD", "--not", ...bases]))
      .split("\n")
      .filter((line) => line.length > 0);
    const log = lines.map((line): RunCommitEntry => {
      const [sha = "", author = "", at = "", parents = "", ...subject] = line.split("\x1f");
      return { sha, author, at, merge: parents.trim().split(" ").length > 1, subject: subject.join("\x1f") };
    });
    const subjects = log.map((entry) => entry.subject).filter((subject) => subject.length > 0);
    const logged = options.log === true ? { log } : {};
    if (Number.isNaN(count)) return { count: 0, subjects, ...logged, verified: false };
    return { count, subjects, ...logged, verified: true };
  } catch (error) {
    console.warn(
      `[harness-manager] could not read the run's commits against ${bases.join(" and ")} in ${cwd} ` +
        `(${error instanceof Error ? error.message : String(error)}); reporting none.`,
    );
    return { count: 0, subjects: [], verified: false };
  }
}

/** The most files one diff read lists. The totals still count every file. */
export const MAX_DIFF_FILES = 200;

/** The most files a working-tree read counts lines in, copied for one diff. More still count as files, with no lines. */
export const MAX_COUNTED_FILES = 200;

/** The most characters of one file's patch a read hands back. */
export const MAX_PATCH_CHARS = 64_000;

/** One file a run changed, and by how many lines. */
export interface RunDiffFile {
  /** The file's path in the repository. A rename reads as the old path removed and the new one added. */
  path: string;
  /** Lines added; `null` for a binary file, which git counts no lines in. */
  added: number | null;
  /** Lines removed; `null` for a binary file. */
  removed: number | null;
  /** Some of the file's change is only in the working tree, not committed: set by an `uncommitted` read alone. */
  uncommitted?: true;
}

/** What a run's commits changed, file by file. */
export interface RunDiff {
  /** Up to {@link MAX_DIFF_FILES} changed files, in git's order (by path). */
  files: RunDiffFile[];
  /** How many files changed, listed or not. */
  fileCount: number;
  /** Lines added across every changed file, listed or not. */
  added: number;
  /** Lines removed across every changed file, listed or not. */
  removed: number;
  /** Git read the diff against a base. `false` when no base or no checkout could be read, and the diff is a fallback empty one. */
  verified: boolean;
}

/** One file's patch, as a run's commits changed it. */
export interface RunFilePatch {
  path: string;
  /** The unified diff of that file, cut at {@link MAX_PATCH_CHARS}. Empty when the run didn't change it. */
  patch: string;
  /** The patch was longer than {@link MAX_PATCH_CHARS} and was cut. */
  truncated: boolean;
  /** Lines in the whole patch, counted past the cut: what a screen says it isn't showing. */
  lines: number;
  /** As {@link RunDiff.verified}. */
  verified: boolean;
}

/**
 * A patch read named a path the run's commits didn't change: a file it never
 * touched, a folder, a glob, or anything outside the checkout. Refused rather
 * than read, so a changes read opens only the change's own files.
 */
export class RunFileNotChanged extends Error {
  constructor(readonly path: string) {
    super(`"${path}" isn't a file this run changed, so its patch isn't read.`);
    this.name = "RunFileNotChanged";
  }
}

/** Where a diff read ends. Default `"HEAD"`: the checkout's branch now. */
export interface RunDiffOptions {
  /** The commit the diff ends at: a turn that recorded its own end reads only that turn's changes. */
  head?: string;
  /**
   * Start at the base commit itself rather than where `head` and the base
   * last met. For a session turn, whose base is the commit its checkout was
   * on: a turn that amended or rebased the previous turn's commit moves the
   * meeting point back, and would read that earlier turn's work as its own.
   */
  exactBase?: boolean;
  /**
   * Read the working tree too: tracked files edited since the last commit and
   * new files git doesn't ignore, each marked `uncommitted`. For a run still
   * working; a review reads what was committed. Ignored with `head`.
   */
  uncommitted?: boolean;
}

/** {@link RunDiff}, as a schema: what a review's data and a changes read carry. */
export const runDiffSchema = z.object({
  files: z.array(z.object({ path: z.string(), added: z.number().nullable(), removed: z.number().nullable(), uncommitted: z.literal(true).optional() })),
  fileCount: z.number().int().nonnegative(),
  added: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  verified: z.boolean(),
});

/** {@link RunFilePatch}, as a schema. */
export const runFilePatchSchema = z.object({
  path: z.string(),
  patch: z.string(),
  truncated: z.boolean(),
  lines: z.number().int().nonnegative(),
  verified: z.boolean(),
});

/**
 * What a changes read answers: the diff when it named no file, else that
 * file's patch. One or the other, so a screen that already shows the files
 * (a review's data carries them) pays for no second numstat when it opens one.
 */
export const runChangesSchema = z.object({ diff: runDiffSchema.nullable(), patch: runFilePatchSchema.nullable() });

/** What a changes read answers. */
export type RunChanges = z.infer<typeof runChangesSchema>;

/**
 * The read a changes read makes: the diff, or with `path`, that file's patch.
 * The one place both reads are chosen, for a board run and a session turn alike.
 */
export async function readRunChanges(
  cwd: string,
  baseRef: string | null,
  baseCommit: string | null,
  options: RunDiffOptions & { path?: string } = {},
): Promise<RunChanges> {
  const { path, ...at } = options;
  return path === undefined
    ? { diff: await readRunDiff(cwd, baseRef, baseCommit, at), patch: null }
    : { diff: null, patch: await readRunFilePatch(cwd, baseRef, baseCommit, path, at) };
}

const UNVERIFIED_DIFF: RunDiff = { files: [], fileCount: 0, added: 0, removed: 0, verified: false };

/**
 * The commit a run's diff starts at: where `head` and the base last met, so a
 * base that moved on after the branch was cut adds nothing to the run's diff.
 */
async function diffStart(cwd: string, head: string, bases: string[], exactBase = false): Promise<string> {
  if (exactBase) return bases[0]!;
  return (await git(cwd, ["merge-base", head, ...bases])).trim();
}

/** Paths from a `-z` listing. */
const pathsOf = (out: string) => out.split("\0").filter((path) => path !== "");

/** One numstat row's counts: a number, `null` for binary (`-`), `NaN` for anything git didn't write as a count. */
const countOf = (field: string | undefined) => (field === "-" ? null : Number.parseInt(field ?? "", 10));

/** The run's committed paths between `start` and `head`, as the diff read lists them. */
async function committedPaths(cwd: string, start: string, head: string): Promise<string[]> {
  return pathsOf(await git(cwd, ["diff", "--name-only", "--no-renames", "-z", start, head]));
}

/** The working tree's changes as a diff's files: lines counted for the first {@link MAX_COUNTED_FILES}. */
async function workingFiles(cwd: string, changes: readonly WorkingChange[]): Promise<RunDiffFile[]> {
  const counts = await countLines(cwd, changes.slice(0, MAX_COUNTED_FILES));
  return changes.map((change, i): RunDiffFile => {
    const { added, removed } = counts[i] ?? { added: 0, removed: 0 };
    return { path: change.path, added, removed, ...(change.uncommitted ? { uncommitted: true as const } : {}) };
  });
}

/**
 * What the run's commits changed: each file's added and removed lines, and
 * the totals. The base is found as {@link readRunCommits} finds it. No base,
 * or no checkout git can read, answers an empty diff, unverified.
 */
export async function readRunDiff(
  cwd: string,
  baseRef: string | null,
  baseCommit: string | null = null,
  options: RunDiffOptions = {},
): Promise<RunDiff> {
  const head = options.head ?? "HEAD";
  const uncommitted = options.uncommitted === true && options.head === undefined;
  const bases = await resolveBases(cwd, baseRef, baseCommit);
  if (bases.length === 0) return UNVERIFIED_DIFF;
  try {
    const start = await diffStart(cwd, head, bases, options.exactBase);
    const all: RunDiffFile[] = [];
    if (uncommitted) all.push(...(await workingFiles(cwd, await workingChanges(cwd, start))));
    else {
      // `-z` keeps every path exactly as it is, whatever characters it holds.
      for (const record of (await git(cwd, ["diff", "--numstat", "--no-renames", "-z", start, head])).split("\0")) {
        if (record === "") continue;
        const [added, removed, ...path] = record.split("\t");
        all.push({ path: path.join("\t"), added: countOf(added), removed: countOf(removed) });
      }
    }
    const diff: RunDiff = { files: [], fileCount: 0, added: 0, removed: 0, verified: true };
    for (const file of all) {
      // A row git didn't write as a count: say the diff couldn't be read rather than total a NaN.
      if (Number.isNaN(file.added) || Number.isNaN(file.removed)) return UNVERIFIED_DIFF;
      diff.fileCount += 1;
      diff.added += file.added ?? 0;
      diff.removed += file.removed ?? 0;
      if (diff.files.length < MAX_DIFF_FILES) diff.files.push(file);
    }
    return diff;
  } catch (error) {
    console.warn(
      `[harness-manager] could not read the run's diff against ${bases.join(" and ")} in ${cwd} ` +
        `(${error instanceof Error ? error.message : String(error)}); reporting none.`,
    );
    return UNVERIFIED_DIFF;
  }
}

/**
 * One file's patch, as the run's commits changed it, cut at
 * {@link MAX_PATCH_CHARS}. Only a file in the run's own diff is read: any
 * other path (unchanged, a folder, a glob, ignored, outside the repository)
 * throws {@link RunFileNotChanged}. The path is matched literally. The base is
 * found as {@link readRunCommits} finds it. With `uncommitted`, the diff is
 * the working tree's (see `working-tree.ts`), and a new file's is against nothing.
 */
export async function readRunFilePatch(
  cwd: string,
  baseRef: string | null,
  baseCommit: string | null,
  path: string,
  options: RunDiffOptions = {},
): Promise<RunFilePatch> {
  const unverified: RunFilePatch = { path, patch: "", truncated: false, lines: 0, verified: false };
  const head = options.head ?? "HEAD";
  const uncommitted = options.uncommitted === true && options.head === undefined;
  const bases = await resolveBases(cwd, baseRef, baseCommit);
  if (bases.length === 0) return unverified;
  let changed: boolean;
  let read: RunFilePatch;
  try {
    const start = await diffStart(cwd, head, bases, options.exactBase);
    // The run's own file list, exactly as the diff read lists it: the path must be one of them.
    const working = uncommitted ? (await workingChanges(cwd, start)).find((change) => change.path === path) : undefined;
    changed = uncommitted ? working !== undefined : (await committedPaths(cwd, start, head)).includes(path);
    let patch = "";
    let truncated = false;
    let lines = 0;
    // Line by line, so a huge patch is never held whole: past the cut, lines are only counted.
    const take = (line: string) => {
      lines++;
      if (truncated) return;
      const next = patch === "" ? line : `${patch}\n${line}`;
      if (next.length > MAX_PATCH_CHARS) {
        truncated = true;
        patch = next.slice(0, MAX_PATCH_CHARS);
      } else patch = next;
    };
    if (working !== undefined) await workingPatch(cwd, working, take);
    else if (changed) await git(cwd, ["diff", "--no-renames", "--no-color", start, head, "--", `:(literal)${path}`], take);
    read = { path, patch, truncated, lines, verified: true };
  } catch (error) {
    console.warn(
      `[harness-manager] could not read the run's patch of ${path} against ${bases.join(" and ")} in ${cwd} ` +
        `(${error instanceof Error ? error.message : String(error)}); reporting none.`,
    );
    return unverified;
  }
  if (!changed) throw new RunFileNotChanged(path);
  return read;
}
