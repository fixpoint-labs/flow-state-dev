# FIX-1500 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Three operations, all extensions — no new page. The vocabulary this issue works in (seat, kind,
roster, hire) is already introduced across the Workforce section. The reader-facing prose below
carries no issue or PR identifiers, per the site writing rules.

**Ownership.** The rail's own introduction — what a navigator is, what the roster and board panels
show — belongs to [FIX-1477](https://linear.app/fixpoint-labs/issue/FIX-1477)'s draft. This issue
documents only what a seat row opens into, the hire handlers an app can mount as an action, and
the organization limit. A seat's skills, channels and boards are
[FIX-1539](https://linear.app/fixpoint-labs/issue/FIX-1539)'s to document, with the surface that
publishes them.

---

## UPDATE · `apps/docs/docs/workforce/durable-hire.md` · after "What the framework gives you"

### The hire sequence, so you don't write it twice

The order a runtime hire happens in is load-bearing, and getting it wrong is quiet rather than
loud. Refuse what you can decide is wrong before anything is written. Mint the seat from what
will be stored, not from the request, so a seat that hires is one the stored row can rebuild.
Write the row with `create()` — its already-exists throw *is* the refusal of a duplicate hire,
including two arriving at once, with no lock of your own. Register the address, and if
registration fails, delete the row this call wrote so a failed hire leaves nothing behind.

That sequence already ships: it is what the `hire` and `fire` catalog tools from
`createSeatHireCapability` run. When a person, not a model, does the hiring — a button on a
screen — mount the same handlers as an action with `createSeatHireBlocks`:

```ts
import {
  createSeatHireBlocks,
  defineHiredRosterCollection,
  defineSeatInventoryCollection,
  HIRED_ROSTER_RESOURCE,
  SEAT_INVENTORY_RESOURCE,
} from "@flow-state-dev/workforce";

const seatHire = createSeatHireBlocks({ kinds, register, unregister, kindAt });

defineFlow({
  kind: "my-app",
  resources: {
    [HIRED_ROSTER_RESOURCE]: defineHiredRosterCollection(),
    [SEAT_INVENTORY_RESOURCE]: defineSeatInventoryCollection(),
  },
  actions: {
    hireSeat: { block: seatHire.hire },
  },
});
```

It takes the same options as `createSeatHireCapability` and returns `{ hire, fire }`, the same
handlers the tools are. Declare both collections under those two keys, because the handlers read
them from there. The action takes `{ seatId, flow, settings?, instructions? }` and returns
`{ seatId, address, warning? }`.

A seat hired this way is visible to every member of the organization: its roster row is the one
a `Roster` panel lists, `instructions` included.

Two things it does that you should plan around:

- **A hire also records the seat in the inventory**, after registering it. If that last write
  fails, the seat is hired and answering but has no inventory entry.
- **A fire removes the roster row and releases the address, and leaves the inventory entry.** The
  inventory records that a seat was registered, not that it is still hired, so read the roster —
  not the inventory — when you want the seats an organization has now.

The route or screen in front of the action, and whatever guards it, are still yours.

### Which organization a hire lands in

The handlers take the organization from the session the action runs in: its authenticated
principal's, or the default organization when the flow authenticates nobody. An `orgId` in the
request body is accepted and ignored, so a caller cannot hire into somebody else's organization
by naming it.

This has a consequence worth planning for. A screen hires into the organization its own session is
bound to, and it reads the roster from that same organization, so the two always agree. An
endpoint guarded by an operator credential resolves a different one — the credential's — so seats
hired there will not appear on a screen whose session has no credential. That is not a bug to
hunt; it is two organizations, and the fix is giving the screen an identity rather than giving it
the operator's token.

---

## UPDATE · `packages/react/README.md` · after "BoardColumns"

### SeatDetail

`SeatDetail` shows one seat: its kind, and its instructions when the organization's roster
publishes them.

```tsx
import { SeatDetail } from "@flow-state-dev/react";

<SeatDetail
  sessionId={sessionId}
  kind={row.kind}
  seatId={seatId}
  collectionRef="hiredRoster"
  resourceClient={resourceClient}
/>
```

Pass `kind` from the row you already have — a navigator row carries it — so showing it costs no
request. For the instructions it reads one item from the roster collection your session's flow
declares, under `collectionRef`. Pass `seatId` only for a seat hired into the whole organization;
leave it out for a seat declared in a worker file, or one a user hired for themselves, and the
component says the instructions are not published without reading anything.

The instructions area keeps five states apart: the instructions, *none given*, *not published*,
still reading, and could not be read. A read that failed says so rather than looking like a seat
with nothing to show.

It reads through `resourceClient` the same way `Roster` and `BoardColumns` do, and with the same
fallback: left out, it builds a client with no auth headers. Pass your own when your API needs
them.

The prop names above are illustrative until the component ships; the draft is reconciled against
the built component before it is published.

---

## UPDATE · `packages/workforce/README.md` · "Hire and fire as catalog tools", and the API table

After the options table in *Hire and fire as catalog tools*:

> **The same handlers, as an action.** `createSeatHireBlocks` takes the same options and returns
> `{ hire, fire }` — the handlers the tools are — so a screen can hire through the sequence a
> model uses. Mount one as an action's block, and declare the roster and seat-inventory
> collections under `HIRED_ROSTER_RESOURCE` and `SEAT_INVENTORY_RESOURCE` on that flow.

API table row:

| Export | What it does |
|---|---|
| `createSeatHireBlocks(options)` | Returns `{ hire, fire }`, the handlers behind `createSeatHireCapability`'s catalog tools, for mounting as actions. Same options, same inputs, outputs and refusals. The organization comes from the session; a body `orgId` is ignored. |

---

## Publication ownership

Each operation publishes with the PR whose behaviour it describes: the `durable-hire.md` section
and the workforce README with PR-A, the react README with PR-C, and the organization paragraph's
kitchen-sink counterpart with PR-D. Reconcile each against the built behaviour first — in
particular the organization paragraph, which is a promise about what a reader will see. The limit
it describes is the same one `apps/kitchen-sink/README.md` states for the reference app; keep them
in step or state it once and link.
