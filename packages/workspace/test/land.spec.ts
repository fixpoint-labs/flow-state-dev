/**
 * Landing a run's accepted branch from a repository on this machine: push it
 * and open a pull request, or merge it into the person's checkout of its base.
 *
 * The person's repository is a real clone of a real bare upstream over
 * `file://`, listed in `localRepositories` with no remote allowed, as the
 * Teammates lab builds its host. `gh` is a script that logs what it was asked
 * and prints a pull request link. Every assertion reads git or that log, not
 * only what the host reports.
 */
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localWorkspaceHost, WorkspaceRefusedError } from "../src/local-host";
import { createRemote, git, tempDir, type Remote } from "./git-fixtures";

const PR_URL = "https://github.com/acme/widgets/pull/42";

let root: string;
let repo: string;
let upstream: Remote;
let ghLog: string;
let gh: string;

beforeEach(() => {
  root = tempDir("land-host");
  upstream = createRemote("marker A");
  repo = join(tempDir("land-person"), "repo");
  git(join(repo, ".."), "clone", "-q", upstream.url, repo);
  // The person's own identity, in their checkout: a merge commit is theirs, so the host never
  // supplies one, and a machine with no global git identity (CI) must not decide these tests.
  git(repo, "config", "user.name", "The Person");
  git(repo, "config", "user.email", "person@example.com");
  const bin = tempDir("land-gh");
  ghLog = join(bin, "gh.log");
  gh = join(bin, "gh");
  // `pr list` finds none open; `pr create` prints the link, as gh does.
  writeFileSync(
    gh,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> '${ghLog}'\nif [ "$2" = "list" ]; then echo '[]'; else echo '${PR_URL}'; fi\n`,
  );
  chmodSync(gh, 0o755);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

function host() {
  return localWorkspaceHost({ root, remotes: { allow: [] }, localRepositories: [repo], source: () => ({ kind: "repo", repo }) });
}

/** A run's place, with one commit on its branch touching `file`. */
async function runWithCommit(file = "change.txt", content = "the run's change\n") {
  const h = host();
  const place = await h.provision({ kind: "repo", repo }, { place: ["run-1"], branch: "fsd/run-1" });
  writeFileSync(join(place.cwd, file), content);
  git(place.cwd, "add", file);
  git(place.cwd, "commit", "-q", "-m", "The run's change");
  return { h, place, commit: git(place.cwd, "rev-parse", "HEAD") };
}

const ghCalls = () => (existsSync(ghLog) ? readFileSync(ghLog, "utf8").trim().split("\n") : []);

describe("accepting a run by opening a pull request", () => {
  it("pushes the run's branch to the pinned remote and opens its pull request against the base", async () => {
    const { h, place, commit } = await runWithCommit();

    const landed = await h.land!(
      { cwd: place.cwd, branch: "fsd/run-1", baseRef: place.repo!.baseRef },
      { kind: "pull-request", title: "Add the change", body: "Why it changed.", gh },
    );

    // pushed: the branch is on the upstream, at the run's commit.
    expect(upstream.rev("refs/heads/fsd/run-1")).toBe(commit);
    // opened: gh was asked to create it, from the run's branch into main.
    expect(ghCalls().some((call) => call.startsWith("pr create") && call.includes("--head fsd/run-1") && call.includes("--base main"))).toBe(true);
    expect(landed).toEqual({ kind: "pull-request", url: PR_URL, number: 42, branch: "fsd/run-1", base: "main", remote: upstream.url });
  });

  it("refuses to push to a remote repointed since the host started, and pushes nothing", async () => {
    const { h, place } = await runWithCommit();
    const elsewhere = createRemote("elsewhere");
    // A run shares the repository's config, so it can repoint origin.
    git(repo, "remote", "set-url", "origin", elsewhere.url);

    const landing = h.land!({ cwd: place.cwd, branch: "fsd/run-1" }, { kind: "pull-request", title: "t", body: "b", gh });

    await expect(landing).rejects.toMatchObject({ reason: "remote-repointed" });
    expect(() => elsewhere.rev("refs/heads/fsd/run-1")).toThrow();
    expect(() => upstream.rev("refs/heads/fsd/run-1")).toThrow();
    expect(ghCalls()).toEqual([]);
  });

  it("says the push failed when the remote is unreachable, and leaves the run's commit on its branch", async () => {
    const { h, place, commit } = await runWithCommit();
    rmSync(upstream.bare, { recursive: true, force: true });

    const landing = h.land!({ cwd: place.cwd, branch: "fsd/run-1" }, { kind: "pull-request", title: "t", body: "b", gh });

    await expect(landing).rejects.toBeInstanceOf(WorkspaceRefusedError);
    await expect(landing).rejects.toMatchObject({ reason: "push-failed" });
    expect(git(repo, "rev-parse", "refs/heads/fsd/run-1")).toBe(commit);
  });
});

describe("accepting a run by merging it locally", () => {
  it("lands the run's commit on the base branch of the person's checkout", async () => {
    const { h, place, commit } = await runWithCommit();

    const landed = await h.land!({ cwd: place.cwd, branch: "fsd/run-1", baseRef: "HEAD" }, { kind: "merge" });

    git(repo, "merge-base", "--is-ancestor", commit, "refs/heads/main");
    expect(readFileSync(join(repo, "change.txt"), "utf8")).toBe("the run's change\n");
    expect(landed).toEqual({ kind: "merge", branch: "main", commit: git(repo, "rev-parse", "main"), checkout: repo, from: "fsd/run-1" });
    // Nothing was pushed: a local merge stays local.
    expect(() => upstream.rev("refs/heads/fsd/run-1")).toThrow();
  });

  it("stops on a conflict, says which file, and leaves the person's checkout as it was", async () => {
    const { h, place } = await runWithCommit("marker.txt", "the run's marker\n");
    writeFileSync(join(repo, "marker.txt"), "the person's marker\n");
    git(repo, "commit", "-q", "-am", "The person's marker");
    const before = git(repo, "rev-parse", "main");

    const landing = h.land!({ cwd: place.cwd, branch: "fsd/run-1" }, { kind: "merge" });

    await expect(landing).rejects.toMatchObject({ reason: "merge-conflict", message: expect.stringContaining("marker.txt") });
    expect(git(repo, "rev-parse", "main")).toBe(before);
    expect(git(repo, "status", "--porcelain")).toBe("");
    expect(existsSync(join(repo, ".git", "MERGE_HEAD"))).toBe(false);
    expect(readFileSync(join(repo, "marker.txt"), "utf8")).toBe("the person's marker\n");
  });

  it("refuses a checkout with uncommitted changes, and merges nothing", async () => {
    const { h, place, commit } = await runWithCommit();
    writeFileSync(join(repo, "marker.txt"), "edited, not committed\n");

    await expect(h.land!({ cwd: place.cwd, branch: "fsd/run-1" }, { kind: "merge" })).rejects.toMatchObject({ reason: "checkout-dirty" });
    expect(() => git(repo, "merge-base", "--is-ancestor", commit, "refs/heads/main")).toThrow();
  });
});
