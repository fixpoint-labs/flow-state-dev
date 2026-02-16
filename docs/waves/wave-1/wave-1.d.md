# Wave 1.d - Flow APIs and Tool Loop Runtime (Canonical Wave D)

## 1. Objective

Implement canonical flow runtime APIs in `@flow-state-dev/core` by adding `defineFlow`, callable `FlowType` instance creation behavior, merge-based overrides, and flow-level tool config wiring into generator tool execution.

## 2. Canonical Inputs

Primary authority for this wave:

1. `../preperation/architecture/IMPLEMENTATION_PLAN.md` (Wave D tasks D1, D2, D4)
2. `../preperation/architecture/FLOW_SYSTEM.md` (`defineFlow`, `FlowType`, `ToolsConfig`)
3. `../preperation/architecture/ARCHITECTURE_OVERVIEW.md` (canonical flow model defaults and constraints)
4. `docs/waves/wave-1/wave-1.c.md` (block-builder/runtime handoff)

## 3. Scope

### In scope

- `packages/core/src/flow/defineFlow.ts` implementation.
- `packages/core/src/flow/index.ts` barrel export.
- Flow-level tool defaults/hooks propagation into generator runtime.
- Core root export updates for `defineFlow` and flow types.
- Unit tests covering `defineFlow` and tool wiring behavior.
- Wave 1.d execution artifacts.

### Out of scope

- Server runtime action execution pipeline.
- Flow registry and HTTP routing.
- Streaming transport/runtime behavior.

## 4. Deliverables

- Callable `defineFlow(...)` API with:
  - `requireSession` default `true`
  - Phase 1 `requireUser=true` enforcement
  - merge-based shallow instance overrides
  - action replacement/extension support at instance creation
- Flow-level `tools` merge behavior with instance overrides.
- Generator tool execution consuming flow-level tool defaults and lifecycle hooks through action-block wiring.
- Updated core exports for flow runtime API and flow type surface.

## 5. Verification Gates

- `pnpm --filter @flow-state-dev/core typecheck`
- `pnpm --filter @flow-state-dev/core test`
- `pnpm -r --if-present typecheck`
- `pnpm -r --if-present test`

## 6. Handoff

Wave 1.e can assume `@flow-state-dev/core` now exposes:

- canonical `defineFlow` runtime constructor
- callable flow type/instance behavior with shallow override semantics
- flow-level tool defaults and lifecycle hooks wiring into generator action blocks
