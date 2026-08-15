/**
 * Branch policy — the rules from `orchestration.md` → "Worktree branching",
 * which exist because each of them cost a real run to learn.
 *
 * Each test names the failure it prevents. A test that only pins the current
 * string would still pass if the rule it encodes were reversed.
 */

import { describe, expect, it, vi } from "vitest";
import {
  branchNameFor,
  branchPlan,
  LS_REMOTE_NO_MATCHING_REFS,
  provisionWorkspace,
  WorkspaceProvisionError,
  worktreePath,
  type GitResult,
  type GitRunner,
} from "../../src/dispatch/branch";
import { epic, issue } from "../fixtures";

const ok = (stdout = ""): GitResult => ({ code: 0, stdout, stderr: "" });
const fail = (stderr = "boom"): GitResult => ({ code: 1, stdout: "", stderr });

/**
 * What `git ls-remote --exit-code` returns when the remote answered and has no
 * matching ref. The ONLY non-zero code that means "the branch is not there";
 * every other one means the probe failed, which is a different thing entirely.
 */
const noSuchBranch = (): GitResult => ({
  code: LS_REMOTE_NO_MATCHING_REFS,
  stdout: "",
  stderr: "",
});

/** A probe that never reached an answer — auth, transport, or a server error. */
const probeFailed = (code: number, stderr = "fatal: could not read from remote"): GitResult => ({
  code,
  stdout: "",
  stderr,
});

/** A git runner scripted by the first matching argv fragment. */
function scriptedGit(
  routes: readonly [match: string, result: GitResult][],
  fallback: GitResult = ok(),
): GitRunner & { calls: { argv: readonly string[]; cwd: string }[] } {
  const calls: { argv: readonly string[]; cwd: string }[] = [];
  const runner = (async (argv: readonly string[], cwd: string) => {
    calls.push({ argv, cwd });
    const joined = argv.join(" ");
    for (const [match, result] of routes) {
      if (joined.includes(match)) return result;
    }
    return fallback;
  }) as GitRunner & { calls: typeof calls };
  runner.calls = calls;
  return runner;
}

describe("branch naming", () => {
  it("names spec-producing and code-producing phases differently, so one issue's two PRs never share a branch", () => {
    expect(branchNameFor(issue("SPEC"))).toBe("spec/FIX-1");
    expect(branchNameFor(issue("IMPLEMENTATION"))).toBe("fix/FIX-1");
    expect(branchNameFor(epic("FRAMING"))).toBe("spec/FIX-1");
    expect(branchNameFor(epic("WRAP"))).toBe("fix/FIX-1");
  });

  it("gives a read-only or terminal phase no branch at all — there is nothing to push", () => {
    expect(branchNameFor(epic("CROSS_SPEC_REVIEW"))).toBeNull();
    expect(branchNameFor(epic("ISSUES"))).toBeNull();
    expect(branchNameFor(issue("SETTLED"))).toBeNull();
  });
});

describe("the checkout plan", () => {
  it("cuts a new branch off freshly-fetched origin/main, so it never inherits the coordinator's drifted checkout", () => {
    const plan = branchPlan("fix/FIX-1", false);
    expect(plan.creating).toBe(true);
    expect(plan.commands).toEqual([
      ["fetch", "origin", "main"],
      ["checkout", "-B", "fix/FIX-1", "origin/main"],
    ]);
  });

  it("re-enters an existing branch off its OWN remote tip — resetting to origin/main here would discard every commit already on it", () => {
    const plan = branchPlan("fix/FIX-1", true);
    expect(plan.creating).toBe(false);
    expect(plan.commands).toEqual([
      ["fetch", "origin", "fix/FIX-1"],
      ["checkout", "-B", "fix/FIX-1", "origin/fix/FIX-1"],
    ]);
    // The precise regression: a re-entry must not be based on main.
    expect(plan.commands.flat()).not.toContain("origin/main");
  });

  it("never checks out the shared main ref — two parallel workers on it collide with 'already checked out'", () => {
    const everyCommand = [
      ...branchPlan("spec/FIX-1", false).commands,
      ...branchPlan("spec/FIX-1", true).commands,
      ...branchPlan("fix/FIX-2", false, "master").commands,
    ];
    for (const argv of everyCommand) {
      if (argv[0] !== "checkout") continue;
      // Every checkout is a `-B <branch> <remote-tracking ref>`; none names a
      // local branch, and none names a bare `main`.
      expect(argv[1]).toBe("-B");
      expect(argv).not.toContain("main");
      expect(argv).not.toContain("master");
      expect(argv.at(-1)).toMatch(/^origin\//);
    }
  });

  it("keeps that same rule under a non-origin remote — configurable must not mean unprotected", () => {
    const everyCommand = [
      ...branchPlan("spec/FIX-1", false, "main", "upstream").commands,
      ...branchPlan("spec/FIX-1", true, "main", "upstream").commands,
      ...branchPlan("fix/FIX-2", false, "trunk", "fork").commands,
    ];
    for (const argv of everyCommand) {
      if (argv[0] !== "checkout") continue;
      expect(argv[1]).toBe("-B");
      // Still a remote-tracking ref, still never a bare local branch name.
      expect(argv).not.toContain("main");
      expect(argv).not.toContain("trunk");
      expect(argv.at(-1)).toMatch(/^(upstream|fork)\//);
    }
  });

  it("honours a repo whose default branch is not main", () => {
    expect(branchPlan("fix/FIX-1", false, "master").commands).toEqual([
      ["fetch", "origin", "master"],
      ["checkout", "-B", "fix/FIX-1", "origin/master"],
    ]);
  });

  it("fetches and tracks the CONFIGURED remote — an `upstream` repo must not be provisioned from `origin`", () => {
    expect(branchPlan("fix/FIX-1", false, "main", "upstream").commands).toEqual([
      ["fetch", "upstream", "main"],
      ["checkout", "-B", "fix/FIX-1", "upstream/main"],
    ]);
    expect(branchPlan("fix/FIX-1", true, "main", "upstream").commands).toEqual([
      ["fetch", "upstream", "fix/FIX-1"],
      ["checkout", "-B", "fix/FIX-1", "upstream/fix/FIX-1"],
    ]);
  });
});

describe("worktree paths", () => {
  it("keeps every worktree under the repo's own .conductor directory", () => {
    expect(worktreePath("/repo", "FIX-1")).toBe("/repo/.conductor/worktrees/FIX-1");
  });

  it("refuses an id that would climb out of the worktree root", () => {
    expect(() => worktreePath("/repo", "../../etc")).toThrow(WorkspaceProvisionError);
    expect(() => worktreePath("/repo", "a/b")).toThrow(WorkspaceProvisionError);
  });
});

describe("provisioning to the declared isolation model", () => {
  it("provisions nothing for a remote dispatcher — the vendor owns that environment", async () => {
    const git = scriptedGit([]);
    const provisioned = await provisionWorkspace({
      isolation: "remote",
      repoRoot: "/repo",
      entityId: "FIX-1",
      branch: "fix/FIX-1",
      git,
    });
    expect(provisioned.path).toBeNull();
    expect(git.calls).toHaveLength(0);
  });

  it("adds a detached worktree and puts it on the branch, so adding it never occupies a branch ref", async () => {
    const git = scriptedGit([
      ["worktree list", ok("worktree /repo\n")],
      ["ls-remote", noSuchBranch()], // branch not on the remote yet → creation
    ]);
    const provisioned = await provisionWorkspace({
      isolation: "worktree",
      repoRoot: "/repo",
      entityId: "FIX-1",
      branch: "fix/FIX-1",
      git,
    });

    expect(provisioned.path).toBe("/repo/.conductor/worktrees/FIX-1");
    expect(git.calls.map((c) => c.argv.join(" "))).toEqual([
      "worktree list --porcelain",
      "worktree add --detach /repo/.conductor/worktrees/FIX-1",
      "ls-remote --exit-code --heads origin fix/FIX-1",
      "fetch origin main",
      "checkout -B fix/FIX-1 origin/main",
    ]);
    // The checkout runs *inside* the worktree, not in the repo root.
    expect(git.calls.at(-1)?.cwd).toBe("/repo/.conductor/worktrees/FIX-1");
  });

  it("does not re-add a worktree it already has — `worktree add` on an existing path fails the whole dispatch", async () => {
    const git = scriptedGit([
      ["worktree list", ok("worktree /repo\nworktree /repo/.conductor/worktrees/FIX-1\n")],
      ["ls-remote", ok("abc refs/heads/fix/FIX-1")],
    ]);
    await provisionWorkspace({
      isolation: "worktree",
      repoRoot: "/repo",
      entityId: "FIX-1",
      branch: "fix/FIX-1",
      git,
    });
    expect(git.calls.map((c) => c.argv.join(" "))).not.toContain(
      "worktree add --detach /repo/.conductor/worktrees/FIX-1",
    );
  });

  it("treats a branch already on origin as a re-entry, so a second feedback round keeps its commits", async () => {
    const git = scriptedGit([
      ["worktree list", ok("worktree /repo\n")],
      ["ls-remote", ok("abc refs/heads/fix/FIX-1")],
    ]);
    await provisionWorkspace({
      isolation: "worktree",
      repoRoot: "/repo",
      entityId: "FIX-1",
      branch: "fix/FIX-1",
      git,
    });
    expect(git.calls.map((c) => c.argv.join(" "))).toContain(
      "checkout -B fix/FIX-1 origin/fix/FIX-1",
    );
  });

  it("runs a cwd dispatcher's checkout in the repo root and cuts no worktree", async () => {
    const git = scriptedGit([["ls-remote", noSuchBranch()]]);
    const provisioned = await provisionWorkspace({
      isolation: "cwd",
      repoRoot: "/repo",
      entityId: "FIX-1",
      branch: "spec/FIX-1",
      git,
    });
    expect(provisioned.path).toBe("/repo");
    expect(git.calls.every((c) => c.cwd === "/repo")).toBe(true);
    expect(git.calls.some((c) => c.argv[0] === "worktree")).toBe(false);
  });

  it("skips the checkout entirely for a phase with no branch", async () => {
    const git = scriptedGit([["worktree list", ok("worktree /repo\n")]]);
    await provisionWorkspace({
      isolation: "worktree",
      repoRoot: "/repo",
      entityId: "FIX-1",
      branch: null,
      git,
    });
    expect(git.calls.some((c) => c.argv[0] === "checkout")).toBe(false);
  });

  it("fails loudly when git fails, rather than handing a dispatcher a workspace on the wrong branch", async () => {
    const git = scriptedGit([
      ["worktree list", ok("worktree /repo\n")],
      ["ls-remote", noSuchBranch()],
      ["fetch", fail("could not read from remote")],
    ]);
    await expect(
      provisionWorkspace({
        isolation: "worktree",
        repoRoot: "/repo",
        entityId: "FIX-1",
        branch: "fix/FIX-1",
        git,
      }),
    ).rejects.toBeInstanceOf(WorkspaceProvisionError);
  });

  it("stops at the first failure instead of running the rest of the plan", async () => {
    const git = vi.fn<GitRunner>(async (argv) =>
      argv[0] === "worktree" && argv[1] === "list" ? ok("worktree /repo\n") : fail(),
    );
    await expect(
      provisionWorkspace({
        isolation: "worktree",
        repoRoot: "/repo",
        entityId: "FIX-1",
        branch: "fix/FIX-1",
        git,
      }),
    ).rejects.toThrow(/worktree add/);
    expect(git).toHaveBeenCalledTimes(2);
  });
});

describe("the branch-existence probe", () => {
  /** Everything the provisioner did after the probe. */
  const afterProbe = (calls: readonly { argv: readonly string[] }[]) =>
    calls.map((c) => c.argv.join(" ")).filter((argv) => argv.startsWith("checkout"));

  it("reads exit 2 — and only exit 2 — as 'the remote has no such branch'", async () => {
    const git = scriptedGit([
      ["worktree list", ok("worktree /repo\n")],
      ["ls-remote", noSuchBranch()],
    ]);
    await provisionWorkspace({
      isolation: "worktree",
      repoRoot: "/repo",
      entityId: "FIX-1",
      branch: "fix/FIX-1",
      git,
    });
    expect(afterProbe(git.calls)).toEqual(["checkout -B fix/FIX-1 origin/main"]);
  });

  // The one that costs commits. A 128 is git's code for "could not talk to the
  // remote" — auth, DNS, a GitHub 5xx. Reading it as absence picks the creation
  // plan, whose `checkout -B <branch> <remote>/<base>` RESETS a branch that may
  // already carry a round of review fixes.
  it.each([
    [1, "a generic failure"],
    [128, "an unreachable remote or bad credentials"],
    [129, "a usage error"],
  ])("refuses to provision when the probe exits %i (%s)", async (code) => {
    const git = scriptedGit([
      ["worktree list", ok("worktree /repo\n")],
      ["ls-remote", probeFailed(code)],
    ]);
    await expect(
      provisionWorkspace({
        isolation: "worktree",
        repoRoot: "/repo",
        entityId: "FIX-1",
        branch: "fix/FIX-1",
        git,
      }),
    ).rejects.toBeInstanceOf(WorkspaceProvisionError);

    // The precise regression: nothing was checked out, so no commit was reset.
    expect(afterProbe(git.calls)).toEqual([]);
    expect(git.calls.some((c) => c.argv[0] === "fetch")).toBe(false);
  });

  it("names the branch it could not resolve, so the failure is not mistaken for a missing branch", async () => {
    const git = scriptedGit([
      ["worktree list", ok("worktree /repo\n")],
      ["ls-remote", probeFailed(128, "fatal: Authentication failed")],
    ]);
    const error = await provisionWorkspace({
      isolation: "worktree",
      repoRoot: "/repo",
      entityId: "FIX-1",
      branch: "fix/FIX-1",
      git,
    }).catch((thrown: unknown) => thrown as WorkspaceProvisionError);

    expect(error).toBeInstanceOf(WorkspaceProvisionError);
    expect(error.message).toContain("fix/FIX-1");
    expect(error.stderr).toBe("fatal: Authentication failed");
    expect(error.argv).toEqual(["ls-remote", "--exit-code", "--heads", "origin", "fix/FIX-1"]);
  });

  it("records the probe on the audit trail whether or not it answered", async () => {
    const git = scriptedGit([
      ["worktree list", ok("worktree /repo\n")],
      ["ls-remote", noSuchBranch()],
    ]);
    const provisioned = await provisionWorkspace({
      isolation: "worktree",
      repoRoot: "/repo",
      entityId: "FIX-1",
      branch: "fix/FIX-1",
      git,
    });
    expect(provisioned.ran.map((argv) => argv.join(" "))).toContain(
      "ls-remote --exit-code --heads origin fix/FIX-1",
    );
  });
});

describe("provisioning against a non-origin remote", () => {
  it("probes, fetches, and tracks the configured remote end to end", async () => {
    const git = scriptedGit([
      ["worktree list", ok("worktree /repo\n")],
      ["ls-remote", noSuchBranch()],
    ]);
    await provisionWorkspace({
      isolation: "worktree",
      repoRoot: "/repo",
      entityId: "FIX-1",
      branch: "fix/FIX-1",
      git,
      remote: "upstream",
    });

    const argvs = git.calls.map((c) => c.argv.join(" "));
    expect(argvs).toEqual([
      "worktree list --porcelain",
      "worktree add --detach /repo/.conductor/worktrees/FIX-1",
      "ls-remote --exit-code --heads upstream fix/FIX-1",
      "fetch upstream main",
      "checkout -B fix/FIX-1 upstream/main",
    ]);
    // The regression: a checkout whose repo is `upstream` must never touch
    // `origin`, which may be a fork or may not exist at all.
    expect(argvs.some((argv) => argv.includes("origin"))).toBe(false);
  });

  it("re-enters an existing branch on the configured remote, not on origin", async () => {
    const git = scriptedGit([
      ["worktree list", ok("worktree /repo\n")],
      ["ls-remote", ok("abc refs/heads/fix/FIX-1")],
    ]);
    await provisionWorkspace({
      isolation: "worktree",
      repoRoot: "/repo",
      entityId: "FIX-1",
      branch: "fix/FIX-1",
      git,
      remote: "upstream",
    });
    expect(git.calls.map((c) => c.argv.join(" "))).toContain(
      "checkout -B fix/FIX-1 upstream/fix/FIX-1",
    );
  });

  it("defaults to origin when the config names no remote", async () => {
    const git = scriptedGit([
      ["worktree list", ok("worktree /repo\n")],
      ["ls-remote", noSuchBranch()],
    ]);
    await provisionWorkspace({
      isolation: "worktree",
      repoRoot: "/repo",
      entityId: "FIX-1",
      branch: "fix/FIX-1",
      git,
    });
    expect(git.calls.map((c) => c.argv.join(" "))).toContain(
      "ls-remote --exit-code --heads origin fix/FIX-1",
    );
  });
});
