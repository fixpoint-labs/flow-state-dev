# FIX-2448 · Split core's root: move the harness/PR vertical to `core/harness` and framework seams to `core/internal`

**Spec** · [Decisions](DECISIONS.md)

## Six people, before and after

| Someone who… | Today | After |
|---|---|---|
| **autocompletes `@flow-state-dev/core` to write a flow** | 563 names. 55 are coding-harness and pull-request vocabulary, 54 are runtime seams: `RequestHost`'s eight verbs, wait gates, engine handshakes | The names an app author uses or the docs teach. No harness name, no seam |
| **builds a flow around a coding agent** | Harness names are split across the root and `core/types`, half of each | One documented subpath, `core/harness`, for the harness contract, the plan record and the pull-request record |
| **hovers `ctx` in a handler** | `BlockContext` lists `requestHost` and five symbol-keyed slots marked "not part of the public API" | Neither. A framework package reads them off an internal context type |
| **adds an export to any published root** | Nothing stops it. Core went from 480 to 549 names in two weeks | CI refuses a new root name that no app, example or docs page uses or names. A name only our packages use goes to `/internal` |
| **imports an `/internal` path from an app** | Works. Kitchen Sink does it twice | CI refuses the import and names it |
| **maintains engine, orchestration, workforce or a harness package** | Reaches the runtime through core's root and `core/types` | The same seams, imported from `core/internal` |

## The goal, and how we'll know it's met

**An adopter who autocompletes core's root sees only names an app author uses or the docs teach,
and no published package root can gain a name that no app uses and no docs page names.**

| Is it the right goal? | |
|---|---|
| **The real need** | The epic's *Surface* row, for the root every adopter imports ([FIX-2447](../../epics/FIX-2447/SPEC.md#the-goal-and-how-well-know-its-met)), and the issue's "orchestration vocabulary they never opted into" |
| **Smaller, and rejected** | "The issue's list moves." It clears the 113 names the review named, leaves the 107 more the check finds, and nothing stops the next window adding 70 again |
| **Bigger, and not this issue's** | Every published root clean, which is the epic's whole *Surface* row. This issue builds the check over every root and empties core's. Engine, orchestration, patterns, testing, react and the harness packages are their own children's. Eleven roots, 457 failing names today, have no owner in the set (returned to the epic) |
| **Not done if** | The export check is not the first PR to merge, or not a required check, while core's root is emptied · core's root still fails the check on a name outside the six benchmark types · a moved name still resolves from the root or `core/types`, other than as ER-3 / Q1's answer allows · a name only our packages import counts as used · any root gains a failing name and CI stays green · an app or a docs page imports an `/internal` path, by `import`, `import type`, `import()` or `require` · a flagged name stays on the root through a README line nobody reviewed · `core/harness` or `core/internal` is missing from the installed tarball · `BlockContext` still shows `requestHost` or a symbol slot |

```mermaid
flowchart LR
  S["every published root · read from source"] --> K["the export check · adopter imports · README · docs site"]
  K --> R["core's root · its failing names"]
  M["the spec's moved list · 113 names"] --> R
  R -->|"failing only on a sibling's names · moved names gone · no app imports internal"| P["PASS · the goal is met"]
  T["installed tarball · each moved name read from its new subpath's declarations"] --> P
  C["control · main today"] -.-> K
  R -.->|"under the control"| F["FAIL · names listed"]
```

The check reads who imports each name, never the diff's own lists. The control is today's tree,
which must fail on both the check and the moved list.

| How we verify | |
|---|---|
| **Goal check** | `goals/core/root-is-for-app-authors/check.mjs`, promoted from [`poc/export-census/`](poc/export-census/census.mjs) as FIX-2162 promoted its census · model `n/a` · run by the implementer at completion · verdict in the implementation PR. It flips the closure manifest's *Surface* assertions for core's root and the `/internal` refusal to `expect: pass`; the row itself flips when every root's assertion passes |
| **Signal** | `check.mjs --after`, against the frozen list [`poc/export-census/moved.tsv`](poc/export-census/moved.tsv): core's root fails the export check on no name but the six `benchmark` rows, which FIX-2460 owns · on the **installed** core tarball, read through the TypeScript compiler from its `.d.ts` (most moved names are types, which a runtime import can't see), none of the 113 moved names is on the root or `core/types`, each `harness` row is on `core/harness` and each `internal` row on `core/internal`, and `BlockContext` has neither `requestHost` nor a symbol-keyed member · no file under `apps/` (not `apps/devtool`), `examples/` or `labs/` imports an `/internal` path in any form · `--after` prints every flagged name that stays on the root through a README line added since d6a38c09, for the PR's reviewer. The export check gates every PR, comparing against the merge base with `main`, and runs over every published root and only roots: `core/harness` and `core/internal` are subpaths |
| **Input** | Today's tree. A different valid input: a new root name with one Kitchen Sink import passes; the same name imported only by engine fails |
| **Anti-game** | The allow-list is the README, the docs site and adopter code, never a list the same diff writes. The check compares the head against the merge base, as `check-new-dead-code.mjs` compares against its base, so there is no baseline file to edit. The moved list and the six benchmark names are frozen here, not in the implementation. A README line or Kitchen Sink import added only to clear a name is the hollow pass: `--after` lists those for review, and a README dump is one of the plants |
| **Control that must fail** | Today's `main` must FAIL `--after` on *core fails on no unowned name*: 134 names under the census's reach, the 107 flagged plus 27 moved names that already fail, beside 4 benchmark ones; and on *moved names gone*: 113. `--control` plants a consumer-less core root name, a sibling-only engine root name, an app `import type` and an app `import()` of `/internal`, a README line listing bare names, and a moved name re-added to the root; each must be named. On the first PR, one CI run with a planted engine root name shows the gate red |

## What changes

![Core's root before and after. Before: one box of 563 names. After: the root, the 337 names the check passes today plus whichever of the 107 flagged names earn a README line, then core/harness, a documented public subpath with the 55 harness and pull-request names, then a fence, and behind it core/internal, published for our own packages only, with the 54 seams and the folded items/internal. Four names are deleted](figures/what-changes.svg)

Position is audience: above the fence is what an adopter may import, and the fence is
[epic D2](../../epics/FIX-2447/DECISIONS.md#d2).

**What a harness package writes:**

```diff
- import { recordPullRequests, harnessEnv, formatRunDuration } from "@flow-state-dev/core";
- import type { HarnessBlock, HarnessRunInput } from "@flow-state-dev/core/types";
+ import { recordPullRequests, harnessEnv, formatRunDuration } from "@flow-state-dev/core/harness";
+ import type { HarnessBlock, HarnessRunInput } from "@flow-state-dev/core/harness";
```

**What a framework package writes:**

```diff
- import { requireRequestHost, parkOnWait } from "@flow-state-dev/core";
- import { onRequestEnded, REQUEST_END_SEAM } from "@flow-state-dev/core/types";
- import type { RuntimeItem } from "@flow-state-dev/core/items/internal";
+ import { requireRequestHost, parkOnWait, onRequestEnded, REQUEST_END_SEAM } from "@flow-state-dev/core/internal";
+ import type { RuntimeItem } from "@flow-state-dev/core/internal";
```

How an adopter on 0.4.0 meets each old path follows ER-3 / Q1's answer.

**Docs:** create *What each package root is for* (`apps/docs/docs/api/package-roots.md`, first
in *API Reference*): each published root's job, its public subpaths, and why `/internal` is not
for apps, with core's row filled; FIX-2449, FIX-2459 and FIX-2460 add theirs. Update
`packages/core/README.md`: the harness section becomes a `core/harness` section, and the
`ctx.requestHost` section moves to `docs/architecture/internal-execution-seams.md`. Update
`apps/docs/docs/tools/coding-agents.md`'s import lines.

## How the check sees a name

```mermaid
flowchart LR
  E["exports map · packageExports"] --> N["each root name"]
  I["imports in apps · examples · labs"] --> U["used"]
  D["package README · docs site"] --> U
  N --> U
  U -->|"a covered name's signature names it"| U
  N -->|"used by our packages only, or nobody"| X["failing"]
  B["the same, on the base ref"] --> Z["new failing names fail the PR"]
  X --> Z
```

A type an adopter meets only through a covered function's signature counts as used. A sibling
package's import never does ([D1](DECISIONS.md#d1)).

## What stays as it is

- The 337 root names the check passes; core's other public subpaths, minus the moved names.
- Blocks, resources and Workforce's copied app flows, which ER-1 doesn't count.

## What's already here, and the debt

| Already here | What this does with it |
|---|---|
| What already gates a public surface: `packageExports` (`scripts/mechanism-exports.mjs`), the mechanism anchor check and PR classifier, Fallow's `check-new-dead-code.mjs`, `validate-package-boundaries.mjs`. Searched `exports`, `surface`, `baseline`, `internal` in `scripts/` and `eslint.config.mjs` | **Extends** `packageExports` and copies Fallow's base-versus-head ratchet. None asks who outside the framework uses a name; this is the first |
| FIX-2162's caller census ([`poc/caller-census`](../FIX-2162/DECISIONS.md#settled)) | **Builds on** its pattern: totality, plants, promoted into `goals/` |
| `client/./internal`; core's `./items/internal`, a re-export of contracts' | **Reuses** the first's kind; **folds** the second into `core/internal`, core's one hidden entry (ER-2) |
| `core/types`, which carries 57 harness names and 66 seam names, 57 of them not on the root | **Amended**: they leave for the two subpaths ([D2](DECISIONS.md#d2)) |
| The issue's "unexport `utility.historySummary`" | **Dropped**: Teammates and a docs page now use it |
| [FIX-2447 D2 and ER-1 to ER-3](../../epics/FIX-2447/DECISIONS.md#who-owns-what) | **Kept**. D1 here reads ER-1's "outside consumer" |

| Adds | Existing piece considered | Why that doesn't fit, or how it is composed |
|---|---|---|
| The export check, every published root, gating PRs | `packageExports`; Fallow's ratchet; FIX-2162's census | Composed from all three: one walker for names, one import census, Fallow's compare against the base. Not Fallow: its graph is workspace dead code, and a seam engine imports is not dead |
| `core/harness`, a documented public subpath | Core's exports map; `core/types` | Extends the map. `core/types` can't hold it: it is the general type barrel |
| `core/internal` | `client/./internal`; `core/items/internal` | The same kind; replaces `items/internal` rather than sitting beside it |
| One docs page | `api/core.md`; `ecosystem/overview.md` | Neither lists roots; a table per root, which the siblings extend |

| The debt | |
|---|---|
| **Removes** | 113 names from core's root (55 moved to `core/harness`, 54 to `core/internal`, 4 deleted), the same files' names from `core/types`, `requestHost` and five symbol slots from the public `BlockContext`, the `core/items/internal` entry, and the README's runtime-seam section. The check rules on 107 more |
| **Adds** | Two subpaths and one check, each permanent by design. Under Q1's alias option, a deprecated alias per moved name until the removal minor Q1 names |
| **Leaves** | Eleven roots ratcheted but with no owner in the set to clear their 457 failing names · `core/types`, a 442-name barrel the check doesn't read · 14 `_`-prefixed internal members on `BlockContext` · the task-dispatch vocabulary on core's root, which the README documents, for FIX-2459 or FIX-2463 to weigh |

**Net: down.** Core's root loses 113 names now and more as the check rules; two entries and
one check are added.

## Sign off

**[The goal](#the-goal-and-how-well-know-its-met):** core's root clean by the check and every
root ratcheted. If wrong: we move the names the review saw, and the root grows back.

**[The debt](#whats-already-here-and-the-debt), net down:** 113 names leave the root, two
subpaths and a check arrive. If wrong: two more entries to keep, for names nobody used.

1. [D1](DECISIONS.md#d1) · A name counts as used only by adopter code or the docs; our own
   packages' imports don't. If wrong: seams pass the check, or public types need a README line
   each.
2. [D2](DECISIONS.md#d2) · A moved name leaves every public core entry, `core/types` included.
   If wrong: one more breaking path for adopters, for a barrel they might not autocomplete.

**Open: none of mine.** D1 is the one to weigh. How the moves reach adopters is the epic's
[Q1](../../epics/FIX-2447/DECISIONS.md#q1).

Improvement · `core` (moves), `scripts/` (the check), importers in engine, orchestration, workforce, claude-code, codex, cursor, harness-manager, Kitchen Sink · large · epic [FIX-2447](../../epics/FIX-2447/SPEC.md)
