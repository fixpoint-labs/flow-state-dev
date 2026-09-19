# FIX-1407 · Decisions

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md)

The calls above any single issue: what was chosen, what lost, what each locks in. D1 to D5 are
**Architect locks carried into this document**, not calls taken here — FIX-1407's *FSD Architect —
EM guidance* section and each child's own fences are the source, and its **Still open** list stays
open except where the Architect has since closed an item himself ([D5](#d5)). [D6](#d6) is the one
call taken here rather than carried: the owner's, at the objective gate.

## The tree

```mermaid
flowchart TD
  E["FIX-1407"] -->|"kills the full cascade as the gate"| D1["D1 · the exit gate is one hop"]
  E -->|"kills W4 as a W3 floor child"| D2["D2 · soft-after for ship only"]
  E -->|"kills one noun for two registries"| D3["D3 · workers do, channels hold"]
  E -->|"kills the ambient transcript dump"| D4["D4 · the wire and the payload"]
  E -->|"kills a second index, and the fork between the layers"| D5["D5 · inventory is two layers"]
  E -->|"kills an epic that outlives its own gate"| D6["D6 · the set is five"]
```

Each edge names what the decision killed. The alternative that lost is in the card.

<a name="d1"></a>
## D1 · The W4 first cut is one hop: channel/org board → seat runs, and assign team seats

| | |
|---|---|
| **Instead of** | Making the full nested cascade — channel/org board → personal board → request board → seat — the exit gate |
| **Because** | The routing claim needs one hop to be true or false. A cascade proves the same thing three times and cannot be finished on a schedule, which is how an epic with a behavioural gate never closes |
| **Locks in** | Nested personal / request decomposition is **phase-2 inside W4**, promoted by a POC that proves need. What sits off the gate is FIX-1430's nested half, plus two issues that are no longer children at all ([D6](#d6)). Conversation, DM and transcript stay off the board — they belong to the inventory and ChannelFlow |

Off the gate was not free while FIX-817 and FIX-1415 were parented: a phase-2 child that is still
a child holds the epic's **wrap** open after the gate is met. [D6](#d6) is what closed that,
and it is why this card can be read on its own now.

<a name="d2"></a>
## D2 · W4 *ship* tickets are soft-after W3; W4 is not a child of W3

| | |
|---|---|
| **Instead of** | Nesting W4 under W3 · or letting a W4 ship PR merge onto a floor still being edited |
| **Because** | Every W4 child reads the file surface W3 is still closing. Nesting makes one epic that cannot wrap; ignoring the order lands a package format against a `tools:` fence and a `TEAM.md` layer that are still specs |
| **Locks in** | Filing, specs and **parallel POCs run now**. The fence lifts when **every W3 child that carries an implementation is merged to main**; children completed by decision, duplicated or cancelled do not hold it ([ER-14](BUSINESS-RULES.md)). Soft-after / soft-related in Linear, never parent |

<a name="d3"></a>
## D3 · Workers and seats *do*; channels *hold*. A board assignee key is not a Workforce seat

| | |
|---|---|
| **Instead of** | One noun for both — merging the board's assignee registry with the Workforce roster · or an assignable channel that claims work as an executor |
| **Because** | Different lifetimes, different identity rules. A board assignee is a key on a ledger; a seat is a roster slot that mints a flow instance. Collapsing them means every board row implies a hired seat, and every seat implies a board |
| **Locks in** | The two map **by composition**, per child. No assignable-channel routing, no channel-as-claim-worker, no second `WorkerRegistry`. `defaultWorker` and `assignTask` are composition, not new primitives. **Agent is an opinionated default kind**, not a Layer-1 substrate type, and there are no thin/fat seat labels |

<a name="d4"></a>
## D4 · Dispatch is the wire; handoff content is the payload policy — not competing forks

| | |
|---|---|
| **Instead of** | Choosing between "pass the parent session" and "pass a brief" · or a silent full parent transcript as the default |
| **Because** | One is mechanism, one is policy, and reading them as a fork is what produces both an ambient dump *and* a second runtime. A sub-agent is same-session background work with a different prompt; a worker assign is a roster seat in a **linked** session. Both need the link; only the second needs a payload rule |
| **Locks in** | Dispatch always passes `parentSessionId`; the child binds its parent **for life at mint**. Parent history reaches a child by **opt-in tools**, never an ambient dump, and a parent's private seat history never auto-bleeds. The default payload is the brief — `goal` / `constraints` / `acceptance` / `links` — plus channel transcript **only if both are on that channel**. **Shipped on FIX-1408**, as a decision rather than code |

**Linked is not nested.** A linked session is a sibling that names its parent. Nothing here
re-legitimizes nested, child or shadow sessions as a work hierarchy:
[FIX-1440](https://linear.app/fixpoint-labs/issue/FIX-1440) removed that substrate and FIX-1408
invent-kills its return. No child reads `parentSessionId` as a session tree.

<a name="d5"></a>
## D5 · Runtime inventory is **two layers**, and choosing between them is not a fork

| | |
|---|---|
| **Instead of** | A second `WorkerRegistry`, a mega-loader that re-walks the tree differently, or a Graft rebuild for membership and DM lookup — **and** treating read-time compose versus an org-scoped resource as a fork to pick one of |
| **Because** | They answer different questions. The declared tree is what the files say; the live set is what is actually open. A compose helper goes stale the moment a channel mints; a live resource cannot tell you about a seat nobody has opened. Picking one produces the other by accident, badly |
| **Locks in** | **Layer 1 — declared roster, composed at read time.** The duplicated private `LabRoster` in `goals/devforce-lab/lab/host.mts` and `goals/pentest-lab/lab/host.mts` becomes one package-level export over the three existing readers (`readWorkforce`, `readResourcesDirectory`, `readChannelsDirectory`) — derived per read, no state, registers nothing. Both lab copies deleted. FIX-1405, or a thin sibling, owns it. **Layer 2 — runtime inventory** (Jake's lock, 2026-09-16): ChannelFlow updates an org-scoped resource as seats and channels open. It stays FIX-1405's **primary** runtime shape for DM find-or-create, membership and fan-out **as inventory questions — who exists and is open**, and layer 1 does **not** replace it. It does **not** take over a channel's session-local `members` or its post-refusal fence ([ER-3](BUSINESS-RULES.md), [ER-12](BUSINESS-RULES.md)). `team.*` wildcards call layer 2 later, not at first ship |

**Compose is not a registry.** Layer 1 is a function over what the readers already return; the
invent-kill on a second index of truth ([ER-12](BUSINESS-RULES.md)) is unchanged by it. Layer 1's
**public export on `@flow-state-dev/workforce` is approved** — the owner's objective gate,
2026-09-19. FIX-1405 has since specified it as **`readDeclaredRoster(root)`** on
`@flow-state-dev/workforce/loader` (behind `./loader`, because the root is deliberately node-free):
it joins the three existing readers, walks nothing itself, **collects rather than throws**, and joins
the two layers on **`id` alone** — no mapping table, no second identity. That is the contract
[ER-23](BUSINESS-RULES.md) blocks FIX-817 on.

<a name="d6"></a>
## D6 · The set is five children; two related issues are re-homed rather than parented

| | |
|---|---|
| **Instead of** | Keeping all seven parented — an epic that meets its own exit gate and then stays open, indefinitely, on two children it does not need |
| **Because** | **The exit gate and the wrap are different moments.** The wrap term requires every child to be Linear-terminal, and a Backlog or Todo phase-2 child is not. An epic that cannot close after proving what it set out to prove has the wrong boundary — and both re-homed issues fence themselves off a ship by their own Architect sections anyway |
| **Locks in** | Five children: FIX-1394, FIX-1405, FIX-1385, FIX-1408 (done), and **FIX-1430 adopted as the proof**, which gives [ER-20](BUSINESS-RULES.md) its owner. FIX-817 and FIX-1415 are **related-not-child**, keeping their dependency on FIX-1405. Re-homing does not release them from this set's rules where they touch it: FIX-817 still waits for FIX-1405's approved spec ([ER-23](BUSINESS-RULES.md)), and neither may re-decide [ER-3](BUSINESS-RULES.md) |

**Re-homed is not descoped.** Both issues stay filed, keep their dependency edges, and are drawn
outside the set in [the graph](SPEC.md#how-the-issues-flow-into-each-other). What changed is which
epic's wrap they hold: none.

<a name="who-owns-what"></a>
## Who owns what

![Who owns what: a matrix of six cross-cutting rules against the five issues in the set. The board is the work plane is built by FIX-1385 and consumed by FIX-1430. One package format is built by FIX-1394 and consumed by FIX-1430. Inventory in two layers is built by FIX-1405 and consumed by FIX-1385. The wire and the payload is decided by FIX-1408 and consumed by FIX-1385, FIX-1394 and FIX-1430. Assignee is not a seat is decided by FIX-1385 and consumed by FIX-1394 and FIX-1430. The propagation pass inherited from the project as PR-5 is built by FIX-1385. Every rule has exactly one owner. A footnote records that FIX-817 and FIX-1415, related but not in the set, also consume inventory in two layers.](figures/ownership.svg)

Every rule has exactly one owner. Read a row to see where a decision is made, where it is built,
and where it is only consumed; a *consumes* cell is a place a child must not re-decide. FIX-1430
consumes four rows and owns none of them, which is what makes it a proof rather than a surface —
what it does own is [ER-20](BUSINESS-RULES.md), the epic's done-condition. The matrix covers the
five issues in the set; [FIX-817 and FIX-1415](SPEC.md#related-not-children) consume ER-3 from
outside it and may not re-decide it either ([D6](#d6)).

<a name="decided-in-review"></a>
## Decided in review, recorded so no child reopens them

**Round 1 · 2026-09-18**, five reviewers on
[#1905](https://github.com/fixpoint-labs/flow-state-dev/pull/1905).

- **The inventory is two layers, and the fork is dismissed** (Architect) → [D5](#d5),
  [ER-3](BUSINESS-RULES.md). Verified against the code first: `ReadWorkforceResult` is
  `{workers, errors, skillErrors}` only, the three readers are separate exports, and both labs
  hand-roll the same private `LabRoster` — so "one shared scan map" was intent, not an exported
  thing. The compose helper's public export stays on the owner's objective gate.
- **The W3 ship fence has one release condition** (Greptile P1). Three documents stated it three
  ways — *merges*, *no open children*, *close* — which diverge the moment a child closes by
  decision. Now stated once everywhere: every W3 child **that carries an implementation** is merged
  to main.
- **The proof consumes the package *contract*, not the implementation** (Greptile P1, sharpened by
  Codex). The FIX-1394 → FIX-1430 edge is non-blocking with the condition named
  ([the spec](SPEC.md#what-the-proof-consumes)). ER-2 still binds the proof: no third package shape.
- **FIX-1408's unclosed walls are owned, not orphaned.** Reuse-vs-create session policy, auto-scale
  / busy-copy, hire-or-dispatch-with-parent naming, which opt-in history packs are v1, and how a
  sub-agent's background work surfaces on a board row: **FIX-1394's POC owns the evidence, this
  epic owns the decision**. FIX-1408 is not reopened, and no child decides one locally
  ([ER-15](BUSINESS-RULES.md)). — **Narrowed to one wall on 2026-09-19**; see the ER-15 ruling
  below, which is what now holds.
- **FIX-1385 owns ER-19**, the project's PR-5 propagation pass — it mints the largest new Layer 2
  vocabulary surface in the set.

**Objective gate · 2026-09-19**, the owner, against the three-item ask on
[#1905](https://github.com/fixpoint-labs/flow-state-dev/pull/1905). Ratified as recommended:

- **The exit gate stands as one hop** — channel/org board → seat runs, assign team seats. The
  nested cascade is phase-2 inside W4 ([D1](#d1)).
- **The set is five, and FIX-1430 is the proof** ([D6](#d6)). FIX-817 and FIX-1415 are
  related-not-child with their FIX-1405 dependency preserved. **[ER-20](BUSINESS-RULES.md) now has
  an owner**; it is no longer the set's ownerless rule.
- **The compose helper's public export on `@flow-state-dev/workforce` is approved**
  ([D5](#d5), [ER-3](BUSINESS-RULES.md)). It was the one item D5 left on this gate. FIX-1405
  implementation now waits on its own spec, not on this.
- **The W3 ship fence stands as written** ([D2](#d2), [ER-14](BUSINESS-RULES.md)): it lifts when
  every W3 child **carrying an implementation** is merged to main. Children completed by decision,
  duplicated or cancelled do not hold it.

**ER-15 ruling · 2026-09-19**, the EM, on the FIX-1394 worker's escalation
([comment 5738870528](https://github.com/fixpoint-labs/flow-state-dev/pull/1905#issuecomment-5738870528)).
The worker raised it up rather than deciding locally, which is ER-15 working.

- **FIX-1394's POC keeps exactly one of FIX-1408's walls: *which opt-in history packs are v1*.** A
  history pack **is** a library package with opt-in attachment, so the package matrix already probes
  it and the evidence costs nothing extra.
- **The other four go back to the epic** — reuse-vs-create session policy, auto-scale / busy-copy,
  hire-or-dispatch-with-parent naming, and how a sub-agent's background work surfaces on a board
  row. They are session policy with **no package content in them**. Loading them onto a
  package-format POC is scope creep that leaves FIX-1394's probe set unfixable — which would
  make its spec unapprovable for the wrong reason.
- They are **parked visibly** in [Open](#open), not dropped. An unowned wall nobody can see is worse
  than one parked honestly.

**ER-3's two readings · 2026-09-19**, raised from FIX-1405 ([#1916](https://github.com/fixpoint-labs/flow-state-dev/pull/1916)) rather than decided locally
— ER-15 working again. Ruled by the EM
([comment 5738908078](https://github.com/fixpoint-labs/flow-state-dev/pull/1905#issuecomment-5738908078)) and confirmed by
the Architect, whose rule it is ([comment 5738911437](https://github.com/fixpoint-labs/flow-state-dev/pull/1905#issuecomment-5738911437)).

ER-3's sentence admitted two readings: **(a)** a contrast with the declared tree — those questions
are not answered from the file tree — or **(b)** an instruction to relocate ChannelFlow's post
fence onto an org resource. **(a) is the rule; (b) was never the intent.**

A channel's `members` is already live: written at open, read on the refusal path, in the same
session the post lands in. Reading (b) would put one fact in two places and tax every post with a
second lookup for something the channel already knows. **ER-3 is now worded so only (a) survives**,
and [ER-12](BUSINESS-RULES.md) carries the matching invent-kill — the ruling lives in a comment, but
a child reads the document.

**What would flip it:** evidence that a channel's `members` is *not* current on the refusal path —
that some path posts without the channel's own membership being authoritative. A factual question,
not a taste one. **What being wrong costs:** FIX-1385 rewrites rather than adjusts, which is why
this sits on the epic surface with the reasoning exposed.

## What the end-state POC showed

**None built.** The division into issues came from the Architect's ownership carve rather than a
sketch, and three of the five children are themselves POC-first. The gate approved the division
without one. The question a POC would still answer, if the first-cut specs make it worth asking, is
whether the package format and the board's assign surface are really two issues.

<a name="open"></a>
## Open

**The set question is closed** — seven children or five was this document's one open ask, and the
owner closed it at the objective gate on 2026-09-19 as [D6](#d6). The compose helper's public
export closed with it ([D5](#d5)). What is open is the four walls below.

### Four of FIX-1408's walls, returned to the epic

*(Decides: the epic, as EM calls, on evidence. Blocks: nothing today. Bites: the first child that
builds over the wire — which is FIX-1385.)*

| Wall | What it decides | What would settle it |
|---|---|---|
| **Reuse-vs-create session policy** | Whether assigning a seat that is already running reuses its session or mints a second | FIX-1385's first real assign, where the choice becomes visible. Also on the Architect's Still-open list ([ER-13](BUSINESS-RULES.md)) |
| **Auto-scale / busy-copy** | Whether a busy seat gets a second copy under load, or work queues on the board | The proof (FIX-1430) running a queue deep enough to make it matter |
| **Hire-or-dispatch-with-parent naming** | What the call that mints a linked child is *called*, given [D4](#d4) already fixed what it does | FIX-1385's board → seat call site, which is the first place a name is read by someone who did not write it |
| **How a sub-agent's background work surfaces on a board row** | Whether same-session background work is visible on the row at all, and as what | FIX-1385, which owns the row ([ER-1](BUSINESS-RULES.md)), with [ER-11](BUSINESS-RULES.md) binding: a view, never a new status |

**Why they are parked rather than asked.** None of them is a business call — they are engineering
choices the objective already constrains, and three of the four are answered by building FIX-1385
rather than by deciding in advance. **What being wrong costs:** if they are still open when
FIX-1385 reaches its assign surface, that child either stalls on an epic question or decides one
locally, which is exactly what [ER-15](BUSINESS-RULES.md) forbids. Settle them on FIX-1385's spec
review at the latest.

What stays open is *not* a decision this epic owes: the Architect's **Still open** list
([ER-13](BUSINESS-RULES.md)) — exact package schema, reuse-vs-create, nested cascade timing, how
many POCs before a ship cut. Those close with the owner, on the evidence FIX-1394's POC matrix
produces, and no child closes one locally ([ER-15](BUSINESS-RULES.md)).
