# FIX-1538 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

FIX-1538 publishes the epic's shared durable-hire section ([epic DOCS.md](../../epics/FIX-1528/DOCS.md)),
reconciled with the page as it stands after the limits were narrowed on `main`, plus the stored-data
material only this issue owns. The epic's REMOVE is already done: both limits were rewritten, and
the operations below trim what the new section now says instead. Nothing here describes user
planes. Voice watch-outs for this topic: no "seamless", no sentences opening with "This", and
introduce "hired seat" and "pin" in plain words on first use.

## CREATE · `apps/docs/docs/workforce/durable-hire.md` · new section after "Hiring a seat only one member can reach": "Who can reach a hired seat"

> ## Who can reach a hired seat
>
> A hired seat belongs to the organization that hired it, and to the person who hired it when it
> is user-owned. The row records both, the seat is registered with them as its `pin`, and the
> framework compares every caller to that pin. It never reads them from the seat's address.
>
> Anyone outside that pair gets the answer an address your app does not serve would get:
>
> - Opening a session with the seat, or sending it an action, answers `404 Unknown flow`.
> - `GET /api/flows` leaves the seat out of the list.
> - A session opened earlier cannot be resumed from another organization.
> - A board in another organization cannot hand work to the seat. The hand-off is refused as if
>   the seat did not exist, and the task ends errored with that reason instead of staying claimed.
> - With debug endpoints switched on, the debug listing does not show another person's private
>   roster row.
>
> For example, Alice hires a user-owned `research` seat while signed in to Acme. Bob, also in
> Acme, cannot open it. Neither can Alice while she is signed in to Globex. If she wants a
> research seat there, she hires one in Globex, and it starts empty. If Bob hires his own, his
> starts empty too.
>
> **What a seat saves stays with its organization and its person.** Anything a seat stores for
> Alice in a user-scoped resource, or in `ctx.user.state`, while she works in Acme stays in Acme
> and stays hers. Her Globex seat of the same kind cannot read it, and neither can Bob's. Her
> other seats in Acme can, if they declare the same resource. A seat does not move between
> organizations, and there is no setting that makes it move.
>
> **The check is as strong as the principal your resolver returns.** "Who is asking" is the
> principal your [`resolvePrincipal`](../server/authentication.md) returns: a user and the
> organization they are signed in to. Use a resolver that verifies both, and install the same
> one on the host that serves the seat as on the flow that hires it.

## UPDATE · `apps/docs/docs/workforce/durable-hire.md` · § Limits, "Inside the organization, an address is not a permission"

Keep everything before its last sentence, "Outside the organization the seat is closed: …", and
replace that sentence with:

> Outside the organization the seat is closed. [Who can reach a hired seat](#who-can-reach-a-hired-seat)
> lists every door.

## UPDATE · `apps/docs/docs/workforce/durable-hire.md` · § Limits, "Listing flows shows every flow except hired seats to anyone"

Keep the bold lead, the two sentences after it, and the closing sentence. Replace the three
sentences about hired seats, from "A hired seat is listed only" to "listed the same way", with:

> A hired seat is listed only to callers who could open it, as described in
> [Who can reach a hired seat](#who-can-reach-a-hired-seat). A flow you register with a `pin`
> yourself is listed the same way.

## UPDATE · `apps/docs/docs/workforce/durable-hire.md` · § "What is stored, and where", new paragraph after the first

> What a seat saves for a person is stored separately from the roster, in a cell for the seat's
> organization and that person. The person's own data outside hired seats, such as preferences
> your app's other flows keep, is a different cell. A hired seat does not read it and cannot
> write to it. A seat whose kind isolates its user data per flow keeps that data under the seat's
> own address, as before.

## UPDATE · `apps/docs/docs/advanced/flow-isolation.md` · new subsection at the end of "The default: shared user and org state"

> ### Hired seats share within one organization
>
> A seat hired at runtime is registered with the organization that hired it. Its shared user
> data is kept per organization and person rather than per person, so what a seat saves for
> Alice in Acme is not what her seat in Globex reads. Alice's seats in Acme still share with each
> other, and your other flows share with each other, but the two groups do not share with each
> other. See [Hiring while the app runs](/docs/workforce/durable-hire#who-can-reach-a-hired-seat).

## UPDATE · `apps/docs/docs/resources/storage.md` · § "Who else can see a resource", the `flowIsolation: false` row

> | `flowIsolation: false` (the default at user and org scope) | every flow on the server, for that user or org. A [hired seat](/docs/workforce/durable-hire)'s user-scoped resources are shared only with that person's other seats in the same organization |

## UPDATE · `apps/docs/docs/workforce/built-in-worker.md` · § "What isolation does and does not give you", first paragraph

> `isolateUserState: true` keys each worker's storage on that worker's id, so two workers serving
> the same person do not read each other's memory. Leave it off and they share one, per
> organization for workers hired at runtime.

## CREATE · `apps/docs/docs/persistence/overview.md` · new section after "When to stop": "Hired seats' stored data"

> ## Hired seats' stored data
>
> A seat hired at runtime keeps what it saves for a person in a cell for its organization and
> that person, keyed `<person>:~org:<organization>` in the user scope. Data a seat saved before
> your upgrade is under the person's own id, where your other flows keep theirs. The server does
> not read it for the seat and does not move it, because only your records say which
> organization it came from. Until you copy it, each seat starts empty for each person.
>
> Copying is optional and offline, with writers quiesced and a backup taken, as in the procedure
> above.
>
> 1. **List the keys.** For each seat kind, the user-scoped resources it declares without
>    `flowIsolation: true`, and whether its user state is isolated. A key an app flow also
>    declares is copied, never moved.
> 2. **List the people and their organizations.** Hired seat addresses start with their
>    organization (`acme.research`, `acme.~alice.research`). Include seats you have since fired.
>
>    ```sql
>    SELECT user_id, COUNT(DISTINCT org_id) AS orgs, GROUP_CONCAT(DISTINCT org_id) AS which
>    FROM sessions WHERE flow_id IN (/* your hired seat addresses */)
>    GROUP BY user_id;
>    ```
>
>    On Postgres, use `string_agg(DISTINCT org_id, ',')` in place of `GROUP_CONCAT`.
>
> 3. **Copy, for people with one organization only.** SQLite, for Alice in Acme:
>
>    ```sql
>    INSERT INTO resource_state (scope_type, scope_id, resource_key, state, version, lifecycle)
>    SELECT scope_type, 'alice:~org:acme', resource_key, state, version, lifecycle
>    FROM resource_state
>    WHERE scope_type = 'user' AND scope_id = 'alice' AND resource_key IN (/* step 1 */);
>    ```
>
>    Do the same for `resource_content`, keeping the content as it is. If the seat kind does not
>    isolate user state, copy the `users` row too, with the new id in both the column and the
>    `id` inside `data`. A scope record is one blob, so it is copied whole.
> 4. **Leave everything else.** A person with seats in two or more organizations has one mixed
>    copy of their seats' data. Copying it into either organization would hand that organization
>    what the other one's seats saved, so it stays where it is, and those seats start empty. Note
>    each such person in your record of the upgrade.
>
> Ids containing `:` or `\` are escaped in the new key the same way as in the other keys on this
> page. The original rows stay; remove them only for keys no other flow declares, and only after
> you have read the copies back through a seat.
