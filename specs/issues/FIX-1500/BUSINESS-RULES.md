# FIX-1500 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, as rules. Each says what a person or the system does and what happens; *proved by* is
the check the plan runs. A human reviews this page for a missed case; the plan turns it into work.

## The organization the rail is looking at

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A session is created for the rail and no principal resolves | It binds to the default organization, and every read and every hire the rail makes uses that one | CI |
| BR-2 | A hire request arrives carrying an `orgId` in its body | The body's value is not consulted. The seat is hired into the session's organization | CI · asserted on the seat landing in the session's org while the body named a *different* one — a check that only asserts the call succeeded proves nothing |
| BR-3 | The rail hires a seat and then reads the roster | Both name one organization. There is no configuration in which the hire lands in one and the read in another | CI |
| BR-4 | A deployment configures operator tokens | The rail still hires and reads the default organization; seats hired under a token are not in its list. Documented, not an error state | Docs + CI (BR-1) |

## Opening a seat

| # | When | Then | Proved by |
|---|---|---|---|
| BR-5 | A seat row in the rail is opened | Its kind, its resolved skill names, the channels it is in and those channels' declared board names are shown | CI · component |
| BR-6 | A seat's channels are fetched | One read, filtered at the source by the seat's own key prefix. No read returns another seat's memberships for the browser to discard | CI · asserted on the *request*, not only on the rendered rows |
| BR-7 | A seat resolved no skills | An empty register is shown as such, distinct from not having been read yet | CI · component |
| BR-8 | A seat is in no channel | The same: an empty list that says so, not a spinner and not a blank | CI · component |
| BR-9 | A skill is added to a seat's folder while the app is running | The rail keeps showing the register from the last boot until the app restarts (D2) | CI · asserted as the *documented* behaviour so a later change to it is a deliberate one |
| BR-10 | A seat's inventory row predates the skills field | It reads, with an empty register (BP-030) | CI |

## Hiring from the rail

| # | When | Then | Proved by |
|---|---|---|---|
| BR-11 | A person hires another instance of a kind the app carries | The seat is minted, its row written, and the address registered — in that order, and a failure at any step leaves nothing behind | CI · the extracted sequence's own suite |
| BR-12 | The id names a seat this organization already hired | Refused. The refusal is the roster's `create()` throwing on an existing key, not a check performed beside it | CI · red state is swapping `create()` for `upsert()`, which must make it go green-when-it-should-be-red |
| BR-13 | Two hires of one id arrive at once | Exactly one succeeds. No lock and no read-before-write of our own | CI |
| BR-14 | The kind named is not one this app carries | Refused before anything is written, naming the kinds it does carry | CI |
| BR-15 | The seat mints but registration is refused | The row this call wrote is deleted, and the caller hears about the registration failure rather than about the cleanup | CI |
| BR-16 | A hire succeeds | The roster list in the rail shows the new seat without a page reload, and its seat detail opens like any other | CI · goal check |
| BR-17 | A hire succeeds in one browser | Another browser already open is **not** required to show it. That is [FIX-1506](https://linear.app/fixpoint-labs/issue/FIX-1506)'s | Not checked here — named so its absence is deliberate |

## After a restart

| # | When | Then | Proved by |
|---|---|---|---|
| BR-18 | The process that performed a hire ends and a new one starts | The seat is in the rail's list again, rebuilt from durable organization state | CI · persistence boundary, plus the goal check |
| BR-19 | The post-restart read is served | It does not come from process memory — not a module-level cache, not a `globalThis` slot, not the registrar the previous process filled | CI · persistence boundary, with the empty-store negative control that proves the check reaches the durable read |
| BR-20 | A stored row cannot be brought back at boot | The rail says so rather than showing a shorter list that looks complete | **Inherited, not re-proved here.** [FIX-1477](https://linear.app/fixpoint-labs/issue/FIX-1477) built the boot report, its organization-scoped transport and the `problems` prop that renders it, and its own checks cover them. A seat hired through this rail writes an ordinary roster row, so the same reload and the same report already cover it — there is no failure mode here that FIX-1477's checks do not already turn red. Stated rather than dropped, so the behaviour is a promise this rail keeps and not an accident of what it mounts |

## Channels and boards

| # | When | Then | Proved by |
|---|---|---|---|
| BR-21 | A channel is opened through the rail | Its declared board names come from the channel's own session state, and each board's rows from that board's ledger — the shipped surfaces, not app-owned state | CI · goal check asserts the network path |
| BR-22 | A channel declares no boards | The channel opens and says it has none | CI · component |
| BR-23 | A board is declared but has never been written to | An empty column that states the likely cause, as the shipped panel already does | Existing `BoardColumns` behaviour |
| BR-24 | Anything in the rail tries to create a channel or a board | It cannot. There is no such affordance | CI · asserted as an allow-list over the surface's published actions, so a fourth spelling fails too |

## What is published, and what is not

| # | When | Then | Proved by |
|---|---|---|---|
| BR-25 | Any inventory collection is read by a browser | It returns exactly the fields its allowlist names, and no others | CI · asserted on the **absence** of the withheld fields, with rows seeded first — a 200 with an empty list satisfies any field assertion vacuously |
| BR-26 | An inventory collection's read declaration is removed | The read is refused `403 State read not permitted`, and the seat detail goes visibly empty rather than silently reading | CI |
| BR-27 | A seat detail is rendered against a deployment that authenticates | Its reads carry the host's credential, because the host passes the resource client it already holds | CI · red state is building the client inside the component, which reads through no credential |
| BR-28 | An organization reads the inventory | It gets its own rows and no other organization's | CI · two organizations, asserted separately |

## Failure taxonomy

A refused hire is fatal to that call and changes nothing — no row, no registration, no partial
seat. A read that fails degrades: the seat detail shows what it could read and names what it could
not, because a detail pane that renders three of its four sections and says nothing about the
fourth is the silent-partial failure this epic keeps finding. Nothing retries. A boot that cannot
rebuild one stored seat is not a failed boot; it is a named problem in the rail (BR-20).

## Acceptance criteria this issue owns

One run, in the kitchen-sink human rail, with no developer tool and no hand-made HTTP call
anywhere in it: open the rail, open a seat and read its kind, skills, channels and boards; hire
another instance of that kind; see the new seat in the same surface; restart the process; find the
seat still there; open a channel's board through the same navigation and confirm its rows came
from the shipped collection route. That run is the goal check, and it is the issue's completion
gate.
