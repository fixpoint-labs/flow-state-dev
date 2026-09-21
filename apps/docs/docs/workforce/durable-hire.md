---
title: Hiring while the app runs
sidebar_position: 8
sidebar_label: Hiring at runtime
description: "Hire a seat into a running app and have it still be there after a restart. The roster is stored per organization, alongside everything else the app keeps."
---

# Hiring while the app runs

A `WORKER.md` file declares a seat and the app reads it when it starts. That is the usual way to describe a team, and it does not change. But some teams are not known when the app is built: a customer signs up and needs their own set of workers, or someone adds a seat from a screen rather than from a text editor. For that you hire at runtime.

A seat hired this way is written down. It is still there after a restart, a redeploy, or a crash, because it lives in the same storage the app already uses for sessions and state.

## Hiring a seat

Hiring is a flow action, and it is the one action in the app that verifies a credential of its own. It has to: it writes durable state that belongs to an organization, and the framework's stock request handling reads `orgId` straight out of the request body. Anything that trusted that would let any caller hire into any organization.

So the organization comes from the credential, not from what the request says about itself. **With no admin credential configured, the action is not registered at all** and there is no hire path to reach.

```bash
curl -X POST localhost:3000/api/flows/workforce-admin/actions/hire \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $WORKFORCE_ADMIN_TOKEN" \
  -d '{"userId":"you",
       "input":{"seatId":"support.ada","flow":"desk-clerk",
                "settings":{"desk":"front"},
                "instructions":"You work the front desk."}}'
```

An `orgId` in the body is ignored. The organization's id must be a single address segment: lowercase letters, digits and single hyphens, up to 64 characters, and no dots. A dot would make the address ambiguous, since it is also what joins the organization to the seat.

The seat answers immediately, on the same route as any other flow. Its address carries the organization that hired it:

```bash
curl -X POST localhost:3000/api/flows/acme.support.ada/actions/answer \
  -H 'content-type: application/json' \
  -d '{"userId":"you","orgId":"acme","input":{"note":"is the printer fixed?"}}'
```

The organization is part of the address because two organizations can both want a seat called `support.ada`, and an app serves one flat set of addresses. It identifies the seat. It does not authorize anything: who may call it is still decided by the principal on the request.

## Firing a seat

```bash
curl -X POST localhost:3000/api/flows/workforce-admin/actions/fire \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $WORKFORCE_ADMIN_TOKEN" \
  -d '{"userId":"you","input":{"seatId":"support.ada"}}'
```

The seat is removed from storage straight away, and the address stops answering **on the process that handled the request**. Work that was already running finishes and is saved. Nothing is cancelled and nothing is truncated.

Firing removes the seat, not its history. Sessions, state and resources it wrote are left alone. If you want those gone, delete them yourself.

You can only fire a seat your organization hired. A seat declared in a `WORKER.md` file is removed by editing that folder, not through this action.

## What is stored, and where

One row per seat, in an organization-scoped collection at `workforce/roster/<seatId>`. It holds what the hire supplied: the flow kind, the settings, and the instructions. It is read through the same storage adapter as everything else the app persists, so a Postgres-backed app keeps its roster in Postgres and an in-memory app keeps it for as long as the process lives.

The roster is its own thing, and it is **not** the [live inventory](inventory.md). The inventory answers *what was registered in this organization* and never removes a row, which is right for browsing and wrong for a roster you can fire a seat out of. A seat hired at runtime gets a roster row and no inventory row. Anything that wants one list of every seat, declared and hired, joins the two itself.

## Limits worth knowing before you build on this

**A new seat is served by the process that hired it. Other processes pick it up when they next start.** If your app runs on several instances, or on a platform that starts a fresh instance per request, a seat hired a moment ago may answer on one and not yet on another. The stored row is the real roster; what a process serves is that row, loaded when it started. Plan for a short window rather than an instant one, or restart after hiring if you need every instance in step.

**Firing has the same window, and it is the sharper end of it.** A fired seat is gone from storage immediately and will not come back at any start. But a sibling instance that is already serving it keeps serving it until that instance restarts. If you fire a seat because it should stop answering right now, restart the app rather than assuming the fire did it.

**An address is not a permission.** Any caller your app already lets through can send a request to any seat address it serves, including one another organization hired — for example `POST /api/flows/acme.support.ada/actions/answer` from a caller in another organization. Their request runs against **their own** organization's data, so no records cross. What does cross is the seat's own text: the instructions whoever hired it wrote come back in the answer. If the instructions on your seats are sensitive, do not rely on the address being unguessable. Put your own check in front of them.

**A restart may serve fewer seats than the roster names, and it says so.** If a stored seat names a flow kind the current code no longer has, or carries settings that kind no longer accepts, that seat is skipped. The app starts, every other seat answers, and the skipped ones are reported with the reason. The skipped row is left exactly as it was: nothing is repaired or deleted on your behalf. Fix it by putting the kind back, or by firing the seat.

**If the roster cannot be read, the app refuses to start.** A storage failure is usually temporary, and a process that fails to start is retried, so whatever was already serving keeps serving. The alternative would be an app that comes up looking healthy with a team quietly missing, which is worse and much harder to notice.

**There is a cap on how many organizations are reloaded at start.** Past it the app refuses to start rather than loading the first few, for the same reason: a partial roster that looks complete is the failure being avoided. Raise the cap deliberately if you need to.

**Listing flows is not filtered by organization.** `GET /api/flows` returns every registered instance, including the seats other organizations hired, by address — and that route is not authenticated. Anyone who can reach your app can read the list. If that matters to you, put your own check in front of it and filter before showing it to a customer.

**A seat that declares a webhook provider is checked at start.** Hire one at runtime whose provider the app did not configure and the mismatch is not reported until the next restart.

## Migrating

Nothing to migrate. Apps that declare their whole team in files behave exactly as before: those seats are still read at start, still fail the start when a file is wrong, and are not affected by anything on this page.
