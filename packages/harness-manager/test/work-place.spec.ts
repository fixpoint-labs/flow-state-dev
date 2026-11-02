/**
 * Where a run's work went, as a page reads it: one shape from a worktree row
 * (what a session points at) or a task's output, and commands a person copies. The commands are
 * run in a real shell here, against a real repository, because a command that
 * reads right and doesn't reach the work is the failure that matters.
 *
 * Red states produced before these were trusted:
 *   - drop the quoting in `shellWord`: the path with a space splits, and `cd` fails.
 *   - read a `base` field instead of `baseCommit`: neither source gives a `log` command.
 *   - compare the owner without the viewer: the owner's own session reads as attached.
 *   - ignore `commitsVerified: false`: an unread count shows as 0 commits.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { worktreeRowSchema } from "@flow-state-dev/workspace";
import { shellWord, workPlace } from "../src/work-place";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, encoding: "utf8" }).trim();
const sh = (command: string) => execFileSync("bash", ["-c", command], { encoding: "utf8" }).trim();

/** A repository, and a worktree under a path with a space and a quote, on a branch with two commits past its base. */
function worktree() {
  const root = mkdtempSync(join(tmpdir(), "hm-place-"));
  const repo = join(root, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "commit", "-q", "--allow-empty", "-m", "base");
  const base = git(repo, "rev-parse", "HEAD");
  const path = join(root, "state home", "it's here");
  git(repo, "worktree", "add", "-q", "-b", "kitchen-sink/claude-code-session/s1", path, "HEAD");
  for (const subject of ["first change", "second change"]) {
    writeFileSync(join(path, `${subject}.txt`), subject);
    git(path, "add", ".");
    git(path, "commit", "-q", "-m", subject);
  }
  return { repo, base, path, branch: "kitchen-sink/claude-code-session/s1" };
}

describe("where a run's work went", () => {
  it("reads a session's worktree row, and its commands reach the branch and list its commits", () => {
    const { base, path, branch } = worktree();
    const row = worktreeRowSchema.parse({ key: "h/s1", name: "s1-a1b2c3", path, branch, baseCommit: base, commits: 2, state: "ready", owner: { kind: "session", id: "s1" } });
    const place = workPlace(row, { session: "s1" })!;
    expect(place).toMatchObject({ branch, path, baseCommit: base, commits: 2, name: "s1-a1b2c3", state: "ready", attachedTo: null });
    expect(sh(`${place.commands.cd} && git rev-parse --abbrev-ref HEAD`)).toBe(branch);
    expect(sh(`${place.commands.cd} && ${place.commands.log} --format=%s`).split("\n")).toEqual(["second change", "first change"]);
  });

  it("reads a task's output the same way", () => {
    const { repo, base, path, branch } = worktree();
    const place = workPlace({ issue: "t1", answer: "done", branch, commits: 2, commitsVerified: true, baseCommit: base, path, judged: false, review: null })!;
    expect(place).toMatchObject({ branch, path, baseCommit: base, commits: 2 });
    // `git switch` from the repository, once the run's checkout lets the branch go.
    git(repo, "worktree", "remove", "--force", path);
    expect(sh(`cd ${shellWord(repo)} && ${place.commands.switch} -q && git rev-parse --abbrev-ref HEAD`)).toBe(branch);
  });

  it("names the owner for a session attached to another's worktree", () => {
    const row = worktreeRowSchema.parse({ path: "/w", branch: "b", owner: { kind: "session", id: "s-owner" }, attached: ["s-guest"] });
    expect(workPlace(row, { session: "s-guest" })?.attachedTo).toBe("s-owner");
    expect(workPlace(row, { session: "s-owner" })?.attachedTo).toBeNull();
    expect(workPlace({ ...row, owner: { kind: "run", id: "t1" } }, { session: "s-guest" })?.attachedTo).toBeNull();
  });

  it("says the count is unknown, and offers no log, when no base was recorded", () => {
    const place = workPlace({ path: "/w", branch: "b", baseCommit: null, commits: null })!;
    expect(place.commits).toBeNull();
    expect(place.commands.log).toBeNull();
    expect(place.commands.cd).toBe("cd /w");
  });

  it("says the count is unknown when the output says git couldn't read it", () => {
    const place = workPlace({ branch: "b", commits: 0, commitsVerified: false, baseCommit: "abc", path: "/w" })!;
    expect(place.commits).toBeNull();
    expect(place.commands.log).toBe("git log abc..b");
  });

  it("is nothing for a run with no branch", () => {
    expect(workPlace({ branch: null, commits: 0 })).toBeNull();
    expect(workPlace(null)).toBeNull();
    expect(workPlace(undefined)).toBeNull();
  });
});
