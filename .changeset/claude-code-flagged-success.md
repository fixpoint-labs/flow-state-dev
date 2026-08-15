---
"@flow-state-dev/claude-code": patch
---

Fail a Claude Code Agent SDK run the SDK flagged, instead of recording it as a
completed one (LAB-74). The SDK ends an unauthenticated run — a missing or
expired credential, a fresh container, a misconfigured CI runner — with a
terminal result whose subtype is `success` and whose `is_error` flag is set, the
reason sitting in the result text (`Invalid API key · Please run /login`).
`claudeCodeAgent` read the subtype alone, so on such a machine every run
appended a `status: "completed"` handle with zero turns and zero cost, and
anything reading those handles believed it.

The verdict now comes from one place. The shared reader behind all three
surfaces answers "did this run succeed" in a single field that already accounts
for the error flag, so a caller cannot get it half-right: `runClaudeHeadless`
(which honoured the flag) and `claudeCodeAgent` (which did not) can no longer
disagree about the same result message. A flagged run gets an `errored` handle
and an `error` item carrying the SDK's own words, not a generic failure line.

The handle still reports `resultSubtype: "success"` for this shape, because that
is what the SDK said — `status` is the verdict, `resultSubtype` is the report. If
you branch on `resultSubtype` to decide whether a run worked, branch on `status`
instead. The `result` variant of `TranslatedEvent` gains a `succeeded` field
carrying the same verdict.
