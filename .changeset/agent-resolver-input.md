---
"@flow-state-dev/claude-code": patch
---

`cwd` and `sandbox` resolvers now see the same input (FIX-150).

`cwd` was handed the block input directly while `sandbox` was handed a freshly built `{ prompt }` carrying the *resolved* prompt. Those are different strings whenever a `prompt` picker or surrounding whitespace is in play — `cwd` saw what the caller sent, `sandbox` saw what the run runs — so a caller deriving coordinated paths from them could end up confining the run to a directory it was never given.

Both now receive one object holding the prompt the run actually runs.
