/**
 * The declared roster — the whole tree in one call, and one list of what
 * failed to load.
 *
 * Three readers already answer three questions about a tree, and every app that
 * wants all three has to call all three and flatten five error channels into
 * something it can refuse on. Two labs grew that flattening independently and
 * byte-identically, which is the shape of a missing export.
 *
 * This is a JOIN over `readWorkforce`, `readResourcesDirectory` and
 * `readChannelsDirectory`. It walks nothing itself: a fourth walk would be a
 * fourth answer to "what is in this tree", and the readers are the answer.
 *
 * **It collects; it does not set your boot policy.** Every reader under it says
 * in its own header that a library handing back data does not decide what is
 * fatal, and a shared export that threw would make itself the one exception. So
 * a tree with problems still returns every record that loaded, and the caller
 * writes its own refusal. The single throw is the root itself — unreadable, or
 * a symlink — because there is no record to collect that against, and because
 * all three readers already throw there.
 *
 * Node-only (by way of the readers), which is why it ships behind the
 * `./loader` subpath rather than the package root: importing the package root
 * must not pull a consumer onto `node:fs`.
 */

import path from "node:path";
import { readChannelsDirectory } from "./read-channels-directory";
import { readReferencesDirectory, readResourcesDirectory } from "./read-resources-directory";
import { readWorkforce } from "./read-workforce";
import { REFERENCES_SLOT, RESOURCES_SLOT } from "./resource-convention";
import type {
  ChannelManifest,
  ResourceDoc,
  TeamManifest,
  WorkerManifest,
} from "../manifest";

/**
 * Which reader reported a problem — the one thing the flattening adds that the
 * entries themselves cannot carry.
 *
 * Once five channels are one list, "a document failed" and "a seat's skill
 * failed" are the same shape, and a caller that wants to treat them
 * differently has nothing to branch on. This is that.
 */
export type DeclaredProblemLayer =
  /** A worker slot, or a structural folder above one. */
  | "worker"
  /** One seat's skills, at any of the three levels it reads. */
  | "skill"
  /** A team's own `TEAM.md`. */
  | "team"
  /** A document under `org/resources/` or a team's or worker's `resources/`. */
  | "document"
  /** A reference under `org/references/` or a team's or worker's `references/`. */
  | "reference"
  /** A channel folder under `teams/<id>/channels/`. */
  | "channel";

/** One thing that did not load, as the reader that found it reported it. */
export interface DeclaredProblem {
  /** Which reader this came from. */
  layer: DeclaredProblemLayer;
  /** The path the reader named, unchanged. */
  path: string;
  /**
   * The reader's own error, kept whole rather than re-worded.
   *
   * Each reader owns one wording per refusal and tests it; re-phrasing here
   * would give one failure two spellings, and would drop the `cause` chain the
   * reader attached. Callers format from `error.message`.
   */
  error: Error;
  /**
   * The seat this cost a skill — set on the `skill` layer and nowhere else.
   *
   * A level shared by several seats fails once per seat that reads it, not
   * once for the level, because that is what it really cost: each of those
   * seats is running short. `readWorkforce` already reports it per seat, and
   * this keeps that rather than collapsing it.
   */
  worker?: string;
}

/** The whole declared tree, plus everything that failed to load reaching it. */
export interface DeclaredRoster {
  /** One record per worker that loaded, in walk order, carrying its skills. */
  workers: WorkerManifest[];
  /**
   * One record per team that declared a `TEAM.md`, in walk order.
   *
   * `readWorkforce` has returned these since `TEAM.md` landed, and neither lab
   * surfaced them. A team with no file is absent, not present-and-empty.
   */
  teams: TeamManifest[];
  /**
   * One record per document that loaded, in walk order.
   *
   * Spelled `documents` rather than `resources` because that was the reader's
   * own deliberate choice, and a composer that renames its readers' output
   * gives the same thing two names.
   */
  documents: ResourceDoc[];
  /**
   * One record per reference that loaded, in walk order, each carrying the
   * `filePath` its content is served from.
   *
   * Separate from {@link DeclaredRoster.documents} rather than merged with a
   * flag: the two go to different install halves, and one list a caller has to
   * partition is one a caller can partition wrongly.
   */
  references: ResourceDoc[];
  /**
   * One record per channel that loaded, in walk order.
   *
   * This inherits `readChannelsDirectory` exactly, including that it walks
   * `teams/<id>/channels/` and there is no `org/channels/` level the way there
   * is for resources. The composer widens no reader.
   */
  channels: ChannelManifest[];
  /**
   * Everything that did not load, from all five error channels, each entry
   * tagged with the layer it came from.
   *
   * Empty is the clean tree. Non-empty does not mean the records are missing:
   * everything that loaded is still above.
   */
  problems: DeclaredProblem[];
}

/**
 * Read `<root>` into the whole declared tree.
 *
 * Throws only when `root` itself cannot be read or is a symlink — the rule all
 * three readers already follow, and the only condition with no record to
 * collect against. Everything below the root is collected into `problems`.
 *
 * @param root The workforce tree — the folder holding `org/` and `teams/`.
 * @returns Every record the three readers found, plus one flattened list of
 *   what failed.
 *
 * @example
 * const roster = await readDeclaredRoster("./workforce");
 * if (roster.problems.length > 0) {
 *   // The refusal line is yours: this library does not decide what is fatal.
 *   throw new Error(roster.problems.map((p) => `${p.layer} ${p.path}`).join(", "));
 * }
 * const seats = hireWorkforce(roster.workers);
 */
export async function readDeclaredRoster(root: string): Promise<DeclaredRoster> {
  // Serially, not in parallel. The three share a root that either opens or
  // throws, so racing them buys one boot-time round trip and makes which
  // reader's throw surfaces first a matter of timing — for a call an app makes
  // once, at boot, off the request path.
  const workforce = await readWorkforce(root);
  const resources = await readResourcesDirectory(root);
  const references = await readReferencesDirectory(root);
  const channels = await readChannelsDirectory(root);

  const problems: DeclaredProblem[] = [
    ...workforce.errors.map((e) => ({ layer: "worker" as const, path: e.path, error: e.error })),
    ...workforce.skillErrors.flatMap((seat) =>
      seat.errors.map((e) => ({
        layer: "skill" as const,
        path: e.path,
        error: e.error,
        worker: seat.worker,
      })),
    ),
    ...workforce.teamErrors.map((e) => ({ layer: "team" as const, path: e.path, error: e.error })),
    ...resources.errors.map((e) => ({ layer: "document" as const, path: e.path, error: e.error })),
    ...references.errors.map((e) => ({ layer: "reference" as const, path: e.path, error: e.error })),
    ...channels.errors.map((e) => ({ layer: "channel" as const, path: e.path, error: e.error })),
    ...collidingRefs(resources.documents, references.documents),
  ];

  return {
    workers: workforce.workers,
    teams: workforce.teams,
    documents: resources.documents,
    references: references.documents,
    channels: channels.channels,
    problems,
  };
}

/**
 * One problem per ref claimed by a `resources/` file and a `references/` file
 * at the same level.
 *
 * Both slots mint into one namespace, so `org/resources/handbook.md` and
 * `org/references/handbook.md` are two files claiming the accessor `handbook`.
 * They cannot both have it, and they must not silently resolve to one: a
 * reference is read from its file and sealed, a document seeds a row and then
 * evolves, so whichever won would decide a behaviour nobody chose.
 *
 * Reported here rather than in either reader because neither reader can see
 * the other's slot — this is the one place both lists exist. It is collected
 * like every other problem; `hireWorkforce` throws on the same collision at its
 * own door, for a catalog that never passed a loader.
 *
 * Named by PATH, and both paths, because that is what an author has to go and
 * change. Only the reference carries one — a `resources/` record deliberately
 * does not, so that adding references changed nothing about what the mutable
 * reader hands back. The document's path is DERIVED rather than looked up, and
 * it is exact: a collision means one basename in two slots at one level, so the
 * two files are siblings and differ in that one path segment. A hand-built
 * record with no path at all falls back to the ref.
 */
function collidingRefs(
  documents: readonly ResourceDoc[],
  references: readonly ResourceDoc[],
): DeclaredProblem[] {
  if (documents.length === 0 || references.length === 0) return [];
  const claimed = new Set(documents.map((doc) => doc.ref));
  const problems: DeclaredProblem[] = [];

  for (const reference of references) {
    if (!claimed.has(reference.ref)) continue;
    const at = reference.filePath ?? reference.ref;
    const sibling =
      reference.filePath === undefined
        ? reference.ref
        : reference.filePath.replace(
            `${path.sep}${REFERENCES_SLOT}${path.sep}`,
            `${path.sep}${RESOURCES_SLOT}${path.sep}`,
          );
    problems.push({
      layer: "reference",
      path: at,
      error: new Error(
        `"${at}" and "${sibling}" both claim the ref "${reference.ref}". A references/ file ` +
          `and a resources/ file at one level are two spellings of one document, and they do ` +
          `not behave the same — a reference is read from its file and nothing can write it, ` +
          `while a resource seeds a row that then becomes the source. Keep one.`,
      ),
    });
  }

  return problems;
}
