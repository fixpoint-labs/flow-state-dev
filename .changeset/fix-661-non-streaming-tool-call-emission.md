---
"@flow-state-dev/core": patch
"@flow-state-dev/testing": patch
---

Generator block now emits `tool_call_progress` items from non-streaming model resolvers — when a model implements `generate()` but not `stream()`, tool calls returned on the generation result (and per-step `toolResults`) are surfaced as the same `in_progress` and `completed` items the streaming branch produces, so tool-call observability no longer depends on transport.

`createMockModelResolver` now exposes a `stream()` method on the resolved model that mirrors the production chunk shape (`tool_call_delta`, `tool_result`, `text_delta`, `finish`). Mock-driven tests now exercise the same code path real flows do — tool-call items appear on `result.items` where they previously didn't. Update any test that asserted on the absence of `tool_call_progress` items from the mock.
