# FIX-1286 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

Written for the implementing agent. IDs cross-reference [BUSINESS-RULES.md](BUSINESS-RULES.md)
(BR-n), [DECISIONS.md](DECISIONS.md) (D-n) and the epic's rules (ER-n). `tdd`. One PR, on top of
FIX-1018 (#2377) once it merges; do not start before.

## Surfaces

| ID | Package · role | Change | Rules |
|---|---|---|---|
| S1 | `core` · the request scope handle type | Add `incarnation`, documented as "stamped once when this request is first recorded; one request, one value for its whole life" (D1) | BR-8 |
| S2 | `engine` · the request record and the handle built from it | Stamp a random token when a request record is first created; never rewrite it, including in FIX-1018's same-owner hand-off. **The handle field is exactly the stored record's token**, read from the record the context claimed or adopted. A legacy record derives one from `createdAt`, under its own prefix (BP-030). `isSameRequest` compares tokens when both exist, else `createdAt` | BR-4 BR-5 BR-8 to BR-11 |
| S3 | `workspace` · scope identity (`principalFromContext`, the `request` branch of `scopeComponents`) | Read S1 into the scope principal; the `request` scope's components become tenant, id, incarnation. Absent is framed as absent (BR-14). Other scopes untouched | BR-2 BR-3 BR-4 BR-6 BR-12 to BR-14 |
| S4 | `tools` · the bash tool's scope key | No logic change: it already derives the key and directory from S3. Update its `run` path comment and the doc'd layout | BR-2 BR-7 |
| S5 | `integration-tests` · the shared two-users-one-tenant suite | Add `@flow-state-dev/tools` as a dependency; add this issue's case: live and evicted legs, as Bob, over HTTP. The evicted leg uses the flow's real session retention and polls Alice's first id until its status is a 404; no sleep, no store delete | BR-1 BR-2 BR-5 |
| S6 | Docs and changesets | Per [DOCS.md](DOCS.md). Changesets: `core` minor (the new field), `engine`, `workspace`, `tools` patch; the `tools` one names the one-time rename of run directories (BR-15) | BR-15 |

Nothing is removed. The run key's tenant and id components stay; D1 adds one.

## What else is keyed on a request id

Checked in round 1, so the goal can stop at the bash run workspace.

| State | Keyed on | Outlives the record? | Verdict |
|---|---|---|---|
| Local run workspace | `[tenant, request id]` | Yes, the directory stays on disk | **This issue** |
| Resources | session, user or org; no request scope exists | n/a | Unaffected |
| Claude Code workspace mounts | session, user or org collections | n/a | Unaffected (BR-13) |
| Tool-result cache | the in-memory request handle | No, dies with the execution | Unaffected |
| Trace store | request id | Yes | Nothing outside tests reads it. Not a disclosure path today |
| Request stream events | request id | Yes: no store deletes them with the record (code read, not run) | FIX-1018's class (ER-3), flagged, not built here |

## Sequence

```mermaid
flowchart TD
  S5a["S5 · the HTTP case, red on FIX-1018's head"] --> S1["S1 · the field"]
  S1 --> S2["S2 · the engine stamps and reads it"]
  S2 --> S3["S3 · the scope rule reads it"]
  S3 --> S4["S4 · the bash key follows"]
  S4 --> S5b["S5 · the HTTP case, green"]
  S5b --> S6["S6 · docs and changesets"]
```

Write the evicted leg first and watch it fail; the POC already shows the shape.

## Checks

| ID | Runs after | Passes when |
|---|---|---|
| V1 | S2 | Engine unit: the handle's incarnation equals the stored record's on a fresh request, on a retry of a record on file, on the queued path's adopted stub, and on a resume in a new context (BR-5, BR-8, BR-9). Two requests under one id, the first deleted in between, carry different values |
| V1a | S2 | **Required, concurrent.** Two same-owner contexts race to create one absent id: both end holding the one incarnation the store kept, and the stored token is never rewritten by the hand-off (BR-10) |
| V1b | S2 | Engine unit: two records under one id with equal `createdAt` get different incarnations, and `isSameRequest` says they differ (BR-4). A legacy record without a token derives the same incarnation on every read, and it differs from any stamped one (BR-11) |
| V2 | S3 | Workspace unit: same tenant and id with two incarnations give two keys and two directories; the same incarnation gives one; absent never equals present (BR-3, BR-6, BR-14). `session`, `user`, `org` keys, and the Claude Code mounts' keys, byte-identical to today (BR-13) |
| V3 | S4 | The existing `bash-workspace-scope` tests stay green, including siblings sharing and tenants separating (BR-7, BR-12) |
| V4 | S5 | [The goal](SPEC.md#the-goal-and-how-well-know-its-met): `run-workspace.test.ts` passes both legs. The evicted leg FAILED on FIX-1018's head and the live leg FAILED on `main` before FIX-1018; the PR names both commits (ER-16) |
| V5 | S6 | Docs build; the new field appears in the core type docs |

## Pinned names

| Where | Name | Why pinned |
|---|---|---|
| The request handle | `ctx.request.incarnation` | Public, read by three packages and by apps that key their own state on a request id |
| The HTTP case | `packages/integration-tests/src/two-users-one-tenant/run-workspace.test.ts` | The closure runs the suite by location (ER-19) |

Everything else is yours, including the token's format and the legacy prefix.

## Guardrails

| Rule | Because |
|---|---|
| The request-scope rule changes in one place, the workspace scope identity (tenet 5) | The bash key and projections both read it; a second derivation is how the tenant bug happened once already |
| The token is stamped only when a record is first created, and read from the stored record everywhere else | A resume, a retry or a race hand-off that re-stamps it opens a new, empty workspace mid-request |
| No user or org in the `run` key | The Architect's call on `run`'s meaning stands; D1 changes only what "one request" means once its id is freed |
| Nothing in the case imports `src`, a store or a workspace helper (ER-16, anti-game) | The closure runs it against installed tarballs |
| Anything newly keyed on a request id keys on the incarnation too | D1 closes this store, not the class. Say so in the field's doc comment |

## Docs

Reconcile and publish [DOCS.md](DOCS.md) after V4 passes. Two updates, no new page.

## Sketch and POC

```
engine, first creation of a request record:
    incarnation ← a fresh random token                  ← written once
engine, building the request handle:
    incarnation ← the record this context claimed or adopted
                  (legacy record: derived from its createdAt, own prefix)
workspace scope identity, request branch:
    components = [tenant, request id, incarnation]      ← the key change
    absent incarnation → an absent component, framed
```

**POC:** [`poc/workspace-outlives-record/`](poc/workspace-outlives-record/README.md), on FIX-1018's
head `71f036a03`. Live leg: Bob got his own id and no file; the premise held. Evicted leg: Bob
ran under Alice's id and printed her note; the premise failed, and D1 follows from it. Run it
with `bash specs/issues/FIX-1286/poc/workspace-outlives-record/run.sh`.

## At implement time

- Rebase on `main` after #2377 merges and re-run the POC there first. If the evicted leg no
  longer leaks, stop and surface it: D1's reason is gone.
- FIX-1634 extends the queued path that writes the enqueue-time record. Its adoption must keep
  that record's incarnation, not stamp a new one; V1's queued-path check is where a clash shows.

## Follow-ups

- Run directories are never deleted. A sweep of unreachable ones is a follow-up, not ER-4.
- Request stream events outlive their record (see the table above). Reported to the
  coordinator for FIX-1018 or its own issue.
