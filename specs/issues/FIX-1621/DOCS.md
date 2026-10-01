# FIX-1621 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Proposed reader-facing changes, published by FIX-1621 after the goal check passes
([epic ownership](../../epics/FIX-1650/DOCS.md#ownership)). Unchanged prose is not copied. Voice:
"seat" and "kind", never "worker" as a noun (ER-13); no issue numbers in published pages.

## UPDATE · `apps/docs/docs/workforce/durable-hire.md` · "Firing", replace its last paragraph

Firing also removes the seat's row from the [inventory](./inventory.md), so a team list built from
the inventory stops showing it. A seat fired by an earlier version left its inventory row behind;
a reader that joins the inventory with the roster (as Shift Manager's team list does) hides it,
because no roster row backs it. Calling `fire` again for that seat removes the leftover row and
answers with `released: false`.

## CREATE · `apps/docs/docs/workforce/durable-hire.md` · new section after "Reading the roster back at the next start"

### Repairing a seat whose kind is gone

Cut a kind from your app and every seat hired into it stops coming back. The start skips each one
and names it in `problems`, and keeps doing so on every start, because nothing is deleted at
start. That's deliberate: the row is the only record of who the seat was, and whether to keep it is
your call.

`createSeatHireBlocks` gives you two more handlers to make that call with, mounted as actions
beside `hire` and `fire`.

`brokenSeats` lists the stored seats in the caller's organization that wouldn't start, using the
same check the start uses, so the two lists always agree:

```ts title="src/flows/workforce-admin/flow.ts"
  actions: {
    hire: { block: seatHire.hire },
    fire: { block: seatHire.fire },
    brokenSeats: { block: seatHire.brokenSeats },
    rehire: { block: seatHire.rehire },
  },
```

```bash
curl -X POST localhost:3000/api/flows/workforce-admin/actions/brokenSeats \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -d '{"userId":"you","input":{}}'
# [{ "seatId": "support.joe", "kind": "desk-clerk", "reason": "kind-gone",
#    "detail": "names flow kind \"desk-clerk\", which was not passed to hireWorkforce. Kinds passed: agent" }]
```

Each entry has one of three reasons:

| `reason` | What happened | What you can do |
|---|---|---|
| `kind-gone` | The seat's kind isn't in the map you passed | Retire it, or re-hire it onto a kind you carry |
| `refused` | The kind is there but now refuses the seat's settings | Retire it, or re-hire it with settings the kind accepts |
| `unreadable` | The row can't be read, or doesn't belong to this organization | Retire it |

**To retire a seat, fire it.** `fire` removes the roster row and the inventory row, and there is no
address to release because nothing was serving it. The next start names nothing for it.

**To keep the seat, re-hire it.** `rehire` takes the seat id, the kind to run it on, its settings
for that kind, and optionally new instructions. The seat keeps its id and its address, so channels
that list it and sessions it owns carry on:

```bash
curl -X POST localhost:3000/api/flows/workforce-admin/actions/rehire \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -d '{"userId":"you","input":{"seatId":"support.joe","flow":"agent",
       "instructions":"Answer billing questions. Hand refunds to a person."}}'
```

The old kind's settings are not carried over, since they were written for a different kind. The
instructions are, unless you pass new ones. `rehire` refuses a seat that would still start: to
change a working seat's kind, fire it and hire it again.

Neither handler asks anyone. They are what you run once a person has said yes, so in a flow a
model drives, put them behind an approval: raise a `human_approval` suspension with
`ctx.suspend`, and fire or re-hire only when it resumes with Approve. Both are safe to run again if the process dies part-way, so a restart
between the ask and the answer leaves the seat as it was until someone answers.

Nothing here picks a kind for you or loads a missing one. If you want the old kind's seats back
as they were, ship the kind again.

## UPDATE · `apps/docs/docs/workforce/inventory.md` · the paragraph on hired seats

For the seats hired at runtime and not yet fired, read the [hired roster](./durable-hire.md#the-roster).
Firing a seat removes both its roster row and its inventory row. A row an earlier version left
behind after a fire has no roster row; a reader that wants only current seats joins the two.

## UPDATE · `packages/workforce/README.md` · `createSeatHireBlocks`

**`fire`** takes `{ seatId, orgId? }` (extra keys are refused) and returns
`{ seatId, address, released }`. It deletes the roster row, unregisters the address when the live
kind matches the stored kind, and deletes the seat's inventory row. Called for a seat whose
roster row is already gone but whose inventory row is left, it removes that row and returns
`released: false`.

**`brokenSeats`** takes `{}` and returns the caller's organization's stored seats that would not
start, each `{ seatId, key, kind, reason, detail }`, with `reason` one of `kind-gone`,
`refused`, `unreadable`. It reads through the start's own check and writes nothing.

**`rehire`** takes `{ seatId, flow, settings?, instructions?, orgId? }` and returns
`{ seatId, address, warning? }`. It keeps the seat's id and address and runs it on `flow`.
It refuses a seat that would start, an `unreadable` row, a kind this app doesn't carry or
`allowKinds` excludes, and settings the kind refuses, all before writing anything. A failed
registration writes the old row back.

None of the three asks for approval; compose them behind one.

## UPDATE · `labs/shift-manager/README.md` · TEAMS

TEAMS lists a hired seat only while the organization's roster has its row, so a fired seat leaves
the list, including one fired before this version.
