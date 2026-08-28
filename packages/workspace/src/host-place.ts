/**
 * A place backed by a directory on the machine the flow runs on.
 *
 * The counterpart to `createMemoryPlace`: same three operations, same
 * contract, real files. It is what a run pointed at a working directory gets
 * projected into, and it executes nothing — a place is where files live, not
 * where commands run.
 */
import { lstatSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
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
  // Resolved once, and against the REAL root rather than the spelling the
  // caller used. A root under a symlinked parent — `/tmp` on macOS is one —
  // would otherwise make every contained path look like an escape.
  const realRoot = realpathSync(absoluteRoot);

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
    contained(absolute, path);
    return absolute;
  };

  /**
   * The real path of the deepest component of `absolute` that exists.
   *
   * A path being written does not exist yet, and neither may its parents, so
   * there is nothing to resolve at the leaf. What CAN be resolved is however
   * much of the chain is already on disk — and that is exactly the part an
   * attacker had to have planted a link into.
   */
  const deepestReal = (absolute: string): string => {
    let current = absolute;
    for (;;) {
      try {
        return realpathSync(current);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const parent = dirname(current);
        // Walked past the root without finding anything that exists. The root
        // is created up front, so this means it was removed underneath us.
        if (parent === current) throw error;
        current = parent;
      }
    }
  };

  /**
   * Refuse a path that leaves the root by following a link rather than by
   * spelling `..`.
   *
   * The lexical check above resolves `..` and rejects what lands outside. A
   * symlink defeats it completely: the path stays inside the root, and the
   * kernel walks out of it anyway. Anything that can write in the place can
   * plant one — an agent, a hydrated collection, another process — and then
   * a write clobbers a host file the run was never given, or a read pulls one
   * into a collection that is durable and client-readable.
   *
   * Both halves are needed. A link at the LEAF is refused outright, pointing
   * in or out: `walk` already refuses to list one, and a place that writes
   * through a link it will not list is a place that disagrees with itself. A
   * link anywhere in the PARENT chain is caught by resolving the part of the
   * chain that exists — `mkdir -p` through a symlinked directory succeeds
   * silently and lands the file wherever the link points.
   */
  const contained = (absolute: string, path: string): void => {
    let leaf;
    try {
      leaf = lstatSync(absolute);
    } catch (error) {
      // Nothing there yet, which is the ordinary case for a write.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (leaf?.isSymbolicLink()) {
      throw new Error(`path is a symlink, which this place does not follow: ${path}`);
    }

    const real = deepestReal(absolute);
    const rel = relative(realRoot, real);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error(`path escapes the workspace root through a symlink: ${path}`);
    }
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
