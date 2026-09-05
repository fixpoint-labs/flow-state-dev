---
"@flow-state-dev/contracts": minor
"@flow-state-dev/core": minor
---

Generator turn-boundary suspension and log-based resume (FIX-814 PR3). A tool inside a running generator can now call `ctx.suspend()`: the request suspends at the turn boundary and, on resume, the generator continues past the approved call by reconstructing its conversation from the durable item log — no model re-call for recorded steps, no double-fired side effects.

- `ctx.suspend()` from a generator tool propagates out of the framework-owned tool loop (first-suspension-wins when concurrent siblings suspend; completed siblings settle and are memoized first).
- New replay-only `generator_step` item records each tool-calling step's assistant turn + tool-call metadata (and the step-0 prelude) so resume never re-calls the model; it is client-invisible, history-excluded, and retained across resume collapse.
- `tool_output` gains a persisted `modelOutput` (the model-facing result computed once at settle, never recomputed on resume) and records the disambiguated tool alias; a suspension-origin failure is stamped `error.code: "SUSPENSION"`.
- Tool-call path segments (`blockPathTool`/`blockPathBranch`) percent-escape reserved characters, and the owned loop's tool path folds in the model step index, so gate matching over reserved-char call ids and provider-reused ids stays unambiguous.
- `createFallbackModel` now forwards `generateStep`/`streamStep`, so fallback model groups can drive the framework-owned loop.
