/**
 * A working-tree read is bounded, whatever the run left in its checkout: a
 * file copied for its lines is read up to the cap and no further, and the
 * hashing that finds what changed stops at a count of files, a count of
 * bytes and a deadline. Past a limit, the panel's read says it couldn't tell
 * (`verified: false`) and the run-end read says the run changed files, so its
 * checks still run.
 *
 * Red states: a file that grows after it was measured read whole; a checkout
 * of many large files hashed to the end however long it takes.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type * as FsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

/** Opens pass through; a path named here grows by `grow` bytes on its nth open, after it was measured. */
const growth: { path: string | null; onOpen: number; grow: number; opens: number } = { path: null, onOpen: 0, grow: 0, opens: 0 };

vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof FsPromises>();
  return {
    ...real,
    open: async (...args: Parameters<typeof real.open>) => {
      const handle = await real.open(...args);
      if (growth.path !== null && String(args[0]) === growth.path && ++growth.opens === growth.onOpen) {
        appendFileSync(growth.path, "grown\n".repeat(Math.ceil(growth.grow / 6)));
      }
      return handle;
    },
  };
});

const { readRunDiff, readRunFilePatch } = await import("../src/commits");
const { runChangedFiles } = await import("../src/kit/coder-flow");
const { MAX_COPIED_BYTES, WORKING_TREE_LIMITS } = await import("../src/working-tree");

const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const DEFAULTS = { ...WORKING_TREE_LIMITS };
afterEach(() => {
  Object.assign(WORKING_TREE_LIMITS, DEFAULTS);
  growth.path = null;
  growth.opens = 0;
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });
}

/** A checkout cut at `cut`, holding `files` committed after it. */
function checkout(files: Record<string, string> = {}): { dir: string; cut: string } {
  const dir = mkdtempSync(join(tmpdir(), "hm-limits-"));
  dirs.push(dir);
  git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "seed.txt"), "seed\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "seed");
  const cut = git(dir, "rev-parse", "HEAD").trim();
  git(dir, "checkout", "-q", "-b", "run");
  for (const [path, content] of Object.entries(files)) writeFileSync(join(dir, path), content);
  if (Object.keys(files).length > 0) {
    git(dir, "add", ".");
    git(dir, "commit", "-q", "-m", "the run's files");
  }
  return { dir, cut };
}

const atRunEnd = (dir: string, cut: string) => runChangedFiles({ workspacePath: dir, baseCommit: cut } as never);

describe("a file copied for its lines", () => {
  it("is read no further than the cap when it grows after it was measured, and counts no lines", async () => {
    const { dir, cut } = checkout();
    const path = join(dir, "grows.txt");
    writeFileSync(path, "small\n");
    // It grows once opened, after it was measured: whether that open hashes it or copies it, no lines come of it.
    Object.assign(growth, { path, onOpen: 1, grow: MAX_COPIED_BYTES + 1024 });
    const diff = await readRunDiff(dir, "main", cut, { uncommitted: true });
    expect(diff.files.find((file) => file.path === "grows.txt")).toEqual({ path: "grows.txt", added: null, removed: null, uncommitted: true });
  }, 60_000);

  it("draws no patch for it either", async () => {
    const { dir, cut } = checkout();
    const path = join(dir, "grows.txt");
    writeFileSync(path, "small\n");
    Object.assign(growth, { path, onOpen: 1, grow: MAX_COPIED_BYTES + 1024 });
    const read = await readRunFilePatch(dir, "main", cut, "grows.txt", { uncommitted: true });
    expect(read.patch).not.toContain("grown");
  }, 60_000);
});

describe("the hashing that finds what changed", () => {
  /** A checkout of `count` committed files of `size` bytes, each then rewritten in place at the same size: only hashing tells. */
  function rewritten(count: number, size: number) {
    const files = Object.fromEntries(Array.from({ length: count }, (_, i) => [`f${i}.bin`, "a".repeat(size)]));
    const { dir, cut } = checkout(files);
    for (const name of Object.keys(files)) writeFileSync(join(dir, name), "b".repeat(size));
    return { dir, cut };
  }

  it("stops at its count of files, and says it couldn't tell", async () => {
    const { dir, cut } = rewritten(12, 10);
    WORKING_TREE_LIMITS.files = 5;
    expect((await readRunDiff(dir, "main", cut, { uncommitted: true })).verified).toBe(false);
    expect((await readRunFilePatch(dir, "main", cut, "f0.bin", { uncommitted: true })).verified).toBe(false);
    // At the run's end, a read it couldn't finish counts as changed, so the checks run.
    expect(await atRunEnd(dir, cut)).toBe(true);
  }, 60_000);

  it("stops at its count of bytes", async () => {
    const { dir, cut } = rewritten(4, 64 * 1024);
    WORKING_TREE_LIMITS.bytes = 100 * 1024;
    expect((await readRunDiff(dir, "main", cut, { uncommitted: true })).verified).toBe(false);
    expect(await atRunEnd(dir, cut)).toBe(true);
  }, 60_000);

  it("stops at its deadline, quickly", async () => {
    const { dir, cut } = rewritten(40, 256 * 1024);
    WORKING_TREE_LIMITS.ms = 1;
    const started = Date.now();
    expect((await readRunDiff(dir, "main", cut, { uncommitted: true })).verified).toBe(false);
    expect(await atRunEnd(dir, cut)).toBe(true);
    expect(Date.now() - started).toBeLessThan(5_000);
  }, 60_000);

  it("within its limits, still finds a same-size rewrite and a clean tree", async () => {
    const { dir, cut } = rewritten(3, 10);
    const diff = await readRunDiff(dir, "main", cut, { uncommitted: true });
    expect(diff).toMatchObject({ verified: true, fileCount: 3 });
    expect(diff.files.every((file) => file.uncommitted === true)).toBe(true);
    git(dir, "checkout", "-q", "--", ".");
    expect(await atRunEnd(dir, cut)).toBe(true);
    // Committed but nothing left over: the tree still differs from the cut.
    expect((await readRunDiff(dir, "main", cut, { uncommitted: true })).files.some((file) => file.uncommitted)).toBe(false);
  }, 60_000);
});
