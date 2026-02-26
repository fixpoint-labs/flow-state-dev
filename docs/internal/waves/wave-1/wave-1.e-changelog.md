# Wave 1.e Changelog

## Summary

- Added canonical server runtime context factory and context type surface.
- Added CAS retry primitive, versioned state container, and canonical scope state operation helpers.
- Added memory and filesystem store adapters for session/request/user/project persistence.
- Added store/context exports from `@flow-state-dev/server` root and unit verification coverage.

## Deliverable Mapping

| Deliverable | Evidence |
|---|---|
| Context factory and context types | `packages/server/src/context/createExecutionContext.ts`, `packages/server/src/context/types.ts` |
| CAS primitive and concurrent modification error | `packages/server/src/stores/cas.ts` |
| Versioned state container and scope ops | `packages/server/src/stores/state-container.ts` |
| Filesystem store adapters | `packages/server/src/stores/filesystem/session-store.ts`, `packages/server/src/stores/filesystem/request-store.ts`, `packages/server/src/stores/filesystem/user-store.ts`, `packages/server/src/stores/filesystem/project-store.ts` |
| In-memory store adapters | `packages/server/src/stores/memory/session-store.ts`, `packages/server/src/stores/memory/request-store.ts`, `packages/server/src/stores/memory/user-store.ts`, `packages/server/src/stores/memory/project-store.ts` |
| Store/server export wiring | `packages/server/src/stores/index.ts`, `packages/server/src/index.ts` |
| Unit verification coverage | `packages/server/test/index.test.ts`, `packages/server/test/state-container.test.ts`, `packages/server/test/context.test.ts`, `packages/server/test/stores.test.ts` |
