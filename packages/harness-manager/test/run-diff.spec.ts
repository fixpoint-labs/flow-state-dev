/**
 * What a run changed is what its own commits changed (FIX-2384): never a
 * file its base changed after the branch was cut, and never a file the run
 * left uncommitted, since a review accepts the branch.
 *
 * Reviewers accept a run's changes from this read, so a read that let the
 * base's later work in would show them changes nobody on the run made, and
 * one that missed a file would hide one that is about to land.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { MAX_DIFF_FILES, MAX_PATCH_CHARS, RunFileNotChanged, effectiveCut, readRunDiff, readRunFilePatch } from "../src/commits";

const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
  });
}

function commitFiles(cwd: string, subject: string, files: Record<string, string | Buffer>): void {
  for (const [path, body] of Object.entries(files)) writeFileSync(join(cwd, path), body);
  git(cwd, "add", ".");
  git(cwd, "commit", "-q", "-m", subject);
}

/** A repository on `main` with one file, and a run branch cut from it. Returns the dir and the cut commit. */
function repo(): { dir: string; cut: string } {
  const dir = mkdtempSync(join(tmpdir(), "hm-diff-"));
  dirs.push(dir);
  git(dir, "init", "-q", "-b", "main");
  commitFiles(dir, "first", { "a.txt": "one\ntwo\nthree\n" });
  git(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(dir, "checkout", "-q", "-b", "run");
  return { dir, cut: git(dir, "rev-parse", "HEAD").trim() };
}

describe("readRunDiff", () => {
  it("lists each file the run's commits changed, with its lines, and the totals", async () => {
    const { dir, cut } = repo();
    commitFiles(dir, "change", { "a.txt": "one\n2\nthree\nfour\n", "b.txt": "new\n" });
    commitFiles(dir, "binary", { "c.bin": Buffer.from([0, 1, 2, 0, 255]) });
    expect(await readRunDiff(dir, "main", cut)).toEqual({
      files: [
        { path: "a.txt", added: 2, removed: 1 },
        { path: "b.txt", added: 1, removed: 0 },
        { path: "c.bin", added: null, removed: null },
      ],
      fileCount: 3,
      added: 3,
      removed: 1,
      verified: true,
    });
  });

  it("leaves out what the base changed after the branch was cut, and what the run left uncommitted", async () => {
    const { dir, cut } = repo();
    commitFiles(dir, "the run's change", { "b.txt": "run\n" });
    // The base moves on, by its named copies: the recorded cut is what counts.
    git(dir, "checkout", "-q", "main");
    commitFiles(dir, "someone else's", { "z.txt": "theirs\n" });
    git(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
    git(dir, "checkout", "-q", "run");
    writeFileSync(join(dir, "a.txt"), "uncommitted\n");
    for (const base of [cut, null]) {
      const diff = await readRunDiff(dir, "main", base);
      expect(diff.files.map((file) => file.path)).toEqual(["b.txt"]);
      expect(diff.verified).toBe(true);
    }
  });

  it("leaves out what the base changed after the run merged it in, read against the effective cut", async () => {
    // The pull request's diff starts where the run's branch and the base's
    // tip meet: a run that merged the moved-on base in owns none of its files.
    const { dir, cut } = repo();
    commitFiles(dir, "the run's change", { "b.txt": "run\n" });
    git(dir, "checkout", "-q", "main");
    commitFiles(dir, "someone else's", { "z.txt": "theirs\n" });
    const tip = git(dir, "rev-parse", "HEAD").trim();
    git(dir, "checkout", "-q", "run");
    git(dir, "merge", "-q", "--no-edit", "main");
    expect((await readRunDiff(dir, "main", cut)).files.map((file) => file.path)).toEqual(["b.txt", "z.txt"]);
    const base = await effectiveCut(dir, cut, tip);
    const diff = await readRunDiff(dir, "main", base);
    expect(diff.files.map((file) => file.path)).toEqual(["b.txt"]);
    expect(diff.verified).toBe(true);
    await expect(readRunFilePatch(dir, "main", base, "z.txt")).rejects.toBeInstanceOf(RunFileNotChanged);
  });

  it("ignores a tip that doesn't descend from the cut, and reads against the cut as before", async () => {
    // A tip from a rewritten base (or anything else not past the cut) is no
    // evidence of what the run didn't make: the read over-reports, never hides.
    const { dir, cut } = repo();
    commitFiles(dir, "the run's change", { "b.txt": "run\n" });
    git(dir, "checkout", "-q", "--orphan", "rewritten");
    commitFiles(dir, "unrelated", { "b.txt": "other\n" });
    const unrelated = git(dir, "rev-parse", "HEAD").trim();
    git(dir, "checkout", "-q", "-f", "run");
    for (const tip of [unrelated, "0".repeat(40)]) {
      const diff = await readRunDiff(dir, "main", await effectiveCut(dir, cut, tip));
      expect(diff.files.map((file) => file.path)).toEqual(["b.txt"]);
      expect(diff.verified).toBe(true);
    }
  });

  it("reads up to an end commit, so a later turn's work isn't counted in an earlier one", async () => {
    const { dir, cut } = repo();
    commitFiles(dir, "turn one", { "b.txt": "one\n" });
    const end = git(dir, "rev-parse", "HEAD").trim();
    commitFiles(dir, "turn two", { "c.txt": "two\n" });
    expect((await readRunDiff(dir, "main", cut, { head: end })).files.map((file) => file.path)).toEqual(["b.txt"]);
    expect((await readRunDiff(dir, "main", cut)).files.map((file) => file.path)).toEqual(["b.txt", "c.txt"]);
  });

  it(`lists at most ${MAX_DIFF_FILES} files and still counts every one in the totals`, async () => {
    const { dir, cut } = repo();
    const files = Object.fromEntries(Array.from({ length: MAX_DIFF_FILES + 5 }, (_, i) => [`f${String(i).padStart(3, "0")}.txt`, "x\n"]));
    commitFiles(dir, "many", files);
    const diff = await readRunDiff(dir, "main", cut);
    expect(diff.files).toHaveLength(MAX_DIFF_FILES);
    expect(diff).toMatchObject({ fileCount: MAX_DIFF_FILES + 5, added: MAX_DIFF_FILES + 5, verified: true });
  });

  it("answers an empty diff for a base the checkout doesn't have, and says it couldn't tell", async () => {
    const { dir } = repo();
    expect(await readRunDiff(dir, "no-such-branch")).toEqual({ files: [], fileCount: 0, added: 0, removed: 0, verified: false });
    expect(await readRunDiff(dir, null)).toMatchObject({ verified: false });
  });
});

describe("readRunFilePatch", () => {
  it("answers one file's patch from the run's commits alone", async () => {
    const { dir, cut } = repo();
    commitFiles(dir, "change", { "a.txt": "one\n2\nthree\n", "b.txt": "other\n" });
    const read = await readRunFilePatch(dir, "main", cut, "a.txt");
    expect(read).toMatchObject({ path: "a.txt", truncated: false, verified: true });
    expect(read.patch).toContain("-two");
    expect(read.patch).toContain("+2");
    expect(read.patch).not.toContain("b.txt");
  });

  it("reads the path literally, so a glob names no other file", async () => {
    const { dir, cut } = repo();
    commitFiles(dir, "change", { "a.txt": "changed\n", "b.txt": "new\n" });
    await expect(readRunFilePatch(dir, "main", cut, "*.txt")).rejects.toBeInstanceOf(RunFileNotChanged);
  });

  it("refuses a path the run didn't change: a file it never touched, a folder, or one outside the checkout", async () => {
    // Only the change's own files open: a reviewer's screen can't be turned into a reader of the repository.
    const { dir, cut } = repo();
    mkdirSync(join(dir, "src"));
    commitFiles(dir, "change", { "src/a.txt": "changed\n" });
    for (const path of ["a.txt", "src", "../outside.txt", "/etc/hosts"]) {
      await expect(readRunFilePatch(dir, "main", cut, path), path).rejects.toBeInstanceOf(RunFileNotChanged);
    }
    expect((await readRunFilePatch(dir, "main", cut, "src/a.txt")).patch).toContain("+changed");
  });

  it("answers the run's own patch after it planted a replace ref that swaps its HEAD for a harmless one", async () => {
    const { dir, cut } = repo();
    commitFiles(dir, "change", { "a.txt": "one\n2\nthree\n" });
    const head = git(dir, "rev-parse", "HEAD").trim();
    const harmless = git(dir, "commit-tree", `${cut}^{tree}`, "-p", cut, "-m", "harmless").trim();
    git(dir, "replace", head, harmless);
    const read = await readRunFilePatch(dir, "main", cut, "a.txt");
    expect(read.verified).toBe(true);
    expect(read.patch).toContain("+2");
  });

  it("answers the run's whole diff after it planted a shallow file that cuts its history at its HEAD", async () => {
    const { dir, cut } = repo();
    commitFiles(dir, "first change", { "b.txt": "b\n" });
    commitFiles(dir, "second change", { "c.txt": "c\n" });
    writeFileSync(join(dir, ".git", "shallow"), `${git(dir, "rev-parse", "HEAD").trim()}\n`);
    expect(await readRunDiff(dir, "main", cut)).toMatchObject({ fileCount: 2, added: 2, removed: 0, verified: true });
    expect((await readRunFilePatch(dir, "main", cut, "b.txt")).patch).toContain("+b");
  });

  it(`cuts a patch at ${MAX_PATCH_CHARS} characters and says so`, async () => {
    const { dir, cut } = repo();
    commitFiles(dir, "big", { "big.txt": `${"x".repeat(99)}\n`.repeat(1_000) });
    const read = await readRunFilePatch(dir, "main", cut, "big.txt");
    expect(read.truncated).toBe(true);
    expect(read.patch.length).toBe(MAX_PATCH_CHARS);
    // The whole patch's length, counted past the cut, so the screen can say how much it isn't showing.
    expect(read.lines).toBe(1_006);
  });

  it("answers no patch for a base the checkout doesn't have, and says it couldn't tell", async () => {
    const { dir } = repo();
    expect(await readRunFilePatch(dir, "no-such-branch", null, "a.txt")).toEqual({
      path: "a.txt",
      patch: "",
      truncated: false,
      lines: 0,
      verified: false,
    });
  });
});

describe("a running run's changes, uncommitted ones included", () => {
  /** A run that committed b.txt, then edited a.txt and wrote new.txt without committing, beside an ignored file. */
  function working() {
    const { dir, cut } = repo();
    commitFiles(dir, "the run's change", { "b.txt": "run\n", ".gitignore": "ignored.log\n" });
    writeFileSync(join(dir, "a.txt"), "one\nTWO\nthree\n");
    writeFileSync(join(dir, "new.txt"), "fresh\nlines\n");
    writeFileSync(join(dir, "ignored.log"), "noise\n");
    return { dir, cut };
  }

  it("lists the committed files and the ones still in the working tree, marking the uncommitted", async () => {
    // A harness edits before it commits: committed-only would read a busy run as idle.
    const { dir, cut } = working();
    const diff = await readRunDiff(dir, "main", cut, { uncommitted: true });
    expect(diff).toEqual({
      files: [
        { path: ".gitignore", added: 1, removed: 0 },
        { path: "a.txt", added: 1, removed: 1, uncommitted: true },
        { path: "b.txt", added: 1, removed: 0 },
        { path: "new.txt", added: 2, removed: 0, uncommitted: true },
      ],
      fileCount: 4,
      added: 5,
      removed: 1,
      verified: true,
    });
    // The review's read is unchanged: only what the run committed.
    expect((await readRunDiff(dir, "main", cut)).files.map((file) => file.path)).toEqual([".gitignore", "b.txt"]);
  });

  it("opens an uncommitted file's patch, tracked or new, and refuses an ignored or untouched one", async () => {
    const { dir, cut } = working();
    expect((await readRunFilePatch(dir, "main", cut, "a.txt", { uncommitted: true })).patch).toContain("+TWO");
    const fresh = await readRunFilePatch(dir, "main", cut, "new.txt", { uncommitted: true });
    expect(fresh).toMatchObject({ truncated: false, verified: true });
    expect(fresh.patch).toContain("+fresh");
    for (const path of ["ignored.log", "nope.txt", "../outside.txt"]) {
      await expect(readRunFilePatch(dir, "main", cut, path, { uncommitted: true }), path).rejects.toBeInstanceOf(RunFileNotChanged);
    }
    // Committed only, the uncommitted files aren't the change.
    await expect(readRunFilePatch(dir, "main", cut, "new.txt")).rejects.toBeInstanceOf(RunFileNotChanged);
  });

  it("reads a new symlink as its target's name, never the file it points at", async () => {
    const outside = mkdtempSync(join(tmpdir(), "hm-outside-"));
    dirs.push(outside);
    writeFileSync(join(outside, "secret.txt"), "the secret\n");
    const { dir, cut } = working();
    symlinkSync(join(outside, "secret.txt"), join(dir, "link.txt"));
    const read = await readRunFilePatch(dir, "main", cut, "link.txt", { uncommitted: true });
    expect(read.patch).toContain(`+${join(outside, "secret.txt")}`);
    expect(read.patch).not.toContain("the secret");
  });

  it("leaves the checkout's index alone, so a harness committing at the same moment never meets a lock", async () => {
    const { dir, cut } = working();
    const before = git(dir, "ls-files", "--stage");
    await readRunDiff(dir, "main", cut, { uncommitted: true });
    await readRunFilePatch(dir, "main", cut, "new.txt", { uncommitted: true });
    expect(git(dir, "ls-files", "--stage")).toBe(before);
    expect(git(dir, "status", "--porcelain")).toContain("?? new.txt");
  });
});
