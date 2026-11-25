# FIX-2935 · Bash tools build on the workspace package

**Spec** · [Decisions](DECISIONS.md) · epic [FIX-2927](../../epics/FIX-2927/SPEC.md)

Starts after [#5696](https://github.com/fixpoint-labs/flow-state-dev/pull/5696) (FIX-2818,
bash blocks default to just-bash) merges, and after FIX-2928.

## Before and after

| A team that… | Today | After |
|---|---|---|
| **gives an agent bash over a scope** | Gets `.fsdev/workspaces/{scope}/{id}` from the bash module's own segment encoder (`sanitize`, `safeSegment`, `segment`) and `WorkspaceScope` type | Gets the folder from `scopeFolder(root, scope, principal)` in `@flow-state-dev/workspace`. harness-manager's checkout paths come from the same package, through its own encoder (two encoders, both in workspace) |
| **runs a harness on projected collections** | Gets hydrate → run → flush wired once in `tools/src/bash/projection-setup.ts` and again in `claude-code/src/sdk/workspace.ts` | Gets it from one projection session helper in workspace, with three callers |

## The goal, and how we'll know it's met

**Where a scope's folder lives and how a projection is opened and flushed are each written once,
in the workspace package.**

| How we verify | |
|---|---|
| **Signal** | In non-test source, with comment lines dropped, `rg '\.fsdev.*workspaces' packages/*/src` matches only in `packages/workspace`. Workspace holds the only two path encoders: the scope-folder encoder in bash's format (`enc-<readable>-<12 hex>`, D1; `sanitize` and `safeSegment` gone from tools) and the checkout encoder (`encodeSegment` and `tenantSegment`, moved from harness-manager, which imports them). `checkoutPathFor` keeps today's components (tenant, org, user, epic, issue and phase) and does not call `scopeFolder`. harness-manager's isolation tests in `workspace.spec.ts` (two users, two orgs, two tenants, the four lone-surrogate ids) pass **unedited**. Not path encoders, so they stay: `hashKeySegment` (a ledger key) and the engine filesystem store's own `encodeSegment`. `FileEntryState` is gone. The projection session helper has three callers. The bash containment tests pass unchanged, pointed at the shared rule. `pnpm typecheck` and the tools, claude-code, harness-manager and workspace tests pass |
| **Control that must fail** | Today's tree: the `rg` finds bash's path construction, and `sanitize`, `safeSegment`, `encodeSegment` and `tenantSegment` are defined outside workspace |

## What changes

- **Workspace.** A folder-for-a-scope function: a scope plus a principal (from
  `scopeComponents`) become one path under a root, through bash's segment encoder, moved
  (`sanitize`, `safeSegment`), so existing bash folders stay where they are (D1). The bash
  defaults call it.
- **Workspace.** The checkout encoder, moved from harness-manager: `encodeSegment` (SHA-256 over
  UTF-16LE, full digest) and `tenantSegment`. `checkoutPathFor` keeps calling them with today's
  component list, so checkout paths, branch names and the lock beside them do not change.
  `safeSegment` is not used for checkouts: it maps lone surrogates and U+FFFD to one digest,
  which would put two principals in one tree (D3).
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
`.fsdev/workspaces/session/<id>` resolves to the same path after the change (D1), and a checkout
path is the same as today's (D3).

## What's already here, and the debt

**Builds on:** `scopeComponents`, `principalFromContext`, `createProjection`, `createHostPlace`,
`projection-setup.ts`. **Adds:** two functions, each replacing copies. **Debt: net down,** two
encoders move into one package, two projection wirings and one copied type gone. **Kept, and
filed:** bash's `safeSegment` gives lone-surrogate and U+FFFD ids one folder today. D1 keeps that
format, so the fix is its own issue with a folder migration.

## Sign off

D1 in [DECISIONS.md](DECISIONS.md).
