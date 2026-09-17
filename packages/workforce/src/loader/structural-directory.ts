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
 * Above those three answers sit the two levels every reader walks the same way:
 * {@link openRoot} opens the configured root, and {@link walkTeams} enumerates
 * `teams/`. Both are here for the reason the lower half is — three readers held
 * their own copy of each, and the copies had already drifted twice. What a
 * reader does *inside* a team is deliberately not here: that is where the
 * conventions are supposed to differ, and a parameter that covered the
 * difference would make this one reader wearing four hats.
 *
 * Node-only (`node:fs`), like every module behind the `./loader` subpath.
 */

import fs from "node:fs/promises";
import path from "node:path";

/**
 * Names that never denote a thing in the tree — editor and OS droppings, which
 * appear at every enumerated level and are skipped before they are read as a
 * name. One list rather than one per reader: a name that is not a team to one
 * reader is not a worker, channel or document to another.
 */
export const IGNORED_ENTRIES = new Set([".DS_Store", "Thumbs.db"]);

/**
 * One path that should have produced something and did not, keyed by its
 * slash-separated path relative to the tree root — deliberately not by an
 * identity, because a folder that breaks the naming rules has no identity to be
 * reported under.
 *
 * `Kind` is the reader's own closed union of the conditions it can report, and
 * every entry carries one. Required rather than optional on purpose: a flat
 * array of reports is otherwise only tellable apart by matching on
 * `error.message`, and requiring the tag is what stops a condition added later
 * landing untagged.
 */
export interface PathReport<Kind extends string> {
  path: string;
  error: Error;
  /** Which of the reader's conditions this entry is. */
  kind: Kind;
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
 * What {@link openStructuralDirectory} found at a structural folder.
 *
 * Three outcomes, and the two that are not the happy path stay apart: `entries`
 * is set when the folder listed, `refusal` when it is there and the walk will
 * not go through it, and neither when it is simply absent — the one silent
 * outcome.
 */
export interface OpenedDirectory {
  /** The folder's entries. Set only when it listed. */
  entries?: string[];
  /** Why the walk stopped here, when that is worth reporting. */
  refusal?: {
    /** `symlink` when the folder is a link; `unreadable` when it is there and `readdir` failed. */
    reason: "symlink" | "unreadable";
    error: Error;
  };
}

/**
 * List one of a walk's structural directories — `teams`, a team's `workers`, a
 * level's `skills`. Returns its entries, or the reason the walk cannot go that
 * way, or neither when the folder is simply absent.
 *
 * Absence is the only silent outcome, and separating it from the rest is why
 * this helper exists. A missing folder is a tree that does not go that way; a
 * folder that exists and cannot be read is a set of things the app has lost,
 * and reading it as empty would drop them while leaving `errors` empty. The
 * symlink check is what stops `readdir` following `teams -> /outside` and
 * loading files from outside the configured root.
 *
 * Hands the reason back rather than filing a report itself, because which
 * condition a refusal counts as belongs to the reader: this helper serves more
 * than one, and their conditions are not the same.
 */
export async function openStructuralDirectory(
  target: string,
  reportAs: string,
): Promise<OpenedDirectory> {
  if ((await classify(target)).kind === "symlink") {
    return { refusal: { reason: "symlink", error: refusedSymlink("directory", reportAs) } };
  }

  try {
    return { entries: await fs.readdir(target) };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    return {
      refusal: {
        reason: "unreadable",
        error: new Error(`"${reportAs}" could not be read: ${(err as Error).message}`),
      },
    };
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

/**
 * Open the configured workforce root, or throw.
 *
 * The root is the one level whose failure is a wiring mistake rather than a
 * missing seat, channel or document, so it throws where everything below it is
 * collected: a reader that returned an empty result for a root that is not
 * there would hand an app a silent zero-worker roster.
 *
 * It is classified before it is listed, for the reason every nested structural
 * folder is: a bare `readdir` follows a symlink, and a symlinked root would
 * load the whole tree from somewhere the caller never configured.
 *
 * Returns nothing. Every reader goes on to open the levels it wants by name, so
 * the root's own entries have no reader.
 */
export async function openRoot(root: string): Promise<void> {
  if ((await classify(root)).kind === "symlink") {
    throw refusedSymlink("workforce directory", root);
  }

  try {
    await fs.readdir(root);
  } catch (err) {
    throw new Error(
      `Failed to read workforce directory "${root}": ${(err as Error).message}`,
    );
  }
}

/** One team folder a walk reached, handed to the reader that asked for it. */
export interface WalkedTeam {
  /** The folder's name, which is also the team half of every id minted under it. */
  id: string;
  /** Absolute path to the folder, for the reader to join its own slot onto. */
  dir: string;
  /** The folder's slash-separated path relative to the root — the prefix every report under it carries. */
  path: string;
}

/**
 * Walk `<root>/teams/` and yield every team folder a reader may descend into.
 *
 * The seam this package's readers share: they agree exactly down to the team
 * folder and diverge immediately after it, so the walk stops here. Which slot a
 * team holds, and what a thing inside that slot has to be, is the reader's own
 * and stays in the reader's own loop.
 *
 * Yields only folders that can actually be descended into. A symlinked or
 * unreadable team is reported through `report` and skipped, because the things
 * beneath it cannot be enumerated to be named individually and silence there
 * would hide all of them at once. A team that is neither — a stray file, a
 * socket — occupies no team slot and is skipped without a report.
 *
 * An absent `teams/` yields nothing, silently: an app may declare no teams in
 * files. A `teams/` that is there and cannot be walked is reported under
 * `teams` and ends the walk, since nothing below it can be reached.
 *
 * @param report Files one failure, under its path relative to the root. Which
 *   of the reader's conditions that failure counts as belongs to the reader —
 *   this walk serves more than one, and their closed unions are not the same —
 *   so the tag is added by the caller rather than passed in here.
 */
export async function* walkTeams(
  root: string,
  report: (path: string, error: Error) => void,
): AsyncGenerator<WalkedTeam> {
  const teams = await openStructuralDirectory(path.join(root, "teams"), "teams");
  if (teams.refusal !== undefined) {
    report("teams", teams.refusal.error);
  }
  if (teams.entries === undefined) return;

  for (const id of teams.entries) {
    if (IGNORED_ENTRIES.has(id)) continue;

    const dir = path.join(root, "teams", id);
    const teamPath = `teams/${id}`;
    const team = await classify(dir);

    if (team.kind === "symlink") {
      report(teamPath, refusedSymlink("team folder", id));
      continue;
    }
    if (team.kind === "unreadable") {
      report(teamPath, unreadable("Team folder", id, team.error));
      continue;
    }
    if (team.kind !== "directory") continue;

    yield { id, dir, path: teamPath };
  }
}
