# FIX-1790 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

FIX-1790 owns "which org a user's record belongs to" in the epic's ownership table
([epic DOCS.md](../../epics/FIX-1786/DOCS.md#ownership)). Every page below describes user data as
one record per user per organization, which is now true for every flow, so the hired-worker
exceptions on these pages go. Voice watch-outs: describe what the framework does, not what it
used to do, except inside the upgrade section; no sentence opens with "This"; introduce "user
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
> user per worker, still inside the organization. A resource's own `flowIsolation` decides which
> applies; a resource that doesn't set it follows the flow's `isolateUserState`.
>
> If you are upgrading an app that already saved user data, see [Upgrading: moving user data into
> its organization](../persistence/overview.md#upgrading-moving-user-data-into-its-organization).

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

## CREATE · `apps/docs/docs/persistence/overview.md` · "Upgrading: moving user data into its organization", replacing "Upgrading: moving hired seats' stored data"

> ## Upgrading: moving user data into its organization
>
> This section is for apps that saved user data on an earlier release. A new install can skip it.
>
> User data is kept per user and organization: the user record and every user-scoped resource
> live under `<user>:~org:<organization>`, and a flow-isolated one under
> `<user>:~org:<organization>:<flow id>`. An earlier release kept them under the user's id
> alone, `<user>`, or `<user>:<flow id>` when flow-isolated, one cell across every
> organization. The server reads none of those older cells, in any organization, and does not
> move them, because one cell may hold what a user saved in two organizations. Until you copy
> it, each user starts empty in each organization. Nothing is deleted.
>
> Hired workers already kept their shared data per organization. Those cells are where they belong
> and need nothing.
>
> Copying is offline: stop the writers, schedulers included, before you start the new release,
> take a backup, and work on the copy, as in [Who owns a record](#who-owns-a-record). A user who
> writes before you copy leaves data in the destination, and the copy stops for them.
>
> 1. **List the old cells.** Every user-scope `scope_id` in `resource_state` and
>    `resource_content`, and every `users.id`, that has no `:~org:` in it. A cell with no `:`
>    outside an escape is a user's shared cell; one with exactly one such `:` is
>    `<user>:<flow id>`. Read the raw rows, so deletion markers and content-only rows show up.
> 2. **Find the organization each cell was written in.** Run [Attributing organizations,
>    once](#which-organization-a-record-belongs-to) first if any session still has no
>    organization. For a shared cell and the user record, every session of that user could have
>    written it. SQLite:
>
>    ```sql
>    SELECT user_id, COUNT(DISTINCT org_id) AS orgs, SUM(org_id IS NULL) AS unknown,
>           MIN(org_id) AS org
>    FROM sessions GROUP BY user_id;
>    ```
>
>    For a flow-isolated cell, only that user's sessions on that flow. If a collection flow
>    still has sessions with no `flow_id`, finish [Attributing owners, once](#who-owns-a-record)
>    first; until you do, the user's isolated cells on that flow are a stop. After it, a
>    session with no `flow_id` is an ordinary single flow's, named by its `flow_kind`:
>
>    ```sql
>    SELECT user_id, COALESCE(flow_id, flow_kind) AS flow, COUNT(DISTINCT org_id) AS orgs,
>           SUM(org_id IS NULL) AS unknown, MIN(org_id) AS org
>    FROM sessions GROUP BY user_id, COALESCE(flow_id, flow_kind);
>    ```
>
>    On Postgres, write `COUNT(*) FILTER (WHERE org_id IS NULL)` for `unknown`. A deleted
>    session leaves no row, so these counts only see the sessions you still have. A cell is
>    attributed when `orgs` is one, `unknown` is zero, and you can vouch for the rest: no
>    session of that user was ever deleted, or your own records never placed them in another
>    organization. Anything else, including a user with no sessions left, is a
>    `migration-required` stop for that cell: write it down and leave it.
> 3. **Check the destination.** The same raw read at `<user>:~org:<organization>` (and the flow
>    id after it, for an isolated cell). If any key is already there, stop for that user and
>    write the keys down. Do not overwrite, and do not merge.
> 4. **Copy.** For each attributed cell, in one transaction, copy its rows to the new `scope_id`
>    with the resource key, state, version, lifecycle and content exactly as they are. SQLite,
>    for Alice in Acme:
>
>    ```sql
>    INSERT INTO resource_state (scope_type, scope_id, resource_key, state, version, lifecycle)
>    SELECT scope_type, 'alice:~org:acme', resource_key, state, version, lifecycle
>    FROM resource_state WHERE scope_type = 'user' AND scope_id = 'alice';
>    ```
>
>    Do the same for `resource_content`, and copy the `users` row with its `id`, and the `id`
>    inside its data, set to the new key. Postgres takes the same statements;
>    [Moving a copy's private data, per adapter](#moving-a-copys-private-data-per-adapter) covers
>    the filesystem store and custom stores.
> 5. **Rebuild the schedule index** for every user whose cell held schedules: write each copied
>    schedule once from its new cell, and remove the index rows whose cell is an old one, or the
>    schedule fires twice. A schedule in an old cell does not fire until you do. If a cloud
>    scheduler or BullMQ holds a job per schedule, re-register it: the dispatch id now names the
>    organization, `<orgId>/<userId>/<key>`.
> 6. **Read back, then start the writers.** Every attributed cell has its copy, every stop is
>    written down, and a user's data reads through a flow in the organization it went to and
>    not in another.
>
> Ids containing `:` or `\` are escaped in every key the same way, a backslash before each. The
> original cells stay. They are read by nothing, and you can remove them once the copies have
> read back.
>
> [When to stop](#when-to-stop) applies here unchanged.

And in "Attributing organizations, once", step 3, the paragraph that begins "User-scope storage
does not move" is removed: user data now moves with its organization, by the section above.

## UPDATE · `packages/engine/README.md` and `packages/scheduled/README.md`

The engine's scope-key section: `resolveUserStorageKey(userId, orgId, flow)` returns
`<userId>:~org:<orgId>`, or `<userId>:~org:<orgId>:<flow id>` when the flow isolates user
state, and throws on a missing or blank `orgId`; the owner-pinned paragraph is removed. The
scheduled README's hand-written resolver matches the `scheduled.md` example above.

## Publication ownership

FIX-1790 publishes all of the above after V7 has walked the step on a SQLite file and on Postgres,
and VG has passed. Only statements V7 ran are published. The Workforce overview and glossary stay FIX-1796's; FIX-1788 owns the hire pages' move to
worker terms, and builds on this section's cell.
