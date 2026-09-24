# FIX-1549 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

Written for the implementing agent. IDs cross-reference [BUSINESS-RULES.md](BUSINESS-RULES.md)
(BR-n) and [DECISIONS.md](DECISIONS.md) (D-n). `tdd`. One PR.

## Surfaces

| ID | Package · role | Change | Rules |
|---|---|---|---|
| S1 | `core` · `defineResourceCollection` | **Remove** the roster call. Generic checks only (D2) | BR-1 |
| S2 | `core` · collection patterns | **Remove** `assertRosterCollectionIsNotDeep`, its define-stage branch, and the private helpers only it uses; drop both re-exports (`types/resource-collection.ts`, `types/index.ts`). Keep the brand, mark/is, both roster pattern constants and `encodeUserSegment` | BR-1 |
| S3 | `engine` · the hire-plane module (`context/hire-plane.ts`) | Gains the roster admission rules, register stage only, logic and messages unchanged. The one owner of the fence (D2) | BR-4 BR-7 BR-8 BR-14 |
| S3k | `engine` · the hire-plane key predicate (`privateRosterAdmits`) and the resource handle (`scopePrivateRosterToCaller`) | The predicate refuses a user-owned key (`workforce/roster/~…`) to every collection but the branded writer; the writer's own rule is unchanged. The handle wraps every collection whose pattern overlaps, not only the writer: list and count filter, reads are absent, writes are refused. Non-overlapping collections stay unwrapped (D1) | BR-15 BR-16 BR-17 BR-19 |
| S3r | `engine` · browser resource routes (`routes/resource-routes.ts`) and debug snapshot | Every route that lists, reads, writes or deletes a collection key asks the same predicate. The debug snapshot already does | BR-18 |
| S4 | `engine` · the flow registry | Replace the per-flow unconditional scan with a registry-level fence: arm when an admitted flow carries the writer; on arming, check every held flow and the incoming one; once armed, check each incoming flow. Validate before mutating, like the scope checks. Never disarm (D1) | BR-2 BR-3 BR-4 BR-5 BR-6 BR-9 BR-10 BR-11 |
| S5 | tests · `engine/test/hire-plane-fence.test.ts`, `workforce/test/hire-plane.test.ts` | The cases that assert refusal with no writer present are **rewritten**, not deleted: same patterns, now in an armed registry, both orders. Add the unarmed admissions | BR-2 BR-4 BR-5 BR-7 |
| S6 | docs · changesets | [DOCS.md](DOCS.md). `@flow-state-dev/core` minor (export removed), `@flow-state-dev/engine` patch (admission change) | — |

## Sequence

```mermaid
flowchart TD
  S3K["S3k S3r · key fence on every read path"] --> S3["S3 · rules move into hire-plane"]
  S3 --> S4["S4 · registry arms on the writer"]
  S4 --> S5["S5 · tests rewritten and added"]
  S5 --> S1["S1 · Core call removed"]
  S1 --> S2["S2 · Core export removed"]
  S2 --> S6["S6 · docs and changesets"]
```

The key fence lands first, so no commit leaves a user-owned row readable in an unarmed
registry. Engine takes ownership of admission before Core lets go.

## Checks

| ID | Runs after | Passes when |
|---|---|---|
| V1 | S4 | Unarmed registry admits BR-2 and BR-3 patterns (D1's off state, BP-035) |
| V2 | S4 | BR-4 and BR-5: both orders refused; after BR-5's refusal the registry holds exactly what it held before |
| V3 | S4 | BR-6, BR-7, BR-8, BR-9, BR-10 |
| V4 | S4 | **Corpus equivalence.** Replay [poc/characterize](poc/characterize/README.md)'s twelve patterns in an armed registry and assert each refusal's **complete message**, recorded from `main` before S1 (the POC's three-state verdict is not enough for BR-14). In an unarmed one: all twelve admitted. Plant one wrong row, and one altered message, and watch each go red |
| V7 | S3r | BR-15 to BR-19 through the resource handle, each browser resource route and the debug endpoints, in an **unarmed** registry with Alice's row planted store-direct. [poc/unarmed-leak](poc/unarmed-leak/README.md) inverted is the first case; it shows the leak before S3k and an empty list after |
| V5 | S2 | Nothing imports `assertRosterCollectionIsNotDeep`; `pnpm typecheck` and `knip` clean |
| V6 | S2 | BR-12, BR-13: the existing `hire-plane-fence` runtime legs pass untouched |
| VG | S6 | Goal, on the real path: the acceptance criterion in [Rules](BUSINESS-RULES.md#acceptance-criteria-this-issue-owns), through `createFlowState` and the HTTP router: an app with no Workforce import writes and lists through `[tenant]/**` and `workforce/roster/[owner]/notes`; the same flow beside the writer refuses at startup. No model call is involved, so no goal file under `goals/` applies |

## Pinned names

| Where | Name | Why pinned |
|---|---|---|
| Refusal messages | Today's three strings | Users and tests match them (BR-14) |
| Core exports kept | `HIRED_ROSTER_PRIVATE_BRAND`, `markHiredRosterPrivateCollection`, `isHiredRosterPrivateCollection`, `HIRED_ROSTER_BROWSER_PATTERN`, `HIRED_ROSTER_PRIVATE_PATTERN`, `encodeUserSegment` | Workforce and Engine both use them; removing any is a separate change |

Everything else is yours to name, including the registry's armed state and the moved function.

## Guardrails

| Rule | Because |
|---|---|
| One enforcer. After this change, nothing outside Engine's hire-plane module evaluates a roster pattern (tenet 5) | Two enforcers is the split the issue exists to end |
| Every path that admits a flow goes through the armed check: startup `registerMany`, runtime hires, the kitchen-sink registrar | An invariant checked at one door is the review class that costs most. They all funnel through `register`; confirm it |
| Every path that reads or writes a collection key asks the key predicate: the handle (eager and lazy), each resource route, the debug endpoints. List them in the PR with the test that covers each | The key fence is the guarantee now. A path it misses is exposed in every process without the writer |
| Arming is order-independent and never reverses | A fence that depends on registration order is one a refactor of boot order silently turns off |
| A refused registration mutates nothing | Every existing registry check keeps that promise; a half-armed registry is worse than either state |
| The unarmed path costs one boolean read per registration, and a collection whose pattern cannot reach a user-owned key is never wrapped | This is an app that never asked for Workforce |

## Docs

Reconcile and publish [DOCS.md](DOCS.md) after V4 and V7 pass. It extends two user pages and two
architecture references; no new page.

## Sketch · pseudocode, illustrative, react to the shape

```
registry.register(flow):
    incomingHasWriter ← flow's resources include a branded writer
    if incomingHasWriter or armed:
        toCheck ← incomingHasWriter and not armed ? held flows + flow : [flow]
        for each collection in toCheck: hire-plane rules (register stage)   ← throws, nothing mutated
    commit flow
    if incomingHasWriter: armed ← true
branded writer with browser read: refused on sight, armed or not

keyAdmits(collection, key, user):                  ← one predicate, hire-plane module
    if key is not under workforce/roster/~ : true
    return collection is the branded writer and key is under workforce/roster/~<user>/
```

**POC:** `poc/characterize/` measured today's cost on `55c9581`: eight of twelve patterns
refused in an app with no Workforce, all by the roster fence. It is also V4's corpus. The
premise held. `poc/unarmed-leak/` showed on `01a9d43` that arming alone lets an overlap read
another member's row; it is V7's first case.

## At implement time

- Enumerate the collection read paths before S3r: the handle's eager and lazy loads, the
  request-start prefix seed (confirm a seeded user-owned row cannot surface except through a
  wrapped handle), every `resource-routes.ts` handler, the debug snapshot. `[tenant]/**` listed
  nothing in the POC harness where `[a]/[b]/[c]/[d]` leaked; find out why before trusting it.
- Resources that reach a flow through `uses` capabilities: confirm they are on
  `flow.resources` at `register`, as today's scan assumes. If any path hides one, arm from it
  too.
- FIX-1563 (#2169) and FIX-1500 PR-B (#2159) touch the kitchen-sink registrar; neither touches
  these files as of `55c9581`. Rebase and re-check.

## Follow-ups

- Moving the fence into Workforce needs a generic registration hook Engine exposes. Flag for
  `improve-codebase-architecture` when a second package needs one.
- The FIX-1529 review note on `scopePrivateRosterToCaller` listing the whole org roster before
  filtering is unrelated to this issue and stays where it was raised.
