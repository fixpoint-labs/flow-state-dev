/**
 * The package door's walk: the `blocks/` folder inside every
 * `packages/<name>/` at the org, team and worker levels.
 *
 * A package's tools are blocks like any other, found the way every block in
 * the tree is found — from the tree's shape, at build time, without opening a
 * module — so a bundled deploy registers exactly what a local one does. What
 * this door adds over the seat-blocks door beside it is only WHERE it looks,
 * and what it keys a block by: the package's address, not a seat. Which seat
 * may call a package's block is decided at the hire, from which seats hold the
 * package; nothing here grants anything.
 *
 * A package's text is not read here. `PACKAGE.md` is the loader's; this door
 * reads `blocks/` and nothing else, and refuses only what would make the
 * rendered map wrong: a symlink, a badly named package or block, a directory
 * where a block file belongs, and one basename claimed twice.
 *
 * Node-only: it walks a directory, so it sits behind a subpath.
 */

import path from "node:path";
import {
  IGNORED_ENTRIES,
  PACKAGES_SLOT,
  WORKERS_LEVEL,
  classify,
  openRoot,
  openStructuralDirectory,
  refusedSymlink,
  unreadable,
  validateSegment,
  walkTeams,
} from "../loader";
import { BLOCKS_SLOT, readBlocksSlot } from "./discover-seat-blocks";

/** Where a package's blocks may sit, as the command reports it. */
export const PACKAGE_BLOCK_SLOT_PATTERNS: readonly string[] = Object.freeze([
  `org/${PACKAGES_SLOT}/*/${BLOCKS_SLOT}`,
  `teams/*/${PACKAGES_SLOT}/*/${BLOCKS_SLOT}`,
  `teams/*/${WORKERS_LEVEL}/*/${PACKAGES_SLOT}/*/${BLOCKS_SLOT}`,
]);

/** One block a package carries. */
export interface DiscoveredPackageBlock {
  /** The package's address — its folder's path under the workforce root, e.g. `teams/support/packages/escalation`. */
  package: string;
  /** The basename without its extension: the tool's name. */
  name: string;
  /** Slash-separated path under the workforce root. Orders the output. */
  path: string;
  /** The specifier the generated module imports it by. */
  importPath: string;
}

/** What the package-block walk produced. Problems are handed back, as the other doors do. */
export interface PackageBlockDiscovery {
  /** Every package block, ordered by path. */
  packageBlocks: DiscoveredPackageBlock[];
  /** Each refusal, in the order the walk met it. */
  problems: string[];
}

/**
 * Walk every package's `blocks/` folder.
 *
 * Structural refusals above a `packages/` slot — a symlinked `teams/`, team or
 * worker folder — are left to the doors that own those slots, which already
 * report them; this walk simply does not go through them.
 *
 * @param root Path to the app's `workforce/` directory.
 * @returns Every package block, ordered, and every refusal.
 * @throws If the root is symlinked, missing or unreadable.
 */
export async function discoverPackageBlocks(root: string): Promise<PackageBlockDiscovery> {
  await openRoot(root);

  const packageBlocks: DiscoveredPackageBlock[] = [];
  const problems: string[] = [];

  const org = await openStructuralDirectory(path.join(root, "org"), "org");
  if (org.entries !== undefined) {
    await readPackagesSlot(path.join(root, "org"), "org", packageBlocks, problems);
  }

  for await (const team of walkTeams(root, () => undefined)) {
    await readPackagesSlot(team.dir, team.path, packageBlocks, problems);

    const workersPath = `${team.path}/${WORKERS_LEVEL}`;
    const workers = await openStructuralDirectory(path.join(team.dir, WORKERS_LEVEL), workersPath);
    if (workers.entries === undefined) continue;
    for (const workerName of [...workers.entries].sort()) {
      if (IGNORED_ENTRIES.has(workerName)) continue;
      const workerDir = path.join(team.dir, WORKERS_LEVEL, workerName);
      if ((await classify(workerDir)).kind !== "directory") continue;
      // A badly named worker folder is the worker reader's to report, and the
      // loader skips its packages; so does this walk, or it would generate
      // blocks for a package no seat can hold.
      try {
        validateSegment(workerName, "Worker");
      } catch {
        continue;
      }
      await readPackagesSlot(workerDir, `${workersPath}/${workerName}`, packageBlocks, problems);
    }
  }

  packageBlocks.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { packageBlocks, problems };
}

/** Read one `packages/` slot's packages' `blocks/` folders. Absent is silent. */
async function readPackagesSlot(
  parentDir: string,
  parentPath: string,
  packageBlocks: DiscoveredPackageBlock[],
  problems: string[],
): Promise<void> {
  const slotDir = path.join(parentDir, PACKAGES_SLOT);
  const slotPath = `${parentPath}/${PACKAGES_SLOT}`;
  const slot = await openStructuralDirectory(slotDir, slotPath);
  if (slot.refusal !== undefined) problems.push(slot.refusal.error.message);
  if (slot.entries === undefined) return;

  for (const name of [...slot.entries].sort()) {
    if (IGNORED_ENTRIES.has(name)) continue;
    const packageDir = path.join(slotDir, name);
    const address = `${slotPath}/${name}`;
    const entry = await classify(packageDir);
    if (entry.kind === "symlink") {
      problems.push(refusedSymlink("package folder", address).message);
      continue;
    }
    if (entry.kind === "unreadable") {
      problems.push(unreadable("Package folder", address, entry.error).message);
      continue;
    }
    // A stray file in `packages/` is the loader's to refuse: it holds no
    // `blocks/` for this door to read.
    if (entry.kind !== "directory") continue;
    try {
      validateSegment(name, "Package");
    } catch (error) {
      problems.push(`"${address}" — ${(error as Error).message}`);
      continue;
    }

    const files = await readBlocksSlot(
      path.join(packageDir, BLOCKS_SLOT),
      `${address}/${BLOCKS_SLOT}`,
      problems,
    );
    for (const file of files) packageBlocks.push({ package: address, ...file });
  }
}
