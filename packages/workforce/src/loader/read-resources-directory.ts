/**
 * The resources convention loader — read a workforce tree's documents into
 * neutral records.
 *
 * Walks `<root>/org/resources/`, `<root>/teams/<teamId>/resources/` and every
 * `resources/` folder inside a worker's own folder under either parent, reads
 * each `<name>.md`, and returns one plain record per document. Frontmatter is
 * settings and the Markdown body is the document, the same bargain `WORKER.md`
 * makes. Everything the convention does not derive is carried verbatim, so a
 * key a consumer claims tomorrow arrives unchanged today; everything it *does*
 * derive is refused by name, because a derived field a file can overwrite was
 * never derived.
 *
 * Two rules run through the whole walk, both shared with the other readers.
 * **Symlinks are never followed**, at any level. And a path is judged by the
 * slot it occupies, not by what it looks like.
 *
 * **One walk, two slots.** The same convention covers `resources/` and
 * `references/` at the same four levels, so this module reads a slot rather
 * than a folder name: {@link readResourcesDirectory} and
 * {@link readReferencesDirectory} are the same walk with a different slot and a
 * different refusal set. A second ~400-line reader would be a second answer to
 * "where does the convention look", and the two would drift at the first level
 * added.
 *
 * What differs between them is not the walk. A `resources/` document's body
 * becomes a stored row that then evolves; a `references/` document's file stays
 * the source, so its record carries the {@link ResourceDoc.filePath} the
 * install half points at and refuses a wider set of declarations. Both are the
 * caller's business, not this walk's.
 *
 * **One walk, two doors.** A `resources/` folder takes Markdown documents and
 * TypeScript modules side by side; the `.ts` files are the module walk's
 * (`../codegen/discover-resource-modules`), which mints their refs by the same
 * rule this one does. Neither door descends the tree itself: both iterate the
 * places `./resource-walk` yields, so they cannot disagree about where a
 * `resources/` folder may sit. What each does inside one stays its own, so a
 * non-`.md` entry is passed over here because it is not a document, not
 * because nobody meant it.
 *
 * **A resource is a file, not a folder** — which inverts the worker reader's
 * skip rule, deliberately. There, a *file* in the `workers/` slot does not
 * occupy a slot and is passed over in silence. Here a *directory* in the
 * `resources/` slot is reported, because an author arriving from `workers/`
 * will write `resources/handbook/RESOURCE.md`, and silence would leave them
 * with a tree that looks right and a team with no handbook.
 *
 * Node-only (`node:fs`), which is why it ships behind the `./loader` subpath
 * rather than the package root.
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
  parseFrontmatterYaml,
  splitFrontmatter,
} from "@flow-state-dev/orchestration";
import {
  refusedDeclarationMessage,
  refusedReferenceDeclarationMessage,
  type ResourceDoc,
} from "../manifest";
import {
  DOCUMENT_EXTENSION,
  REFERENCES_SLOT,
  RESOURCES_SLOT,
  type DocumentSlot,
} from "./resource-convention";
import { walkResourcePlaces } from "./resource-walk";
import {
  IGNORED_ENTRIES,
  type PathReport,
  classify,
  openStructuralDirectory,
  refusedSymlink,
  unreadable,
} from "./structural-directory";

/**
 * Why one thing that should have produced a document did not — the discriminant
 * on every entry in {@link ReadResourcesDirectoryResult.errors}.
 *
 * Four conditions land in one flat array, and a caller that wants to tolerate
 * one class while refusing another needs to tell them apart without matching on
 * `error.message`. Every entry still carries the `path` it was observed at.
 */
export type ResourceDocErrorKind =
  /** A structural folder — a root, a team, a `workers/` level, a worker folder, or a `resources/` slot — is a symlink or is there and could not be listed. Every document under it is missing. */
  | "unreadable-slot"
  /** A directory sits where a document file belongs — the mistake an author arriving from `workers/` or `channels/` makes. */
  | "folder-where-file-belongs"
  /** One document file did not load: an unusable name, a symlink, an unreadable file, no frontmatter, or a missing `description`. */
  | "document-load-failed"
  /** A file declares a setting the convention derives, or a `prefetchMode` it cannot have, so the document is left out. */
  | "refused-declaration";

/** One path that should have produced a document and did not. */
export type ResourceDocError = PathReport<ResourceDocErrorKind>;

/** What `readResourcesDirectory` hands back. */
export interface ReadResourcesDirectoryResult {
  /**
   * One record per document that loaded, in walk order.
   *
   * Called `documents` rather than `resources` on purpose: these are records,
   * not the L1 resource map. `resourcesFromDocs` returns that map, and the map
   * is what gets merged into a flow's own.
   */
  documents: ResourceDoc[];
  /**
   * One entry per path that should have produced a document and did not, keyed
   * by its slash-separated path relative to the root — deliberately not by a
   * ref, because a file whose name breaks the segment rules has no ref to be
   * reported under.
   *
   * Usually a file in a `resources/` slot — or a directory in one, which is the
   * mistake this convention most expects. It can also be a structural folder —
   * `org`, `org/resources`, `org/workers`, `teams`, `teams/<id>`,
   * `teams/<id>/resources`, either level's `workers/<worker>` or that worker's
   * `resources` — when that folder is refused or unreadable, because the
   * documents beneath it cannot be enumerated to be named individually.
   *
   * Collected rather than thrown, for the reason the worker reader collects: a
   * library that hands back data does not get to set an app's boot policy. That
   * makes treating a non-empty `errors` as fatal the caller's call to make
   * explicitly, and it is very often the right one.
   */
  errors: ResourceDocError[];
}

/**
 * Read every `<name>.md` in a `resources/` folder anywhere the convention puts
 * one — the org level, a team, and a worker's own folder under either of those
 * — and return one neutral record per document.
 *
 * A worker's folder is an ADDRESS, not a visibility boundary. Its documents are
 * minted under a worker-qualified ref and installed on the worker kind's flow
 * like any other; what makes one private to the seat that owns it is
 * `flowIsolation: true` in that document's own frontmatter, which this reader
 * carries verbatim and never inspects.
 *
 * Throws only when `root` itself is refused — a symlink, or a path that cannot
 * be read at all. A configured root that does not exist, or that would take the
 * walk somewhere else entirely, is a wiring mistake, not a per-document one.
 *
 * A root with neither `org/` nor `teams/` is an empty result: an app may
 * declare no documents in files, and a team, or a seat, may have no
 * `resources/` folder.
 * Everything else that goes wrong lands in `errors`, so one bad file never
 * costs an app its other documents.
 */
export async function readResourcesDirectory(
  root: string,
): Promise<ReadResourcesDirectoryResult> {
  return await readDocumentSlot(root, RESOURCES_SLOT, refusedDeclarationMessage, false);
}

/**
 * Read every `<name>.md` in a `references/` folder anywhere the convention puts
 * one, and return one neutral record per document — each carrying the
 * {@link ResourceDoc.filePath} it was read from.
 *
 * The same walk as {@link readResourcesDirectory}, at the same four levels,
 * minting refs into the same namespace. Two things differ, and both belong to
 * what a reference IS rather than to where it sits:
 *
 * - **The record carries its file path**, because the install half points the
 *   resource at the file instead of copying the body into a row. The body is
 *   still parsed here, because `description` is required of every file in this
 *   dialect and a file that cannot be parsed is a load failure either way.
 * - **A wider declaration refusal.** `writable:`, `llmWritable:` and `render:`
 *   are derived for a reference and refused by name
 *   ({@link refusedReferenceDeclarationMessage}), because the folder carries
 *   the seal and a file that could unseal itself would make the folder a
 *   suggestion.
 *
 * Errors, symlink discipline and the collect-don't-throw bargain are the walk's
 * and are identical. Throws only when `root` itself is refused.
 *
 * @param root The workforce tree — the folder holding `org/` and `teams/`.
 * @returns One record per reference that loaded, and one entry per path that
 *   should have produced one and did not.
 */
export async function readReferencesDirectory(
  root: string,
): Promise<ReadResourcesDirectoryResult> {
  return await readDocumentSlot(root, REFERENCES_SLOT, refusedReferenceDeclarationMessage, true);
}

/**
 * The reader both slots are. Parameterized by the slot it looks in and the
 * declaration refusal that slot imposes; everything else — the four places, the
 * symlink rule, the directory-in-a-documents-slot report — is the convention's
 * and is shared by construction rather than by two copies kept in step. Where
 * the places are is `./resource-walk`'s, which the module walk rides too; this
 * reader opens its slot at each one, in the order the directory lists workers.
 */
async function readDocumentSlot(
  root: string,
  slot: DocumentSlot,
  refuseDeclaration: (declared: Record<string, unknown>) => string | undefined,
  carriesFilePath: boolean,
): Promise<ReadResourcesDirectoryResult> {
  const documents: ResourceDoc[] = [];
  const errors: ResourceDocError[] = [];

  for await (const step of walkResourcePlaces(root, { workerOrder: (entries) => entries })) {
    if (step.type === "refused") {
      errors.push({ path: step.path, error: step.error, kind: "unreadable-slot" });
      continue;
    }
    // A refused worker folder is named by its folder name here; the module
    // walk names it by its full path. Both are as they were, so neither moves.
    if (step.type === "worker-refused") {
      errors.push({
        path: step.path,
        error: step.refusal(step.workerName),
        kind: "unreadable-slot",
      });
      continue;
    }
    await readSlot(path.join(step.dir, slot), `${step.path}/${slot}`, {
      documents,
      errors,
      slot,
      refuseDeclaration,
      carriesFilePath,
      mintRef: step.mintRef,
    });
  }

  return { documents, errors };
}

/** Everything reading one documents slot needs that differs between roots. */
interface SlotContext {
  documents: ResourceDoc[];
  errors: ResourceDocError[];
  /** Which slot is being read — the folder name, and what a refusal names. */
  slot: DocumentSlot;
  /**
   * Why this slot refuses a declaration, or `undefined` when it does not.
   *
   * Passed rather than branched on {@link SlotContext.slot}, so the two slots'
   * refusal sets stay one export each in `../manifest` and this walk stays a
   * walk.
   */
  refuseDeclaration: (declared: Record<string, unknown>) => string | undefined;
  /**
   * Whether the record carries the absolute path it was read from.
   *
   * **True for `references/` only, and that is not symmetry lost — it is the
   * mutable path left alone.** A reference IS its file, so the path is what the
   * install half installs. A `resources/` document's source is its stored row,
   * so a path on that record would be a field nothing reads, and it would
   * change what the reader hands back for every tree that has one. Two records
   * read from different roots would stop comparing equal, which is exactly how
   * the existing suite caught this being added everywhere.
   */
  carriesFilePath: boolean;
  /** Mint this slot's ref for a document name. Throws on a bad segment. */
  mintRef: (name: string) => string;
}

/**
 * Read one documents slot — `resources/` or `references/`, whichever
 * {@link SlotContext.slot} names. An absent slot is silent — a team may have no
 * documents — and a slot that is there and cannot be walked is reported under
 * its own path, because the documents beneath it cannot be named individually.
 */
async function readSlot(slotDir: string, slotPath: string, ctx: SlotContext): Promise<void> {
  const slot = await openStructuralDirectory(slotDir, slotPath);
  if (slot.refusal !== undefined) {
    ctx.errors.push({ path: slotPath, error: slot.refusal.error, kind: "unreadable-slot" });
  }
  if (slot.entries === undefined) return;

  for (const entryName of slot.entries) {
    if (IGNORED_ENTRIES.has(entryName)) continue;

    const entryPath = `${slotPath}/${entryName}`;
    const entry = await classify(path.join(slotDir, entryName));

    if (entry.kind === "absent") continue;

    // The inversion of the worker reader's rule, and the loudest error in this
    // convention. See the module header for why it is reported, not skipped.
    if (entry.kind === "directory") {
      ctx.errors.push({
        path: entryPath,
        error: new Error(
          `"${entryName}" is a directory. A resource is a file, not a folder — write the ` +
            `document as "${entryName}${DOCUMENT_EXTENSION}" in this ${ctx.slot}/ ` +
            `folder instead.`,
        ),
        kind: "folder-where-file-belongs",
      });
      continue;
    }

    if (entry.kind === "symlink") {
      ctx.errors.push({
        path: entryPath,
        error: refusedSymlink("resource file", entryName),
        kind: "document-load-failed",
      });
      continue;
    }

    if (entry.kind === "unreadable") {
      ctx.errors.push({
        path: entryPath,
        error: unreadable("Resource file", entryName, entry.error),
        kind: "document-load-failed",
      });
      continue;
    }

    // Not a document, so not this reader's. The skip is deliberate and stays a
    // skip, but it no longer means "nobody meant this file": a `.ts` beside the
    // Markdown is a resource module, read by the other door
    // (`../codegen/discover-resource-modules`) and refused by name there when
    // it cannot be one. Passing it over here is how the two doors stay two
    // readers over one folder. A stray `notes.txt` or an image belongs to
    // neither, and is the one thing this branch still drops in silence.
    if (!entryName.endsWith(DOCUMENT_EXTENSION)) continue;

    let loaded: ResourceDoc;
    try {
      const name = entryName.slice(0, -DOCUMENT_EXTENSION.length);
      // Identity first: a document whose segments break the rules has no ref to
      // be keyed under, so there is nothing to be gained by reading its file.
      const ref = ctx.mintRef(name);
      const filePath = path.resolve(slotDir, entryName);
      const text = await fs.readFile(filePath, "utf8");
      const { declared, body } = parseResourceMd(text, entryName);
      // The path rides only on a record whose slot needs it. See
      // `SlotContext.carriesFilePath` for why that is not an asymmetry to tidy.
      loaded = ctx.carriesFilePath ? { ref, declared, body, filePath } : { ref, declared, body };
    } catch (err) {
      ctx.errors.push({ path: entryPath, error: err as Error, kind: "document-load-failed" });
      continue;
    }

    // A separate condition for a caller, so it is a separate branch: a file
    // that could not be read is an author's typo, and a file declaring what the
    // convention derives is an author's misunderstanding. Checked here rather
    // than inside the parse so the two stay tellable apart by control flow.
    const refused = ctx.refuseDeclaration(loaded.declared);
    if (refused !== undefined) {
      ctx.errors.push({
        path: entryPath,
        error: new Error(`"${entryName}" ${refused}`),
        kind: "refused-declaration",
      });
      continue;
    }

    ctx.documents.push(loaded);
  }
}

/**
 * Parse a document file into its declared settings and its body. Shares the
 * `WORKER.md`/`SKILL.md` frontmatter dialect deliberately: these are the
 * convention files an author writes by hand, and a second dialect would mean
 * learning one teaches the wrong thing about the others.
 *
 * `description` is required and everything else is carried verbatim. The
 * settings the convention derives are refused by the caller, which reports them
 * as their own condition.
 */
function parseResourceMd(
  text: string,
  fileName: string,
): { declared: Record<string, unknown>; body: string } {
  const { yaml, body } = splitFrontmatter(text);
  if (yaml.trim().length === 0) {
    throw new Error(
      `"${fileName}" has no frontmatter — a resource file needs at least a \`description\``,
    );
  }

  const declared = parseFrontmatterYaml(yaml);
  const description = declared["description"];
  if (typeof description !== "string" || description.trim().length === 0) {
    throw new Error(`"${fileName}" must declare a non-empty \`description\``);
  }

  return { declared, body };
}
