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

Nothing here changes seats declared in `WORKER.md` files. The app reads them at start, and you remove one by editing its folder.

## What the framework gives you

Every seat runs a **flow kind**: one of the flows your app defines, named in a map you pass to `hireWorkforce`, and the same thing a `WORKER.md` names with `flow:`. [Workers on disk](./workers-on-disk.md#when-a-worker-needs-more-than-settings) covers writing one.

All of these come from `@flow-state-dev/workforce`:

| Call | What it does |
| --- | --- |
| `defineHiredRosterCollection()` | Declares the stored roster: an organization-scoped resource collection at `workforce/roster/*`, one row per hired seat. Takes no options. |
| `defineHiredRosterPrivateCollection()` | Declares where a [user-owned seat](#hiring-a-seat-only-one-member-can-reach)'s row is written, at `workforce/roster/~<user>/<seatId>`. Server-side only, and a block that has it in `resources` reaches only the calling user's rows. |
| `seatAddress(orgId, seatId, ownerUserId?)` | The address a hired seat answers on. Org-visible seats are `<orgId>.<seatId>`. A user-owned seat is `<orgId>.~<user>.<seatId>`, with the user escaped, so two people can hire the same seat id. Throws when the organization id is not a single address segment, or when the seat id starts with `~`. |
| `hireWorkforce(records, { kinds })` | Turns records into configured flow copies, one per record. The same call the file-declared roster goes through. |
| `reloadHiredSeats({ stores, orgIds, kinds })` | Reads every stored row back at the next start and hires what it names. Returns `{ seats, problems, byOrg }`. It registers nothing. |
| `createSeatHireBlocks(options)` | Returns `{ hire, fire }`, two handlers that run the whole hire and fire sequence. Mount them as a flow's actions. See [the ready-made handlers](#the-ready-made-hire-and-fire-handlers). |

Two smaller helpers appear in the hand-written example: `toHiredSeatRow` builds a stored row out of what a hire supplied, and `hiredSeatManifest` turns a row back into the record `hireWorkforce` takes.

What you write around all of them: the flow that carries the hire action, the credential that decides who may call it and which organization they hire into, the call to `flowstate.register()` that puts a minted seat on the air, and the policy for which organizations a start reloads.

## The admin flow

Both ways of hiring on this page run as actions on a flow of your own, here called `workforce-admin`. Whichever you pick, that flow needs a credential that names the organization, and a way to reach the `FlowState` it registers seats on.

The files on this page go in your app's own source tree, under `src/flows/`, where `fsdev run` looks for flows. None of them belongs in a `workforce/` tree.

### The organization has to come from the credential

A hire writes durable state that belongs to an organization, so the organization has to come from something the framework can trust, not from the request body. Configure [`resolvePrincipal`](../server/authentication.md) on the flow and the action's `orgId` comes from there. An `orgId` in the body is ignored, so a caller can't hire into another organization by naming it in the input.

A hired seat is pinned to that organization, and every request to it is checked against the pin. The principal for that check comes from the seat's own `authentication` when it has one, and from the host's otherwise. With neither, every caller counts as the default organization, which never matches the pin, so opening the seat answers `404 Unknown flow` even for the person who hired it. So put the resolver that verified the hire on the seat itself, where you register it, as `registerSeat` [below](#reaching-the-flowstate) does. The seat then answers only callers that resolver accepts. If members should call the seat with their own sign-in, register it with a resolver that verifies them and names the same organization. Don't install it host-wide instead: a host-level resolver applies to every flow the app serves.

```ts title="src/flows/workforce-admin/authentication.ts"
import type { AuthenticationConfig } from "@flow-state-dev/core/types";
import { extractBearerToken, PrincipalResolutionError } from "@flow-state-dev/engine";

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

export const adminAuthentication: AuthenticationConfig = {
  requireUser: true,
  resolvePrincipal: ({ request }) => {
    const token = extractBearerToken(request?.headers?.get("authorization") ?? null);
    const orgId = token === null ? undefined : orgByToken.get(token);
    if (!orgId) {
      throw new PrincipalResolutionError("Invalid admin credential.", { status: 401 });
    }
    return { userId: "workforce-admin", orgId };
  },
};
```

Give each organization its own token. A token written against two organizations resolves whichever one the parser saw last, so a copy-paste in an environment variable turns into a cross-tenant decision. Drop every binding for a token that names more than one, rather than picking a winner.

Register the flow only when a usable credential is configured. Then a deployment that has none has no hire route at all, and a call to `/api/flows/workforce-admin/actions/hire` comes back `404 Unknown flow "workforce-admin"` rather than reaching a check that can go wrong.

The organization's id must be a single address segment: lowercase letters, digits and single hyphens, up to 64 characters, and no dots. A dot would make the address ambiguous, since it is also what joins the organization to the seat.

### Reaching the `FlowState`

Registering a seat needs the `FlowState` the admin flow is itself registered on, and importing that directly is a cycle. Install it instead:

```ts title="src/flows/workforce-admin/registry-access.ts"
import type { FlowInstance, InstanceOwnerPin } from "@flow-state-dev/core/types";
import type { FlowState } from "@flow-state-dev/engine";
import { registerHiredSeat } from "@flow-state-dev/workforce";

import { adminAuthentication } from "./authentication";

let app: FlowState | undefined;

/** Call once, immediately after `createFlowState`. */
export function useFlowState(next: FlowState): void {
  app = next;
}

export function registerSeat(seat: FlowInstance, pin?: InstanceOwnerPin): void {
  const state = app;
  if (!state) throw new Error("No FlowState to register into.");
  registerHiredSeat((instance, owner) => state.register(withAdminResolver(instance), { pin: owner }), seat, pin);
}

/** The seat answers the credential that hired it. A kind with its own resolver keeps it. */
function withAdminResolver(seat: FlowInstance): FlowInstance {
  const { resolvePrincipal } = adminAuthentication;
  if (!resolvePrincipal || seat.authentication?.resolvePrincipal) return seat;
  return { ...seat, authentication: { ...seat.authentication, resolvePrincipal } };
}

export function releaseSeat(id: string): boolean {
  return app?.unregister(id) ?? false;
}
```

## The ready-made hire and fire handlers

`createSeatHireBlocks` gives you the whole hire and fire sequence as two handlers you mount as actions. They are the same handlers the `seat-hire` capability, `createSeatHireCapability`, gives a worker kind as its `hire` and `fire` tools. Use them when a person or your own code does the hiring, from a screen or an admin route, with no model in front of the call.

With them, the admin flow needs no `hire.ts` or `fire.ts` of its own:

```ts title="src/flows/workforce-admin/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import {
  createSeatHireBlocks,
  defineHiredRosterCollection,
  defineSeatInventoryCollection,
  HIRED_ROSTER_RESOURCE,
  SEAT_INVENTORY_RESOURCE,
} from "@flow-state-dev/workforce";

import { deskClerkFlow } from "../desk-clerk/flow";
import { adminAuthentication } from "./authentication";
import { registerSeat, releaseSeat } from "./registry-access";

/** The kinds a hire may name. Pass this same map to `reloadHiredSeats`. */
export const kinds = { "desk-clerk": deskClerkFlow };

const seatHire = createSeatHireBlocks({
  kinds,
  register: registerSeat,
  unregister: releaseSeat,
});

const workforceAdmin = defineFlow({
  kind: "workforce-admin",
  requireUser: true,
  authentication: adminAuthentication,
  // The handlers read both collections under exactly these keys.
  resources: {
    [HIRED_ROSTER_RESOURCE]: defineHiredRosterCollection(),
    [SEAT_INVENTORY_RESOURCE]: defineSeatInventoryCollection(),
  },
  actions: {
    hire: { block: seatHire.hire },
    fire: { block: seatHire.fire },
  },
});

export default workforceAdmin();
```

**Declare both collections on the flow, under `HIRED_ROSTER_RESOURCE` and `SEAT_INVENTORY_RESOURCE`.** The handlers look them up by those keys. Without them every hire fails with `Cannot read properties of undefined (reading 'create')`, before a row is written or a seat registered.

`createSeatHireBlocks` takes these options:

| Option | What it's for |
| --- | --- |
| `kinds` | The flow kinds a hire may name, the same map you pass to `hireWorkforce` and `reloadHiredSeats`. The built-in `agent` kind is always hireable too, unless `allowKinds` leaves it out. |
| `register(seat, pin)` | Puts a minted seat on the air. `pin` is `{ orgId, userId? }` for the organization the hire ran under. |
| `unregister(address)` | Releases an address in this process and returns whether anything held it. |
| `kindAt?(address)` | The kind serving an address right now, if any. Lets `hire` refuse an address that is already served before writing anything, and lets `fire` leave an address registered when a different kind holds it. |
| `allowKinds?` | The subset of `kinds` these handlers may mint. |
| `channelBoards?` | Channel board ids. For each one the new seat doesn't declare, the hire's `warning` names it, since rows filed on that board sit pending until something works them. |

The seats these handlers and the `seat-hire` tools hire are always org-visible: pinned to the organization and no user, so any caller the seat's resolver places in that organization can call one, and its roster row, `instructions` included, is readable by a browser in that organization. For a seat only one member can reach, write the hire yourself as in [Hiring a seat only one member can reach](#hiring-a-seat-only-one-member-can-reach).

Both handlers take the organization from the principal your `resolvePrincipal` returns for the session, as [above](#the-organization-has-to-come-from-the-credential). A session whose principal names no organization, which includes every session on a flow with no `resolvePrincipal`, belongs to the framework's default organization. That id can't start a seat address, so every hire there is refused before anything is written:

```text
Organization id "__fsd_default_org__" must be lowercase letters, digits, and single hyphens (not at the start or end) — it becomes the leading segment of a hired seat's address, which is joined with a "."
```

Mount these handlers only on a flow whose resolver names a real organization.

### Hiring

`hire` takes `{ seatId, flow, settings?, instructions? }`. Any other key is refused, except `orgId`, which is accepted and ignored. It returns the seat id and the address the seat answers on:

```json
{ "seatId": "support.ada", "address": "acme.support.ada" }
```

`warning` is added when the new seat doesn't declare one of the `channelBoards`.

A hire runs in this order:

1. It refuses a kind that isn't in `kinds`, or that `allowKinds` leaves out, and names the kinds it can hire. It refuses an address `kindAt` reports as already served.
2. It mints the seat, which runs the kind's settings schema.
3. It writes the roster row with `create()`. A second hire of the same seat id fails here with `Resource instance "workforce/roster/support.ada" already exists`, including two hires arriving at once.
4. It calls your `register`. If that throws, the row from step 3 is deleted and the error is passed on.
5. It writes an inventory row at `inventory/seats/<address>`. If this write fails, the seat is hired and answering but has no inventory row.

### Firing

`fire` takes `{ seatId }` (again, `orgId` is accepted and ignored) and returns `{ seatId, address, released }`.

It refuses a seat id this organization never hired with `This organization hired no seat "support.ada".` Otherwise it deletes the roster row, then calls your `unregister` on the address, and `released` is what that returned. If `kindAt` reports a different kind at the address than the row names, the row is still deleted but the address stays registered and `released` is `false`. Without `kindAt`, `fire` releases whatever holds the address, the same as the [hand-written fire](#firing-a-seat).

The inventory row stays after a fire. Read the roster when you want the seats an organization has now; [The roster](#the-roster) explains the difference.

## Writing the handlers yourself

Writing the hire and fire handlers yourself puts every step in your own code. It is also the only way to hire a seat that belongs to one member.

### Hiring a seat

A hire is a handler in the admin flow, and the order it works in matters. Refuse what you can refuse before anything is written. Mint the seat, which is where the flow kind's own settings schema runs. Write the row. Register. If registering fails, delete the row you just wrote, so a hire that failed leaves nothing behind.

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
      // Lets a reload refuse this row if it is ever read under another organization.
      owningOrgId: orgId,
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

Mount it, and the `fireSeat` handler from [Firing a seat](#firing-a-seat), on the admin flow:

```ts title="src/flows/workforce-admin/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import { defineHiredRosterCollection } from "@flow-state-dev/workforce";

import { adminAuthentication } from "./authentication";
import { fireSeat } from "./fire";
import { hireSeat } from "./hire";

const workforceAdmin = defineFlow({
  kind: "workforce-admin",
  requireUser: true,
  authentication: adminAuthentication,
  resources: { roster: defineHiredRosterCollection() },
  actions: {
    hire: { block: hireSeat },
    fire: { block: fireSeat },
  },
});

export default workforceAdmin();
```

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

### Firing a seat

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

### Hiring a seat only one member can reach

The hire above is org-visible: the seat is pinned to the organization and no user, and its row is one a browser in that organization can read. With `registerSeat` as written, the seat answers any caller holding that organization's admin token. To let members call it with their own sign-in, register it with a resolver that verifies them, as described [above](#the-organization-has-to-come-from-the-credential). To hire a seat that belongs to one member, change the hire like this, in the handler and in `flow.ts`:

- **Stamp the owner on the row.** Pass `ownerUserId` to `toHiredSeatRow`, and keep `owningOrgId`, the organization the hire runs under: that stamp is what lets a reload refuse the row if it is ever read under another organization. `hiredSeatManifest` then pins the record to that user as well as the organization, and registering with that pin is what closes the seat to everyone else.
- **Put the owner in the address.** `seatAddress(orgId, seatId, userId)` returns `<orgId>.~<user>.<seatId>`, so two members can each hire `research` without colliding.
- **Write the row through the private collection.** Install `defineHiredRosterPrivateCollection()` beside the roster and write with the object key `{ owner, seat }`, where `owner` is `~` followed by the user id passed through `encodeUserSegment` (the same escaping `seatAddress` applies). The row lands at `workforce/roster/~<user>/<seatId>`, which the browser-readable roster does not list.

```ts title="src/flows/workforce-admin/hire.ts (the lines that change)"
import { encodeUserSegment } from "@flow-state-dev/workforce";

// The owner is the user on the verified principal, never a field in the body.
const userId = ctx.session.identity.userId;
if (!userId) throw new Error("This credential resolves no user.");

const address = seatAddress(orgId, input.seatId, userId);

const row = toHiredSeatRow({
  seatId: input.seatId,
  flow: input.flow,
  settings: input.settings,
  instructions: input.instructions ?? null,
  owningOrgId: orgId,
  ownerUserId: userId,
});

// Mint exactly as before: hiredSeatManifest(orgId, row), then hireWorkforce.

const owned = ctx.resources.rosterPrivate as unknown as ResourceCollectionRef;
const key = { owner: `~${encodeUserSegment(userId)}`, seat: input.seatId };
await owned.create(key, row as unknown as JsonObject);

try {
  registerSeat(seat, record.manifest.ownerPin); // carries { orgId, userId }
} catch (error) {
  await owned.delete(key);
  throw error;
}
```

```ts title="src/flows/workforce-admin/flow.ts"
resources: {
  roster: defineHiredRosterCollection(),
  rosterPrivate: defineHiredRosterPrivateCollection(),
},
```

The owner comes from the credential, so your resolver has to name the member making the call. The example resolver above answers `workforce-admin` for every token, which would make every seat belong to that one user and nobody else.

The private collection reaches only the calling user's own rows. `create`, `get` and `delete` on a key naming another user throw `A hired-seat row is readable only by the user it belongs to.`, `getOptional` on one returns `undefined`, and `list` leaves such rows out. Firing a user-owned seat reads and deletes through the same collection and key, then releases `seatAddress(orgId, seatId, userId)`. `reloadHiredSeats` needs no change: it reads these rows with the rest, and each seat's `ownerPin` carries the user.

Installing the private collection also closes the rows to every other collection in your app. Once a flow that declares it is registered, the app refuses to start if any flow declares a collection whose pattern could reach a user-owned row: `workforce/roster/**`, `workforce/roster/[owner]/notes`, a copy of `workforce/roster/[owner]/[seat]`, or a wide parameterised pattern such as `[tenant]/**`. It doesn't matter which of the two flows registers first. The error names the pattern, and says it can read user-owned roster rows.

An app that never installs the private collection has no such rows, and none of these patterns are refused there.

The rows are closed even where that check doesn't run. A user-owned row is stored under `workforce/roster/~<user>/<seat>`, and no collection except the private one can read or write a key there, in any process. A queue worker that never registers the private collection, or a second app over the same store, can declare `[tenant]/**` and start, but its lists never show those rows and a write to one is refused.

Once registered, the seat answers its owner only. Any other member gets `404 Unknown flow`. The row has no browser read at all, so a roster panel reading the browser collection does not show it, not even to its owner.

## Calling a hired seat

The seat answers immediately, on the same route as any other flow. Its address carries the organization that hired it. With `registerSeat` as written, it answers any admin token configured for that organization, since each resolves to the same principal the seat is pinned to:

```bash
curl -X POST localhost:3000/api/flows/acme.support.ada/actions/answer \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -d '{"userId":"you","input":{"note":"is the printer fixed?"}}'
```

The organization is part of the address because two organizations can both want a seat called `support.ada`, and an app serves one flat set of addresses. It identifies the seat. It does not authorize anything: who may call it is decided by the principal on the request. The body does not name the organization.

## Who can reach a hired seat

A hired seat belongs to the organization that hired it, and to the person who hired it when it is user-owned. The `pin` you register the seat with names both, and every caller is checked against it. Knowing or guessing a seat's address grants nothing.

Anyone outside that pair gets the answer an address your app does not serve would get:

- Opening a session with the seat, or sending it an action, answers `404 Unknown flow`.
- `GET /api/flows` leaves the seat out of the list.
- A session opened earlier cannot be resumed by a caller outside the pair.
- A task board in another organization cannot hand work to the seat. The hand-off is refused as if the seat did not exist: the task ends errored and unclaimed, and its error reads `flow-not-found` with `no flow instance "<address>" is registered in this process`, the same as for an address nobody holds.
- With debug endpoints switched on, the debug listing does not show another person's private roster row.

For example, Alice hires a user-owned `research` seat while signed in to Acme. Bob, also in Acme, cannot open it. Neither can Alice while she is signed in to Globex. If she wants a research seat there, she hires one in Globex, and it starts empty. If Bob hires his own, his starts empty too. [What a seat saves for a person](#what-a-seat-saves-for-a-person) covers why.

**The check is as strong as the principal your resolver returns.** "Who is asking" is the principal your [`resolvePrincipal`](../server/authentication.md) returns: a user and the organization they are signed in to. Use a resolver that verifies both, and install it on each hired seat as well as on the flow that hires it, as `registerSeat` in [Reaching the `FlowState`](#reaching-the-flowstate) does.

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
  kinds, // the map the hire action uses: exported from flow.ts or hire.ts, whichever path you took
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

The same result splits both lists by organization. `byOrg` has one entry per organization you passed in, in that order, each with that organization's `orgId`, `seats` and `problems`. An organization with nothing to report still gets an entry, with empty lists. Store each organization's problems where only that organization reads them, and write the empty ones too, so a problem fixed since the last start stops showing. A seat your registry then refuses belongs in its own organization's list as well.

The roster collection itself is readable by a browser, so the seats come straight from it. Being organization-scoped, that read resolves against the organization the reading session belongs to, so a `Roster` panel lists the roster of its own session's organization. For a seat to show up on a screen, the screen's session has to resolve the same organization the hire did. A seat crosses as `seatId`, `flow` and `instructions`. The settings bag stays on the server.

The call is bounded on both sides, and neither bound returns a partial roster:

- **`maxOrgs`, default 100.** Hand it more organizations than that and it throws before it reads anything, naming both numbers. Raise it with the `maxOrgs` option.
- **`timeoutMs`, default 10000.** One bound over the whole read, not per organization. The error names the organization the read was waiting on.

A read the store will not complete throws the same way. Nothing is loaded in any of these cases, and instances already running are untouched, so a transient storage failure costs a restart rather than the roster.

## What is stored, and where

### The roster

One row per seat in the organization's scope: at `workforce/roster/<seatId>`, or at `workforce/roster/~<user>/<seatId>` for a user-owned seat. It is read through the same storage adapter as everything else the app persists, so a Postgres-backed app keeps its roster in Postgres and an in-memory app keeps it for as long as the process lives.

The roster is not the [inventory](./inventory.md). An inventory row means *was registered in this organization* and is never removed. A roster row is removed when the seat is fired. A seat hired through [`createSeatHireBlocks`](#the-ready-made-hire-and-fire-handlers) or the `seat-hire` tools gets both rows. A seat hired by a handler you wrote gets only the rows it writes: the `hire-seat` handler in [Hiring a seat](#hiring-a-seat) writes a roster row and no inventory row. Anything that wants one list of every seat, declared and hired, joins the two itself.

### What a seat saves for a person

A seat keeps what it saves for a person in a cell of its own, apart from the roster: a user-scope key for the seat's organization and that person, `<person>:~org:<organization>`. The cell holds the seat's shared user data. That is the user record a seat reads as `ctx.user.state`, unless the kind sets `isolateUserState: true`, and every user-scoped resource that isn't flow-isolated. A resource's own `flowIsolation` decides whether it is isolated; a resource that doesn't set it follows the kind's `isolateUserState`.

Say Alice uses seats in two organizations, Acme and Globex. Anything a seat stores for her while she works in Acme stays in Acme and stays hers. Her Globex seat of the same kind cannot read it, and neither can a seat belonging to Bob, another member of Acme. Her other seats in Acme can, if they declare the same resource. A seat does not move between organizations, and there is no setting that makes it move.

The person's own data outside hired seats, such as preferences your app's other flows keep, is a different cell, keyed by the person's id alone. A hired seat does not read it and cannot write to it. Flow-isolated data is not in either cell: it is keyed by the person and the seat's own address. That covers the user record when the kind sets `isolateUserState: true`, and any user-scoped resource that is isolated, by its own `flowIsolation: true` or by following the kind's `isolateUserState: true`.

A user resource backed by your own hooks (a projected resource) is stored by your app, not the framework. Its hooks receive the person's id and the organization, so key its rows by `orgId` as well, or a seat in one organization reads what was saved in another.

If you are upgrading an app whose seats already saved data, see [Upgrading: moving hired seats' stored data](../persistence/overview.md#upgrading-moving-hired-seats-stored-data).

## Limits worth knowing before you build on this

**A new seat is served by the process that hired it. Other processes pick it up when they next start.** If your app runs on several instances, or on a platform that starts a fresh instance per request, a seat hired a moment ago may answer on one and not yet on another. The stored row is the real roster; what a process serves is that row, loaded when it started. Plan for a short window rather than an instant one, or restart after hiring if you need every instance in step.

**Firing has the same window, and it is the sharper end of it.** A fired seat is gone from storage immediately and will not come back at any start. But a sibling instance that is already serving it keeps serving it until that instance restarts. If you fire a seat because it should stop answering right now, restart the app rather than assuming the fire did it.

**Inside the organization, an address is not a permission.** An org-visible seat answers every member your resolver admits, and whatever its instructions say can come back in an answer. If only one member should reach a seat, [hire it user-owned](#hiring-a-seat-only-one-member-can-reach). For any other rule about who may call a seat, put your own check in front of it. Outside the organization the seat is closed. [Who can reach a hired seat](#who-can-reach-a-hired-seat) lists every door.

**A start may serve fewer seats than the roster names.** If a stored seat names a flow kind the current code no longer has, or carries settings that kind no longer accepts, that seat is skipped and named in `problems`. The app starts and every other seat answers. The skipped row is left exactly as it was: nothing is repaired or deleted on your behalf. Fix it by putting the kind back, or by firing the seat.

**Listing flows shows every flow except hired seats to anyone.** `GET /api/flows` needs no credential. Any caller who can reach your app sees every flow your app defines and every seat declared in a `WORKER.md` file, including one your code registers after start. A hired seat is listed only to callers who could open it, as described in [Who can reach a hired seat](#who-can-reach-a-hired-seat). A caller your resolver cannot identify sees no hired seats. A flow you register with a `pin` yourself is listed the same way. If those names are sensitive, put your own check in front of the route.

**A seat hired at runtime skips the webhook start-up check.** [Webhook providers](../server/webhooks.md) are the per-provider mechanics an app configures at mount, and a start refuses when a registered flow subscribes to one the app never configured. That check runs over the flows registered at start, so it does not see a seat hired after it. Until the next start, deliveries to that seat's webhook route come back `404 webhook_not_found`; at the next start the mismatch is raised and the start refuses.
