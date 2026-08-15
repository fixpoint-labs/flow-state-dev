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
 *   `git checkout -B <branch> <remote>/<base>` off a freshly-fetched
 *   remote-tracking ref, which occupies nothing and any number of workers can
 *   run at once. Which remote that is comes from the config (`ConductorConfig.remote`,
 *   default `origin`); that it is a *remote-tracking* ref and never the local
 *   branch is the rule, and it holds whatever the remote is called.
 * - **`-B` off `<remote>/<base>` only at branch *creation*.** `-B` resets the
 *   branch, so running it on re-entry discards every commit already on it.
 *   Re-entry — a spec-review round, a PR-feedback round, each in a fresh
 *   worktree — fetches and checks out the *existing* branch instead.
 *
 * A third rule sits beside them and is about the *tree* rather than the ref: a
 * worktree that is re-entered is handed over **clean**. An edit left behind by
 * the last dispatch is code that is in the tree and in no revision, and the
 * proof lifecycle binds a verdict to a revision — see
 * {@link WORKTREE_SCRUB_COMMANDS}, which is where that debt is paid.
 *
 * Whether it is creation or re-entry is derived, not remembered: a branch that
 * exists on the remote is a re-entry. There is no flag for a caller to get wrong.
 * Because the creation plan *resets* the branch, that derivation must never be
 * made from a failed probe — see {@link LS_REMOTE_NO_MATCHING_REFS}.
 *
 * There is a **third plan**, and it is outside that derivation rather than a
 * special case inside it: {@link detachedBasePlan} puts a workspace on the
 * remote's base at its current revision and on no branch at all. Work that is
 * *measured* rather than written needs the code a reader of the base would
 * actually get, which is not any branch conductor pushes. Having no branch is
 * what makes it safe — see that function for why the creation/re-entry question
 * is neither answerable nor needed there.
 */

import path from "node:path";

import type { ConductorEntity } from "../driver/derive-gate";
import type { IsolationModel } from "./types";

/** The default base every issue branch is cut from. */
export const DEFAULT_BASE_BRANCH = "main";

/** The remote used when the config names none. Matches `ConductorConfig.remote`'s default. */
export const DEFAULT_REMOTE = "origin";

/**
 * The exit code `git ls-remote --exit-code` uses for "the remote answered, and
 * it has no ref matching this pattern".
 *
 * Documented in `git-ls-remote(1)`: *"Exit with status 2 when no matching refs
 * are found in the remote repository. Usually the command exits with status 0
 * to indicate it successfully talked with the remote repository, whether it
 * found any matching refs."* Verified against git 2.43: a missing branch exits
 * 2, an unknown remote or an unreachable host exits 128.
 *
 * **Only this code means absence.** Every other non-zero exit — auth, transport,
 * a server 5xx — means the probe never learned anything, and a probe that
 * learned nothing must not be read as "the branch does not exist": that answer
 * selects the creation plan, which is a `checkout -B` that resets the branch to
 * the base and throws away every commit already on it.
 */
export const LS_REMOTE_NO_MATCHING_REFS = 2;

/** Where conductor keeps its worktrees, relative to the repo root. */
export const WORKTREE_ROOT = ".conductor/worktrees";

/**
 * What it takes to hand a re-entered worktree over with nothing uncommitted in
 * it, as argv arrays **without** the leading `git`.
 *
 * **This is the precondition the proof lifecycle is owed and cannot check.** A
 * verdict is only as good as the tree the command ran in: conductor binds a
 * proof to a revision, so an edit a previous dispatch left behind is code that
 * is *in the tree and in no revision*, and a check that passes on it has proved
 * something that exists nowhere — recorded against a SHA that does not describe
 * what ran. `model/phases` → `IMPLEMENTATION` and the README's "The lifecycle of
 * a proof" both state the debt and both say the same thing about it: nothing in
 * the phase table can detect its absence, so it has to be closed here.
 *
 * **A checkout does not close it.** Neither `checkout -B` nor `checkout
 * --detach` discards a working-tree change — git carries an uncommitted edit
 * across a switch, and refuses the switch outright when it would be overwritten.
 * So a re-entry inherits whatever the last dispatch left, and the two ways that
 * ends are a proof of code in no revision or a dispatch that dies on the
 * checkout.
 *
 * **Two commands, because neither covers the other's half.** `reset --hard`
 * discards tracked modifications and anything staged; `clean -fd` removes
 * untracked files and directories.
 *
 * **Without `-x`, deliberately.** Ignored files — `node_modules`, build output,
 * a local `.env` — are outside the revision by design, and removing them makes
 * every re-entry pay a reinstall. The failure being closed is a *source* edit
 * that a check would compile. A stale build artifact influencing a verdict is a
 * real but different hazard, and buying a full reinstall per round is not the
 * shape of its fix.
 */
export const WORKTREE_SCRUB_COMMANDS: readonly (readonly string[])[] = [
  ["reset", "--hard"],
  ["clean", "-fd"],
];

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
 * Which of the three plans a {@link BranchPlan} is.
 *
 * A discriminant rather than a `creating` boolean, because there are three
 * plans and a boolean can hold two. `"detached"` reading as `creating: false`
 * would have said "re-entry to an existing branch", which is the one thing it
 * is not.
 */
export type BranchPlanKind = "creation" | "re-entry" | "detached";

/**
 * The git commands that leave a worktree where a dispatch needs it, as argv
 * arrays **without** the leading `git` (the runner supplies the binary).
 */
export interface BranchPlan {
  readonly kind: BranchPlanKind;
  /** The branch the workspace ends on; `null` for a detached provision. */
  readonly branch: string | null;
  readonly commands: readonly (readonly string[])[];
}

/**
 * Build the checkout plan for a branch.
 *
 * Work that is *written* goes on a branch, and this is the plan for it. Work
 * that is *measured* against the base does not — see {@link detachedBasePlan},
 * which is a plan of its own precisely so that "the base at its current
 * revision" is not spelled as a branch name nobody pushes.
 *
 * @param branch The branch to end up on.
 * @param existsOnRemote Whether the remote already has it — the creation/re-entry
 *   discriminator. Must be a *known* answer, never a failed probe.
 * @param baseBranch What a new branch is cut from. Defaults to `main`.
 * @param remote The remote to fetch and track. Defaults to `origin`. Every
 *   checkout stays on `<remote>/<ref>` whatever this is, so the shared local
 *   branch is never occupied.
 */
export function branchPlan(
  branch: string,
  existsOnRemote: boolean,
  baseBranch: string = DEFAULT_BASE_BRANCH,
  remote: string = DEFAULT_REMOTE,
): BranchPlan {
  if (existsOnRemote) {
    // Re-entry: base on the branch's own remote tip so its commits survive.
    return {
      kind: "re-entry",
      branch,
      commands: [
        ["fetch", remote, branch],
        ["checkout", "-B", branch, `${remote}/${branch}`],
      ],
    };
  }
  return {
    kind: "creation",
    branch,
    commands: [
      ["fetch", remote, baseBranch],
      ["checkout", "-B", branch, `${remote}/${baseBranch}`],
    ],
  };
}

/**
 * Provision **detached at the remote's base**, on no branch at all.
 *
 * For work that measures rather than writes. A post-merge goal check has to be
 * taken against what a reader of the base branch would actually get — which is
 * not the feature branch, whenever the merge squashed, resolved a conflict, or
 * the base moved on afterwards. This says that directly: fetch the base, put
 * HEAD on `<remote>/<base>`, own no ref.
 *
 * **What happens on re-entry**, since the other two plans turn on that question
 * and a detached checkout cannot answer it: there is no re-entry to derive, and
 * none to need. The plan is unconditional and identical on every pass, and each
 * pass moves HEAD to whatever the base is *now* — which is what a fresh proof
 * wants, and the reason there is nothing to preserve between passes. A commit
 * made on a detached HEAD belongs to no branch and goes nowhere, so no pass can
 * leave state a later one would have to keep. Consequently there is no
 * `ls-remote` probe here either: the creation/re-entry discriminator is not
 * asked, so the failed-probe hazard {@link LS_REMOTE_NO_MATCHING_REFS} guards
 * against has nothing to bite.
 *
 * **And nothing a vendor pushes can change it.** That is the property a branch
 * name could not hold. A brief tells an agent to commit its work and push, so a
 * name like `goal-check/<id>` is a name a vendor can put on the remote — after
 * which the probe finds it, the re-entry plan applies, and the next proof is
 * taken against the *previous* proof's commits instead of the base. A plan with
 * no branch name has nothing for that to attach to.
 *
 * It also stays inside the rule the whole module exists for: `--detach`
 * occupies no ref, so this never checks out the shared base the way a
 * `checkout -B <base> <remote>/<base>` would — the collision parallel workers
 * hit on `main`.
 */
export function detachedBasePlan(
  baseBranch: string = DEFAULT_BASE_BRANCH,
  remote: string = DEFAULT_REMOTE,
): BranchPlan {
  return {
    kind: "detached",
    branch: null,
    commands: [
      ["fetch", remote, baseBranch],
      ["checkout", "--detach", `${remote}/${baseBranch}`],
    ],
  };
}

/**
 * Ask for a provision detached at the remote's base, in place of a branch name.
 *
 * A symbol rather than a reserved branch name, and that is the whole point: a
 * reserved name is a naming convention, and a naming convention is what this
 * replaces. No branch any remote could ever carry collides with it, and no
 * caller can pass it by accident.
 */
export const DETACHED_AT_BASE: unique symbol = Symbol("conductor.detached-at-base");

/**
 * Where a dispatch's workspace is put: a branch, the base detached, or nowhere.
 *
 * `null` means the phase produces nothing and no checkout runs at all — which is
 * a different thing from {@link DETACHED_AT_BASE}, where a checkout very much
 * runs and lands on the base.
 */
export type WorkspaceRef = string | typeof DETACHED_AT_BASE | null;

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
 * The worktree directory for an entity, in the canonical form git reports.
 *
 * Rejects an id that could climb out of the worktree root — ids come from a
 * tracker, and a tracker is not a place to hold a path traversal.
 *
 * **Normalized, because this path is compared against `git worktree list`.** A
 * `repoRoot` carrying a trailing slash would otherwise produce
 * `/repo//.conductor/worktrees/FIX-1`, which git canonicalizes to
 * `/repo/.conductor/worktrees/FIX-1` in its own output. The two never match, so
 * the *second* provisioning pass — a re-entry, the first one having registered
 * the worktree — reads the worktree as absent and re-runs `worktree add` on a
 * path git already has, failing the whole dispatch. A first provision succeeds
 * either way, which is what makes it a re-entry-only failure.
 */
export function worktreePath(repoRoot: string, entityId: string): string {
  if (entityId.includes("/") || entityId.includes("\\") || entityId.includes("..")) {
    throw new WorkspaceProvisionError(
      `Entity id ${JSON.stringify(entityId)} is not usable as a directory name.`,
      [],
      "",
    );
  }
  return path.join(path.resolve(repoRoot), WORKTREE_ROOT, entityId);
}

/** What to provision, and for whom. */
export interface ProvisionRequest {
  /** The dispatcher's declared model — conductor provisions only what it needs. */
  readonly isolation: IsolationModel;
  readonly repoRoot: string;
  readonly entityId: string;
  /**
   * Where to leave the workspace: the phase's branch, {@link DETACHED_AT_BASE}
   * for work measured against the base, or `null` for a phase that produces
   * neither.
   */
  readonly branch: WorkspaceRef;
  readonly git: GitRunner;
  readonly baseBranch?: string;
  /** The remote to probe, fetch, and track. Defaults to `origin`. */
  readonly remote?: string;
}

/** A provisioned workspace, with the git it took to get there. */
export interface ProvisionedWorkspace {
  /** Absolute directory the dispatch runs in; `null` for a `remote` dispatcher. */
  readonly path: string | null;
  /** Every git argv actually run, in order. The audit trail, and what tests assert on. */
  readonly ran: readonly (readonly string[])[];
}

/**
 * Paths git reports as existing worktrees, normalized so they compare equal to
 * a {@link worktreePath}. Both sides of that comparison are canonicalized — a
 * mismatch there is read as "not provisioned yet" and re-adds a worktree git
 * already registered.
 */
function parseWorktreeList(stdout: string): string[] {
  return stdout
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => path.resolve(line.slice("worktree ".length).trim()));
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
 *   occupies a branch ref on the way in. One it already had is scrubbed first
 *   ({@link WORKTREE_SCRUB_COMMANDS}), so no dispatch inherits an edit the last
 *   one left uncommitted.
 *
 * Which plan runs comes from `request.branch`: a name is probed and resolved to
 * {@link branchPlan}'s creation or re-entry, {@link DETACHED_AT_BASE} is
 * {@link detachedBasePlan}, and `null` checks out nothing.
 *
 * @throws WorkspaceProvisionError when any git command fails.
 */
export async function provisionWorkspace(
  request: ProvisionRequest,
): Promise<ProvisionedWorkspace> {
  const {
    isolation,
    repoRoot: declaredRepoRoot,
    entityId,
    branch,
    git,
    baseBranch,
    remote = DEFAULT_REMOTE,
  } = request;
  if (isolation === "remote") return { path: null, ran: [] };

  // Canonicalized once, then used for every cwd and every path comparison — a
  // configured `repoRoot` with a trailing slash must not produce a target git
  // reports back in a different form. See {@link worktreePath}.
  const repoRoot = path.resolve(declaredRepoRoot);

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
      // Fresh from `worktree add`, so clean by construction — scrubbing it would
      // be two git calls buying nothing.
      await run(["worktree", "add", "--detach", target], repoRoot);
    } else {
      // Re-entry, and the worktree came back carrying whatever the last dispatch
      // left in it. Scrubbed **before** the checkout: after it, the edit has
      // already been carried onto the branch this dispatch works on, and a
      // `checkout -B` over a conflicting change fails outright. See
      // {@link WORKTREE_SCRUB_COMMANDS} for why a checkout is not enough.
      //
      // Scoped to a worktree conductor cut for itself, and to nothing else. A
      // `cwd` provision's workspace is the repo root a human is sitting in, and
      // discarding uncommitted work conductor was never given is a worse failure
      // than the one this closes. That tree is the caller's to hand over clean.
      for (const argv of WORKTREE_SCRUB_COMMANDS) await run(argv, target);
    }
  }

  if (branch === null) return { path: target, ran };

  // No name, so nothing to probe: the creation/re-entry question is not asked
  // here, because the plan is the same either way. See {@link detachedBasePlan}.
  if (branch === DETACHED_AT_BASE) {
    for (const argv of detachedBasePlan(baseBranch, remote).commands) {
      await run(argv, target);
    }
    return { path: target, ran };
  }

  // `--exit-code` makes "no such branch" exit 2 rather than exit 0 with empty
  // output, so existence is read off the code without parsing refs. Anything
  // other than 0 or 2 is a failed probe, not an answer — see
  // LS_REMOTE_NO_MATCHING_REFS for why guessing here costs commits.
  const probeArgv = ["ls-remote", "--exit-code", "--heads", remote, branch];
  const probe = await git(probeArgv, repoRoot);
  ran.push(probeArgv);
  if (probe.code !== 0 && probe.code !== LS_REMOTE_NO_MATCHING_REFS) {
    throw new WorkspaceProvisionError(
      `git ${probeArgv.join(" ")} failed in ${repoRoot} (exit ${probe.code}), so conductor ` +
        `cannot tell whether ${branch} already exists on ${remote}. Refusing to provision: ` +
        `assuming it does not exist would reset the branch to the base and discard its commits.`,
      probeArgv,
      probe.stderr,
    );
  }

  for (const argv of branchPlan(branch, probe.code === 0, baseBranch, remote).commands) {
    await run(argv, target);
  }

  return { path: target, ran };
}
