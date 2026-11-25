# FIX-2935 · Bash tools build on the workspace package

**Spec** · [Decisions](DECISIONS.md) · epic [FIX-2927](../../epics/FIX-2927/SPEC.md)

Starts after [#5696](https://github.com/fixpoint-labs/flow-state-dev/pull/5696) (FIX-2818,
bash blocks default to just-bash) merges, and after FIX-2928.

## Before and after

| A team that… | Today | After |
|---|---|---|
| **gives an agent bash over a scope** | Gets `.fsdev/workspaces/{scope}/{id}` from the bash module's own segment encoder (`sanitize`, `safeSegment`, `segment`) and `WorkspaceScope` type | Gets the folder from `scopeFolder(root, scope, principal)` in `@flow-state-dev/workspace`, the same rule harness-manager's checkout paths use |
| **runs a harness on projected collections** | Gets hydrate → run → flush wired once in `tools/src/bash/projection-setup.ts` and again in `claude-code/src/sdk/workspace.ts` | Gets it from one projection session helper in workspace, with three callers |

## The goal, and how we'll know it's met

**Where a scope's folder lives and how a projection is opened and flushed are each written once,
in the workspace package.**

| How we verify | |
|---|---|
| **Signal** | In non-test source, with comment lines dropped, `rg '\.fsdev.*workspaces' packages/*/src` matches only in `packages/workspace`. The folder segment encoder is defined only there, in bash's format (`enc-<readable>-<12 hex>`, D1): bash's `sanitize` and `safeSegment` are gone from tools, and `checkoutPathFor` builds no path from harness-manager's `encodeSegment` or `tenantSegment`. Those two stay in the manager for its derived identities (lock keys, ledger partitions), which are not folders. Also not folder encoders, so they stay where they are: harness-manager's `hashKeySegment` (a ledger key for a vendor account id) and the engine filesystem store's own `encodeSegment` (store record paths). `FileEntryState` is gone. The projection session helper has three callers. The bash containment tests (ids outside the root, tenant collisions, case-insensitive collisions) pass unchanged, pointed at the shared rule. `pnpm typecheck` and the tools, claude-code, harness-manager and workspace tests pass |
| **Control that must fail** | Today's tree: the `rg` finds bash's path construction, `sanitize` and `safeSegment` are defined in tools, and `checkoutPathFor` builds its path from `encodeSegment` and `tenantSegment` |

## What changes

- **Workspace.** A folder-for-a-scope function: a scope plus a principal (from
  `scopeComponents`) become one path under a root, through one segment encoder (bash's `safeSegment` format, moved, so existing bash folders stay where they are) that keeps the
  guarantees both sides have today (no traversal, tenant separation, case-insensitive
  filesystems). harness-manager's `checkoutPathFor` and the bash defaults call it; bash's `sanitize` and
  `safeSegment` move into it. New checkouts get folder names in that format; a run in flight
  keeps the path on its row (D1). The manager's `encodeSegment`, `tenantSegment` and
  `hashKeySegment` stay for identities that are not folders.
- **Workspace.** A projection session helper lifted from `projection-setup.ts`: hydrate the
  mounts, hand back the place's root, flush with diagnostics. `createBashBlocks`,
  `createBashTool` and `createClaudeCodeWorkspaceCapability` call it.
- **tools.** `WorkspaceScope` is replaced by the workspace package's `ScopeName` where they
  mean the same thing; `FileEntryState` is replaced by `ProjectedEntryState`.
- Changesets for workspace (minor) and tools (patch or minor, by what changes on its surface).

## What stays as it is

The sandbox adapters and the live-sandbox registry with its idle release (FIX-2440,
FIX-2066). Bash folder cleanup ([FIX-1287](https://linear.app/fixpoint-labs/issue/FIX-1287)),
which gets easier after this but is its own issue. The folder paths themselves: an existing
`.fsdev/workspaces/session/<id>` resolves to the same path after the change (D1).

## What's already here, and the debt

**Builds on:** `scopeComponents`, `principalFromContext`, `createProjection`, `createHostPlace`,
`projection-setup.ts`. **Adds:** two functions, each replacing copies. **Debt: net down,** two
encoders, two projection wirings and one copied type gone.

## Sign off

D1 in [DECISIONS.md](DECISIONS.md).
