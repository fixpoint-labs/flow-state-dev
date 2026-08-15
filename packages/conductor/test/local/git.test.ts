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

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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

  it("is told apart from a repository that cannot be queried at all", async () => {
    // Driven against a real directory that is not a checkout, not a stubbed
    // runner: the whole claim is about what git exits with, and a fake would
    // only prove it agrees with itself. Against git 2.43 a missing ref exits 1
    // and a non-repository exits 128 — one is absence, the other is a question
    // that was never asked.
    //
    // Reading 128 as absence is worse than losing the answer, because it
    // asserts a different true fact: `resolveState` finds no head, calls a live
    // submission closed, and reconciliation synthesizes `pr_closed` and
    // escalates it. A transient git problem becomes a durable wrong transition
    // in the ledger.
    repo = await createTestRepo();
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "conductor-not-a-repo-"));
    try {
      await expect(headSha(repo.git, outside, "main")).rejects.toThrow(/exit 128/);
      await expect(headSha(repo.git, outside, "main")).rejects.toBeInstanceOf(LocalGitError);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});
