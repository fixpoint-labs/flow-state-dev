# FIX-2933 · One way to make a workspace: the manager takes a host

**Spec** · [Decisions](DECISIONS.md) · epic [FIX-2927](../../epics/FIX-2927/SPEC.md)

## Before and after

| A team that… | Today | After |
|---|---|---|
| **points the manager at a repository** | Passes a `WorkspaceConfig` or a `WorkspaceHost`; the manager sniffs which by looking for `provision` | Passes a `WorkspaceHost`. There is no second shape |
| **wants the common local-repo host** | Copies `localWorkspaceHost({ root, remotes: { allow: [] }, localRepositories: [repo], source: () => ({ kind: "repo", repo }), setup })` | Calls `localRepoWorkspaceHost({ root, repo, baseRef?, setup?, pullRequestRepo?, provisionTimeoutMs? })` |

## The goal, and how we'll know it's met

**There is one way to hand the manager a workspace, and one spelling of the local-repo host.**

| How we verify | |
|---|---|
| **Signal** | `rg WorkspaceConfig` and `rg 'hostForConfig\|isWorkspaceHost'` find nothing outside `specs/` and `docs/internal/`. The sites below call the helper, or `localWorkspaceHost` where their source is not one fixed repository. `pnpm typecheck`, the harness-manager, workspace, fsdev and shift-manager tests pass. `goals/harness-manager/checks-gate-done` and `goals/harness-manager/where-the-work-went` pass through `fsdev run` |
| **Control that must fail** | Today's tree: both `rg`s find matches |

## What changes

- **Workspace.** `localRepoWorkspaceHost(options)` in `packages/workspace/src/local-host.ts` (or a
  small module beside it), exported from the root. It resolves `repo` to an absolute path (the
  reason `hostForConfig` does), allows no remotes, and sources every run from that repository at
  `baseRef`.
- **harness-manager.** `WorkspaceConfig`, `hostForConfig` and `isWorkspaceHost` are deleted.
  The manager's `workspace` option is `WorkspaceHost`. `checkoutPathFor` and
  `provisionCheckout` in `./checkout` take what they actually read (a root and a repository, or
  the host) instead of the config; the implementer picks the narrower shape against their
  callers.
- **Callers.** `harness-manager/src/workspace.ts`, `apps/kitchen-sink/lib/harness-worktree.ts`,
  `labs/teammates/host.mts` and the goals that copy the setup call the helper.
  `labs/claude-code-style/host.mts` (a session-picked source),
  `packages/fsdev/src/commands/worktrees.ts` (several repositories, listing only) and
  `shift-manager/teams/devteam/host.mts` (several checkouts) keep `localWorkspaceHost`, because
  their source is not one fixed repository. `shift-manager`'s `hostForConfig(fixed!)` moves to the helper, and `scratch-repo.mts`'s
  doc comment stops naming `WorkspaceConfig`. `goals/harness-manager/host.mts` and the devforce-lab
  goal that calls `checkoutPathFor` follow the new signatures.
- **Docs.** The workforce doc comments that show another spelling (`project-workspace.ts`,
  `project-source.ts`, `source-read.ts`) show the helper. Contributor docs that name
  `WorkspaceConfig` are updated. User docs follow at release.
- Changesets for `@flow-state-dev/workspace` (minor, the helper) and
  `@flow-state-dev/harness-manager` (minor, `workspace` takes a host only).

## What stays as it is

`localWorkspaceHost` and its options. The run location → checkout path rule (it moves in
FIX-2935).

## What's already here, and the debt

**Builds on:** `localWorkspaceHost`. **Adds:** one helper that replaces copies. **Debt: net
down,** one config type, one sniff and four copies gone.

## Sign off

D1 in [DECISIONS.md](DECISIONS.md): the helper's name.
