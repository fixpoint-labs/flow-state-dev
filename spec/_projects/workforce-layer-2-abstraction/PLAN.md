# Plan — Workforce: Layer 2 Abstraction

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan**

Sequencing, not building. What order the epics run in, what each hands the next, and what is
deliberately not next. Each epic's own plan owns its checks.

![The arc](figures/arc.svg)

Thirteen days, not three months. The project opened in June, but every epic here was filed from
**Sep 8** onward; the vocabulary era before it left 47 issues under no epic. The overlap this
project ran all week collapsed on Sep 20: **W4 and W3 wrapped three minutes apart**, and W5 is the
only bar crossing the now line. Four lanes closed, one open, one that never opened.

## What each epic consumes and releases

| Epic | Consumes | Releases |
|---|---|---|
| **W2** · FIX-1332 | Layer 1: blocks, resources, scope state | The conventions, the seat factory, a thin Agent — everything below depends on this |
| **agent flow** · FIX-1359 | W2's thin Agent | A replaceable OOTB `agent` flow kind, so an app overrides rather than assembles |
| **W3** · FIX-1351 | W2's walk primitives; the agent flow as a consumer | The file surface — channels, resources, skills — and the pentest lab that proves PR-3 |
| **W1** · FIX-1333 | W2's conventions; Layer 1 boards + dispatcher | The MCP client door over intake, boards and dispatch |
| **W4** · FIX-1407 | W3's file surface; the settled vocabulary | Work routing, package cohesion, and the PR-5 propagation pass |
| **W5** · FIX-1457 | W3's file surface; W4's routing, for its ship half only | Humans in seats on the same surface as agents, and reference apps that run on it |

**W1 is the one that unblocks nothing**, which is why it can sit unstarted at the bottom of the arc
without holding anything up — and also why it is the easiest to keep deferring. Its cost is not
delay to the others, it is that the client door stays shut. Whether that deferral has hardened into a
decision is open — the delivery countdown calls W1 *held* and off the feature-complete path, the
issue says only *Todo* ([Decisions](DECISIONS.md) → Open).

## Coordination seams

- **W3 → W4 — both ends of this seam wrapped, and it closed unexamined.** This plan said starting
  W4 early risked renaming twice; the Sep 19 gate re-aimed that concern **from the start to the
  ship**, holding it in W4's ER-14 ship fence rather than retiring it. Whether the fence discharged
  or simply stopped applying is a **wrap question**, and no wrap has been folded here — so the seam
  is recorded open, not resolved.
- **W4 → W5 was soft, and only on the ship half — and its upstream is now done.** W5 explores and
  specs now; its ship half waited on W4's first cut, because a human in a seat is routed to the
  same way an agent is, and routing was W4's. W4 has wrapped, so what was a hold is now W5's own
  sequencing call. Sanctioned-now versus held is still per child: FIX-1458 runs, FIX-1455 is held.
- **W3's lab is the proof for PR-3**, so any epic that ships a convention before the lab exists is
  asserting the rule rather than checking it. The lab shipped with W3 (FIX-1355, done).
- **The `org/channels/` door in [Decisions](DECISIONS.md) → Open outlived both epics that bound
  it.** It is declared in the tree and read by nothing, and no issue owns closing it. The plan was
  that whichever of W3 or W4 reached it first would answer it; **both wrapped on Sep 20 and neither
  did**, so it is now an unowned door rather than a race — which is what the Open entry says.

## What is deliberately not next

- **The propagation pass.** Gated on the vocabulary locking (PD-4), not on capacity.
- **Tasks, Skills internals, Memory implementation.** Own projects; this one owns the vocabulary.
- **Re-parenting the 45 unparented issues.** They are the pre-epic era. Sweeping them under epics
  retroactively would make the arc look tidier and tell you less about what actually happened.
- **A second harness or transport for the MCP door.** W1 has not started; widening it before it
  does is scope with no consumer.
