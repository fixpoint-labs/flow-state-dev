# FIX-1601 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

The epic was specced before the closure rule landed, and says its proof needs no proof issue.
This plan replaces that part of the epic's proof. The epic's own spec still says the old thing;
the closure rule sends that to an amendment PR on the epic
([orchestration.md](../../../docs/contributing/orchestration.md#the-closure-issue-every-epic-ends-in-qa),
last paragraph). That PR is [#2289](https://github.com/fixpoint-labs/flow-state-dev/pull/2289): it
adds FIX-1601 to the set and repoints ER-17. It must merge before the run (QR-1).

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| "No proof issue: each leg is its owner's browser goal check, all four run on one `main` commit at wrap." [FIX-1592 SPEC → How we verify](../../epics/FIX-1592/SPEC.md#the-goal-and-how-well-know-its-met), goal-check row | **Superseded** | The closure rule: every epic ends in one closure issue whose plan proves the assembled set end to end, as a user would. Four checks passing separately never reach the seams between them ([D1](DECISIONS.md#d1)) | This plan's part 1, the integrated goal check | All four child checks still run, in part 3 (QR-11) |
| ER-17: the epic is done when the four children's browser checks pass on one commit. [FIX-1592 BUSINESS-RULES → The proof](../../epics/FIX-1592/BUSINESS-RULES.md#the-proof) | **Amended**: the one-commit, keyless, control-must-fail conditions are **retained**; *proved by* becomes this closure run | Same as above | QR-3, QR-5, QR-9 to QR-13 | The four signals ER-17 lists are all still graded, now in one session |
| ER-18: the workforce-shell checks and `a-channel-holds-the-work-a-seat-drains` stay green, V14 untouched. [FIX-1592 BUSINESS-RULES → The proof](../../epics/FIX-1592/BUSINESS-RULES.md#the-proof) | **Retained**, and run on the closure commit | Part 3 re-runs them | P3.2, P3.3 | — |
| Wrap happens when ER-17 to ER-19 hold. [FIX-1592 PLAN → Wrap](../../epics/FIX-1592/PLAN.md#wrap) | **Amended**: wrap also waits for this issue's closure PR to merge | The closure PR's merge is the epic's wrap condition | QR-19 | ER-19 (the README tells the three ways) is unchanged and checked in part 4 |
| The set table lists four children, with no closure row. [FIX-1592 SPEC → The set](../../epics/FIX-1592/SPEC.md#the-set--as-of-2026-09-25) | **Amended** in [#2289](https://github.com/fixpoint-labs/flow-state-dev/pull/2289), not here | The closure rule: the closure issue is a row marked closure · required | — | Linear already parents FIX-1601 under FIX-1592 |
| This plan gated on four children and re-ran four child checks. Source: this spec as merged, QR-1, QR-11, P3.1 | **Amended** by the epic amendment [#2294](https://github.com/fixpoint-labs/flow-state-dev/pull/2294) | FIX-1602 joined the set: path two's wake moves into Workforce, and epic ER-17 grades leg b on that stock path | QR-1 and QR-11 name five children; P3.1 re-runs FIX-1602's check; part 4's stock-routing check | Legs a to d, their controls and QR-2 to QR-19 are unchanged |
| Part 4's stock-routing check failed any `notifyFor` in `apps/kitchen-sink`. Source: this spec's [PLAN → part 4](PLAN.md#part-4--gap-sweep), stock-routing row, restated in SPEC's *Control that must fail* row | **Amended** by FIX-1604 | The closure run on `55de0734d` found kitchen-sink's `notifyFor(seats)`, wired from `hire.ts` for the channel kind, only returns `withChannelWakeControl(wakeMemberSeats(seats, { fallback: notifyMember }), notifyMember)`: Workforce's stock wake with the test-mode controls layered on top, under a name FIX-1602's PLAN S3 kept on purpose. No loop over seats, no dispatcher or router in the app: the routing is right, the wording was stale | The row now fails an app-built dispatcher, router or seat loop, and allows a thin wrapper of `wakeMemberSeats`. SPEC's *Control that must fail* row points at it instead of restating it | The check still reads the commit's source; what it proves is unchanged |

Re-read each source on `main` before the run: the epic may have been amended in the meantime.
