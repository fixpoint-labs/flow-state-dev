# FIX-1786 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

Sequencing, not building: what order the work runs in, what each issue entails, and what each
hands the next. How to build any piece is that issue's own plan. IDs cross-reference
[DECISIONS.md](DECISIONS.md) (D-n) and [BUSINESS-RULES.md](BUSINESS-RULES.md) (ER-n).

## The path

![The path as of 6 October 2026, in phases rather than dates. Now: this spec in review and the FIX-1787 inventory posted, its merge-first rows landing. After the gate every child's spec can be written. Builds run in waves: the worker contract and per-org user data together; then workers as resources; then the coordinator flow beside the library; then projects and workstreams beside the assignment chain; then the MAILBOX.md conversion; then the terminology sweep; then the closure run. The closure's QA plan is written beside the specs, and it runs leg c early when workers as resources merges. The critical path runs the inventory, the contract, workers, the coordinator, projects, the conversion, the terms and the closure run](figures/path.svg)

A long chain with three narrow windows. Nothing builds until the inventory's merge-first rows
land; the contract and per-org keys then run together, and workers as resources is the one
step everything else waits on. Projects, the chain and the library are the widest window. The
privacy fix is checked when workers merges, not only at the end (ER-30). The graph itself is in [the spec](SPEC.md#how-the-issues-flow-into-each-other); this adds time.

## What each issue entails

| Issue | Route | Consumes | Delivers | Releases | Size |
|---|---|---|---|---|---|
| **FIX-1787** inventory | inventory, no spec | Every open PR and active issue in the areas | 38 calls: 13 merge first, 13 close, 12 untouched | Every refactor child | Done as a table; its merges are the work |
| **FIX-1789** contract | spec → impl PR | `workerConfigSchema()`, the door · Q1 | Registered worker flows, the private-state rule, standard-only, attribution (ER-2, ER-11) | FIX-1788 | Small |
| **FIX-1790** per-org data | spec → impl PR | The engine's user key | User data per (user, org); old records moved to the one org they belong to by an operator step, or refused, never read in two (ER-3) | FIX-1788 | Medium: a persisted key every flow uses, and its migration |
| **FIX-1788** workers | spec → impl PRs | ER-2 · ER-3 · projected collections | Worker resources on singleton flows, standard projection, fork, deprecations; the session link in server-owned session state (D3's third change); a worker's own key for its private state, with today's per-seat cells moved (ER-1) | FIX-1791 · FIX-1795 | Large |
| **FIX-1791** coordinator | spec → impl PRs | ER-1 · FIX-1779's join and leave · FIX-1774's legs | The coordinator flow, delegates, four policies, the records (ER-4, ER-5); the chief of staff as a standard coordinator | FIX-1793 · FIX-1794 · FIX-1792 | Medium to large |
| **FIX-1795** library | spec → impl PR | ER-1's write path | Templates and copies, model variants (ER-10) | FIX-1796 | Medium |
| **FIX-1793** projects | spec → impl PRs | ER-4 · ER-3 · FIX-1762's locks · Q2 | Private or shared projects, workstream resources, the row rule, the project coordinator; rooms and Shift Manager's Stream tab removed (ER-7, ER-8) | FIX-1792 | Large: about 2,200 lines out, one engine rule in |
| **FIX-1794** chain | spec → impl PR | ER-4's delegates · FIX-1778 · FIX-1780's hand-off rule · FIX-1777's rule | Tasks down the owner's boards, drained as the owner; a board whose rows cross a flow at the owner's user scope (ER-9) | FIX-1796 | Medium |
| **FIX-1792** `WORKER.md` | spec → impl PR | ER-4 · ER-7 · D5 | 33 files converted, 15 boards resolved, old files refused (ER-6) | FIX-1796 | Medium |
| **FIX-1796** terms | spec → impl PRs | Every child merged | The sweep and the glossary (ER-12) | The closure run | Medium, wide and mechanical |
| **FIX-1797** closure · required | spec (the QA plan) → runs until clean → PR | Every other child, on one `main` commit | The committed checks, an early leg-c run when FIX-1788 merges (ER-30), a QA report, a bug child per failure | The wrap | Medium, repeats per retest |

## Where it is

[The set table](SPEC.md#the-set--as-of-2026-10-06) is the review-time snapshot; follow its
links for live state. The inventory's table is
[on FIX-1786](https://linear.app/fixpoint-labs/issue/FIX-1786#comment-9e837aa5). Shift Manager
moves to `packages/shift-manager` with #2759, and every reference here means that location.

## What unblocks what, from here

1. **This spec merges** → every child's spec can start. Builds still wait on step 2.
2. **The inventory's merge-first rows land or close**, #2759 first, then the PRs that rebase on
   it → FIX-1789 and FIX-1790 builds start.
3. **Both merge** → FIX-1788 builds. It merges → FIX-1791 and FIX-1795 build, and FIX-1797 runs
   leg c early on that commit (ER-30). A failure is a bug child that blocks both from merging.
4. **FIX-1791 merges** → FIX-1793 and FIX-1794. FIX-1793 merges → FIX-1792.
5. **FIX-1792, FIX-1794 and FIX-1795 merge** → FIX-1796. It merges → the closure's first run.
6. **A run finds bugs** → each is a child that blocks FIX-1797, and the whole plan reruns on a
   fresh `main` commit once they merge (ER-27).
7. **If Jake answers Q2 "no"** → FIX-1793 drops private projects and leg b drops its
   private-project step; nothing re-sequences.

## Coordination seams to watch

| Seam | Between | Rule |
|---|---|---|
| The `agent` flow (`agent-worker-flow.ts`) | FIX-1788, FIX-1791, FIX-1794 | FIX-1788 lands the singleton shape first; the others build on it |
| The hire and roster write path | FIX-1788, FIX-1795 | FIX-1788 owns the write; the library calls it |
| The user scope key | FIX-1790, FIX-1788, FIX-1793 | FIX-1790 merges first; nothing user-scoped ships before it |
| Server-owned session state | FIX-1788, FIX-1791 | FIX-1788 lands it with the link; the coordinator keeps its delegates there |
| The mailbox flow and its files | FIX-1791, FIX-1792 | FIX-1791 ships the coordinator beside the mailbox flow; FIX-1792 converts every file and removes the mailbox flow in one change |
| `packages/shift-manager` | FIX-1788, FIX-1793, FIX-1796 | The second lander adapts; the TEAMS view reads worker resources, the Project view the coordinator session |
| `apps/docs/docs/workforce/` | Every child | Each child its own page ([DOCS.md](DOCS.md#ownership)); FIX-1796 the overview and glossary |

## Not children, deliberately

FIX-1763 and its children, whose fences Q2 settles · FIX-1650 and its children, which land
first and get an evolution note · FIX-1775, long-lived memory · FIX-1778, consumed · FIX-1762's
stack, consumed · FIX-1765 and FIX-1764, specced after FIX-1791 · FIX-1745, obsolete when rooms
go · FIX-1766, FIX-1767 and FIX-1768, carried into FIX-1793's spec · FIX-1798, which removes flow
instances and owner pins from the engine; FIX-1788 blocks it, and each deprecation marker names it.

## Wrap

When ER-28 holds: run the lessons pass, dispatch docs polish over `apps/docs/docs/workforce/`
(the inventory closed #2715 for that reason), refresh the project spec (#2420), and report the
outcome from Linear and implementation evidence. Amendments go through a follow-up PR.
