# Wave 1.i Journal

## Date

- 2026-02-16
- 2026-02-19

## Commands Run

```bash
pnpm --filter @flow-state-dev/core test
pnpm --filter @flow-state-dev/client test
pnpm --filter @flow-state-dev/server test
pnpm --filter @flow-state-dev/react test
pnpm install --filter @flow-state-dev/react
```

## Notes

- Refactored React wave surfaces to align with current direction:
  - removed `useTypedFlowClient`
  - added `useProjections(session, options)`
  - added `useBlockContext()`
  - simplified `useSession` (`items` option, `detail` field, pre-memoized item views)
  - moved block renderer resolution to `FlowProvider` context (`renderKey` based)
- Updated client snapshot contract and query options:
  - `SessionStateSnapshotResponse.projections` is now scope-grouped (`session`/`user`/`project`)
  - added optional `items` snapshot payload
  - added `getSessionState(..., { includeItems, projections })`
- Aligned core/server contracts with architecture direction:
  - block config renames: `render` -> `clientOutput`, `message` -> `llmOutput`
  - item field rename: `renderName` -> `renderKey`
  - `UserConfig`/`ProjectConfig` now support `projections`
  - `ResourceConfig` and `ResourceHandle` expanded to include Phase 1 content/config fields
  - server `/sessions/:id/state` now computes scope-grouped client projections and supports projection filtering
- Added server route coverage for grouped projections and projection query filters.
- React test execution is currently blocked in this environment because `react` is not installed in `packages/react/node_modules` and registry access is unavailable (`ENOTFOUND registry.npmjs.org`).
