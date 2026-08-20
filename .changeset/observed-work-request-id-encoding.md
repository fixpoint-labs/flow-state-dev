---
"@flow-state-dev/claude-code": patch
---

A caller-supplied request id containing path syntax no longer silently empties
the agent's observation records (LAB-134).

The request id is the leading segment of the namespace that keys
`observed-file-ops`, `observed-plan` and `observed-gaps`. It went in raw, so an
id holding a `..` segment produced keys the collection key normalizer rejects —
and because the gap rows share that namespace, the record that exists to report
a lost write was rejected along with the writes. The run finished successfully
with all three collections empty and nothing anywhere reporting the loss.

The id is now percent-escaped into a single path segment, as is the invocation
path beside it. The escaping is reversible rather than lossy, so two distinct
request ids can never collapse into one namespace and mix two runs' rows
together. Ids that were already valid keys are unchanged, so existing rows keep
their keys.
