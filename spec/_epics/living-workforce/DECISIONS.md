# FIX-1457 · Decisions

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md)

The calls that sit above any single issue in W5: what was chosen, what lost, and what each locks in
for the children under it. Two of them ([D2](#d2), [D4](#d4)) are on the sign-off surface with the
done-condition fork; [D3](#d3) is **consumed from W4 with no re-gate** and [D5](#d5) is **recorded
news, not an ask**. The exploration's walls are open by instruction, except where one binds a
downstream child ([ER-18](BUSINESS-RULES.md)).

**[D2](#d2) was flipped by the owner on 2026-09-20**, after the objective gate had already ratified
the old answer. The card below carries both the superseded lean and the one that replaces it, and
**the objective gate is therefore re-taken on this version** — D2 is a live ask again, not settled.

## The tree

```mermaid
flowchart TD
  E["FIX-1457 · W5"] --> D1["D1 · a put-it-together epic, not new substrate"]
  D1 -.->|"rejected"| X1["a fourth substrate epic · new L1 for human / team / channel"]
  E --> D2["D2 · the work plane changes; the org chart stays<br/>supersedes the seat-drain lean, Sep 20"]
  D2 -.->|"rejected"| X2["a person as a drain seat · a parallel HITL plane · ambient tools with no org identity"]
  E --> D3["D3 · assignee stays a drain key · no new status enum"]
  D3 -.->|"rejected"| X3["assignee equals seat · an L1 TaskStatus for Waiting-on-you"]
  E --> D4["D4 · explore now, ship after W4 first cut"]
  D4 -.->|"rejected"| X4["nest W5 under W4 · or hold the exploration too"]
  E --> D5["D5 · start as the fourth active epic"]
  D5 -.->|"rejected"| X5["force an epic to wrap to free a slot"]
```

<a name="d1"></a>
## D1 · W5 is a put-it-together epic on Workforce L2, not a fourth substrate epic

| | |
|---|---|
| **Instead of** | A fourth substrate epic that adds the L1 a composition turns out to want · or a second Collab epic dressed as W5 |
| **Because** | The feature-complete bar is W3 closed, W4 first cut shipped, org never optional, and Labs running without special wrappers. That bar is a claim about what already exists. A fourth substrate epic would move the bar instead of testing it, and nothing would ever have proved the first three |
| **Locks in** | Every child composes existing pieces. A child that finds it needs new L1 has found a **gap in W3 or W4**, and comments up on this PR rather than building it here ([ER-5](BUSINESS-RULES.md), [ER-17](BUSINESS-RULES.md)) |

**What would change my mind:** the exploration finding that a parked row cannot carry an audience
that derives to a principal, or that no existing action surface can take a person's answer back into
the flow. Then W5's first spine point is substrate work and belongs in a W4 follow-on, not here.

<a name="d2"></a>
## D2 · The work plane changes; the org chart stays

> **Flipped on 2026-09-20.** This card used to read *"a person occupies the same seat slot an agent
> does"* — a person as a board drainer, differing from an agent only in drain UX. The owner
> **superseded that lean** in session on 2026-09-20, after the objective gate had ratified it. What
> follows is the replacement, and it is why the gate is being re-taken.

| | |
|---|---|
| **Instead of** | **The superseded lean** — a person as a drain seat, claiming and draining board rows beside the agents · HITL as ambient approval tools with no org identity · a parallel human work plane beside boards and seats · human-only side boards agent seats cannot see |
| **Because** | A task already needs human review **while a non-human owns the work**, and even when a person supplies something, the system still has to know what to do with it — **the flow owns the machine**, not the person. People realistically drive through actions, not by draining a queue. So the **work plane** is what changes, and the **org chart** is what survives |
| **Locks in** | A **non-human seat owns the task** and **parks it with a reason** when it needs human input. The human acts through **flow actions bound to a principal** — approve, provide input, unpark — and the flow decides what that input *means* and continues. **Humans are not board drainers.** Audience derives **parked row → desk → principal**, or an explicit review audience → principal. One place lists people alongside agent seats (inventory / members / principals) with a **durable bind**, so a redeploy does not forget who owed a sign-off. `flow: human` as a drain kind is **optional Lab chrome, not the W5 spine**. **Multi-human** is *who may call which actions* plus channel membership — never humans racing each other as drainers |

**What would change my mind:** the exploration finding that a principal-bound action cannot carry
enough for the flow to continue from — that a person's answer needs a worker's whole turn rather
than an action's input. Then the drain seat is back, and so is the superseded lean.

<a name="d3"></a>
## D3 · Board assignee stays a drain key, and no L1 enum grows for a human's state

| | |
|---|---|
| **Instead of** | Collapsing board assignee and the Workforce seat registry into one noun · adding `waiting_on_you` and `idle` to L1 `TaskStatus` |
| **Because** | The assignee is *who a row drains to*; the seat is *who exists on the roster*. They resolve to each other and are not the same thing, and a merge is irreversible in a way neither is on its own (the W4 invent-kill stands). **Waiting on you** is already expressible — parked, with a reason and an audience — and **Idle** is seat/session runtime, not a property of the work. A status enum mirroring a UI's columns is a UI leaking into L1 |
| **Locks in** | The Waiting-on-you story is a **view** over existing status plus seat runtime. Any child that finds itself wanting a new status value has hit a cross-cutting question, not a local one ([ER-8](BUSINESS-RULES.md)) |

<a name="d4"></a>
## D4 · Explore now; ship after W4's first cut

| | |
|---|---|
| **Instead of** | Nesting W5 under W4 and starting nothing · or holding the exploration along with the ship work |
| **Because** | W5 is a **sibling** of W4, not a child: the W3→W4→W5 chain is a sequence of outcomes, not a containment. Ship work composes the W4 first cut, so building it against a floor still in motion means rebuilding it. The **exploration** composes nothing — it produces a shape — so holding it buys nothing and costs a cycle |
| **Locks in** | **The ship fence, defined here once and linked everywhere else.** FIX-1458 runs now; FIX-1455 and the assemblies cut may not *start* ship work until the W4 first cut lands. It is a fence on starting, not a dependency edge a child can satisfy early, and it lifts on an event in another epic — nothing a child here does can lift it ([ER-10](BUSINESS-RULES.md)) |

<a name="d5"></a>
## D5 · W5 starts as the fourth active epic, against a cap of two

| | |
|---|---|
| **Instead of** | Forcing W3 ([#1718](https://github.com/fixpoint-labs/flow-state-dev/pull/1718)), W4 ([#1905](https://github.com/fixpoint-labs/flow-state-dev/pull/1905)) or LAB-162 ([#1612](https://github.com/fixpoint-labs/flow-state-dev/pull/1612)) to wrap to free a slot |
| **Because** | The board was already at three open epic PRs against a cap of two when W5 was opened. The owner chose the breach on 2026-09-19 rather than wrap an epic early — W5's live work this cycle is a **single exploration**, which is close to free, and forcing a wrap would have cost real closure quality on an epic that isn't finished |
| **Locks in** | The cap is knowingly breached, not forgotten. If W5 ship work starts before two of the four wrap, that is a **second** decision and this card does not cover it. It binds no child and drives no ER — it is here as the record, and it is **not** on the sign-off surface |

## Who owns what

![Who owns what: a matrix of five cross-cutting rules against the three rows of the set — FIX-1458, the held child epic FIX-1455, and the unfiled assemblies row. Four rules have one committed owner; the done condition has a provisional owner in FIX-1455 and moves to the assemblies row if that row is cut. The figure's aria-label carries every cell and the count of the sixteen rules that sit outside the matrix.](figures/ownership.svg)

Four of the five rules in the matrix have one committed owner. The fifth — **ER-19, the done
condition** — has a **provisional** one: FIX-1455, unless the assemblies cut says otherwise, which
is why its cell is drawn dashed and why ER-4 carries the same conditional. Provisional is not
committed, and it is [Open 3](#open) — still the thing about this set most worth arguing with at the
gate. A *consumes* cell is a place a child must not re-decide.

**Five rules need a column; the other sixteen don't** — ten prohibitions, four run-the-set rules and
two further proofs bind every row equally, so the matrix leaves them out.

## Decided in review, recorded so no child reopens them

**Round 1 (2026-09-20)** — four reviewers on head `1d9218e`.

- **ER-19 gets a provisional owner rather than none: FIX-1455, unless the assemblies cut says
  otherwise**, and ER-4 travels with it. The collapse path had no defined owner, so a coordinator
  could not tell whether to file assemblies work or wrap on FIX-1455. W4's ER-20 → FIX-1430 sets the
  precedent. **The row itself is not pre-empted** — collapsing the set to two children was proposed
  and **rejected** the same round, because the evidence that would decide it does not exist yet.
- **An exploration may not exit with a wall open that a downstream child needs**
  ([ER-18](BUSINESS-RULES.md)). No conflict with *keep the opens open*: that guards the **assemblies
  cut**, not a prerequisite reporting complete while the contract it supplies is undecided. The
  clause stands as round 1 wrote it; **which two walls it names changed with the D2 flip** — see
  [Open](#open).
- **ER-19 now requires org-bound execution**, which the objective promises and the old condition
  could be satisfied without.
- **ER-20 gains a wrap-time sweep of the shipped child diffs.** A spec-time check cannot see a child
  that ships what its spec never claimed, and invent-kills are this epic's core fence.
- **D5 is news, not an ask.** `SPEC.md` carried it as a fourth sign-off item while the PR body
  correctly listed it as not-asked. The two surfaces disagreed; `SPEC.md` was the wrong one.

## What the end-state POC showed

**None was built, and that is a decision rather than an omission.** FIX-1458 *is* the humans-in-seats
exploration: an epic-altitude end-state POC would build the same thing one altitude up, a week
before the child that owns it starts, and against a W4 floor still in motion. The question an
end-state POC answers — *does the division into issues hold once it's all there?* — is also not
answerable yet, because the third row's division is precisely what is undecided ([Open 3](#open)).
**Revisit when** the assemblies cut is made: that is the moment the division becomes a real claim
and a rough end-state could falsify it.

## How it got here

- **Drafted (Sep 19)** — from Jake's three-point spine, the Cycle PM stamp and the Architect EM
  fences on FIX-1457, all locked input. Two children filed, one spine point uncut. D5 records the
  epic-slot breach the same day.
- **Review round 1 folded (Sep 20)** — greptile, cursor, codex and `second-look` on head `1d9218e`.
  ER-19 gained a provisional owner and org identity, ER-18 a downstream-blocking clause, ER-20 a
  wrap-time check; the sign-off surface dropped to three live asks. The objective did not move.
- **Objective gate taken, then D2 flipped (Sep 20)** — the owner approved the set in the morning and
  **superseded D2 the same day**: the work plane changes, the org chart stays. Not a review round
  and not review feedback. It moved ER-1, ER-2's wording, ER-3, ER-6, ER-18's two named walls, ER-19
  and ER-21, both the box and ownership figures, and the manager-queue seam. **The gate is re-taken
  on this version**; nothing about the assemblies cut, D1, D3, D4 or D5 moved with it.

<a name="open"></a>
## Open

Three, plus the exploration's own walls. (Old Open 1 — *nothing names the proof surface* — is
answered provisionally above; its committed form is now Open 3.)

1. **Whether the kitchen-sink rebuild *is* spine point 3.** If it is, the assemblies row closes and
   W5 is two children. The locked input leans this way and stops short of saying it, and round 1
   declined to pre-empt it.
2. **The assemblies child cut.** Locked as *"exact child cut for assemblies after W4 first-cut
   lands"* — deliberately open, not a gap in this document.
3. **Whether ER-19's provisional owner becomes the committed one.** FIX-1455 holds it today; the cut
   either confirms that or moves ER-19 and ER-4 to the assemblies row.

**The exploration's four walls**, re-cut by the D2 flip, are FIX-1458's to lean on and not this
document's to close:

1. **The principal bind and action authorization** — what binds a person in the org chart to a
   principal, and **which principals may call which actions** on a parked row.
2. **What a redeploy must round-trip** for that bind to survive — principal / member identity, not
   a seat's whole settings bag.
3. One person ↔ many desks and memberships.
4. Whether channel members *are* principals, or may be unbound.

Exploration may lean; **no wall closes without the owner**.

**Walls 1 and 2 are the downstream-blocking pair**, and they are a **rename, not a new clause**.
ER-18 used to name *the identity model* and *durable-hire persistence* — both questions about a
human **seat kind**, which Model B deletes. What actually blocks FIX-1455 and the assemblies cut now
is the bind plus authorization (FIX-1455 renders those actions and calls them) and what the bind's
persistence must carry (FIX-1455 owns the store). FIX-1458 does not report complete with either
still open unless the owner signs off leaving it open; walls 3 and 4 may stay open where the
exploration shows they bind neither FIX-1455 nor the cut ([ER-18](BUSINESS-RULES.md)).

**The `unparkAndDrain` caller question — narrowed, not closed, and not a fifth wall.** Round 1
raised it against FIX-1458 (this document never carried it): nothing binds the caller to the seat's
principal, so the system records an answer without proving who gave it. **Model B closes half by
construction** — `unparkAndDrainInputSchema` is `{ taskId, feedback? }` and carries no caller at
all, while a flow action arrives with a `ResolvedPrincipal` the host resolves from the transport
*before* dispatch (`packages/core/src/types/auth.ts`: "the runtime's authoritative caller
identity"). **The other half stands**: nothing compares that principal to the one the row's audience
derives to, and BP-031 requires that comparison be made against the resolved principal, never a
`userId` in the action's input. Unbuilt — so it is wall 1's sharpest test rather than a wall of its
own, and wall 1 is downstream-blocking.
