# FIX-1815 · Rules every issue in the set obeys

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The constraints every child spec and implementation satisfies, and where a cross-spec review
checks them. Each names its owner and where it is checked.

## What a team gets, and what it doesn't

| # | Rule | Owner | Checked at |
|---|---|---|---|
| ER-1 | An ask returns the asked worker's real answer inside the asker's turn, across a restart, and the asked worker runs once | FIX-1816 | FIX-1820's leg a and both controls |
| ER-2 | An answered park resumes the same task session, which keeps what it did before it parked | FIX-1817 | FIX-1820's leg b |
| ER-3 | A finished task's session answers a follow-up question from its history and accepts a follow-up task. It never locks. The finished row still declines writes (FIX-1794's leg e); a follow-up task is a new row bound to the same session | FIX-1817, with FIX-1765 on what a reply does | FIX-1820's leg b · FIX-1817's spec review |
| ER-4 | Every ask has a timeout and a depth cap, and a cancel of the asker reaches the asked worker ([D3](DECISIONS.md#d3)) | FIX-1816 | FIX-1816's tests · FIX-1820's gap sweep with a mutual ask |
| ER-5 | Dispatch stays fire-and-forget by default; ask is a separate, opt-in call ([D4](DECISIONS.md#d4)) | FIX-1816 decides · FIX-1817 consumes | Both specs' review |

## What no child may do

| # | Rule | Because |
|---|---|---|
| ER-6 | Add a third answer-once mechanism. Ask rides the board row's claim ticket or the existing delivery ledger | [D2](DECISIONS.md#d2). It replaces FIX-1818, cut by [Q1](DECISIONS.md#q1) |
| ER-7 | Build a second child-finished signal beside FIX-1794 P2's, or an owed marker on any pattern but FIX-1802's settle-owed. FIX-1816 lifts the one signal module and builds its resume-owed marker on that pattern; neither is a copy | D2 and [Q2](DECISIONS.md#q2), decided 2026-10-08. A gap goes to FIX-1786 as an amendment request |
| ER-8 | Hold a request open while it waits | [D1](DECISIONS.md#d1) |
| ER-9 | Merge ask and assign into one kind | The product owner, 2026-10-08 |
| ER-10 | Restore skill `agents:` in any form, including a skill's private team | FIX-1814 removed it; Not doing |
| ER-11 | Add a Layer 1 change outside [D5](DECISIONS.md#d5)'s nine, or any new public route | D5. It comes to this epic first |
| ER-12 | Change a FIX-1786 child's spec or code: FIX-1791, FIX-1792, FIX-1793, FIX-1794, FIX-1796, FIX-1797, FIX-1802, FIX-1814. A need goes to that epic as a comment. The one agreed exception: FIX-1816's lift re-points FIX-1794's S6 and S7 at the moved module ([Q2](DECISIONS.md#q2)) | Another session owns them |
| ER-13 | Build the Shift Manager composer for finished tasks | FIX-1764 and epic FIX-1765 own it |

## How the set is run

| # | Rule | Because |
|---|---|---|
| ER-14 | What a reply to a finished task does (a note, a follow-up task, or a reopen) is settled in FIX-1817's spec together with epic FIX-1765, not alone | Both epics answer the same question |
| ER-15 | The inputs land in this order, each on the product owner's merge, with no dates: FIX-1814, then FIX-1794 P2, then FIX-1802 P1. FIX-1817's build starts only after FIX-1802 merges on `main`. FIX-1816's lift of the child-finished signal (L4) starts only after FIX-1794 P2 merges; its other rows, L3 among them, do not wait | [Q2](DECISIONS.md#q2), decided 2026-10-08 |
| ER-16 | The epic finishes only when FIX-1820 closes: a clean run on one `main` commit, every bug an earlier run found fixed as a child of this epic and retested | The closure rule |
| ER-17 | FIX-1816's spec, before its gate, names the caller the kill line asks for, or the set stops after it and ships assign alone | The kill line |
| ER-18 | FIX-1816's spec decides FIX-1537's fate; one of the two closes as a duplicate. Nothing re-parents FIX-1537 out of FIX-1312 | FIX-1537 is FIX-1312's child |
| ER-21 | FIX-1816's spec sends `fix-1786-pm` the shape of the child-finished signal's seam before FIX-1794 P2 starts. If FIX-1817 changes what a park writes on the row, it tells `fix-1786-pm` before FIX-1794 P2 merges | [Q2](DECISIONS.md#q2): the module is built there and moved here, so both sides agree its shape first |

## The closure

| # | The epic is done when | Proved by |
|---|---|---|
| ER-19 | [The goal](SPEC.md#the-goal-and-how-well-know-its-met) is met: both legs pass, and each control fails | FIX-1820's goal check, on a durable store |
| ER-20 | The docs teach ask and assign as two kinds of hand-off, with when to use which | [DOCS.md](DOCS.md)'s shared opening, published by FIX-1816 |
