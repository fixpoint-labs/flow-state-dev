/**
 * `localRepoWorkspaceHost`, the host for one repository on this machine.
 *
 * What it must get right is what every hand-written copy of it had to: the
 * repository is admitted as a local one (so a relative path is not judged a
 * remote and refused), every run is cut from it at the base the caller named,
 * and the run's branch is kept in that repository.
 */
import { rmSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { localRepoWorkspaceHost } from "../src/local-repo-host";
import { createRemote, git, tempDir } from "./git-fixtures";

let root: string;
let repo: string;

beforeEach(() => {
  root = tempDir("host");
  const remote = createRemote("marker A");
  repo = join(tempDir("local"), "repo");
  git(join(repo, ".."), "clone", "-q", remote.bare, repo);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("a host over one repository on this machine", () => {
  it("answers every run with that repository, at the base the caller named", async () => {
    const host = localRepoWorkspaceHost({ root, repo, baseRef: "main" });

    expect(await host.source({} as never)).toEqual({ kind: "repo", repo, baseRef: "main" });
  });

  it("cuts the run's branch in the repository itself", async () => {
    const host = localRepoWorkspaceHost({ root, repo, baseRef: "main" });

    const place = await host.provision(await host.source({} as never), { place: ["run-1"], branch: "fsd/run-1" });

    expect(git(repo, "branch", "--list", "fsd/run-1")).not.toBe("");
    expect(git(place.cwd, "rev-parse", "--abbrev-ref", "HEAD")).toBe("fsd/run-1");
  });

  it("takes a relative path as the same repository, not as a remote to refuse", async () => {
    // The reason each copy resolved the path: the host reads only an absolute
    // path as a repository on this machine.
    const host = localRepoWorkspaceHost({ root, repo: relative(process.cwd(), repo), baseRef: "main" });

    const answer = await host.source({} as never);
    expect(answer).toEqual({ kind: "repo", repo, baseRef: "main" });
    const place = await host.provision(answer, { place: ["run-2"], branch: "fsd/run-2" });
    expect(git(repo, "branch", "--list", "fsd/run-2")).not.toBe("");
    expect(place.cwd.startsWith(root)).toBe(true);
  });

  it("leaves the base to the repository's HEAD when none is named", async () => {
    const host = localRepoWorkspaceHost({ root, repo });

    expect(await host.source({} as never)).toEqual({ kind: "repo", repo });
  });
});
