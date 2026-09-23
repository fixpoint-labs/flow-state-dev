# FIX-1527 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

Written for the implementing agent. IDs cross-reference [BUSINESS-RULES.md](BUSINESS-RULES.md)
(BR-n) and [DECISIONS.md](DECISIONS.md) (D-n, F1). `tdd`. One PR. Kitchen-sink only, no
package change, no changeset (private app).

## Surfaces

| ID | Where · role | Change | Rules |
|---|---|---|---|
| S1 | `apps/kitchen-sink/workforce/hire.ts` · the `agent` kind | Compose `createSeatHireCapability` and `createWorkforceCapability` onto the existing kind (D1). The capability closes over **the same object** exported as `kitchenSinkKinds`, so declare the map first and assign `agent` into it. `register` → `workforceRegistrar.registerFromRoster(seat, { pin })`, `unregister`/`kindAt` → the registrar (D2). No `allowKinds`, no `channelBoards`. Discover: `inventory.seats` + `hiredRoster` keys, empty file roster | BR-1 to BR-11 |
| S2 | same file · header | The header says nothing outside `fsdev.config.ts` reaches this subtree (`:10-16`). It now imports `lib/workforce-registrar`, so say so (BP-034) | — |
| S3 | `apps/kitchen-sink/workforce/teams/support/workers/mara/WORKER.md` · new seat | `description:`, `tools: [hire, fire]`, no `flow:`. The body says it staffs the desk by hiring kinds the app already has | BR-1 BR-2 |
| S4 | `apps/kitchen-sink/test/` · one new file | Promote the POC's legs to a real test over **the app's exported kinds** rather than a rebuilt copy | V1 to V7 |
| S5 | `apps/kitchen-sink/README.md` | [DOCS.md](DOCS.md) | — |

Nothing is removed. Nothing in `packages/` changes.

## Sequence

```mermaid
flowchart TD
  S1["S1 · compose on the kind"] --> S3["S3 · mara's WORKER.md"]
  S1 --> S2["S2 · header provenance"]
  S3 --> S4["S4 · test"]
  S4 --> S5["S5 · README"]
```

## Checks

| ID | Runs after | Passes when |
|---|---|---|
| V1 | S4 | Under org `acme`: mara hires, roster `["<seatId>"]`, `isFromRoster` true, `discover` lists the address. Fire: released, roster empty, `discover` empty, inventory row present (BR-1 BR-8 BR-9) |
| V2 | S4 | Under `DEFAULT_ORG_ID`: the error names the organization. Roster, inventory and registry all stay empty (BR-2). **Must be seen red** by running it once under `acme` |
| V3 | S4 | Otto runs a scripted `hire` call. The run succeeds and nothing is registered (BR-3) |
| V4 | S4 | Mara hires `desk-clerk` with a `desk` setting. It registers with kind `desk-clerk` (BR-6) |
| V5 | S4 | `reloadHiredSeats` over the test's stores and `kitchenSinkKinds` returns mara's hire with no problems (BR-7) |
| V6 | S4 | A seat mara hires with `settings.tools: ["hire"]` hires in turn (BR-5) |
| V7 | S4 | The operator's `workforce-admin` fire releases a seat mara hired. Mara's `fire` of an operator hire is refused (BR-10 BR-11). Drive the admin flow the way `test/workforce-admin.test.ts` does |
| VG | S3 | **Goal, real model, real path:** `cd apps/kitchen-sink && pnpm fsdev run support.mara run -i '{"message":"Hire support.pat, an agent seat that takes refunds."}' --capture …`. Passes when the capture shows mara's `hire` tool call and the run ends in BR-2's refusal, with no `workforce/roster/` row written. If F1 resolves *hold*, VG instead runs once kitchen-sink's seats carry a real organization, and passes on a hire followed by `discover` listing it |
| V8 | S5 | `pnpm --filter kitchen-sink test` and `pnpm typecheck` green. `fsdev gen --check` clean (no generated change expected) |

The second path (BP-035) is V2 plus V7: the default organization, and the other hire path.

## Pinned names

| Where | Name | Why pinned |
|---|---|---|
| Seat | `support.mara` (folder `workforce/teams/support/workers/mara/`) | README, docs and FIX-1500's rail all name it |
| Seat tools | `[hire, fire]` | The capability's own tool names, and what the teach shows |

Everything else is yours.

## Guardrails

| Rule | Because |
|---|---|
| One kinds object: `kitchenSinkKinds` **is** the map the capability closed over | Otherwise the file roster, the operator and mara hire different `agent` kinds, and `hire.ts` warns against exactly this (`:64-69`) |
| Register only through the registrar's roster door | The operator's fire and the reload depend on its provenance mark (D2) |
| Don't add, rename or reshape any capability export, and don't pass `orgId` | FIX-1525/1526 own the surface, and FIX-1500 owns any model-free export. Org comes from the principal (BP-031) |
| Don't route around BR-2: no dev resolver, no org remap, no catch that turns the refusal into success | It's F1's question, and FIX-1536 lists remapping the placeholder org as an invent-kill |
| Don't fix FIX-1540 here | Separate bug, and `discover` isn't misled by it |

## Docs

Reconcile and publish [DOCS.md](DOCS.md) after V1 to V7 pass and VG has run. Kitchen-sink
README only.

## Sketch · pseudocode, illustrative

```
kinds map ← generated kinds                     (one object, exported as kitchenSinkKinds)
seat-hire ← capability(kinds map, the registrar's roster door)
discover  ← workforce capability(seat inventory key, hired roster key)
agent     ← the kind, uses: team capabilities + seat-hire + discover, catalog: blocks
kinds map.agent ← agent
```

**POC:** [`poc/manager-seat/`](poc/manager-seat/README.md). It composed this shape on the real
kind with the real registrar proxy. P1 to P6 passed, and four planted controls each went red. It
also found the organization gate (P2, leg R), which reshaped the spec around F1. Everything
else held.

## At implement time

- Check F1's answer on the issue. *Hold* means stop and report, not build.
- FIX-1500's amendment may have added a model-free hire export and moved the tools onto it.
  Nothing in S1 changes, since mara still uses the tools. Re-run V1 to V7.
- [FIX-1540](https://linear.app/fixpoint-labs/issue/FIX-1540) may have landed. If so, V1's
  inventory-row-present assertion flips. Follow the shipped behaviour.
- If kitchen-sink's seats gained a real organization in the meantime, VG takes its success
  form.

## Follow-ups

- `apps/docs` documents `createSeatHireCapability` nowhere. That's the package's surface, so
  it belongs to FIX-1525's docs, not this app.
- Kitchen-sink writes no seat inventory for file-declared seats, so `discover` lists only
  runtime hires. Owned by the rail and read-model work
  ([FIX-1500](https://linear.app/fixpoint-labs/issue/FIX-1500),
  [FIX-1539](https://linear.app/fixpoint-labs/issue/FIX-1539)).
