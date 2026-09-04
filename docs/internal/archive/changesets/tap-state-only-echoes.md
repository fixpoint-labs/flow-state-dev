---
"@flow-state-dev/core": patch
"@flow-state-dev/patterns": minor
"@flow-state-dev/tools": patch
---

State-only auditor, event-actor, and bash setup steps no longer echo their input as output. They run as taps and leave that payload out of the items log (FIX-1214).

**Breaking (`@flow-state-dev/patterns`):** `captureContext` is a public export and now produces no output. Flow authors who remix the response-auditor pipeline must compose it with `.tap(captureContext)` instead of `.step(captureContext)` — as a `.step()` it now passes `undefined` to the next step.

`sessionTitleGenerator` persists the title with a tap for the same reason. Its sequencer output is unchanged (`{ title }` from the generator step); only the redundant handler echo is gone.
