# Plan — Workforce: Layer 2 Abstraction

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan**

Sequencing, not building. What order the epics run in, what each hands the next, and what is
deliberately not next. Each epic's own plan owns its checks.

![The arc](figures/arc.svg)

Thirteen days, not three months. The project opened in June, but every epic here was filed from
**Sep 8** onward; the vocabulary era before it left 52 issues under no epic. The overlap this
project ran all week collapsed on Sep 20: **W4 and W3 wrapped three minutes apart**, and W5 is the
only bar crossing the now line. Seven lanes — four closed, one open, one that starts today with no
bar yet, and one that never opened.

## What each epic consumes and releases

| Epic | Consumes | Releases |
|---|---|---|
| **W2** · FIX-1332 | Layer 1: blocks, resources, scope state | The conventions, the seat factory, a thin Agent — everything below depends on this |
| **agent flow** · FIX-1359 | W2's thin Agent | A replaceable OOTB `agent` flow kind, so an app overrides rather than assembles |
| **W3** · FIX-1351 | W2's walk primitives; the agent flow as a consumer | The file surface — channels, resources, skills — and the pentest lab that proves PR-3 |
| **W1** · FIX-1333 | W2's conventions; Layer 1 boards + dispatcher | The MCP client door over intake, boards and dispatch |
| **W4** · FIX-1407 | W3's file surface; the settled vocabulary | Work routing, proved on the real path (ER-20), and the **ratified** package format — whose build left the set as FIX-1459. **Not** the PR-5 propagation pass, which it named out unowned |
| **W5** · FIX-1457 | W3's file surface; W4's routing, for its ship half only | Living assemblies — channels, seats, boards and inventory composed into one runnable shape. **No longer humans in seats**: that explore is canceled, and only its invent-kill survives (PR list) |
| **kitchen-sink** · FIX-1455 | W3's file surface; W4's first cut, for its ship half only; the existing Postgres persistence | The always-on reference consumer — durable hire that survives a redeploy, channels, and the inline-vs-resource-backed UI split, shipped in client packages rather than in the app |

**Two epics run the same play from here, and the difference is who they are for.** W5 composes the
surface for whoever builds on it; the kitchen-sink rebuild is the one app people copy. They share a
released fence and most of their inputs, which is worth watching — the seam to guard is that a UI
shape either app needs lands in a **client package**, not twice.

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
- **W4 → the two epics that fenced on it — the floor is down.** W5 and the kitchen-sink rebuild
  each fenced their *ship* work on the same condition, *after W4's first cut*, because both compose
  routing rather than re-inventing it. **That cut exists, its three children are done, and W4 has
  wrapped, so the condition is met for both** ([Decisions](DECISIONS.md) → *decided once*). What
  remains is each epic's own sequencing, and neither is waiting on anything upstream. The per-child
  hold W5 used to carry is gone with the children: FIX-1458 is canceled and FIX-1455 is its own
  epic.
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
