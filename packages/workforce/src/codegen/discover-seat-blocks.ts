/**
 * Door C's walk: the `blocks/` folders inside the team tree, and the folders
 * that look like them and are not.
 *
 * Three levels register a block name for a seat, and a name in a `WORKER.md`'s
 * `tools:` resolves through them nearest first — the worker's own folder, its
 * team's, then the app's catalog, which is `workforce/blocks/` and belongs to
 * the locked-folder walk next door. Registration is what a folder does;
 * granting use is still the seat's `tools:` line. This walk collapses the two
 * team-tree levels per seat, because resolution is a property of the tree and
 * nothing scans a folder while an app runs — a bundled deploy has to register
 * exactly what a local one does.
 *
 * A **separate reader** over the shared walk primitives, like Door B beside it,
 * rather than a parameter on either: one reader holding three conventions is
 * the mega-loader those primitives were extracted to prevent.
 *
 * It reads the **tree**, never the modules in it. Whether a file exports a
 * usable block is caught by the app's own typecheck against the rendered map,
 * which is typed, and whether its exported block agrees with its file name is
 * caught by `hireWorkforce`, which holds both names.
 *
 * **Two refusals rather than two silences.** A `blocks/` folder somewhere no
 * seat can see it, and a `tools/` folder anywhere, are the two shapes an author
 * writes by guessing. Both are named with the fix. Refusals are collected and
 * handed back; the caller throws them together with the other walks', and
 * nothing is generated when any of them has something to say.
 *
 * Node-only: it walks a directory, so it sits behind a subpath rather than on
 * the package root.
 */

import path from "node:path";
import {
  IGNORED_ENTRIES,
  WORKERS_LEVEL,
  classify,
  openRoot,
  openStructuralDirectory,
  refusedSymlink,
  unreadable,
  validateSegment,
  walkTeams,
} from "../loader";

/** The folder a block file sits in, at every level it may sit at. */
export const BLOCKS_SLOT = "blocks";

/**
 * The folder name an author is most likely to guess, and the one this
 * convention does not use. Reported wherever it appears rather than ignored.
 */
const REFUSED_SLOT = "tools";

/**
 * The two places inside the team tree a `blocks/` folder may sit, as the
 * command reports them. `workforce/blocks/` is the third place and belongs to
 * the locked-folder walk, which reports it under its own name.
 *
 * Patterns rather than the concrete folders walked, for the reason Door B's
 * are: what an author wants to read back is where the convention looks.
 */
export const SEAT_BLOCK_SLOT_PATTERNS: readonly string[] = Object.freeze([
  `teams/*/${BLOCKS_SLOT}`,
  `teams/*/${WORKERS_LEVEL}/*/${BLOCKS_SLOT}`,
]);

/** Extensions that denote a TypeScript module. Anything else in the folder is a note beside the code. */
const TYPESCRIPT_EXTENSIONS = [".ts", ".tsx"];

/** One block registered for one seat. A team-level file produces one of these per seat on the team. */
export interface DiscoveredSeatBlock {
  /** The seat it is registered for — `<team>.<worker>`, the worker id. */
  seat: string;
  /** The basename without its extension, which is the name the seat's `tools:` resolves. */
  name: string;
  /** Which level the file sits at. A worker's own shadows its team's of the same name. */
  level: "team" | "worker";
  /** Slash-separated path under the workforce root. Orders the output. */
  path: string;
  /** The specifier the generated module imports it by. One per FILE, however many seats share it. */
  importPath: string;
}

/** What the seat-block walk produced. Problems are handed back rather than thrown — see the module header. */
export interface SeatBlockDiscovery {
  /** Every registration, ordered by {@link DiscoveredSeatBlock.path} then seat. */
  seatBlocks: DiscoveredSeatBlock[];
  /** Each refusal, in the order the walk met it. */
  problems: string[];
}

/** The TypeScript extension this entry carries, or `undefined` when it is not a TypeScript module. */
function typescriptExtension(entry: string): string | undefined {
  return TYPESCRIPT_EXTENSIONS.find((extension) => entry.endsWith(extension));
}

/** One file found in a `blocks/` slot, before it is attached to any seat. */
interface SlotFile {
  name: string;
  path: string;
  importPath: string;
}

/**
 * Read one `blocks/` slot, one level deep.
 *
 * An absent slot is silent — most folders have none. A slot that is there and
 * cannot be walked is reported under its own path, because the files beneath it
 * cannot be named individually.
 */
async function readBlocksSlot(
  slotDir: string,
  slotPath: string,
  problems: string[],
): Promise<SlotFile[]> {
  const slot = await openStructuralDirectory(slotDir, slotPath);
  if (slot.refusal !== undefined) problems.push(slot.refusal.error.message);
  if (slot.entries === undefined) return [];

  const files: SlotFile[] = [];
  for (const entryName of [...slot.entries].sort()) {
    if (IGNORED_ENTRIES.has(entryName)) continue;

    const entryPath = `${slotPath}/${entryName}`;
    const entry = await classify(path.join(slotDir, entryName));

    if (entry.kind === "symlink") {
      problems.push(refusedSymlink("block", entryPath).message);
      continue;
    }
    if (entry.kind === "unreadable") {
      problems.push(unreadable("Block", entryPath, entry.error).message);
      continue;
    }
    // A folder here claims to be a block and the import it would be given
    // resolves to nothing. Reported before the extension test, because a
    // directory has no extension to test.
    if (entry.kind === "directory") {
      problems.push(
        `"${entryPath}" is a directory — a ${BLOCKS_SLOT}/ folder holds one file per block, ` +
          `one level deep. Nesting would make the basename ambiguous`,
      );
      continue;
    }
    // A socket or a FIFO: not a declaration, and not a mistake either.
    if (entry.kind === "absent") continue;

    const extension = typescriptExtension(entryName);
    // A README, a fixture, a note beside the code.
    if (extension === undefined) continue;

    const name = entryName.slice(0, entryName.length - extension.length);
    try {
      validateSegment(name, "Block");
    } catch (error) {
      problems.push(`"${entryPath}" — ${(error as Error).message}`);
      continue;
    }

    files.push({ name, path: entryPath, importPath: `./${slotPath}/${name}` });
  }
  return files;
}

/** Report a `blocks/` folder somewhere no seat can see it, naming the three places one may sit. */
async function refuseStrayBlocksFolder(
  parentDir: string,
  parentPath: string,
  problems: string[],
): Promise<void> {
  const at = `${parentPath}/${BLOCKS_SLOT}`;
  const found = await classify(path.join(parentDir, BLOCKS_SLOT));
  if (found.kind !== "directory") return;
  problems.push(
    `"${at}" is a ${BLOCKS_SLOT}/ folder at a level no seat reads. A block is registered for ` +
      `every worker from \`workforce/${BLOCKS_SLOT}/\` (the app's catalog), for one team's seats ` +
      `from \`teams/<team>/${BLOCKS_SLOT}/\`, and for one seat from ` +
      `\`teams/<team>/${WORKERS_LEVEL}/<worker>/${BLOCKS_SLOT}/\`. Move it to one of those`,
  );
}

/** Report a `tools/` folder, naming the convention's own folder. */
async function refuseToolsFolder(
  parentDir: string,
  parentPath: string,
  problems: string[],
): Promise<void> {
  const at = parentPath === "" ? REFUSED_SLOT : `${parentPath}/${REFUSED_SLOT}`;
  const found = await classify(path.join(parentDir, REFUSED_SLOT));
  if (found.kind !== "directory") return;
  problems.push(
    `"${at}" is a ${REFUSED_SLOT}/ folder, which this convention does not read. A tool is an ` +
      `ordinary block: put the file in a \`${BLOCKS_SLOT}/\` folder and name it in a worker's ` +
      "`tools:`",
  );
}

/**
 * Walk the team tree's `blocks/` folders and return what they register, per
 * seat.
 *
 * The root is opened here rather than left to the caller, for the reason the
 * walks beside it open it: a symlinked root would put the whole walk outside
 * the configured tree.
 *
 * @param root Path to the app's `workforce/` directory.
 * @returns Every registration, ordered, and every refusal.
 * @throws If the root is symlinked, missing or unreadable.
 */
export async function discoverSeatBlocks(root: string): Promise<SeatBlockDiscovery> {
  await openRoot(root);

  const seatBlocks: DiscoveredSeatBlock[] = [];
  const problems: string[] = [];

  await refuseToolsFolder(root, "", problems);

  // The organisation level. It has no seats — a worker id is `<team>.<name>`,
  // so nothing under `org/` is hireable — which is exactly why a `blocks/`
  // folder there has to be named rather than passed over.
  const orgDir = path.join(root, "org");
  const org = await openStructuralDirectory(orgDir, "org");
  if (org.refusal !== undefined) problems.push(org.refusal.error.message);
  if (org.entries !== undefined) {
    await refuseToolsFolder(orgDir, "org", problems);
    await refuseStrayBlocksFolder(orgDir, "org", problems);
    await refuseUnderWorkers(orgDir, "org", problems);
  }

  const report = (_at: string, error: Error): void => {
    problems.push(error.message);
  };

  for await (const team of walkTeams(root, report)) {
    await refuseToolsFolder(team.dir, team.path, problems);

    const teamFiles = await readBlocksSlot(
      path.join(team.dir, BLOCKS_SLOT),
      `${team.path}/${BLOCKS_SLOT}`,
      problems,
    );

    const workersPath = `${team.path}/${WORKERS_LEVEL}`;
    const workers = await openStructuralDirectory(
      path.join(team.dir, WORKERS_LEVEL),
      workersPath,
    );
    if (workers.refusal !== undefined) problems.push(workers.refusal.error.message);
    if (workers.entries === undefined) continue;

    for (const workerName of [...workers.entries].sort()) {
      if (IGNORED_ENTRIES.has(workerName)) continue;

      const workerDir = path.join(team.dir, WORKERS_LEVEL, workerName);
      const entryPath = `${workersPath}/${workerName}`;
      const slot = await classify(workerDir);

      // A file under `workers/` occupies no worker slot — the roster reader's
      // rule at this level, and the two have to descend into the same seats.
      if (slot.kind === "absent" || slot.kind === "file") continue;
      if (slot.kind === "symlink") {
        problems.push(refusedSymlink("worker folder", entryPath).message);
        continue;
      }
      if (slot.kind === "unreadable") {
        problems.push(unreadable("Worker folder", entryPath, slot.error).message);
        continue;
      }

      await refuseToolsFolder(workerDir, entryPath, problems);

      // Identity before registration: a seat whose id cannot be minted has
      // nothing to register a block FOR, and both halves of the id are path
      // segments the tree fixed.
      let seat: string;
      try {
        validateSegment(team.id, "Team");
        validateSegment(workerName, "Worker");
        seat = `${team.id}.${workerName}`;
      } catch (error) {
        problems.push(`"${entryPath}" — ${(error as Error).message}`);
        continue;
      }

      const ownFiles = await readBlocksSlot(
        path.join(workerDir, BLOCKS_SLOT),
        `${entryPath}/${BLOCKS_SLOT}`,
        problems,
      );

      // Nearest level wins, and the shadowed one is not also registered: a
      // name resolves to one block, and a second entry under it would be a
      // precedence story with two answers.
      const ownNames = new Set(ownFiles.map((file) => file.name));
      for (const file of teamFiles) {
        if (ownNames.has(file.name)) continue;
        seatBlocks.push({ seat, level: "team", ...file });
      }
      for (const file of ownFiles) seatBlocks.push({ seat, level: "worker", ...file });
    }
  }

  // Ordered by path, then by seat for the team-level files one path produces
  // several of, so a tree that has not changed renders byte-identically on any
  // machine.
  seatBlocks.sort((a, b) =>
    a.path !== b.path ? (a.path < b.path ? -1 : 1) : a.seat < b.seat ? -1 : a.seat > b.seat ? 1 : 0,
  );
  return { seatBlocks, problems };
}

/**
 * Report a `blocks/` or `tools/` folder beside a worker under a parent that has
 * no seats — today only `org/`.
 *
 * Separate from the team walk because the two differ in what they go on to do:
 * a team's workers are seats and are read, and an org's are not.
 */
async function refuseUnderWorkers(
  parentDir: string,
  parentPath: string,
  problems: string[],
): Promise<void> {
  const workersPath = `${parentPath}/${WORKERS_LEVEL}`;
  const workers = await openStructuralDirectory(
    path.join(parentDir, WORKERS_LEVEL),
    workersPath,
  );
  if (workers.refusal !== undefined) problems.push(workers.refusal.error.message);
  if (workers.entries === undefined) return;

  for (const workerName of [...workers.entries].sort()) {
    if (IGNORED_ENTRIES.has(workerName)) continue;
    const workerDir = path.join(parentDir, WORKERS_LEVEL, workerName);
    const entryPath = `${workersPath}/${workerName}`;
    if ((await classify(workerDir)).kind !== "directory") continue;
    await refuseToolsFolder(workerDir, entryPath, problems);
    await refuseStrayBlocksFolder(workerDir, entryPath, problems);
  }
}
