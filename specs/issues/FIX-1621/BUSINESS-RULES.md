# FIX-1621 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. *Proved by* names the check the plan runs. "The read" is
`brokenSeats`; "the start" is the boot reload. A row is a stored hired seat; a declared seat comes
from a `WORKER.md` and is never in the roster.

## Finding a seat that won't start

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A stored seat names a kind the app no longer carries | Listed: its seat id, stored kind, reason `kind-gone`, and the kinds the app does carry | CI · goal check |
| BR-2 | The kind is carried, but now refuses the seat's settings | Listed, reason `refused`, with the kind's own refusal as the detail | CI |
| BR-3 | A row can't be read, is stamped for another org, or can't be an address | Listed, reason `unreadable`, by its storage key. Retire is its only repair | CI |
| BR-4 | A stored seat would start | Not listed. A declared seat is never listed | CI |
| BR-5 | The read and the start run over the same rows and kinds | They name the same rows with the same detail text: one check, two callers | CI, set equality against the reload |
| BR-6 | The read runs | In the principal's organization only; an org in the body is ignored, and another org's rows never appear ([ER-7](../../epics/FIX-1650/BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt)) | CI, two orgs |
| BR-7 | The read runs | Writes nothing and changes no row | CI |

## Retiring is firing

| # | When | Then | Proved by |
|---|---|---|---|
| BR-8 | A listed seat is retired | Its roster row is deleted, then its inventory row. Nothing held its address, so nothing is released. The next start names nothing for it | CI · goal check |
| BR-9 | A working hired seat is fired | The same path: roster row, address released, inventory row. TEAMS stops listing it ([ER-19](../../epics/FIX-1650/BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt)) | CI |
| BR-10 | Fire runs again after a crash between the two deletes | No roster row, an inventory row left: the leftover row is removed and the answer says it was already gone. Not an error | CI, crash injected between the deletes |
| BR-11 | Fire names a seat this org never hired | Refused, as today. A declared seat is refused as today | Existing suite |
| BR-12 | An `unreadable` row is retired | That row is deleted by its key. No address, no inventory row, nothing else touched | CI |
| BR-13 | Kitchen-sink's admin fire runs | Through the same removal, user-owned seats included. Its hire writes no inventory row today, so there is none to remove; the path is shared so that stays true if it starts to | CI · kitchen-sink suite |

## Re-hiring the same seat

| # | When | Then | Proved by |
|---|---|---|---|
| BR-14 | A `kind-gone` or `refused` seat is re-hired onto a carried kind | Same seat id and address, new kind. Settings are the ones passed (the old kind's are dropped); instructions carry unless replaced. The next start brings it back on the new kind | CI · goal check |
| BR-15 | The named kind isn't carried, is outside `allowKinds`, or refuses the settings | Refused before anything is written; the seat stays listed, unchanged | CI |
| BR-16 | Registration fails after the row is written | The old row is written back; the seat stays listed; the error is named | CI |
| BR-17 | The process dies after the row write and before registration | The next start serves the seat on its new kind: made, not half-made | CI, crash injected |
| BR-18 | A seat that would start, or an `unreadable` row, is re-hired | Refused. Changing a working seat's kind is fire then hire | CI |
| BR-19 | Two repairs of one seat arrive at once | One lands; the other is refused, naming the seat. Never both | CI, concurrent calls |
| BR-20 | Anything here runs | No kind is mapped, suggested, registered or loaded ([ER-12](../../epics/FIX-1650/BUSINESS-RULES.md#what-no-child-may-do)). The start still refuses and names, as today | CI · review |

## Asking first

| # | When | Then | Proved by |
|---|---|---|---|
| BR-21 | A caller raises an approval and applies a repair on Approve | Deny changes no row. A restart between the ask and the answer leaves it asked; applying it after leaves the same result as applying it once | Goal check, with a `human_approval` suspension in its action |

Where the ask sits and who raises it is [ER-20](../../epics/FIX-1650/BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt),
FIX-1719's. These rules are what makes either answer safe.

## The team list

| # | When | Then | Proved by |
|---|---|---|---|
| BR-22 | The inventory has a hired seat's row and the roster has no row for it (a fire before this change, or BR-10's crash) | Not listed in TEAMS (BP-030) | CI · goal check, seeded the way today's fire leaves it |
| BR-23 | A declared seat's inventory row | Listed, as today | Existing suite |
| BR-24 | TEAMS can't read the roster | Hired seats aren't listed, and the section says the roster didn't load. A seat TEAMS can't show is hired isn't shown as hired | CI |

## Failure taxonomy

Nothing here is fatal to a start. The read fails only if the store won't answer, and then it
throws rather than report an empty list. A refused repair changes nothing and names why. Nothing
retries by itself: a crash leaves a state the next call or start completes (BR-10, BR-17).

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met): over one SQLite store across three
starts, the cut seat is listed with its reason, survives a Deny, and after Approve is gone from
the next start and from the team list, with the healthy seat untouched; the same run fails under
`GOAL_CONTROL=fire-keeps-inventory`. ER-5, ER-7 and ER-19 are proved here for the epic.
