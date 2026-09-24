# FIX-1549 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

The owner-private collection is new public API, so it gets a user-facing section. Workforce's
pages say it uses that primitive. Engine's references drop Workforce's words. No new page.
Each block names the PR that publishes it ([PLAN](PLAN.md#the-pr-plan)).

## PR-A · UPDATE · `apps/docs/docs/resources/collections.md` · new section "Owner-private collections", after "Parameterized patterns"

> ## Owner-private collections
>
> Sometimes a row belongs to one person and nobody else in the org should see it, not even
> through a wider collection that happens to match its key. Declare the collection
> owner-private and name the parameter that holds the owner:
>
> ```ts
> import { defineResourceCollection, ownerSegment } from "@flow-state-dev/core";
>
> const drafts = defineResourceCollection({
>   pattern: "drafts/[owner]/[id]",
>   ownerPrivate: { param: "owner" },
>   scope: "org",
>   stateSchema: draftSchema,
> });
>
> // in a block
> await ctx.resources.drafts.create({ owner: ownerSegment(ctx.session.identity.userId), id: "q3-plan" }, state);
> ```
>
> `ownerSegment(userId)` turns a user id into one key segment that starts with `~`. The
> collection serves a row only to the user its owner segment names. For everyone else the row
> is not there: lists and counts leave it out, `getOptional` returns nothing, and `get` or any
> write throws "A row of an owner-private collection is readable only by the user it belongs to."
>
> **No other collection can reach those rows.** A key segment starting with `~` is reserved for
> owner-private collections in every app. A wider collection such as `[tenant]/**` lists without
> them, and a write to one through it is refused. That holds in any process over the same store,
> including a worker that never loaded the owner-private collection.
>
> **Overlaps fail at startup.** Once a flow declaring an owner-private collection is registered,
> the app refuses to start if any flow declares a collection in the same scope whose pattern
> could reach its keys, whichever registers first:
>
> ```
> Collection pattern "[tenant]/**" can reach the rows of owner-private collection
> "drafts/[owner]/[id]". Only that collection reads or writes them, each for the user it belongs to.
> ```
>
> Declaring the same owner-private collection on several flows is fine, and so is a collection
> in another scope, which can't reach these rows.
>
> **Limits.** The pattern must declare the named parameter exactly once and must not use `**`.
> An owner-private collection has no browser read: `client.state.read`, `client.content.read`
> and `client.content.prefetch` are each refused when it is defined, so the browser routes never
> return its rows. A key's first segment starting with `~` is its owner, so no segment before
> the owner parameter may start with `~`; segments after it may. Don't use `~` at the start of a
> key segment anywhere else.

## PR-A · UPDATE · `apps/docs/docs/workforce/durable-hire.md` · "Hiring a seat only one member can reach", after the paragraph ending "each seat's `ownerPin` carries the user."

Replaces #2196's paragraphs there. In the paragraph after the code sample ("The private
collection reaches only the calling user's own rows…"), the quoted error becomes
`A row of an owner-private collection is readable only by the user it belongs to.`

> The private roster collection is an
> [owner-private collection](../resources/collections.md#owner-private-collections): each row's
> owner segment is the member who hired the seat. So a row is served only to that member, in
> every process over the store, and no other collection in your app can list or write it.
>
> Once a flow declaring the private collection is registered, the app refuses to start if any
> flow declares an org-scoped collection that could reach a user-owned row: `workforce/roster/**`,
> `workforce/roster/[owner]/notes`, a copy of `workforce/roster/[owner]/[seat]`, or a wide
> pattern such as `[tenant]/**`. For the org roster, declare `workforce/roster/*`, which only
> ever sees org-visible rows.

## PR-A · UPDATE · `packages/workforce/README.md` · the `defineHiredRosterPrivateCollection()` row

Replace the row's last two sentences with:

> It is an owner-private collection (`ownerPrivate: { param: "owner" }`): a row is served only
> to the member it belongs to, and any other collection whose pattern can reach those rows is
> refused at startup. Declare `workforce/roster/*` for the org roster.

## PR-A · UPDATE · `docs/architecture/resources-and-client-data.md` · new subsection "Owner-private collections"

> A collection declaring `ownerPrivate: { param }` owns every key whose first segment beginning
> `~` sits at that parameter. Core validates the declaration's shape at definition (the
> parameter occurs exactly once, no `**`, no browser read of state or content). Engine enforces
> it in one module, with two fences:
>
> - **The key fence, always on.** A key's first segment beginning `~` is its owner. A key with
>   one is served only through an owner-private collection, only when that segment sits at its
>   owner parameter, and only to the user `ownerSegment` encodes there. Later `~` segments are
>   data. Every other collection lists without it, reads it as absent and is refused on write:
>   through the resource handle, the request-start seed cache, projected collections, the
>   browser resource routes, `/state` and the debug endpoints. It reads only the key, so it holds
>   in every process over the store.
> - **The startup fence, armed by a declaration.** Once `FlowRegistry` holds a flow declaring an
>   owner-private collection, it refuses any flow declaring another collection in the same scope
>   whose pattern can reach its keys, checking flows it already holds and every later one. It is
>   never cleared, even across unregister, for the reason the participants map is kept: the rows
>   outlive the registration.
>
> Workforce's private roster collection is the first consumer. Engine knows it only as an
> owner-private collection.

## PR-A · UPDATE · `docs/contributing/architecture-reference.md` · "Resources and Client Data", new bullet

> - A key segment beginning `~` belongs to an owner-private collection (`ownerPrivate: { param }`),
>   in every app: no other collection reads or writes it, and a key's first one names its owner.
>   A registry that has held one refuses, for good, any flow whose collection in the same scope
>   can reach its keys →
>   [Resources and client data](../architecture/resources-and-client-data.md#owner-private-collections)

## PR-B · UPDATE · Engine's references to the instance pin

- `packages/engine/README.md`: "**Hired seats.**" becomes "**Owner-pinned instances.**", and its
  first sentence reads "A flow registered with an owner `pin` …" with no seat. One closing
  sentence: "Workforce pins each hired seat this way."
- `docs/architecture/state-and-scopes.md`: the heading "The hired-seat cell" becomes "The
  owner-pinned cell"; the prose says "an owner-pinned instance" where it says "a seat", and names
  Workforce's hired seat once as the instance that uses it. Update both anchors that point at it
  (`state-and-scopes.md` line ~510 and `authentication.md` line ~135), per BP-034.
- `docs/architecture/authentication.md`: `InstancePinMismatchError`'s reasons are
  `"owning-org"` and `"owning-user"`.

## Changesets

- **PR-A** · `@flow-state-dev/core` minor, `@flow-state-dev/engine` minor, `@flow-state-dev/workforce` minor
  (its refusal strings change, which a consumer can trip over):

  ```md
  Resource collections can be declared owner-private with `ownerPrivate: { param }`, and `ownerSegment(userId)` builds the owner key segment. Key segments beginning `~` are reserved for owner-private collections in every app. `defineResourceCollection` and flow registration no longer refuse collection patterns on Workforce's account, and `@flow-state-dev/core` no longer exports `assertRosterCollectionIsNotDeep`. Workforce's private roster collection is now owner-private; its refusal messages name the owner-private collection instead of the roster.
  ```
- **PR-B** · `@flow-state-dev/engine` minor: `InstancePinMismatchError.reason` is `"owning-user"` where it was `"roster-owner"`.
- **PR-C** · `@flow-state-dev/core` minor, `@flow-state-dev/workforce` patch (it gains the two exports): the roster patterns move to `@flow-state-dev/workforce`; `HIRED_ROSTER_PRIVATE_BRAND`, `markHiredRosterPrivateCollection` and `isHiredRosterPrivateCollection` are removed.

## Publication ownership

The collections page and the resources architecture reference are Core and Engine's contract. The
durable-hire page and Workforce's README are Workforce's. **Voice constraints** (CLAUDE.md
"Writing Style"): no issue numbers on the pages, no em-dash as a connector, no "This …" openers,
no history ("used to refuse").
