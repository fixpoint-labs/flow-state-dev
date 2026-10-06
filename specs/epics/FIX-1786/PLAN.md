# FIX-1786 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

Sequencing, not building: what order the work runs in, what each issue entails, and what each
hands the next. How to build any piece is that issue's own plan. IDs cross-reference
[DECISIONS.md](DECISIONS.md) (D-n) and [BUSINESS-RULES.md](BUSINESS-RULES.md) (ER-n).

## The path

![The path as of 6 October 2026, in phases rather than dates. Now: this spec in review and the FIX-1787 inventory posted, its merge-first rows landing. After the gate every child's spec can be written. Builds run in waves: the worker contract and per-org user data together; then workers as resources; then the coordinator flow; then projects and workstreams beside the assignment chain; then the MAILBOX.md conversion; then the terminology sweep; then the closure run. The worker library's spec is written with the others, and its build follows the MVP, after the closure run. The closure's QA plan is written beside the specs, and it runs leg c early when workers as resources merges. The critical path runs the inventory, the contract, workers, the coordinator, projects, the conversion, the terms and the closure run](figures/path.svg)

A long chain with two narrow windows. Nothing builds until the inventory's merge-first rows
land; the contract and per-org keys then run together, and workers as resources is the one
step everything else waits on. Projects beside the chain is the other window; the library
builds after the MVP (Q2). The privacy fix is checked when workers merges, not only at the end (ER-30). The graph itself is in [the spec](SPEC.md#how-the-issues-flow-into-each-other); this adds time.

## What each issue entails

| Issue | Route | Consumes | Delivers | Releases | Size |
|---|---|---|---|---|---|
| **FIX-1787** inventory | inventory, no spec | Every open PR and active issue in the areas | 38 calls: 13 merge first, 13 close, 12 untouched | Every refactor child | Done as a table; its merges are the work |
| **FIX-1789** contract | spec → impl PR | `workerConfigSchema()`, the door · Q1, decided at its spec gate on its POC of both shapes: the list | Worker flows on the installation's list, checked at registration by exported checks (configuration by value, a door, a full `writtenBy` shape); standard-only per entry, attribution; a worker's configuration as stored data read per run (ER-2, ER-11) | FIX-1788 | Small, plus the two-shape POC |
| **FIX-1790** per-org data | spec → impl PR | The engine's user key | User data per (user, org); old records moved to the one org they belong to by an operator step, or refused, never read in two (ER-3) | FIX-1788 | Medium: a persisted key every flow uses, and its migration |
| **FIX-1788** workers | spec → impl PRs | ER-2 · ER-3 · projected collections · Q1's list | Worker resources on singleton flows, standard projection, fork, deprecations; the session link, set and checked at create where only the server writes (D3's third change); a worker's own key for its private state, with today's per-worker cells moved (ER-1) | FIX-1791 · FIX-1795 | Large |
| **FIX-1791** coordinator | spec → impl PRs | ER-1 · FIX-1779's join and leave · FIX-1774's legs a to c · Q1's list | The coordinator flow, delegates, four policies, the records (ER-4, ER-5); the chief of staff as a standard coordinator | FIX-1793 · FIX-1794 · FIX-1792 | Medium to large |
| **FIX-1795** library | spec now → impl PR after the MVP | ER-1's write path | Templates and copies, model variants (ER-10) | Nothing in the MVP; it builds once the closure run passes | Medium |
| **FIX-1793** projects | spec → impl PRs | ER-4 · ER-3 · FIX-1762's locks · Q2 · FIX-1774's leg d | Private and shared projects (Q2); workstream resources, the row rule, the project coordinator; rooms and Shift Manager's Stream tab removed (ER-7, ER-8) | FIX-1792 | Large: about 2,200 lines out, one engine rule in |
| **FIX-1794** chain | spec → impl PR | ER-4's delegates · FIX-1778 · FIX-1780's hand-off rule and follow-through · FIX-1777's rule · FIX-1774's leg e | Tasks filed for delegates down the owner's boards, drained as the owner and followed through, so a coordinator files tasks only from here; every board in the chain keeps its rows at the owner's user scope, one partition per conversation (ER-9, D6) | FIX-1792 · FIX-1796 | Medium, with one task-board change (D6) |
| **FIX-1792** `WORKER.md` | spec → impl PR | ER-4 · ER-7 · D5 · FIX-1794's conversation board (D6) | 33 files converted, 15 boards resolved, old files refused (ER-6); project claims and a project row's mailbox list removed, which FIX-1793 leaves deprecated | FIX-1796 | Medium |
| **FIX-1796** terms | spec → impl PRs | Every child merged except FIX-1795, which is new code in the new terms (ER-25) | The sweep and the glossary (ER-12) | The closure run | Medium, wide and mechanical |
| **FIX-1797** closure · required | spec (the QA plan) → runs until clean → PR | Every other child except FIX-1795, on one `main` commit (ER-27) | The committed checks, an early leg-c run when FIX-1788 merges (ER-30), a QA report, a bug child per failure | The wrap | Medium, repeats per retest |

## Where it is

[The set table](SPEC.md#the-set--as-of-2026-10-06) is the review-time snapshot; follow its
links for live state. The inventory's table is
[on FIX-1786](https://linear.app/fixpoint-labs/issue/FIX-1786#comment-9e837aa5). Shift Manager
moves to `packages/shift-manager` with #2759, and every reference here means that location.

## What unblocks what, from here

1. **This spec merges** → every child's spec can start. Builds still wait on step 2. FIX-1789's gate
   chose the list, recorded here (Q1), so FIX-1788's and FIX-1791's specs register their flows on
   it.
2. **The inventory's merge-first rows land or close**, #2759 first, then the PRs that rebase on
   it → FIX-1789 and FIX-1790 builds start.
3. **Both merge** → FIX-1788 builds. It merges → FIX-1791 builds, and FIX-1797 runs leg c early
   on that commit (ER-30). A failure is a bug child that blocks FIX-1791 and FIX-1795 from merging.
4. **FIX-1791 merges** → FIX-1793 and FIX-1794. Both merge → FIX-1792, which moves each
   session board onto FIX-1794's conversation board (D6). One exception: FIX-1794's first PR (the
   partitioned board, D6) touches only orchestration on its own fixtures, so it may start once this
   amendment merges, without waiting for FIX-1791.
5. **FIX-1792 merges** → FIX-1796. It merges → the closure's first run. The terms
   sweep doesn't wait on the library: the library is new code, written in the new terms (ER-25),
   so the sweep has nothing of it to remove.
6. **A run finds bugs** → each is a child that blocks FIX-1797, and the whole plan reruns on a
   fresh `main` commit once they merge (ER-27).
7. **A run passes: the MVP** → FIX-1795 builds, on the spec approved at its own gate. Its tests
   prove ER-10; the closure's run never checked it.
8. **FIX-1793's spec gate answered what Q2 asked of it.** Private projects cost a scope
   configuration, and the shared half stays in the MVP, so leg b keeps its private-project step
   and its two-owner half. The library's half follows the MVP (step 7). Nothing re-sequences.

## Coordination seams to watch

| Seam | Between | Rule |
|---|---|---|
| The `agent` flow (`agent-worker-flow.ts`) | FIX-1788, FIX-1791, FIX-1794 | FIX-1788 lands the singleton shape first; the others build on it |
| The hire and roster write path | FIX-1788, FIX-1795 | FIX-1788 owns the write; the library calls it |
| The worker-flow declaration | FIX-1789, FIX-1788, FIX-1791 | The installation's list (Q1, decided). FIX-1789 builds it and its checks; the other two register on it |
| The user scope key | FIX-1790, FIX-1788, FIX-1793 | FIX-1790 merges first; nothing user-scoped ships before it |
| A board whose rows cross a flow | FIX-1794, FIX-1791, FIX-1792, FIX-1793 | FIX-1794 builds the partition per conversation in the task board (D6, ER-9); the others build their boards on it |
| Session data only the server writes | FIX-1788, FIX-1791 | FIX-1788 lands it with the link, set at create; the coordinator keeps its delegates where only the server writes |
| The mailbox flow, its files and project claims | FIX-1791, FIX-1793, FIX-1792 | FIX-1791 ships the coordinator beside the mailbox flow, and FIX-1793 leaves project claims and a project row's mailbox list deprecated; FIX-1792 converts every file and removes the mailbox flow, the claims and the list |
| `packages/shift-manager` | FIX-1788, FIX-1793, FIX-1796 | The second lander adapts; the TEAMS view reads worker resources, the Project view the coordinator session |
| `apps/docs/docs/workforce/` | Every child | Each child its own page ([DOCS.md](DOCS.md#ownership)); FIX-1796 the overview and glossary |

## Not children, deliberately

FIX-1763 and its children, whose org-level project fence Q2 lifted · FIX-1650 and its children, which land
first and get an evolution note · FIX-1775, long-lived memory · FIX-1778, consumed · FIX-1762's
stack, merged and consumed · FIX-1765 and FIX-1764, specced after FIX-1791 · FIX-1745, obsolete when rooms
go · FIX-1766, FIX-1767 and FIX-1768, carried into FIX-1793's spec · FIX-1798, which removes flow
instances and owner pins from the engine; FIX-1788 blocks it, and each deprecation marker names it.

## Wrap

When ER-28 holds: run the lessons pass, dispatch docs polish over `apps/docs/docs/workforce/`
(the inventory closed #2715 for that reason), refresh the project spec (#2420), and report the
outcome from Linear and implementation evidence. FIX-1795 is the one child still open then: it
builds after the MVP, and the report names it. Amendments go through a follow-up PR.
