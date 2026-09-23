# FIX-1522 · org- and user-owned Workforce planes: what the POC found

An Explore, not a spec, and nothing here ships. It merges as a retained record once its direction
is approved. The five-document spec
set is deliberately skipped: this directory holds the findings, six figures, and the runnable POC
they come from ([`poc/owner-planes/`](poc/owner-planes/README.md), 24 legs, all green on `main`
at `d8d4c26`). Linear: [FIX-1522](https://linear.app/fixpoint-labs/issue/FIX-1522).

> **See also: [the multitenancy model](SECURITY-MODEL.md).** How users, orgs, sessions and flow
> instances relate, in five figures. It found one cross-org gap: any org can run another org's
> hired seat with that org's instructions (F2).
>
> **Next: [the F2 plan shape](F2-PLAN.md)** for FIX-1529 — surfaces, smallest fail-closed
> changes, and the experiments that would falsify a fix.

## The short version

**One hire store works.** An org's team and each user's private team can share FIX-1475's roster
row, prefix and reload path. The owner only picks which storage cell a row lands in, and the
engine's existing session binding keeps users out of each other's cells. No second store and no
`UserWorkforce`.

**It is not shippable yet.** Four surfaces leak a user's plane, and none of them is in the roster:

1. The shipped **channel board** and **seat inventory** hard-code org scope, so a user's board
   tasks and seat rows land org-wide (C9, C10).
2. The **flow catalog** (`GET /api/flows`) lists every registered seat to every caller, from any
   org (C8).
3. A **user cell is one per person, not per org**, so alice's private team from `acme` shows up
   in her `globex` session's browser read (C7).

**The bridge seat is falsified.** An org-hired seat cannot reach a user's plane under verified
identity. The only way through is to mint the user's principal, which is what verified identity
([FIX-1503](https://linear.app/fixpoint-labs/issue/FIX-1503)) exists to stop.

## What was asked, and what the POC answered

| The ask | Answer | Legs |
|---|---|---|
| 1 · owner key through hire → inventory → channel open → boards | `owner: { type: "org" \| "user", id }` maps to the resource scope. The org id always comes from the session. Hire, roster, reload, address, board and drain carry it as a parameter. Inventory and the shipped channel board can't carry it yet | A1–A4, C5, C9, C10 · [fig 1](#fig-1), [fig 6](#fig-6) |
| 2 · seed pack → durable store | Seed **once per plane**, recorded in a per-plane ledger (a user's is keyed by org too). Seeding "if the row is missing" brings back seats the user fired | B1–B5 · [fig 3](#fig-3) |
| 3 · prove isolation | user↔user holds on list and act, and org↛user holds on drain. Assign is the soft spot: without a guard, a cross-plane write *succeeds in the wrong cell* instead of failing. Two leaks sit outside Workforce | C1–C10 · [fig 2](#fig-2), [fig 5](#fig-5) |
| 4 · bridge seat | Fails under verified identity, and "works" only by impersonation without it | D1–D4 · [fig 4](#fig-4) |

## The figures

<a id="fig-1"></a>
![One principal org containing three storage cells: the org's, alice's and bob's](figures/01-one-store-two-cells.svg)

**One store, and the owner picks the cell.** Look at the three boxes. Every line is identical
except `cell` and the address. The org cell is byte-identical to what FIX-1475 writes today, so
nothing persisted has to move. A user row puts the org in its key (`acme/…`) because a user cell
is not per-org (see figure 5).

<a id="fig-2"></a>
![A matrix of callers against operations on alice's plane, each cell coloured by outcome](figures/02-isolation-matrix.svg)

**Where isolation holds, and where it doesn't.** Read down the right-hand column first: the
catalog leaks to everyone, whoever is calling. Then the amber cells. An unguarded cross-plane
write doesn't fail. It completes in the caller's own cell, so the work silently goes nowhere.
The blue cells fail closed but ack `202` first (see *Found on the way*).

<a id="fig-3"></a>
![Two lanes of the same four steps; in the first lane a fired seat comes back at boot two](figures/03-seed-then-evolve.svg)

**Seed once, not whenever a row is missing.** The roster can't tell "never seeded" from "seeded,
then the user fired everything". Only a record of the seeding itself can. `plane.ts` keeps it
beside the roster, per plane, keyed by pack id.

<a id="fig-4"></a>
![A fence labelled session owner, with four paths from an org bridge seat toward alice's plane](figures/04-bridge-seat.svg)

**The bridge seat stops at the session owner.** Three of the four paths never cross the fence.
The fourth crosses only because an unverified app takes the caller's word for who it is.

```mermaid
flowchart LR
  B["bridge seat · runs as svc"] -->|"D1 file for alice"| S["svc's own cell"]
  B -->|"D2 act in her session"| F["refused: 409, or 202 then dropped"]
  B -->|"D3 claim userId alice"| F
  B -->|"D4 unverified app"| A["alice's board"]
```

<a id="fig-5"></a>
![Two panels: a user cell read two ways, and a flow registry listed to everyone](figures/05-two-leaks.svg)

**Two leaks Workforce can't fix from its side.** The boot reload is per-org because it reads by
prefix. The browser read route lists the whole cell. The catalog lists every registered instance,
and a seat is one.

<a id="fig-6"></a>
![Nine stages from hire to catalog, coloured by whether the owner key already travels through each](figures/06-owner-key-path.svg)

**What it would take.** The blue boxes are a parameter in `plane.ts`. The two red boxes are
shipped Workforce declarations that need an owner parameter (small). The dashed box, plus C7, is
engine work.

## Decided

Both product questions this Explore raised are answered. Nothing is waiting on a product call.

**1 · A private team stays in the org it was built in.** Decided by the product owner on
2026-09-23. If alice builds a private research team at Acme and then signs into Globex, her Acme
team is not there. It is not portable. Portability could come later as an explicit opt-in,
and that is out of scope here. *What it locks in:* the engine needs a user-within-org storage
cell, since today's user cell is one per person across orgs (C7). That is engine work, filed
as the storage-cell engine issue under
[FIX-1528](https://linear.app/fixpoint-labs/issue/FIX-1528), not a workaround in Workforce.
*Why this way round:* per-org is what every org admin will assume and matches "org is never
optional". Making it portable later is a data move. Splitting cross-org data that users already
have would be much harder.

**2 · User planes wait for the catalog to be scoped.** Settled by the Architect on this PR:
user planes wait on [FIX-1486](https://linear.app/fixpoint-labs/issue/FIX-1486). Every seat's
address is visible to anyone who asks the server, and a user seat's address carries the user id
and the seat name (`acme.~alice.therapy-notes`). A seat name a user typed is personal data in a
way an org's `eng.lead` isn't. So no user plane ships until the listing is scoped.

No decision was needed on the bridge. It's falsified, and the invent-kill stands: cross-plane
collaboration stays a named gap, and its door is an explicit grant or invite rather than a seat.

## Where the other findings went

| Finding | Went to | State |
|---|---|---|
| F2, the cross-org instance fence ([F2-PLAN.md](F2-PLAN.md)) | [FIX-1529](https://linear.app/fixpoint-labs/issue/FIX-1529), fixpoint-labs/flow-state-dev#2091 | Merged |
| Seat-hire capability | FIX-1525 / FIX-1526, fixpoint-labs/flow-state-dev#2079 | Shipped |
| E7's board-drain leg | [FIX-1534](https://linear.app/fixpoint-labs/issue/FIX-1534) | Filed |
| B4, debug endpoints skip per-user scoping | [FIX-1535](https://linear.app/fixpoint-labs/issue/FIX-1535) | Filed |
| X1, a runtime hire under the default org bricks the reload | [FIX-1536](https://linear.app/fixpoint-labs/issue/FIX-1536) | Filed |
| Per-resource isolation for seat kinds | [FIX-1396](https://linear.app/fixpoint-labs/issue/FIX-1396) | Existing issue |
| The user-within-org storage cell (decision 1) | The storage-cell engine issue under FIX-1528 | Being filed |

fixpoint-labs/flow-state-dev#2092 was closed as superseded by #2091.

## Found on the way

These are outside the owner question. Each one is pinned by a leg, so a fix will show up as a red
test.

- **A cross-plane write succeeds in the wrong place (C3, D1).** A user-scoped declaration used
  from another user's session resolves *that* session's cell. There's no error. The work just
  lands where its owner never looks. `assertOwnPlane` in `plane.ts` turns it into a named refusal
  (C4). Any productized plane needs that guard at the door, not per call site.
- **A refused action still acks `202` (C2, D2, D3).** When a caller posts into a session another
  user owns, the route answers `202 in_progress` and `UserBindingMismatchError` then refuses the
  run before a request record exists, so polling the id never finds it. It fails closed, so this
  is not a security bug. But the action route's own contract is that a `202` means the request is
  discoverable, and here it never is.
- **A runtime hire in an app without authentication bricks the reload (X1).** The hire is stored
  under `DEFAULT_ORG_ID` (`__fsd_default_org__`), which isn't a legal address segment. When that
  org is in `orgIds`, `reloadHiredSeats` rejects outright rather than skipping the row, so no org's
  seats come back. Kitchen-sink's hire principal is always an admin token bound to a named org, so
  it doesn't hit this. An unauthenticated dev app that hires at runtime would.

## What this directory is not

- Not a supported API. `plane.ts` is written to be portable, but nothing imports it.
- No user-facing docs and no changeset: nothing ships, and the package surface is unchanged.
- No kitchen-sink surface, per the ticket's fence against a kitchen-sink-only owner key.
