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
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { effectiveCut, headCommit, readRunCommits, readRunDiff, readRunFilePatch } from "../src/commits";

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
