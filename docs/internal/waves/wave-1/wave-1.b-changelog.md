# Wave 1.b Changelog

Date: 2026-02-15
Wave: 1.b (Canonical Wave B)
Status: Completed

## Deliverables

| Deliverable | Status | Evidence |
|---|---|---|
| Block/context/connector type contracts | Completed | `packages/core/src/types/block.ts`, `packages/core/src/types/index.ts` |
| Flow/action/tools type contracts and inference hooks | Completed | `packages/core/src/types/flow.ts`, `packages/core/src/types/index.ts` |
| Scope/state/resource/projection type contracts | Completed | `packages/core/src/types/scope.ts`, `packages/core/src/types/state.ts`, `packages/core/src/types/resource.ts`, `packages/core/src/types/index.ts` |
| Canonical item/content/stream event types | Completed | `packages/core/src/items/content.ts`, `packages/core/src/items/types.ts`, `packages/core/src/items/events.ts`, `packages/core/src/items/index.ts` |
| Schema helper modules | Completed | `packages/core/src/schema/common.ts`, `packages/core/src/schema/index.ts` |
| Type smoke checks for connector + flow inference | Completed | `packages/core/src/types/tests/sequencer-connectors.type-test.ts`, `packages/core/src/types/tests/flow-state-inference.type-test.ts` |
| Core boundary export wiring updates | Completed | `packages/core/src/index.ts`, `packages/core/src/types/index.ts`, `packages/core/src/items/index.ts`, `packages/core/package.json` |
| Wave execution artifacts | Completed | `docs/waves/wave-1/wave-1.b.md`, `docs/waves/wave-1/wave-1.b-journal.md`, `docs/waves/wave-1/wave-1.b-changelog.md`, `changelog.md` |

## Verification Summary

| Verification | Outcome |
|---|---|
| `pnpm --filter @flow-state-dev/core typecheck` | Pass |
| `pnpm -r typecheck` | Pass |
| `pnpm --filter @flow-state-dev/core lint` | Pass |
| `pnpm --filter @flow-state-dev/core test` | Pass |
| `pnpm -r lint` | Pass |
| `pnpm -r test` | Pass |
| `rg -n "from ['\\\"]/|from \\\"/" packages/core/src` | Pass (no matches) |
| `find packages/core/src/types -maxdepth 2 -type f` | Pass |
| `find packages/core/src/items -maxdepth 2 -type f` | Pass |
| `find packages/core/src/schema -maxdepth 2 -type f` | Pass |

## Notes

- Runtime `tsc` validation remains deferred until dependencies can be installed in an environment with npm registry access.
- Wave 1.b contracts are implemented and wired for downstream Wave 1.c builder work.
- Post-merge architecture sync applied: stream event types now include request/user stream split and `scope.state.changed` user-stream event typing per updated canonical docs.
