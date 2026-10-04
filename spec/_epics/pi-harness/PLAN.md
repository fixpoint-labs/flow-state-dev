# LAB-162 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan**

An epic plan sequences the work and says what each piece entails. It does not say how to build any
piece; that's each issue's own plan. IDs cross-reference [DECISIONS.md](DECISIONS.md) (D-n) and
[BUSINESS-RULES.md](BUSINESS-RULES.md) (ER-n).

## The path

![The path as of 2026-09-16: four lanes against time. The now line sits before the objective gate, so every bar in the set is still ahead of it and none has started. LAB-154, manager-side session association, is shipped and available throughout. LAB-162's objective gate comes first. LAB-163 is specced then implements the OMP harness. LAB-164 runs the joint feasibility check early, before either affected interface is finalized, is specced alongside, and implements plus proves the full path only after LAB-163 delivers.](figures/path.svg)

A chain with one early fork. Nothing in the set has started: the now line sits **before** the gate,
and every bar is ahead of it. The one thing that runs early and out of delivery order is the joint
feasibility check — it belongs to LAB-164 but must land before either affected interface is
finalized (ER-14), which is why it sits beside LAB-163's spec rather than after LAB-163 delivers.
The dependency graph itself is in [the spec](SPEC.md#how-the-issues-flow-into-each-other); this
document adds time to it.

## What each issue entails

| Issue | Route | Consumes | Delivers | Releases | Size |
|---|---|---|---|---|---|
| **LAB-163** OMP harness | spec → impl PR | The shipped harness contract and the manager's slot and policy · LAB-154's manager-side session association · [D4](DECISIONS.md#d4), [D5](DECISIONS.md#d5), [D6](DECISIONS.md#d6) | An OMP harness taking prompt input and trusted run configuration; observable events; session identity through `onSession` during the run; resume of that exact saved conversation; terminal success, runtime failure and cancellation told apart; honest startup/model/auth failures; the tested OMP version recorded | LAB-164's delivery | Medium |
| **LAB-164** questions park and resume | spec → impl PR → the proof | LAB-163's adapter, resume and `onSession` · the existing manager intake, inbox, answer action and operator surface · [D2](DECISIONS.md#d2), [D3](DECISIONS.md#d3), [D6](DECISIONS.md#d6) | The trusted attempt-correlated handoff, co-specified with LAB-163; a captured question as durable evidence; the park where the attempt and the request end; the answer carried into a later attempt of the same session; real questions told apart from permission and extension dialogs; the negative cases; reproducible full-path evidence | The epic's wrap | Large |

**The feasibility check is LAB-164's, and it is not a third issue.** It is the first thing LAB-164
does, it precedes both issues' affected interfaces (ER-14), and it is bounded to one question:
whether an orderly completed harness step plus the existing single marker intake can carry a
captured question honestly.

## Where it is

Status lives in one place: [the set table in the spec](SPEC.md#the-set--as-of-2026-09-16). The
swimlanes above carry the same state as a picture of time and are redrawn when it moves. The one
input from outside the set, [LAB-154](https://linear.app/fixpoint-labs/issue/LAB-154), is **done**;
ER-13 consumes it without re-parenting it.

## What unblocks what, from here

1. **The objective gate is approved** → both issues can be specced, and LAB-164's joint feasibility
   check can start. Nothing implements yet (ER-16).
2. **The feasibility check returns** → ER-4's handoff can be decided and both affected interfaces
   finalized. If it needs a change to the harness contract or the manager's question intake, it
   comes back here first (ER-7) — neither spec assumes it.
3. **LAB-163's own spec is approved** → LAB-163 implements.
4. **LAB-163 merges** → LAB-164's delivery is unblocked. LAB-164 was never blocked from
   investigating the shared premise, only from delivering on it.
5. **LAB-164's full-path proof passes** (ER-19, ER-20) → the epic wraps.
6. **If safe capture, stop, persistence or continuation cannot be shown** → back to the objective
   gate (ER-21). Not to an unplanned suspension issue, not to a transport issue.

## Coordination seams to watch

| Seam | Between | Rule |
|---|---|---|
| The attempt-correlated question destination | LAB-163 and LAB-164 | ER-4. LAB-164 decides it, LAB-163 co-specifies it, and both do so before either interface is final. A second route is exactly the failure the seam exists to prevent |
| `resume` and `onSession` | LAB-163 and LAB-154 (shipped) | LAB-154 owns manager-side association; LAB-163 supplies OMP's side. Neither redoes the other's half |
| The completed-handle park arm of the manager's intake | LAB-164 and the shipped manager | Preserve the single marker intake first (D3). Any change to the intake returns to this epic (ER-7) |
| The pinned OMP version | Both issues | ER-17. One pinned version across the set's evidence; two versions makes the proof unreadable |

## Not children, deliberately

| Issue | What it owns | Why it isn't in the set |
|---|---|---|
| [FIX-1246](https://linear.app/fixpoint-labs/issue/FIX-1246) | The broader substrate same-session POC | This epic adds OMP-specific capture and stop evidence and reuses its continuity standard. It does not close or supersede it (ER-13) |
| [LAB-154](https://linear.app/fixpoint-labs/issue/LAB-154) | Manager-side session association · **done** | Consumed. LAB-163 supplies OMP's side only |
| [LAB-140](https://linear.app/fixpoint-labs/issue/LAB-140) | The harness manager program · in progress | The set adds a slot to it; it does not rewrite it |
| [LAB-151](https://linear.app/fixpoint-labs/issue/LAB-151) | The operator board · in review | The surface this epic reuses. Building a second one is what D1 cut |
| [FIX-1241 / D-1](https://linear.app/fixpoint-labs/issue/FIX-1241) | The one-human-wait model | A standing decision D2 preserves. No child reopens it locally |
| [FIX-1309 / D-9](https://linear.app/fixpoint-labs/issue/FIX-1309) | The existing operator surface · **done** | Why the console is out. No child reopens it locally |

## Wrap

When ER-19 to ER-21 hold: record what ran against which pinned OMP version and what did not
(ER-17), run the lessons pass over the set's review rounds, dispatch the docs polish over whatever
the two issues each edited in isolation, refresh the set table and the path one last time, and
close the epic PR unmerged. If the kill line fires instead, the epic returns to the objective gate
rather than wrapping — that is a real outcome for this set, not a failure to finish.
