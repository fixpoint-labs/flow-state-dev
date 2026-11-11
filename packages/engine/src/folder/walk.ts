/**
 * The walk primitives every reader of a kit's folder shares.
 *
 * A folder an app hands a kit is read by more than one reader, and each needs
 * the same three answers about a path before it can walk it: is it a symlink
 * (never followed), is it simply absent (silent), or is it there and
 * unreadable (reported)? Those answers live here, once, so a second reader
 * consumes them instead of re-deriving a walk that agrees with the first only
 * by coincidence. Above them sits {@link openRoot}, which opens the folder
 * itself. The claim pass that refuses what no reader used is `./claim`.
 *
 * Moved here from workforce's loader so the kit system does not depend on one
 * kit; workforce's readers import them from this subpath.
 *
 * Node-only (`node:fs`), like everything behind `@flow-state-dev/engine/folder`.
 */

import fs from "node:fs/promises";
import path from "node:path";

/** The backing list. Private: see {@link IGNORED_ENTRIES} for why. */
const ignored = new Set([".DS_Store", "Thumbs.db"]);

/** On Windows both separate; on POSIX a backslash is an ordinary filename character. */
const isSeparator = (character: string): boolean =>
  character === "/" || (path.sep === "\\" && character === "\\");

/**
 * A path with its trailing separators removed, and nothing else changed.
 *
 * Deliberately not `path.resolve`, and deliberately not `path.normalize`. See
 * {@link classify} for why this is the only reshaping that is safe here: a
 * trailing separator is the one part of a path's spelling that cannot change
 * which entry the path denotes, so removing it is the whole of what the
 * `lstat`-follows-the-final-link problem needs. Anything that touches
 * *segments* — collapsing `..` above all — can move the path to a different
 * entry than the one the caller named.
 *
 * Never strips into the root, so `/` stays `/` and `C:\` stays `C:\` rather
 * than becoming `""` or `C:` (which names the current directory on that drive,
 * a different place). `.` and `..` are segments, so they are left alone.
 */
function withoutTrailingSeparators(target: string): string {
  const rootLength = path.parse(target).root.length;
  let end = target.length;
  while (end > rootLength && isSeparator(target.charAt(end - 1))) end--;
  return target.slice(0, end);
}

/**
 * Names that never denote a thing in the tree — editor and OS droppings, which
 * appear at every enumerated level and are skipped before they are read as a
 * name. One list rather than one per reader: a name that is not a team to one
 * reader is not a worker or document to another. It is also the only pass the
 * claim pass gives: every other entry in a kit's folder is used or refused.
 *
 * Published as a view that cannot be written to, not as the set the readers
 * consult. One list shared by every reader in the process is exactly the thing
 * a consumer must not be able to edit: `IGNORED_ENTRIES.add("engineering")`
 * would make every later read silently skip that team, with nothing thrown and
 * nothing reported. A `ReadonlySet` annotation alone does not stop that — types
 * erase, and `.add` is still there at runtime — so the mutators are absent
 * rather than merely untyped.
 */
export const IGNORED_ENTRIES: ReadonlySet<string> = Object.freeze({
  has: (name: string) => ignored.has(name),
  keys: () => ignored.keys(),
  values: () => ignored.values(),
  entries: () => ignored.entries(),
  // Hands the view, not `ignored`, to the callback's third argument — passing
  // the backing set there would put it back within reach.
  forEach: (
    fn: (value: string, second: string, set: ReadonlySet<string>) => void,
    thisArg?: unknown,
  ) => ignored.forEach((name) => fn.call(thisArg, name, name, IGNORED_ENTRIES)),
  get size() {
    return ignored.size;
  },
  [Symbol.iterator]: () => ignored[Symbol.iterator](),
});

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

/** A path's entry kind, plus the failure behind an `unreadable` one. */
export interface Entry {
  kind: EntryKind;
  /** Set only for `unreadable`, so the report can say what went wrong. */
  error?: Error;
}

/**
 * Classify a path without following symlinks. Symlinks are never followed: a
 * folder can come from anywhere, and one could escape the root or point
 * at something sensitive.
 *
 * The answer is the one the path **as written** produces, with exactly one
 * exception: when removing the trailing separators reveals a symlink, that wins.
 * Nothing else about the spelling changes any answer.
 *
 * The exception exists because `lstat` resolves the *final* symlink when a path
 * ends in a separator: `<link>` is a link, `<link>/` is the directory behind it.
 * The trailing form is the ordinary way a directory gets written down — it falls
 * out of config, environment variables and hand-joined paths — so classifying
 * the string exactly as given would leave the no-follow answer one character
 * from being wrong, here and in everything built on it.
 *
 * The exception is kept that narrow because a trailing separator is otherwise a
 * real assertion about the path, and the filesystem enforces it: `<file>/` fails
 * with `ENOTDIR`, and answering `file` for it would have this helper accept a
 * spelling that nothing underneath it can open. So the strip decides
 * symlink-ness and the original decides everything else — `<file>/` stays
 * `unreadable`, `<missing>/` stays `absent`.
 *
 * What gets stripped is guarded just as narrowly. A trailing separator is the
 * only piece of a path's spelling that cannot change which entry the path
 * denotes; every other normalization can. `path.resolve` and `path.normalize`
 * both collapse `..` *lexically*, while the kernel applies it *after* traversing
 * a symlinked component, so the two disagree exactly when a link is involved:
 *
 * ```
 * spelled           <base>/a/../c     with `a` a link to <base>/sub/b
 * collapsed         <base>/c          an ordinary directory
 * what lstat sees   <base>/sub/c      a symlink to somewhere else entirely
 * ```
 *
 * Classifying the collapsed form would answer `directory` about a path whose
 * `readdir` follows a link — the caller is told the coast is clear and then
 * opens the linked tree. So the classification has to be about the entry the
 * caller actually named. Whoever tidies this later: that is why this is a
 * hand-rolled suffix strip and not a one-liner from `node:path`.
 *
 * Only the *final* entry is answered for. A symlink in an ancestor component is
 * followed by `lstat`, here as everywhere, and is not this function's question.
 *
 * Only a missing path is `absent`. Every other failure is `unreadable` and
 * stays distinct, for the same reason {@link openStructuralDirectory} keeps
 * them apart: a directory that is readable but not searchable (`r--` rather
 * than `r-x`) lists its children and then fails to stat any of them, so folding
 * that into `absent` would drop everything under it while leaving the reports
 * empty — the one thing a caller told to treat them as fatal cannot see.
 */
export async function classify(target: string): Promise<Entry> {
  // Only the symlink answer comes from the stripped spelling. Everything else
  // comes from the path as written, because a trailing separator is a real
  // assertion about the path — `<file>/` is a thing the filesystem refuses
  // (`ENOTDIR`), and answering `file` for it would have this helper accept a
  // spelling that nothing underneath it can open.
  //
  // The order is not interchangeable. Asking the original first and keeping a
  // successful answer would miss the whole point: `<link>/` succeeds and says
  // `directory`, because that spelling is exactly what hides the link.
  const stripped = withoutTrailingSeparators(target);
  if (stripped !== target) {
    try {
      if ((await fs.lstat(stripped)).isSymbolicLink()) return { kind: "symlink" };
    } catch {
      // Not answerable from the stripped spelling. The path as written decides,
      // and will report the same failure.
    }
  }

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
 * Whether a root's spelling carries a `..` segment that `path.join` would
 * collapse — that is, one standing after a segment naming a real directory.
 *
 * Leading `..` segments are fine and common (`../workforce`): nothing precedes
 * them, so nothing collapses and every path built from the root denotes what it
 * says. What this catches is `<a>/../<b>`, where the kernel applies the `..`
 * *after* walking `<a>` while `path.join` applies it *lexically* — so a linked
 * `<a>` sends the two to different directories. See {@link classify} for the
 * worked example.
 */
function collapsesThroughAnAncestor(root: string): boolean {
  // Split on the separators this platform actually has — on POSIX a backslash
  // is an ordinary filename character, so a folder named `a\..\b` is one
  // segment and names no ancestor.
  const segments: string[] = [""];
  for (const character of root.slice(path.parse(root).root.length)) {
    if (isSeparator(character)) segments.push("");
    else segments[segments.length - 1] += character;
  }

  // A segment only makes a later `..` collapsible if it names a directory to
  // collapse. `.`, `..` and the empty run between doubled separators do not:
  // a root of `../../workforce` steps up twice from the caller's own directory
  // and every path built from it still denotes what it says.
  const namesADirectory = (segment: string): boolean =>
    segment !== "." && segment !== ".." && segment !== "";

  return segments.some(
    (segment, index) => segment === ".." && segments.slice(0, index).some(namesADirectory),
  );
}

/**
 * Open a configured folder's root, or throw. `what` names the folder in every
 * message (`"workforce directory"`, `"folder of kit \"notes\""`), so the
 * refusal says which configuration is wrong.
 *
 * The root is the one level whose failure is a wiring mistake rather than a
 * missing worker or document, so it throws where everything below it is
 * collected: a reader that returned an empty result for a root that is not
 * there would hand an app a silent zero-worker roster.
 *
 * It is classified before it is listed, for the reason every nested structural
 * folder is: a bare `readdir` follows a symlink, and a symlinked root would
 * load the whole tree from somewhere the caller never configured.
 *
 * The refusal holds however the caller spelled the path — `<root>` and
 * `<root>/` alike — because {@link classify} normalizes the spelling before it
 * answers. That matters most here: a root is the one path in the tree a user
 * writes by hand, into config or an environment variable, where the trailing
 * form is the ordinary way to write a directory down.
 *
 * One spelling is refused before it is classified at all: a root carrying an
 * interior `..`. Everything below the root is addressed as `path.join(root,
 * …)`, which collapses `..` lexically, while the check here goes through the
 * kernel, which collapses it only after walking what precedes it. With a link
 * in front of the `..` those are two different directories, so classifying the
 * root would answer for a tree the walk never reads — the check would pass and
 * the content would come from somewhere else. Refused rather than resolved,
 * because resolving it would pick one of the two meanings on the caller's
 * behalf; the message asks for the path the caller means.
 *
 * Returns nothing. Every reader goes on to open the levels it wants by name.
 */
export async function openRoot(root: string, what: string): Promise<void> {
  if (collapsesThroughAnAncestor(root)) {
    throw new Error(
      `${what.charAt(0).toUpperCase()}${what.slice(1)} "${root}" is spelled with a ".." that steps back through an earlier ` +
        `segment — refused for safety, because the folder this path checks and the folder its ` +
        `contents would be read from need not be the same one. Pass the path it resolves to.`,
    );
  }

  if ((await classify(root)).kind === "symlink") {
    // Reported as the caller spelled it, so the message names the path they
    // configured rather than one they would have to recognize.
    throw refusedSymlink(what, root);
  }

  try {
    await fs.readdir(root);
  } catch (err) {
    throw new Error(
      `Failed to read ${what} "${root}": ${(err as Error).message}`,
    );
  }
}

