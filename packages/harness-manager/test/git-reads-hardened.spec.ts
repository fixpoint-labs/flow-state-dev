/**
 * The git reads a review screen makes in a run's checkout run none of the
 * run's commands. A coding run can write its checkout's config (`.git/config`,
 * a worktree's `config.worktree`) and `.gitattributes`, and git runs a command
 * named there on some reads: an fsmonitor hook, an external diff, a textconv
 * or diff driver, a clean/smudge/process filter, a signature check's gpg. Those
 * reads run in the server process when a person opens the changes panel, so
 * each is switched off for every read here.
 *
 * Red state: a checkout whose config names a script that writes a marker
 * file, and a read that leaves the marker behind.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { effectiveCut, headCommit, readRunCommits, readRunDiff, readRunFilePatch } from "../src/commits";
import { runChangedFiles } from "../src/kit/coder-flow";
import type { CompletionRunContext } from "../src/manager";

const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });
}

/**
 * A run's checkout: a committed change to a.txt, an uncommitted one to b.txt,
 * a new file, all under a `.gitattributes` naming the `evil` diff driver and
 * filter. `marker` is the file the planted script writes when git runs it.
 */
function checkout(): { dir: string; cut: string; marker: string; script: string } {
  const dir = mkdtempSync(join(tmpdir(), "hm-hardened-"));
  dirs.push(dir);
  const marker = join(dir, "..", `${dir.split("/").pop()}-ran`);
  dirs.push(marker);
  const script = join(dir, "..", `${dir.split("/").pop()}-evil.sh`);
  dirs.push(script);
  // Writes the marker, then passes its input through (or prints the file it was given), so a read it runs still works.
  writeFileSync(script, `#!/bin/sh\ntouch '${marker}'\nif [ -n "$1" ] && [ -f "$1" ]; then cat "$1"; else cat; fi\n`);
  chmodSync(script, 0o755);
  git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "a.txt"), "one\n");
  writeFileSync(join(dir, "b.txt"), "two\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "first");
  git(dir, "checkout", "-q", "-b", "run");
  const cut = git(dir, "rev-parse", "HEAD").trim();
  writeFileSync(join(dir, ".gitattributes"), "*.txt diff=evil filter=evil\n");
  writeFileSync(join(dir, "a.txt"), "one\nchanged\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "the run's change");
  writeFileSync(join(dir, "b.txt"), "two\nuncommitted\n");
  writeFileSync(join(dir, "new.txt"), "new\n");
  return { dir, cut, marker, script };
}

/** Every read the changes panel can trigger, committed and working tree, list and patch, and the commits. */
async function everyRead(dir: string, cut: string) {
  await headCommit(dir);
  await effectiveCut(dir, cut, cut);
  const committed = await readRunDiff(dir, "main", cut);
  const working = await readRunDiff(dir, "main", cut, { uncommitted: true });
  const patches = [
    await readRunFilePatch(dir, "main", cut, "a.txt"),
    await readRunFilePatch(dir, "main", cut, "b.txt", { uncommitted: true }),
    await readRunFilePatch(dir, "main", cut, "new.txt", { uncommitted: true }),
  ];
  const commits = await readRunCommits(dir, "main", cut, { log: true });
  return { committed, working, patches, commits };
}

const plants: Array<[string, (dir: string, script: string) => void]> = [
  ["core.fsmonitor", (dir, script) => git(dir, "config", "core.fsmonitor", script)],
  ["core.fsmonitor, in the worktree's own config", (dir, script) => {
    git(dir, "config", "extensions.worktreeConfig", "true");
    git(dir, "config", "--worktree", "core.fsmonitor", script);
  }],
  ["diff.external", (dir, script) => git(dir, "config", "diff.external", script)],
  ["a textconv driver", (dir, script) => git(dir, "config", "diff.evil.textconv", script)],
  ["a diff driver's command", (dir, script) => git(dir, "config", "diff.evil.command", script)],
  ["a clean and smudge filter", (dir, script) => {
    git(dir, "config", "filter.evil.clean", script);
    git(dir, "config", "filter.evil.smudge", script);
  }],
  ["a long-running filter process", (dir, script) => git(dir, "config", "filter.evil.process", script)],
  ["a signature check's gpg", (dir, script) => {
    git(dir, "config", "log.showSignature", "true");
    git(dir, "config", "gpg.program", script);
  }],
  ["any of them, through an included config file", (dir, script) => {
    const included = join(dir, ".git", "evil.config");
    writeFileSync(included, `[core]\n\tfsmonitor = ${script}\n[diff]\n\texternal = ${script}\n[filter "evil"]\n\tclean = ${script}\n\tprocess = ${script}\n`);
    git(dir, "config", "include.path", included);
  }],
  // An override built as `-c filter.<name>.clean=` splits at the first `=`, so this name would set another key and leave the driver live.
  ["a filter and diff driver named with an `=` in it", (dir, script) => {
    writeFileSync(join(dir, ".gitattributes"), "*.txt diff=a=b filter=a=b\n");
    git(dir, "config", "filter.a=b.clean", script);
    git(dir, "config", "filter.a=b.process", script);
    git(dir, "config", "diff.a=b.textconv", script);
  }],
  ["a filter defined in `info/attributes`, outside the work tree", (dir, script) => {
    writeFileSync(join(dir, ".git", "info", "attributes"), "* filter=hidden\n");
    git(dir, "config", "filter.hidden.clean", script);
  }],
];

describe("a review's git reads in a run's checkout", () => {
  for (const [what, plant] of plants) {
    it(`run no command the checkout's config names: ${what}`, async () => {
      const { dir, cut, marker, script } = checkout();
      plant(dir, script);
      const read = await everyRead(dir, cut);
      expect(existsSync(marker), `git ran the planted ${what}`).toBe(false);
      // And the reads still answer: switched off, not broken.
      expect(read.committed).toMatchObject({ verified: true, fileCount: 2 });
      expect(read.working.files.map((file) => file.path)).toEqual([".gitattributes", "a.txt", "b.txt", "new.txt"]);
      expect(read.patches.map((patch) => patch.verified)).toEqual([true, true, true]);
      expect(read.patches[0]!.patch).toContain("+changed");
      expect(read.patches[1]!.patch).toContain("+uncommitted");
      expect(read.patches[2]!.patch).toContain("+new");
      expect(read.commits).toMatchObject({ count: 1, verified: true });
    }, 60_000);
  }

  it("the planted script does run on a plain git read, so the checks above can fail", async () => {
    const { dir, marker, script } = checkout();
    git(dir, "config", "diff.external", script);
    execFileSync("git", ["diff", "HEAD~1", "HEAD"], { cwd: dir });
    expect(existsSync(marker)).toBe(true);
  }, 60_000);
});

/**
 * The read a coder flow makes when a run ends, to decide whether its checks
 * run: `git status` and two tree reads in the run's checkout, in the server.
 * `status` consults fsmonitor and hashes a changed file through its clean or
 * process filter, so a planted hook or filter would run there too.
 */
describe("the run-end read of whether a run changed files", () => {
  const runEnd: Array<[string, (dir: string, script: string) => void]> = [
    ["core.fsmonitor", (dir, script) => git(dir, "config", "core.fsmonitor", script)],
    ["core.fsmonitor, in the worktree's own config", (dir, script) => {
      git(dir, "config", "extensions.worktreeConfig", "true");
      git(dir, "config", "--worktree", "core.fsmonitor", script);
    }],
    ["a clean filter", (dir, script) => git(dir, "config", "filter.evil.clean", script)],
    ["a long-running filter process", (dir, script) => git(dir, "config", "filter.evil.process", script)],
    ["any of them, through an included config file", (dir, script) => {
      const included = join(dir, ".git", "evil.config");
      writeFileSync(included, `[core]\n\tfsmonitor = ${script}\n[filter "evil"]\n\tclean = ${script}\n\tprocess = ${script}\n`);
      git(dir, "config", "include.path", included);
    }],
  ];
  const changed = (dir: string, cut: string) =>
    runChangedFiles({ workspacePath: dir, baseCommit: cut } as unknown as CompletionRunContext);

  for (const [what, plant] of runEnd) {
    it(`runs no command the checkout's config names: ${what}`, async () => {
      const { dir, cut, marker, script } = checkout();
      plant(dir, script);
      const answer = await changed(dir, cut);
      expect(existsSync(marker), `git ran the planted ${what}`).toBe(false);
      // Still answers: the run left uncommitted work.
      expect(answer).toBe(true);
    }, 60_000);
  }

  it("still says a clean run whose tree is its cut's changed nothing", async () => {
    const { dir, cut, script, marker } = checkout();
    git(dir, "add", ".");
    git(dir, "commit", "-q", "-m", "the rest");
    git(dir, "reset", "-q", "--hard", cut);
    git(dir, "config", "core.fsmonitor", script);
    expect(await changed(dir, cut)).toBe(false);
    expect(existsSync(marker)).toBe(false);
  }, 60_000);

  it("the planted filter does run on a plain git status, so the checks above can fail", async () => {
    const { dir, marker, script } = checkout();
    git(dir, "config", "filter.evil.clean", script);
    execFileSync("git", ["status", "--porcelain"], { cwd: dir });
    expect(existsSync(marker)).toBe(true);
  }, 60_000);
});

/**
 * The run is live while a person reads its changes, so it can write its
 * config between any two git processes a read starts. A read that first lists
 * the drivers and then overrides them by name loses that race. Simulated with
 * a `git` on PATH that plants a filter after each call it passes through.
 */
describe("a run that writes its config while the read is under way", () => {
  const path = process.env.PATH;
  afterEach(() => {
    process.env.PATH = path;
  });

  it("still runs none of it", async () => {
    const { dir, cut, marker, script } = checkout();
    const real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
    const bin = mkdtempSync(join(tmpdir(), "hm-late-git-"));
    dirs.push(bin);
    writeFileSync(
      join(bin, "git"),
      `#!/bin/sh\n"${real}" "$@"\nstatus=$?\n"${real}" -C '${dir}' config filter.evil.clean '${script}' 2>/dev/null\n"${real}" -C '${dir}' config filter.evil.process '${script}' 2>/dev/null\nexit $status\n`,
    );
    chmodSync(join(bin, "git"), 0o755);
    process.env.PATH = `${bin}:${path}`;
    const read = await everyRead(dir, cut);
    expect(existsSync(marker), "git ran a filter the run planted mid-read").toBe(false);
    expect(read.working.files.map((file) => file.path)).toEqual([".gitattributes", "a.txt", "b.txt", "new.txt"]);
    expect(await runChangedFiles({ workspacePath: dir, baseCommit: cut } as unknown as CompletionRunContext)).toBe(true);
    expect(existsSync(marker), "git ran a filter the run planted mid-read, at the run's end").toBe(false);
  }, 60_000);
});

/** A working-tree read reads the run's files itself, so it must never follow a link out of the checkout. */
describe("a working-tree read through a folder the run swapped for a link", () => {
  it("reads the file as gone, never the file the link reaches", async () => {
    const { dir, cut } = checkout();
    mkdirSync(join(dir, "docs"));
    writeFileSync(join(dir, "docs", "notes.txt"), "mine\n");
    git(dir, "add", ".");
    git(dir, "commit", "-q", "-m", "notes");
    const outside = mkdtempSync(join(tmpdir(), "hm-outside-"));
    dirs.push(outside);
    writeFileSync(join(outside, "notes.txt"), "the secret\n");
    rmSync(join(dir, "docs"), { recursive: true });
    symlinkSync(outside, join(dir, "docs"));
    const diff = await readRunDiff(dir, "main", cut, { uncommitted: true });
    expect(diff.verified).toBe(true);
    const listed = diff.files.find((file) => file.path === "docs/notes.txt");
    // Committed then removed: nothing of it is the run's change any more.
    expect(listed).toBeUndefined();
    const patch = JSON.stringify(diff);
    expect(patch).not.toContain("secret");
  }, 60_000);
});
