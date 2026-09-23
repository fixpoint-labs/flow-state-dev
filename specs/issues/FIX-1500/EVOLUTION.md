# FIX-1500 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

Four retained predecessors, and this issue amends a part of each rather than replacing any. None
is superseded: all four shipped contracts this design composes.

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| **FIX-1477 D4** — a hired roster and a channel board are ordinary in-organization data, so the panels read them directly; the axis is the resource's **scope**, and a user-scoped collection does not qualify. Source [`../FIX-1477/DECISIONS.md#d4`](../FIX-1477/DECISIONS.md#d4) | **Retained and applied** to a seat hired from the rail | The rule is the product owner's. A rail hire writes an org-visible roster row because the rule says a member of the organization sees its workers unless they are user-scoped — so the row's visibility is derived, not decided afresh | [E1](DECISIONS.md#e1) | Additive. The roster collection's read declaration and `expose` are unchanged |
| **FIX-1477 `PLAN.md` → Blocked on** — the shell's session cannot be bound to a viewer's organization, so in a deployment configuring operator tokens the panels render **correct and empty**; the binding belongs to FIX-1503. Source [`../FIX-1477/PLAN.md#blocked-on`](../FIX-1477/PLAN.md#blocked-on) | **Amended in its consequence, not in its cause** | The cause is unchanged: there is still no viewer credential, and a session still binds to `ctx.principal?.orgId ?? DEFAULT_ORG_ID` (`packages/engine/src/routes/session-routes.ts:285`). What changes is what that costs: because this issue's hire resolves the organization by the same path as its reads, the two can no longer disagree, so the failure mode stops being *empty with no reason* and becomes *a different organization, named* | [D1](DECISIONS.md#d1), [PLAN.md → Blocked on](PLAN.md#blocked-on), BR-4 | The limit narrows; nothing that relied on the old behaviour breaks. FIX-1503 still removes it entirely |
| **FIX-1475** — a runtime hire is stored in the hired-roster collection and read back at the next boot; the door in front of it is the **app's** to write and guard, and `workforce-admin` is a worked example rather than something the framework ships (`apps/docs/docs/workforce/durable-hire.md`) | **Retained**; its BR-35 is recorded as overtaken in code ([below](#br35-overtaken)) | The stored contract is untouched — same collection, same `create()`-as-duplicate-refusal, same compensating delete, same registration order | [D1](DECISIONS.md#d1)'s *What this is not* | `workforce-admin` is not touched by this issue |
| **FIX-1525 / FIX-1526** — `createSeatHireCapability` puts `hire` and `fire` on a worker kind's catalog, writing the roster and `inventory/seats/*`, and Discover lists a runtime hire by joining the two (merged in [#2079](https://github.com/fixpoint-labs/flow-state-dev/pull/2079)) | **Retained and extended additively** | The package already owns a durable-hire sequence the owner ratified. The rail reuses it rather than adding a third; the only change is a model-free export of the same handlers, with the capability's behaviour byte-for-byte unchanged | [E1](DECISIONS.md#e1), [PLAN S1](PLAN.md#surfaces) | Additive export. The capability's tests pass unedited (PLAN V1) |

<a name="amendment-option-c"></a>
## Amendment after merge — the owner decides C, and the tree has moved

**The decision.** On 2026-09-23 the product owner closed this spec's one open fork as candidate
C: the seat detail ships what has a browser-readable source, and a seat's skills, its channels and
their boards move to [FIX-1539](https://linear.app/fixpoint-labs/issue/FIX-1539). That is
[D5](DECISIONS.md#d5). FIX-1539 relates to this issue, sits outside the FIX-1455 epic, does not
block it, and carries the FSD Architect's four fences for a read model.

**What moved to FIX-1539 with it.** D2 (a seat's skills) and D3 (the inventory as
browser-readable data); surfaces S2 (the inventory's read declarations) and S6 (`topicPrefix`
through the panel read, which served only the channels section); checks V4 – V8; and rules BR-6
– BR-10, BR-21 – BR-23, BR-25, BR-26 and BR-28. S3 and S4 stay struck. `VG` lost its board step.

**What the tree had changed under the plan**, found while re-deriving it against `origin/main`
`ffe2b6e26`:

- **The package already ships a hire sequence.** FIX-1525 and FIX-1526 put one behind
  `createSeatHireCapability`. The approved S1 — extract `workforce-admin`'s sequence into the
  package — would have made a third. [E1](DECISIONS.md#e1) reuses the package's instead, through
  one additive export. Two things about the capability made that an export rather than a
  one-line call: its handlers are local, and an action has no public way to mount them.
- **`workforce-admin` now writes user-owned rows** under a nested key the browser roster does not
  list (FIX-1529). A rail built on that shape would hire seats nobody could see in the rail.
- **C2 no longer holds.** The authoring-time claim of *exactly one* hire site is false — there are
  two — and the checker's re-run reports **zero**, because its predicate matches neither current
  spelling. A proximity check on a token (`registerFromRoster`) aged into a check that finds
  nothing while the claim it guarded became false.

**Instructions was verified before it was claimed, and only half held.** The first attempt at
this amendment stopped there. A hired seat's instructions are on its public roster row. A
file-declared seat's are in its flow's configuration, which no route publishes. So D5's
"kind and instructions" is written as kind for every seat and instructions for org-visible hired
seats, and the declared seat says so ([E2](DECISIONS.md#e2)).

**The PR plan went from four to three.** PR-B's surfaces all left; PR-A became the additive
export; PR-C lost its dependency on PR-B, because the roster is already browser-readable. The
four-PR decision was made for the old scope and did not carry.

<a name="br35-overtaken"></a>
## FIX-1475's BR-35 — overtaken in code, not dissolved

**What BR-35 decided.** *"A seat is hired at runtime → it gets **no live-inventory row**. The
roster (`workforce/roster/*`) and the inventory (`inventory/seats/*`) are two contracts: the
inventory never deletes a row, a roster must."* Its reasoning: writing both makes a fire remove
one and leave the other, and *"a reader could not tell which answer was current"*.

**What shipped instead.** The seat-hire capability from FIX-1525 and FIX-1526 writes an inventory
row on every hire, and its `fire` deletes the roster row and leaves the inventory row — exactly
the split BR-35 warned about. This is tracked as
[FIX-1540](https://linear.app/fixpoint-labs/issue/FIX-1540).

**Why nobody sees it yet.** Discover's seat source joins the inventory with the declared side —
the file tree and the live roster row — so a fired seat drops out of Discover
(`packages/workforce/test/seat-hire-capability.test.ts:359`). No shipped surface reads the
inventory collection directly. The stale row is a trap for the first one that does, which is why
it is FIX-1539's third fence as well as FIX-1540's defect.

**What this issue does and does not do about it.** It adds no inventory write of its own, and
[D5](DECISIONS.md#d5) puts no inventory read in front of a person. But the rail's hire runs the
capability's sequence, so a rail hire writes an inventory row too, and a later `fire` through
the export would leave it. The conflict is not dissolved by C. It is inherited, stated, and
fixed where it is tracked.

**Not superseded, and not a lineage claim:**
[FIX-1476](https://linear.app/fixpoint-labs/issue/FIX-1476)'s channel-kind and `CHANNEL.md`
contract, [FIX-1405](https://linear.app/fixpoint-labs/issue/FIX-1405)'s inventory and
[FIX-1367](https://linear.app/fixpoint-labs/issue/FIX-1367)'s `WorkerConfig` admission are
**dependencies this design consumes as they are**, and none of them is amended here.

<a name="v15"></a>
## What this spec dropped in review

**V15 — the authoring-time evidence checker as a standing CI check.** The first draft's plan
required [`poc/evidence/check.mjs`](poc/evidence/README.md) to stay green, which made a spec
directory the home of live CI machinery. It was dropped on **BP-037**: a spec directory is
retained *design history*, and a check parked in one becomes something every future
`packages/workforce` contributor maintains from a folder they have no reason to open.

The replacement proposed in review did not work, and the follow-up says why: a `workforce` test
asserting that named collections declare a read would cover only the collections it already
names — which is precisely the failure C1 exists to catch. These collections are built inside
factory functions, so a standing totality assertion has to enumerate from **source**. The
checker's re-run at the amendment proves the point: it already finds a collection nobody
classified.

<a name="unchecked-falsifiability"></a>
## A defect class this epic has now produced twice

**A falsifiability claim that was itself never checked.** Both instances were found in review, not
by the mechanism each was supposed to be.

| Instance | The claim | What was true |
|---|---|---|
| FIX-1477's corpus checker | A planted file would be rejected | A subtree rule absorbed it, so the assertion silently passed the exact case it existed to catch — *inside* the assertion |
| This spec's `poc/evidence/check.mjs` | "Each assertion has a negative control that must be seen to fail (`--plant`)" | Only **C1** had one. `--plant` plants a collection and its failure message names C1 alone; C2 and C3 had no red path at all |

The second is the sharper one: it appeared **in the artifact whose entire purpose was to stop
hand-derived claims from going unchecked**. Building a checker does not exempt the checker's own
claims from tenet 7.

<a name="retraction-sweep"></a>
### The variant: a correction written as a note does not retract the claim, and a sweep for a spelling is not a sweep for a claim

**The rule, stated so it transfers:** *when you withdraw a claim, sweep for every place that
**asserts** it — not for the place that **explains** it.* A note recording a correction is
evidence that the correction happened; it is not the correction. The anti-addenda rule already
says a pivot gets the affected document re-drafted; this is its second half, one document over:
**the pivot also gets every document that depended on the withdrawn claim re-swept.**

**And the sweep itself has a failure mode, which is how this one survived two passes.** Both
passes searched for a *spelling* rather than for the *claim*. A withdrawn mechanism does not
repeat its own name: `SPEC.md` asserted a closed fork as **"Open: two … how the rail refreshes
after a hire"** and matched no search for the token `Open 2`; `DOCS.md` promised the struck
carrier as **"a seat's row now includes the names of the skills resolved for it"** and as a code
sample with a `skills` key, matching no search for `inventory row`. A file the grep returned clean
is not a file that is clean.

So the sweep is enumerated from the **claim**, in every phrasing it can take — the token, the
paraphrase, the code sample, the diagram node, the anchor text — and it covers **every document in
the spec**, reader-facing drafts and figures included.

**A third trap, once the fork closes:** a stale link to a *surviving* anchor still resolves. The
references to the closed refresh fork pointed at `#open`, which then held an unrelated question —
so a reader followed them and got a confident wrong answer rather than a dead link. Repoint, do
not merely leave.

The corollary that cost a round on its own: **C2's predicate was aimed at a neighbour of its
claim** — any `.create(` in a file that also mentioned `registerFromRoster`. Tightened at the
time; the amendment's re-run shows what a token-anchored predicate does when the code is
renamed around it.

Before implementation, compare these intents against current code and
`docs/architecture/*`: approved intent alone does not establish shipped behaviour.
