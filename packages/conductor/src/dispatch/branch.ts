/**
 * Branch policy and workspace provisioning.
 *
 * The split, from the design: **conductor owns branch naming and basing; the
 * dispatcher owns workspace isolation.** Naming is process knowledge — the same
 * `spec/<ISSUE>` and `fix/<ISSUE>` convention every skill in
 * `docs/contributing/orchestration.md` → "Worktree branching" already follows —
 * so it lives here rather than being re-derived by each vendor harness.
 *
 * Two rules in that document were learned the hard way and are the entire reason
 * this module exists as code rather than as prose:
 *
 * - **Never `git checkout main`.** The shared `main` ref can be checked out in
 *   exactly one worktree at a time, so parallel workers racing on it collide
 *   (`fatal: 'main' is already checked out at ...`). Every branch is cut with
 *   `git checkout -B <branch> origin/main` off a freshly-fetched remote-tracking
 *   ref, which occupies nothing and any number of workers can run at once.
 * - **`-B` off `origin/main` only at branch *creation*.** `-B` resets the branch,
 *   so running it on re-entry discards every commit already on it. Re-entry — a
 *   spec-review round, a PR-feedback round, each in a fresh worktree — fetches
 *   and checks out the *existing* branch instead.
 *
 * Whether it is creation or re-entry is derived, not remembered: a branch that
 * exists on `origin` is a re-entry. There is no flag for a caller to get wrong.
 */

import type { ConductorEntity } from "../driver/derive-gate";
import type { IsolationModel } from "./types";

/** The default base every issue branch is cut from. */
export const DEFAULT_BASE_BRANCH = "main";

/** Where conductor keeps its worktrees, relative to the repo root. */
export const WORKTREE_ROOT = ".conductor/worktrees";

/**
 * The branch a phase's work belongs on, or `null` for a phase that produces no
 * branch (a read-only phase such as `CROSS_SPEC_REVIEW`, or a terminal one).
 *
 * Spec-producing phases get `spec/<id>`; code-producing phases get `fix/<id>`.
 */
export function branchNameFor(entity: ConductorEntity): string | null {
  switch (entity.phase) {
    case "SPEC":
    case "FRAMING":
      return `spec/${entity.id}`;
    case "IMPLEMENTATION":
    case "WRAP":
      return `fix/${entity.id}`;
    default:
      return null;
  }
}

/**
 * The git commands that put a worktree on `branch`, as argv arrays **without**
 * the leading `git` (the runner supplies the binary).
 */
export interface BranchPlan {
  readonly branch: string;
  /** True when the branch is being cut fresh; false on re-entry to an existing one. */
  readonly creating: boolean;
  readonly commands: readonly (readonly string[])[];
}

/**
 * Build the checkout plan for a branch.
 *
 * @param branch The branch to end up on.
 * @param existsOnOrigin Whether `origin` already has it — the creation/re-entry discriminator.
 * @param baseBranch What a new branch is cut from. Defaults to `main`.
 */
export function branchPlan(
  branch: string,
  existsOnOrigin: boolean,
  baseBranch: string = DEFAULT_BASE_BRANCH,
): BranchPlan {
  if (existsOnOrigin) {
    // Re-entry: base on the branch's own remote tip so its commits survive.
    return {
      branch,
      creating: false,
      commands: [
        ["fetch", "origin", branch],
        ["checkout", "-B", branch, `origin/${branch}`],
      ],
    };
  }
  return {
    branch,
    creating: true,
    commands: [
      ["fetch", "origin", baseBranch],
      ["checkout", "-B", branch, `origin/${baseBranch}`],
    ],
  };
}

/** Result of running one git command. */
export interface GitResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Runs one git command in a directory. Injected so provisioning is testable
 * without a repository, and so a host can route git through its own transport.
 * Must resolve on a non-zero exit rather than rejecting.
 */
export type GitRunner = (argv: readonly string[], cwd: string) => Promise<GitResult>;

/** Provisioning could not put the workspace on the branch. */
export class WorkspaceProvisionError extends Error {
  constructor(
    message: string,
    /** The git argv that failed. */
    readonly argv: readonly string[],
    readonly stderr: string,
  ) {
    super(message);
    this.name = "WorkspaceProvisionError";
  }
}

/**
 * The worktree directory for an entity.
 *
 * Rejects an id that could climb out of the worktree root — ids come from a
 * tracker, and a tracker is not a place to hold a path traversal.
 */
export function worktreePath(repoRoot: string, entityId: string): string {
  if (entityId.includes("/") || entityId.includes("\\") || entityId.includes("..")) {
    throw new WorkspaceProvisionError(
      `Entity id ${JSON.stringify(entityId)} is not usable as a directory name.`,
      [],
      "",
    );
  }
  return `${repoRoot}/${WORKTREE_ROOT}/${entityId}`;
}

/** What to provision, and for whom. */
export interface ProvisionRequest {
  /** The dispatcher's declared model — conductor provisions only what it needs. */
  readonly isolation: IsolationModel;
  readonly repoRoot: string;
  readonly entityId: string;
  /** The phase's branch, or `null` for a phase that produces none. */
  readonly branch: string | null;
  readonly git: GitRunner;
  readonly baseBranch?: string;
}

/** A provisioned workspace, with the git it took to get there. */
export interface ProvisionedWorkspace {
  /** Absolute directory the dispatch runs in; `null` for a `remote` dispatcher. */
  readonly path: string | null;
  /** Every git argv actually run, in order. The audit trail, and what tests assert on. */
  readonly ran: readonly (readonly string[])[];
}

/** Paths git reports as existing worktrees. */
function parseWorktreeList(stdout: string): string[] {
  return stdout
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length).trim());
}

/**
 * Provision the workspace a dispatcher's isolation model calls for, and leave it
 * on the phase's branch.
 *
 * - `remote` provisions nothing: the vendor owns its environment, and the branch
 *   travels on the brief.
 * - `cwd` runs the branch plan in the repo root.
 * - `worktree` adds `.conductor/worktrees/<entityId>` if it is missing, then runs
 *   the branch plan inside it. The worktree is added **detached** so it never
 *   occupies a branch ref on the way in.
 *
 * @throws WorkspaceProvisionError when any git command fails.
 */
export async function provisionWorkspace(
  request: ProvisionRequest,
): Promise<ProvisionedWorkspace> {
  const { isolation, repoRoot, entityId, branch, git, baseBranch } = request;
  if (isolation === "remote") return { path: null, ran: [] };

  const ran: (readonly string[])[] = [];
  const run = async (argv: readonly string[], cwd: string) => {
    const result = await git(argv, cwd);
    ran.push(argv);
    if (result.code !== 0) {
      throw new WorkspaceProvisionError(
        `git ${argv.join(" ")} failed in ${cwd} (exit ${result.code}).`,
        argv,
        result.stderr,
      );
    }
    return result;
  };

  const target = isolation === "cwd" ? repoRoot : worktreePath(repoRoot, entityId);

  if (isolation === "worktree") {
    const listed = await run(["worktree", "list", "--porcelain"], repoRoot);
    if (!parseWorktreeList(listed.stdout).includes(target)) {
      await run(["worktree", "add", "--detach", target], repoRoot);
    }
  }

  if (branch === null) return { path: target, ran };

  // `--exit-code` makes "no such branch" a non-zero exit rather than empty
  // output, so existence is read off the code without parsing refs.
  const probe = await git(["ls-remote", "--exit-code", "--heads", "origin", branch], repoRoot);
  ran.push(["ls-remote", "--exit-code", "--heads", "origin", branch]);

  for (const argv of branchPlan(branch, probe.code === 0, baseBranch).commands) {
    await run(argv, target);
  }

  return { path: target, ran };
}
