# Plan — Workforce: Layer 2 Abstraction

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan**

Sequencing, not building. What order the epics run in, what each hands the next, and what is
deliberately not next. Each epic's own plan owns its checks.

![The arc](figures/arc.svg)

Nine days, not three months. The project opened in June, but every epic here was filed from
**Sep 8** onward — before that, the work ran as 32 unparented vocabulary issues. Only one epic has
ever been in flight at a time, which is the cap doing its job rather than a queue forming.

## What each epic consumes and releases

| Epic | Consumes | Releases |
|---|---|---|
| **W2** · FIX-1332 | Layer 1: blocks, resources, scope state | The conventions, the seat factory, a thin Agent — everything below depends on this |
| **agent flow** · FIX-1359 | W2's thin Agent | A replaceable OOTB `agent` flow kind, so an app overrides rather than assembles |
| **W3** · FIX-1351 | W2's walk primitives; the agent flow as a consumer | The file surface — channels, resources, skills — and the pentest lab that proves PR-3 |
| **W1** · FIX-1333 | W2's conventions; Layer 1 boards + dispatcher | The MCP client door over intake, boards and dispatch |
| **W4** · FIX-1407 | W3's file surface; the settled vocabulary | Work routing, package cohesion, and the PR-5 propagation pass |

**W1 is the one that unblocks nothing**, which is why it can sit unstarted at the bottom of the arc
without holding anything up — and also why it is the easiest to keep deferring. Its cost is not
delay to the others, it is that the client door stays shut.

## Coordination seams

- **W3 → W4.** W4's propagation pass (PR-5) cannot run until W3 locks the file-surface vocabulary.
  Starting W4 early buys nothing and risks renaming twice (PD-4).
- **W3's lab is the proof for PR-3**, so any epic that ships a convention before the lab exists is
  asserting the rule rather than checking it.
- **The `org/channels/` door in [Decisions](DECISIONS.md) → Open binds W3 and W4 both.** It is
  declared in the tree and read by nothing, and no issue owns closing it. Whichever epic reaches it
  first answers it and records it there, so it is not answered twice.

## What is deliberately not next

- **The propagation pass.** Gated on the vocabulary locking (PD-4), not on capacity.
- **Tasks, Skills internals, Memory implementation.** Own projects; this one owns the vocabulary.
- **Re-parenting the 32 unparented issues.** They are the pre-epic era. Sweeping them under epics
  retroactively would make the arc look tidier and tell you less about what actually happened.
- **A second harness or transport for the MCP door.** W1 has not started; widening it before it
  does is scope with no consumer.
