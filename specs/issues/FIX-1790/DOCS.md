# FIX-1790 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

FIX-1790 owns "which org a user's record belongs to" in the epic's ownership table
([epic DOCS.md](../../epics/FIX-1786/DOCS.md#ownership)). Every page below describes user data as
one record per user per organization, which is now true for every flow, so the hired-worker
exceptions on these pages go. Voice watch-outs: describe what the framework does, not what it
used to do; no sentence opens with "This"; introduce "user
scope" and "flow isolation" in plain words where a page meets them first.

## UPDATE · `apps/docs/docs/fundamentals/state-and-scopes.md` · the scope table, the figure's alt text, and "User"

The table row:

> | **User** | What does this user need across their conversations in one organization? | Across sessions for a user, per organization |

The figure's sentence about user state, in the alt text and in `state-scopes.svg`:

> User state follows one user across conversations and flows inside one organization, keyed by
> the user and the organization; with isolateUserState it is one record per flow copy instead.

Replacing the paragraph after the `userStateSchema` example:

> User data belongs to a user inside one organization. Alice in Acme and Alice in Globex have
> two user records, and two copies of every user-scoped resource, so nothing she saves while
> working for one organization shows up in the other. Inside one organization, every flow on the
> server shares her one record, so each flow's user state schema is compared at startup.
> Incompatible declarations throw `CrossFlowSchemaConflictError` from `FlowRegistry.register`
> before any data can be corrupted. [Flow Isolation](/docs/advanced/flow-isolation) gives each
> flow copy its own record instead, still inside the organization.

In "Multi-tenant isolation", the sentence "so they key on `userId` / `orgId` alone" becomes:

> so they key on the user and organization, or the organization alone, and not on the tenant.

## UPDATE · `apps/docs/docs/advanced/flow-isolation.md` · "The default", and REMOVE "Hired seats share within one organization"

> ## The default: shared user and org state
>
> Every flow you register on a server reads from and writes to the same `UserRecord` for a
> given user in a given organization. Same for org. Sessions and requests are different:
> those carry the flow's identity and stay separate per flow.
>
> The organization is part of the user's key. What a flow saves for Alice while she works in
> Acme is not what any flow reads for her in Globex. Inside one organization, a [hired
> worker](/docs/workforce/durable-hire) shares Alice's record with your other flows, like any
> two flows do.

The "Hired seats share within one organization" subsection is removed; the paragraph above says
what it said, for every flow.

## UPDATE · `apps/docs/docs/workforce/durable-hire.md` · "What a seat saves for a person"

The figure loses its third place (the user's data "outside hired seats"), and its alt text
becomes:

> Where a hired worker keeps what it learns about alice. Inside the acme organization: one cell for
> alice in acme, holding her user record and her shared user-scoped resources, which every flow
> in acme uses, hired workers included; and one cell per hired worker for flow-isolated data, such as alice
> in acme for acme.support.ada. In globex, alice has a separate cell of her own, which nothing in
> acme reads. A projected resource is stored by your own hooks, so key its rows by the
> organization too.

> A hired worker keeps what it learns about a user in the same place every flow in the organization
> does: one cell for that user in that organization. With flow isolation, it keeps one cell per
> user per hired worker, still inside the organization. A resource's own `flowIsolation` decides which
> applies; a resource that doesn't set it follows the flow's `isolateUserState`.

## UPDATE · `apps/docs/docs/resources/projected-collections.md` · the first example, and one paragraph after it

The two hooks key by organization as well (`orgId: ctx.orgId` beside `userId: ctx.userId` in
both queries), and after the example:

> A user-scoped collection belongs to a user inside one organization, the same as the user data
> the framework stores. Your hooks receive both `ctx.userId` and `ctx.orgId`. Use both in every
> query, or a user sees in one organization what they saved in another.

## UPDATE · `apps/docs/docs/server/scheduled.md` · "Schedules on a hired seat" becomes "Schedules in a user's data"

> ### Schedules in a user's data
>
> A schedule saved in a user-scoped collection belongs to a user inside one organization. Use
> `createResourceCollectionScheduleResolver` there. Its schedule id names the organization, the
> user and the key, `<orgId>/<userId>/<key>`. It reads the row from that user's data in that
> organization, and returns `null` when the id names no organization or the row names a different
> one. On a hired worker only one member can reach, it also returns `null` for an id naming another user.
>
> If you write the resolver by hand, pass the organization to `resolveUserStorageKey` from
> `@flow-state-dev/engine`. It throws when the organization is missing or blank:
>
> ```ts
> resolve: async (scheduleId, ctx) => {
>   const [orgId, userId, key] = scheduleId.split("/").map(decodeURIComponent);
>   const scopeId = resolveUserStorageKey(userId, orgId, { id: ctx.flowKind, isolateUserState: false });
>   const row = await ctx.stores.resourceState.get("user", scopeId, `schedules/${key}`);
>   if (row?.state.orgId !== orgId) return null;
>   // map its `kind` to a block, return the config as above
> }
> ```

## UPDATE · `apps/docs/guides/scheduled-dynamic.md` · the id format, both dispatch URLs, and the impersonation guard

Every `<userId>/<key>` becomes `<orgId>/<userId>/<key>`, and both example URLs add the segment
(`/schedules/${row.orgId}/${row.userId}/${row.key}/dispatch`, `${orgId}/${userId}/${key}`). The
guard's paragraph:

> The default helper parses `<orgId>/<userId>/<key>` from the URL and reads the resource from
> that user's data in that organization. The storage key is the guard: a request like
> `/schedules/acme/u_evil/k/dispatch` reads u_evil's data in acme, and finds nothing unless
> u_evil saved a schedule there. A row found under one organization that names another is
> refused too, so an id cannot fire a schedule into an organization its creator didn't choose.

## REMOVE · `apps/docs/docs/persistence/overview.md` · "Upgrading: moving hired seats' stored data"

The section goes, with nothing in its place: there is no upgrade page ([epic D9](../../epics/FIX-1786/DECISIONS.md#d9)). In "Attributing
organizations, once", step 3, the paragraph that begins "User-scope storage does not move" is
removed too: it describes the cross-org user key this issue removes, and links to the removed
section.

## UPDATE · `packages/engine/README.md` and `packages/scheduled/README.md`

The engine's scope-key section: `resolveUserStorageKey(userId, orgId, flow)` returns
`<userId>:~org:<orgId>`, or `<userId>:~org:<orgId>:<flow id>` when the flow isolates user
state, and throws on a missing or blank `orgId`; the owner-pinned paragraph is removed. The
scheduled README's hand-written resolver matches the `scheduled.md` example above.

## Publication ownership

FIX-1790 publishes all of the above after VG has passed. The Workforce overview and glossary stay FIX-1796's; FIX-1788 owns the hire pages' move to
worker terms, and builds on this section's cell.
