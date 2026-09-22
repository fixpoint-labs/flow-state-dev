# FIX-1500 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Four operations, all extensions — no new page. The vocabulary this issue works in (seat, kind,
channel, board, roster, inventory) is already introduced across the Workforce section, and a fifth
page would fragment a sidebar that already runs nine deep. The reader-facing prose below carries
no issue or PR identifiers, per the site writing rules.

**Ownership.** The rail's own introduction — what a navigator is, what the roster and board panels
show — belongs to [FIX-1477](https://linear.app/fixpoint-labs/issue/FIX-1477)'s draft. This issue
documents only what a seat row opens into, the second hire door, and the organization limit.
Reconcile against that draft before publishing rather than restating it.

---

## UPDATE · `apps/docs/docs/workforce/inventory.md` · new section, after the collections table

### Reading the inventory from a browser

The three collections are organization-scoped, so any session in an organization can be allowed to
list its rows. That permission is off by default and is declared on the collection itself:

```ts
resources: {
  seats: defineSeatInventoryCollection(),
  channels: defineChannelInventoryCollection(),
  members: defineMembershipIndexCollection(),
}
```

Each of these now permits a browser read and publishes an allow-list of fields rather than the
stored row. A collection with no such list would return whatever happened to be stored, which is
how a field added later gets broadcast without anyone deciding to.

To answer "which channels is this seat in", read the membership index by prefix rather than
listing every channel and filtering:

```ts
const page = await resources.listCollectionItems(sessionId, "members", {
  topicPrefix: `${seatId}/`,
});
```

The key shape is what makes that work: a membership row is keyed `<seatId>/<channelId>`, seat
first, so one seat's channels are a prefix of the keyspace. Filtering a full listing in the browser
gives the same answer and reads every other seat's rows to do it.

A session reads its own organization's rows and no other's. Which organization that is comes from
the session's authenticated principal, or from the default organization when a flow authenticates
nobody. It is never taken from the request body.

### What a seat row carries

A seat's row now includes the names of the skills resolved for it at start — the union of the
organization's, its team's, and any sitting beside the worker itself:

```ts
{ id: "support.ada", kind: "agent", skills: ["triage", "escalate"] }
```

Names only. What a skill does is not published here.

This is a start-time answer, because resolving it means reading folders. A skill added to a
folder while the app is running appears after the next restart. A row written before this field
existed reads with an empty list.

---

## UPDATE · `apps/docs/docs/workforce/durable-hire.md` · after "What the framework gives you"

### The hire sequence, so you don't write it twice

The order a runtime hire happens in is load-bearing, and getting it wrong is quiet rather than
loud. Refuse what you can decide is wrong before anything is written. Mint the seat from what
will be stored, not from the request, so a seat that hires is one the stored row can rebuild.
Write the row with `create()` — its already-exists throw *is* the refusal of a duplicate hire,
including two arriving at once, with no lock of your own. Register the address last, and if
registration fails, delete the row this call wrote so a failed hire leaves nothing behind.

That sequence ships from `@flow-state-dev/workforce`, so an app with more than one way to hire —
an operator's endpoint and a screen, say — has one copy of it rather than two that drift:

```ts
import { hireSeat } from "@flow-state-dev/workforce";

await hireSeat({
  orgId,          // from the resolved principal — see below
  seatId, flow, settings, instructions,
  roster: ctx.resources.roster,
  kinds: myKinds,
  registrar: myRegistrar,
});
```

The route in front of it, and whatever credential guards it, are still yours.

### Which organization a hire lands in

`orgId` must come from the session's resolved principal, or from the default organization when a
flow authenticates nobody. Do not read it from the request body: a caller that can name the
organization can hire into somebody else's.

This has a consequence worth planning for. A screen hires into the organization its own session is
bound to, and it reads the roster from that same organization. Those two are only guaranteed to
agree when they resolve the organization the same way. An endpoint guarded by an operator
credential resolves a different one — the credential's — so seats hired there will not appear on a
screen whose session has no credential. That is not a bug to hunt; it is two organizations, and
the fix is giving the screen an identity rather than giving it the operator's token.

---

## UPDATE · `packages/react/README.md` · component table and its section

`SeatDetail` — one seat's kind, the skills resolved for it, the channels it is in, and the boards
those channels declare. Takes its rows from a source the host passes, the same way `Roster` and
`BoardColumns` do, so every request carries whatever credential the host's transport adds.

Each section shows four states and keeps them apart: rows, nothing to show, still reading, and
could not be read. A section that failed to read says so rather than looking empty.

The shared collection read the panels use now forwards `topicPrefix`, so a panel can ask for one
prefix of a collection instead of a page of all of it.

---

## UPDATE · `packages/workforce/README.md` · API table

- `hireSeat` / `fireSeat` — the durable hire and fire sequence, as described under *Hiring while
  the app runs*. Call it from whatever door your app puts in front of it.
- The three inventory collections permit a browser read and publish field allow-lists.
- A seat's inventory row carries the names of the skills resolved for it at start.

---

## Publication ownership

Published with PR-D, reconciled against the built behaviour first — in particular the organization
paragraph, which is a promise about what a reader will see rather than a description of code. The
limit it describes is the same one `apps/kitchen-sink/README.md` states for the reference app; keep
them in step or state it once and link.
