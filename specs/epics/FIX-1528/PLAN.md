# FIX-1528 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

This plan sets the order the work runs in and what each piece involves. How to build a piece
is that issue's own plan. IDs cross-reference [DECISIONS.md](DECISIONS.md) (D-n) and
[BUSINESS-RULES.md](BUSINESS-RULES.md) (ER-n).

## The path

![Lanes against time from 22 to 30 September 2026, with a now line on the 23rd. Two input lanes: FIX-1503 verified identity, in spec review; FIX-1486 listing identity, not started. Set lanes: the FIX-1522 explore bar runs to the now line, in review; FIX-1525/1526 and FIX-1529 are done bars on the 22nd and 23rd; FIX-1534 and FIX-1535 are in-flight bars at the now line; FIX-1538 has no bar yet. The critical path runs from the gate through FIX-1538 to wrap.](figures/path.svg)

The shipped half took two days. What is left is two bugs in flight beside each other and one
feature that cannot start until this gate. FIX-1538 is the critical path: its spec, its build,
then the assembled goal. The bugs only need to land before that goal runs. The dependency graph
is in [the spec](SPEC.md#how-the-issues-flow-into-each-other); this figure adds time.

## What each issue entails

| Issue | Route | Consumes | Delivers | Releases | Size |
|---|---|---|---|---|---|
| **FIX-1534** drain leg | direct → impl PR | The pin (ER-1) · the admission seam · the existing claimed-task drain | A real drain refused for another org and for another user's private seat, task not claimed. A fix if the drain skips admission | The drain leg for the proof | Small, unless the drain bypasses admission |
| **FIX-1535** debug listing | direct → impl PR | The private-row fence FIX-1529 built | The debug collection listing read through the scoped handle | The debug leg for the proof | Small |
| **FIX-1538** per-org private cell | spec → impl PR | Decision 1 on #2070 · the pin · [D2](DECISIONS.md#d2) · both legs above | A pinned seat's user-scoped data keyed per (org, user), the migration, the assembled goal, the durable-hire docs | The epic's wrap | Medium · the migration is most of it |

## Where it is

[The set table](SPEC.md#the-set--as-of-2026-09-23) is the dated snapshot. Follow its Linear
links for current state. #2070, the explore, is in spec review at `df13d36`. It is retained
evidence, and no child waits on it merging: FIX-1538 cites decision 1 from its review head, or
from `main` once merged.

Inputs from outside the set, checked 2026-09-23:
[FIX-1503](https://linear.app/fixpoint-labs/issue/FIX-1503) is in spec review
([#2034](https://github.com/fixpoint-labs/flow-state-dev/pull/2034)).
[FIX-1486](https://linear.app/fixpoint-labs/issue/FIX-1486) is Todo on the Framework project.

## What unblocks what, from here

1. **This spec is approved and merged** → FIX-1538 can be specced. The two bugs keep going.
2. **FIX-1538's spec is approved and merged** → it is built. It needs no other child to start.
3. **FIX-1534 and FIX-1535 merge** → their legs can join the assembled goal. FIX-1538 must not
   merge its goal with either leg skipped.
4. **The assembled goal passes** (ER-15) → wrap.
5. **FIX-1503 lands at any point** → nothing here re-sequences. The goal already runs under a
   configured resolver. FIX-1503 makes that the default everywhere.
6. **FIX-1486 lands** → user planes may be taught by a later epic, not this one (D4).

## Coordination seams to watch

| Seam | Between | Rule |
|---|---|---|
| The admission seam, `createExecutionContext` | FIX-1534 and FIX-1529's shipped fence | A drain routes through it. A second admission check for drains is the defect, not the fix |
| `packages/engine/src/routes/debug-routes.ts` vs the resource routes | FIX-1535 and FIX-1529's collection-pattern fence | One scoped read. No second listing door |
| `packages/engine/src/stores/scope-keys.ts` | FIX-1538 and [FIX-1396](https://linear.app/fixpoint-labs/issue/FIX-1396) | FIX-1538 changes the shared user bucket for pinned seats only. FIX-1396's per-tier isolation stays its own |
| `apps/docs/docs/workforce/durable-hire.md` | FIX-1538 and whichever bug documents a limit | FIX-1538 publishes the shared paragraph. Others link to it |
| The hire-plane goal set, `goals/hire-plane/` | FIX-1534, FIX-1535, FIX-1538 | Legs are added to the assembled goal. Nobody edits F2's shipped legs |

## Not children, deliberately

[FIX-1486](https://linear.app/fixpoint-labs/issue/FIX-1486) (listing identity; Framework) ·
[FIX-1396](https://linear.app/fixpoint-labs/issue/FIX-1396) (per-tier memory isolation) ·
[FIX-1503](https://linear.app/fixpoint-labs/issue/FIX-1503) (verified identity; its own epic) ·
[FIX-1536](https://linear.app/fixpoint-labs/issue/FIX-1536) (reload bricked by a default-org hire;
under FIX-1455) · [FIX-1442](https://linear.app/fixpoint-labs/issue/FIX-1442) (done). Related,
never re-parented (ER-11).

## Wrap

When ER-15 holds, run the lessons pass, dispatch docs polish over the durable-hire and
authentication pages, and report completion in Linear from the goal verdict and the merged PRs.
The explore findings without an issue (C2, C3, C9, C10) are listed in the completion report so
the user-plane epic inherits them.
