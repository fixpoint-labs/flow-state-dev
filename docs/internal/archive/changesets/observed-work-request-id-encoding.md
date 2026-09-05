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
with all three collections empty and nothing reporting the loss.

The id is now percent-escaped into a single path segment. The escaping is
reversible rather than lossy, so two distinct request ids can never collapse
into one namespace and mix two runs' rows together.

**Migration:** ids that were already valid keys are unchanged, with one
exception — an id containing a `%` now keys under `%25` (`a%b` becomes `a%25b`),
because escaping `%` is what keeps the encoding reversible. Rows written under
such an id before this release keep their old keys and will not appear under the
new prefix. Read-time filters built from a request id must escape it the same
way; see the readback note in the package README.
