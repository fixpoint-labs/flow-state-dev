# FIX-2928 · A harness is a core value; vendor packages stop depending on the manager

**Spec** · [Decisions](DECISIONS.md) · epic [FIX-2927](../../epics/FIX-2927/SPEC.md)

## Before and after

| A team that… | Today | After |
|---|---|---|
| **writes a harness package** | Imports `Harness` from harness-manager, which brings workforce, orchestration and client with it | Imports `Harness` and `HarnessFeeds` from `@flow-state-dev/core/harness`, beside `HarnessBlock` |
| **builds a harness block** | Takes `HarnessFeeds` from a task run or `HarnessSessionFeeds` from a session turn: two shapes, different fields | Takes one `HarnessFeeds`, whichever runner calls it |
| **adds Claude Code to an app** | Lists the `claudeCode()` kit | Fills the harness kit's `harnesses` slot with `claudeCodeHarness()`, as with Codex and Cursor |

## The goal, and how we'll know it's met

**A harness package depends on core (and workspace for folders), never on harness-manager, and
both runners build the same feed type.**

| How we verify | |
|---|---|
| **Signal** | `rg '@flow-state-dev/harness-manager' packages/{claude-code,codex,cursor}` finds nothing, `package.json` included. `rg 'HarnessSessionFeeds'` finds nothing. `pnpm typecheck` and every package's tests pass. Through `fsdev run`: `goals/harness-manager/where-the-work-went` (task runner) and `goals/harness-manager/session-worktree-lifecycle` (session runner) pass, and `goals/attachments/reach-each-harness` reaches all three vendors |
| **Control that must fail** | Today's tree: both `rg`s find matches |

## What changes

- **Core.** `Harness`, `harnessSchema` and `HarnessFeeds` move to `@flow-state-dev/core/harness`
  (`core/src/types/harness.ts` or a sibling module the subpath exports). `harnessSchema` needs
  zod, which core already depends on.
- **One feed type.** `HarnessFeeds` is the union of today's two. Required: `cwd`, `resume`,
  `onSession`, `onUsage`, `worktree`. Optional, each documented with which runner fills it:
  `model`, `onSteerable`, `onActivity`, `onEvent`, `onToolApproval`. The task runner starts
  filling `worktree` (the checkout path it already resolves), because containment (FIX-2440)
  needs the fence on both paths.
- **harness-manager.** `harness.ts` and the feed declarations are deleted; `HarnessSlot`,
  `harnessSessionFlow`'s `agent`, the coder flow and the session door import the core types.
  No re-export (ER-6).
- **Vendor packages.** `codex/src/harness.ts` and `cursor/src/harness.ts` import from core and
  drop the dependency. Claude Code becomes a plain value (D1).
- **Callers.** Kitchen Sink's three mode files, `harness-session-flow.ts`, shift-manager's
  devteam host and harness, workforce's error reporter, the goals and the tests import the core
  types. Apps that listed `claudeCode()` fill `claudeCodeHarness()` instead.
- Changesets for core (minor), harness-manager (minor), claude-code (minor), codex and cursor
  (patch: dependency only).

## What stays as it is

`HarnessBlock`, `HarnessResolver` and the hook types already in core. What each feed does.
The harness kit and its `harnesses` slot. No read-only access field (FIX-2929, held).

## What's already here, and the debt

**Builds on:** `@flow-state-dev/core/harness`, which already declares every hook the feeds
carry. **Adds:** nothing new; one type moves and two merge. **Debt: net down,** one feed type,
three package dependencies and one kit gone.

## Sign off

D1 and D2 in [DECISIONS.md](DECISIONS.md).
