# FIX-1475 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

Four operations. The new page is the one the
[epic's ownership table](../../epics/FIX-1455/DOCS.md) assigns here, including the durability
limits it states. Prose below is the proposed text, not a summary of it. Nothing in the
published prose names an issue, an epic or what prompted the change.

---

## CREATE · `apps/docs/docs/workforce/durable-hire.md`

> ```yaml
> ---
> title: Hiring while the app runs
> sidebar_position: 8
> sidebar_label: Hiring at runtime
> description: "Hire a seat into a running app and have it still be there after a restart. The roster is stored per organization, alongside everything else the app keeps."
> ---
> ```
>
> # Hiring while the app runs
>
> A `WORKER.md` file declares a seat and the app reads it when it starts. That is the usual way
> to describe a team, and it does not change. But some teams are not known when the app is
> built: a customer signs up and needs their own set of workers, or someone adds a seat from a
> screen rather than from a text editor. For that you hire at runtime.
>
> A seat hired this way is written down. It is still there after a restart, a redeploy, or a
> crash, because it lives in the same storage the app already uses for sessions and state.
>
> ## Hiring a seat
>
> Hiring is an ordinary flow action, so it authenticates the same way everything else does.
> Send the seat's id, the flow kind it runs, and whatever settings that kind declares.
>
> ```bash
> curl -X POST localhost:3000/api/flows/workforce-admin/actions/hire \
>   -H 'content-type: application/json' \
>   -d '{"userId":"you","orgId":"acme",
>        "input":{"seatId":"support.ada","flow":"desk-clerk",
>                 "settings":{"desk":"front"},
>                 "instructions":"You work the front desk."}}'
> ```
>
> The seat answers immediately, on the same route as any other flow. Its address carries the
> organization that hired it:
>
> ```bash
> curl -X POST localhost:3000/api/flows/acme.support.ada/actions/answer \
>   -H 'content-type: application/json' \
>   -d '{"userId":"you","orgId":"acme","input":{"note":"is the printer fixed?"}}'
> ```
>
> The organization is part of the address because two organizations can both want a seat called
> `support.ada`, and an app serves one flat set of addresses. It identifies the seat. It does
> not authorize anything: who may call it is still decided by the principal on the request.
>
> ## Firing a seat
>
> ```bash
> curl -X POST localhost:3000/api/flows/workforce-admin/actions/fire \
>   -H 'content-type: application/json' \
>   -d '{"userId":"you","orgId":"acme","input":{"seatId":"support.ada"}}'
> ```
>
> The address stops answering and the seat does not come back on the next start. Work that was
> already running finishes and is saved. Nothing is cancelled and nothing is truncated.
>
> Firing removes the seat, not its history. Sessions, state and resources it wrote are left
> alone. If you want those gone, delete them yourself.
>
> You can only fire a seat your organization hired. A seat declared in a `WORKER.md` file is
> removed by editing that folder, not through this action.
>
> ## What is stored, and where
>
> One row per seat, in an organization-scoped collection at `workforce/roster/<seatId>`. It
> holds what the hire supplied: the flow kind, the settings, and the instructions. It is read
> through the same storage adapter as everything else the app persists, so a Postgres-backed app
> keeps its roster in Postgres and an in-memory app keeps it for as long as the process lives.
>
> Seats hired this way also appear in the [live inventory](inventory.md), the same as seats
> declared in files. Anything browsing a workforce sees both without knowing which is which.
>
> ## Limits worth knowing before you build on this
>
> **A new seat is served by the process that hired it. Other processes pick it up when they next
> start.** If your app runs on several instances, or on a platform that starts a fresh instance
> per request, a seat hired a moment ago may answer on one and not yet on another. The stored
> row is the real roster; what a process serves is that row, loaded when it started. Plan for a
> short window rather than an instant one, or restart after hiring if you need every instance in
> step.
>
> **A restart may serve fewer seats than the roster names, and it says so.** If a stored seat
> names a flow kind the current code no longer has, or carries settings that kind no longer
> accepts, that seat is skipped. The app starts, every other seat answers, and the skipped ones
> are reported with the reason. The skipped row is left exactly as it was: nothing is repaired
> or deleted on your behalf. Fix it by putting the kind back, or by firing the seat.
>
> **If the roster cannot be read, the app refuses to start.** A storage failure is usually
> temporary, and a process that fails to start is retried, so whatever was already serving keeps
> serving. The alternative would be an app that comes up looking healthy with a team quietly
> missing, which is worse and much harder to notice.
>
> **There is a cap on how many organizations are reloaded at start.** Past it the app refuses to
> start rather than loading the first few, for the same reason: a partial roster that looks
> complete is the failure being avoided. Raise the cap deliberately if you need to.
>
> **Listing flows is not filtered by organization.** `GET /api/flows` returns every registered
> instance, including seats other organizations hired. Filter in your own code if you show that
> list to a customer.
>
> **A seat that declares a webhook provider is checked at start.** Hire one at runtime whose
> provider the app did not configure and the mismatch is not reported until the next restart.
>
> ## Migrating
>
> Nothing to migrate. Apps that declare their whole team in files behave exactly as before:
> those seats are still read at start, still fail the start when a file is wrong, and are not
> affected by anything on this page.

---

## UPDATE · `packages/engine/README.md` · after the flow registration section

> ### Registering a flow after startup
>
> `createFlowState({ flows })` takes the flows an app knows about when it starts. To add one
> later, register it:
>
> ```ts
> flowstate.register(seat);      // one instance, or an array
> flowstate.unregister(seat.id); // returns false if nothing was registered under that id
> ```
>
> Registration runs the same checks construction does: a duplicate id is refused, and so is a
> flow whose user- or org-scoped schemas conflict with one already registered. A refused
> registration changes nothing.
>
> The registry is read once per request, so a flow registered here is served from the next
> request onward, in this process. A request already running is unaffected either way: it holds
> the flow instance it resolved, so unregistering does not cancel it, shorten its stream, or
> discard what it wrote. A request that arrives after an `unregister` gets the same answer it
> would in a process that never had the flow.
>
> Two things go stale, and both are worth knowing. Anything that reads the flow list and caches
> it will miss later registrations, so read per request. And an adapter that validates flows when
> it starts — the webhook adapter checks that every declared provider is configured — has already
> run, so a flow registered afterwards is not checked until the next start.

---

## UPDATE · `packages/workforce/README.md` · after "Reading a workforce from files"

> ## Hiring at runtime, and reloading at boot
>
> `hireWorkforce` turns records into flow instances, whether those records came from files or
> from somewhere else. To keep a runtime hire across restarts, store it and read it back.
>
> ```ts
> import { defineHiredRosterCollection, reloadHiredSeats } from "@flow-state-dev/workforce";
> ```
>
> `defineHiredRosterCollection()` is an org-scoped resource collection at
> `workforce/roster/*`, one row per hired seat. Install it under the block that does the
> hiring, and write a row before you register the seat. The collection's create-if-absent write
> is what refuses a second hire of the same seat, so you do not need a check of your own.
>
> `reloadHiredSeats` reads those rows back when the app starts:
>
> ```ts
> const { seats, skipped } = await reloadHiredSeats({
>   stores,           // the runtime's resolved stores
>   orgIds,           // which organizations to reload; you decide the policy
>   kinds,            // the same kinds map you pass to hireWorkforce
> });
> ```
>
> It takes the organizations rather than discovering them, because which organizations an app
> reloads is the app's decision and not one this package can make for it.
>
> `skipped` is the part to handle rather than log. A row naming a kind you no longer ship, or
> carrying a setting that kind no longer accepts, comes back here with its reason instead of
> throwing: the other seats still hire and the app still starts. The row is left as it was.
>
> A read the store will not complete rejects, and a set of organizations larger than the cap
> rejects too, naming both numbers. Neither returns a partial roster, because a short roster
> that looks complete is the failure this is guarding against.

---

## UPDATE · `apps/kitchen-sink/README.md` · extending "The support team (`workforce/`)"

> Seats can also be hired while the app is running, which is the other half of the
> demonstration. `support.ada` and the rest are declared in files. A seat hired over
> `workforce-admin`'s `hire` action is written to the database instead, addressed with its
> organization (`acme.support.ada`), and is still there after `pnpm build && pnpm start`.
>
> ```bash
> pnpm fsdev run workforce-admin hire -i '{"seatId":"support.bo","flow":"desk-clerk","settings":{"desk":"back"},"instructions":"You work the back desk."}'
> ```
>
> Restart the app and ask it something. The reload runs at startup, before the app serves
> anything, and reports any seat it could not bring back.

---

## Publication ownership

Published with the implementation, after the goal check passes: the limits section above makes
claims about failure behavior, and those are reconciled against the run rather than against the
plan ([PLAN.md → Docs](PLAN.md#docs)). PR-A carries the two package READMEs; PR-B carries the
new page and the kitchen-sink README.

The Workforce overview's shared *"What a Workforce app looks like"* section and its
Related-pages entries are **not** this issue's — the
[epic's ownership table](../../epics/FIX-1455/DOCS.md) assigns them to FIX-1477, after this
page exists. Link this page from there; do not repeat it. The page's sidebar position is
provisional and the wrap's docs-polish pass may reorder the section.
