---
"@flow-state-dev/patterns": patch
---

The round-robin, debate, and routedSpecialists patterns no longer echo their inputs back into the items log from side-effect-only steps. The blocks that reset resources, record contributions/arguments, and snapshot iteration state are now wired as taps and drop their misleading pass-through `outputSchema`, so the items log shows only the steps that actually produce output.
