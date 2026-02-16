# Wave 1.f Changelog

## Summary

- Added request-stream response emission runtime with canonical sequence/id behavior and resource update item emission.
- Added SSE frame serialization and stream event encoding helpers.
- Added resume/replay cursor utilities for `Last-Event-ID` and `starting_after` with canonical precedence rules.
- Exported streaming runtime utilities from `@flow-state-dev/server`.
- Added server unit tests covering emitter behavior, SSE encoding, and replay filtering logic.

## Deliverable Mapping

| Deliverable | Evidence |
|---|---|
| Response emitter runtime | `packages/server/src/streaming/response-emitter.ts` |
| SSE framing + stream encoder | `packages/server/src/streaming/sse.ts`, `packages/server/src/streaming/encode-event.ts` |
| Replay cursor parsing + event replay helpers | `packages/server/src/streaming/resume.ts` |
| Streaming barrel + server export wiring | `packages/server/src/streaming/index.ts`, `packages/server/src/index.ts` |
| Unit verification coverage | `packages/server/test/streaming.test.ts`, `packages/server/test/index.test.ts` |
| Store helper dedupe follow-up | `packages/server/src/stores/shared.ts`, `packages/server/src/stores/memory/shared.ts`, `packages/server/src/stores/filesystem/shared.ts` |
