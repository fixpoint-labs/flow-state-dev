/**
 * A place backed by a directory on the machine the flow runs on.
 *
 * The counterpart to `createMemoryPlace`: same three operations, same
 * contract, real files. It is what a run pointed at a working directory gets
 * projected into, and it executes nothing — a place is where files live, not
 * where commands run.
 */
import { mkdirSync, readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Place } from "./types";
import { normalizePath } from "./routing";

export interface HostPlace extends Place {
  /** The absolute directory every projected path is resolved against. */
  readonly root: string;
}

/**
 * Open `root` as a place, creating the directory if it does not exist.
 *
 * Creating it up front is what lets `list` treat a missing root as a failure
 * rather than as "empty". The difference matters: a flush that reads "no
 * files" deletes what it owns, so a root that vanished mid-run has to throw,
 * while a mount's own subdirectory being absent is genuinely nothing to sync.
 */
export function createHostPlace(root: string): HostPlace {
  const absoluteRoot = resolve(root);
  mkdirSync(absoluteRoot, { recursive: true });

  /**
   * The absolute path for a projected path, refusing anything that would land
   * outside the root. A place is a boundary, so `../` is an error here rather
   * than a surprise two layers up.
   */
  const within = (path: string): string => {
    const absolute = resolve(absoluteRoot, normalizePath(path));
    const rel = relative(absoluteRoot, absolute);
    if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error(`path escapes the workspace root: ${path}`);
    }
    return absolute;
  };

  /**
   * Every file under `dir`, as paths relative to the root.
   *
   * Symlinks are neither followed nor listed. Following one would let a link
   * planted inside the place pull an arbitrary file into a collection, and
   * listing one without following it would report a path whose content the
   * place cannot honestly claim to hold. Both fall out of the dirent pair
   * below: `readdir` does not stat through a link, so a symlink is neither
   * `isDirectory()` nor `isFile()` and matches neither branch. Anything that
   * replaces this walk with one that stats has to re-earn that.
   */
  const walk = (dir: string, out: string[]): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      // A prefix with no directory yet is a mount that hydrated nothing.
      // Every other failure is the place being unreadable, which must not be
      // reported as emptiness.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, out);
        continue;
      }
      if (entry.isFile()) out.push(normalizePath(relative(absoluteRoot, full)));
    }
  };

  return {
    root: absoluteRoot,
    async read(path) {
      try {
        return await readFile(within(path), "utf-8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async write(path, content) {
      const absolute = within(path);
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, content, "utf-8");
    },
    async list(prefixes) {
      // Not caught: if the root itself is gone, the place is broken, and a
      // flush must hear about it instead of concluding the run deleted
      // everything.
      readdirSync(absoluteRoot);
      const out: string[] = [];
      for (const prefix of prefixes) walk(within(prefix), out);
      return out;
    },
  };
}
