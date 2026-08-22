---
"@flow-state-dev/core": patch
"@flow-state-dev/patterns": patch
"@flow-state-dev/tools": patch
---

State-only auditor, event-actor, and bash setup steps no longer echo their input as output. They run as taps and leave that payload out of the items log (FIX-1211).

`sessionTitleGenerator` persists the title with a tap for the same reason. Its sequencer output is unchanged (`{ title }` from the generator step); only the redundant handler echo is gone.
