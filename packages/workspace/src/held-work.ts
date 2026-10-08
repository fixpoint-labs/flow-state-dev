/**
 * Held work: a repository run's commits and uncommitted files, kept off the
 * machine the run works on so another machine can carry on from them.
 *
 * Off unless the operator gives the host a {@link HeldWorkStore}. With one,
 * the host snapshots a run's checkout at each save point its caller names
 * (`checkpoint`), and rebuilds a lost checkout from the snapshot (`provision`).
 *
 * The snapshot is git's own objects. A temporary index takes the working tree
 * (`add -A`, `write-tree`, `commit-tree` on the head), and the commits from
 * the run's base to that snapshot go into one pack. No ref is written, the
 * agent's index is never touched, and nothing reaches the remote. Deletions,
 * renames, binary files, exec bits and symlinks come along by construction.
 *
 * This module holds the port, its folder default, the mismatch error and the
 * git steps. `./local-host` decides when they run.
 */
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

/**
 * Where held work goes: one object per key, put, read, deleted and listed.
 *
 * The operator wires one on the host. {@link fileHeldWorkStore} is the shipped
 * default; an adapter over S3, R2 or Vercel Blob is a few lines.
 *
 * Two rules every implementation keeps:
 *
 * - **`put` is atomic.** A reader sees the whole object or none of it, never a
 *   partly written one. A machine that dies mid-hold must leave the run's last
 *   good pack readable, and the record still names that one.
 * - **Deleting a missing key does nothing.** It resolves.
 */
export interface HeldWorkStore {
  /** Store `bytes` under `key`, replacing anything there. Atomic. */
  put(key: string, bytes: Uint8Array): Promise<void>;
  /** The bytes under `key`, or `undefined` when there are none. */
  get(key: string): Promise<Uint8Array | undefined>;
  /** Remove `key`. Resolves when it is already gone. */
  delete(key: string): Promise<void>;
  /** Every key under `prefix`, keys only. */
  list(prefix: string): Promise<string[]>;
}

/**
 * A {@link HeldWorkStore} over a folder: each key is a file under `dir`.
 *
 * A `put` writes a temporary file beside the target and renames it into place,
 * so a reader never sees a partial pack. For hosts on different machines, put
 * `dir` on storage they share.
 */
export function fileHeldWorkStore(options: { dir: string }): HeldWorkStore {
  const dir = resolve(options.dir);
  const pathOf = (key: string): string => join(dir, ...keySegments(key));

  return {
    async put(key, bytes) {
      const target = pathOf(key);
      mkdirSync(dirname(target), { recursive: true });
      const temporary = `${target}.${randomUUID()}.tmp`;
      try {
        writeFileSync(temporary, bytes);
        renameSync(temporary, target);
      } catch (error) {
        rmSync(temporary, { force: true });
        throw error;
      }
    },
    async get(key) {
      const path = pathOf(key);
      if (!existsSync(path)) return undefined;
      return new Uint8Array(readFileSync(path));
    },
    async delete(key) {
      rmSync(pathOf(key), { force: true });
    },
    async list(prefix) {
      const trimmed = prefix.replace(/\/+$/, "");
      const start = trimmed === "" ? dir : join(dir, ...keySegments(trimmed));
      if (!existsSync(start)) return [];
      const keys: string[] = [];
      const walk = (path: string, key: string): void => {
        const stat = lstatSync(path);
        if (stat.isDirectory()) {
          for (const name of readdirSync(path)) walk(join(path, name), key === "" ? name : `${key}/${name}`);
        } else if (stat.isFile() && !path.endsWith(".tmp")) {
          keys.push(key);
        }
      };
      walk(start, trimmed);
      return keys.filter((key) => key.startsWith(prefix)).sort();
    },
  };
}

/** A key's segments, refusing any key that could leave the store's folder. */
function keySegments(key: string): string[] {
  const segments = key.split("/");
  if (key === "" || segments.some((s) => s === "" || s === "." || s === ".." || s.includes("\\") || s.includes("\0"))) {
    throw new Error(`a held-work key is "/"-separated plain segments, none empty, "." or ".."; got ${JSON.stringify(key)}.`);
  }
  return segments;
}

/** What a held-work mismatch names. */
export type HeldWorkMismatchField =
  | "scope"
  | "pack"
  | "base"
  | "head"
  | "snapshot"
  | "tree"
  | "branch"
  | "remote"
  | "disabled";

/**
 * The run's held work disagrees with its record, or this host cannot use it.
 *
 * Not a {@link WorkspaceRefusedError}: a refusal will not clear on a retry,
 * while a mismatch waits for a person to decide. Nothing held is changed when
 * this is thrown.
 */
export class HeldWorkMismatchError extends Error {
  constructor(
    readonly field: HeldWorkMismatchField,
    message: string,
  ) {
    super(message);
    this.name = "HeldWorkMismatchError";
  }
}

/** A path a hold left out, and why. */
export interface SkippedPath {
  path: string;
  /** `over-cap`: larger than the size cap. `submodule`: a submodule or nested repository. */
  why: "over-cap" | "submodule";
}

/** One hold: what `checkpoint` wrote, for the caller to record. */
export interface HeldWork {
  /** The commit the run's branch was cut at. */
  base: string;
  /** The branch's commit when the hold ran. */
  head: string;
  /** The snapshot commit: the working tree, on top of `head`. Content-addressed. */
  snapshot: string;
  /** The store key of the pack. */
  key: string;
  /** The pack's sha256, hex. */
  sha256: string;
  /** The pack's size in bytes. */
  bytes: number;
  /** Paths left out of the snapshot. */
  skipped: SkippedPath[];
  /**
   * `true` when the snapshot equals the one the caller passed in: nothing was
   * written, and the record should not change.
   */
  unchanged: boolean;
}

/** The hold a run record names, handed back to `provision`. */
export interface RecordedHold {
  base: string;
  head: string;
  snapshot: string;
  key: string;
  sha256: string;
  /**
   * The pack parked the run, and the owner has answered. The next provision
   * starts from the base and lays the snapshot out in `held/`.
   */
  parked?: boolean;
}

/** A file larger than this is not held. Read from `lstat`, before git reads it. */
export const HELD_FILE_CAP_BYTES = 10 * 1024 * 1024;

/**
 * The fixed author, committer and dates a snapshot is written under, so an
 * unchanged tree on an unchanged head gives the same snapshot, and the same
 * key, every time.
 */
export const SNAPSHOT_IDENTITY: Record<string, string> = {
  GIT_AUTHOR_NAME: "fsd held work",
  GIT_AUTHOR_EMAIL: "held-work@flow-state.dev",
  GIT_AUTHOR_DATE: "@0 +0000",
  GIT_COMMITTER_NAME: "fsd held work",
  GIT_COMMITTER_EMAIL: "held-work@flow-state.dev",
  GIT_COMMITTER_DATE: "@0 +0000",
};

/** Run git in `cwd` with extra environment and optional input; resolves with stdout, trimmed. */
export type Git = (
  cwd: string,
  args: string[],
  options?: { env?: Record<string, string>; input?: string | Uint8Array; raw?: boolean },
) => Promise<string>;

/** A temporary directory for one hold or rebuild, removed by the caller. */
export function scratchDir(): string {
  return mkdtempSync(join(tmpdir(), "fsd-held-"));
}

/**
 * Snapshot `checkout`'s working tree through a temporary index, on top of its
 * head. Never touches the checkout's own index and writes no ref.
 *
 * Every path `status` reports is `lstat`ed first. One over the cap, or inside
 * a submodule, keeps the head's version in the snapshot, or none, and is named
 * in `skipped`.
 */
export async function snapshotWorkingTree(
  git: Git,
  checkout: string,
  scratch: string,
): Promise<{ head: string; tree: string; snapshot: string; skipped: SkippedPath[] }> {
  const head = await git(checkout, ["rev-parse", "--verify", "HEAD^{commit}"]);
  const status = await git(checkout, ["--no-optional-locks", "status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none"], {
    // Untrimmed: the first entry's status code can start with a space.
    raw: true,
  });
  const skipped: SkippedPath[] = [];
  for (const path of statusPaths(status)) {
    const full = join(checkout, ...path.replace(/\/$/, "").split("/"));
    let stat;
    try {
      stat = lstatSync(full);
    } catch {
      continue; // deleted: nothing to read, and the add records the deletion
    }
    // A directory on the list is a submodule or a nested repository only when
    // it has a `.git` of its own. Otherwise it is a tracked file the run
    // replaced with a directory, whose files are listed on their own.
    if (stat.isDirectory()) {
      if (existsSync(join(full, ".git"))) skipped.push({ path: path.replace(/\/$/, ""), why: "submodule" });
    }
    else if (stat.isFile() && stat.size > HELD_FILE_CAP_BYTES) skipped.push({ path, why: "over-cap" });
  }

  const index = join(scratch, "index");
  const realIndex = await git(checkout, ["rev-parse", "--path-format=absolute", "--git-path", "index"]);
  const env = { GIT_INDEX_FILE: index };
  if (existsSync(realIndex)) copyFileSync(realIndex, index);
  else await git(checkout, ["read-tree", head], { env });

  const excluded = skipped.map((s) => `:(exclude,literal)${s.path}`);
  await git(checkout, ["add", "-A", "--", ".", ...excluded], { env });
  // A skipped path keeps the head's version, or none: whatever the copied
  // index had staged for it is put back to the head.
  if (skipped.length > 0) {
    await git(checkout, ["reset", "-q", head, "--", ...skipped.map((s) => `:(literal)${s.path}`)], { env });
  }
  const tree = await git(checkout, ["write-tree"], { env });
  const snapshot = await git(checkout, ["commit-tree", tree, "-p", head, "-m", "held work"], {
    env: SNAPSHOT_IDENTITY,
  });
  return { head, tree, snapshot, skipped };
}

/**
 * The paths in `git status --porcelain=v1 -z` output. A rename or copy
 * carries its source as the next entry, and both are returned.
 */
export function statusPaths(output: string): string[] {
  const entries = output.split("\0");
  const paths: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    if (entry.length < 4) continue;
    const code = entry.slice(0, 2);
    paths.push(entry.slice(3));
    if (code.includes("R") || code.includes("C")) {
      const from = entries[++i];
      if (from !== undefined && from !== "") paths.push(from);
    }
  }
  return paths;
}

/** One pack of every object reachable from `snapshot` and not from `base`. */
export async function packFromBase(git: Git, cwd: string, base: string, snapshot: string, scratch: string): Promise<Uint8Array> {
  const prefix = join(scratch, "held");
  const name = await git(cwd, ["pack-objects", "--revs", "-q", prefix], { input: `${snapshot}\n^${base}\n` });
  return new Uint8Array(readFileSync(`${prefix}-${name}.pack`));
}

/** The pack's sha256, hex. */
export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The key segment for a place: its segments, `/`-joined. */
export function placeKey(place: readonly string[]): string {
  return place.join("/");
}

/** The directory prefix every key of one place's holds sits under. */
export function placeKeyPrefix(heldPrefix: string, place: readonly string[]): string {
  return `${heldPrefix.replace(/\/+$/, "")}/${placeKey(place)}/`;
}

/** A stale directory's new name beside it. Kept, never deleted. */
export function asideName(path: string, at: number): string {
  return `${path}.stale-${new Date(at).toISOString().replace(/[:.]/g, "-")}`;
}

/** Refuse a `heldPrefix` that is not `/`-separated plain segments. */
export function assertHeldPrefix(prefix: string): void {
  keySegments(prefix);
}
