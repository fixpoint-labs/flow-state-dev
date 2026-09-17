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
import {
  DOCUMENT_EXTENSION,
  RESOURCES_SLOT,
  WORKERS_LEVEL,
  mintResourceRef,
} from "./resource-convention";
import {
  IGNORED_ENTRIES,
  type PathReport,
  classify,
  openRoot,
  openStructuralDirectory,
  refusedSymlink,
  unreadable,
  walkTeams,
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
  const documents: ResourceDoc[] = [];
  const errors: ResourceDocError[] = [];

  await openRoot(root);

  /** File a structural refusal met on the way to a slot, at either root. */
  const report = (at: string, error: Error): void => {
    errors.push({ path: at, error, kind: "unreadable-slot" });
  };

  // The org root. Opened structurally rather than merely classified, so a
  // symlinked or unreadable `org/` is reported the way `teams/` is. It stays
  // here rather than moving into the shared walk: it has one caller, and a
  // shared open would hand the channels reader an `org/` scope it is not
  // allowed to use.
  const org = await openStructuralDirectory(path.join(root, "org"), "org");
  if (org.refusal !== undefined) {
    report("org", org.refusal.error);
  }
  if (org.entries !== undefined) {
    await readSlot(path.join(root, "org", RESOURCES_SLOT), `org/${RESOURCES_SLOT}`, {
      documents,
      errors,
      mintRef: (name) => mintResourceRef(undefined, undefined, name),
    });
    // Org workers are rare shared-infra seats, and their documents load for the
    // reason a team worker's do. Their ref drops `org/`, exactly as an org
    // document's does. No seat can be hired at that address yet — the roster
    // reader passes over `org/workers/` in silence and a worker id requires a
    // team — which is a larger gap than this reader closes, and not a reason
    // for the documents to go on being unread.
    await walkWorkers(path.join(root, "org"), "org", undefined, { documents, errors });
  }

  for await (const team of walkTeams(root, report)) {
    await readSlot(path.join(team.dir, RESOURCES_SLOT), `${team.path}/${RESOURCES_SLOT}`, {
      documents,
      errors,
      mintRef: (name) => mintResourceRef(team.id, undefined, name),
    });
    await walkWorkers(team.dir, team.path, team.id, { documents, errors });
  }

  return { documents, errors };
}

/**
 * Read every worker's `resources/` slot under one parent — `org/` or a team
 * folder — and collect what they hold.
 *
 * One function called twice rather than two copies: the two parents differ only
 * in the team id handed to the ref minter, and a second copy is how the levels
 * of a tree start disagreeing about what a symlink means.
 *
 * This level is the worker reader's rule, not this reader's: a `workers/` level
 * holds folders, so a *file* in it occupies no slot and is passed over in
 * silence. Inside a worker's `resources/` slot the rule inverts back, because
 * that is a documents slot and a directory in one is an author's mistake worth
 * reporting.
 *
 * What it does NOT do is open `WORKER.md`. Whether a folder describes a seat is
 * the roster reader's question, answered separately and already reported by the
 * reader whose job it is; this one is answering a question about a file.
 */
async function walkWorkers(
  parentDir: string,
  parentPath: string,
  teamId: string | undefined,
  ctx: { documents: ResourceDoc[]; errors: ResourceDocError[] },
): Promise<void> {
  const workersPath = `${parentPath}/${WORKERS_LEVEL}`;
  const slots = await openStructuralDirectory(
    path.join(parentDir, WORKERS_LEVEL),
    workersPath,
  );
  if (slots.refusal !== undefined) {
    ctx.errors.push({
      path: workersPath,
      error: slots.refusal.error,
      kind: "unreadable-slot",
    });
  }
  if (slots.entries === undefined) return;

  for (const workerName of slots.entries) {
    if (IGNORED_ENTRIES.has(workerName)) continue;

    // No name is special at this level — including `resources`. A folder here
    // is judged by the slot it occupies, not by what it looks like, which is
    // this module's second rule and the rule the other two readers already
    // apply: `readWorkforceDirectory` hires `teams/<t>/workers/resources/` off
    // its `WORKER.md`, and `readSeatSkills` reads that seat's own `skills/`.
    // Skipping the name here would leave exactly one seat in the tree whose
    // documents are read by nothing and reported by nothing — the silent drop
    // this convention exists to remove, reintroduced one level down.
    //
    // It would also buy nothing. The author who writes a document one level too
    // high, at `workers/resources/stray.md`, is not rescued by a skip: that file
    // sits beside a `resources/` slot rather than in one, so the walk passes it
    // over either way. What the skip cost was a real seat's documents.
    const workerDir = path.join(parentDir, WORKERS_LEVEL, workerName);
    const entryPath = `${workersPath}/${workerName}`;
    const slot = await classify(workerDir);

    // A file under `workers/` does not occupy a worker slot — a slot is a
    // directory — so it is skipped rather than reported, the way the roster
    // reader skips one.
    if (slot.kind === "absent" || slot.kind === "file") continue;

    // Both refusals are structural: the folder is there and the walk will not
    // go through it, so every document under it is missing and none of them can
    // be named individually. `absent` and `unreadable` stay apart here for the
    // reason they do at every other level — folded together, a folder we cannot
    // stat is skipped in silence and its documents disappear with `errors`
    // empty for a caller's fatal check to look at.
    if (slot.kind === "symlink") {
      ctx.errors.push({
        path: entryPath,
        error: refusedSymlink("worker folder", workerName),
        kind: "unreadable-slot",
      });
      continue;
    }
    if (slot.kind === "unreadable") {
      ctx.errors.push({
        path: entryPath,
        error: unreadable("Worker folder", workerName, slot.error),
        kind: "unreadable-slot",
      });
      continue;
    }

    await readSlot(path.join(workerDir, RESOURCES_SLOT), `${entryPath}/${RESOURCES_SLOT}`, {
      documents: ctx.documents,
      errors: ctx.errors,
      mintRef: (name) => mintResourceRef(teamId, workerName, name),
    });
  }
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
