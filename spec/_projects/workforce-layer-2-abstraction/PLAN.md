# Plan — Workforce: Layer 2 Abstraction

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan**

Sequencing, not building. What order the epics run in, what each hands the next, and what is
deliberately not next. Each epic's own plan owns its checks.

![The arc](figures/arc.svg)

Seventeen days, not three months. The project opened in June, but every epic here was filed from
**Sep 8** onward, and 79 issues still sit under no epic. **W4 and W3 wrapped
three minutes apart on Sep 20.** Plane isolation is the shortest closed bar: its first children
shipped on Sep 22, it passed its gate on Sep 23 and wrapped on Sep 24, 8 of 8. Two bars cross the
now line, W5 and the kitchen-sink rebuild. Eight lanes: five closed, two open, and one that never
opened.

## What each epic consumes and releases

| Epic | Consumes | Releases |
|---|---|---|
| **W2** · FIX-1332 | Layer 1: blocks, resources, scope state | The conventions, the seat factory, a thin Agent — everything below depends on this |
| **agent flow** · FIX-1359 | W2's thin Agent | A replaceable OOTB `agent` flow kind, so an app overrides rather than assembles |
| **W3** · FIX-1351 | W2's walk primitives; the agent flow as a consumer | The file surface — channels, resources, skills — and the pentest lab that proves PR-3 |
| **W1** · FIX-1333 | W2's conventions; Layer 1 boards + dispatcher | The MCP client door over intake, boards and dispatch |
| **W4** · FIX-1407 | W3's file surface; the settled vocabulary | Work routing, proved on the real path (ER-20), and the **ratified** package format — whose build left the set as FIX-1459. **Not** the PR-5 propagation pass, which it named out unowned |
| **W5** · FIX-1457 | W3's file surface; W4's boards, inventory, dispatch and org identity, composed and never extended; Devtool's instance surfaces from FIX-1320 and org selection from FIX-1486, both outside this project | **Release QA** — three graded exit proofs on a live hired Workforce: Devtool reads it without a special wrapper, a DevForce path ships a real artifact, two seats collaborate across a channel. The evidence the project's *ready to ship* claim rests on. **Not** humans in seats: that explore is canceled, and only its invent-kill survives (PR list) |
| **kitchen-sink** · FIX-1455 | W3's file surface; W4's first cut, for its ship half only; the existing Postgres persistence | The always-on reference consumer — durable hire that survives a redeploy, channels, and the inline-vs-resource-backed UI split, shipped in client packages rather than in the app |
| **plane isolation** · FIX-1528 | FIX-1455's durable hire row (FIX-1475); the seat-hire tools; W4's dispatch and admission seams; a verified principal from FIX-1503, outside this project | **Released Sep 24:** one owner pin on the hire row fencing every door into a hired seat (catalog, open, restart, roster read, drain, debug, stored data), a hired seat's data kept per (org, person), and PR-7 for every epic after it. **Not** user planes, which wait on FIX-1486 |

**Two epics prove the outcome from two sides.** W5 produces the release evidence — graded proofs on
a live workforce, observed in Devtool; the kitchen-sink rebuild is the one app people copy. They
share a released fence and most of their inputs, so the seam to guard is unchanged: a UI shape
either needs lands in a **client package**, not twice.

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
- **Kitchen-sink → plane isolation — one hire row, fenced from the other epic.** FIX-1528 pinned
  the roster row FIX-1455's durable hire made. Its wrap answered the open half: ER-12 binds the
  kitchen-sink rebuild and W5, so it is now **PR-7** ([Rules](BUSINESS-RULES.md)). FIX-1527's hiring
  manager seat and FIX-1500's org path inherit the pin rather than adding a check of their own.
- **W3's lab is the proof for PR-3**, so any epic that ships a convention before the lab exists is
  asserting the rule rather than checking it. The lab shipped with W3 (FIX-1355, done).
- **The `org/channels/` door outlived both epics that bound it, and now reads closed while being
  open.** The plan was that whichever of W3 or W4 reached it first would answer it; both wrapped on
  Sep 20 and neither did. Worse, the issue filed for it (FIX-1419) reads **Done** while `main`
  still walks `teams/` only and a committed test pins that silence
  ([Decisions](DECISIONS.md) → Open). The next epic to touch the channel surface inherits a gap
  the tracker says is shut.

## Plane isolation's follow-ups

Filed from its children and left outside the set on purpose. None is an epic child, so no epic is
driving them.

| Issue | What is open | State |
|---|---|---|
| [FIX-1545](https://linear.app/fixpoint-labs/issue/FIX-1545) · High bug | A schedule created through a run's schedule collection never fires. Every flow, hired seats included | In Development |
| [FIX-1546](https://linear.app/fixpoint-labs/issue/FIX-1546) | Schedule index identity has no storage cell, so two orgs' schedules can collapse | Backlog |
| [FIX-1543](https://linear.app/fixpoint-labs/issue/FIX-1543) | Two copies of the owner-pin helper can drift apart | Backlog |
| [FIX-1503](https://linear.app/fixpoint-labs/issue/FIX-1503) | A verified principal by default. The fence is only as good as the principal, so every door above is only as strong as this | In Spec Review, another project |

## What is deliberately not next

- **The propagation pass.** Gated on the vocabulary locking (PD-4), not on capacity — and now
  **unowned**: W4 met PR-5 with a check over its own diff and named the repo-wide pass out at its
  wrap.
- **Tasks, Skills internals, Memory implementation.** Own projects; this one owns the vocabulary.
- **Re-parenting the 79 unparented issues.** They are the pre-epic era. Sweeping them under epics
  retroactively would make the arc look tidier and tell you less about what actually happened.
- **A second harness or transport for the MCP door.** W1 has not started; widening it before it
  does is scope with no consumer.
