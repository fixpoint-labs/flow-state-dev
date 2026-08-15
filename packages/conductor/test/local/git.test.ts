/**
 * The git layer, and the one rule it exists to hold.
 *
 * `merge-base --is-ancestor` and `merge-tree` both answer "no" with a non-zero
 * exit, which makes it very easy to read *every* failure as a no. `merge-tree`
 * is the sharp one: a revision it cannot resolve exits **1**, the same code a
 * genuine conflict uses, so the obvious implementation reports a mergeable
 * branch as conflicting and conductor dispatches an agent to resolve a conflict
 * that does not exist. It is the same mistake the branch layer's
 * `LS_REMOTE_NO_MATCHING_REFS` guards against, one step downstream.
 *
 * So a question that could not be asked raises, and the two cases are told apart
 * by what git wrote rather than by what it exited with.
 */

import { afterEach, describe, expect, it } from "vitest";

import { headSha, isAncestor, LocalGitError, mergesCleanly } from "../../src/local/git";
import { createTestRepo, type TestRepo } from "./repo";

let repo: TestRepo;

afterEach(async () => {
  await repo?.cleanup();
});

describe("a git question that cannot be asked", () => {
  it("raises rather than answering no", async () => {
    repo = await createTestRepo();

    await expect(isAncestor(repo.git, repo.root, "no-such-ref", "main")).rejects.toBeInstanceOf(
      LocalGitError,
    );
    // Exit 1, exactly as a real conflict does — and it must not be read as one.
    await expect(mergesCleanly(repo.git, repo.root, "main", "no-such-ref")).rejects.toBeInstanceOf(
      LocalGitError,
    );
  });

  it("still tells a real conflict from a failed merge", async () => {
    repo = await createTestRepo();
    await repo.run("checkout", "-q", "-b", "side", "main");
    await repo.commit("shared.txt", "side\n", "side", "2026-08-02T00:00:00Z");
    await repo.run("checkout", "-q", "main");
    await repo.commit("shared.txt", "main\n", "main", "2026-08-03T00:00:00Z");

    expect(await mergesCleanly(repo.git, repo.root, "main", "side")).toBe(false);
  });
});

describe("a ref that is simply not there", () => {
  it("is an answer, not a failure — that is how a submission gets closed", async () => {
    repo = await createTestRepo();

    expect(await headSha(repo.git, repo.root, "deleted/branch")).toBeNull();
    expect(await headSha(repo.git, repo.root, "main")).toMatch(/^[0-9a-f]{40}$/);
  });
});
