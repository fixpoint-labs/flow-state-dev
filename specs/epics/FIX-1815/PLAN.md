# FIX-1815 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

An epic plan sequences the work and says what each piece entails. It does not say how to build
any piece; that is each issue's own plan. IDs cross-reference [DECISIONS.md](DECISIONS.md)
(Q-n, D-n, L-n) and [BUSINESS-RULES.md](BUSINESS-RULES.md) (ER-n).

## The path

![The path in phases, not dates, as of 8 October 2026. Two input lanes from FIX-1786, landing in order: FIX-1794 P2 after FIX-1814, then FIX-1802 P1 after FIX-1794 P2. This spec is in review at the now line. After the gate, the ask and assign specs run at once, with the closure's QA plan. Ask builds its own pieces, its resume-owed marker among them, without waiting, and lifts the child-finished signal once FIX-1794 P2 merges; assign builds only after FIX-1802 merges. The closure run follows both. FIX-1818 and FIX-1819, cut by Q1, have no lane. The critical path runs through FIX-1814, FIX-1794 P2, FIX-1802 P1, assign's build and the closure run](figures/path.svg)

The axis is order, not dates: nothing has started. Both specs run at once after the gate. The
critical path goes through FIX-1786's inputs, landing FIX-1814, then FIX-1794 P2, then FIX-1802
P1, not through any work in this epic ([Q2](DECISIONS.md#q2), [ER-15](BUSINESS-RULES.md#how-the-set-is-run)).

## What each issue entails

| Issue | Route | Consumes | Delivers | Releases | Size |
|---|---|---|---|---|---|
| **FIX-1816** ask | spec → impl PRs | Generator suspend and resume (`generator-resume.ts`) · `ctx.runOnce` · FIX-1794 P2's notice module, to lift (L4) · FIX-1802's settle-owed pattern (L3) · an existing answer-once check (ER-6) | L1 to L3, L5 to L8; the lift of L4 into `orchestration`; the seam's shape to `fix-1786-pm` (ER-21); the answers to the kill line (ER-17), "ask the delegate", and FIX-1537 (ER-18) | FIX-1817's use of the resume verb · the closure's leg a | Large: a Layer 1 seam across four packages |
| **FIX-1817** assign stays open | spec → impl PR | FIX-1794 P2's `parked` notice and session binding · FIX-1802's "run my board" replay · FIX-1816's resume verb where it applies | L9 · the reply semantics with FIX-1765 (ER-14) · word to `fix-1786-pm` if a park's row write changes (ER-21) | The closure's leg b | Medium |
| **FIX-1820** closure · required | spec (the QA plan) → runs until one is clean → PR | Every other child merged, on one `main` commit | The goal fixture under `goals/` on a durable store · a QA report · a bug child per failure | The wrap | Medium, and repeats per retest |

## Where it is

[The set table](SPEC.md#the-set--as-of-2026-10-08) is the review-time snapshot; its Linear links
carry live state. This section is the one dated status for the two inputs; the rest of the set
links here. As of 2026-10-08: FIX-1794's spec (#2828) and its P1 (#2845) are merged, and P2 has no
PR. FIX-1802's spec is merged (#2839), though Linear still reads In Spec Review. FIX-1786's
delegation amendment merged as #2889 and left both markers as specified. The inputs land in the
order [Q2](DECISIONS.md#q2) fixed: [FIX-1814](https://linear.app/fixpoint-labs/issue/FIX-1814),
which removes skill sub-agents (`fixpoint-labs/agent-mailbox#38`), then FIX-1794 P2, then FIX-1802
P1, each on the product owner's merge. FIX-1814 is in development. [Q1](DECISIONS.md#q1)'s cuts are
carried out: FIX-1818 is Canceled and FIX-1819 is in Backlog, unparented, outside the set
([Not doing](SPEC.md#while-it-runs-what-it-leaves-out-and-when-to-stop)).

## What unblocks what, from here

1. **This spec is approved and merged** → the FIX-1816 and FIX-1817 specs start together, and
   FIX-1820's QA plan beside them.
2. **FIX-1816's spec is approved** → if it names no caller, the kill line fires: FIX-1816 stops,
   and the set is FIX-1817 and the closure. Otherwise FIX-1816 builds L1 to L3 and L5 to L8. Its
   spec has already sent `fix-1786-pm` the signal seam's shape, before FIX-1794 P2 starts (ER-21).
3. **FIX-1794 P2 merges on `main`** → FIX-1816 lifts the child-finished signal into
   `orchestration` and re-points S6 and S7 at it (L4, ER-15). FIX-1802 P1 starts.
4. **FIX-1802 merges on `main`** → FIX-1817's build starts (ER-15).
5. **FIX-1816 and FIX-1817 merge** → the closure's first run.
6. **A closure run finds bugs** → each one becomes a child of this epic that blocks FIX-1820,
   and the whole plan runs again on a fresh `main` commit.

## Coordination seams to watch

| Seam | Between | Rule |
|---|---|---|
| The resume verb | FIX-1816 builds it · FIX-1817 may use it for an answered park | One verb. FIX-1817 does not add a second path into a parked session |
| The board row's markers | FIX-1816 · FIX-1817 · FIX-1802 | One pattern (ER-7): FIX-1802's settle-owed starts a new turn and stays unchanged; FIX-1816's resume-owed resumes a parked one. A change to the pattern is made in both |
| The child-finished signal module | FIX-1794 P2 builds it · FIX-1816 lifts it | Layer-clean as built; moved once, S6 and S7 re-pointed, no copy. Its shape is agreed with `fix-1786-pm` before P2 starts (ER-21) |
| The `parked` notice | FIX-1794 P2 produces it · FIX-1817 consumes it | FIX-1817 does not change the notice (BR-25's `parked` then `completed` stay); it changes what the answer wakes. A change to what a park writes on the row goes to `fix-1786-pm` before P2 merges (ER-21) |
| The finished task's session | FIX-1817 · FIX-1764 and FIX-1765 | ER-14: the reply semantics are settled together |
| `escalate.ts` | FIX-1816's kill line · FIX-1792's conversion of its board | FIX-1816's spec reads it after FIX-1792's conversion, not before |

## Not children, deliberately

FIX-1794 and FIX-1802 (inputs, FIX-1786's) · FIX-1791 (its delivery ledger, consumed) · FIX-1780
(Q3) · FIX-1537 and FIX-1312 (ER-18) · FIX-1659 (a reassign's held claim, unrelated to
cancellation) · FIX-1764 and FIX-1765 (the composer). Linked, never re-parented.

## Wrap

When ER-16 holds: run the lessons pass, dispatch docs polish over the pages in
[DOCS.md](DOCS.md), and report the outcome from Linear and implementation evidence. A
meaningful design change after merge goes through a follow-up PR from `main`.
