/**
 * The claim pass: every entry in a kit's folder is used or refused.
 *
 * A kit's reader is handed a {@link KitFolder} and claims each file or
 * directory it consumed. When it is done, {@link OpenedKitFolder.unclaimed}
 * walks the folder and reports everything nobody claimed, by path, all at
 * once. The only pass is {@link IGNORED_ENTRIES}, the names that never mean
 * anything. A file the docs don't name therefore can't load nothing and say
 * nothing: the engine refuses to start the app and names it.
 *
 * The walk never follows a symlink. One that would have to be walked through
 * to reach a claim is reported as a symlink; one nothing claimed is reported
 * as unclaimed like any other entry.
 *
 * Node-only (`node:fs`).
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { KitFolder } from "@flow-state-dev/core";
import { IGNORED_ENTRIES, classify, openRoot, refusedSymlink, unreadable, type PathReport } from "./walk";

/** Why an entry in a kit's folder was refused. */
export type FolderRefusalKind = "unclaimed" | "symlink" | "unreadable";

/** A kit's folder, opened for its reader, and the pass that runs after it. */
export interface OpenedKitFolder {
  /** What the kit's reader is handed. */
  readonly folder: KitFolder;
  /** Every entry no reader claimed, by slash-separated path; empty when all were used. */
  unclaimed(): Promise<PathReport<FolderRefusalKind>[]>;
}

/** A claim's path as segments, or a throw when it is not a path inside the folder. */
function claimSegments(relativePath: string, what: string): string[] {
  if (path.isAbsolute(relativePath)) {
    throw new Error(`${what}: a claim is a path relative to the folder, not "${relativePath}".`);
  }
  const segments = relativePath.split(/[\\/]/).filter((segment) => segment !== "" && segment !== ".");
  if (segments.includes("..")) {
    throw new Error(`${what}: the claim "${relativePath}" is outside the folder.`);
  }
  return segments;
}

/**
 * Open `root` for a kit's reader. Throws, through `openRoot`, when the folder
 * is a symlink, spelled with a `..` through an earlier segment, or unreadable,
 * absent included: a kit that owns a folder is configured with one.
 *
 * @param what Names the folder in every message (`folder of kit "notes"`).
 */
export async function openKitFolder(root: string, what: string): Promise<OpenedKitFolder> {
  await openRoot(root, what);
  const claims = new Set<string>();

  const folder: KitFolder = {
    path: path.resolve(root),
    claim(relativePath) {
      claims.add(claimSegments(relativePath, what).join("/"));
    },
  };

  /** The entry, or a directory above it, was claimed. */
  const covered = (rel: string): boolean => {
    const segments = rel.split("/");
    return segments.some((_, index) => claims.has(segments.slice(0, index + 1).join("/")));
  };
  /** Something under the directory `rel` was claimed, so it must be walked. */
  const holdsAClaim = (rel: string): boolean => [...claims].some((claim) => claim.startsWith(`${rel}/`));

  async function walk(dir: string, prefix: string, reports: PathReport<FolderRefusalKind>[]): Promise<void> {
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch (err) {
      reports.push({ path: prefix, kind: "unreadable", error: unreadable("Folder", prefix, err as Error) });
      return;
    }
    for (const name of names.sort()) {
      if (IGNORED_ENTRIES.has(name)) continue;
      const rel = prefix === "" ? name : `${prefix}/${name}`;
      if (covered(rel)) continue;
      if (!holdsAClaim(rel)) {
        reports.push({
          path: rel,
          kind: "unclaimed",
          error: new Error(`"${rel}" is not used by anything that reads the ${what}. Remove it.`),
        });
        continue;
      }
      const entry = await classify(path.join(dir, name));
      if (entry.kind === "symlink") {
        reports.push({ path: rel, kind: "symlink", error: refusedSymlink("entry", rel) });
      } else if (entry.kind === "unreadable") {
        reports.push({ path: rel, kind: "unreadable", error: unreadable("Entry", rel, entry.error) });
      } else if (entry.kind === "directory") {
        await walk(path.join(dir, name), rel, reports);
      }
      // A file a claim names a path *under* can't hold that claim; it was
      // claimed as something it isn't, and is reported below as unclaimed.
      else {
        reports.push({
          path: rel,
          kind: "unclaimed",
          error: new Error(`"${rel}" is not used by anything that reads the ${what}. Remove it.`),
        });
      }
    }
  }

  return {
    folder,
    async unclaimed() {
      const reports: PathReport<FolderRefusalKind>[] = [];
      await walk(folder.path, "", reports);
      return reports;
    },
  };
}
