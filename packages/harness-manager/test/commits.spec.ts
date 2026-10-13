/**
 * The commits a run reports are the ones it made: never commits its base
 * already had, whichever copy of the base its branch was cut from.
 *
 * A local checkout cuts the run's branch from the local base branch, a clone
 * from the remote's copy, and either copy can be behind the other. Counting
 * against only one of them hands the run (and the judge reading its subjects)
 * commits somebody else made.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { localWorkspaceHost } from "@flow-state-dev/workspace";
import { afterAll, describe, expect, it, vi } from "vitest";
import { readRunCommits } from "../src/commits";

const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
  });
}

function commit(cwd: string, subject: string): void {
  writeFileSync(join(cwd, `${subject.replace(/\W/g, "-")}.txt`), subject);
  git(cwd, "add", ".");
  git(cwd, "commit", "-q", "-m", subject);
}

/** A repository whose `origin/main` and `main` differ by one commit. */
function repo(ahead: "local" | "remote"): string {
  const dir = mkdtempSync(join(tmpdir(), "hm-commits-"));
  dirs.push(dir);
  git(dir, "init", "-q", "-b", "main");
  commit(dir, "first");
  git(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
  if (ahead === "local") commit(dir, "local only");
  else {
    git(dir, "checkout", "-q", "-b", "tmp");
    commit(dir, "remote only");
    git(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
    git(dir, "checkout", "-q", "main");
    git(dir, "branch", "-q", "-D", "tmp");
  }
  return dir;
}

describe("readRunCommits", () => {
  it("counts none of a local base's own commits when the branch was cut from it, ahead of a stale origin", async () => {
    const dir = repo("local");
    git(dir, "checkout", "-q", "-b", "run", "main");
    expect(await readRunCommits(dir, "main")).toEqual({ count: 0, subjects: [] });
    commit(dir, "the run's change");
    expect(await readRunCommits(dir, "main")).toEqual({ count: 1, subjects: ["the run's change"] });
  });

  it("counts none of the remote's commits when the branch was cut from origin, ahead of a stale local base", async () => {
    const dir = repo("remote");
    git(dir, "checkout", "-q", "-b", "run", "origin/main");
    commit(dir, "the run's change");
    expect(await readRunCommits(dir, "main")).toEqual({ count: 1, subjects: ["the run's change"] });
  });

  it("counts none of the upstream's commits when the branch was cut from it, whatever its remote is called", async () => {
    // A local checkout cuts from the base's upstream when the person hasn't
    // pulled. Named anything but `origin`, only the recorded cut commit finds it.
    const dir = repo("local");
    git(dir, "update-ref", "-d", "refs/remotes/origin/main");
    git(dir, "config", "remote.upstream.url", dir);
    git(dir, "config", "remote.upstream.fetch", "+refs/heads/*:refs/remotes/upstream/*");
    git(dir, "config", "branch.main.remote", "upstream");
    git(dir, "config", "branch.main.merge", "refs/heads/main");
    git(dir, "checkout", "-q", "-b", "tmp", "main~1");
    commit(dir, "upstream only");
    git(dir, "update-ref", "refs/remotes/upstream/main", "HEAD");
    git(dir, "checkout", "-q", "main");
    git(dir, "reset", "-q", "--hard", "main~1");
    git(dir, "branch", "-q", "-D", "tmp");
    git(dir, "checkout", "-q", "-b", "run", "upstream/main");
    const cut = git(dir, "rev-parse", "HEAD").trim();
    commit(dir, "the run's first change");
    commit(dir, "the run's second change");
    expect(await readRunCommits(dir, "main", cut)).toEqual({
      count: 2,
      subjects: ["the run's second change", "the run's first change"],
    });
  });

  it("still counts a run's commits after the run repoints the base's upstream at its own branch", async () => {
    // The run's worktree shares the checkout's config, so `@{upstream}` is
    // the run's to move; only the recorded cut commit is not.
    const dir = repo("local");
    git(dir, "checkout", "-q", "-b", "run", "main");
    const cut = git(dir, "rev-parse", "HEAD").trim();
    commit(dir, "the run's change");
    git(dir, "update-ref", "refs/remotes/origin/run", "HEAD");
    git(dir, "config", "remote.origin.url", dir);
    git(dir, "config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*");
    git(dir, "config", "branch.main.remote", "origin");
    git(dir, "config", "branch.main.merge", "refs/heads/run");
    expect(git(dir, "rev-parse", "main@{upstream}").trim()).toBe(git(dir, "rev-parse", "HEAD").trim());
    expect(await readRunCommits(dir, "main", cut)).toEqual({ count: 1, subjects: ["the run's change"] });
  });

  it("still counts a run's commits after the run points the base's own refs at its work", async () => {
    // Refs are shared with the run's worktree too; only the recorded cut commit is not.
    const dir = repo("local");
    git(dir, "checkout", "-q", "-b", "run", "main");
    const cut = git(dir, "rev-parse", "HEAD").trim();
    commit(dir, "the run's change");
    git(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
    git(dir, "update-ref", "refs/heads/main", "HEAD");
    expect(await readRunCommits(dir, "main", cut)).toEqual({ count: 1, subjects: ["the run's change"] });
  });

  it("answers none for a base the checkout doesn't have", async () => {
    const dir = repo("local");
    expect(await readRunCommits(dir, "no-such-branch")).toEqual({ count: 0, subjects: [] });
  });

  it("counts none of a non-origin upstream's commits for a local run cut from HEAD, as the host records its base", async () => {
    // The person cloned their fork (`origin`, whose HEAD is stale) and their
    // `main` tracks the shared repository, `upstream`, which a teammate moved.
    const scratch = mkdtempSync(join(tmpdir(), "hm-commits-local-"));
    dirs.push(scratch);
    const shared = join(scratch, "shared.git");
    const work = join(scratch, "work");
    git(scratch, "init", "-q", "--bare", "-b", "main", shared);
    git(scratch, "clone", "-q", shared, work);
    commit(work, "first");
    git(work, "push", "-q", "origin", "HEAD:main");
    const fork = join(scratch, "fork.git");
    git(scratch, "clone", "-q", "--bare", shared, fork);
    const person = join(scratch, "person");
    git(scratch, "clone", "-q", pathToFileURL(fork).href, person);
    git(person, "remote", "add", "upstream", pathToFileURL(shared).href);
    git(person, "fetch", "-q", "upstream");
    git(person, "branch", "-q", "--set-upstream-to=upstream/main", "main");
    commit(work, "a teammate's merge");
    git(work, "push", "-q", "origin", "HEAD:main");

    const host = localWorkspaceHost({
      root: join(scratch, "root"),
      remotes: { allow: [] },
      localRepositories: [person],
      source: () => ({ kind: "refused", reason: "unused", message: "unused" }),
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const place = await host.provision({ kind: "repo", repo: person }, { place: ["run-1"], branch: "fsd/run-1" });
    warn.mockRestore();
    commit(place.cwd, "the run's change");

    expect(await readRunCommits(place.cwd, place.repo!.baseRef ?? null, place.repo!.baseCommit ?? null)).toEqual({
      count: 1,
      subjects: ["the run's change"],
    });
  });
});
