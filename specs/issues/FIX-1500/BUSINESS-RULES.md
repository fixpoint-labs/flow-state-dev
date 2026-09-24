# FIX-1500 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, as rules. Each says what a person or the system does and what happens; *proved by* is
the check the plan runs. A human reviews this page for a missed case; the plan turns it into work.

## The organization the rail is looking at

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A session is created for the rail | It binds to the kitchen-sink organization ([D6](DECISIONS.md#d6)), and every read and every hire the rail makes uses that one | V18 |
| BR-2 | A hire request arrives carrying an `orgId` in its body | The body's value is not consulted. The seat is hired into the session's organization | V11 · asserted on the seat landing in the session's org while the body named a *different* one — a check that only asserts the call succeeded proves nothing |
| BR-3 | The rail hires a seat and then reads the roster | Both name one organization. There is no configuration in which the hire lands in one and the read in another | V18 |
| BR-4 | A deployment configures operator tokens | The rail still hires and reads the kitchen-sink organization. Every accepted token is bound to that organization, so an operator can fire the rail's hires and mara's. A token entry naming any other organization is refused at boot. Seats a token hires are user-owned and are not in the rail's list. Documented, not an error state | Docs · V18 · V22 |
| BR-33 | A request reaches a kitchen-sink flow that declares no resolver of its own: the rail, a seat, a channel | It runs as the one kitchen-sink organization and the one `devuser` user. Nothing on the request, whether a body field, a query, a header or a cookie, can name another. Anyone who can open the app can therefore hire through the rail, and through mara can hire and fire. The two flows with their own resolver are `workforce-admin`, pinned to the same organization (BR-4), and `weekly-digest`, which neither hires nor reads the roster | V18 · red state is removing the resolver, which puts every such request back in the development organization, where every hire is refused |
| BR-34 | The first boot after this change runs over a store written before it | **No upgrade path: the store is wiped** ([H1](DECISIONS.md#h1), the owner's call). The boot refuses to start, naming every file-declared channel stored under another organization and saying to delete the store. It migrates, moves and deletes nothing. Once the store is deleted, the app boots fresh | V19 · the red state is the bare channel open (`channel "…" could not be opened — Request failed (403)`), which names neither the cause nor the fix |

## Opening a seat

| # | When | Then | Proved by |
|---|---|---|---|
| BR-5 | Any seat in the rail is opened | Its kind is shown, taken from the row the host already holds. The detail makes no read for it | VG · both the declared and the hired seat |
| BR-29 | A seat hired into the organization is opened | Its instructions are shown, read from its public roster row | VG · the hired seat, with instructions supplied at hire |
| BR-30 | A hired seat was hired with no instructions | The detail says it has none, rather than showing a blank | V10 |
| BR-31 | A seat with no public roster row is opened — declared in a `WORKER.md`, or hired as a user's own | The detail says its instructions are not published. It never borrows another seat's row, including an org-visible seat with the same short id | V10 · V17 |
| BR-27 | The seat detail's read runs against a deployment that authenticates | It carries the host's credential, because the host passes the resource client it already holds | V9 · red state is reading through the component's fallback client, which carries no credential |

## Hiring from the rail

| # | When | Then | Proved by |
|---|---|---|---|
| BR-11 | A person hires another instance of a kind the app carries | The seat is minted, its roster row written, its address registered, and then its inventory row written. A refusal before the row, or a registration failure, leaves nothing behind. **An inventory write that fails after registration leaves the seat hired, registered and without an inventory row** — the package sequence's current behaviour, inherited and not changed here | V3 · the package's seat-hire suite |
| BR-12 | The id names a seat this organization already hired | Refused. For a seat that is not live, the refusal is the roster's `create()` throwing on an existing key, not a check performed beside it | V2 · red state is swapping `create()` for `upsert()` |
| BR-13 | Two hires of one id arrive at once | Exactly one succeeds. No lock and no read-before-write of our own | V2 |
| BR-14 | The kind named is not one this app carries | Refused before anything is written, naming the kinds it does carry | The package's seat-hire suite, unchanged |
| BR-15 | The seat mints but registration is refused | The row this call wrote is deleted, and the caller hears about the registration failure rather than about the cleanup | V3 |
| BR-16 | A hire succeeds | The roster list in the rail shows the new seat without a page reload, and its seat detail opens like any other | VG · by the checked remount of [D4](DECISIONS.md#d4) — `RosterProps` publishes no refresh, ref or version, and this issue adds none |
| BR-17 | A hire succeeds in one browser | Another browser already open is **not** required to show it. That is [FIX-1506](https://linear.app/fixpoint-labs/issue/FIX-1506)'s | Not checked here — named so its absence is deliberate |
| BR-32 | The rail's hire runs | It runs the `workforce` package's hire sequence, not a copy written in the app | V1 · V16 |

## After a restart

| # | When | Then | Proved by |
|---|---|---|---|
| BR-18 | The process that performed a hire ends and a new one starts | The seat is in the rail's list again, rebuilt from durable organization state | V14, at node level. **Not the browser suite**: it launches the server itself with an in-memory store, so a restart there discards the row and the step could not fail honestly |
| BR-19 | The post-restart read is served | It does not come from process memory — not a module-level cache, not a `globalThis` slot, not the registrar the previous process filled | V14, with the empty-store negative control that proves the check reaches the durable read |
| BR-20 | A stored row cannot be brought back at boot | The rail says so rather than showing a shorter list that looks complete | **Inherited, not re-proved here.** [FIX-1477](https://linear.app/fixpoint-labs/issue/FIX-1477) built the boot report, its organization-scoped transport and the `problems` prop that renders it, and its own checks cover them. A seat hired through this rail writes an ordinary roster row, so the same reload and the same report already cover it |

## What the rail cannot do

| # | When | Then | Proved by |
|---|---|---|---|
| BR-24 | Anything in the rail tries to create a channel or a board | It cannot. The one action this issue adds to the rail's flow is the hire | V12 · an allow-list over the actions this issue adds, so a second spelling fails too |

## Failure taxonomy

A hire refused before its row is written is fatal to that call and changes nothing. Before
[D6](DECISIONS.md#d6), that was every hire in the app, because the development organization is not
a legal seat address. A
registration failure deletes the row it wrote. The one partial outcome is the inherited
inventory write after registration (BR-11). A read that fails degrades: the seat detail shows
its kind and says the instructions could not be read, distinct from *not published* and from
*none given*. Nothing retries. A boot that cannot rebuild one stored seat is not a failed boot; it
is a named problem in the rail (BR-20).

## Acceptance criteria this issue owns

One run, in the kitchen-sink human rail, with no developer tool and no hand-made HTTP call
anywhere in it: open the rail, open a **file-declared** seat and read its kind; hire another
instance of that kind with instructions; see the **hired** seat appear in the same surface without
a reload, open it, and read its kind and those instructions, arriving from the shipped collection
route. That run is `VG`, and it is the issue's completion gate.

**Durability is asserted beside it, not inside it** (V14, at node level): the row survives in the
durable store and a runtime built on a fresh store handle finds it. The browser suite cannot host
that step as configured, and saying so is better than a step that cannot fail.

**Not claimed:** a seat's skills, its channels and their boards, and a file-declared seat's
instructions. Those are [FIX-1539](https://linear.app/fixpoint-labs/issue/FIX-1539)'s under
[D5](DECISIONS.md#d5), so the issue text's desired outcome 2 is met only in part here.
