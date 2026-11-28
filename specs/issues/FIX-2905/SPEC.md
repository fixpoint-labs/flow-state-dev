# FIX-2905 · Worktree preview: one app showing every in-flight branch merged

**Spec** · [Decisions](DECISIONS.md)

## Six people, before and after

| Someone who… | Today | After |
|---|---|---|
| **has several coding runs in flight and wants to see them together in the app they run** | Starts a server per worktree (about 3 GB and a port each), or has Claude merge by hand | One command. Their checkout sits on a local-only `preview/<user>` branch with every in-flight branch merged, each named with the tip it was read at. The app they already run shows it |
| **has two features that edit the same file** | Finds out when merging | The later one is left out and named, with its files and what merged before it. The rest still show |
| **has two features that each pass and boot, and break the app only together** | Finds out in the browser | The merged tree must boot and load. If not, the preview goes back, the culprit is left out and named, the rest still show |
| **has a branch with red checks, or one that changes the lockfile** | Merged blind | Left out and named. A lockfile change is "install owed": installing under a running server breaks it |
| **rebuilds, or has a pull request merge** | The by-hand list goes stale | One rebuild resets to the latest main, drops what merged, merges again and replays a hand conflict fix. It refuses if the preview holds a commit the build did not make |
| **has uncommitted edits, or runs `git push` in their checkout** | The preview is theirs to guard | Edits stay: a rebuild stops, never overwrites. A push of the preview by name or tip is refused by a hook. `--no-verify` is not stopped |

## The goal, and how we'll know it's met

**A person sees, in the app they already run, every in-flight feature that merges cleanly and keeps the app working; the ones that don't are named; and nothing of theirs is lost.**

| Is it the right goal? | |
|---|---|
| **The real need** | "Preview all live worktrees at once in one running app" (the owner's request). The owner's longer goal is any FSD app editing itself live; this preview, with its roll-back-on-failed-boot gate, is a step toward it |
| **Smaller, and rejected** | "A script that merges the branches": a pair that breaks together gets through |
| **Bigger, and not this issue's** | The super-app screen (a preview row, "stale, Rebuild", a `/preview` route): a separate follow-up, the next piece. A server per worktree ([FIX-2251](https://linear.app/fixpoint-labs/issue/FIX-2251), Backlog), which shares gate 2's free port |
| **Not done if** | The boot gate is tested only on a pair git refuses to merge · the control passes · a result for an older tip is accepted · a lockfile branch is merged unasked · a rebuild takes the person's edit · a hand resolution is lost |

```mermaid
flowchart LR
  I["scratch repo · eight branches: a conflict, a lockfile, red checks, a fresh one, a pair green alone"] --> B["the real build, a move, a rebuild"]
  B --> T["the preview's ancestry and tree · its own boot · every push · the person's edits"]
  T -->|"good tips in, four left out and named, pair never both, tree boots, edits kept"| P["PASS · goal met"]
  C["control · a build with no boot gate"] -.-> B
  T -.->|"under the control"| F["must FAIL · the pair is in and the tree does not boot"]
```

The check reads the preview's ancestry and files and boots the tree with its own code. It never asks the build whether it succeeded.

| How we verify | |
|---|---|
| **Goal check** | `goals/workspace/preview-in-flight/` · model-free · run by the implementer at completion · verdict in the implementation PR |
| **Signal** | Each good tip is an ancestor of HEAD and its file is on disk. The conflicting, red, lockfile and boot-breaking branches are not, each named with its reason. A branch with no commits is contained. The pair: each alone is green and boots, together they merge cleanly and fail to boot, and the preview holds one. A recorded result is read for its tip; a moved branch is rechecked. Edits survive; a hand fix replays; a hand commit blocks a rebuild. If nothing boots, HEAD stays |
| **Input** | A scratch repository, a bare remote, eight worktrees; another count and order must pass too |
| **Anti-game** | Don't read the build's report or a commit message, or take one branch's boot as the pair's |
| **Control that must fail** | `GOAL_CONTROL=no-boot` must FAIL: the pair is in and the tree does not boot. |

## What changes

![Left: the worktrees, unchanged, one merged and five in flight. Right: the person's primary checkout on a local-only preview branch, cut from the latest main, with two branches merged, three left out and named, a boot gate on the merged tree, and a note that the push guard is a hook](figures/changes.svg)

Read the right column top to bottom: a base, two merges, three branches left out for three reasons, and a boot gate before the preview is kept.

```diff
  fsdev worktrees .fsdev/teammates-runs
+ fsdev worktrees .fsdev/teammates-runs --preview
+ #  preview   preview/jake on 1a2b3c4, base main
+ #  merged    feat-export 3fa9c2e, fix-login 8be0d1a
+ #  left out  chore-docs: conflicts after feat-export in shared.txt
+ #  left out  feat-billing: changes the lockfile, install owed
+ #  left out  feat-report: boots alone, breaks the app once it joins fix-login
+ #  not shown 1 worktree has uncommitted changes
```

- **One implementation, in `@flow-state-dev/workspace`**, as `fsdev worktrees --preview` (build, status, rebuild). `pnpm wt:preview` and the preview-mode skill call it, so Claude is called only on a conflict or failure. The skill's by-hand steps stay as the fallback. No second copy.
- **Gate 1, per branch: checks green at its tip.** A Teammates run's result is on its record; the tool reads it if made at this tip, else runs the checks and keeps the result by tip.
- **Gate 2, on the merged tree:** each app declares a start command and a loaded check. It boots on a free port, passes, and is stopped. A failure puts the preview back and names the culprit.
- **A lockfile change is skipped:** "install owed", unless the person opts a branch in. The tool never installs ([D4](DECISIONS.md#d4)).
- **One writer** of `preview/<user>`, under a lock ([D5](DECISIONS.md#d5)).
- **Teammates pins its base.** It names none, so a run is cut from the checked-out branch, now the preview ([Facts](DECISIONS.md#facts-read-from-the-code)). One line in `labs/teammates/host.mts`.

```mermaid
flowchart LR
  A["callers · fsdev, pnpm, the skill, an app"] --> T["one tool · one lock"]
  T --> E["in flight · host.list and preview.branch, minus merged"]
  E --> G1["gate 1 · checks at the tip"]
  G1 --> M["merge · land's merge step"]
  M --> G2["gate 2 · boot the merged tree"]
  G2 --> P["preview/user in the primary"]
```

**Docs:** `orchestration.md` and the preview-mode skill change in the same PR; user docs come at release.

## What stays as it is

- Every run's worktree, branch and row. Uncommitted or mid-rebase worktrees are counted *not fully shown*.
- The super app, which knows nothing of previews (next section).
- `wt:prune`, the push guard (`check-preview-push.mjs`, `.husky/pre-push`) and the `preview.branch` list, as shipped.

## App stopped, app running

The tool never asks an app to reload: it knows no apps, and the package imports nothing from one. That fits [D4](DECISIONS.md#d4)'s no rebuild on its own. A reload prompt is the super app's, in the follow-up.

| The app is | What happens |
|---|---|
| **Stopped** | Nothing to do. The preview is a branch in the primary; the next `pnpm dev` starts from the merged files, installing with `--frozen-lockfile` first (`workspace.mjs`). The boot gate uses a throwaway copy on a free port, up or not |
| **Running, its pages** | `rebuild.mjs` rebuilds a page when a recorded input file changes. Nothing pushes a reload to the labs' pages (none found), so the person refreshes. Kitchen Sink's `next dev` hot-reloads itself, its socket piped by the proxy |
| **Running, its server** | `lifecycle.mjs` marks it changed and offers a restart, only for a server that records its inputs. A merge touching server code waits for that click |
| **A rollback** | The files change twice, so pages may rebuild twice ([D4](DECISIONS.md#d4)) |

## What's already here, and the debt

| Already here | What this does with it |
|---|---|
| `preview-mode` skill, `scripts/worktree.mjs`, the guard, the list | **Extends.** The skill is this tool done by hand, and becomes its fallback. The model, list and guard are reused as shipped |
| `workspace` · `host.list`, `host.baseTip`, `land`'s merge step, `runCheckoutCommands`, `acquireLock` | **Builds on.** No new merge, check or lock code |
| [FIX-2904](https://linear.app/fixpoint-labs/issue/FIX-2904)'s proof of *merged* (spec merged to main) | **Builds on, and depends on it.** `scripts/worktree.mjs` holds an ancestry-only proof for prune: the tool calls the package's and adds no third |
| Pull request #5583 | **Merged 2026-11-24**: build on its lanes. Merges use the host git lane, checks and boot the base lane, the base fetch and FIX-2904's read the remote lane |
| [FIX-2251](https://linear.app/fixpoint-labs/issue/FIX-2251), [FIX-2252](https://linear.app/fixpoint-labs/issue/FIX-2252), [FIX-1768](https://linear.app/fixpoint-labs/issue/FIX-1768) | **Related, keep their jobs** |

| Adds | Existing piece considered | Why it doesn't fit / how composed |
|---|---|---|
| `--preview` and one build function | The skill; `scripts/worktree.mjs` | The skill is this procedure by hand. Composed from the pieces above |
| A start command and loaded check per app | `apps/super-app/apps.mjs` declares each app's start steps on fixed ports | No loaded check, no free port. Added there and handed to the tool: the package imports nothing from an app |

| The debt | |
|---|---|
| **Removes** | Merging by hand as the normal path |
| **Adds** | The primary is occupied, and a merge-landing is unavailable meanwhile ([D3](DECISIONS.md#d3)). A guard that is a hook. A boot on every build, and a false rollback hides a good branch ([D4](DECISIONS.md#d4)). One boot declaration per app |
| **Leaves** | The super-app screen, FIX-2251's process life, two proofs of *merged* |

**Net: up, small.**

## Sign off

**[The goal](#the-goal-and-how-well-know-its-met), at that size.** If wrong: the preview hides a feature that breaks only in combination, or waits on a screen it never meant to deliver.

**[The debt](#whats-already-here-and-the-debt), net up, small.** If wrong: a boot declaration nobody keeps true.

Open, for you:

1. **[D5](DECISIONS.md#d5) · One tool writes the preview branch and every caller asks it; recommended over the app only proposing.** If wrong: a person waits on a session for a rebuild a button could have run.
2. **[D1](DECISIONS.md#d1) · One preview with every in-flight branch merged, instead of a server per worktree.** If wrong: the person wanted each feature alone.
3. **[D2](DECISIONS.md#d2) · A branch that conflicts is left out and named, and the rest show.** If wrong: the preview quietly lacks a feature.

Answered by the owner, recorded as theirs: **[D3](DECISIONS.md#d3)**, the primary checkout; **[D4](DECISIONS.md#d4)**, checks at the tip plus a boot of the combination; and one function in `workspace`. D4 now also says who installs; it needs your nod.

**Seen while verifying:** with the primary on the preview, a Teammates run is cut from it and a merge-landing lands on it. Pinning the base fixes the first; the second means landing by pull request only while it is.

Feature · `workspace` + `fsdev` + `labs/teammates` · small · epic FIX-2440 · blocked by FIX-2904 · related FIX-2251, FIX-2252, FIX-1768
