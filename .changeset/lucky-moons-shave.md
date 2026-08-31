---
"@flow-state-dev/core": patch
"@flow-state-dev/engine": patch
---

`withTimeout(promise, timeoutMs, label, onTimeout?)` is now exported from `@flow-state-dev/core/helpers`, so bounding a promise with a deadline no longer needs a hand-rolled `Promise.race` per call site. It clears its timer on every settle path, treats `undefined` or a non-positive timeout as "no deadline", and takes an optional `onTimeout` when the caller needs the timeout to arrive as its own error type. A batch text-to-speech call that misses its deadline now names itself in the rejection (`"tts batch synthesis timed out after 15000ms"`) instead of reporting a bare `"Timed out after 15000ms"`. (FIX-1290)
