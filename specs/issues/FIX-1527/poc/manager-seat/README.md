# POC · the manager seat, composed on kitchen-sink's own kind

A throwaway experiment kept as design evidence for [FIX-1527](../../SPEC.md). It isn't
production code or a workspace package, and it sits in no default build, test, lint or knip
discovery (`knip.json` ignores `specs/issues/*/poc/**`). Nothing imports it. Its test runs only
when copied into kitchen-sink's `test/` folder, as below.

## What it settles

The spec rests on one premise that couldn't be read off the source with confidence:

> Composed on kitchen-sink's real `agent` kind and wired to the app's real registrar, a seat
> that names `hire` can hire, the result lands in the roster the app already reloads, and
> `discover` lists it. **And under the organization kitchen-sink's seats run under today, it
> can't.**

The second half is the finding that became [F1](../../DECISIONS.md#f1).

## Legs

| Leg | Claim | Observed on `origin/main` `ffe2b6e26` |
|---|---|---|
| P1 | Under org `acme`, mara's `hire` writes the org roster row, the registrar marks the address as roster-minted, and `discover` lists it | PASS: roster `["support.pat"]`, `isFromRoster("acme.support.pat")` true, discover `["acme.support.pat"]` |
| P2 | Under `DEFAULT_ORG_ID`, the same call refuses and writes nothing | PASS: error `Organization id "__fsd_default_org__" must be lowercase …`, roster `[]`, inventory `[]`, nothing registered |
| P3 | A neighbour on the same kind with `tools: [desk-note]` can't hire | PASS: run succeeds, nothing registered, roster `[]` |
| P4 | Fire releases the address and drops the seat from `discover`, and the inventory row stays | PASS: roster `[]`, inventory `["acme.support.pat"]`, discover `[]`. The leftover row is [FIX-1540](https://linear.app/fixpoint-labs/issue/FIX-1540) |
| P5 | The app's existing `reloadHiredSeats` brings mara's hire back | PASS: seats `["acme.support.pat"]`, problems `[]` |
| P6 | A seat mara hires with `settings.tools: [hire]` can itself hire | PASS: the hired seat hires `acme.support.quinn` |
| R | The real app boots with the composed kind and a `mara` seat, and `fsdev run` runs it under the placeholder organization | See below |

### Negative controls, run

Each control flips one input the claim depends on. Each one turned its leg red and left the
other legs green:

| Control | Leg | Red with |
|---|---|---|
| `POC_ORG=acme` | P2 | `.toMatch() expects to receive a string, but got undefined`. Under a named org the hire succeeds |
| `POC_NEIGHBOUR_TOOLS=desk-note,hire` | P3 | `expected 1 to be +0`. The neighbour hired |
| `POC_RELOAD_ORG=globex` | P5 | `expected [] to deeply equal [ 'acme.support.pat' ]` |
| `POC_HIRED_TOOLS=` | P6 | `expected false to be true`. A seat hired with no tools can't hire |

P1 and P4 have no control of their own. P1's roster and registrar assertions are the success
branch of the same call P2's control flips. P4's inventory assertion restates a fact the
package suite already asserts (`seat-hire-capability.test.ts:359-376`).

### Leg R · the real path

We applied [`leg-r.patch`](leg-r.patch) (the composition the plan proposes for
`workforce/hire.ts`) plus a `workforce/teams/support/workers/mara/WORKER.md` with
`tools: [hire, fire]`, then ran from `apps/kitchen-sink`:

```bash
AI_GATEWAY_API_KEY= OPENAI_API_KEY= pnpm -s fsdev run support.mara run -i '{"message":"hire support.pat"}'
```

The app booted through its real `fsdev.config.ts`: file hire, registrar install, reload,
channel open. `support.mara` ran. Its generator's trace shows
`"declaredResources":["skills","hiredRoster","seatInventory"]`, and the runtime log shows
`"orgId":"__fsd_default_org__"`. The run stopped at the model (`No API key found for gateway
"vercel"`), since no key is configured in this environment. The seat never reached a tool call.
That's enough to show the org half of P2 on the real path. The model-driven half is the plan's
goal check. Both edits were reverted afterwards. Kitchen-sink's full vitest suite passed with
the same patch applied, apart from `test/blocks.test.ts`, which fails the same four tests
without it.

## Run it

From the repository root:

```bash
cp specs/issues/FIX-1527/poc/manager-seat/manager-seat.test.ts apps/kitchen-sink/test/zz-poc-manager-seat.test.ts
(cd apps/kitchen-sink && ../../node_modules/.bin/vitest run test/zz-poc-manager-seat.test.ts)
# controls, one at a time:
(cd apps/kitchen-sink && POC_ORG=acme ../../node_modules/.bin/vitest run test/zz-poc-manager-seat.test.ts)
rm apps/kitchen-sink/test/zz-poc-manager-seat.test.ts
```

It runs from kitchen-sink because it imports the app's own `lib/workforce-registrar` and
`workforce/workforce.gen` through the `@/` alias.

## Limits

- **Mocked model.** The tool calls are scripted. Whether a real model chooses to call `hire`
  is the plan's goal check (VG), not this POC.
- **In-memory registrar.** `setWorkforceRegistrarImpl` is installed over a `Map`, not over
  `FlowState`. Leg R covers the real install.
- **`createTestContext` supplies the org.** P1 to P6 pass the organization directly. That
  kitchen-sink's seat requests carry the placeholder comes from leg R, from the engine's
  default resolver (`packages/engine/src/transports/host/createInboundTransportHost.ts:944-976`,
  `:1006-1023`), from the CLI (`packages/cli/src/commands/run.ts:304`, `:373`), and from
  FIX-1477's router probe (`specs/issues/FIX-1477/poc/read-gate/premise-proof.test.ts:190-239`).
