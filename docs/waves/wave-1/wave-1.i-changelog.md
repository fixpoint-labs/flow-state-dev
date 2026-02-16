# Wave 1.i Changelog

## Summary

- Added canonical client transport types and HTTP helpers for action/session/state APIs.
- Added generic action client plus typed flow-bound client (`actions.<actionName>(input)`).
- Added session client support for list/get/create/delete, session request listing, and state snapshots.
- Added request/user SSE clients with event parsing, callback dispatch, dedupe, and resume controls (`Last-Event-ID`, `starting_after`).
- Added React-facing wrappers for flow/session/action/request-stream usage, plus typed flow client wrapper.
- Added item render helpers (`ItemRenderer`, `ItemsRenderer`, `MessagesRenderer`, `BlockRenderer`), block renderer registry, and flow context helpers.
- Added package-level unit tests for all Wave 1.i client/react runtime surfaces.
- Updated package scripts to ensure deterministic client/react typecheck/test dependency builds.

## Deliverable Mapping

| Deliverable | Evidence |
|---|---|
| Client transport API | `packages/client/src/types/index.ts`, `packages/client/src/internal/http.ts`, `packages/client/src/action-client/executeAction.ts`, `packages/client/src/session-client/sessions.ts`, `packages/client/src/index.ts` |
| SSE stream client | `packages/client/src/stream-client/createSSEClient.ts` |
| React hook wrappers | `packages/react/src/hooks/useFlowAgent.ts`, `packages/react/src/hooks/useSession.ts`, `packages/react/src/hooks/useAction.ts`, `packages/react/src/hooks/useRequestStream.ts`, `packages/react/src/hooks/useTypedFlowClient.ts` |
| React render/registry/context | `packages/react/src/components/ItemRenderer.ts`, `packages/react/src/components/ItemsRenderer.ts`, `packages/react/src/components/MessagesRenderer.ts`, `packages/react/src/components/BlockRenderer.ts`, `packages/react/src/registry/block-renderers.ts`, `packages/react/src/context/FlowContext.ts`, `packages/react/src/index.ts` |
| Unit verification coverage | `packages/client/test/index.test.ts`, `packages/client/test/action-client.test.ts`, `packages/client/test/sessions.test.ts`, `packages/client/test/stream-client.test.ts`, `packages/react/test/index.test.ts`, `packages/react/test/hooks.test.ts`, `packages/react/test/context-registry-renderers.test.ts` |
