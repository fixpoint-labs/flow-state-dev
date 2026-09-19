# Plan — Workforce: Layer 2 Abstraction

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan**

Sequencing, not building. What order the epics run in, what each hands the next, and what is
deliberately not next. Each epic's own plan owns its checks.

![The arc](figures/arc.svg)

Twelve days, not three months. The project opened in June, but every epic here was filed from
**Sep 8** onward; the vocabulary era before it left 40 issues under no epic. Until this week only
one epic had ever been in flight at a time — **W3 and W4 are the first overlap**, and since Sep 19
it is a real one rather than a narrow one: W4 cleared its objective gate and has three child specs
running while W3 runs out its last issues.

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
delay to the others, it is that the client door stays shut. Whether that deferral has hardened into a
decision is open — the delivery countdown calls W1 *held* and off the feature-complete path, the
issue says only *Todo* ([Decisions](DECISIONS.md) → Open).

## Coordination seams

- **W3 → W4 — the deferral ended on Sep 19; PD-4's concern did not.** This plan said starting W4
  early bought nothing and risked renaming twice. The objective gate went the other way, so the
  reasoning was not overturned — it was **re-aimed from the start to the ship**. W4's D2 lets
  filing, specs and POCs run now and fences every *ship* PR until every W3 child that carries an
  implementation is merged to main (W4 ER-14); the PR-5 propagation pass rides FIX-1385 (W4 ER-19),
  which is a ship ticket and therefore behind that fence. The rename-twice risk is held by a
  mechanism, not retired.
- **W3's lab is the proof for PR-3**, so any epic that ships a convention before the lab exists is
  asserting the rule rather than checking it.
- **The `org/channels/` door in [Decisions](DECISIONS.md) → Open binds W3 and W4 both.** It is
  declared in the tree and read by nothing, and no issue owns closing it. Whichever epic reaches it
  first answers it and records it there, so it is not answered twice.

## What is deliberately not next

- **The propagation pass.** Gated on the vocabulary locking (PD-4), not on capacity.
- **Tasks, Skills internals, Memory implementation.** Own projects; this one owns the vocabulary.
- **Re-parenting the 40 unparented issues.** They are the pre-epic era. Sweeping them under epics
  retroactively would make the arc look tidier and tell you less about what actually happened.
- **A second harness or transport for the MCP door.** W1 has not started; widening it before it
  does is scope with no consumer.
