---
"@flow-state-dev/core": patch
"@flow-state-dev/engine": patch
"@flow-state-dev/workspace": patch
---

A failed turn's reason reads as plain text. When a thrown error's message carries terminal colour codes, as the AI SDK's "Unauthenticated request to AI Gateway" error does when no gateway key is set, the engine removes them as it normalizes the error, so the turn's `error` item, the request's recorded error and every surface that shows them get the words without the codes (FIX-2558).

- **engine:** `normalizeError` strips ANSI colour and style codes from the message of the `FlowError` it returns, on every path (a plain throw, a thrown `FlowError`, a classified AI SDK error). The original error, kept as `cause`, is unchanged.
- **core:** `stripAnsi(text)` is exported from `@flow-state-dev/core/helpers`: the text with its ANSI control sequences removed, colon-form colour codes (`ESC[38:2::255:0:0m`) included.
- **workspace:** the output tail of a checkout command (`runCheckoutCommands`) uses the same helper, so colon-form colour codes no longer stay in it.

Docs: packages/core/README.md (Helpers section: a `stripAnsi(text)` entry beside `toError`)
