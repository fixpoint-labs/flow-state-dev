/**
 * Door B's walk: the TypeScript a team put in `resources/`, beside the Markdown.
 *
 * A `resources/` folder takes documents and modules both. The Markdown door
 * (`../loader/read-resources-directory`) reads the `.md` files; this reads the
 * `.ts` ones, under the same refs, from the same four places — the
 * organisation's folder, a team's, and either level's workers' own. Until now a
 * `.ts` file there did nothing at all: no document, no error, no signal.
 *
 * A **separate reader** over the shared walk, not a parameter on the Markdown
 * one — one reader holding two conventions is the mega-loader the walk
 * primitives were extracted to prevent. What the two doors are not allowed to
 * disagree about is where they look and what a file is called. So neither
 * descends the tree itself: both iterate the places `../loader/resource-walk`
 * yields, which also owns the list of places `fsdev gen` prints, and both take
 * their folder names, their document extension and their ref rule from
 * `../loader/resource-convention`. What this door does inside a folder, and the
 * order it visits workers in, stay its own.
 *
 * It reads the **tree**, never the modules in it, exactly as the locked-folder
 * walk beside it does. Whether a module exports something usable — and whether
 * a module at a worker's own root is a capability, which it may not be — is
 * caught by the app's own typecheck against the rendered map, because the
 * rendered map is typed. Opening a file to find out would put a TypeScript
 * runtime inside a published CLI, and would still answer for the source rather
 * than for what the app's bundler resolves.
 *
 * Refusals are collected rather than thrown where they are met, so one run
 * names all of them and an author fixes a tree once. The caller
 * (`discoverWorkforceCode`) throws them together with the locked folders', and
 * nothing is generated when either has anything to say.
 *
 * Node-only: it walks a directory, so it sits behind a subpath rather than on
 * the package root.
 */

import path from "node:path";
import {
  DOCUMENT_EXTENSION,
  IGNORED_ENTRIES,
  REFERENCES_SLOT,
  RESOURCES_SLOT,
  classify,
  openStructuralDirectory,
  refusedSymlink,
  siblingSlotPath,
  unreadable,
} from "../loader";
import { walkResourcePlaces } from "../loader/resource-walk";
import { typescriptExtension } from "./typescript-module";

/** One module the walk found, and where it will be imported from. */
export interface DiscoveredResourceModule {
  /** The ref it registers under — minted exactly as a document of that name in that folder would be. */
  ref: string;
  /** Slash-separated path under the workforce root, e.g. `teams/engineering/resources/research.ts`. Orders the output. */
  path: string;
  /** The specifier the generated module imports it by, e.g. `./teams/engineering/resources/research`. */
  importPath: string;
  /**
   * Whether it sat in one worker's OWN `resources/` folder, rather than the
   * organisation's or a team's.
   *
   * The one thing about a module's position the ref does not already carry, and
   * the one thing anything downstream asks: such a module may be a resource and
   * may **not** be a capability, because every seat of a kind shares that kind's
   * capabilities and one installed from a single worker's folder would quietly
   * change every other seat.
   */
  atWorkerRoot: boolean;
}

/** What the module walk produced. Problems are handed back rather than thrown — see the module header. */
export interface ResourceModuleDiscovery {
  /** Every module found, ordered by {@link DiscoveredResourceModule.path}. */
  modules: DiscoveredResourceModule[];
  /** Each refusal, in the order the walk met it. */
  problems: string[];
}

/** Everything reading one `resources/` slot needs that differs between the four places one can be. */
interface SlotContext {
  modules: DiscoveredResourceModule[];
  problems: string[];
  /** Mint this slot's ref for a module's basename. Throws on a bad segment. */
  mintRef: (name: string) => string;
  atWorkerRoot: boolean;
  /** ref → the path that already claimed it, across the whole walk. */
  claimed: Map<string, string>;
}

/**
 * Walk every `resources/` folder the convention reads and return the modules in
 * them.
 *
 * The root is opened by the walk rather than left to the caller, for the
 * reason the locked-folder walk opens it: a symlinked root would put the whole
 * walk outside the configured tree.
 *
 * @param root Path to the app's `workforce/` directory.
 * @returns Every discovered module, ordered by path, and every refusal.
 * @throws If the root is symlinked, missing or unreadable.
 */
export async function discoverResourceModules(root: string): Promise<ResourceModuleDiscovery> {
  const modules: DiscoveredResourceModule[] = [];
  const problems: string[] = [];
  const claimed = new Map<string, string>();

  // Every refusal names the path it was met at inside its own message — the
  // shared wordings take the path as the thing they name — so the list is flat
  // strings rather than the loader's `{ path, error }` records. That is the
  // locked-folder walk's shape, and both halves land in one thrown list.
  // Workers are visited sorted, so problems come in one order on any machine.
  const places = walkResourcePlaces(root, { workerOrder: (entries) => [...entries].sort() });
  for await (const step of places) {
    if (step.type === "refused") {
      problems.push(step.error.message);
      continue;
    }
    // A refused worker folder is named by its full path here; the Markdown door
    // names it by its folder name. Both are as they were, so neither moves.
    if (step.type === "worker-refused") {
      problems.push(step.refusal(step.path).message);
      continue;
    }
    await readSlot(path.join(step.dir, RESOURCES_SLOT), `${step.path}/${RESOURCES_SLOT}`, {
      modules,
      problems,
      claimed,
      atWorkerRoot: step.atWorkerRoot,
      mintRef: step.mintRef,
    });
  }

  // Ordered by path rather than by the order a directory listed, so a tree that
  // has not changed renders byte-identically on any machine.
  modules.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { modules, problems };
}

/**
 * Read one `resources/` slot. An absent slot is silent — a team may have no
 * resources at all — and a slot that is there and cannot be walked is reported
 * under its own path, because the modules beneath it cannot be named
 * individually.
 *
 * Only entries that *look like* a module are classified, let alone judged.
 * Everything else in the folder belongs to the Markdown door or to nobody: a
 * `.md`, a `notes.txt`, an image, and the directory an author wrote where a
 * document belongs, which Door A already reports. Door B refusing those too
 * would make `fsdev gen` the enforcer of a rule that is not its, and would fail
 * a build over a tree the convention already tolerates.
 */
async function readSlot(slotDir: string, slotPath: string, ctx: SlotContext): Promise<void> {
  const slot = await openStructuralDirectory(slotDir, slotPath);
  if (slot.refusal !== undefined) ctx.problems.push(slot.refusal.error.message);
  if (slot.entries === undefined) return;

  const entries = [...slot.entries].sort();
  // The document basenames sitting beside the modules, from the listing the
  // walk already has. A document and a module of one name in one folder mint
  // ONE ref between them, and a silent winner is the failure this convention
  // exists to remove — so the pair is refused here, where both names are in
  // hand, rather than by a second walk of Door A's tree.
  // Basename -> the path of the document file claiming it, so the refusal names
  // the file an author has to go and change.
  const documents = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.endsWith(DOCUMENT_EXTENSION)) continue;
    documents.set(entry.slice(0, -DOCUMENT_EXTENSION.length), `${slotPath}/${entry}`);
  }

  // **And the `references/` slot beside it**, which mints into the SAME
  // namespace from a different folder. `references/handbook.md` and
  // `resources/handbook.ts` at one level are one ref between them, exactly as
  // two files in this folder are — the only difference is that the pair sits
  // one directory apart, so the listing above cannot see it.
  //
  // Read here rather than by teaching the whole walk a second slot: modules
  // live in `resources/` only, so what this door needs from `references/` is
  // its basenames and nothing else. An absent or unreadable sibling is silent —
  // the Markdown door reports that folder's own problems, and reporting them
  // here too would double every entry in a tree with one bad slot. A resources/
  // file wins the map only because it was inserted first; either path names a
  // real claimant, and the pair is refused whichever is quoted.
  const referenceSlotPath = siblingSlotPath(slotPath, RESOURCES_SLOT, REFERENCES_SLOT);
  const siblings = await openStructuralDirectory(
    path.join(path.dirname(slotDir), REFERENCES_SLOT),
    referenceSlotPath,
  );
  for (const entry of siblings.entries ?? []) {
    if (!entry.endsWith(DOCUMENT_EXTENSION)) continue;
    const name = entry.slice(0, -DOCUMENT_EXTENSION.length);
    if (!documents.has(name)) documents.set(name, `${referenceSlotPath}/${entry}`);
  }

  for (const entryName of entries) {
    if (IGNORED_ENTRIES.has(entryName)) continue;

    const extension = typescriptExtension(entryName);
    if (extension === undefined) continue;

    const entryPath = `${slotPath}/${entryName}`;
    const entry = await classify(path.join(slotDir, entryName));

    if (entry.kind === "symlink") {
      ctx.problems.push(refusedSymlink("resource module", entryPath).message);
      continue;
    }
    if (entry.kind === "unreadable") {
      ctx.problems.push(unreadable("Resource module", entryPath, entry.error).message);
      continue;
    }
    // A folder named like a module is the one directory here Door B owns: it
    // claims to be one, and the import it would be given resolves to nothing.
    if (entry.kind === "directory") {
      ctx.problems.push(
        `"${entryPath}" is a directory — a resource module is a file, one level ` +
          `deep in a ${RESOURCES_SLOT}/ folder`,
      );
      continue;
    }
    // A socket or a FIFO: not a declaration, and not a mistake either.
    if (entry.kind === "absent") continue;

    const name = entryName.slice(0, entryName.length - extension.length);

    let ref: string;
    try {
      // Identity first: a module whose segments break the rules has no ref to
      // be registered under, and the folders above it are validated with it.
      ref = ctx.mintRef(name);
    } catch (error) {
      ctx.problems.push(`"${entryPath}" — ${(error as Error).message}`);
      continue;
    }

    const claimant = documents.get(name);
    if (claimant !== undefined) {
      ctx.problems.push(
        `"${entryPath}" and "${claimant}" both declare ` +
          `"${ref}" — a document and a module cannot share a ref`,
      );
      continue;
    }

    const already = ctx.claimed.get(ref);
    if (already !== undefined) {
      ctx.problems.push(
        `"${entryPath}" and "${already}" both declare "${ref}" — one ref, one module`,
      );
      continue;
    }
    ctx.claimed.set(ref, entryPath);

    ctx.modules.push({
      ref,
      path: entryPath,
      importPath: `./${slotPath}/${name}`,
      atWorkerRoot: ctx.atWorkerRoot,
    });
  }
}
