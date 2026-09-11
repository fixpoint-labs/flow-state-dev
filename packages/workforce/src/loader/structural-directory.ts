/**
 * The walk primitives every workforce-tree reader shares.
 *
 * A workforce tree is read by more than one loader — workers from
 * `teams/<id>/workers/`, a seat's skills from three `skills/` folders — and
 * each of them needs the same three answers about a path before it can walk it:
 * is it a symlink (never followed), is it simply absent (silent), or is it
 * there and unreadable (reported)? Those answers live here, once, so a second
 * reader consumes them instead of re-deriving a walk that agrees with the first
 * only by coincidence.
 *
 * Node-only (`node:fs`), like every module behind the `./loader` subpath.
 */

import fs from "node:fs/promises";

/**
 * One path that should have produced something and did not, keyed by its
 * slash-separated path relative to the tree root — deliberately not by an
 * identity, because a folder that breaks the naming rules has no identity to be
 * reported under.
 */
export interface PathReport {
  path: string;
  error: Error;
}

/** What a path is, without following symlinks. */
export type EntryKind = "directory" | "file" | "symlink" | "absent" | "unreadable";

/** A path's kind, plus the failure behind an `unreadable` one. */
export interface Entry {
  kind: EntryKind;
  /** Set only for `unreadable`, so the report can say what went wrong. */
  error?: Error;
}

/**
 * Classify a path without following symlinks. Symlinks are never followed: a
 * workforce tree can come from anywhere, and one could escape the root or point
 * at something sensitive.
 *
 * Only a missing path is `absent`. Every other failure is `unreadable` and
 * stays distinct, for the same reason {@link openStructuralDirectory} keeps
 * them apart: a directory that is readable but not searchable (`r--` rather
 * than `r-x`) lists its children and then fails to stat any of them, so folding
 * that into `absent` would drop everything under it while leaving the reports
 * empty — the one thing a caller told to treat them as fatal cannot see.
 */
export async function classify(target: string): Promise<Entry> {
  try {
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink()) return { kind: "symlink" };
    if (stat.isDirectory()) return { kind: "directory" };
    if (stat.isFile()) return { kind: "file" };
    // A socket, a FIFO, a device: not a slot, and not a mistake either.
    return { kind: "absent" };
  } catch (err) {
    const failure = err as NodeJS.ErrnoException;
    return failure.code === "ENOENT"
      ? { kind: "absent" }
      : { kind: "unreadable", error: failure };
  }
}

/**
 * List one of a walk's structural directories — `teams`, a team's `workers`, a
 * level's `skills`. Returns its entries, or `undefined` when the walk cannot go
 * that way, having reported the reason unless the folder is simply absent.
 *
 * Absence is the only silent outcome, and separating it from the rest is why
 * this helper exists. A missing folder is a tree that does not go that way; a
 * folder that exists and cannot be read is a set of things the app has lost,
 * and reading it as empty would drop them while leaving `errors` empty. The
 * symlink check is what stops `readdir` following `teams -> /outside` and
 * loading files from outside the configured root.
 */
export async function openStructuralDirectory(
  target: string,
  reportAs: string,
  errors: PathReport[],
): Promise<string[] | undefined> {
  if ((await classify(target)).kind === "symlink") {
    errors.push({ path: reportAs, error: refusedSymlink("directory", reportAs) });
    return undefined;
  }

  try {
    return await fs.readdir(target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    errors.push({
      path: reportAs,
      error: new Error(`"${reportAs}" could not be read: ${(err as Error).message}`),
    });
    return undefined;
  }
}

/** The one wording for a refused symlink, wherever a walk meets one. */
export function refusedSymlink(what: string, name: string): Error {
  return new Error(`Symlinked ${what} "${name}" — refused for safety`);
}

/** The one wording for a path that is there and could not be read. */
export function unreadable(what: string, name: string, cause: Error | undefined): Error {
  const detail = cause === undefined ? "" : `: ${cause.message}`;
  return new Error(`${what} "${name}" could not be read${detail}`);
}
