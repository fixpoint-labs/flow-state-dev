/**
 * How DevTeam's scripted run commits in a run's checkout.
 *
 * A run's checkout is a worktree of one clone per project, so two runs on one
 * project share that clone's `.git/config`, and a retry lands in the checkout
 * its first attempt left. Both used to fail a task for git's reasons rather
 * than the task's: a commit that wrote the shared config met another run's
 * lock on it, and a retry's commit had nothing new to commit.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { commitScriptedWork } from "../teams/devteam/harness.mts";
import { commitAll } from "../teams/devteam/scratch-repo.mts";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" }).trim();

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A clone with one base commit and two worktrees cut from it, as two runs on one project get. */
function twoCheckouts(): { clone: string; first: string; second: string } {
  const dir = mkdtempSync(join(tmpdir(), "devteam-scripted-commit-"));
  made.push(dir);
  const clone = join(dir, "clone");
  execFileSync("git", ["init", "--initial-branch=main", clone], { stdio: "pipe" });
  git(clone, "-c", "user.email=base@example.test", "-c", "user.name=Base", "commit", "--allow-empty", "-m", "base");
  const first = join(dir, "first");
  const second = join(dir, "second");
  git(clone, "worktree", "add", "-b", "run-1", first);
  git(clone, "worktree", "add", "-b", "run-2", second);
  return { clone, first, second };
}

describe("devteam: the scripted run's commit", () => {
  it("commits while another run holds the clone's shared config, and writes nothing to it", () => {
    const { clone, first, second } = twoCheckouts();
    const config = join(clone, ".git", "config");
    const before = readFileSync(config, "utf8");
    // Another run on this project is writing the shared config right now.
    writeFileSync(`${config}.lock`, before);

    writeFileSync(join(first, "a.md"), "first run\n");
    writeFileSync(join(second, "b.md"), "second run\n");
    commitAll(first, "first run");
    commitAll(second, "second run");

    rmSync(`${config}.lock`);
    expect(readFileSync(config, "utf8")).toBe(before);
    for (const [checkout, branch] of [[first, "run-1"], [second, "run-2"]] as const) {
      expect(git(checkout, "rev-list", "--count", `main..${branch}`)).toBe("1");
      expect(git(checkout, "log", "-1", "--format=%an <%ae>")).toBe("DevForce Lab <devforce-lab@example.test>");
    }
  });

  it("a retry in the checkout its first attempt committed in finishes, and adds no commit", () => {
    const { first } = twoCheckouts();
    const run = { prompt: "Write a note.", cwd: first, resume: null };

    commitScriptedWork(run);
    expect(git(first, "rev-list", "--count", "main..run-1")).toBe("1");

    // The judge sent the first attempt back; the retry is handed the same checkout.
    expect(() => commitScriptedWork(run)).not.toThrow();
    expect(git(first, "rev-list", "--count", "main..run-1")).toBe("1");
    expect(git(first, "status", "--porcelain")).toBe("");
  });
});
