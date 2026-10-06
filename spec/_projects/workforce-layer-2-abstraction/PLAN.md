# Plan — Workforce: Layer 2 Abstraction

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan**

Sequencing, not building. What order the epics run in, what each hands the next, and what is
deliberately not next. Each epic's own plan owns its checks.

![The arc](figures/arc.svg)

Twenty-one days, not three months. The project opened in June, but every epic here was filed from
**Sep 8** onward, and 117 work issues still have no parent. W4 and W3 wrapped three minutes apart
on Sep 20, and three more closed on Sep 24: plane isolation, W5, and the kitchen-sink rebuild.
**The support desk is the last bar**, filed on Sep 25, re-scoped on Sep 27 after the owner's real-model
test, and wrapped at 00:27 UTC on Sep 29 when its closure merged. Nothing has run here since: the
now line, Oct 6, sits a week past the last bar. Nine lanes: eight closed, and one that never opened.

## What each epic consumes and releases

| Epic | Consumes | Releases |
|---|---|---|
| **W2** · FIX-1332 | Layer 1: blocks, resources, scope state | The conventions, the seat factory, a thin Agent — everything below depends on this |
| **agent flow** · FIX-1359 | W2's thin Agent | A replaceable OOTB `agent` flow kind, so an app overrides rather than assembles |
| **W3** · FIX-1351 | W2's walk primitives; the agent flow as a consumer | The file surface — channels, resources, skills — and the pentest lab that proves PR-3 |
| **W1** · FIX-1333 | W2's conventions; Layer 1 boards + dispatcher | The MCP client door over intake, boards and dispatch |
| **W4** · FIX-1407 | W3's file surface; the settled vocabulary | Work routing, proved on the real path (ER-20), and the **ratified** package format — whose build left the set as FIX-1459. **Not** the PR-5 propagation pass, which it named out unowned |
| **W5** · FIX-1457 | W3's file surface; W4's boards, inventory, dispatch and org identity, composed and never extended; Devtool's instance surfaces from FIX-1320 and org selection from FIX-1486, both outside this project | **Released Sep 24:** the release evidence — three exit proofs met on a live hired Workforce. A DevForce path ships a real artifact, two seats collaborate across a channel, and Devtool reads the Workforce with no special wrapper, including the org's inventory through the ordinary collection route. Row 6's live read goes to the kitchen-sink rebuild. **Not** humans in seats, and **not** org selection: a one-user, one-org deployment does not need FIX-1486 |
| **kitchen-sink** · FIX-1455 | W3's file surface; W4's first cut, for its ship half only; the existing Postgres persistence; plane isolation's owner pin | **Released Sep 24:** the always-on reference consumer. Durable hire that survives a redeploy, channels, the inline-vs-resource-backed UI split shipped in client packages rather than in the app, a rail that hires and shows seats in one named org, and a manager seat that hires and fires them. Also a terminal that runs as the app's own principal, and `leafDetail` on the published navigator. **Not** Devtool's row 6 live read, which rides FIX-1469. *Since cut by the support desk's D8:* the rail's hiring and the manager seat |
| **plane isolation** · FIX-1528 | FIX-1455's durable hire row (FIX-1475); the seat-hire tools; W4's dispatch and admission seams; a verified principal from FIX-1503, outside this project | **Released Sep 24:** one owner pin on the hire row fencing every door into a hired seat (catalog, open, restart, roster read, drain, debug, stored data), a hired seat's data kept per (org, person), and PR-7 for every epic after it. **Not** user planes, which wait on FIX-1486 |
| **support desk** · FIX-1592 | The kitchen-sink rebuild's app, org, durable hire and board v1; W3's `CHANNEL.md` convention; the pin, through the wake's reach test | **Released Sep 29:** talking from the page to a seat and a channel, with a post waking member agents and a seat posting as itself; routing in Workforce, one `evaluator` choice per post with a fallback, opted into by a `CHANNEL.md` line; a routed answer that always lands; a live, session-wide view in engine, client and react, in their own words; and kitchen-sink rebuilt as one routed support desk. **Not** a person working `escalations` (FIX-1591, held for the owner), hired specialists joining a channel (FIX-1415), or a queue-backed host, where the channel does not answer |

**Two epics prove the outcome from two sides, and both are in.** W5 produced the release
evidence: graded proofs on a live workforce, observed in Devtool. The kitchen-sink rebuild is the
one app people copy, and it wrapped the same day. It took the org's inventory read and what a row
means from W5 rather than re-deciding them. It did **not** take the live read of Devtool's row 6:
no kitchen-sink seat declares a `references/` document, so that debt rides FIX-1469, in Backlog
([Decisions](DECISIONS.md) → *decided once*). The seam held: the UI shapes both needed shipped in
**client packages**, not twice. **Then the owner used the reference app the way a person would**,
and the support desk's first version failed him with every check green: the checks had reloaded
before reading, and the scripted model always posted its answer. The rebuild that forced is what
the reference app now proves, graded on one commit and read before any reload, plus a real-model
smoke.

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
- **Kitchen-sink → plane isolation — one hire row, fenced from the other epic. Both ends wrapped.**
  FIX-1528 pinned the roster row FIX-1455's durable hire made, and its wrap made ER-12 **PR-7**
  ([Rules](BUSINESS-RULES.md)). FIX-1527's hiring manager seat and FIX-1500's org path shipped
  inheriting the pin; FIX-1563 decided only which seats get the admin authentication, from the pin.
- **Kitchen-sink rebuild → support desk — one app, and the later epic cut part of the earlier.
  Both ends wrapped.** The support desk ran as a follow-on, not a reopen, and its D8 took the
  rail's hiring and the manager seat off the page. The checks behind them were re-pointed, not
  deleted ([Decisions](DECISIONS.md) → *decided once*).
- **W3's lab is the proof for PR-3**, so any epic that ships a convention before the lab exists is
  asserting the rule rather than checking it. The lab shipped with W3 (FIX-1355, done).
- **The `org/channels/` door outlived both epics that bound it, and now reads closed while being
  open.** The plan was that whichever of W3 or W4 reached it first would answer it; both wrapped on
  Sep 20 and neither did. Worse, the issue filed for it (FIX-1419) reads **Done** while `main`
  still walks `teams/` only and a committed test pins that silence
  ([Decisions](DECISIONS.md) → Open). The next epic to touch the channel surface inherits a gap
  the tracker says is shut.

## Follow-ups with no epic

Filed from the children of plane isolation, W5 and the support desk, and left outside their sets
on purpose. None is an epic child, so no epic is driving them. W5's FIX-1562 and plane isolation's
FIX-1543, FIX-1545 and FIX-1546 have closed since they were listed here.

| Issue | From | What is open | State |
|---|---|---|---|
| [FIX-1591](https://linear.app/fixpoint-labs/issue/FIX-1591) | support desk | A person working `escalations`, against keeping the unattended-board warning as the demo. **The owner's call**, parked since Sep 25 | Backlog |
| [FIX-1631](https://linear.app/fixpoint-labs/issue/FIX-1631) · [FIX-1632](https://linear.app/fixpoint-labs/issue/FIX-1632) · [FIX-1633](https://linear.app/fixpoint-labs/issue/FIX-1633) | support desk | What the closure's blind walk-through hit: docs that disagree with the app, a boot warning repeated on every hot reload, and a header naming a model that did not answer | Backlog |
| [FIX-1621](https://linear.app/fixpoint-labs/issue/FIX-1621) | support desk | A hire row whose kind the app stopped registering fails to load, as the cut `desk-clerk` seats do. No repair path yet | Backlog |
| [FIX-1628](https://linear.app/fixpoint-labs/issue/FIX-1628) | support desk | A non-streaming generator turn drops the text it wrote before a tool call. Seats stream, so kitchen-sink is unaffected | Backlog |
| [FIX-1474](https://linear.app/fixpoint-labs/issue/FIX-1474) · [FIX-1468](https://linear.app/fixpoint-labs/issue/FIX-1468) | W5 | A composed `@seat` notify, and a read-only resource handle. Detached at the wrap as backlog spin-offs, not proving legs | Backlog |
| [FIX-1503](https://linear.app/fixpoint-labs/issue/FIX-1503) | plane isolation | A verified principal by default. The fence is only as good as the principal, so every door above is only as strong as this | In Spec Review, another project |

W5's other two findings, [FIX-1523](https://linear.app/fixpoint-labs/issue/FIX-1523) (the parked
reason is off-screen below ~1500px) and [FIX-1524](https://linear.app/fixpoint-labs/issue/FIX-1524)
(shared DevTool goal helpers), sit in **no project at all**, so no project view finds them.

**One child left its epic.** [FIX-1469](https://linear.app/fixpoint-labs/issue/FIX-1469), the
deferred S7 of FIX-1467, is in Backlog with no parent, and it carries Devtool's row 6 live read.
Nothing is driving it until an epic picks it up. **One limit has no issue at all**: behind BullMQ a
routed channel never answers ([Decisions](DECISIONS.md) → *Recorded at the wrap*, 6).

## What is deliberately not next

- **The propagation pass.** Gated on the vocabulary locking (PD-4), not on capacity — and now
  **unowned**: W4 met PR-5 with a check over its own diff and named the repo-wide pass out at its
  wrap.
- **Tasks, Skills internals, Memory implementation.** Own projects; this one owns the vocabulary.
- **Re-parenting the 117 unparented issues.** Most are the pre-epic era; the rest are the wrap
  follow-ups above. Sweeping them under epics
  retroactively would make the arc look tidier and tell you less about what actually happened.
- **A second harness or transport for the MCP door.** W1 has not started; widening it before it
  does is scope with no consumer.
- **Page hiring back in kitchen-sink.** It returns with FIX-1415, when a hired specialist can join
  a channel. Before that, a hire button on the desk has no job (the support desk's D8).
