---
title: Hiring while the app runs
sidebar_position: 8
sidebar_label: Hiring at runtime
description: "Store a seat hired at runtime, address it per organization, and read the roster back when the app next starts. What the framework gives you, and the admin action you build on top of it."
---

# Hiring while the app runs

A `WORKER.md` file declares a seat and the app reads it at start. That covers a team you know about when you build the app. Some teams you don't: a customer signs up and needs their own set of workers, or someone adds a seat from a screen rather than from a text editor.

For those, you hire while the app is running and write the seat down, so it is still there after a restart, a redeploy, or a crash.

**Hiring at runtime happens over an action you write and guard yourself.** The framework gives you the storage, the address, and the read-back at the next start. The HTTP route that hires, and whatever credential stands in front of it, are yours to build. The `workforce-admin` flow this page walks through is a worked example to copy and adapt, not something the framework ships or that an environment variable switches on.

Seats declared in `WORKER.md` files are unaffected by anything here. They are still read at start, and removing one is still a matter of editing its folder.

## What the framework gives you

All from `@flow-state-dev/workforce`:

| Call | What it does |
| --- | --- |
| `defineHiredRosterCollection()` | Declares the stored roster: an organization-scoped resource collection at `workforce/roster/*`, one row per hired seat. Takes no options. |
| `seatAddress(orgId, seatId, ownerUserId?)` | The address a hired seat answers on. Org-visible seats are `<orgId>.<seatId>`. A user-owned seat is `<orgId>.~<user>.<seatId>`, with the user escaped, so two people can hire the same seat id. Throws when the organization id is not a single address segment, or when the seat id starts with `~`. |
| `hireWorkforce(records, { kinds })` | Turns records into configured flow copies, one per record. The same call the file-declared roster goes through. |
| `reloadHiredSeats({ stores, orgIds, kinds })` | Reads every stored row back at the next start and hires what it names. Returns `{ seats, problems }`. It registers nothing. |

Two smaller helpers appear in the example below: `toHiredSeatRow` builds a stored row out of what a hire supplied, and `hiredSeatManifest` turns a row back into the record `hireWorkforce` takes.

What you write around all of them: the action that hires, the credential that decides who may call it and which organization they hire into, the call to `flowstate.register()` that puts a minted seat on the air, and the policy for which organizations a start reloads.

## Hiring a seat

Every seat runs a **flow kind**: one of the flows your app defines, named in a map you pass to `hireWorkforce`, and the same thing a `WORKER.md` names with `flow:`. [Workers on disk](./workers-on-disk.md#when-a-worker-needs-more-than-settings) covers writing one.

A hire is a handler in a flow of your own, and the order it works in matters. Refuse what you can refuse before anything is written. Mint the seat, which is where the flow kind's own settings schema runs. Write the row. Register. If registering fails, delete the row you just wrote, so a hire that failed leaves nothing behind.

The three files below go in your app's own source tree, under `src/flows/`, where `fsdev run` looks for flows. None of them belongs in a `workforce/` tree.

```ts title="src/flows/workforce-admin/hire.ts"
import { handler } from "@flow-state-dev/core";
import type { JsonObject } from "@flow-state-dev/core";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import {
  hireWorkforce,
  hiredSeatManifest,
  seatAddress,
  toHiredSeatRow,
} from "@flow-state-dev/workforce";
import { z } from "zod";

import { deskClerkFlow } from "../desk-clerk/flow";
import { registerSeat } from "./registry-access";

/** The kinds a hire may name. Pass this same map to `reloadHiredSeats`. */
export const kinds = { "desk-clerk": deskClerkFlow };

export const hireSeat = handler({
  name: "hire-seat",
  inputSchema: z.object({
    seatId: z.string().min(1),
    flow: z.string().min(1),
    settings: z.record(z.unknown()).default({}),
    instructions: z.string().optional(),
  }),
  outputSchema: z.object({ address: z.string(), orgId: z.string() }),
  execute: async (input, ctx) => {
    // From the verified principal. The request body never decides this.
    const orgId = ctx.org?.identity.orgId ?? ctx.org?.identity.id;
    if (!orgId) throw new Error("This credential resolves no organization.");

    const address = seatAddress(orgId, input.seatId);
    if (!Object.hasOwn(kinds, input.flow)) {
      throw new Error(`This app carries no flow kind "${input.flow}".`);
    }

    const row = toHiredSeatRow({
      seatId: input.seatId,
      flow: input.flow,
      settings: input.settings,
      instructions: input.instructions ?? null,
    });

    // Minted from exactly what will be stored, so the row can rebuild the seat
    // at the next start. The kind's settings schema runs here, before any write.
    const record = hiredSeatManifest(orgId, row);
    if ("problem" in record) throw new Error(record.problem);
    const [seat] = hireWorkforce([record.manifest], { kinds });
    if (!seat) throw new Error(`"${address}" could not be hired.`);

    const roster = ctx.resources.roster as unknown as ResourceCollectionRef;

    // `create()`, never `upsert()`. Its already-exists throw is what refuses a
    // second hire of the same seat, including two arriving at once.
    await roster.create(input.seatId, row as unknown as JsonObject);

    try {
      registerSeat(seat, record.manifest.ownerPin);
    } catch (error) {
      await roster.delete(input.seatId);
      throw error;
    }

    return { address, orgId };
  },
});
```

A row holds the seat's id within its organization, the flow kind, the settings bag, and the instructions. The settings bag is stored and handed back verbatim, including keys a later version of the kind adds, because it belongs to that kind's schema rather than to the roster's.

`registerSeat` exists because the flow needs the `FlowState` it is itself registered on, and importing that directly is a cycle. Install it instead:

```ts title="src/flows/workforce-admin/registry-access.ts"
import type { FlowInstance, InstanceOwnerPin } from "@flow-state-dev/core/types";
import type { FlowState } from "@flow-state-dev/engine";
import { registerHiredSeat } from "@flow-state-dev/workforce";

let app: FlowState | undefined;

/** Call once, immediately after `createFlowState`. */
export function useFlowState(next: FlowState): void {
  app = next;
}

export function registerSeat(seat: FlowInstance, pin?: InstanceOwnerPin): void {
  const state = app;
  if (!state) throw new Error("No FlowState to register into.");
  registerHiredSeat((instance, owner) => state.register(instance, { pin: owner }), seat, pin);
}

export function releaseSeat(id: string): boolean {
  return app?.unregister(id) ?? false;
}
```

### The organization has to come from the credential

The organization comes from the credential, not from the request body. A hire writes durable state that belongs to an organization, so it has to come from something the framework can trust. Configure [`resolvePrincipal`](../server/authentication.md) on the flow and the action's `orgId` comes from there; an `orgId` in the body is ignored. A hired seat is pinned to that organization, so the host that serves the seat needs the same resolver. The framework default resolver does not name one, and opening the seat answers `404 Unknown flow` even for the person who hired it.

```ts title="src/flows/workforce-admin/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import { defineHiredRosterCollection } from "@flow-state-dev/workforce";
import { extractBearerToken, PrincipalResolutionError } from "@flow-state-dev/engine";

import { fireSeat } from "./fire";
import { hireSeat } from "./hire";

/** Your own scheme. This one reads `<org>:<token>` pairs out of the environment. */
const orgByToken = new Map(
  (process.env.ADMIN_CREDENTIALS ?? "")
    .split(",")
    .filter(Boolean)
    .map((pair) => {
      const at = pair.indexOf(":");
      return [pair.slice(at + 1), pair.slice(0, at)] as const;
    })
);

const workforceAdmin = defineFlow({
  kind: "workforce-admin",
  requireUser: true,
  authentication: {
    requireUser: true,
    resolvePrincipal: ({ request }) => {
      const token = extractBearerToken(request?.headers?.get("authorization") ?? null);
      const orgId = token === null ? undefined : orgByToken.get(token);
      if (!orgId) {
        throw new PrincipalResolutionError("Invalid admin credential.", { status: 401 });
      }
      return { userId: "workforce-admin", orgId };
    },
  },
  resources: { roster: defineHiredRosterCollection() },
  actions: {
    hire: { block: hireSeat },
    fire: { block: fireSeat },
  },
});

export default workforceAdmin();
```

Give each organization its own token. A token written against two organizations resolves whichever one the parser saw last, so a copy-paste in an environment variable turns into a cross-tenant decision. Drop every binding for a token that names more than one, rather than picking a winner.

Register the flow only when a usable credential is configured. Then a deployment that has none has no hire route at all, and a call to `/api/flows/workforce-admin/actions/hire` comes back `404 Unknown flow "workforce-admin"` rather than reaching a check that can go wrong.

Once it is registered, a hire is an ordinary action call:

```bash
# Convenience for the curl commands on this page. Nothing reads it but your shell;
# the app reads ADMIN_CREDENTIALS, above.
export ADMIN_TOKEN=s3cr3t-acme

curl -X POST localhost:3000/api/flows/workforce-admin/actions/hire \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -d '{"userId":"you",
       "input":{"seatId":"support.ada","flow":"desk-clerk",
                "settings":{"desk":"front"},
                "instructions":"You work the front desk."}}'
```

```json
{ "address": "acme.support.ada", "orgId": "acme" }
```

The organization's id must be a single address segment: lowercase letters, digits and single hyphens, up to 64 characters, and no dots. A dot would make the address ambiguous, since it is also what joins the organization to the seat.

## Calling the seat

The seat answers immediately, on the same route as any other flow. Its address carries the organization that hired it:

```bash
curl -X POST localhost:3000/api/flows/acme.support.ada/actions/answer \
  -H 'content-type: application/json' \
  -d '{"userId":"you","input":{"note":"is the printer fixed?"}}'
```

The organization is part of the address because two organizations can both want a seat called `support.ada`, and an app serves one flat set of addresses. It identifies the seat. It does not authorize anything: who may call it is decided by the principal on the request. The body does not name the organization.

## Reading the roster back at the next start

`reloadHiredSeats` reads each organization's stored rows and hires what they name. It registers nothing, so you loop over what comes back:

```ts
// Wherever you build the FlowState, after createFlowState and useFlowState.
const runtime = await flowstate.getRuntime();

// Your policy. This one reloads every organization the deployment has a record for.
const orgIds = [...new Set((await runtime.stores.org.list()).map((r) => r.orgId))];

const { seats, problems } = await reloadHiredSeats({
  stores: runtime.stores,
  orgIds,
  kinds, // the same map the hire action uses
});

for (const seat of seats) {
  try {
    registerSeat(seat, seat.ownerPin);
  } catch (error) {
    problems.push(`${seat.id} — ${String(error)}`);
  }
}
```

The organizations are passed in rather than discovered. Which ones a start reloads is your app's policy, and there is no organization-filtered read for the framework to inherit.

`problems` is a list of strings, one per row that did not become a seat, each naming the organization, the row key and the reason. Handle it rather than logging it: the number of rows in the roster and the number of seats answering are two different numbers, and a warning on stderr is not a report.

One way to handle it is to put it on screen. `Roster` from `@flow-state-dev/react` lists the seats and takes `problems` alongside them, so both numbers are visible in the same place:

```tsx
import { Roster } from "@flow-state-dev/react";

<Roster sessionId={sessionId} problems={problems} />
```

Keep the list from the boot somewhere your app can reach it. `reloadHiredSeats` runs on the server, and nothing carries its result to a browser on its own.

The roster collection itself is readable by a browser, so the seats come straight from it. Being organization-scoped, that read resolves against the organization the reading session belongs to. A seat crosses as `seatId`, `flow` and `instructions`. The settings bag stays on the server.

The call is bounded on both sides, and neither bound returns a partial roster:

- **`maxOrgs`, default 100.** Hand it more organizations than that and it throws before it reads anything, naming both numbers. Raise it with the `maxOrgs` option.
- **`timeoutMs`, default 10000.** One bound over the whole read, not per organization. The error names the organization the read was waiting on.

A read the store will not complete throws the same way. Nothing is loaded in any of these cases, and instances already running are untouched, so a transient storage failure costs a restart rather than the roster.

## Firing a seat

Firing is the mirror image: delete the row, then release the address. Inside a `fireSeat` handler taking `{ seatId }`, with `orgId` resolved from the credential the same way:

```ts
const roster = ctx.resources.roster as unknown as ResourceCollectionRef;
const existing = await roster.getOptional(input.seatId);
if (!existing) throw new Error(`This organization hired no seat "${input.seatId}".`);

await roster.delete(input.seatId);

// false when nothing in this process was holding the address.
const released = releaseSeat(seatAddress(orgId, input.seatId));
```

```bash
curl -X POST localhost:3000/api/flows/workforce-admin/actions/fire \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -d '{"userId":"you","input":{"seatId":"support.ada"}}'
```

The row is gone straight away and the address stops answering **on the process that handled the request**. Work already running finishes and is saved. Nothing is cancelled and nothing is truncated.

Firing removes the seat, not its history. Sessions, state and resources it wrote are left alone. If you want those gone, delete them yourself.

The roster is organization-scoped, so that `getOptional` is also the fence. Another organization's seat has no row here, and neither does a seat declared in a `WORKER.md` file; both come back undefined and are refused.

**The release step is not fenced the way the row check is.** `releaseSeat` unregisters whatever currently holds the address, whether or not this action is what put it there. If you also declare seats in files, and one of them could end up at an address a hire once used, keep a record of which addresses your hire action registered and release only those.

## What is stored, and where

One row per seat, at `workforce/roster/<seatId>`, in the organization's scope. It is read through the same storage adapter as everything else the app persists, so a Postgres-backed app keeps its roster in Postgres and an in-memory app keeps it for as long as the process lives.

The roster is not the [live inventory](./inventory.md). An inventory row means *was registered in this organization* and is never removed. A roster row is removed when the seat is fired. A seat hired at runtime gets a roster row and no inventory row, so anything that wants one list of every seat, declared and hired, joins the two itself.

## Limits worth knowing before you build on this

**A new seat is served by the process that hired it. Other processes pick it up when they next start.** If your app runs on several instances, or on a platform that starts a fresh instance per request, a seat hired a moment ago may answer on one and not yet on another. The stored row is the real roster; what a process serves is that row, loaded when it started. Plan for a short window rather than an instant one, or restart after hiring if you need every instance in step.

**Firing has the same window, and it is the sharper end of it.** A fired seat is gone from storage immediately and will not come back at any start. But a sibling instance that is already serving it keeps serving it until that instance restarts. If you fire a seat because it should stop answering right now, restart the app rather than assuming the fire did it.

**Inside the organization, an address is not a permission.** An org-visible seat answers every member your resolver admits, and whatever its instructions say can come back in an answer. If some members should not reach a seat, hire it user-owned or put your own check in front of it. Outside the organization the seat is closed: a caller whose principal belongs to another organization, or a user other than a user-owned seat's owner, gets `404 Unknown flow` (the same answer as an address your app does not serve), and nothing runs.

**A start may serve fewer seats than the roster names.** If a stored seat names a flow kind the current code no longer has, or carries settings that kind no longer accepts, that seat is skipped and named in `problems`. The app starts and every other seat answers. The skipped row is left exactly as it was: nothing is repaired or deleted on your behalf. Fix it by putting the kind back, or by firing the seat.

**Listing flows shows every flow except hired seats to anyone.** `GET /api/flows` needs no credential. Any caller who can reach your app sees every flow your app defines and every seat declared in a `WORKER.md` file, including one your code registers after start. A hired seat is listed only to callers who could open it: members of the organization that hired it, or, for a user-owned seat, its owner. A caller your resolver cannot identify sees no hired seats. What hides a hired seat is the `pin` it is registered with, so a flow you register with a `pin` yourself is listed the same way. If those names are sensitive, put your own check in front of the route.

**A seat hired at runtime skips the webhook start-up check.** [Webhook providers](../server/webhooks.md) are the per-provider mechanics an app configures at mount, and a start refuses when a registered flow subscribes to one the app never configured. That check runs over the flows registered at start, so it does not see a seat hired after it. Until the next start, deliveries to that seat's webhook route come back `404 webhook_not_found`; at the next start the mismatch is raised and the start refuses.
