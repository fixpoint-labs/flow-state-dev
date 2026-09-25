# FIX-1573 · User-addressed routes rely on each handler for org/tenant scoping — make it structural

**Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md)

Improvement · `engine` (tests plus two module-level exports) · small · 1 PR · no epic

## Five people, before and after

| Someone who… | Today | After |
|---|---|---|
| **builds the user stream, or any new `/users/:userId/...` route** | Nothing tells them the route must also filter by organization, tenant and the anonymous allow-list. A handler that filters by the path's user id alone passes every existing test | CI fails until the route has an entry in the scoping table and passes it: callers from another organization, another tenant, or anonymous callers get none of the rows the table seeds |
| **belongs to two organizations** | Safe on the one live route (`check-interrupted`). On the next route, safety depends on whoever writes it | Every user-addressed route is shown not to cross organizations, including the ones not yet built |
| **runs one host for several tenants** | Same: the live route checks the tenant; the next route might not | Same guarantee, on the tenant axis |
| **runs a mixed app: one flow authenticates, the rest are open** | An anonymous caller can't touch the authenticated flow's runs through the sweep. The next route has to reproduce that by hand | Proved for every user-addressed route, anonymous caller included |
| **calls `check-interrupted` today** | Current behaviour | Byte-for-byte the same. No production code path changes |

This is latent. The one live route already applies all three scopes. The second route is 501 and
has no rows. The risk is the route after this one, whose author has nothing to remind them.

## What changes

![Two lanes. Today: a new user-addressed route goes from the guard, which checks only the path's user id, through its handler to the rows, with nothing between it and merge. After: the same path, plus a CI fence where three foreign callers and one own caller probe every user-addressed route. A route that leaks, or has no table entry, stops at the fence](figures/what-changes.svg)

Same route, twice. The guard and the handler are identical in both lanes. What moves is the
fence: after this change, no user-addressed route reaches merge without passing it.

**What a route author meets.** Illustrative: the table's shape is the implementer's.

```diff
  // one entry per user-addressed route, derived from the guard's own classification
  check_interrupted_requests: { call: POST /users/:userId/check-interrupted, saw: row ids in the reply },
- user_stream: notBuiltYet,            // pinned: must answer 501 and serve nothing
+ user_stream: { call: GET /users/:userId/stream, saw: row ids read from the stream },
```

Building the user stream breaks the 501 pin on purpose. The author has to swap the pin for a real
entry, and the real entry runs the same three foreign callers as every other route.

## How the table is enforced

```mermaid
flowchart LR
  T["the route table"] --> G["the guard's classification"]
  G -->|"every route classified user-addressed"| H["scoping harness"]
  E["table entries"] --> H
  H -->|"own, cross-org, cross-tenant, anonymous callers"| R["the real router"]
  R -->|"what each caller saw and changed"| A["assert: own row only"]
```

The set of routes under test comes from the guard's own classification over the real route table,
not from a hand list. A new route is covered the moment it is classified.

## What stays as it is

- The guard, the dispatcher and every handler. No production behaviour changes.
- The three existing per-axis tests for `check-interrupted`. They cover cases the table doesn't
  (a caller with no tenant, a row that predates organizations).
- The listings (`list_sessions`, `active_requests`). They are cross-flow routes with their own
  per-instance resolver check, and are out of scope.

## Sign off

1. **[D1](DECISIONS.md#d1) · Enforce the scope with a test over every user-addressed route, not a
   shared predicate the dispatcher hands to handlers, yet.** If wrong: the guarantee is only as
   strong as CI and the honesty of each table entry. A handler handed a predicate could still
   ignore it, so neither option makes forgetting impossible; only the test makes it fail.
2. **[D2](DECISIONS.md#d2) · The guarantee covers every route addressed by a user id in its path,
   including routes not built yet. Listings and session routes stay outside it.** If wrong: a
   user-addressed route classified some other way escapes the table. BR-2 closes that by path
   shape.

**Open: none.** Nothing here needs your call beyond the direction. Number 1 is the one to weigh.
The reasoning and what lost: [DECISIONS.md](DECISIONS.md). The cases: [BUSINESS-RULES.md](BUSINESS-RULES.md).
