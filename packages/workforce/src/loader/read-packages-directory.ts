/**
 * The package loader — read every `packages/<name>/PACKAGE.md` in a workforce
 * tree into a neutral record.
 *
 * A `packages/` folder may sit at three levels: the org's (`org/packages/`), a
 * team's (`teams/<team>/packages/`), and one worker's own
 * (`teams/<team>/workers/<worker>/packages/`). Where it sits is who it is for,
 * and the record says so; which worker HOLDS which package is decided at the
 * hire, from the record's level and the worker's `packages:` line.
 *
 * Reads the text and nothing else. A package's blocks are code, found by
 * `fsdev gen` without being opened; this reader never looks inside `blocks/`
 * beyond refusing it as a symlink. The text itself is read by `readPackage`,
 * which takes a string — the walk here is the only part that knows about disk.
 *
 * Two rules run through it, as through every reader here. **Symlinks are never
 * followed**, at any level. And **nothing an author wrote is passed over in
 * silence**: a folder under `packages/` is a package or a mistake, so a folder
 * with no `PACKAGE.md`, a file where a folder belongs, a name that breaks the
 * segment rules, and a documents or skills folder inside a package are each
 * refused with the path named. A package with any refusal is left out whole
 * rather than loaded short.
 *
 * Node-only (`node:fs`), which is why it ships behind the `./loader` subpath.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { PACKAGE_MD, type PackageManifest } from "../manifest";
import { readPackage } from "../package-text";
import { WORKERS_LEVEL } from "./resource-convention";
import { validateSegment } from "./segments";
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

/** The folder packages sit in, at every level. */
export const PACKAGES_SLOT = "packages";

/**
 * Folders a package may not hold, each refused by name. Documents belong to the
 * organization's `resources/` and `references/`, a skill is its own convention,
 * and a package inside a package would be a second way to hold one.
 */
const REFUSED_PACKAGE_ENTRIES: readonly string[] = ["resources", "references", "skills", PACKAGES_SLOT];

/**
 * Why one thing that should have produced a package did not — the discriminant
 * on every entry in {@link ReadPackagesDirectoryResult.errors}.
 */
export type PackageErrorKind =
  /** A structural folder on the way — `org`, a team's `workers/`, or a `packages/` slot — is a symlink or unreadable. Every package under it is missing. */
  | "unreadable-slot"
  /** One package did not load: a symlinked or badly named folder, or a missing, symlinked, unreadable or malformed `PACKAGE.md`. */
  | "package-load-failed"
  /** Something sits where the convention does not allow it: a file in `packages/`, or a documents, skills or packages folder, or a symlink, inside a package. */
  | "refused-entry";

/** One path that should have produced a package and did not. */
export type PackageError = PathReport<PackageErrorKind>;

/** What {@link readPackagesDirectory} hands back. */
export interface ReadPackagesDirectoryResult {
  /** One record per package that loaded: the org's first, then each team's, then each worker's, in walk order. */
  packages: PackageManifest[];
  /**
   * Every refusal, keyed by its slash-separated path under the root. Collected
   * rather than thrown, so one bad package never costs another. Every entry is
   * a package some worker may have been meant to hold, so a caller treating a
   * non-empty list as fatal is usually right.
   */
  errors: PackageError[];
}

/** Who a `packages/` slot belongs to, stamped onto each record it produces. */
type Owner = Pick<PackageManifest, "level" | "team" | "worker">;

/**
 * Read every package in the tree.
 *
 * Throws only when `root` itself is refused — a symlink, or a path that cannot
 * be read at all — the rule every reader here follows. A tree with no
 * `packages/` folder is an empty result.
 *
 * @param root The workforce tree — the folder holding `org/` and `teams/`.
 */
export async function readPackagesDirectory(root: string): Promise<ReadPackagesDirectoryResult> {
  await openRoot(root);

  const packages: PackageManifest[] = [];
  const errors: PackageError[] = [];

  // The org level. `org` itself is opened through the shared primitive so a
  // symlinked `org/` is refused rather than walked into.
  const org = await openStructuralDirectory(path.join(root, "org"), "org");
  if (org.refusal !== undefined) {
    errors.push({ path: "org", error: org.refusal.error, kind: "unreadable-slot" });
  }
  if (org.entries !== undefined) {
    await readPackagesSlot(path.join(root, "org"), "org", { level: "org" }, packages, errors);
  }

  const report = (at: string, error: Error): void => {
    errors.push({ path: at, error, kind: "unreadable-slot" });
  };

  for await (const team of walkTeams(root, report)) {
    await readPackagesSlot(team.dir, team.path, { level: "team", team: team.id }, packages, errors);

    const workersPath = `${team.path}/${WORKERS_LEVEL}`;
    const workers = await openStructuralDirectory(path.join(team.dir, WORKERS_LEVEL), workersPath);
    if (workers.refusal !== undefined) {
      errors.push({ path: workersPath, error: workers.refusal.error, kind: "unreadable-slot" });
    }
    if (workers.entries === undefined) continue;

    for (const workerName of [...workers.entries].sort()) {
      if (IGNORED_ENTRIES.has(workerName)) continue;
      const workerDir = path.join(team.dir, WORKERS_LEVEL, workerName);
      // Only a real folder is descended into. A symlinked, unreadable or badly
      // named worker folder is the worker reader's to report — it is the seat
      // that is missing, and naming it twice reads as two problems. Nothing
      // under it is read here either way.
      if ((await classify(workerDir)).kind !== "directory") continue;
      try {
        validateSegment(workerName, "Worker");
      } catch {
        continue;
      }
      await readPackagesSlot(
        workerDir,
        `${workersPath}/${workerName}`,
        { level: "worker", team: team.id, worker: `${team.id}.${workerName}` },
        packages,
        errors,
      );
    }
  }

  return { packages, errors };
}

/**
 * Read one `packages/` slot beside `parentDir`. Absent is silent; everything
 * else in it is a package or a refusal.
 */
async function readPackagesSlot(
  parentDir: string,
  parentPath: string,
  owner: Owner,
  packages: PackageManifest[],
  errors: PackageError[],
): Promise<void> {
  const slotDir = path.join(parentDir, PACKAGES_SLOT);
  const slotPath = `${parentPath}/${PACKAGES_SLOT}`;
  const slot = await openStructuralDirectory(slotDir, slotPath);
  if (slot.refusal !== undefined) {
    errors.push({ path: slotPath, error: slot.refusal.error, kind: "unreadable-slot" });
  }
  if (slot.entries === undefined) return;

  for (const name of [...slot.entries].sort()) {
    if (IGNORED_ENTRIES.has(name)) continue;
    const dir = path.join(slotDir, name);
    const at = `${slotPath}/${name}`;
    const entry = await classify(dir);

    if (entry.kind === "absent") continue;
    if (entry.kind === "symlink") {
      errors.push({ path: at, error: refusedSymlink("package folder", at), kind: "package-load-failed" });
      continue;
    }
    if (entry.kind === "unreadable") {
      errors.push({ path: at, error: unreadable("Package folder", at, entry.error), kind: "package-load-failed" });
      continue;
    }
    if (entry.kind === "file") {
      errors.push({
        path: at,
        error: new Error(
          `"${at}" is a file. A package is a folder — \`${PACKAGES_SLOT}/<name>/${PACKAGE_MD}\`, ` +
            `with its tools beside it in \`${PACKAGES_SLOT}/<name>/blocks/\`.`,
        ),
        kind: "refused-entry",
      });
      continue;
    }

    try {
      validateSegment(name, "Package");
    } catch (error) {
      errors.push({ path: at, error: new Error(`"${at}" — ${(error as Error).message}`), kind: "package-load-failed" });
      continue;
    }

    const read = await readPackageFolder(dir, at, errors);
    if (read === undefined) continue;
    packages.push({
      name,
      path: at,
      ...owner,
      description: read.description,
      ...(read.body.trim().length > 0 ? { instructions: read.body } : {}),
    });
  }
}

/**
 * Read one package folder's `PACKAGE.md`, refusing what the folder may not hold.
 * Every refusal is filed; the package loads only when there is none.
 */
async function readPackageFolder(
  dir: string,
  at: string,
  errors: PackageError[],
): Promise<{ description: string; body: string } | undefined> {
  const before = errors.length;

  const listed = await openStructuralDirectory(dir, at);
  if (listed.refusal !== undefined) {
    errors.push({ path: at, error: listed.refusal.error, kind: "package-load-failed" });
    return undefined;
  }

  for (const name of [...(listed.entries ?? [])].sort()) {
    if (IGNORED_ENTRIES.has(name) || name === PACKAGE_MD) continue;
    const entryPath = `${at}/${name}`;
    if (REFUSED_PACKAGE_ENTRIES.includes(name)) {
      errors.push({
        path: entryPath,
        error: new Error(
          `"${entryPath}" is a ${name}/ folder inside a package. A package holds a ${PACKAGE_MD} ` +
            `and a \`blocks/\` folder of tools, nothing else of the convention's: documents belong ` +
            `to the organization's \`resources/\` and \`references/\`, and a skill is its own folder.`,
        ),
        kind: "refused-entry",
      });
      continue;
    }
    if ((await classify(path.join(dir, name))).kind === "symlink") {
      errors.push({ path: entryPath, error: refusedSymlink("entry", entryPath), kind: "refused-entry" });
    }
  }

  const filePath = `${at}/${PACKAGE_MD}`;
  const file = path.join(dir, PACKAGE_MD);
  const md = await classify(file);
  if (md.kind === "absent") {
    errors.push({
      path: at,
      error: new Error(
        `Package folder "${at}" has no ${PACKAGE_MD}. A folder under \`${PACKAGES_SLOT}/\` is a ` +
          `package, and every package is a ${PACKAGE_MD} with a \`description\`.`,
      ),
      kind: "package-load-failed",
    });
  } else if (md.kind === "symlink") {
    errors.push({ path: filePath, error: refusedSymlink(PACKAGE_MD, filePath), kind: "package-load-failed" });
  } else if (md.kind === "unreadable") {
    errors.push({ path: filePath, error: unreadable(PACKAGE_MD, filePath, md.error), kind: "package-load-failed" });
  } else if (md.kind === "directory") {
    errors.push({
      path: filePath,
      error: new Error(`"${filePath}" is a directory. A package's ${PACKAGE_MD} is a file.`),
      kind: "package-load-failed",
    });
  }
  if (md.kind !== "file") return undefined;

  // Read even when an entry beside it was refused, so a bad file in a folder
  // that is also wrongly shaped is named in the same run.
  const read = readPackage(await fs.readFile(file, "utf8"));
  if ("refusal" in read) {
    errors.push({
      path: filePath,
      error: new Error(`${PACKAGE_MD} in "${at}/" ${read.refusal}`),
      kind: "package-load-failed",
    });
  }
  return errors.length > before || "refusal" in read ? undefined : read;
}
