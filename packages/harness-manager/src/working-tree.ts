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
 * Every read is bounded ({@link WORKING_TREE_LIMITS}): a file whose size
 * differs from its blob's is changed without being read, and the hashing the
 * rest need stops at a count of files, a count of bytes and a deadline,
 * throwing {@link WorkingTreeOverBudget}. A copy is read up to
 * {@link MAX_COPIED_BYTES} and no further. Hashes are kept while a file's
 * stat is unchanged, so a checkout too large for one read is finished over
 * the next ones.
 *
 * Raw content is what a run left on disk. A checkout that converts line
 * endings on commit (`core.autocrlf`, an `eol` attribute) reads a file whose
 * bytes differ from its blob as changed, where git would say it isn't.
 *
 * Each folder on a path is checked to be a real folder before the file is
 * opened without following a link; a folder swapped for a link in between is
 * a window this leaves (Node has no `openat`), and it can only show the
 * person reading the changes a file of their own machine.
 */

import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, mkdtemp, mkdir, open, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkoutGit, checkoutGitBytes, scratchDiff } from "./safe-git";

/** The largest file a working-tree read copies to count its lines or draw its patch. Past it, the file is listed with no lines. */
export const MAX_COPIED_BYTES = 4 * 1024 * 1024;

/**
 * What one working-tree read may hash before it gives up: files, bytes, and
 * milliseconds from its start. Exported for tests, which lower them.
 */
export const WORKING_TREE_LIMITS = { files: 50_000, bytes: 512 * 1024 * 1024, ms: 8_000 };

/** A working-tree read reached one of {@link WORKING_TREE_LIMITS} before it could tell what changed. */
export class WorkingTreeOverBudget extends Error {
  constructor(limit: "files" | "bytes" | "time") {
    super(`[harness-manager] reading the run's working tree reached its ${limit} limit; its changes weren't read.`);
    this.name = "WorkingTreeOverBudget";
  }
}

/** One read's spending against {@link WORKING_TREE_LIMITS}. */
class Budget {
  private files = 0;
  private bytes = 0;
  private readonly until = Date.now() + WORKING_TREE_LIMITS.ms;

  /** Throws once the deadline has passed. */
  tick(): void {
    if (Date.now() > this.until) throw new WorkingTreeOverBudget("time");
  }

  /** One more file to hash. */
  file(): void {
    this.tick();
    if (++this.files > WORKING_TREE_LIMITS.files) throw new WorkingTreeOverBudget("files");
  }

  /** `count` more bytes hashed. */
  spend(count: number): void {
    this.tick();
    this.bytes += count;
    if (this.bytes > WORKING_TREE_LIMITS.bytes) throw new WorkingTreeOverBudget("bytes");
  }
}

/** Paths from a `-z` listing. */
const pathsOf = (out: string) => out.split("\0").filter((path) => path !== "");

/** A blob a tree or the index names: its id, and its size when the listing gave one. */
interface Blob {
  id: string;
  size: number | null;
}

/**
 * Each path's blob from a `-z` listing, gitlinks left out: `ls-tree -l`
 * (`<mode> <type> <id> <size>\t<path>`) or `ls-files -s` (`<mode> <id> <stage>\t<path>`).
 */
function blobsOf(out: string, idField: number, sizeField: number | null): Map<string, Blob> {
  const blobs = new Map<string, Blob>();
  for (const record of pathsOf(out)) {
    const tab = record.indexOf("\t");
    const fields = record.slice(0, tab).split(" ").filter((field) => field !== "");
    if (fields[0] === "160000") continue;
    const size = sizeField === null ? Number.NaN : Number.parseInt(fields[sizeField] ?? "", 10);
    blobs.set(record.slice(tab + 1), { id: fields[idField]!, size: Number.isNaN(size) ? null : size });
  }
  return blobs;
}

/** A commit's files, their blob ids and sizes. */
async function treeOf(cwd: string, rev: string): Promise<Map<string, Blob>> {
  return blobsOf(await checkoutGit(cwd, ["ls-tree", "-r", "-l", "-z", "--full-tree", rev]), 2, 3);
}

/** A segment git writes into a tree; anything else is no file the run could have. */
const isSegment = (segment: string) => segment !== "" && segment !== "." && segment !== ".." && segment !== ".git" && !segment.includes("\0");

/** Last reads' blob ids, by checkout and path, kept while the file's stat is unchanged: a poll re-hashes only what moved. */
const seen = new Map<string, Map<string, { stamp: string; id: string }>>();
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
 * What the run's checkout holds at a path, read raw and within one read's
 * {@link Budget}. Every folder on the way must be a real folder, never a
 * link; a file at the end is read without following a link, and a link is
 * its own name.
 */
class WorkingTree {
  private readonly folders = new Map<string, boolean>();
  private readonly ids: Map<string, { stamp: string; id: string }>;
  private readonly budget = new Budget();

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
    this.budget.tick();
    const segments = path.split("/");
    if (!segments.every(isSegment)) throw new Error(`"${path}" isn't a path a checkout holds.`);
    if (!(await this.reachable(segments))) return null;
    const full = join(this.root, ...segments);
    const stat = await lstat(full, { bigint: true }).catch(() => null);
    if (stat === null || !(stat.isFile() || stat.isSymbolicLink())) return null;
    return { full, stat };
  }

  /** Whether the checkout holds anything at `path` to read as a file. */
  async exists(path: string): Promise<boolean> {
    return (await this.stat(path)) !== null;
  }

  /**
   * Whether `path`, as the run left it, differs from `blob` (`null`: none).
   * A size that differs answers without reading; the rest are hashed, within
   * the budget. A file that changes while it's hashed counts as changed.
   */
  async differs(path: string, blob: Blob | null): Promise<boolean> {
    const found = await this.stat(path);
    if (found === null || blob === null) return (found === null) !== (blob === null);
    // A link's lstat size is its name's length, as its blob's is.
    if (blob.size !== null && BigInt(blob.size) !== found.stat.size) return true;
    const id = await this.idOf(found.full, found.stat, path);
    return id !== blob.id;
  }

  /** The blob id of what's at `full`, from the cache while its stat is unchanged; `null` when it changed while read. */
  private async idOf(full: string, stat: BigIntStats, path: string): Promise<string | null> {
    const stamp = stampOf(stat);
    const known = this.ids.get(path);
    if (known?.stamp === stamp) return known.id;
    this.budget.file();
    const hash = createHash(this.format);
    if (stat.isSymbolicLink()) {
      const target = await readlink(full, { encoding: "buffer" });
      hash.update(`blob ${target.length}\0`).update(target);
    } else {
      const handle = await openFile(full, stat);
      if (handle === null) return null;
      try {
        hash.update(`blob ${stat.size}\0`);
        const chunk = Buffer.alloc(64 * 1024);
        let read = 0n;
        for (;;) {
          const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
          if (bytesRead === 0) break;
          this.budget.spend(bytesRead);
          read += BigInt(bytesRead);
          // Grew past what it was measured at: changed while read.
          if (read > stat.size) return null;
          hash.update(chunk.subarray(0, bytesRead));
        }
        if (read !== stat.size) return null;
      } finally {
        await handle.close();
      }
    }
    const id = hash.digest("hex");
    this.ids.set(path, { stamp, id });
    return id;
  }

  /**
   * `path`'s content as the run left it (a link's name for a link), or
   * `null` when it's gone, past {@link MAX_COPIED_BYTES}, or not the size it
   * was measured at by the time it's read. Never reads past the cap.
   */
  async content(path: string): Promise<Buffer | null> {
    const found = await this.stat(path);
    if (found === null || found.stat.size > BigInt(MAX_COPIED_BYTES)) return null;
    if (found.stat.isSymbolicLink()) return await readlink(found.full, { encoding: "buffer" });
    const handle = await openFile(found.full, found.stat);
    if (handle === null) return null;
    try {
      // One byte past the cap tells a file that grew from one that's exactly at it.
      const into = Buffer.alloc(MAX_COPIED_BYTES + 1);
      let read = 0;
      while (read < into.length) {
        const { bytesRead } = await handle.read(into, read, into.length - read, null);
        if (bytesRead === 0) break;
        read += bytesRead;
      }
      if (read > MAX_COPIED_BYTES || BigInt(read) !== found.stat.size) return null;
      return into.subarray(0, read);
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

/** The blobs a working-tree read compares with, and the checkout as read. */
interface Snapshot {
  tree: WorkingTree;
  head: Map<string, Blob>;
  index: Map<string, Blob>;
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
    checkoutGit(cwd, ["ls-files", "-s", "-z"]).then((out) => blobsOf(out, 1, null)),
    checkoutGit(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]).then(pathsOf),
  ]);
  return { tree: new WorkingTree(cwd, format), head, index, untracked };
}

/**
 * The files the run's working tree changed against `start`, sorted by path:
 * committed and not, and new files git doesn't ignore.
 *
 * @throws WorkingTreeOverBudget past {@link WORKING_TREE_LIMITS}.
 */
export async function workingChanges(cwd: string, start: string): Promise<WorkingChange[]> {
  const [base, at] = await Promise.all([treeOf(cwd, start), snapshot(cwd)]);
  const paths = [...new Set([...base.keys(), ...at.head.keys(), ...at.index.keys(), ...at.untracked])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const changes: WorkingChange[] = [];
  for (const path of paths) {
    const was = base.get(path) ?? null;
    if (!(await at.tree.differs(path, was))) continue;
    changes.push({ path, base: was?.id ?? null, uncommitted: await at.tree.differs(path, at.head.get(path) ?? null) });
  }
  return changes;
}

/**
 * Whether the run left anything in its working tree it didn't commit: a new
 * file git doesn't ignore, a staged change, or a file whose content isn't
 * HEAD's. What `git status --porcelain` would list, read without its filters.
 *
 * @throws WorkingTreeOverBudget past {@link WORKING_TREE_LIMITS}.
 */
export async function workingTreeChanged(cwd: string): Promise<boolean> {
  const at = await snapshot(cwd);
  if (at.untracked.length > 0) return true;
  for (const path of new Set([...at.head.keys(), ...at.index.keys()])) {
    const head = at.head.get(path) ?? null;
    if ((at.index.get(path)?.id ?? null) !== (head?.id ?? null)) return true;
    if (await at.tree.differs(path, head)) return true;
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
    if (change.base !== null && (before === null || before.length > MAX_COPIED_BYTES)) {
      copied.push(false);
      continue;
    }
    const after = await tree.content(change.path);
    // Not there, or there but not copyable (too large, or changed as it was read): no lines for it.
    if (after === null && (await tree.exists(change.path))) {
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

/** Lines added and removed in each change, `null` for binary or not copyable. One git process for all of them. */
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
 * rather than the scratch copies. Nothing for a side not copyable.
 */
export async function workingPatch(cwd: string, change: WorkingChange, onLine: (line: string) => void): Promise<void> {
  const tree = new WorkingTree(cwd, await formatOf(cwd));
  await inScratch(async (root) => {
    const [copied] = await copySides(cwd, tree, root, [change]);
    if (!copied) return;
    const old = change.base === null ? "/dev/null" : "old/0";
    const fresh = (await tree.exists(change.path)) ? "new/0" : "/dev/null";
    let header = true;
    await scratchDiff(root, [old, fresh], (line) => {
      if (header && line.startsWith("@@")) header = false;
      onLine(header ? line.replaceAll(/\b(a|b)\/(old|new)\/0\b/g, (_, side: string) => `${side}/${change.path}`) : line);
    });
  });
}
