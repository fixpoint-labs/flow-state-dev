/**
 * The resources convention loader — read a workforce tree's documents into
 * neutral records.
 *
 * Walks `<root>/org/resources/` and `<root>/teams/<teamId>/resources/`, reads
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
import { refusedDeclarationMessage, type ResourceDoc } from "../manifest";
import { validateSegment } from "./segments";
import {
  type PathReport,
  classify,
  openStructuralDirectory,
  refusedSymlink,
  unreadable,
} from "./structural-directory";

/** Filenames that are never a document — editor and OS droppings. */
const IGNORED_ENTRIES = new Set([".DS_Store", "Thumbs.db"]);

/** The slot a document sits in, under either root. */
const RESOURCES_SLOT = "resources";

/** The extension a document is written in. Anything else is not a document. */
const DOCUMENT_EXTENSION = ".md";

/**
 * Why one thing that should have produced a document did not — the discriminant
 * on every entry in {@link ReadResourcesDirectoryResult.errors}.
 *
 * Four conditions land in one flat array, and a caller that wants to tolerate
 * one class while refusing another needs to tell them apart without matching on
 * `error.message`. Every entry still carries the `path` it was observed at.
 */
export type ResourceDocErrorKind =
  /** A structural folder — a root, a team, or a `resources/` slot — is a symlink or is there and could not be listed. Every document under it is missing. */
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
   * `org`, `org/resources`, `teams`, `teams/<id>`, `teams/<id>/resources` —
   * when that folder is refused or unreadable, because the documents beneath it
   * cannot be enumerated to be named individually.
   *
   * Collected rather than thrown, for the reason the worker reader collects: a
   * library that hands back data does not get to set an app's boot policy. That
   * makes treating a non-empty `errors` as fatal the caller's call to make
   * explicitly, and it is very often the right one.
   */
  errors: ResourceDocError[];
}

/**
 * Read every `<root>/org/resources/<name>.md` and
 * `<root>/teams/<teamId>/resources/<name>.md`, and return one neutral record
 * per document.
 *
 * Throws only when `root` itself is refused — a symlink, or a path that cannot
 * be read at all. A configured root that does not exist, or that would take the
 * walk somewhere else entirely, is a wiring mistake, not a per-document one.
 *
 * A root with neither `org/` nor `teams/` is an empty result: an app may
 * declare no documents in files, and a team may have no `resources/` folder.
 * Everything else that goes wrong lands in `errors`, so one bad file never
 * costs an app its other documents.
 */
export async function readResourcesDirectory(
  root: string,
): Promise<ReadResourcesDirectoryResult> {
  const documents: ResourceDoc[] = [];
  const errors: ResourceDocError[] = [];

  // The root is classified before it is listed, for the reason every nested
  // structural folder is: a bare `readdir` follows a symlink, and a symlinked
  // root would load the whole tree from somewhere the caller never configured.
  // It throws rather than landing in `errors` because the root is the one level
  // whose failure is a wiring mistake, not a document-shaped one.
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

  // The org root. Opened structurally rather than merely classified, so a
  // symlinked or unreadable `org/` is reported the way `teams/` is.
  const org = await openStructuralDirectory(path.join(root, "org"), "org");
  if (org.refusal !== undefined) {
    errors.push({ path: "org", error: org.refusal.error, kind: "unreadable-slot" });
  }
  if (org.entries !== undefined) {
    await readSlot(path.join(root, "org", RESOURCES_SLOT), `org/${RESOURCES_SLOT}`, {
      documents,
      errors,
      mintRef: (name) => mintResourceRef(undefined, name),
    });
  }

  const teams = await openStructuralDirectory(path.join(root, "teams"), "teams");
  if (teams.refusal !== undefined) {
    errors.push({ path: "teams", error: teams.refusal.error, kind: "unreadable-slot" });
  }
  if (teams.entries === undefined) return { documents, errors };

  for (const teamId of teams.entries) {
    if (IGNORED_ENTRIES.has(teamId)) continue;

    const teamDir = path.join(root, "teams", teamId);
    const teamPath = `teams/${teamId}`;
    const team = await classify(teamDir);
    if (team.kind === "symlink") {
      errors.push({
        path: teamPath,
        error: refusedSymlink("team folder", teamId),
        kind: "unreadable-slot",
      });
      continue;
    }
    if (team.kind === "unreadable") {
      errors.push({
        path: teamPath,
        error: unreadable("Team folder", teamId, team.error),
        kind: "unreadable-slot",
      });
      continue;
    }
    if (team.kind !== "directory") continue;

    await readSlot(path.join(teamDir, RESOURCES_SLOT), `${teamPath}/${RESOURCES_SLOT}`, {
      documents,
      errors,
      mintRef: (name) => mintResourceRef(teamId, name),
    });
  }

  return { documents, errors };
}

/** Everything reading one `resources/` slot needs that differs between roots. */
interface SlotContext {
  documents: ResourceDoc[];
  errors: ResourceDocError[];
  /** Mint this slot's ref for a document name. Throws on a bad segment. */
  mintRef: (name: string) => string;
}

/**
 * Read one `resources/` slot. An absent slot is silent — a team may have no
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
            `document as "${entryName}${DOCUMENT_EXTENSION}" in this ${RESOURCES_SLOT}/ ` +
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

    // A stray `notes.txt` or an image is not a document anyone declared. Unlike
    // a directory, it carries no sign that someone meant it to be one.
    if (!entryName.endsWith(DOCUMENT_EXTENSION)) continue;

    let loaded: { ref: string; declared: Record<string, unknown>; body: string };
    try {
      const name = entryName.slice(0, -DOCUMENT_EXTENSION.length);
      // Identity first: a document whose segments break the rules has no ref to
      // be keyed under, so there is nothing to be gained by reading its file.
      const ref = ctx.mintRef(name);
      const text = await fs.readFile(path.join(slotDir, entryName), "utf8");
      const { declared, body } = parseResourceMd(text, entryName);
      loaded = { ref, declared, body };
    } catch (err) {
      ctx.errors.push({ path: entryPath, error: err as Error, kind: "document-load-failed" });
      continue;
    }

    // A separate condition for a caller, so it is a separate branch: a file
    // that could not be read is an author's typo, and a file declaring what the
    // convention derives is an author's misunderstanding. Checked here rather
    // than inside the parse so the two stay tellable apart by control flow.
    const refused = refusedDeclarationMessage(loaded.declared);
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

/**
 * Mint a document's whole identity from where it sits: `"<name>"` at the org
 * level, `"teams/<teamId>/<name>"` for a team's.
 *
 * The one place this string is built. Team-qualified so two teams can each have
 * a `handbook` without coordinating names, and **path-joined, not dot-joined**:
 * the atlas fixes this key as a path, so a dotted ref would put the same
 * logical document at a different org storage row from anything else following
 * the atlas. The worker id's reason for dot-joining does not carry across — a
 * worker id becomes a flow instance id and a slashed one fails to route, while
 * a resource ref is a storage-key namespace and never routes.
 *
 * Throws when a segment breaks the rules, naming the rule.
 */
function mintResourceRef(teamId: string | undefined, name: string): string {
  if (teamId === undefined) {
    validateSegment(name, "Document");
    return name;
  }
  validateSegment(teamId, "Team");
  validateSegment(name, "Document");
  return `teams/${teamId}/${name}`;
}
