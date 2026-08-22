---
"@flow-state-dev/patterns": patch
"@flow-state-dev/tools": patch
---

State-only auditor, event-actor, and bash setup steps no longer echo their input as output. They run as taps and leave that payload out of the items log.
