# FIX-1500 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

Four retained predecessors, and this issue amends a part of each rather than replacing any. None
is superseded: all four shipped contracts this design composes.

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| **FIX-1477 D4** — a hired roster and a channel board are ordinary in-organization data, so the panels read them directly; the axis is the resource's **scope**, and a user-scoped collection does not qualify. Source [`../FIX-1477/DECISIONS.md#d4`](../FIX-1477/DECISIONS.md#d4) | **Retained and applied** to a seat hired from the rail | The rule is the product owner's. A rail hire writes an org-visible roster row because the rule says a member of the organization sees its workers unless they are user-scoped — so the row's visibility is derived, not decided afresh | [E1](DECISIONS.md#e1) | Additive. The roster collection's read declaration and `expose` are unchanged |
| **FIX-1477 `PLAN.md` → Blocked on** — the shell's session cannot be bound to a viewer's organization, so in a deployment configuring operator tokens the panels render **correct and empty**; the binding belongs to FIX-1503. Source [`../FIX-1477/PLAN.md#blocked-on`](../FIX-1477/PLAN.md#blocked-on) | **Amended in its consequence, and, for kitchen-sink, in its cause** | There is still no viewer credential, and a session still binds to `ctx.principal?.orgId ?? DEFAULT_ORG_ID` (`packages/engine/src/routes/session-routes.ts:300`). What changed first is what that costs: this issue's hire resolves the organization by the same path as its reads, so the two can no longer disagree, and the failure mode stops being *empty with no reason* and becomes *a different organization, named*. What changed second is the principal itself. Under [D6](DECISIONS.md#d6), kitchen-sink's host names one organization as the fallback for every flow without a resolver of its own, which includes the shell's, so the shell's session is no longer on the default one | [D1](DECISIONS.md#d1), [D6](DECISIONS.md#d6), [PLAN.md → Blocked on](PLAN.md#blocked-on), BR-4 | The limit narrows. A persistent store written before PR-B is wiped, not upgraded (BR-34). FIX-1503 still removes the limit entirely |
| **FIX-1475** — a runtime hire is stored in the hired-roster collection and read back at the next boot; the door in front of it is the **app's** to write and guard, and `workforce-admin` is a worked example rather than something the framework ships (`apps/docs/docs/workforce/durable-hire.md`) | **Retained**; its BR-35 is recorded as overtaken in code ([below](#br35-overtaken)) | The stored contract is untouched — same collection, same `create()`-as-duplicate-refusal, same compensating delete, same registration order | [D1](DECISIONS.md#d1)'s *What this is not* | `workforce-admin`'s sequence, rows and fail-closed registration are not touched. Its **organization is pinned** to kitchen-sink's by PR-B ([below](#amendment-named-org)) |
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

<a name="amendment-named-org"></a>
## Second amendment after merge: kitchen-sink runs as one named organization

The original review is [#2111](https://github.com/fixpoint-labs/flow-state-dev/pull/2111), and
before it [#2061](https://github.com/fixpoint-labs/flow-state-dev/pull/2061). This amendment is a
new PR from `main`. It does not reopen either.

**Why.** The spec said that in a deployment that authenticates nobody, the app can hire (D1 →
*Locks in*, and the deployment table in PLAN → *Blocked on*). That was false. With no resolver,
every session binds to the framework's development organization, and `seatAddress` refuses that
organization's id as the first segment of an address. So every hire in kitchen-sink, through
the rail's door or through mara's tools, was refused before anything was written. FIX-1527's
POC found it (its P2 and leg R). The published `durable-hire.md` already says so.

**The decision.** On 2026-09-24 the product owner chose A: kitchen-sink runs as one named
organization, set by host code and never read from the caller. The alternatives were B, keep the
development organization and let hires refuse, and C, wait for FIX-1503. The decision is the
epic's, [FIX-1455 D9](../../epics/FIX-1455/DECISIONS.md#d9). This spec records it as
[D6](DECISIONS.md#d6), with the mechanism and the POC. It fits D1's existing *what would change
my mind*.

| What | Treatment | Evidence |
|---|---|---|
| D1: one door on the rail's own flow, and one organization for hire and read | **Retained.** Its *Locks in* is **amended**: an anonymous visitor to a deployment can hire into, and through mara hire and fire in, the one named organization. The organization is no longer the development one, where nothing could be hired | [`poc/named-org/`](poc/named-org/README.md) N1, N2 |
| D5 and E1, E2 | **Retained** unchanged. D2 and D3's stubs are **folded into D5**, and their anchors now land on D5 | — |
| PLAN PR-B, empty since D5 | **Superseded** by a new PR-B: the host-level resolver (S10). PR-A and PR-C are shown **merged**. PR-D now depends on PR-B only, because FIX-1477 PR-C merged in #2113 | [PLAN → PR plan](PLAN.md#pr-plan) |
| PLAN's struck rows (S2 to S4, S6, V4 to V8, V13, V15) | **Removed from the live tables.** What moved and why is still [above](#amendment-option-c) and [below](#v15) | — |
| S7 and S8 | **Amended.** One roster key on the rail's flow, the shared `kitchenSinkSeatHireOptions`, and an `unregister` guarded by `isFromRoster` | POC's first run (resource collision), N6 |
| DECISIONS → Settled, the `ctx.org` row | **Amended** from *"read by one author, not executed"* to executed. Its clause *"including an unauthenticated session on the default one"* was true of the binding and false of the hire | N1, N2, and the split control |
| BR-1, BR-3, BR-4 | **Amended** to the named organization. BR-33 and BR-34 are **new** | N1 to N5, N8 |
| DOCS → *Which organization a hire lands in* | **Amended** to match the page PR-A published. A kitchen-sink README operation is **new** | `apps/docs/docs/workforce/durable-hire.md` → *Which organization a hire lands in* |

**Claims withdrawn, swept by claim and not by spelling** ([the rule](#retraction-sweep)). The
sweep covered "default org", `DEFAULT_ORG_ID`, `__fsd_default_org__`, "can hire", "authenticates
nobody" and "no viewer identity", in every document and the figure:

- DECISIONS → D1 *Locks in*: "In a deployment that authenticates nobody, the app can hire."
- DECISIONS → Settled: "… including an unauthenticated session on the default one."
- SPEC → the people table: "With no viewer identity that organization is the default one."
- SPEC → Sign off, D1's *If wrong*: "anybody who can open the app can hire a seat into the default
  organization."
- BUSINESS-RULES → BR-1: "It binds to the default organization, and every read and every hire
  the rail makes uses that one." BR-4: "The rail still hires and reads the default organization."
- PLAN → *Blocked on*: "A clone with no operator tokens · The whole spine works. Hire and read are
  both the default organization," and "Operator tokens configured · … on the default
  organization."
- DOCS → *Which organization a hire lands in*: "… or the default organization when the flow
  authenticates nobody."
- `figures/one-org.svg`: "With no viewer identity configured that organization is the default
  one."
- EVOLUTION → the FIX-1477 row: `session-routes.ts:285` is now `:300`.

**What the POC changed besides confirming the direction.** It found four things, and each moved a
surface. The user has to be a constant as well as the organization (N7). A store written before
PR-B fails the first boot after it (N8). The rail's flow cannot declare the roster under two
keys. And `fsdev run` never reaches the app's resolver.

<a name="named-org-review"></a>
**Review of this amendment (Codex, on #2137 at `935741156`).** Three findings, all folded. None
changes D6's direction.

| What | Treatment | Why |
|---|---|---|
| D6 and E3's "every flow resolves through it" | **Amended** to say precisely what is meant. The named organization is the host's **fallback** for every flow without a resolver of its own. The two exceptions are named, with why neither splits D1: the rail's hire and read both take the fallback, and `weekly-digest` never hires or reads the roster. Epic D9's heading gets the same precision fix | A reader could take "every caller" literally, and the operator's door is a caller |
| `workforce-admin`'s organization, which this amendment first left alone ("does not move") | **Superseded.** PR-B accepts only `WORKFORCE_ADMIN_TOKENS` entries that name `KITCHEN_SINK_ORG_ID` (S10, V22, BR-4). FIX-1475's two-customer example (`acme`, `bravo`) goes for this app | Today a token binds to whatever organization its entry names (`apps/kitchen-sink/lib/workforce-admin-auth.ts:82`, `:150`), and the README's example is `acme`. Its `fire` would miss every rail and mara hire (POC N5's red) |
| V19, "the boot completes" | **Amended.** After the first named-org boot over a pre-change store, every file-declared channel is bound to the named organization and readable through the router. A boot that swallows the 403 fails | The old wording passed an implementation that hides the failure |
| BR-34, and what happens to earlier conversations | **Amended into an open owner question**, [H1](DECISIONS.md#h1). The recommendation is to leave history behind | Whether history carries over is a product call, and the spec does not decide it |
| DOCS, the kitchen-sink admin paragraph | **Moved.** The sentence saying an admin fire releases rail and seat-tool hires now ships with PR-D. PR-B keeps only the pinned-token paragraph | A README sentence should not ship before the path it describes |

<a name="amendment-wipe-store"></a>
## Third amendment after merge: a pre-change store is wiped, not upgraded

**The decision.** On 2026-09-24, reviewing PR-B, the product owner wrote in [the owner's review comment on #2159](https://github.com/fixpoint-labs/flow-state-dev/pull/2159#discussion_r4097667270):
*"Lets not do this, lets just wipe everything and start from fresh. On next upgrade any dev can
just wipe their .fsdev directory and start fresh."* PR-B had built an upgrade step. It moved each
old channel session, with its requests, out of the channel's id and reopened the channel under
`kitchen-sink`. That step is removed.

| What | Treatment | Why | What is retained |
|---|---|---|---|
| [H1](DECISIONS.md#h1): carry earlier conversations over, or leave them behind | **Superseded** by the owner's answer: wipe the store. No upgrade path | Kitchen-sink's persistent deployments are the team's own. An upgrade step is code nobody copies, and review found a concurrency hazard in it | The question and its recommendation, kept under H1 for the record. Its answer not to migrate history still holds |
| BR-34: the first boot over a pre-change store completes, with every channel open and readable under `kitchen-sink` | **Superseded.** The boot refuses to start, names each channel stored under another organization, and says to delete the store | A boot that quietly works over records it cannot read is the failure the old V19 guarded against. A boot that stops and names the fix avoids it without a migration | That the bare 403 is never the answer, and that the error is never swallowed |
| V19 | **Amended** to the guard: an error naming the channels and the fix, nothing moved, and a clean boot once the store is deleted. The red state is the bare 403 | Follows from BR-34 | The pre-change boot over the same location, as the test set-up |
| SPEC → *Sign off*, D6's cost of being wrong, Settled's N8 row, PLAN S10 | **Amended** to "wiped, not upgraded" | They described the upgrade step | — |
| DOCS, the kitchen-sink README | **New** PR-B operation: wipe the store after upgrading | A developer needs to know before their boot fails | — |

<a name="amendment-seat-pane"></a>
## Fourth amendment after merge: a seat's details open from the row's action

**Why.** PR-D ([#2193](https://github.com/fixpoint-labs/flow-state-dev/pull/2193), merged)
built S8 by drawing the seat pane (`SeatDetail` and the "Hire another" form) in
`FlowNavigator`'s `leafToolbar`. FIX-1561's approved spec then made that slot draw on the leaf's
own row, as actions shown on hover or focus ([FIX-1561 D1](../FIX-1561/DECISIONS.md#d1)), and its
guardrail adds no new slot. Together they put a form on a 256px row: the seat row overflowed the
rail and FIX-1561's goal checks failed.

**The call.** On 2026-09-24 the epic coordinator took option A as an engineering call. The owner
can redirect it. The seat row keeps one icon action in `leafToolbar`, and that action opens the
seat's details and the hire form outside the row, in a popover or the right-hand panel. The
implementation lands in [#2203](https://github.com/fixpoint-labs/flow-state-dev/pull/2203).
Option B, a navigator slot for content inside an open leaf, was rejected: it re-opens FIX-1561 D1
and adds published API.

| What | Treatment | Why |
|---|---|---|
| PLAN S8: "a seat row opens `SeatDetail`" | **Amended.** The row's one action opens the details and the hire form outside the rail row. The old wording is kept under [E4](DECISIONS.md#e4) | `leafToolbar` no longer has room for a pane |
| PLAN VG | **Amended in its steps only.** The seat's details are reached from its row action. The assertions stand: instructions from the collection route, no reload, the hired seat listed, the conversation untouched | Only where the details open has moved |
| DECISIONS | **New** [E4](DECISIONS.md#e4), and option B in *Considered and dropped* | Engineering call, recorded where the others are |
| SPEC's hire illustration, DOCS' rail paragraph | **Amended** to say the details open beside the rail | They drew or described the detail inside the row |
| D1, D5, E2, and every rule | **Retained** unchanged | What a seat shows and where it is read from do not move |

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
