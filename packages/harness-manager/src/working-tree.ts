/**
 * A run's working tree, read without letting git near its files' content.
 *
 * Git compares a working-tree file with a commit by hashing it through the
 * file's clean or process filter, which the run can name (see `safe-git.ts`).
 * So git here only lists: the base's tree, HEAD's tree, the index, and the
 * untracked paths. This module reads each file itself, raw, never through a
 * link: a symlink is the name it points at, and a folder the run swapped for
 * a link holds nothing. A file's change is its raw blob id against the base's;
 * lines are counted, and a patch drawn, by {@link scratchDiff} on copies in a
 * directory with no repository.
 *
 * Raw content is what a run left on disk. A checkout that converts line
 * endings on commit (`core.autocrlf`, an `eol` attribute) reads a file whose
 * bytes differ from its blob as changed, where git would say it isn't.
 */

import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, mkdtemp, mkdir, open, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkoutGit, checkoutGitBytes, scratchDiff } from "./safe-git";

/** The largest file a working-tree read copies to count its lines or draw its patch. Past it, the file is listed with no lines. */
export const MAX_COPIED_BYTES = 4 * 1024 * 1024;

/** Paths from a `-z` listing. */
const pathsOf = (out: string) => out.split("\0").filter((path) => path !== "");

/** A path's blob id per `<mode> <type> <id>\t<path>` (ls-tree) or `<mode> <id> <stage>\t<path>` (ls-files -s) row; gitlinks left out. */
function blobsOf(out: string, idField: number): Map<string, string> {
  const blobs = new Map<string, string>();
  for (const record of pathsOf(out)) {
    const tab = record.indexOf("\t");
    const fields = record.slice(0, tab).split(" ");
    if (fields[0] === "160000") continue;
    blobs.set(record.slice(tab + 1), fields[idField]!);
  }
  return blobs;
}

/** A commit's files and their blob ids. */
async function treeOf(cwd: string, rev: string): Promise<Map<string, string>> {
  return blobsOf(await checkoutGit(cwd, ["ls-tree", "-r", "-z", "--full-tree", rev]), 2);
}

/** A segment git writes into a tree; anything else is no file the run could have. */
const isSegment = (segment: string) => segment !== "" && segment !== "." && segment !== ".." && segment !== ".git" && !segment.includes("\0");

/** One working-tree file as read raw: its blob id, and whether it's a symlink's name. `null`: not there as a file. */
interface WorkingBlob {
  id: string;
  link: boolean;
}

/** Last read's ids, by checkout and path, kept while the file's stat is unchanged: a poll re-hashes only what moved. */
const seen = new Map<string, Map<string, { stamp: string; blob: WorkingBlob }>>();
const SEEN_CHECKOUTS = 16;

const stampOf = (stat: BigIntStats) => `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}:${stat.mode}`;

/** Opens a regular file without following a final link, and checks it's the file `stat` described. */
async function openFile(full: string, stat: BigIntStats) {
  const handle = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  const opened = await handle.stat({ bigint: true });
  if (!opened.isFile() || opened.ino !== stat.ino || opened.dev !== stat.dev) {
    await handle.close();
    return null;
  }
  return handle;
}

/**
 * What the run's checkout holds at `path`, read raw. Every folder on the way
 * must be a real folder, never a link; a file at the end is read without
 * following a link, and a link is its own name.
 */
class WorkingTree {
  private readonly folders = new Map<string, boolean>();
  private readonly ids: Map<string, { stamp: string; blob: WorkingBlob }>;

  constructor(
    readonly root: string,
    private readonly format: "sha1" | "sha256",
  ) {
    const key = `${format}\0${root}`;
    let ids = seen.get(key);
    if (ids === undefined) {
      ids = new Map();
      if (seen.size >= SEEN_CHECKOUTS) seen.delete(seen.keys().next().value!);
    } else seen.delete(key);
    seen.set(key, ids);
    this.ids = ids;
  }

  /** Whether every folder on `path`'s way is a real folder in the checkout. */
  private async reachable(segments: readonly string[]): Promise<boolean> {
    let at = this.root;
    for (let i = 0; i < segments.length - 1; i++) {
      at = join(at, segments[i]!);
      let real = this.folders.get(at);
      if (real === undefined) {
        real = await lstat(at).then((stat) => stat.isDirectory(), () => false);
        this.folders.set(at, real);
      }
      if (!real) return false;
    }
    return true;
  }

  /** The file at `path`, or `null` when there's none there to read as a file (gone, a folder, a link on the way, anything but a file or link). */
  private async stat(path: string): Promise<{ full: string; stat: BigIntStats } | null> {
    const segments = path.split("/");
    if (!segments.every(isSegment)) throw new Error(`"${path}" isn't a path a checkout holds.`);
    if (!(await this.reachable(segments))) return null;
    const full = join(this.root, ...segments);
    const stat = await lstat(full, { bigint: true }).catch(() => null);
    if (stat === null || !(stat.isFile() || stat.isSymbolicLink())) return null;
    return { full, stat };
  }

  /** `path`'s blob id as the run left it, or `null`. */
  async blob(path: string): Promise<WorkingBlob | null> {
    const found = await this.stat(path);
    if (found === null) return null;
    const stamp = stampOf(found.stat);
    const known = this.ids.get(path);
    if (known?.stamp === stamp) return known.blob;
    const hash = createHash(this.format);
    let blob: WorkingBlob;
    if (found.stat.isSymbolicLink()) {
      const target = await readlink(found.full, { encoding: "buffer" });
      blob = { id: hash.update(`blob ${target.length}\0`).update(target).digest("hex"), link: true };
    } else {
      const handle = await openFile(found.full, found.stat);
      if (handle === null) return null;
      try {
        hash.update(`blob ${found.stat.size}\0`);
        const chunk = Buffer.alloc(64 * 1024);
        let read = 0n;
        for (;;) {
          const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
          if (bytesRead === 0) break;
          read += BigInt(bytesRead);
          hash.update(chunk.subarray(0, bytesRead));
        }
        // Changed while read: a later poll reads it settled.
        if (read !== found.stat.size) return null;
      } finally {
        await handle.close();
      }
      blob = { id: hash.digest("hex"), link: false };
    }
    this.ids.set(path, { stamp, blob });
    return blob;
  }

  /** `path`'s content as the run left it (a link's name for a link), or `null` when it's gone or past {@link MAX_COPIED_BYTES}. */
  async content(path: string): Promise<Buffer | null> {
    const found = await this.stat(path);
    if (found === null || found.stat.size > BigInt(MAX_COPIED_BYTES)) return null;
    if (found.stat.isSymbolicLink()) return await readlink(found.full, { encoding: "buffer" });
    const handle = await openFile(found.full, found.stat);
    if (handle === null) return null;
    try {
      return await handle.readFile();
    } finally {
      await handle.close();
    }
  }
}

/** One file the run changed in its working tree against the base. */
export interface WorkingChange {
  path: string;
  /** Its blob id in the base, `null` when the base hasn't it. */
  base: string | null;
  /** Some of the change is only in the working tree: its content isn't HEAD's. */
  uncommitted: boolean;
}

/** The blob ids a working-tree read compares with, and the checkout as read. */
interface Snapshot {
  tree: WorkingTree;
  head: Map<string, string>;
  index: Map<string, string>;
  untracked: string[];
}

/** The checkout's object format: the hash a blob id is. */
async function formatOf(cwd: string): Promise<"sha1" | "sha256"> {
  return (await checkoutGit(cwd, ["rev-parse", "--show-object-format"])).trim() === "sha256" ? "sha256" : "sha1";
}

async function snapshot(cwd: string): Promise<Snapshot> {
  const format = await formatOf(cwd);
  const [head, index, untracked] = await Promise.all([
    treeOf(cwd, "HEAD"),
    checkoutGit(cwd, ["ls-files", "-s", "-z"]).then((out) => blobsOf(out, 1)),
    checkoutGit(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]).then(pathsOf),
  ]);
  return { tree: new WorkingTree(cwd, format), head, index, untracked };
}

/**
 * The files the run's working tree changed against `start`, sorted by path:
 * committed and not, and new files git doesn't ignore.
 */
export async function workingChanges(cwd: string, start: string): Promise<WorkingChange[]> {
  const [base, at] = await Promise.all([treeOf(cwd, start), snapshot(cwd)]);
  const paths = [...new Set([...base.keys(), ...at.head.keys(), ...at.index.keys(), ...at.untracked])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const changes: WorkingChange[] = [];
  for (const path of paths) {
    const work = (await at.tree.blob(path))?.id ?? null;
    const was = base.get(path) ?? null;
    if (work === was) continue;
    changes.push({ path, base: was, uncommitted: work !== (at.head.get(path) ?? null) });
  }
  return changes;
}

/**
 * Whether the run left anything in its working tree it didn't commit: a new
 * file git doesn't ignore, a staged change, or a file whose content isn't
 * HEAD's. What `git status --porcelain` would list, read without its filters.
 */
export async function workingTreeChanged(cwd: string): Promise<boolean> {
  const at = await snapshot(cwd);
  if (at.untracked.length > 0) return true;
  for (const path of new Set([...at.head.keys(), ...at.index.keys()])) {
    const head = at.head.get(path) ?? null;
    if ((at.index.get(path) ?? null) !== head) return true;
    if (((await at.tree.blob(path))?.id ?? null) !== head) return true;
  }
  return false;
}

/** Blob contents by id, read raw (`cat-file --batch`, which runs no filter). */
async function blobs(cwd: string, ids: readonly string[]): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  if (ids.length === 0) return out;
  const bytes = await checkoutGitBytes(cwd, ["cat-file", "--batch"], ids.map((id) => `${id}\n`).join(""));
  let at = 0;
  while (at < bytes.length) {
    const end = bytes.indexOf(0x0a, at);
    if (end === -1) break;
    const [id, type, size] = bytes.subarray(at, end).toString("utf8").split(" ");
    at = end + 1;
    if (type === undefined || size === undefined) continue;
    const length = Number.parseInt(size, 10);
    if (type === "blob") out.set(id!, bytes.subarray(at, at + length));
    at += length + 1;
  }
  return out;
}

/** A change's two sides, copied into `root` as `old/<n>` and `new/<n>`. `false` when a side is too large to copy. */
async function copySides(cwd: string, tree: WorkingTree, root: string, changes: readonly WorkingChange[]): Promise<boolean[]> {
  await mkdir(join(root, "old"));
  await mkdir(join(root, "new"));
  const old = await blobs(
    cwd,
    changes.flatMap((change) => (change.base === null ? [] : [change.base])),
  );
  const copied: boolean[] = [];
  for (const [n, change] of changes.entries()) {
    const before = change.base === null ? null : (old.get(change.base) ?? null);
    const after = await tree.content(change.path);
    if (change.base !== null && (before === null || before.length > MAX_COPIED_BYTES)) {
      copied.push(false);
      continue;
    }
    // Gone, or too large to copy: the side `tree.content` couldn't give.
    const gone = after === null && (await tree.blob(change.path)) === null;
    if (after === null && !gone) {
      copied.push(false);
      continue;
    }
    if (before !== null) await writeFile(join(root, "old", String(n)), before);
    if (after !== null) await writeFile(join(root, "new", String(n)), after);
    copied.push(true);
  }
  return copied;
}

/** A scratch directory of this process's own, removed after `use`. */
async function inScratch<T>(use: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "hm-changes-"));
  try {
    return await use(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** Lines added and removed in each change, `null` for binary or too large to copy. One git process for all of them. */
export async function countLines(cwd: string, changes: readonly WorkingChange[]): Promise<Array<{ added: number | null; removed: number | null }>> {
  const counts = changes.map(() => ({ added: null as number | null, removed: null as number | null }));
  if (changes.length === 0) return counts;
  const tree = new WorkingTree(cwd, await formatOf(cwd));
  await inScratch(async (root) => {
    const copied = await copySides(cwd, tree, root, changes);
    // `-z` numstat of two folders: `<added>\t<removed>\t\0<old>\0<new>\0`, one side `/dev/null` for a file only the other has.
    const fields = (await scratchDiff(root, ["--numstat", "-z", "old", "new"])).split("\0");
    for (let i = 0; i + 2 < fields.length; i += 3) {
      const [added, removed] = fields[i]!.split("\t");
      const side = fields[i + 1] === "/dev/null" ? fields[i + 2]! : fields[i + 1]!;
      const n = Number.parseInt(side.slice(side.indexOf("/") + 1), 10);
      if (!copied[n]) continue;
      counts[n] = { added: added === "-" ? null : Number.parseInt(added!, 10), removed: removed === "-" ? null : Number.parseInt(removed!, 10) };
    }
  });
  return counts;
}

/**
 * One change's patch, line by line to `onLine`, its header naming `path`
 * rather than the scratch copies. Nothing for a side too large to copy.
 */
export async function workingPatch(cwd: string, change: WorkingChange, onLine: (line: string) => void): Promise<void> {
  const tree = new WorkingTree(cwd, await formatOf(cwd));
  await inScratch(async (root) => {
    const [copied] = await copySides(cwd, tree, root, [change]);
    if (!copied) return;
    const old = change.base === null ? "/dev/null" : "old/0";
    const fresh = (await tree.blob(change.path)) === null ? "/dev/null" : "new/0";
    let header = true;
    await scratchDiff(root, [old, fresh], (line) => {
      if (header && line.startsWith("@@")) header = false;
      onLine(header ? line.replaceAll(/\b(a|b)\/(old|new)\/0\b/g, (_, side: string) => `${side}/${change.path}`) : line);
    });
  });
}
