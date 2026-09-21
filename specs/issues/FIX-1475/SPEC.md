# FIX-1475 · Durable hire — a team hired while the app runs is still there after a redeploy

**Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md)

Feature · `engine` + `workforce` + kitchen-sink · large · 2 PRs · epic
[FIX-1455](https://linear.app/fixpoint-labs/issue/FIX-1455) ·
[epic spec](../../epics/FIX-1455/SPEC.md)

## Five people, before and after

| Someone who… | Today | After |
|---|---|---|
| **hires a team while the app is running** | Has nowhere to put it. The app serves a map fixed when the process started, so a new seat is unreachable at any address | Names the team, and its seats answer on the same route as every other flow, in that process, straight away |
| **redeploys after hiring** | The team is gone. Re-hire it, every deploy, forever | The team is still there. It was written down when it was hired, and the next boot reads it back |
| **hires a seat whose kind was deleted from the code** | n/a | The app still boots and every other seat still answers. The seat that cannot run does not run, and the boot says which one and why |
| **redeploys while the database is unreachable** | The app comes up and serves whatever does not need the database | The new version refuses to come up, so the running one keeps serving. A short roster is never served as if it were the whole one |
| **fires a seat mid-answer** | n/a | The answer being written finishes and is saved. The address stops answering here, and on sibling processes at their next start |
| **tries to hire into someone else's organization** | n/a | Refused. The admin path verifies a credential and takes the organization from it, so a request that names another one in its body changes nothing |

The reference app is where somebody decides whether Workforce is real. A roster that dies with
the process makes the whole story a demo: every reader who tries it loses their team on the
first restart and concludes hire is a development-time convenience.

## What changes

![Two panels. Today, the team's files reach the flow registry through the boot door and a hire while the app runs has no door at all, so it lives in process memory and dies on redeploy, with no durable roster anywhere. After, the boot door is unchanged, a second door admits seats after construction, a hire while the app runs comes through it and writes a row to a durable per-org roster in Postgres, and the next boot reads that roster back through the same second door](figures/one-door.svg)

Compare the right-hand side of the two panels; the left-hand side is unchanged. What is new is
the second door, and that **both** a runtime hire and the next boot's reload come through it —
one admission path, not two ([D1](DECISIONS.md#d1)). The durable row is what survives; the
registry is that row, loaded into one process.

**Hiring a seat, as somebody writes it.** It is a flow action, but not an ordinary one: it
writes durable state for an organization, so it verifies a credential of its own and reads the
organization **from that credential**. The framework's stock resolver takes `orgId` out of the
request body, which is fine for a demo flow and is not fine for this one
([D1](DECISIONS.md#d1)'s *decided, not asked*).

```diff
+ POST /api/flows/workforce-admin/actions/hire
+ Authorization: Bearer <the admin credential — this is what names the org>
+ { "userId": "you",
+   "input": { "seatId": "support.ada", "flow": "desk-clerk",
+              "settings": { "desk": "front" }, "instructions": "You work the front desk." } }
```

With no credential configured the admin flow is **not registered at all**, so a default
deployment has no hire path to reach.

**And the seat that comes back, addressed like any other flow:**

```diff
+ POST /api/flows/acme.support.ada/actions/answer
```

The address carries the org because two orgs may both want a seat called `support.ada` and the
registry has one flat address space ([D3](DECISIONS.md#d3)). It is an **address, not a
permission**: who may reach it is still decided by the principal on the request.

The hire writes the row first and registers second, so a hire that is served is a hire that was
written down. A process that did not run the hire picks the seat up at **its** next boot, not
before — [D1](DECISIONS.md#d1) locks that in and [DOCS.md](DOCS.md) states it to readers.

## What stays as it is

- **The file-declared team.** `WORKER.md` under `workforce/teams/` stays the authoring path,
  still read at boot, still failing the boot when a file is wrong. Nothing in
  [FIX-1429](https://linear.app/fixpoint-labs/issue/FIX-1429) is undone.
- **Channels and boards.** They are declared in files and are not created at runtime here
  ([ER-16](../../epics/FIX-1455/BUSINESS-RULES.md)). Runtime channel administration is
  [FIX-1415](https://linear.app/fixpoint-labs/issue/FIX-1415)'s.
- **The seat inventory** (`inventory/seats/*`, from
  [FIX-1405](https://linear.app/fixpoint-labs/issue/FIX-1405)). A runtime-hired seat gets **no
  inventory row**: the inventory never deletes one and a roster must, so parity would be partial
  by construction. This app opens no inventory today either. Joining the two for browsing is
  [FIX-1477](https://linear.app/fixpoint-labs/issue/FIX-1477)'s
  ([the reasoning](PLAN.md#inventory-parity-is-out-of-scope-and-so-is-the-browse-side-join)).
- **Who may call a seat.** Unchanged. The one new authenticated surface is the admin path
  itself, which fences *writing* a roster; reaching a seat is still whatever the app already
  decided, and the limit on that is the [Open](DECISIONS.md#open).
- **Flow listing is not org-filtered.** `/api/flows` still lists every registered instance;
  that gap is [FIX-1486](https://linear.app/fixpoint-labs/issue/FIX-1486)'s, cited and not
  worked around here.

## Sign off

1. **[D1](DECISIONS.md#d1) · One admission door. A runtime hire and the next boot's reload both
   enter through the same public `register` / `unregister` pair, and a change is process-wide
   only at the next boot — for a **fire** as much as for a hire.** If wrong: we have published a
   framework API whose promise is weaker than readers assume, and the fire half is the sharper
   end of it. A seat fired for a reason keeps answering on sibling processes until they restart.
   Walking that back later breaks every app that adopted it.
2. **[D2](DECISIONS.md#d2) · Fail the boot on what a retry fixes; skip what it cannot.** A
   roster the store will not hand over stops the deploy; a stored seat naming a kind the code no
   longer has is skipped, named, and the app serves. If wrong: either one bad row holds a whole
   product hostage behind database access, or a deployment comes up looking healthy with a team
   quietly missing.
3. **[D3](DECISIONS.md#d3) · A runtime-hired seat's address carries its org; the durable row is
   org-scoped.** If wrong: two customers cannot both have a seat called `support.ada`, or worse,
   they can and one silently wins.

**Open: one, and it is a risk to accept rather than a fork to pick** — one org can *address*
another's seat and read the instructions written on it (not its records), now stated to readers
rather than left implied: [DECISIONS.md → Open](DECISIONS.md#open). *Writing* another org's
roster is closed here, not deferred. Number 1 is the one to weigh, and its fire half is the part
worth arguing with. The reasoning and what lost: [DECISIONS.md](DECISIONS.md). The cases:
[BUSINESS-RULES.md](BUSINESS-RULES.md).
