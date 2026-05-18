# Wave 1.b Journal

Date: 2026-02-15

## Canonical Inputs Reviewed

1. The build playbook
2. The implementation plan
3. The architecture overview
4. The block contracts spec
5. The flow system spec
6. The state and scopes spec
7. The streaming spec
8. `docs/waves/wave-1/wave-1.b.md`

## Execution Notes

- Implemented Wave 1.b core types and schema modules under `packages/core/src/types`, `packages/core/src/items`, and `packages/core/src/schema`.
- Replaced Wave 1.a placeholder marker types with canonical type exports for block, flow, state, scope, resource, and projection contracts.
- Added canonical output item/content/event type surface for `@flow-state-dev/core/items`.
- Added compile-only type smoke files for connector chaining and flow scope-state inference in `packages/core/src/types/tests`.
- Updated `packages/core/src/index.ts`, `packages/core/src/types/index.ts`, and `packages/core/src/items/index.ts` to expose Wave 1.b contracts.
- Added `zod` dependency to `packages/core/package.json` for canonical schema typing.
- Updated React smoke import proof to consume real core type/item exports in `packages/react/src/_wave-1a-import-smoke.ts`.

## Environment Deviation

- Network access to npm registry remains unavailable in this environment.
- `pnpm install` was not re-attempted for Wave 1.b because prior runs failed with `ENOTFOUND registry.npmjs.org`.
- Verification used `scripts/typecheck.mjs` static checks for import wiring and source structure in lieu of `tsc` compilation.

## Verification Command Log

| Command | Result |
|---|---|
| `pnpm --filter @flow-state-dev/core typecheck` | Passed (`packages/core` static typecheck) |
| `pnpm -r typecheck` | Passed for all workspace packages/apps |
| `pnpm --filter @flow-state-dev/core lint` | Passed (placeholder script) |
| `pnpm --filter @flow-state-dev/core test` | Passed (placeholder script) |
| `pnpm -r lint` | Passed (placeholder scripts) |
| `pnpm -r test` | Passed (placeholder scripts) |
| `rg -n "from ['\\\"]/|from \\\"/" packages/core/src` | Passed; no matches (exit code 1 indicates no absolute imports) |
| `find packages/core/src/types -maxdepth 2 -type f \| sort` | Passed; expected Wave 1.b type files present |
| `find packages/core/src/items -maxdepth 2 -type f \| sort` | Passed; expected Wave 1.b item files present |
| `find packages/core/src/schema -maxdepth 2 -type f \| sort` | Passed; expected Wave 1.b schema files present |

## Contract Spot-Check Notes

- Verified `BLOCKS.md` alignment:
  - `BlockKind` constrained to `handler | generator | sequencer | router`.
  - `BlockDefinition`, `BlockContext`, `ConnectorFn`, `RetryPolicy`, `ChunkValidation`, and `TargetHandle` are present.
- Verified `FLOW_SYSTEM.md` alignment:
  - `FlowDefinition`, `FlowType`, `FlowInstance`, `ActionConfig`, and flow lifecycle hook type surfaces are present.
  - `ToolsConfig` and `ToolLifecycleEvent` types are present.
  - Added schema-to-state inference hooks (`InferScopeStateFromConfig`, `InferFlowStateMap`, `InferFlowBlockContext`).
- Verified `STATE_AND_SCOPES.md` alignment:
  - Canonical scope handles and state ops contracts implemented.
  - Resource/projection typing includes `defineResource`, `defineProjection`, `StateOf`, and `ContextOf`.
- Verified `STREAMING.md` alignment:
  - `OutputItem` union and `Content` taxonomy follow canonical item-first model.
  - Stream event envelopes include `sequence_number` and request/item/content lifecycle events.

## Addendum: Post-Merge Architecture Sync (2026-02-15)

- Reviewed new architecture updates in `preperation` related to streaming invalidation and scope-state change signaling.
- Updated `packages/core/src/items/events.ts` to align with canonical stream envelope split:
  - added `RequestEventBase` and `UserEventBase` with `stream` discriminator
  - added `RequestStreamEvent` and `UserStreamEvent` unions
  - narrowed request `resource.changed` scope to `request`
  - added optional-capability user stream events:
    - `UserResourceChangedEvent` (`scope: session | user | project`)
    - `ScopeStateChangedEvent` (`type: scope.state.changed`)
- Updated `packages/core/src/items/index.ts` exports for new event types.
- Re-ran `pnpm --filter @flow-state-dev/core typecheck` and `pnpm -r typecheck` (both passed).
