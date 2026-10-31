/**
 * Where a run starts, and how its worktree goes: a base that names a remote's
 * branch is fetched first, an existing branch is checked out rather than cut,
 * and `list` and `remove` see and clear what the host made without losing
 * work.
 *
 * The person's repository is a real clone of a bare upstream over `file://`,
 * listed in `localRepositories` as Kitchen Sink lists its own. The upstream
 * moves on through another clone. Every assertion reads git, not what the
 * host reports.
 */
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localWorkspaceHost, WorkspaceRefusedError } from "../src/local-host";
import { releaseLock } from "../src/lock";
import { occupyWorktree, worktreeLockPath } from "../src/occupancy";
import { createRemote, git, tempDir, type Remote } from "./git-fixtures";

const noSource = () => ({ kind: "refused" as const, reason: "unused", message: "unused" });

let root: string;
let repo: string;
let upstream: Remote;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  root = tempDir("host");
  upstream = createRemote("marker A");
  repo = join(tempDir("person"), "repo");
  git(join(repo, ".."), "clone", "-q", upstream.url, repo);
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
  rmSync(root, { recursive: true, force: true });
});

function host() {
  return localWorkspaceHost({ root, remotes: { allow: [] }, localRepositories: [repo], source: noSource });
}

function contains(ref: string, commit: string): boolean {
  try {
    git(repo, "merge-base", "--is-ancestor", commit, ref);
    return true;
  } catch {
    return false;
  }
}

describe("a base naming a remote's branch", () => {
  it("is fetched before the cut, so the run starts from the remote's tip", async () => {
    const moved = upstream.commit("main", "later.txt", "after the person's last fetch");
    expect(contains("refs/remotes/origin/main", moved)).toBe(false);

    const place = await host().provision({ kind: "repo", repo, baseRef: "origin/main" }, { place: ["run-1"], branch: "fsd/run-1" });

    expect(git(repo, "rev-parse", "fsd/run-1")).toBe(moved);
    expect(place.repo?.baseCommit).toBe(moved);
    expect(place.repo?.baseRef).toBe("origin/main");
  });

  it("is fetched even when the repository never had it", async () => {
    const tip = upstream.commit("release", "release.txt", "only on the remote");
    expect(() => git(repo, "rev-parse", "--verify", "refs/remotes/origin/release")).toThrow();

    await host().provision({ kind: "repo", repo, baseRef: "origin/release" }, { place: ["run-1"], branch: "fsd/run-1" });

    expect(git(repo, "rev-parse", "fsd/run-1")).toBe(tip);
  });

  it("is refused when the fetch fails, rather than cut from a tracking ref any run can move", async () => {
    const h = host();
    // A run plants a tip on the shared tracking ref, then the remote goes away.
    const main = git(repo, "rev-parse", "main");
    const planted = git(repo, "commit-tree", "-p", main, "-m", "planted", `${main}^{tree}`);
    git(repo, "update-ref", "refs/remotes/origin/main", planted);
    rmSync(upstream.bare, { recursive: true, force: true });

    const refusal = await h
      .provision({ kind: "repo", repo, baseRef: "origin/main" }, { place: ["run-1"], branch: "fsd/run-1" })
      .catch((error: unknown) => error);

    expect((refusal as WorkspaceRefusedError).reason).toBe("remote-unreadable");
    expect(git(repo, "branch", "--list", "fsd/run-1")).toBe("");
  });
});

describe("an existing branch", () => {
  it("is checked out as it stands, and the run's commits land on it", async () => {
    git(repo, "branch", "feature");
    const tip = git(repo, "rev-parse", "feature");

    const place = await host().provision({ kind: "repo", repo }, { place: ["run-1"], branch: "feature", existing: true });

    expect(git(place.cwd, "symbolic-ref", "--short", "HEAD")).toBe("feature");
    expect(place.repo?.baseCommit).toBe(tip);
    git(place.cwd, "commit", "-q", "--allow-empty", "-m", "the run's work");
    expect(git(repo, "log", "-1", "--format=%s", "feature")).toBe("the run's work");
  });

  it("is made from the remote's branch when the repository lacks it, tracking it", async () => {
    const tip = upstream.commit("pr-head", "fix.txt", "the PR's work");

    const place = await host().provision({ kind: "repo", repo }, { place: ["run-1"], branch: "pr-head", existing: true });

    expect(git(repo, "rev-parse", "pr-head")).toBe(tip);
    expect(git(repo, "rev-parse", "--abbrev-ref", "pr-head@{upstream}")).toBe("origin/pr-head");
    expect(git(place.cwd, "symbolic-ref", "--short", "HEAD")).toBe("pr-head");
    expect(place.repo?.baseCommit).toBe(tip);
  });

  it("is refused when no copy of it exists anywhere, and nothing is made", async () => {
    const refusal = await host()
      .provision({ kind: "repo", repo }, { place: ["run-1"], branch: "nowhere", existing: true })
      .catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(WorkspaceRefusedError);
    expect((refusal as WorkspaceRefusedError).reason).toBe("no-such-branch");
    expect(existsSync(join(root, "run-1"))).toBe(false);
  });

  it("is checked out of a cloned remote too", async () => {
    const tip = upstream.commit("pr-head", "fix.txt", "the PR's work");
    const cloned = localWorkspaceHost({ root, remotes: { allow: ["file"] }, source: noSource });

    const place = await cloned.provision({ kind: "repo", repo: upstream.url }, { place: ["run-1"], branch: "pr-head", existing: true });

    expect(git(place.cwd, "rev-parse", "HEAD")).toBe(tip);
    expect(git(place.cwd, "symbolic-ref", "--short", "HEAD")).toBe("pr-head");
  });
});

describe("list and remove", () => {
  async function made(run = "run-1") {
    const h = host();
    const place = await h.provision({ kind: "repo", repo }, { place: [run], branch: `fsd/${run}` });
    return { h, place };
  }

  it("lists each worktree the host made, with its branch and whether it is dirty", async () => {
    const { h, place } = await made();
    writeFileSync(join(place.cwd, "scratch.txt"), "untracked");

    const listed = await h.list!();

    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ place: ["run-1"], branch: "fsd/run-1", dirty: true, repository: repo });
    expect(git(repo, "worktree", "list")).toContain(listed[0]!.cwd);
  });

  it("does not list the person's own checkout", async () => {
    await made();
    const listed = await host().list!();
    expect(listed.map((entry) => entry.cwd)).not.toContain(repo);
  });

  it("refuses to remove a worktree with untracked changes, and removes nothing", async () => {
    const { h, place } = await made();
    writeFileSync(join(place.cwd, "scratch.txt"), "work that exists nowhere else");

    const refusal = await h.remove!({ place: ["run-1"] }).catch((error: unknown) => error);

    expect((refusal as WorkspaceRefusedError).reason).toBe("uncommitted-work");
    expect(existsSync(join(place.cwd, "scratch.txt"))).toBe(true);
  });

  it("removes a clean worktree and keeps its branch", async () => {
    const { h, place } = await made();

    const removed = await h.remove!({ place: ["run-1"] });

    expect(removed).toMatchObject({ branch: "fsd/run-1", branchDeleted: false });
    expect(existsSync(place.cwd)).toBe(false);
    expect(git(repo, "worktree", "list")).not.toContain(place.cwd);
    expect(git(repo, "branch", "--list", "fsd/run-1")).not.toBe("");
    expect(await h.list!()).toHaveLength(0);
  });

  it("refuses to delete a branch holding the only copy of a commit, unless forced", async () => {
    const { h, place } = await made();
    git(place.cwd, "commit", "-q", "--allow-empty", "-m", "only here");

    const refusal = await h.remove!({ place: ["run-1"] }, { deleteBranch: true }).catch((error: unknown) => error);
    expect((refusal as WorkspaceRefusedError).reason).toBe("unique-commits");
    expect(existsSync(place.cwd)).toBe(true);

    const removed = await h.remove!({ cwd: place.cwd }, { deleteBranch: true, force: true });
    expect(removed.branchDeleted).toBe(true);
    expect(git(repo, "branch", "--list", "fsd/run-1")).toBe("");
  });

  it("deletes a branch with no commits of its own without force", async () => {
    const { h } = await made();
    const removed = await h.remove!({ place: ["run-1"] }, { deleteBranch: true });
    expect(removed.branchDeleted).toBe(true);
    expect(git(repo, "branch", "--list", "fsd/run-1")).toBe("");
  });

  it("refuses to remove a clean worktree a run is working in, and removes it once the run lets go", async () => {
    const { h, place } = await made();
    const lease = await occupyWorktree(place.cwd);

    const refusal = await h.remove!({ place: ["run-1"] }).catch((error: unknown) => error);
    expect((refusal as WorkspaceRefusedError).reason).toBe("in-use");
    expect(existsSync(place.cwd)).toBe(true);

    releaseLock(lease);
    await h.remove!({ place: ["run-1"] });
    expect(existsSync(place.cwd)).toBe(false);
    expect(existsSync(worktreeLockPath(place.cwd))).toBe(false);
  });

  it("rejects a target that names no worktree of the host's", async () => {
    await expect(host().remove!({ cwd: repo })).rejects.toThrow(/no worktree this host holds/);
  });
});
