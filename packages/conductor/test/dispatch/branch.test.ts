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
  DETACHED_AT_BASE,
  detachedBasePlan,
  LS_REMOTE_NO_MATCHING_REFS,
  provisionWorkspace,
  WorkspaceProvisionError,
  worktreePath,
  type GitResult,
  type GitRunner,
  type WorkspaceRef,
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
    expect(plan.kind).toBe("creation");
    expect(plan.commands).toEqual([
      ["fetch", "origin", "main"],
      ["checkout", "-B", "fix/FIX-1", "origin/main"],
    ]);
  });

  it("re-enters an existing branch off its OWN remote tip — resetting to origin/main here would discard every commit already on it", () => {
    const plan = branchPlan("fix/FIX-1", true);
    expect(plan.kind).toBe("re-entry");
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

describe("the detached plan — work measured against the base, not written on a branch", () => {
  it("fetches the base and puts HEAD on it, naming no branch at all", () => {
    const plan = detachedBasePlan();
    expect(plan.kind).toBe("detached");
    expect(plan.branch).toBeNull();
    expect(plan.commands).toEqual([
      ["fetch", "origin", "main"],
      ["checkout", "--detach", "origin/main"],
    ]);
  });

  it("honours the configured base and remote, like every other plan here", () => {
    expect(detachedBasePlan("release", "upstream").commands).toEqual([
      ["fetch", "upstream", "release"],
      ["checkout", "--detach", "upstream/release"],
    ]);
  });

  // The rule the whole module exists for, held by the third plan too. Naming the
  // base branch instead of detaching would be `checkout -B main origin/main`,
  // which occupies the shared `main` ref — two parallel workers on it collide,
  // and under `cwd` it resets a developer's own base.
  it("occupies no ref, so it never collides on the shared base the way `-B <base>` would", () => {
    for (const argv of [
      ...detachedBasePlan().commands,
      ...detachedBasePlan("trunk", "fork").commands,
    ]) {
      if (argv[0] !== "checkout") continue;
      expect(argv).toContain("--detach");
      expect(argv).not.toContain("-B");
      expect(argv).not.toContain("main");
      expect(argv).not.toContain("trunk");
      expect(argv.at(-1)).toMatch(/^(origin|fork)\//);
    }
  });
});

describe("provisioning detached at the base", () => {
  it("asks the remote nothing — no branch name means no creation/re-entry question", async () => {
    const git = scriptedGit([["worktree list", ok("worktree /repo\n")]]);
    await provisionWorkspace({
      isolation: "worktree",
      repoRoot: "/repo",
      entityId: "FIX-1",
      branch: DETACHED_AT_BASE,
      git,
    });

    expect(git.calls.map((c) => c.argv.join(" "))).toEqual([
      "worktree list --porcelain",
      "worktree add --detach /repo/.conductor/worktrees/FIX-1",
      "fetch origin main",
      "checkout --detach origin/main",
    ]);
    // The probe is what a plan keyed on a branch name has to run, and it is the
    // one command here that could fail without the base ever being wrong.
    expect(git.calls.some((c) => c.argv[0] === "ls-remote")).toBe(false);
  });

  // The precise regression the branch name carried. A brief tells an agent to
  // commit its work and push, so `goal-check/<id>` is a name a vendor can put on
  // the remote — after which the probe finds it, the re-entry plan applies, and
  // the next proof is taken against the PREVIOUS proof's commits instead of the
  // base. A plan with no name has nothing for that to attach to.
  it("provisions identically on a second pass, whatever the remote has grown in between", async () => {
    const request = {
      isolation: "worktree",
      repoRoot: "/repo",
      entityId: "FIX-1",
      branch: DETACHED_AT_BASE,
      git: scriptedGit([
        ["worktree list", ok("worktree /repo\n")],
        // Everything a vendor could have pushed, answered as "it is there".
        ["ls-remote", ok("abc refs/heads/goal-check/FIX-1")],
      ]),
    } as const;

    const first = await provisionWorkspace(request);
    const second = await provisionWorkspace(request);

    expect(second.ran).toEqual(first.ran);
    expect(second.ran.map((argv) => argv.join(" "))).toContain(
      "checkout --detach origin/main",
    );
    expect(second.ran.flat()).not.toContain("-B");
    expect(second.ran.flat().join(" ")).not.toContain("goal-check");
  });

  it("still refuses to guess when git itself fails, rather than running the work on whatever HEAD was", async () => {
    const git = scriptedGit([
      ["worktree list", ok("worktree /repo\n")],
      ["fetch", fail("could not read from remote")],
    ]);
    await expect(
      provisionWorkspace({
        isolation: "worktree",
        repoRoot: "/repo",
        entityId: "FIX-1",
        branch: DETACHED_AT_BASE,
        git,
      }),
    ).rejects.toBeInstanceOf(WorkspaceProvisionError);
    expect(git.calls.some((c) => c.argv[0] === "checkout" && c.argv[1] === "--detach")).toBe(
      false,
    );
  });
});

describe("a worktree that survived the last dispatch", () => {
  /**
   * A git that models the one thing a checkout does **not** do: an uncommitted
   * edit survives it.
   *
   * `fetch` and `checkout` carry whatever is in the tree across — that is the
   * whole defect. Only `reset --hard` (tracked modifications) and `clean -fd`
   * (untracked files) empty it, and they are separate commands because neither
   * one covers the other's half. A fake that answered `ok()` to everything would
   * let a provisioner that scrubs nothing pass.
   */
  function gitWithLeftovers(): GitRunner & {
    readonly tree: { modified: string[]; untracked: string[] };
  } {
    const tree = { modified: ["src/thing.ts"], untracked: ["src/scratch.ts"] };
    const runner = (async (argv: readonly string[]): Promise<GitResult> => {
      if (argv[0] === "worktree" && argv[1] === "list") {
        return ok("worktree /repo\nworktree /repo/.conductor/worktrees/FIX-1\n");
      }
      if (argv[0] === "ls-remote") return ok("abc refs/heads/fix/FIX-1");
      if (argv[0] === "reset" && argv[1] === "--hard") {
        tree.modified = [];
        return ok();
      }
      if (argv[0] === "clean") {
        tree.untracked = [];
        return ok();
      }
      return ok();
    }) as GitRunner & { tree: typeof tree };
    Object.defineProperty(runner, "tree", { get: () => tree });
    return runner;
  }

  const reEnter = (git: GitRunner, branch: WorkspaceRef = "fix/FIX-1") =>
    provisionWorkspace({
      isolation: "worktree",
      repoRoot: "/repo",
      entityId: "FIX-1",
      branch,
      git,
    });

  // The debt `model/phases` → IMPLEMENTATION and README → "The lifecycle of a
  // proof" both state and neither can detect: a verdict is only as good as the
  // tree the command ran in. An edit the last dispatch left behind is code that
  // is in the tree and in no revision, so a check that passes on it has proved
  // something that exists nowhere — and the proof is then bound to a SHA that
  // does not describe what ran.
  it("hands over a re-entered worktree with nothing uncommitted in it, so a goal check cannot pass on code that is in no revision", async () => {
    const git = gitWithLeftovers();
    await reEnter(git);
    expect(git.tree).toEqual({ modified: [], untracked: [] });
  });

  it("scrubs a worktree re-entered detached at the base too — the ground a post-merge proof stands on", async () => {
    const git = gitWithLeftovers();
    await reEnter(git, DETACHED_AT_BASE);
    expect(git.tree).toEqual({ modified: [], untracked: [] });
  });

  // Ordering, not just presence. After the checkout the edit has already been
  // carried onto the branch the dispatch will work on — and a `checkout -B` over
  // a conflicting local change fails outright, which turns a stale edit into a
  // dead dispatch.
  it("scrubs before the checkout, not after it", async () => {
    const git = scriptedGit([
      ["worktree list", ok("worktree /repo\nworktree /repo/.conductor/worktrees/FIX-1\n")],
      ["ls-remote", ok("abc refs/heads/fix/FIX-1")],
    ]);
    await reEnter(git);

    const ran = git.calls.map((c) => c.argv.join(" "));
    const scrubbed = ran.findIndex((argv) => argv.startsWith("reset --hard"));
    const checkedOut = ran.findIndex((argv) => argv.startsWith("checkout"));
    expect(scrubbed).toBeGreaterThanOrEqual(0);
    expect(checkedOut).toBeGreaterThan(scrubbed);
    // In the worktree, never in the repo root — scrubbing the root would be the
    // developer's own tree.
    expect(git.calls[scrubbed]?.cwd).toBe("/repo/.conductor/worktrees/FIX-1");
  });

  // The sibling path, and the one that must NOT be touched. `worktree add`
  // produces a clean checkout by construction, so scrubbing it is two git calls
  // buying nothing.
  it("does not scrub a worktree it just created", async () => {
    const git = scriptedGit([
      ["worktree list", ok("worktree /repo\n")],
      ["ls-remote", noSuchBranch()],
    ]);
    await reEnter(git);
    expect(git.calls.some((c) => c.argv[0] === "reset" || c.argv[0] === "clean")).toBe(false);
  });

  // The other sibling, and the reason the scrub is scoped to a worktree rather
  // than to every provision: under `cwd` the workspace IS the developer's repo
  // root. A `reset --hard` there destroys uncommitted work conductor was never
  // given, which is a far worse failure than the one being fixed.
  it("never scrubs a cwd provision — that tree belongs to a human, not to conductor", async () => {
    const git = scriptedGit([["ls-remote", ok("abc refs/heads/fix/FIX-1")]]);
    await provisionWorkspace({
      isolation: "cwd",
      repoRoot: "/repo",
      entityId: "FIX-1",
      branch: "fix/FIX-1",
      git,
    });
    expect(git.calls.some((c) => c.argv[0] === "reset" || c.argv[0] === "clean")).toBe(false);
  });

  it("records the scrub on the audit trail, like every other command it runs", async () => {
    const provisioned = await reEnter(gitWithLeftovers());
    expect(provisioned.ran.map((argv) => argv.join(" "))).toEqual([
      "worktree list --porcelain",
      "reset --hard",
      "clean -fd",
      "ls-remote --exit-code --heads origin fix/FIX-1",
      "fetch origin fix/FIX-1",
      "checkout -B fix/FIX-1 origin/fix/FIX-1",
    ]);
  });

  it("fails the dispatch rather than running it in a tree it could not clean", async () => {
    const git = scriptedGit([
      ["worktree list", ok("worktree /repo\nworktree /repo/.conductor/worktrees/FIX-1\n")],
      ["clean", fail("fatal: could not remove")],
    ]);
    await expect(reEnter(git)).rejects.toBeInstanceOf(WorkspaceProvisionError);
    expect(git.calls.some((c) => c.argv[0] === "checkout")).toBe(false);
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

  it("produces the canonical path whatever shape the configured root has — git only ever reports one", () => {
    // `git worktree list` prints `/repo/.conductor/worktrees/FIX-1` regardless
    // of how repoRoot was written, so anything else here is a path that can
    // never be found in that list.
    for (const root of ["/repo/", "/repo//", "/repo/./", "/repo/sub/.."]) {
      expect(worktreePath(root, "FIX-1")).toBe("/repo/.conductor/worktrees/FIX-1");
    }
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

describe("a repoRoot that is not already canonical", () => {
  /**
   * A git that keeps a real worktree registry, the way the daemon does: `worktree
   * add` records the path **canonicalized**, `worktree list` prints back what was
   * recorded, and adding a path that is already registered fails.
   *
   * That canonicalization is the whole failure. A first pass always succeeds —
   * the registry is empty, so no comparison happens — and the failure only
   * surfaces on the *second* provisioning of the same entity, which is every
   * spec-review and PR-feedback round.
   */
  function gitWithWorktreeRegistry(): GitRunner & { readonly registry: string[] } {
    const registry: string[] = ["/repo"];
    const runner = (async (argv: readonly string[]): Promise<GitResult> => {
      if (argv[0] === "worktree" && argv[1] === "list") {
        return ok(registry.map((p) => `worktree ${p}\n`).join(""));
      }
      if (argv[0] === "worktree" && argv[1] === "add") {
        const requested = argv.at(-1)!;
        const canonical = requested.replace(/\/{2,}/g, "/").replace(/\/$/, "");
        if (registry.includes(canonical)) {
          return fail(`fatal: '${requested}' is already registered`);
        }
        registry.push(canonical);
        return ok();
      }
      if (argv[0] === "ls-remote") return ok("abc refs/heads/fix/FIX-1");
      return ok();
    }) as GitRunner & { registry: string[] };
    Object.defineProperty(runner, "registry", { get: () => registry });
    return runner;
  }

  const provisionTwice = async (repoRoot: string, git: GitRunner) => {
    const request = {
      isolation: "worktree",
      repoRoot,
      entityId: "FIX-1",
      branch: "fix/FIX-1",
      git,
    } as const;
    const first = await provisionWorkspace(request);
    const second = await provisionWorkspace(request);
    return { first, second };
  };

  // The regression: a trailing slash makes the target `/repo//.conductor/...`,
  // which git canonicalizes away in `worktree list`. The `includes` check then
  // misses, and the re-entry re-runs `worktree add` on a path git already has —
  // failing the whole dispatch on round two of a PR-feedback loop.
  it("re-enters a worktree it already provisioned when the root carries a trailing slash", async () => {
    const git = gitWithWorktreeRegistry();
    const { first, second } = await provisionTwice("/repo/", git);

    expect(first.path).toBe("/repo/.conductor/worktrees/FIX-1");
    expect(second.path).toBe("/repo/.conductor/worktrees/FIX-1");
    // Added exactly once across both passes — the second found it and moved on.
    expect(second.ran.map((argv) => argv.join(" "))).not.toContain(
      "worktree add --detach /repo/.conductor/worktrees/FIX-1",
    );
    expect(git.registry).toEqual(["/repo", "/repo/.conductor/worktrees/FIX-1"]);
  });

  it("behaves identically to a root that was already canonical", async () => {
    const slashed = gitWithWorktreeRegistry();
    const plain = gitWithWorktreeRegistry();
    const withSlash = await provisionTwice("/repo/", slashed);
    const without = await provisionTwice("/repo", plain);
    expect(withSlash.second.ran).toEqual(without.second.ran);
    expect(slashed.registry).toEqual(plain.registry);
  });

  it("never hands git a path it would have to canonicalize", async () => {
    const git = scriptedGit([
      ["worktree list", ok("worktree /repo\n")],
      ["ls-remote", noSuchBranch()],
    ]);
    const provisioned = await provisionWorkspace({
      isolation: "worktree",
      repoRoot: "/repo//",
      entityId: "FIX-1",
      branch: "fix/FIX-1",
      git,
    });
    for (const { argv, cwd } of git.calls) {
      expect(cwd).not.toMatch(/\/\//);
      expect(argv.join(" ")).not.toMatch(/\/\//);
    }
    expect(provisioned.ran.flat().join(" ")).not.toMatch(/\/\//);
  });

  it("runs a cwd dispatcher in the canonical root too", async () => {
    const git = scriptedGit([["ls-remote", noSuchBranch()]]);
    const provisioned = await provisionWorkspace({
      isolation: "cwd",
      repoRoot: "/repo/",
      entityId: "FIX-1",
      branch: "spec/FIX-1",
      git,
    });
    expect(provisioned.path).toBe("/repo");
    expect(git.calls.every((c) => c.cwd === "/repo")).toBe(true);
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
