/**
 * The local workspace host, for a repository on this machine the operator
 * names.
 *
 * Such a repository is used as it stands: the run's branch is cut in it and
 * stays there, with no clone and no fetch. That is what lets a host that has
 * always pointed runs at one working repository keep its branches where they
 * were. Every git process is counted, as in the remote suite.
 */
import { existsSync, rmSync, writeFileSync } from "node:fs";
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
const gitCommands = () => spawned.mock.calls.map(([, args]) => args[0]);
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
    expect(gitCommands()).not.toContain("fetch");
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

  it("refuses kept files beside a local repository: its place is the checkout", async () => {
    const files = createFakeCollection("project-files/**");
    const attempt = host().provision(
      { kind: "repo", repo, projectId: "p1", files: { collection: files, collectionId: "files" } },
      { place: ["run-1"], branch: "fsd/run-1" },
    );

    await expect(attempt).rejects.toThrow(/kept files/);
    expect(spawned).not.toHaveBeenCalled();
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
