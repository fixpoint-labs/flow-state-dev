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
| **W4** · FIX-1407 | W3's file surface; the settled vocabulary | Work routing, proved on the real path (ER-20), and the **ratified** package format — whose build left the set as FIX-1459. **Not** the PR-5 propagation pass, which it named out unowned |
| **W5** · FIX-1457 | W3's file surface; W4's routing, for its ship half only | Humans in seats on the same surface as agents, and reference apps that run on it |

**W1 is the one that unblocks nothing**, which is why it can sit unstarted at the bottom of the arc
without holding anything up — and also why it is the easiest to keep deferring. Its cost is not
delay to the others, it is that the client door stays shut. Whether that deferral has hardened into a
decision is open — the delivery countdown calls W1 *held* and off the feature-complete path, the
issue says only *Todo* ([Decisions](DECISIONS.md) → Open).

## Coordination seams

- **W3 → W4 — both ends wrapped, and the fence stopped applying rather than being discharged.**
  This plan said starting W4 early risked renaming twice; the Sep 19 gate re-aimed that concern
  **from the start to the ship**, holding it in W4's ER-14 ship fence. The wrap is now folded and
  the answer is untidy: the narrowing the epic recommended was never answered, the epic ran an
  unratified default read off the owner's merges, and ER-14's release condition now reads
  **satisfied** — every W3 child is terminal, and the one issue W4 named as holding the fence turns
  out not to be a W3 child at all. Nobody ruled it discharged
  ([Decisions](DECISIONS.md) → *Recorded at the wrap*, 1).
- **W4 → W5 — the fence has lifted.** W5's ship half was soft-after W4's first cut, because a human
  in a seat is routed to the same way an agent is, and routing was W4's. **That cut exists and W4
  has wrapped, so the condition is met** and W5's remaining sequencing is its own. Sanctioned-now
  versus held is still per child: FIX-1458 runs, FIX-1455 is held.
- **W3's lab is the proof for PR-3**, so any epic that ships a convention before the lab exists is
  asserting the rule rather than checking it. The lab shipped with W3 (FIX-1355, done).
- **The `org/channels/` door outlived both epics that bound it, and now reads closed while being
  open.** The plan was that whichever of W3 or W4 reached it first would answer it; both wrapped on
  Sep 20 and neither did. Worse, the issue filed for it (FIX-1419) reads **Done** while `main`
  still walks `teams/` only and a committed test pins that silence
  ([Decisions](DECISIONS.md) → Open). The next epic to touch the channel surface inherits a gap
  the tracker says is shut.

## What is deliberately not next

- **The propagation pass.** Gated on the vocabulary locking (PD-4), not on capacity — and now
  **unowned**: W4 met PR-5 with a check over its own diff and named the repo-wide pass out at its
  wrap.
- **Tasks, Skills internals, Memory implementation.** Own projects; this one owns the vocabulary.
- **Re-parenting the 45 unparented issues.** They are the pre-epic era. Sweeping them under epics
  retroactively would make the arc look tidier and tell you less about what actually happened.
- **A second harness or transport for the MCP door.** W1 has not started; widening it before it
  does is scope with no consumer.
