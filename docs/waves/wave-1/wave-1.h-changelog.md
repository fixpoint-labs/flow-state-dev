# Wave 1.h Changelog

## Summary

- Added canonical server flow registry with deterministic `register/get/list` behavior.
- Added canonical catch-all route parser for `/api/flows/[...path]`.
- Added route handlers for flow listing/capabilities, action execution, request-stream replay, and session APIs.
- Qualified non-block HTTP route handlers under `http-handlers.ts`.
- Added catch-all route adapter `createFlowApiRouter` with internal no-op request bootstrap seams for future middleware context enrichment.
- Added server unit coverage for registry, parser, and route integration behavior.

## Deliverable Mapping

| Deliverable | Evidence |
|---|---|
| Flow registry | `packages/server/src/registry/flow-registry.ts` |
| Route parser | `packages/server/src/routes/parseFlowRoute.ts` |
| Canonical route handlers | `packages/server/src/routes/http-handlers.ts` |
| Catch-all adapter | `packages/server/src/routes/createFlowApiRouter.ts` |
| Route/registry export wiring | `packages/server/src/routes/index.ts`, `packages/server/src/registry/index.ts`, `packages/server/src/index.ts` |
| Unit verification coverage | `packages/server/test/registry-routes.test.ts`, `packages/server/test/index.test.ts` |
