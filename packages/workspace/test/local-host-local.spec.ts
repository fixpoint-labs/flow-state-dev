/**
 * The local workspace host, for a repository on this machine the operator
 * names.
 *
 * Such a repository is used as it stands: the run's branch is cut in it and
 * stays there, with no clone. That is what lets a host that has always
 * pointed runs at one working repository keep its branches where they were.
 * These repositories are clones of a bare path, so a new branch's base has an
 * upstream, and one fetch of it (`local-host-upstream.spec.ts`); a retry
 * fetches nothing. Every git process is counted, as in the remote suite.
 */
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/exec";
import { localWorkspaceHost, WorkspaceRefusedError } from "../src/local-host";
import { createFakeCollection } from "./fake-collection";
import { createRemote, git, tempDir, type Remote } from "./git-fixtures";

vi.mock("../src/exec", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/exec")>();
  return { ...actual, run: vi.fn(actual.run) };
});

const spawned = vi.mocked(run);
/** The git subcommand, past any leading `-c <key>=<value>` pairs. */
const gitCommands = () =>
  spawned.mock.calls.map(([, args]) => args.find((arg, i) => arg !== "-c" && args[i - 1] !== "-c"));
const noSource = () => ({ kind: "refused" as const, reason: "unused", message: "unused" });

let root: string;
/** A working repository with `main` checked out — the shape a host points runs at. */
let repo: string;
let remote: Remote;

beforeEach(() => {
  root = tempDir("host");
  remote = createRemote("marker A");
  repo = join(tempDir("local"), "repo");
  git(join(repo, ".."), "clone", "-q", remote.bare, repo);
  spawned.mockClear();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** The worktrees git lists for `repository`, by path: git's own view, not what a provision returned. */
function worktreesOf(repository: string): string[] {
  return git(repository, "worktree", "list", "--porcelain")
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
}

function host(localRepositories: string[] = [repo]) {
  return localWorkspaceHost({ root, remotes: { allow: [] }, localRepositories, source: noSource });
}

describe("a repository the operator names on this machine", () => {
  it("cuts the run's branch in that repository itself, with no clone", async () => {
    const place = await host().provision(
      { kind: "repo", repo, baseRef: "main" },
      { place: ["run-1"], branch: "fsd/run-1" },
    );

    // The branch lives in the named repository, which is where a host that
    // passes one expects to find its runs' branches.
    expect(git(repo, "branch", "--list", "fsd/run-1")).not.toBe("");
    expect(git(place.cwd, "rev-parse", "--abbrev-ref", "HEAD")).toBe("fsd/run-1");
    expect(existsSync(join(root, ".clones"))).toBe(false);
    expect(gitCommands()).not.toContain("clone");
    // One fetch: the base's own upstream, before the new branch is cut.
    expect(gitCommands().filter((command) => command === "fetch")).toHaveLength(1);
    expect(place.repo).toMatchObject({ remote: repo, clone: repo, created: true, baseRef: "main" });
  });

  it("makes the place itself the checkout, so a host's own derived path is where the run works", async () => {
    const place = await host().provision({ kind: "repo", repo, baseRef: "main" }, { place: ["a", "run-1"], branch: "fsd/run-1" });

    expect(place.dir).toBe(join(root, "a", "run-1"));
    expect(place.cwd).toBe(place.dir);
    expect(host().locate({ kind: "repo", repo }, { place: ["a", "run-1"] })).toEqual({
      dir: place.dir,
      cwd: place.cwd,
    });
  });

  it("hands a retry the same checkout, work and all, without reaching any remote", async () => {
    const first = await host().provision({ kind: "repo", repo, baseRef: "main" }, { place: ["run-1"], branch: "fsd/run-1" });
    writeFileSync(join(first.cwd, "wip.txt"), "half done");
    spawned.mockClear();

    const retry = await host().provision({ kind: "repo", repo, baseRef: "main" }, { place: ["run-1"], branch: "fsd/run-1" });

    expect(retry.cwd).toBe(first.cwd);
    expect(retry.repo?.created).toBe(false);
    expect(existsSync(join(retry.cwd, "wip.txt"))).toBe(true);
    expect(gitCommands()).not.toContain("fetch");
    expect(gitCommands()).not.toContain("ls-remote");
  });

  it("matches the repository by its path however it is spelled", async () => {
    const place = await host([`${repo}/`]).provision(
      { kind: "repo", repo: join(repo, "..", "repo"), baseRef: "main" },
      { place: ["run-1"], branch: "fsd/run-1" },
    );

    expect(git(repo, "branch", "--list", "fsd/run-1")).not.toBe("");
    expect(place.cwd).toBe(join(root, "run-1"));
  });

  it("still refuses a path the operator did not name, before any git process", async () => {
    const other = join(tempDir("other"), "repo");
    const attempt = host().provision({ kind: "repo", repo: other }, { place: ["run-1"], branch: "fsd/run-1" });

    await expect(attempt).rejects.toBeInstanceOf(WorkspaceRefusedError);
    await expect(attempt).rejects.toMatchObject({ reason: "invalid-remote" });
    expect(spawned).not.toHaveBeenCalled();
  });

});

describe("a repository on this machine with kept files beside it", () => {
  function withFiles(seed: Record<string, string> = {}) {
    const collection = createFakeCollection("project-files/**", seed);
    return {
      collection,
      answer: { kind: "repo" as const, repo, projectId: "p1", files: { collection, collectionId: "project-files" } },
    };
  }

  it("lays the place out like a remote run's: the worktree in checkout/, the files in project/ (BR-8)", async () => {
    const { answer } = withFiles({ "p1/plan.md": "the plan" });
    const place = await host().provision(answer, { place: ["run-1"], branch: "fsd/run-1" });

    const dir = join(root, "run-1");
    expect(place.dir).toBe(dir);
    expect(place.cwd).toBe(join(dir, "checkout"));
    expect(place.filesDir).toBe(join(dir, "project"));
    expect(readFileSync(join(dir, "project", "plan.md"), "utf8")).toBe("the plan");
    // Git's own view, in the operator's repository: the run's worktree is
    // checkout/, on its own branch, and nothing was cloned.
    expect(worktreesOf(repo)).toContain(join(dir, "checkout"));
    expect(git(place.cwd, "rev-parse", "--abbrev-ref", "HEAD")).toBe("fsd/run-1");
    expect(existsSync(join(root, ".clones"))).toBe(false);
    expect(place.repo).toMatchObject({ remote: repo, clone: repo, created: true });
  });

  it("locates the same place before provisioning it", async () => {
    const { answer } = withFiles();
    const located = host().locate(answer, { place: ["a", "run-1"] });
    const place = await host().provision(answer, { place: ["a", "run-1"], branch: "fsd/run-1" });

    expect(located).toEqual({ dir: place.dir, cwd: place.cwd });
  });

  it("saves a note in project/ to the project's files, and git never sees it (BR-11)", async () => {
    const { collection, answer } = withFiles();
    const h = host();
    const place = await h.provision(answer, { place: ["run-1"], branch: "fsd/run-1" });

    writeFileSync(join(place.filesDir!, "note.md"), "remember this");
    const report = await h.save(place);

    expect(report.conflicts).toEqual([]);
    expect(collection.contents()["p1/note.md"]).toBe("remember this");
    expect(git(place.cwd, "status", "--porcelain", "--untracked-files=all")).toBe("");
  });

  it("hands a later turn the same worktree, branch, work and files", async () => {
    const { answer } = withFiles();
    const h = host();
    const first = await h.provision(answer, { place: ["run-1"], branch: "fsd/run-1" });
    writeFileSync(join(first.cwd, "wip.txt"), "half done");
    writeFileSync(join(first.filesDir!, "note.md"), "kept");
    await h.save(first);
    await h.release(first);

    const again = await h.provision(answer, { place: ["run-1"], branch: "fsd/run-1" });

    expect(again.cwd).toBe(first.cwd);
    expect(again.repo?.created).toBe(false);
    expect(readFileSync(join(again.cwd, "wip.txt"), "utf8")).toBe("half done");
    expect(readFileSync(join(again.filesDir!, "note.md"), "utf8")).toBe("kept");
  });

  it("lists and removes a place whose whole directory went missing as the place it was made, not its checkout/", async () => {
    const { answer } = withFiles();
    const h = host();
    const place = await h.provision(answer, { place: ["owner"], branch: "fsd/owner" });
    await h.release(place);
    // Kept files gone with it: only git's own record says how the place was laid out.
    renameSync(place.dir, `${place.dir}-moved`);

    const listed = await h.list!();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ place: ["owner"], dir: place.dir, cwd: place.cwd });

    await h.remove!({ place: ["owner"] });
    expect(worktreesOf(repo)).not.toContain(place.cwd);
  });

  it("keeps a place with no kept files exactly as before: the place is the checkout (BR-12)", async () => {
    const place = await host().provision({ kind: "repo", repo }, { place: ["run-1"], branch: "fsd/run-1" });

    expect(place.cwd).toBe(join(root, "run-1"));
    expect(place.filesDir).toBeUndefined();
    expect(existsSync(join(root, "run-1", "checkout"))).toBe(false);
  });
});

describe("a checkout must keep a directory out of git when the caller says so", () => {
  const ignored = { dir: ".fsdev/ask", rule: "**/.fsdev/", why: "A run writes its question there." };

  it("refuses a repository that does not ignore it, and leaves nothing behind", async () => {
    const attempt = host().provision(
      { kind: "repo", repo, baseRef: "main" },
      { place: ["run-1"], branch: "fsd/run-1", ignored },
    );

    await expect(attempt).rejects.toThrow(/does not ignore the directory ".fsdev\/ask"/);
    await expect(attempt).rejects.toThrow(/Add `\*\*\/\.fsdev\/`/);
    expect(existsSync(join(root, "run-1"))).toBe(false);
    expect(git(repo, "branch", "--list", "fsd/run-1")).toBe("");
  });

  it("applies to a cloned remote too", async () => {
    const cloned = localWorkspaceHost({ root, remotes: { allow: ["file"] }, source: noSource });
    const attempt = cloned.provision({ kind: "repo", repo: remote.url }, { place: ["run-1"], branch: "fsd/run-1", ignored });

    await expect(attempt).rejects.toThrow(/does not ignore/);
    expect(existsSync(join(root, "run-1", "checkout"))).toBe(false);
  });
});
