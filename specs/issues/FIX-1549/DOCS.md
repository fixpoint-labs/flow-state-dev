# FIX-1549 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Two user pages and two architecture references change, plus one changeset. No new page. An app
without Workforce needs no user page: it stops being refused. The one key shape it cannot use,
`workforce/roster/~`, is stated in the architecture references below.

## UPDATE · `apps/docs/docs/workforce/durable-hire.md` · "Hiring a seat only one member can reach", after the paragraph ending "each seat's `ownerPin` carries the user."

Installing the private collection also closes the rows to every other collection in your app.
Once a flow that declares it is registered, the app refuses to start if any flow declares a
collection whose pattern could reach a user-owned row: `workforce/roster/**`,
`workforce/roster/[owner]/notes`, a copy of `workforce/roster/[owner]/[seat]`, or a wide
parameterised pattern such as `[tenant]/**`. It doesn't matter which of the two flows registers
first. The error names the pattern, and says it can read user-owned roster rows.

An app that never installs the private collection has no such rows, and none of these patterns
are refused there.

The rows are closed even where that check doesn't run. A user-owned row is stored under
`workforce/roster/~<user>/<seat>`, and no collection except the private one can read or write a
key there, in any process. A queue worker that never registers the private collection, or a
second app over the same store, can declare `[tenant]/**` and start, but its lists never show
those rows and a write to one is refused.

## UPDATE · `packages/workforce/README.md` · the `defineHiredRosterPrivateCollection()` row

Replace the row's last two sentences ("Any other pattern that can reach those rows, … is
refused.") with:

> Registering it arms a check on the whole registry: any other collection whose pattern can
> reach those rows, including `workforce/roster/**`, `workforce/roster/[owner]/notes`, and a
> parameterised pattern such as `workforce/[area]/[owner]/[seat]`, is refused when either flow
> registers. In every process, registered or not, no other collection reads or writes a key
> under `workforce/roster/~`.

## UPDATE · `docs/architecture/state-and-scopes.md` · new subsection "User-owned roster rows", after "The hired-seat cell"

> Workforce stores a user-owned hired seat's row at org scope under
> `workforce/roster/~<escaped user>/<seat>`. Two rules in Engine's hire-plane module keep it
> private, and nothing in Core knows about them.
>
> - **The key fence, always on.** A key under `workforce/roster/~` is served only through the
>   collection carrying Workforce's private-roster brand, and only to the user it encodes.
>   Every other collection lists without it, reads it as absent and is refused on write,
>   through the resource handle, the browser resource routes and the debug endpoints. It
>   depends on nothing registered, so it holds in every process over the store.
> - **The startup fence, armed by the writer.** Once `FlowRegistry` holds a flow declaring the
>   branded collection, it refuses any flow declaring a collection whose pattern can reach a
>   user-owned key, checking the flows it already holds and every one that follows. Like the
>   participants map above, it is never cleared, even across unregister: the rows outlive the
>   registration. A registry that never holds the writer refuses nothing on this account.

## UPDATE · `docs/contributing/architecture-reference.md` · "Resources and Client Data", new bullet

> - Keys under `workforce/roster/~` are reserved for Workforce's branded private roster
>   collection, in every app: no other collection reads or writes them. A registry that has
>   held that collection refuses, for good, any flow whose collection pattern can reach those
>   keys → [State and scopes](../architecture/state-and-scopes.md#user-owned-roster-rows)

## CREATE · `.changeset/<name>.md`

```md
---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": patch
---

`defineResourceCollection` and flow registration no longer refuse collection patterns for Workforce's roster unless Workforce's private roster collection is registered, keys under `workforce/roster/~` are readable only through that collection in every app, and `@flow-state-dev/core` no longer exports `assertRosterCollectionIsNotDeep` (FIX-1549).
```

## Publication ownership

FIX-1549 publishes these after V4, V7 and VG pass. The durable-hire page is Workforce's; the two
architecture references are Engine's contract, beside the participants-map precedent they
share. Nothing under `apps/docs/docs/resources/` or the Core and Engine READMEs describes the
check today, so nothing there changes.

**Voice constraints to watch** (CLAUDE.md "Writing Style"): no issue numbers on the page, no
em-dash as a connector, no "This …" sentence openers, and no history ("used to refuse").
